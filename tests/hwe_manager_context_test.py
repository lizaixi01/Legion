"""Offline bridge fixture: runs real preparation/start code with a recording Docker boundary."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/hwe'))
from manager_context import prepare_manager_context, read_rtl_archive, sha256


def archive(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as out:
        for name, body, kind in entries:
            m = tarfile.TarInfo(name)
            m.type = kind
            m.mtime = 1790613656.0737135  # The bridge's baseline writer emits PAX timestamps.
            m.size = len(body)
            out.addfile(m, io.BytesIO(body))
    return buf.getvalue()


def bridge_definitions(request):
    state = {}
    # Stop before proxy startup: do not spawn even a fixture model process.
    with patch.object(sys, 'argv', ['bridge.py', 'worker', str(request)]), contextlib.redirect_stdout(io.StringIO()):
        source = (ROOT / 'scripts/hwe/bridge.py').read_text()
        definitions = source[:source.index("if action=='stop':")]
        exec(compile(definitions, 'bridge.py', 'exec'), state)
    return state


def bridge_fixture(request):
    """Only fake external effects; inspect files at the exact mount passed to Docker."""
    state = bridge_definitions(request)
    payload = state['p']
    mounted = prepare_manager_context(payload['managerContext'])
    state['manager_context'] = mounted
    received = {}

    def fake_run(args, **kw):
        if args[:2] == ['docker', 'run']:
            mount = args[args.index('--mount') + 1]
            expected = f'type=bind,src={mounted},dst=/manager-context,readonly'
            assert mount == expected, (mount, expected)
            assert '--network' in args and args[args.index('--network') + 1] == 'none'
            assert str(mounted.parent) not in args  # No complete run directory mount.
            for file in mounted.rglob('*'):
                if file.is_file():
                    received[file.relative_to(mounted).as_posix()] = file.read_bytes()
        elif args[:3] == ['docker', 'cp', '-a']:
            # Repository copy is empty; capture the actual baseline workspace import.
            raw = kw['input']
            with tarfile.open(fileobj=io.BytesIO(raw)) as packed:
                for member in packed:
                    if member.isfile():
                        received['workspace/' + member.name] = packed.extractfile(member).read()
        return types.SimpleNamespace(stdout=b'container-id', stderr=b'')

    state['run'] = fake_run
    state['archive_repo'] = lambda: archive([])
    state['start']('offline-manager', True)
    state['load_snapshot']('offline-manager', payload['archive'])
    manifest = json.loads(received['manifest.json'])
    for item in manifest['files']:
        assert sha256(received[item['path']]) == item['sha256']
    receipt = json.loads((mounted.parent / 'manager-context-receipt.json').read_text())
    assert sha256(received['manifest.json']) == receipt['manifestSha256']
    return {'manifest': manifest, 'mount': str(mounted),
            'files': {name: body.decode('utf-8') for name, body in received.items()}}


def docker_fixture(folder):
    """Opt-in offline mount check in the existing image; no proxy, model, solver or evaluator."""
    folder.mkdir()
    payload, data = ManagerContextTests().fixture(folder)
    for role, identity, parent_id, status, body in (
            ('parent', 'broken', 'baseline', 'rejected', b'module core; wire broken; endmodule\n'),
            ('best', 'repair', 'broken', 'verified', b'module core; wire repaired; endmodule\n')):
        raw = archive([('core.sv', body, tarfile.REGTYPE)])
        (Path(payload['input']) / (role + '.tar.gz')).write_bytes(raw)
        data['versions'][role] = {'id': identity, 'sha256': sha256(raw), 'parentId': parent_id,
            'status': status, 'verified': status == 'verified', 'archive': role + '.tar.gz',
            'externalVerification': {'status': 'pass' if status == 'verified' else 'fail'}, 'workerReport': 'Untrusted claim'}
    data.update(bestId='repair', parentId='broken', round=3)
    metadata = json.dumps(data).encode()
    Path(payload['input'], 'input.json').write_bytes(metadata)
    payload['sha256'] = sha256(metadata)
    for name in ('oss', 'xpack', 'scripts', 'codex', 'transport'):
        (folder / name).mkdir()
    settings = {'root': str(folder), 'repository': str(folder), 'owner': 'offline-context-fixture',
                'image': 'proactive-hwe:local', 'codex': str(folder / 'codex/codex'),
                **{name: str(folder / name) for name in ('oss', 'xpack', 'scripts')}}
    request = folder / 'request.json'
    request.write_text(json.dumps({'settings': settings, 'payload': {
        'managerContext': payload, 'archive': str(Path(payload['input'], 'baseline.tar.gz')),
        'decisionSchema': {'fixture': True}}}))
    state = bridge_definitions(request)
    context = prepare_manager_context(payload)
    state['manager_context'], state['private'] = context, folder / 'transport'
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w') as out:
        for name in ('cores', 'cores/baseline', 'cores/baseline/rtl'):
            m = tarfile.TarInfo(name)
            m.type, m.mode, m.uid, m.gid = tarfile.DIRTYPE, 0o755, 1000, 1000
            out.addfile(m)
    state['archive_repo'] = lambda: raw.getvalue()
    container = 'hwe-context-offline-' + uuid.uuid4().hex[:12]
    inspection = '''import errno,hashlib,json,pathlib
p=pathlib.Path('/manager-context'); m=json.loads((p/'manifest.json').read_text())
for f in m['files']: assert hashlib.sha256((p/f['path']).read_bytes()).hexdigest()==f['sha256']
assert m['bestId']=='repair' and m['parentId']=='broken'
assert not m['versions']['parent']['verified'] and m['versions']['parent']['status']=='rejected'
assert b'repaired' in (p/'best/rtl/core.sv').read_bytes()
assert b'broken' in (p/'parent/rtl/core.sv').read_bytes()
assert (p/'baseline/rtl/core.sv').read_bytes()==pathlib.Path('/work/cores/baseline/rtl/core.sv').read_bytes()
try: (p/'best/rtl/core.sv').write_bytes(b'tampered')
except OSError as e: assert e.errno==errno.EROFS
else: raise AssertionError('context was writable')
assert not pathlib.Path('/transport/auth.json').exists()
assert not pathlib.Path('/opt/codex-bin/codex').exists()
print(json.dumps({'bestId':m['bestId'],'parentId':m['parentId'],'manifestFiles':len(m['files']),'readOnlyWriteErrno':errno.EROFS,'workspaceIsOriginalBaseline':True,'modelStarted':False}))'''
    try:
        state['start'](container, True)
        state['load_snapshot'](container, state['p']['archive'])
        result = json.loads(state['docker']('exec', container, '/usr/bin/python3', '-c', inspection).stdout)
        mounts = json.loads(state['docker']('inspect', container).stdout)[0]['Mounts']
        context_mount = next(m for m in mounts if m['Destination'] == '/manager-context')
        assert context_mount['RW'] is False
        result.update(container=container, contextMount=context_mount)
        (folder / 'result.json').write_text(json.dumps(result, indent=2))
        return result
    finally:
        subprocess.run(['docker', 'rm', '-f', container], check=True, capture_output=True)


class ManagerContextTests(unittest.TestCase):
    def test_shared_rtl_reader_rejects_unsafe_archives(self):
        cases = [[], [('nested/core.sv', b'rtl', tarfile.REGTYPE)],
                 [('../core.sv', b'rtl', tarfile.REGTYPE)],
                 [('..\\core.sv', b'rtl', tarfile.REGTYPE)],
                 [('C:core.sv', b'rtl', tarfile.REGTYPE)],
                 [('core.sv', b'', tarfile.SYMTYPE)], [('core.sv', b'', tarfile.LNKTYPE)],
                 [('core.sv', b'a', tarfile.REGTYPE), ('core.sv', b'b', tarfile.REGTYPE)]]
        for entries in cases:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                read_rtl_archive(archive(entries))
        valid = archive([('core.sv', b'module core; endmodule\n', tarfile.REGTYPE)])
        self.assertEqual(read_rtl_archive(valid)['core.sv'], b'module core; endmodule\n')
        with self.assertRaises(tarfile.ReadError):
            read_rtl_archive(b'broken')

    def fixture(self, folder):
        source, dest = folder / 'inputs', folder / 'context'
        source.mkdir()
        raw = archive([('core.sv', b'module core; endmodule\n', tarfile.REGTYPE)])
        (source / 'baseline.tar.gz').write_bytes(raw)
        data = {'version': 1, 'round': 1, 'bestId': 'baseline', 'parentId': None, 'versions': {
            'baseline': {'id': 'baseline', 'sha256': sha256(raw), 'parentId': None,
                         'status': 'verified', 'verified': True, 'archive': 'baseline.tar.gz',
                         'externalVerification': {'status': 'pass', 'metrics': {'fitness': 10}}, 'workerReport': None},
            'best': None, 'parent': None}}
        metadata = json.dumps(data).encode()
        (source / 'input.json').write_bytes(metadata)
        return {'input': str(source), 'output': str(dest), 'sha256': sha256(metadata)}, data

    def test_hash_missing_identity_and_bad_archive_fail_before_proxy(self):
        for fault in ('missing', 'hash', 'identity', 'archive', 'metadata', 'archive-path'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                payload, data = self.fixture(folder)
                source = Path(payload['input'])
                if fault == 'missing':
                    (source / 'baseline.tar.gz').unlink()
                elif fault == 'hash':
                    (source / 'baseline.tar.gz').write_bytes(b'tampered')
                elif fault == 'identity':
                    data['bestId'] = 'other'
                elif fault == 'archive-path':
                    data['versions']['baseline']['archive'] = '../outside.tar.gz'
                elif fault == 'archive':
                    raw = archive([('../core.sv', b'rtl', tarfile.REGTYPE)])
                    (source / 'baseline.tar.gz').write_bytes(raw)
                    data['versions']['baseline']['sha256'] = sha256(raw)
                if fault in ('identity', 'archive', 'archive-path'):
                    metadata = json.dumps(data).encode()
                    (source / 'input.json').write_bytes(metadata)
                    payload['sha256'] = sha256(metadata)
                if fault == 'metadata':
                    (source / 'input.json').write_text('{}')
                request = folder / 'request.json'
                request.write_text(json.dumps({'settings': {'root': str(folder)}, 'payload': {
                    'managerContext': payload, 'decisionSchema': {'fixture': True}}}))
                # Run the actual worker action. Any subprocess (proxy or Docker) is a failure.
                with patch.object(sys, 'argv', ['bridge.py', 'worker', str(request)]), \
                        patch('subprocess.Popen', side_effect=AssertionError('proxy must not start')) as proxy, \
                        patch('subprocess.run', side_effect=AssertionError('Docker must not start')) as docker:
                    with self.assertRaises((ValueError, FileNotFoundError, tarfile.ReadError)):
                        runpy.run_path(str(ROOT / 'scripts/hwe/bridge.py'))
                    proxy.assert_not_called()
                    docker.assert_not_called()
                self.assertFalse(Path(payload['output']).exists())
                self.assertEqual(json.loads((folder / 'manager-context-error.json').read_text())['status'], 'error')

    def test_originals_and_manifest_are_preserved_and_stale_bundle_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload, _ = self.fixture(Path(tmp))
            original = Path(payload['input'], 'baseline.tar.gz').read_bytes()
            context = prepare_manager_context(payload)
            self.assertEqual(Path(payload['input'], 'baseline.tar.gz').read_bytes(), original)
            self.assertEqual((context / 'best-vs-parent.diff').read_bytes(), b'')
            self.assertIn('No candidate changes yet', (context / 'README.txt').read_text())
            with self.assertRaises(FileExistsError):
                prepare_manager_context(payload)

    def test_diff_preserves_added_deleted_files_and_missing_final_newlines(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            payload, data = self.fixture(folder)
            before = [('core.sv', b'module old; endmodule', tarfile.REGTYPE),
                      ('deleted.sv', b'module gone; endmodule\n', tarfile.REGTYPE)]
            after = [('core.sv', b'module new; endmodule', tarfile.REGTYPE),
                     ('added.sv', b'module added; endmodule\n', tarfile.REGTYPE)]
            for role, entries in (('baseline', before), ('best', after)):
                raw = archive(entries)
                Path(payload['input'], role + '.tar.gz').write_bytes(raw)
                data['versions'][role] = {**data['versions']['baseline'],
                    'id': 'baseline' if role == 'baseline' else 'best',
                    'parentId': None if role == 'baseline' else 'baseline',
                    'archive': role + '.tar.gz', 'sha256': sha256(raw)}
            data.update(bestId='best', parentId='baseline')
            metadata = json.dumps(data).encode()
            Path(payload['input'], 'input.json').write_bytes(metadata)
            payload['sha256'] = sha256(metadata)
            context = prepare_manager_context(payload)
            diff = (context / 'best-vs-parent.diff').read_bytes()
            self.assertIn(b'--- /dev/null\n+++ best/rtl/added.sv\n', diff)
            self.assertIn(b'--- baseline/rtl/deleted.sv\n+++ /dev/null\n', diff)
            self.assertIn(b'-module old; endmodule\n\\ No newline at end of file\n', diff)
            self.assertIn(b'+module new; endmodule\n\\ No newline at end of file\n', diff)
            self.assertEqual((context / 'best/rtl/core.sv').read_bytes(), after[0][1])


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--bridge-fixture':
        print(json.dumps(bridge_fixture(Path(sys.argv[2]))))
    elif len(sys.argv) == 3 and sys.argv[1] == '--docker-fixture':
        print(json.dumps(docker_fixture(Path(sys.argv[2]))))
    else:
        unittest.main()
