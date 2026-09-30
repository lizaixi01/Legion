"""Model-only transport for SaaSBench workers.

The benchmark worker runs inside the task container, which has general internet access
for dependency installation. It must not receive the host's model credentials, so Codex
inside the container is pointed at this listener instead of the upstream model service.

The listener binds the Docker bridge gateway only, forwards an allowlist of Codex
Responses API paths to the upstream service, and attaches the host credential here.
Nothing else is proxied: there is no arbitrary-URL or filesystem endpoint.
"""
import http.server
import json
import os
import socketserver
import sys
import urllib.error
import urllib.request

AUTH, PORT, BIND = sys.argv[1], int(sys.argv[2]), (sys.argv[3] if len(sys.argv) > 3 else '0.0.0.0')
UPSTREAM = 'https://chatgpt.com'
ALLOWED = {
    '/backend-api/codex/responses',
    '/backend-api/codex/responses/compact',
    '/backend-api/codex/models',
    '/responses',
    '/responses/compact',
    '/models',
}
# Server-side tools (web search, browsing) are refused so the worker cannot pull in
# external source code through the model transport.
TOOL_TYPES = {'function', 'custom', 'namespace', 'local_shell'}


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def handle_request(self):
        path = self.path.split('?')[0]
        print(self.command, path, flush=True)
        if path not in ALLOWED:
            self.send_error(403, 'Model transport only')
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size > 32 * 1024 * 1024:
                self.send_error(413)
                return
            body = self.rfile.read(size) if size else None
            if body:
                parsed = json.loads(body)
                if any(t.get('type', '') not in TOOL_TYPES for t in parsed.get('tools', [])):
                    self.send_error(403, 'Web search unavailable')
                    return
            auth = json.load(open(AUTH))['tokens']
            headers = {
                k: v
                for k, v in self.headers.items()
                if k.lower() not in {'host', 'authorization', 'chatgpt-account-id', 'connection', 'content-length'}
            }
            headers['Authorization'] = 'Bearer ' + auth['access_token']
            headers['ChatGPT-Account-Id'] = auth['account_id']
            target = self.path if path.startswith('/backend-api/') else '/backend-api/codex' + self.path
            request = urllib.request.Request(UPSTREAM + target, data=body, headers=headers, method=self.command)
            try:
                response = urllib.request.urlopen(request, timeout=300)
            except urllib.error.HTTPError as error:
                response = error
            print('status', response.status, flush=True)
            self.send_response(response.status)
            for key, value in response.headers.items():
                if key.lower() not in {'connection', 'transfer-encoding', 'content-length'}:
                    self.send_header(key, value)
            self.send_header('Connection', 'close')
            self.end_headers()
            while True:
                chunk = response.read1(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
            response.close()
            self.close_connection = True
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:  # noqa: BLE001 - transport failures must not kill the listener
            print('proxy_error', type(error).__name__, flush=True)
            self.send_error(502, 'Model transport failed')

    do_POST = handle_request
    do_GET = handle_request


with Server((BIND, PORT), Handler) as server:
    print('listening', BIND, PORT, os.getpid(), flush=True)
    server.serve_forever()
