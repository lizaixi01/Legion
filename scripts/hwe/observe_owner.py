"""Read-only samples/audit of one exact owner; never changes containers or credentials."""
import json,pathlib,subprocess,sys,time,datetime
owner,output,stop,seconds=sys.argv[1:5]
def command(args):return subprocess.check_output(args,text=True,timeout=20).strip()
def observe():
    ids=command(['docker','ps','-aq','--filter','label=proactive.owner='+owner]).split()
    containers=json.loads(command(['docker','inspect',*ids])) if ids else []
    rows=[]
    for c in containers:
        rows.append({'id':c['Id'],'name':c['Name'],'state':c['State'],'cpuLimit':c['HostConfig']['NanoCpus'],'memoryLimit':c['HostConfig']['Memory']})
    active=[c['id'] for c in rows if c['state']['Running'] and not c['state']['Paused']]
    stats=[json.loads(x) for x in command(['docker','stats','--no-stream','--format','{{json .}}',*active]).splitlines()] if active else []
    mem=dict(line.replace(':','').split()[:2] for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
    private=[p for p in (pathlib.Path.home()/'.cache').glob('proactive-hwe-*') if (p/'owner').is_file() and (p/'owner').read_text()==owner]
    processes=[]
    for p in pathlib.Path('/proc').iterdir():
        if not p.name.isdigit():continue
        try:
            cmd=(p/'cmdline').read_bytes()
            if any(str(d/'model.sock').encode() in cmd for d in private):processes.append({'pid':int(p.name),'kind':'model_proxy'})
            args=[a.decode(errors='replace') for a in cmd.split(b'\0') if a]
            if any(a.endswith('/bridge.py') for a in args):
                request=pathlib.Path(args[-1])
                if request.is_file() and json.loads(request.read_text()).get('settings',{}).get('owner')==owner:processes.append({'pid':int(p.name),'kind':'hwe_bridge'})
        except (OSError,ValueError):pass
    return {'owner':owner,'containers':rows,'stats':stats,'activeWorkers':sum(c['name'].endswith('-worker') for c in rows if c['id'] in active),'activeVerifiers':sum(c['name'].endswith('-verify') for c in rows if c['id'] in active),'hostMemoryKiB':mem,'hostCpu':pathlib.Path('/proc/stat').read_text().splitlines()[0],'processes':processes,'sockets':[str(p/'model.sock') for p in private if (p/'model.sock').exists()]}
started=time.monotonic()
while True:
    row={'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:row.update(observe())
    except Exception as e:row['error']=str(e)
    with pathlib.Path(output).open('a') as f:f.write(json.dumps(row)+'\n')
    if stop=='audit' or pathlib.Path(stop).exists() or time.monotonic()-started>=float(seconds):break
    time.sleep(5)
