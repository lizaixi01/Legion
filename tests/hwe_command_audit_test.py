import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('command_audit',pathlib.Path(__file__).resolve().parents[1]/'scripts/hwe/command_audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
class CommandAuditTests(unittest.TestCase):
    def test_real_lint_commands_are_counted(self):
        for command in ["/bin/bash -lc 'make lint TARGET=baseline'",'make lint TARGET=baseline',"/bin/bash -lc 'cd /work && make lint TARGET=baseline'"]:
            self.assertTrue(audit.is_lint_invocation(command),command)
    def test_report_mentions_are_not_executions(self):
        for command in ["/bin/bash -lc \"python3 - <<'PY'\nprint('Ran make lint TARGET=baseline once')\nPY\"","/bin/bash -lc 'echo \"make lint TARGET=baseline\" > REPORT.md'",'cat REPORT.md',"/bin/bash -lc 'make lint TARGET=other'",'make lint TARGET=baseline\n"']:
            self.assertFalse(audit.is_lint_invocation(command),command)
if __name__=='__main__':unittest.main()
