import importlib.util,pathlib,socket,socketserver,tempfile,threading,unittest
spec=importlib.util.spec_from_file_location('relay',pathlib.Path(__file__).resolve().parents[1]/'scripts/hwe/relay.py')
relay=importlib.util.module_from_spec(spec);spec.loader.exec_module(relay)


class RelayTests(unittest.TestCase):
    def test_response_eof_closes_idle_client_and_releases_copy_thread(self):
        with tempfile.TemporaryDirectory() as d:
            sock=str(pathlib.Path(d)/'model.sock')
            class Reply(socketserver.BaseRequestHandler):
                def handle(self):self.request.recv(1024);self.request.sendall(b'finished')
            with socketserver.UnixStreamServer(sock,Reply) as upstream,relay.Server(('127.0.0.1',0),relay.Relay) as downstream:
                downstream.socket_path=sock
                one=threading.Thread(target=upstream.handle_request);two=threading.Thread(target=downstream.handle_request)
                one.start();two.start()
                with socket.create_connection(downstream.server_address,timeout=2) as client:
                    client.sendall(b'request');self.assertEqual(client.recv(1024),b'finished');self.assertEqual(client.recv(1),b'')
                one.join(2);two.join(2);self.assertFalse(one.is_alive());self.assertFalse(two.is_alive())
    def test_missing_socket_closes_client_without_hanging(self):
        with relay.Server(('127.0.0.1',0),relay.Relay) as server:
            server.socket_path='/nonexistent/hwe-runtime.sock'
            thread=threading.Thread(target=server.handle_request);thread.start()
            with socket.create_connection(server.server_address,timeout=2) as client:self.assertEqual(client.recv(1),b'')
            thread.join(2);self.assertFalse(thread.is_alive())


if __name__=='__main__':unittest.main()
