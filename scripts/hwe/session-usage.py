"""Read final token counters per Codex session; never add cumulative snapshots."""
import tarfile,json,sys
records=[]
with tarfile.open(sys.argv[1]) as archive:
 for member in archive:
  if not member.isfile() or not member.name.endswith('.jsonl'):continue
  usage=None
  for line in archive.extractfile(member):
   try:event=json.loads(line)
   except json.JSONDecodeError:continue
   payload=event.get('payload',{})
   if payload.get('type')=='token_count' and payload.get('info'):
    usage=payload['info'].get('total_token_usage',usage)
  records.append({'session':member.name,'usage':usage})
print(json.dumps(records))
