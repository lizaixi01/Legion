"""Run Codex until its turn ends, its budget expires or the host cancels.

CLI shutdown can wait on background tools after turn.completed. Allow a short
shutdown grace, then freeze/export/remove the container in the caller. Record
the actual docker-exec exit separately from semantic turn completion.
"""
import json
import pathlib
import queue
import subprocess
import threading
import time


def run_session(args, prompt, seconds, cancel_file=None, grace_seconds=5, emit=print):
    began = time.monotonic()
    cancelled = lambda: cancel_file is not None and pathlib.Path(cancel_file).exists()
    if cancelled():
        return {'status': 'cancelled', 'exitCode': None, 'turnCompleted': False,
                'processExitForced': False, 'durationMs': 0}
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    events = queue.Queue()
    def read():
        try:
            for line in process.stdout:
                emit(line.decode('utf8', errors='replace').rstrip('\n'), flush=True)
                try: events.put(json.loads(line))
                except ValueError: pass
        finally: events.put(None)
    reader = threading.Thread(target=read, daemon=True); reader.start()
    input_error=[]
    def write_input():
        try:process.stdin.write(prompt.encode());process.stdin.close()
        except (BrokenPipeError,OSError) as error:input_error.append(type(error).__name__)
    writer=threading.Thread(target=write_input,daemon=True);writer.start()
    completed_at = None
    terminal_at = None
    failed = False
    forced = False
    reason = None
    def drain_events():
        nonlocal completed_at, terminal_at, failed
        try:
            while True:
                event = events.get_nowait()
                if event and event.get('type') == 'turn.completed':
                    completed_at = completed_at or time.monotonic();terminal_at=terminal_at or completed_at
                if event and event.get('type') == 'turn.failed':
                    failed = True;terminal_at=terminal_at or time.monotonic()
        except queue.Empty: pass
    try:
        while True:
            # Drain output before examining the deadline or process exit. The CLI
            # can emit a terminal event and exit between two polls.
            drain_events()
            if cancelled(): reason = 'cancelled'; break
            code = process.poll()
            if code is not None and not reader.is_alive():
                # The reader may finish after the first drain. Once it has
                # stopped, all terminal events are queued and can be classified.
                drain_events()
                reason = 'completed' if completed_at and not failed else 'error'; break
            if terminal_at and time.monotonic() - terminal_at >= grace_seconds:
                reason = 'error' if failed else 'completed'; break
            if terminal_at is None and time.monotonic() - began >= seconds: reason = 'timeout'; break
            time.sleep(.05)
    finally:
        if process.poll() is None:
            forced = True; process.terminate()
            try: process.wait(timeout=2)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=2)
        reader.join(timeout=2)
        writer.join(timeout=2)
        process.stdout.close()
    return {'status': reason, 'exitCode': process.returncode, 'turnCompleted': completed_at is not None,
            'processExitForced': forced, 'completionMs': None if completed_at is None else round((completed_at - began) * 1000),
            'durationMs': round((time.monotonic() - began) * 1000),'inputErrorType':input_error[0] if input_error else None}
