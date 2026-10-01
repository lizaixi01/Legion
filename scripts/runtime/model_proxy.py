"""Model-only transport. Unix socket exposed to a network=none container.
Credentials stay on the host. No filesystem or arbitrary URL endpoints exist.
"""
import http.server, socketserver, urllib.request, urllib.error, json, sys, os
AUTH, SOCKET = sys.argv[1:3]
class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def handle_request(self):
        path = self.path.split('?')[0]
        print(self.command,path,flush=True)
        allowed = {'/backend-api/codex/responses', '/backend-api/codex/responses/compact', '/backend-api/codex/models', '/responses', '/responses/compact', '/models'}
        if path not in allowed:
            self.send_error(403, 'Model transport only'); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>32*1024*1024: self.send_error(413); return
            body=self.rfile.read(size) if size else None
            # Do not permit a remote search tool through the model transport.
            if body:
                parsed=json.loads(body)
                if any(t.get('type','') not in {'function','custom','namespace','local_shell'} for t in parsed.get('tools',[])):
                    self.send_error(403,'Web search unavailable'); return
            auth=json.load(open(AUTH))['tokens']
            headers={k:v for k,v in self.headers.items() if k.lower() not in {'host','authorization','chatgpt-account-id','connection','content-length'}}
            headers['Authorization']='Bearer '+auth['access_token']
            headers['ChatGPT-Account-Id']=auth['account_id']
            target=self.path if path.startswith('/backend-api/') else '/backend-api/codex'+self.path
            request=urllib.request.Request('https://chatgpt.com'+target,data=body,headers=headers,method=self.command)
            try: response=urllib.request.urlopen(request,timeout=300)
            except urllib.error.HTTPError as error: response=error
            print('status',response.status,flush=True)
            self.send_response(response.status)
            for key,value in response.headers.items():
                if key.lower() not in {'connection','transfer-encoding','content-length'}: self.send_header(key,value)
            self.send_header('Connection','close');self.end_headers()
            while chunk:=response.read1(65536): self.wfile.write(chunk);self.wfile.flush()
            response.close();self.close_connection=True
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception as error:
            print('proxy_error',type(error).__name__,flush=True)
            self.send_error(502,'Model transport failed')
    do_POST=handle_request
    do_GET=handle_request
with Server(SOCKET,Handler) as server:
    os.chmod(SOCKET,0o666)
    server.serve_forever()
