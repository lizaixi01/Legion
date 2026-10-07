"""Public, read-only facts tool. No answer key, network, submission or delivery logic.

The fixture builder supplies the unchanged pure parsing functions from evaluate.py
as evaluator_readonly.py. This tool never imports its OfficialAdapter or Evaluator.
"""
import hashlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
import evaluator_readonly as evaluator

ROOT = Path.cwd().resolve()


def safe(relative):
    path = ROOT / relative
    if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
        raise ValueError('Only regular files within this workspace are readable')
    if not path.is_file():
        raise ValueError('File missing: ' + relative)
    for parent in path.parents:
        if parent == ROOT:
            break
        if parent.is_symlink():
            raise ValueError('Links are not supported')
    return path


def read(relative):
    return json.loads(safe(relative).read_text(encoding='utf-8-sig'))


def pointer(value, location):
    if not location:
        return value
    if not location.startswith('/'):
        raise ValueError('JSON pointer must start with /')
    for bit in location[1:].split('/'):
        bit = bit.replace('~1', '/').replace('~0', '~')
        value = value[int(bit)] if isinstance(value, list) else value[bit]
    return value


def main(args):
    if args[0] == 'inventory':
        inventory = read('inventory.json')
        checked = []
        for f in inventory['files']:
            data = safe(f['path']).read_bytes()
            checked.append(dict(f, actual_sha256=hashlib.sha256(data).hexdigest(),
                                hash_matches=hashlib.sha256(data).hexdigest() == f['sha256']))
        return {'files': checked}
    if args[0] == 'json':
        return pointer(read(args[1]), args[2] if len(args) > 2 else '')
    if args[0] == 'sha256':
        return {'path': args[1], 'sha256': hashlib.sha256(safe(args[1]).read_bytes()).hexdigest()}
    if args[0] == 'source':
        kernel, raw = safe(args[1]), read(args[2])
        remote = next(f['content'] for f in raw['files'] if f['path'] == 'kernel.asc')
        local_hash = hashlib.sha256(kernel.read_bytes()).hexdigest()
        remote_hash = hashlib.sha256(remote.encode('utf-8')).hexdigest()
        return {'submission_id': raw['_id'], 'local_sha256': local_hash,
                'uploaded_sha256': remote_hash, 'matches': local_hash == remote_hash}
    if args[0] == 'parse':
        # Explicit arguments choose the evidence; this tool does not choose sources.
        raw = read(args[1]); kernel_hash = hashlib.sha256(safe(args[2]).read_bytes()).hexdigest()
        unit_path = safe(args[3]); unit_text = unit_path.read_text(encoding='utf-8-sig')
        unit = {'path': args[3], 'sha256': hashlib.sha256(unit_path.read_bytes()).hexdigest()} if evaluator.verify_unit_script(unit_text) else None
        rank = evaluator.matched_rank(read(args[4]), raw['_id']) if len(args) > 4 else None
        parsed = evaluator.parse_result(raw, raw['_id'], {'kernel_sha256': kernel_hash},
            precheck={'files': [{'path': 'kernel.asc', 'sha256': kernel_hash}]},
            ranking=rank, unit_evidence=unit)
        return {k: parsed[k] for k in ['submission_id','status','valid','outcome','platform_source_verified','observed_cases','passed_cases','case_set_complete','cases','official_total_score','score_evidence','time_unit','missing_evidence']}
    raise ValueError('Commands: inventory; json FILE [POINTER]; sha256 FILE; source KERNEL SUBMISSION; parse SUBMISSION KERNEL UNIT [RANKING]')


if __name__ == '__main__':
    try:
        print(json.dumps(main(sys.argv[1:]), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        sys.exit(1)
