import io, json, pathlib, sys, tempfile, threading, time, unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/hwe'))
from session_runner import run_session
import session_runner


class SessionTests(unittest.TestCase):
    def test_completion_arriving_between_drain_and_process_exit_is_retained(self):
        ready=threading.Event();threads=[];thread_type=threading.Thread
        class Pipe(io.BytesIO):
            def __next__(self):
                ready.wait(1)
                return super().__next__()
        class Child:
            def __init__(self,*args,**kwargs):
                self.stdin=io.BytesIO();self.stdout=Pipe(b'{"type":"turn.completed"}\n');self.returncode=0
            def poll(self):
                # The first event drain is empty. Finish the reader exactly
                # during the following process-exit check, without sleeps.
                ready.set();threads[0].join(1)
                if threads[0].is_alive():raise AssertionError('Reader did not finish')
                return 0
        def thread(*args,**kwargs):
            result=thread_type(*args,**kwargs);threads.append(result);return result
        with patch.object(session_runner.subprocess,'Popen',Child),patch.object(session_runner.threading,'Thread',thread):
            result=run_session(['fixture'],'fixture',1,emit=lambda *args,**kwargs:None)
        self.assertEqual(result['status'],'completed');self.assertTrue(result['turnCompleted'])
        self.assertEqual(result['exitCode'],0);self.assertFalse(result['processExitForced'])

    def run_code(self,code,seconds=2,**kw):
        lines=[]
        r=run_session([sys.executable,'-u','-c',code],'fixture',seconds,emit=lambda line,**_:lines.append(line),grace_seconds=.15,**kw)
        return r,lines
    def test_natural_completion_and_true_exit(self):
        r,lines=self.run_code('import sys;sys.stdin.read();print(\'{"type":"turn.completed"}\')')
        self.assertEqual(r['status'],'completed');self.assertEqual(r['exitCode'],0);self.assertFalse(r['processExitForced'])
    def test_completed_turn_does_not_wait_for_background_shutdown(self):
        r,_=self.run_code('import time;print(\'{"type":"turn.completed"}\',flush=True);time.sleep(20)',seconds=.4)
        self.assertEqual(r['status'],'completed');self.assertTrue(r['processExitForced']);self.assertNotEqual(r['exitCode'],0)
        self.assertLess(r['durationMs'],1500)
    def test_budget_without_completion_is_timeout(self):
        r,_=self.run_code('import time;print("working",flush=True);time.sleep(20)',seconds=.15)
        self.assertEqual(r['status'],'timeout');self.assertFalse(r['turnCompleted'])
    def test_cancel_has_own_status(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'cancel';timer=threading.Timer(.2,lambda:p.touch());timer.start()
            r,_=self.run_code('import time;time.sleep(20)',cancel_file=p)
            timer.join();self.assertEqual(r['status'],'cancelled');self.assertTrue(r['processExitForced'])
    def test_failed_turn_is_error(self):
        r,_=self.run_code('print(\'{"type":"turn.failed"}\');raise SystemExit(1)')
        self.assertEqual(r['status'],'error');self.assertEqual(r['exitCode'],1)

    def test_failed_turn_with_blocked_shutdown_does_not_become_timeout(self):
        r,_=self.run_code('import time;print(\'{"type":"turn.failed"}\',flush=True);time.sleep(20)',seconds=.4)
        self.assertEqual(r['status'],'error');self.assertTrue(r['processExitForced']);self.assertFalse(r['turnCompleted'])
    def test_exit_zero_without_completed_turn_is_not_success(self):
        r,_=self.run_code('print("incomplete")');self.assertEqual(r['status'],'error')
    def test_cancel_before_start_spends_no_process(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'cancel';p.touch()
            r,_=self.run_code('raise RuntimeError("should not run")',cancel_file=p)
            self.assertEqual(r['status'],'cancelled');self.assertIsNone(r['exitCode'])

    def test_unread_large_stdin_cannot_block_budget_enforcement(self):
        r=run_session([sys.executable,'-c','import time;time.sleep(20)'],'x'*1024*1024,.15,emit=lambda *a,**k:None)
        self.assertEqual(r['status'],'timeout');self.assertLess(r['durationMs'],2000)


if __name__=='__main__':unittest.main()
