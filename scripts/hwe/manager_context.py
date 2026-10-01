"""Read-only implementation context; never a verifier or an acceptance result."""
import difflib
import hashlib
import io
import json
from pathlib import Path
import tarfile

CONTAINER_CONTEXT = '/manager-context'


def read_rtl_archive(raw):
    """Shared with bridge.load_snapshot: flat regular RTL only, no extraction of tar paths."""
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as archive:
        for member in archive:
            name = member.name
            if (not member.isfile() or not name.endswith('.sv') or
                    any(c in name for c in '/\\:') or any(ord(c) < 32 for c in name) or
                    name in files or member.size > 2 * 1024 * 1024 or len(files) >= 512):
                raise ValueError('Invalid RTL archive: ' + name)
            body = archive.extractfile(member).read()
            if len(body) != member.size:
                raise ValueError('Truncated RTL archive: ' + name)
            files[name] = body
    if not files:
        raise ValueError('Empty RTL archive')
    return files


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_read(folder, name):
    path = folder / name
    if path.is_symlink() or not path.is_file() or path.resolve().parent != folder.resolve():
        raise ValueError('Context input path conflict: ' + name)
    return path.read_bytes()


def prepare_manager_context(payload):
    source, output = Path(payload['input']), Path(payload['output'])
    try:
        metadata = safe_read(source, 'input.json')
        if sha256(metadata) != payload['sha256']:
            raise ValueError('Context metadata hash mismatch')
        data = json.loads(metadata)
        versions = data['versions']
        baseline, best, parent = versions['baseline'], versions['best'], versions['parent']
        if (data['version'] != 1 or baseline['id'] != 'baseline' or baseline['parentId'] is not None or
                not baseline['verified'] or baseline['externalVerification']['status'] != 'pass'):
            raise ValueError('Context baseline identity conflict')
        if best is None:
            if data['bestId'] != 'baseline' or data['parentId'] is not None or parent is not None:
                raise ValueError('Context best identity conflict')
        elif (best['id'] != data['bestId'] or best['id'] == 'baseline' or not best['verified'] or
                best['status'] != 'verified' or best['externalVerification']['status'] != 'pass' or
                best['parentId'] != data['parentId'] or best['id'] == data['parentId'] or
                (parent or baseline)['id'] != data['parentId']):
            raise ValueError('Context candidate/parent identity conflict')
        # Validate every input before producing or mounting any readable material.
        rtl = {}
        for role, version in versions.items():
            if role not in ('baseline', 'best', 'parent'):
                raise ValueError('Unknown context role')
            if version is None:
                continue
            if version['archive'] != role + '.tar.gz':
                raise ValueError('Context archive identity conflict')
            raw = safe_read(source, version['archive'])
            if sha256(raw) != version['sha256']:
                raise ValueError('Context snapshot hash mismatch: ' + version['id'])
            rtl[role] = read_rtl_archive(raw)
        output.mkdir()  # Refuse stale bundles instead of merging versions across decisions.
        files = []

        def put(name, raw):
            path = output / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            files.append({'path': name, 'sha256': sha256(raw), 'bytes': len(raw)})

        def put_json(name, value):
            put(name, json.dumps(value, indent=2).encode())

        for role, version in versions.items():
            if version is None:
                continue
            identity = {k: version[k] for k in ('id', 'sha256', 'parentId', 'status', 'verified')}
            put_json(role + '/version.json', {**identity, 'role': role, 'authority': 'implementation-context-only'})
            for name, raw in sorted(rtl[role].items()):
                put(role + '/rtl/' + name, raw)
            put_json(role + '/external-verification.json', {
                'authority': 'copy-of-existing-independent-verifier-result', **identity,
                'result': version['externalVerification']})
            if version['workerReport'] is not None:
                put(role + '/worker-report.txt', ('Untrusted worker claim; cannot certify acceptance.\n' + version['workerReport']).encode())
        best_dir = 'best' if best else 'baseline'
        parent_dir = 'parent' if parent else 'baseline' if best else None
        diff = []
        if best:
            before, after = rtl[parent_dir], rtl['best']
            for name in sorted(before.keys() | after.keys()):
                chunks = difflib.diff_bytes(difflib.unified_diff,
                    before.get(name, b'').splitlines(keepends=True), after.get(name, b'').splitlines(keepends=True),
                    fromfile=(parent_dir + '/rtl/' + name).encode() if name in before else b'/dev/null',
                    tofile=('best/rtl/' + name).encode() if name in after else b'/dev/null')
                for chunk in chunks:
                    diff.append(chunk if chunk.endswith(b'\n') else chunk + b'\n\\ No newline at end of file\n')
        put('best-vs-parent.diff', b''.join(diff))
        note = ('No candidate changes yet: current best is the original baseline.' if best is None else
                f"Current best {best['id']} derives from {data['parentId']}. Parent status: "
                f"{(parent or baseline)['status']}; externally verified: {(parent or baseline)['verified']}.")
        put('README.txt', (f"Read-only implementation context for round {data['round']}.\n{note}\n"
            f"baseline/rtl = pinned ORIGINAL baseline; {best_dir}/rtl = current best; "
            f"{parent_dir + '/rtl' if parent_dir else 'no parent'} = direct change source.\n"
            "Use version.json for IDs, snapshot hashes and parent IDs. best-vs-parent.diff compares only the direct parent.\n"
            "Source, diff and worker reports explain implementation; none can certify acceptance.\n"
            "external-verification.json copies existing independent results and metrics without issuing new certification.\n"
            "An unverified parent is a change source only; it may still be repaired.\n").encode())
        manifest = {'version': 1, 'authority': 'implementation-context-only', 'round': data['round'],
                    'inputSha256': payload['sha256'], 'bestId': data['bestId'], 'parentId': data['parentId'],
                    'directories': {'baseline': 'baseline/rtl', 'best': best_dir + '/rtl',
                                    'parent': parent_dir + '/rtl' if parent_dir else None},
                    'versions': {role: {k: v[k] for k in ('id', 'sha256', 'parentId', 'status', 'verified')}
                                 for role, v in versions.items() if v is not None}, 'files': sorted(files, key=lambda f: f['path'])}
        put_json('manifest.json', manifest)
        # The saved receipt also hashes the manifest itself; keep it outside the mounted directory.
        receipt = {'containerPath': CONTAINER_CONTEXT, 'manifestSha256': files[-1]['sha256'],
                   'files': files.copy()}
        (output.parent / 'manager-context-receipt.json').write_text(json.dumps(receipt, indent=2))
        return output.resolve()
    except Exception as error:
        (output.parent / 'manager-context-error.json').write_text(json.dumps({
            'status': 'error', 'stage': 'manager-context', 'detail': str(error)}, indent=2))
        raise
