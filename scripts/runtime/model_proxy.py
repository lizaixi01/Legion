"""Model-only Unix transport; one upstream attempt per request, no stream replay.
Credentials stay on host and never enter structured diagnostics.
ProgramBench's forwarding entry point uses this implementation too.
"""
import datetime, hashlib, http.client, http.server, json, os, pathlib, re, select
import socket, socketserver, ssl, sys, threading, time, urllib.error, urllib.parse, urllib.request, uuid, zlib
ALLOWED = {'/backend-api/codex/responses', '/backend-api/codex/responses/compact', '/backend-api/codex/models', '/responses', '/responses/compact', '/models'}
TOOL_TYPES = {'function', 'custom', 'namespace', 'local_shell'}


def codex_routing_hint(parsed):
    """Match native Codex routing for the authenticated ChatGPT upstream.

    Custom providers skip core/client.rs::build_routing_hint_header. The host
    proxy knows its real upstream; derive routing only from the unchanged body,
    never from client identity, credentials, or a claimed account entitlement.
    """
    model = parsed.get('model')
    tier = parsed.get('service_tier')
    if not isinstance(model, str) or not re.fullmatch(r'[a-zA-Z0-9._-]{1,160}', model):
        raise ValueError('Invalid routing model')
    if tier is not None and tier not in {'default', 'priority', 'fast', 'flex', 'auto'}:
        raise ValueError('Invalid routing tier')
    return 'model=' + model + (';tier=' + tier if tier is not None else '')


def error_fields(error):
    # Arbitrary exception messages can contain credentials; never stringify them.
    reason = getattr(error, 'reason', None)
    cause = reason if isinstance(reason, BaseException) else error
    fields = {'exceptionType': type(error).__name__, 'reasonType': type(cause).__name__, 'errno': getattr(cause, 'errno', None)}
    if isinstance(cause, ssl.SSLError):
        # SSL_ERROR_EOF=8 is an SSL code, not OS errno 8 (Exec format error).
        fields['errno'] = None
        fields['sslErrorCode'] = cause.errno
        fields['tlsFailure'] = 'tls_eof' if isinstance(cause, ssl.SSLEOFError) else 'certificate_verification' if isinstance(cause, ssl.SSLCertVerificationError) else 'tls_error'
        if isinstance(cause, ssl.SSLCertVerificationError): fields['verifyCode'] = getattr(cause, 'verify_code', None)
        for attr in ('library', 'reason'):
            value = getattr(cause, attr, None)
            if isinstance(value, str) and re.fullmatch(r'[A-Z0-9_]+', value): fields['ssl'+attr.title()] = value
    elif isinstance(cause, OSError) and cause.errno is not None:
        fields['reason'] = os.strerror(cause.errno)
    elif isinstance(reason, str): fields['reason'] = reason if reason in {'timed out', 'unknown url type: https'} else 'redacted'
    return fields


def proxy_endpoint():
    endpoint = urllib.parse.urlsplit(urllib.request.getproxies().get('https', ''))
    return {'scheme': endpoint.scheme or None, 'host': endpoint.hostname, 'port': endpoint.port}


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class ResponseObserver:
    """Bounded metadata parser: never persist prompts or model output text."""
    def __init__(self, streaming, encoding=''):
        self.streaming, self.pending, self.result = streaming, b'', {}
        self.terminal = False
        self.decoder=zlib.decompressobj(16+zlib.MAX_WBITS) if encoding=='gzip' else zlib.decompressobj() if encoding=='deflate' else None

    def event(self, event):
        if not isinstance(event,dict):return
        typ = event.get('type'); response = event.get('response', event)
        if typ in {'response.completed', 'response.failed', 'response.incomplete'} or not self.streaming: self.terminal = True
        if typ in {'response.failed','response.incomplete'}:self.result['status']=typ.split('.')[-1]
        if isinstance(response, dict) and ('model' in response or 'service_tier' in response):
            self.result.update({k: response.get(k) for k in ['model', 'service_tier', 'status', 'usage']})
            if isinstance(self.result.get('usage'),dict):
                self.result['usage']={k:v for k,v in self.result['usage'].items() if k in {'input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details','cached_input_tokens','cache_write_input_tokens','reasoning_output_tokens'}}
            self.result['event'] = typ

    def feed(self, data):
        if self.decoder:data=self.decoder.decompress(data)
        self.pending += data
        if any(line.startswith((b'data:',b'event:',b':')) for line in self.pending.split(b'\n')[:8]):self.streaming=True
        if len(self.pending) > 4 * 1024 * 1024:
            self.pending = b''; return
        if self.streaming:
            while b'\n' in self.pending:
                line, self.pending = self.pending.split(b'\n', 1)
                if line.startswith(b'data:'):
                    try: self.event(json.loads(line[5:]))
                    except (ValueError, TypeError): pass

    def finish(self):
        if not self.streaming:
            try: self.event(json.loads(self.pending))
            except (ValueError, TypeError): pass


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass

    def handle_request(self):
        began = time.monotonic(); request_id = uuid.uuid4().hex
        record = {'version': 1, 'requestId': request_id, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'method': self.command, 'path': self.path.split('?')[0], 'declared': self.server.context,
                  'sent': None, 'response': None, 'upstreamAttempts': 0, 'headersSent': False,'headersStarted':False,
                  'upstreamBytes': 0, 'clientBytes': 0, 'stage': 'request_read', 'outcome': 'failed',
                  'connectTimeoutSeconds': self.server.connect_timeout, 'readTimeoutSeconds': self.server.read_timeout,
                  'egressProxy': proxy_endpoint()}
        response = stream = None; stopped = threading.Event(); disconnected = threading.Event()
        def persist():
            if self.server.audit:
                try:
                    dest=self.server.audit/(request_id+'.diagnostic.json');temp=dest.with_suffix('.tmp')
                    temp.write_text(json.dumps(record,indent=2),encoding='utf8');temp.replace(dest)
                except OSError as error:print(json.dumps({'type':'audit_write_failed','requestId':request_id,**error_fields(error)}),flush=True)

        def local_error(code, kind):
            record.update(outcome='failed',errorOrigin='local', errorKind=kind, localHttpStatus=code)
            if not record['headersStarted']:
                record['headersStarted'] = True
                self.send_error(code, 'Model transport failed; request id ' + request_id)
                record['headersSent']=True

        def watch_client():
            while not stopped.wait(.1):
                try:
                    readable, _, _ = select.select([self.connection], [], [], 0)
                    if readable and self.connection.recv(1, socket.MSG_PEEK) == b'':
                        disconnected.set()
                        if response is not None:
                            try: response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
                            except (AttributeError, OSError): pass
                        return
                except OSError: return

        try:
            if record['path'] not in ALLOWED: local_error(403, 'path_refused'); return
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > 32 * 1024 * 1024 or self.headers.get('Transfer-Encoding'):
                local_error(413, 'invalid_body_size'); return
            body = self.rfile.read(size) if size else None
            if body is not None and len(body) != size:
                record.update(outcome='client_disconnected', errorOrigin='client'); return
            parsed = json.loads(body) if body else {}
            if any(t.get('type', '') not in TOOL_TYPES for t in parsed.get('tools', [])):
                local_error(403, 'tool_refused'); return
            record['received'] = {'model': parsed.get('model'), 'effort': parsed.get('reasoning', {}).get('effort'), 'serviceTier': parsed.get('service_tier')}
            record['sent'] = {'model': parsed.get('model'), 'effort': parsed.get('reasoning', {}).get('effort'), 'serviceTier': parsed.get('service_tier')}
            record['bodySha256'] = hashlib.sha256(body or b'').hexdigest()
            record['stage'] = 'auth_read'
            auth = json.loads(pathlib.Path(self.server.auth).read_text())['tokens']
            headers = {k:v for k,v in self.headers.items() if k.lower() not in {'host','authorization','chatgpt-account-id','connection','content-length'}}
            if (self.server.context or {}).get('codexRouting') and record['path'].endswith('/responses'):
                hint = codex_routing_hint(parsed)
                # A single value prevents an inconsistent client header winning.
                headers = {k:v for k,v in headers.items() if k.lower() != 'x-codex-routing-hint'}
                headers['x-codex-routing-hint'] = hint
                record['routing'] = {'source': 'host-codex-upstream', 'sent': hint}
            headers['Authorization'] = 'Bearer ' + auth['access_token']; headers['ChatGPT-Account-Id'] = auth['account_id']
            record['requestHeaderNames'] = sorted(k.lower() for k in headers if k.lower() not in {'authorization','chatgpt-account-id','cookie'})
            target = self.path if record['path'].startswith('/backend-api/') else '/backend-api/codex' + self.path
            request = urllib.request.Request('https://chatgpt.com' + target, data=body, headers=headers, method=self.command)
            record['stage'] = 'upstream_open'
            threading.Thread(target=watch_client, daemon=True).start()

            def connection(host, **kwargs):
                class ObservedConnection(http.client.HTTPSConnection):
                    def connect(conn):
                        record['stage'] = 'upstream_connect';persist();super().connect()
                        conn.sock.settimeout(self.server.read_timeout);record['stage'] = 'upstream_headers';persist()
                return ObservedConnection(host, **kwargs)

            class HTTPSHandler(urllib.request.HTTPSHandler):
                def https_open(handler, req): return handler.do_open(connection, req, context=handler._context)

            record['upstreamAttempts'] = 1;record['outcome']='in_flight'
            with self.server.count_lock:
                self.server.request_count += 1
                record['sessionRequestIndex'] = self.server.request_count
                if self.server.max_requests is not None and self.server.request_count > self.server.max_requests:
                    record['upstreamAttempts'] = 0; local_error(429,'diagnostic_call_limit'); return
            persist() # A killed proxy still leaves the in-flight phase and request identity.
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(handler,req,fp,code,msg,headers,newurl):return None
            opener = self.server.opener or urllib.request.build_opener(HTTPSHandler(),NoRedirect())
            try: response = opener.open(request, timeout=self.server.connect_timeout)
            except urllib.error.HTTPError as error: response = error
            record['upstreamHttpStatus'] = response.status; record['headersMs'] = round((time.monotonic() - began) * 1000)
            upstream_id = response.headers.get('x-request-id')
            record['responseTierHeaders'] = {key:response.headers.get(key) for key in ['x-service-tier','x-codex-service-tier','x-openai-service-tier'] if response.headers.get(key) in {'fast','priority','default','standard','flex','auto'}}
            if upstream_id and re.fullmatch(r'[\w-]{1,160}', upstream_id): record['upstreamRequestId'] = upstream_id
            if response.status >= 400: record['errorOrigin'] = 'upstream_http'
            record['stage'] = 'client_headers'; self.send_response(response.status)
            for key,value in response.headers.items():
                if key.lower() not in {'connection','transfer-encoding','content-length','set-cookie'}: self.send_header(key,value)
            self.send_header('X-Legion-Request-Id', request_id); self.send_header('Connection','close')
            record['headersStarted'] = True; self.end_headers();record['headersSent']=True
            persist()
            record['contentType']=response.headers.get('Content-Type','');record['contentEncoding']=response.headers.get('Content-Encoding','')
            stream = ResponseObserver('text/event-stream' in record['contentType'],record['contentEncoding'])
            while True:
                record['stage'] = 'upstream_read'; chunk = response.read1(65536)
                if not chunk: break
                first_chunk=record['upstreamBytes']==0
                record['upstreamBytes'] += len(chunk); stream.feed(chunk)
                if first_chunk:persist()
                record['stage'] = 'client_write'; self.wfile.write(chunk); self.wfile.flush(); record['clientBytes'] += len(chunk)
            stream.finish(); record['response'] = stream.result or None
            expected = response.headers.get('Content-Length')
            if disconnected.is_set(): record.update(outcome='client_disconnected', errorOrigin='client')
            elif (expected and int(expected) != record['upstreamBytes']) or (stream.streaming and not stream.terminal):
                record.update(outcome='stream_interrupted', errorOrigin='upstream_stream', errorKind='premature_eof')
            elif response.status >= 400: record['outcome'] = 'upstream_http_error'
            elif stream.result.get('status') in {'failed','incomplete'}: record.update(outcome='model_failed', errorOrigin='upstream_model')
            else: record['outcome'] = 'completed'
        except (BrokenPipeError, ConnectionResetError) as error:
            origin = 'client' if record['stage'].startswith('client_') or disconnected.is_set() else 'upstream_stream'
            record.update(outcome='client_disconnected' if origin == 'client' else 'stream_interrupted', errorOrigin=origin, **error_fields(error))
            if origin != 'client' and not record['headersStarted']: local_error(502,'upstream_connection_failed')
        except Exception as error:
            record.update(**error_fields(error))
            if disconnected.is_set(): record.update(outcome='client_disconnected', errorOrigin='client')
            elif record['headersStarted']: record.update(outcome='stream_interrupted', errorOrigin='upstream_stream' if record['stage']=='upstream_read' else 'local')
            else: local_error(502,'transport_exception')
        finally:
            stopped.set(); self.close_connection = True
            if stream: record['response'] = stream.result or None
            if response: response.close()
            record['elapsedMs'] = round((time.monotonic() - began) * 1000)
            record['responseCompleted'] = bool(stream and stream.terminal and stream.result.get('status')=='completed')
            if record['responseCompleted'] and record['clientBytes']==record['upstreamBytes'] and record['clientBytes']>0 and record['outcome'] in {'client_disconnected','stream_interrupted'}:
                record['transportClosure']=record['outcome'];record['outcome']='completed';record['closedAfterCompletion']=True
            actual = (record['response'] or {}).get('service_tier'); sent = (record['sent'] or {}).get('serviceTier')
            record['tierStatus'] = ('unconfirmed' if actual is None or not record['responseCompleted'] else 'downgraded' if sent in {'fast','priority'} and actual == 'default' else
                                    'confirmed' if sent == actual or sent in {'fast','priority'} and actual in {'fast','priority'} else 'observed')
            persist()
            print(json.dumps(record),flush=True)
    do_POST = handle_request
    do_GET = handle_request


def configure(server, auth, audit=None, context=None, opener=None, connect_timeout=30, read_timeout=300):
    server.auth, server.audit, server.context, server.opener = auth, audit, context, opener
    server.connect_timeout, server.read_timeout = connect_timeout, read_timeout
    server.count_lock=threading.Lock();server.request_count=0;server.max_requests=(context or {}).get('maxModelRequests')
    if audit: audit.mkdir(parents=True,exist_ok=True)


def main():
    auth,sock = sys.argv[1:3]
    audit = pathlib.Path(sys.argv[3]) if len(sys.argv)>3 else None
    context = json.loads(pathlib.Path(sys.argv[4]).read_text()) if len(sys.argv)>4 else None
    with Server(sock,Handler) as server:
        configure(server,auth,audit,context); os.chmod(sock,0o666); server.serve_forever()


if __name__ == '__main__': main()
