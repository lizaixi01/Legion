"""Loopback to model-only Unix socket. EOF and cancellation close both ends."""
import json, socket, socketserver, threading, time, uuid
class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        began=time.monotonic();connection_id=uuid.uuid4().hex
        remote=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);failure=[]
        def close(sock):
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
        def copy(source,target,direction):
            try:
                while data:=source.recv(65536): target.sendall(data)
            except OSError as error:failure.append({'stage':direction,'exceptionType':type(error).__name__,'errno':error.errno})
            finally:
                close(remote);close(self.request)
        try:
            remote.connect(self.server.socket_path)
            thread=threading.Thread(target=copy,args=(self.request,remote,'client_to_proxy'),daemon=True)
            thread.start();copy(remote,self.request,'proxy_to_client');thread.join(timeout=2)
        except OSError as error:failure.append({'stage':'unix_connect','exceptionType':type(error).__name__,'errno':error.errno})
        finally:
            close(remote);remote.close()
            print(json.dumps({'type':'relay.closed','connectionId':connection_id,'elapsedMs':round((time.monotonic()-began)*1000),'failures':failure}),flush=True)
class Server(socketserver.ThreadingMixIn,socketserver.TCPServer):
    allow_reuse_address=True
    daemon_threads=True
    socket_path='/transport/model.sock'
if __name__=='__main__':
    with Server(('127.0.0.1',8091),Relay) as server: server.serve_forever()
