import socket, socketserver, threading
class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        remote=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);remote.connect('/transport/model.sock')
        def copy(source,target):
            try:
                while data:=source.recv(65536): target.sendall(data)
            except OSError: pass
            finally:
                try: target.shutdown(socket.SHUT_WR)
                except OSError: pass
        thread=threading.Thread(target=copy,args=(self.request,remote),daemon=True);thread.start()
        copy(remote,self.request);thread.join();remote.close()
class Server(socketserver.ThreadingMixIn,socketserver.TCPServer):
    allow_reuse_address=True
    daemon_threads=True
with Server(('127.0.0.1',8091),Relay) as server: server.serve_forever()
