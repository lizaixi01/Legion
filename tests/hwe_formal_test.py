"""Portable formal classification tests; no Docker, models, or ignored run directories."""
import importlib.util
import json
import hashlib
from pathlib import Path
import tempfile
import contextlib
import io
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests/fixtures/hwe-formal'
READINESS = json.loads((FIXTURES / 'readiness-105.json').read_text(encoding='utf-8'))
PASS_TASK = next(t for t in READINESS['tasks'] if t['name'] == 'causal_ch0')
PREUNSAT_TASK = next(t for t in READINESS['tasks'] if t['name'] == 'causal_ch1')
spec = importlib.util.spec_from_file_location('formal_result', ROOT / 'scripts/hwe/formal_result.py')
formal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(formal)


class FormalResultTests(unittest.TestCase):
    def collect(self, tasks, raw=None, missing_status=False):
        raw = raw if raw is not None else {'passed': True, 'checks_passed': 50}
        with tempfile.TemporaryDirectory() as tmp:
            checks, out = Path(tmp) / 'checks', Path(tmp) / 'evidence'
            checks.mkdir()
            # Keep the upstream >=50 task floor; use archived PASS for all filler tasks.
            tasks = dict(tasks)
            for i in range(50 - len(tasks)):
                tasks[f'pass_{i}'] = (PASS_TASK['status_file'], PASS_TASK['log'].replace('[causal_ch0]', f'[pass_{i}]'))
            for name, (status, log) in tasks.items():
                (checks / (name + '.sby')).write_text('fixture task')
                job = checks / name
                job.mkdir()
                if not missing_status:
                    (job / 'status').write_bytes(status.encode('utf-8'))
                (job / 'logfile.txt').write_bytes(log.encode('utf-8'))
            result = formal.collect_formal_result(raw, checks, out, 50)
            for key, value in raw.items():
                self.assertEqual(result[key], value)
            for name in tasks:
                self.assertEqual((out / 'formal' / name / 'logfile.txt').read_text(), tasks[name][1])
            return result['classification']

    def test_real_105_task_readiness_formal_replay(self):
        tasks = {t['name']: (t['status_file'], t['log']) for t in READINESS['tasks']}
        result = self.collect(tasks, READINESS['raw'])
        self.assertEqual(result['status'], 'pass')
        self.assertEqual(result['diagnostics'], [])
        self.assertFalse(result['infrastructure_error'])
        self.assertEqual(len(result['outcomes']), 105)
        self.assertEqual(sum(o['status_file_state'] == 'PASS' for o in result['outcomes']), 53)
        self.assertEqual(sum(o['preunsat'] and o['name'].endswith('_ch1') for o in result['outcomes']), 52)
        self.assertFalse(any(o['property_failed'] or 'FAIL' in o['tool_statuses'] for o in result['outcomes']))
        for o in result['outcomes']:
            self.assertEqual(o['status_file'], tasks[o['name']][0])

    def test_real_multifield_status_and_legacy_single_token(self):
        for task in [PASS_TASK, PREUNSAT_TASK]:
            for state in [task['status_file'], task['status_file'].split()[0]]:
                with self.subTest(task=task['name'], state=state):
                    result = self.collect({task['name']: (state, task['log'])})
                    self.assertEqual(result['status'], 'pass')
                    self.assertEqual(result['diagnostics'], [])

    def test_multifield_unwaived_error_unknown_timeout_and_historical_fail(self):
        error_log = '\n'.join(l for l in PREUNSAT_TASK['log'].splitlines() if 'Status: PREUNSAT' not in l)
        fail_log = (FIXTURES / 'reg_ch0.txt').read_text(encoding='utf-8')
        cases = [
            ('causal_ch1', PREUNSAT_TASK['status_file'], error_log, 'error'),
            ('causal_ch0', 'UNKNOWN 4 1\n', '', 'error'),
            ('causal_ch0', 'TIMEOUT 8 1\n', '', 'timeout'),
            # Historical status files were not archived; numeric metadata is a documented injection.
            ('reg_ch0', 'FAIL 0 3\n', fail_log, 'fail'),
        ]
        for name, state, log, expected in cases:
            with self.subTest(state=state):
                result = self.collect({name: (state, log)}, {'passed': False, 'failed_check': name})
                self.assertEqual(result['status'], expected)

    def test_malformed_multifield_status_cannot_be_repaired_by_pass_log(self):
        for state in ['PASS 0', 'PASS 0 2 trailing', 'PASS 0 -2', 'PASS -1 2', 'PASS 16 2',
                      'PASS 0 NaN', 'PASS 0 1.5', 'PASS zero 2', 'PASS 0 2\nERROR 16 1',
                      'PASS\n0 2', 'PASS 0 2\x00', 'PASS 0 2 3']:
            with self.subTest(state=state):
                result = self.collect({'causal_ch0': (state, PASS_TASK['log'])})
                self.assertEqual(result['status'], 'error')
                self.assertTrue(result['diagnostics'])

    def test_conflicting_status_and_log_block_pass_without_erasing_fail(self):
        # Status PASS cannot turn a PREUNSAT/ERROR log into valid evidence.
        for state in [PASS_TASK['status_file'], 'ERROR 16 1\n']:
            log = PREUNSAT_TASK['log'] if state.startswith('PASS') else PREUNSAT_TASK['log'] + 'SBY  7:50:30 [causal_ch1] DONE (UNKNOWN, rc=4)\n'
            result = self.collect({'causal_ch1': (state, log)})
            self.assertEqual(result['status'], 'error')
            self.assertTrue(result['diagnostics'])
        # Corrupted or contradictory metadata must retain the archived assertion failure.
        for state in [PASS_TASK['status_file'], 'FAIL 0 broken\n']:
            result = self.collect({'reg_ch0': (state, (FIXTURES / 'reg_ch0.txt').read_text(encoding='utf-8'))}, {'passed': False, 'failed_check': 'reg_ch0'})
            self.assertEqual(result['status'], 'fail')
            self.assertTrue(result['infrastructure_error'])

    def test_multifield_status_return_code_conflicts_with_terminal_record(self):
        # Both return codes can be emitted by SBY, but not for the same invocation.
        state = PASS_TASK['status_file'].replace('PASS 0 ', 'PASS 1 ')
        result = self.collect({'causal_ch0': (state, PASS_TASK['log'])})
        self.assertEqual(result['status'], 'error')
        self.assertTrue(result['diagnostics'])

    def test_readiness_fixture_matches_recorded_hash(self):
        manifest = json.loads((FIXTURES / 'readiness-source-hashes.json').read_text(encoding='utf-8'))
        self.assertEqual(hashlib.sha256((FIXTURES / 'readiness-105.json').read_bytes()).hexdigest(), manifest['fixture_sha256'])
        for name in ['causal_ch0', 'causal_ch1']:
            self.assertEqual(hashlib.sha256((FIXTURES / f'readiness-{name}.txt').read_bytes()).hexdigest(), manifest['tasks'][name]['logfile.txt']['sha256'])
        for task in READINESS['tasks']:
            self.assertEqual(hashlib.sha256(task['status_file'].encode('utf-8')).hexdigest(), manifest['tasks'][task['name']]['status']['sha256'])

    def test_pass_and_existing_ch1_preunsat_waiver(self):
        result = self.collect({'insn_xori_ch1': ('ERROR', (FIXTURES / 'insn_xori_ch1.txt').read_text())})
        self.assertEqual(result['status'], 'pass')
        ch1 = next(o for o in result['outcomes'] if o['name'] == 'insn_xori_ch1')
        self.assertTrue(ch1['preunsat'])
        self.assertIn('ERROR', ch1['tool_statuses'])
        self.assertFalse(result['infrastructure_error'])

    def test_unwaived_engine_error_and_partial_pass(self):
        log = (FIXTURES / 'insn_xori_ch1.txt').read_text()
        log = '\n'.join(l for l in log.splitlines() if 'Status: PREUNSAT' not in l and 'Assumptions are unsatisfiable!' not in l)
        result = self.collect({'insn_xori_ch1': ('ERROR', log)}, {'passed': False, 'checks_passed': 49, 'checks_failed': 1, 'failed_check': 'insn_xori_ch1'})
        self.assertEqual(result['status'], 'error')
        self.assertTrue(result['infrastructure_error'])

    def test_explicit_fail_is_retained_alongside_engine_fault(self):
        fail = (FIXTURES / 'reg_ch0.txt').read_text()
        error = (FIXTURES / 'insn_xori_ch1.txt').read_text().replace('[insn_xori_ch1]', '[engine_fault_ch0]')
        result = self.collect({'reg_ch0': ('FAIL', fail), 'engine_fault_ch0': ('ERROR', error)}, {'passed': False, 'checks_passed': 48, 'checks_failed': 2, 'failed_check': 'reg_ch0'})
        self.assertEqual(result['status'], 'fail')
        self.assertTrue(result['infrastructure_error'])
        self.assertEqual({o['status'] for o in result['outcomes']}, {'pass', 'fail', 'error'})

    def test_timeout(self):
        result = self.collect({'interrupted': ('TIMEOUT', '')}, {'passed': False, 'failed_check': 'timeout'})
        self.assertEqual(result['status'], 'timeout')

    def test_missing_status_is_error_even_with_pass_log(self):
        result = self.collect({'insn_xori_ch0': ('PASS', (FIXTURES / 'insn_xori_ch0.txt').read_text())}, missing_status=True)
        self.assertEqual(result['status'], 'error')
        self.assertTrue(result['diagnostics'])

    def test_unparsed_status_is_error(self):
        result = self.collect({'broken': ('not a status', '')})
        self.assertEqual(result['status'], 'error')

    def test_no_generated_tasks_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = formal.collect_formal_result({'passed': True, 'checks_passed': 105}, Path(tmp), Path(tmp) / 'out', 50)
            self.assertEqual(result['classification']['status'], 'error')

    def test_status_file_preferred_over_truncated_log(self):
        result = self.collect({'reg_ch0': ('FAIL', '')}, {'passed': False, 'failed_check': 'reg_ch0'})
        self.assertEqual(result['status'], 'fail')

    def test_fail_and_error_in_the_same_task_are_both_retained(self):
        fail = (FIXTURES / 'reg_ch0.txt').read_text()
        error = (FIXTURES / 'insn_xori_ch1.txt').read_text().replace('[insn_xori_ch1]', '[reg_ch0]')
        result = self.collect({'reg_ch0': ('FAIL', fail + error)}, {'passed': False, 'failed_check': 'reg_ch0'})
        self.assertEqual(result['status'], 'fail')
        self.assertTrue(result['infrastructure_error'])

    def test_partial_timeout_stays_timeout_and_preserves_missing_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            checks = Path(tmp) / 'checks'
            checks.mkdir()
            (checks / 'interrupted.sby').write_text('fixture task')
            result = formal.collect_formal_result({'passed': False, 'failed_check': 'timeout'}, checks, Path(tmp) / 'out', 50)['classification']
            self.assertEqual(result['status'], 'timeout')
            self.assertTrue(result['diagnostics'])

    def test_missing_upstream_result_is_error(self):
        # A directory full of PASS files cannot repair an unparseable run_formal return value.
        result = self.collect({}, {'detail': 'no result fields'})
        self.assertEqual(result['status'], 'error')

    def test_stale_workdir_is_not_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'formal/riscv-formal/cores/baseline-123/checks').mkdir(parents=True)
            result = formal.run_formal_checked(root, 'baseline', root / 'out', lambda *_: {'passed': True, 'checks_passed': 50}, 50)
            self.assertEqual(result['classification']['status'], 'error')

    def test_missing_workdir_does_not_erase_assertion_failure_in_raw_output(self):
        raw = json.loads((FIXTURES / 'batch-3.json').read_text())['checks']['formal']
        with tempfile.TemporaryDirectory() as tmp:
            result = formal.collect_formal_result(raw, None, Path(tmp), 50)['classification']
            self.assertEqual(result['status'], 'fail')
            self.assertTrue(result['infrastructure_error'])

    def test_verifier_fingerprint_includes_the_classification_helper(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'evaluate.py').write_text('evaluator')
            (root / 'formal_result.py').write_text('classification v1')
            before = formal.verifier_sha256(root)
            (root / 'formal_result.py').write_text('classification v2')
            self.assertNotEqual(formal.verifier_sha256(root), before)

    def test_evaluate_entrypoint_classifies_real_tool_outputs_and_never_measures_incomplete_formal(self):
        source = (ROOT / 'scripts/hwe/evaluate.py').read_text()
        passed_log = (FIXTURES / 'readiness-causal_ch0.txt').read_text(encoding='utf-8')
        fail_log = (FIXTURES / 'reg_ch0.txt').read_text()
        error_log = '\n'.join(l for l in (FIXTURES / 'insn_xori_ch1.txt').read_text().splitlines() if 'Status: PREUNSAT' not in l and 'Assumptions are unsatisfiable!' not in l)
        for mode, expected in [('pass', 'pass'), ('engine-error', 'error'), ('fail', 'fail'), ('mixed', 'fail'), ('timeout', 'timeout'), ('missing', 'error'), ('unparsed', 'error')]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                commands = []
                raw = {'passed': mode == 'pass', 'checks_passed': 50 if mode == 'pass' else 49, 'checks_failed': 0 if mode == 'pass' else 1, 'failed_check': 'timeout' if mode == 'timeout' else 'reg_ch0'}

                def runner(*_):
                    checks = root / 'formal/riscv-formal/cores/baseline-123/checks'
                    checks.mkdir(parents=True)
                    for i in range(50):
                        name, state, log = (f'pass_{i}', PASS_TASK['status_file'], passed_log.replace('[causal_ch0]', f'[pass_{i}]'))
                        if i == 0:
                            if mode in ('fail', 'mixed'):
                                name, state, log = 'reg_ch0', 'FAIL', fail_log
                            elif mode == 'engine-error':
                                name, state, log = 'insn_xori_ch1', 'ERROR', error_log
                            elif mode == 'timeout':
                                name, state, log = 'interrupted', '', ''
                            elif mode == 'unparsed':
                                state, log = 'invalid status bytes', ''
                        if i == 1 and mode == 'mixed':
                            name, state, log = 'insn_xori_ch1', 'ERROR', error_log
                        (checks / (name + '.sby')).write_text('fixture task')
                        job = checks / name
                        job.mkdir()
                        if not (i == 0 and mode == 'missing'):
                            (job / 'status').write_text(state)
                        (job / 'logfile.txt').write_text(log)
                    return raw

                modules = {name: types.ModuleType(name) for name in ['tools', 'tools.eval', 'tools.eval.formal', 'tools.eval.cosim', 'tools.eval.fpga']}
                modules['formal_result'] = formal
                modules['tools.eval.formal'].run_formal = runner
                modules['tools.eval.formal'].EXPECTED_MIN_CHECKS = 50
                modules['tools.eval.cosim'].run_cosim = lambda *_: {'passed': True, 'elfs_tested': 2}
                modules['tools.eval.fpga']._build_synth_env = lambda *_: {}
                modules['tools.eval.fpga'].run_fpga_eval = lambda *_: {'fitness': 1, 'fmax_mhz': 2, 'lut4': 3, 'cycles': 4}

                def command(args, **_):
                    commands.append(args[0])
                    return types.SimpleNamespace(returncode=0)

                # Only redirect the fixed /work filesystem boundary; execute the actual evaluator flow.
                isolated = source.replace("root=pathlib.Path('/work')", f'root=pathlib.Path({str(root)!r})')
                with patch.dict(sys.modules, modules), patch('subprocess.run', command), contextlib.redirect_stdout(io.StringIO()):
                    exec(compile(isolated, str(ROOT / 'scripts/hwe/evaluate.py'), 'exec'), {})
                result = json.loads((root / 'evidence/result.json').read_text())
                self.assertEqual(result['status'], expected)
                self.assertEqual(result['checks']['formal']['passed'], raw['passed'])
                self.assertEqual('metrics' in result, mode == 'pass')
                self.assertEqual('yosys' in commands, mode == 'pass')


if __name__ == '__main__':
    unittest.main()
