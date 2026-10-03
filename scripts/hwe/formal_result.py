"""Preserve pinned SBY task outcomes without changing formal properties or pass rules."""
import re
import shutil
from pathlib import Path

STATES = {'PASS', 'FAIL', 'ERROR', 'UNKNOWN', 'TIMEOUT'}
# Pinned SBY writes "status retcode total_time" (integer process seconds).
# retcode is zero for an expected result, including an expected FAIL.
RETURN_CODES = {'PASS': 1, 'FAIL': 2, 'UNKNOWN': 4, 'TIMEOUT': 8, 'ERROR': 16}
STATUS_RECORD = re.compile(r'(PASS|FAIL|ERROR|UNKNOWN|TIMEOUT)(?:[ \t]+([0-9]+)[ \t]+([0-9]+))?')
LINE = re.compile(r'^SBY\s+\d+:\d+:\d+ \[([^\]]+)\] (.*)$')
TERMINALS = [
    re.compile(r'^DONE \((PASS|FAIL|ERROR|UNKNOWN|TIMEOUT), rc=(-?\d+)\)$'),
    re.compile(r'^engine_\d+: Status returned by engine: (pass|FAIL|ERROR|UNKNOWN|TIMEOUT)$'),
    re.compile(r'^summary: engine_\d+ \([^)]*\) returned (pass|FAIL|ERROR|UNKNOWN|TIMEOUT)$'),
]


def parse_status_record(text):
    """Accept legacy tokens or the complete pinned record, never arbitrary suffixes."""
    match = STATUS_RECORD.fullmatch(text.strip())
    if not match:
        return None, None, None
    state, code, seconds = match.groups()
    if code is None:
        return state, None, None
    try:
        code, seconds = int(code), int(seconds)
    except ValueError:
        return None, None, None
    if code not in (0, RETURN_CODES[state]):
        return None, None, None
    return state, code, seconds


def verifier_sha256(directory):
    """Hash every local file that defines external verification semantics."""
    import hashlib
    digest = hashlib.sha256()
    for name in ['evaluate.py', 'formal_result.py']:
        data = (Path(directory) / name).read_bytes()
        digest.update(name.encode() + b'\0' + data + b'\0')
    return digest.hexdigest()


def task_outcome(name, status_text, log):
    file_state, file_code, file_seconds = parse_status_record(status_text)
    tool_statuses = []
    if file_state:
        tool_statuses.append(file_state)
    terminal_records = []
    preunsat = property_failed = False
    for line in log.splitlines():
        match = LINE.match(line)
        if not match or match[1] != name:
            continue
        body = match[2]
        for index, pattern in enumerate(TERMINALS):
            terminal = pattern.match(body)
            if terminal and terminal[1].upper() not in tool_statuses:
                tool_statuses.append(terminal[1].upper())
            if terminal and index == 0:
                terminal_records.append({'status': terminal[1], 'return_code': int(terminal[2])})
        if re.match(r'^engine_\d+: ##\s+\d+:\d+:\d+\s+Status: PREUNSAT$', body):
            preunsat = True
        if re.match(r'^engine_\d+: ##\s+\d+:\d+:\d+\s+Assert failed in ', body):
            property_failed = True
    # A reported property failure always survives simultaneous engine/format errors.
    status = ('fail' if 'FAIL' in tool_statuses or property_failed else
              'pass' if preunsat and name.endswith('_ch1') and file_state == 'ERROR' and tool_statuses == ['ERROR'] else
              'error' if 'ERROR' in tool_statuses or 'UNKNOWN' in tool_statuses else
              'timeout' if 'TIMEOUT' in tool_statuses else
              'pass' if 'PASS' in tool_statuses else 'error')
    return {'name': name, 'status': status, 'tool_statuses': tool_statuses,
            'preunsat': preunsat, 'property_failed': property_failed,
            'status_file': status_text, 'status_file_state': file_state,
            'status_file_return_code': file_code, 'status_file_seconds': file_seconds,
            'terminal_records': terminal_records}


def collect_formal_result(raw, checks_dir, evidence_dir, minimum_checks):
    """Use this invocation's .sby manifest and status files; retain all original API fields."""
    outcomes, diagnostics = [], []
    timed_out = raw.get('failed_check') == 'timeout'
    tasks = sorted(Path(checks_dir).glob('*.sby')) if checks_dir else []
    for task in tasks:
        name, job = task.stem, task.with_suffix('')
        destination = Path(evidence_dir) / 'formal' / name
        destination.mkdir(parents=True, exist_ok=True)
        status_text, log = '', ''
        for filename in ['status', 'logfile.txt', 'engine_0/logfile.txt']:
            source = job / filename
            if not source.is_file():
                if filename != 'engine_0/logfile.txt':
                    diagnostics.append(f'Missing formal {name}/{filename}')
                continue
            target = destination / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copyfile(source, target)
            except OSError as error:
                diagnostics.append(f'Cannot archive formal {name}/{filename}: {error}')
            try:
                text = source.read_bytes().decode('utf-8')
            except (OSError, UnicodeError) as error:
                diagnostics.append(f'Cannot parse formal {name}/{filename}: {error}')
                continue
            if filename == 'status':
                status_text = text
            elif filename == 'logfile.txt':
                log = text
        outcome = task_outcome(name, status_text, log)
        if timed_out and not status_text and not outcome['tool_statuses'] and not outcome['property_failed']:
            outcome['status'] = 'timeout'
        outcome['log'] = f'formal/{name}/logfile.txt'
        outcomes.append(outcome)
        file_state = outcome['status_file_state']
        if file_state is None:
            diagnostics.append(f'Missing or unparsed formal status: {name}')
        elif any(state != file_state for state in outcome['tool_statuses']):
            diagnostics.append(f'Conflicting formal status and log: {name}')
        if outcome['status_file_return_code'] is not None and any(
                record['return_code'] != outcome['status_file_return_code'] for record in outcome['terminal_records']):
            diagnostics.append(f'Conflicting formal return code and log: {name}')
    if len(tasks) < minimum_checks:
        diagnostics.append(f'Incomplete formal task manifest: {len(tasks)} (expected >= {minimum_checks})')
    if raw.get('passed') is not True and raw.get('passed') is not False:
        diagnostics.append('Missing formal passed field')
    if raw.get('passed') is False and not isinstance(raw.get('failed_check'), str):
        diagnostics.append('Missing formal failure or interruption identity')
    if raw.get('passed') is True and (len(tasks) != raw.get('checks_passed') or any(o['status'] != 'pass' for o in outcomes)):
        diagnostics.append('Formal PASS tally conflicts with task results')
    if raw.get('failed_check') not in (None, 'timeout') and raw.get('passed') is False and all(o['status'] == 'pass' for o in outcomes):
        diagnostics.append('Formal non-pass tally has no failing or interrupted task result')
    # The workdir may be damaged; an independently reported assertion failure remains evidence.
    if isinstance(raw.get('failed_check'), str) and isinstance(raw.get('detail'), str):
        failure = task_outcome(raw['failed_check'], '', raw['detail'])
        if failure['status'] == 'fail' and not any(o['name'] == failure['name'] for o in outcomes):
            failure['log'] = 'formal.detail (original run_formal output)'
            outcomes.append(failure)
    states = {o['status'] for o in outcomes}
    if timed_out:
        states.add('timeout')
    task_errors = any(o['status'] == 'error' or 'UNKNOWN' in o['tool_statuses'] or
                      ('ERROR' in o['tool_statuses'] and not (o['preunsat'] and o['name'].endswith('_ch1') and o['status'] == 'pass')) for o in outcomes)
    error = bool(diagnostics) or task_errors
    infrastructure_error = error or 'timeout' in states
    status = ('fail' if 'fail' in states else 'error' if error else
              'timeout' if 'timeout' in states else 'pass')
    if timed_out and not task_errors and 'fail' not in states:
        status = 'timeout'
    if timed_out and not outcomes:
        outcomes.append({'name': 'formal', 'status': 'timeout', 'tool_statuses': [], 'preunsat': False})
    return {**raw, 'classification': {'status': status, 'outcomes': outcomes,
            'diagnostics': diagnostics, 'infrastructure_error': infrastructure_error}}


def run_formal_checked(root, target, evidence_dir, runner, minimum_checks):
    cores = Path(root) / 'formal/riscv-formal/cores'
    before = set(cores.glob(target + '-*'))
    raw = runner(str(root), target)
    created = set(cores.glob(target + '-*')) - before
    # Do not use a stale workdir, even if it contains valid PASS files.
    checks = next(iter(created)) / 'checks' if len(created) == 1 else None
    return collect_formal_result(raw, checks, evidence_dir, minimum_checks)
