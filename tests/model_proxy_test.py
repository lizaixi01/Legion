"""Behavior regressions for shared model transport (no models)."""
import contextlib, errno, http.client, importlib.util, io, json, pathlib, socket, ssl, tempfile, threading, time, unittest, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('model_proxy',ROOT/'scripts/runtime/model_proxy.py')
proxy=importlib.util.module_from_spec(spec);spec.loader.exec_module(proxy)


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(3);self.sock.connect(self.host)


class Reply:
    status=200
    def __init__(self,chunks,headers=None):
        self.chunks=iter(chunks);self.headers=headers or {'Content-Type':'text/event-stream'};self.closed=False
    def read1(self,size):
        chunk=next(self.chunks,b'')
        if isinstance(chunk,BaseException):raise chunk
        if callable(chunk):return chunk()
        return chunk
    def close(self):self.closed=True


class Opener:
    def __init__(self,response):self.response=response;self.requests=[]
    def open(self,request,timeout):
        self.requests.append((request,timeout))
        if isinstance(self.response,BaseException):raise self.response
        return self.response


class TransportTests(unittest.TestCase):
    def test_codex_routing_uses_actual_body_without_changing_it(self):
        body={'model':'gpt-6.1-sol','service_tier':'priority','input':'PRIVATE-PROMPT-SENTINEL'}
        reply=Reply([b'data: {"type":"response.completed","response":{"model":"gpt-6.1-sol","service_tier":"priority","status":"completed"}}\n\n'])
        status,_,record,opener=self.call(reply,body=body,routing=True)
        self.assertEqual(status,200)
        request=opener.requests[0][0]
        self.assertEqual(request.get_header('X-codex-routing-hint'),'model=gpt-6.1-sol;tier=priority')
        self.assertEqual(json.loads(request.data),body)
        self.assertEqual(record['routing']['sent'],'model=gpt-6.1-sol;tier=priority')
        self.assertEqual(record['tierStatus'],'confirmed')

    def test_routing_is_opt_in_and_invalid_model_cannot_inject_headers(self):
        reply=Reply([b'data: {"type":"response.completed","response":{"model":"gpt-6.1-sol","service_tier":"default","status":"completed"}}\n\n'])
        _,_,record,opener=self.call(reply)
        self.assertIsNone(opener.requests[0][0].get_header('X-codex-routing-hint'))
        self.assertNotIn('routing',record)
        with self.assertRaises(ValueError):proxy.codex_routing_hint({'model':'model\r\nAuthorization: bad'})

    def test_ssl_eof_is_not_an_operating_system_exec_format_error(self):
        fields=proxy.error_fields(urllib.error.URLError(ssl.SSLEOFError(ssl.SSL_ERROR_EOF,'SECRET-TOKEN-SENTINEL')))
        self.assertIsNone(fields['errno']);self.assertEqual(fields['sslErrorCode'],ssl.SSL_ERROR_EOF)
        self.assertEqual(fields['tlsFailure'],'tls_eof');self.assertEqual(fields['reasonType'],'SSLEOFError')
        self.assertNotIn('SECRET',json.dumps(fields));self.assertNotIn('Exec format',json.dumps(fields))

    def test_certificate_verification_code_is_retained_without_sensitive_message(self):
        error=ssl.SSLCertVerificationError(ssl.SSL_ERROR_SSL,'SECRET-TOKEN-SENTINEL');error.verify_code=20
        fields=proxy.error_fields(urllib.error.URLError(error));self.assertEqual(fields['verifyCode'],20)
        self.assertEqual(fields['tlsFailure'],'certificate_verification');self.assertNotIn('SECRET',json.dumps(fields))
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
        self.auth=self.root/'auth.json';self.auth.write_text(json.dumps({'tokens':{'access_token':'SECRET-TOKEN-SENTINEL','account_id':'SECRET-ACCOUNT-SENTINEL'}}))
    def tearDown(self):self.tmp.cleanup()
    def call(self,response,body=None,disconnect=False,path='/responses',tier='priority',routing=False):
        opener=Opener(response);sock=str(self.root/'model.sock');audit=self.root/'audit'
        with proxy.Server(sock,proxy.Handler) as server:
            proxy.configure(server,self.auth,audit,{'model':'gpt-6.1-sol','effort':'xhigh','serviceTier':tier,'codexRouting':routing},opener)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            c=UnixHTTP(sock);payload=body or {'model':'gpt-6.1-sol','reasoning':{'effort':'xhigh'},'service_tier':'priority','input':'PRIVATE-PROMPT-SENTINEL'}
            c.request('POST',path,json.dumps(payload),{'Content-Type':'application/json','Authorization':'Bearer CLIENT-TOKEN-SENTINEL'})
            if disconnect:
                c.sock.shutdown(socket.SHUT_RDWR);c.close();data=b'';status=None
            else:
                r=c.getresponse();status=r.status;data=r.read();c.close()
            for _ in range(80):
                saved=list(audit.glob('*.diagnostic.json'))
                if saved and 'elapsedMs' in json.loads(saved[0].read_text()):break
                time.sleep(.025)
            server.shutdown();thread.join(2)
        records=[json.loads(f.read_text()) for f in audit.glob('*.diagnostic.json')]
        self.assertEqual(len(records),1)
        text=json.dumps(records)
        for secret in ['SECRET-TOKEN-SENTINEL','SECRET-ACCOUNT-SENTINEL','CLIENT-TOKEN-SENTINEL','PRIVATE-PROMPT-SENTINEL']:self.assertNotIn(secret,text)
        return status,data,records[0],opener

    def test_speed_body_unchanged_and_actual_standard_recorded(self):
        payload={'type':'response.completed','response':{'model':'gpt-6.1-sol','service_tier':'default','status':'completed','usage':{'input_tokens':10,'output_tokens':2}}}
        reply=Reply([('data: '+json.dumps(payload)+'\n\n').encode()])
        status,data,r,o=self.call(reply)
        self.assertEqual(status,200);self.assertEqual(r['tierStatus'],'downgraded')
        self.assertEqual(r['sent'],{'model':'gpt-6.1-sol','effort':'xhigh','serviceTier':'priority'})
        self.assertEqual(json.loads(o.requests[0][0].data)['service_tier'],'priority')
        self.assertEqual(r['response']['usage']['input_tokens'],10);self.assertTrue(reply.closed)
        self.assertEqual(r['upstreamAttempts'],1)

    def test_explicit_fast_keeps_the_cli_priority_wire_alias_and_audits_it(self):
        body={'model':'gpt-6.1-sol','reasoning':{'effort':'xhigh'},'service_tier':'priority','input':'PRIVATE-PROMPT-SENTINEL','store':False}
        reply=Reply([b'data: {"type":"response.completed","response":{"model":"gpt-6.1-sol","service_tier":"fast","status":"completed"}}\n\n'])
        status,_,r,o=self.call(reply,body=body,tier='fast')
        self.assertEqual(status,200);self.assertEqual(r['tierStatus'],'confirmed')
        self.assertEqual(r['declared']['serviceTier'],'fast');self.assertEqual(r['received']['serviceTier'],'priority')
        self.assertEqual(r['sent']['serviceTier'],'priority');self.assertNotIn('tierTranslation',r)
        self.assertEqual(json.loads(o.requests[0][0].data),body)
        self.assertEqual(len(o.requests),1)

    def test_fast_selection_does_not_hide_a_standard_response(self):
        reply=Reply([b'data: {"type":"response.completed","response":{"model":"gpt-6.1-sol","service_tier":"default","status":"completed"}}\n\n'])
        _,_,r,_=self.call(reply,tier='fast')
        self.assertEqual(r['tierStatus'],'downgraded');self.assertEqual(r['response']['service_tier'],'default')

    def test_upstream_http_error_retains_origin_and_status_without_retry(self):
        err=urllib.error.HTTPError('https://chatgpt.com/responses',429,'limited',{'Content-Type':'application/json'},io.BytesIO(b'{"error":"limited"}'))
        status,_,r,o=self.call(err)
        self.assertEqual(status,429);self.assertEqual(r['errorOrigin'],'upstream_http')
        self.assertEqual(r['outcome'],'upstream_http_error');self.assertNotIn('localHttpStatus',r);self.assertEqual(len(o.requests),1)

    def test_connect_error_is_local_502_with_errno_not_fake_upstream_status(self):
        status,_,r,o=self.call(urllib.error.URLError(ConnectionRefusedError(errno.ECONNREFUSED,'SECRET-TOKEN-SENTINEL')))
        self.assertEqual(status,502);self.assertEqual(r['errorOrigin'],'local');self.assertEqual(r['errno'],errno.ECONNREFUSED)
        self.assertNotIn('upstreamHttpStatus',r);self.assertEqual(len(o.requests),1)

    def test_read_failure_after_headers_closes_without_second_502(self):
        status,data,r,o=self.call(Reply([b'data: {"type":"response.created","response":{"model":"gpt-6.1-sol","service_tier":"default"}}\n\n',TimeoutError('SECRET-TOKEN-SENTINEL')]))
        self.assertEqual(status,200);self.assertNotIn(b'502',data);self.assertEqual(r['outcome'],'stream_interrupted')
        self.assertEqual(r['stage'],'upstream_read');self.assertTrue(r['headersSent']);self.assertGreater(r['upstreamBytes'],0)
        self.assertEqual(len(o.requests),1)

    def test_premature_eof_and_missing_metadata_remain_unconfirmed(self):
        status,_,r,_=self.call(Reply([b'data: {"type":"response.output_text.delta","delta":"partial"}\n\n']))
        self.assertEqual(status,200);self.assertEqual(r['outcome'],'stream_interrupted');self.assertEqual(r['tierStatus'],'unconfirmed')

    def test_client_cancel_is_not_upstream_failure(self):
        def delayed():time.sleep(.3);raise ConnectionResetError(errno.ECONNRESET,'reset')
        _,_,r,o=self.call(Reply([delayed]),disconnect=True)
        self.assertEqual(r['outcome'],'client_disconnected');self.assertEqual(r['errorOrigin'],'client');self.assertEqual(len(o.requests),1)

    def test_sse_without_content_type_still_observes_completion(self):
        status,_,r,_=self.call(Reply([b'data: {"type":"response.completed","response":{"model":"gpt-6.1-sol","service_tier":"default","status":"completed"}}\n\n'],headers={'x-request-id':'request-123'}))
        self.assertEqual(status,200);self.assertTrue(r['responseCompleted']);self.assertEqual(r['tierStatus'],'downgraded')

    def test_gzip_stream_metadata_does_not_change_client_bytes(self):
        import gzip
        data=gzip.compress(b'data: {"type":"response.completed","response":{"model":"gpt-6.1-sol","service_tier":"priority","status":"completed"}}\n\n')
        _,actual,r,_=self.call(Reply([data],headers={'Content-Type':'text/event-stream','Content-Encoding':'gzip'}))
        self.assertEqual(actual,data);self.assertEqual(r['tierStatus'],'confirmed')

    def test_ping_before_sse_and_completed_client_close_are_not_cancellation(self):
        data=b': ping\n\ndata: {"type":"response.completed","response":{"model":"gpt-6.1-sol","service_tier":"default","status":"completed"}}\n\n'
        _,_,r,_=self.call(Reply([data,http.client.IncompleteRead(b'')],headers={'x-request-id':'request-123'}))
        self.assertEqual(r['outcome'],'completed');self.assertTrue(r['closedAfterCompletion']);self.assertEqual(r['tierStatus'],'downgraded')

    def test_failed_model_event_without_metadata_is_not_success(self):
        _,_,r,_=self.call(Reply([b'data: {"type":"response.failed","response":{"status":"failed"}}\n\n']))
        self.assertEqual(r['outcome'],'model_failed');self.assertEqual(r['tierStatus'],'unconfirmed')

    def test_server_side_tool_refused_before_upstream(self):
        status,_,r,o=self.call(Reply([]),{'tools':[{'type':'web_search'}]})
        self.assertEqual(status,403);self.assertEqual(r['errorKind'],'tool_refused');self.assertEqual(len(o.requests),0)

    def test_auth_file_failure_is_redacted_and_local(self):
        self.auth.write_text('broken SECRET-TOKEN-SENTINEL')
        status,_,r,o=self.call(Reply([]))
        self.assertEqual(status,502);self.assertEqual(r['stage'],'auth_read');self.assertEqual(len(o.requests),0)

    def test_programbench_forwarder_uses_shared_proxy(self):
        import runpy
        from unittest.mock import patch
        with patch.object(runpy,'run_path') as target:
            exec(compile((ROOT/'scripts/programbench/model_proxy.py').read_text(),'forwarder','exec'),{'__file__':str(ROOT/'scripts/programbench/model_proxy.py')})
        self.assertEqual(pathlib.Path(target.call_args.args[0]),ROOT/'scripts/runtime/model_proxy.py')
        self.assertEqual(target.call_args.kwargs['run_name'],'__main__')


if __name__=='__main__':unittest.main()
