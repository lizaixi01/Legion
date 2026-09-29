"""WSL/Docker boundary. Workers export only RTL; evaluators rebuild in fresh containers."""
import pathlib,subprocess,sys,json,hashlib,tarfile,io,os,signal,time,base64,datetime
action,request=sys.argv[1:3];d=json.load(open(request));s=d['settings'];p=d.get('payload',{});root=pathlib.Path(s['root'])
prefix='proactive-hwe-'+hashlib.sha256(str(root).encode()).hexdigest()[:12]
def run(args,**kw):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw)
def docker(*args):return run(['docker',*args])
def clean():
 names=docker('ps','-aq','--filter','label=proactive.owner='+s['owner']).stdout.decode().split()
 if names:docker('rm','-f',*names)
def archive_repo():
 repo=pathlib.Path(s['repository']);buf=io.BytesIO()
 with tarfile.open(fileobj=buf,mode='w') as t:
  for name in ['cores','cores/baseline','tools','test','bench']:
   m=tarfile.TarInfo(name);m.type=tarfile.DIRTYPE;m.mode=0o755;m.uid=m.gid=1000;t.addfile(m)
  names=['Makefile','tools/eval','tools/__init__.py','test/cosim','formal','fpga','bench/programs','cores/baseline/core.yaml','cores/baseline/rtl']
  if action=='native':names+=['tools','schemas','ARCHITECTURE.md','CLAUDE.md','.gitignore','cores/baseline/CORE_PHILOSOPHY.md']
  for name in names:
   def filter(m):
    if any(x in {'.git','__pycache__','obj_dir','generated','experiments','sim_build'} for x in pathlib.PurePosixPath(m.name).parts) or m.name.endswith(('.elf','.pyc')):return None
    m.uid=m.gid=1000;m.uname=m.gname='agent';return m
   t.add(repo/name,arcname=name,filter=filter)
 return buf.getvalue()
def start(name,worker=False):
 args=['run','-d','--name',name,'--label','proactive.run='+prefix,'--label','proactive.owner='+s['owner'],'--network','none','--user','1000:1000','--cpus','2' if worker else '8','--memory','3g' if worker else '10g','--pids-limit','512','--cap-drop','ALL','--security-opt','no-new-privileges','-v',s['oss']+':/opt/oss:ro','-v',s['xpack']+':/opt/xpack:ro','-v',s['scripts']+':/harness:ro']
 if worker:args+=['-v',str(private)+':/transport:ro','-v',str(pathlib.Path(s['codex']).parent)+':/opt/codex-bin:ro']
 if action=='native':
  args[args.index('--cpus')+1]='8';args[args.index('--memory')+1]='10g'
 docker(*args,s['image'],'sleep','infinity');run(['docker','cp','-a','-',name+':/work'],input=archive_repo())
 # Bash substitution is used explicitly; no dependency on /bin/sh dialect.
 docker('exec',name,'bash','-ec','mkdir -p /work/.local-bin; for f in /opt/xpack/bin/riscv-none-elf-*; do n=${f##*/}; ln -sf "$f" "/work/.local-bin/${n/riscv-none-elf/riscv32-unknown-elf}"; done')
def load_snapshot(name,path):
 with tarfile.open(path) as t:
  for m in t:
   parts=pathlib.PurePosixPath(m.name).parts
   if not m.isfile() or len(parts)!=1 or not m.name.endswith('.sv') or m.size>2*1024*1024:raise ValueError('Invalid RTL archive')
 docker('exec',name,'bash','-ec','rm -f /work/cores/baseline/rtl/*.sv')
 buf=io.BytesIO()
 with tarfile.open(path) as src,tarfile.open(fileobj=buf,mode='w') as dst:
  for m in src:m.uid=m.gid=1000;dst.addfile(m,src.extractfile(m))
 run(['docker','cp','-a','-',name+':/work/cores/baseline/rtl'],input=buf.getvalue())
def snapshot(name,dest):
 raw=docker('cp',name+':/work/cores/baseline/rtl/.','-').stdout
 with tarfile.open(fileobj=io.BytesIO(raw)) as src,tarfile.open(dest,'w:gz') as dst:
  for m in src:
   if m.isdir():continue
   if not m.isfile() or len(pathlib.PurePosixPath(m.name).parts)!=1 or not m.name.endswith('.sv') or m.size>2*1024*1024:raise ValueError('Worker exported invalid RTL')
   m.name=pathlib.PurePosixPath(m.name).name
   dst.addfile(m,src.extractfile(m))
def proxy_start():
 private.mkdir(exist_ok=True);(private/'owner').write_text(s['owner']);sock=private/'model.sock';sock.unlink(missing_ok=True)
 env=os.environ.copy();env['HTTP_PROXY']=env['HTTPS_PROXY']=s['egressProxy']
 log=(root/'model-transport.log').open('ab');proc=subprocess.Popen([sys.executable,s['proxyScript'],s['auth'],str(sock)],env=env,stdout=log,stderr=log,start_new_session=True)
 (private/'pid').write_text(str(proc.pid))
 for _ in range(100):
  if sock.exists():break
  if proc.poll() is not None:raise RuntimeError('Model proxy failed')
  time.sleep(.1)
 encode=lambda obj:base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
 token=encode({'alg':'none'})+'.'+encode({'exp':4102444800,'https://api.openai.com/auth':{'chatgpt_account_id':'local-proxy','chatgpt_plan_type':'pro'}})+'.x'
 (private/'auth.json').write_text(json.dumps({'auth_mode':'chatgpt','tokens':{'id_token':token,'access_token':token,'refresh_token':'unused','account_id':'local-proxy'},'last_refresh':datetime.datetime.now(datetime.timezone.utc).isoformat()}))
 return proc
private=pathlib.Path.home()/'.cache'/prefix
def stop_proxy():
 pidfile=private/'pid'
 if pidfile.exists():
  pid=int(pidfile.read_text());cmd=pathlib.Path('/proc')/str(pid)/'cmdline'
  if cmd.exists() and str(private/'model.sock').encode() in cmd.read_bytes():os.kill(pid,signal.SIGTERM)
  pidfile.unlink()
if action=='stop':
 clean()
 for candidate in (pathlib.Path.home()/'.cache').glob('proactive-hwe-*'):
  if (candidate/'owner').is_file() and (candidate/'owner').read_text()==s['owner']:private=candidate;stop_proxy()
 print('{}')
elif action=='baseline':
 with tarfile.open(p['archive'],'w:gz') as t:
  for f in sorted((pathlib.Path(s['repository'])/'cores/baseline/rtl').glob('*.sv')):t.add(f,arcname=f.name)
 print('{}')
elif action=='probe':
 name=prefix+'-probe';start(name);load_snapshot(name,p['archive'])
 try:
  docker('exec',name,'bash','-ec','test -w /work/cores/baseline/rtl/core.sv; test -w /work/cores/baseline; touch /work/REPORT.md')
  snapshot(name,p['output']);print('{}')
 finally:docker('rm','-f',name)
elif action=='verify':
 name=prefix+'-verify';start(name);load_snapshot(name,p['archive'])
 try:
  q=subprocess.run(['docker','exec','-w','/work','-e','PATH=/work/.local-bin:/opt/oss/bin:/opt/xpack/bin:/usr/bin:/bin',name,'/usr/bin/python3','/harness/evaluate.py'],timeout=4200)
  if q.returncode:raise RuntimeError('Evaluator process failed')
 finally:
  cp=subprocess.run(['docker','cp',name+':/work/evidence/.',p['evidence']],capture_output=True)
  docker('rm','-f',name)
elif action=='native':
 s['image']='proactive-hwe-native:local';proc=proxy_start();name=prefix+'-native';start(name,True);load_snapshot(name,p['archive'])
 docker('exec',name,'bash','-ec','mkdir -p /tmp/agent-home; cp /transport/auth.json /tmp/agent-home/auth.json; cp /harness/native-codex.py /work/.local-bin/codex; chmod +x /work/.local-bin/codex; git -C /work init -b main; git -C /work config user.name HWE; git -C /work config user.email hwe@local; git -C /work add .; git -C /work commit -m "Frozen public HWE fixture"')
 docker('exec','-d',name,'/usr/bin/python3','/harness/relay.py')
 args=['docker','exec','-w','/work','-e','PATH=/work/.local-bin:/opt/oss/bin:/opt/xpack/bin:/usr/bin:/bin','-e','CODEX_HOME=/tmp/agent-home','-e','PB_MODEL_TOKEN=local-proxy','-e','AGENT_PROVIDER=codex','-e','CODEX_MODEL='+p['model'],'-e','CODEX_REASONING_EFFORT='+p['effort'],'-e','JOBS=4',name,'/usr/bin/python3','-m','tools.orchestrator','--target','baseline','--iterations',str(p['rounds']),'--tournament-size',str(p['concurrency'])]
 if p.get('probe'):args=args[:args.index('--target')]+['--help']
 try:
  q=subprocess.run(args,timeout=p['seconds']);print(json.dumps({'type':'native.ended','exitCode':q.returncode}),flush=True)
 finally:
  docker('pause',name);snapshot(name,p['output'])
  subprocess.run(['docker','cp',name+':/work/cores/baseline/experiments',p['evidence']],capture_output=True)
  subprocess.run(['docker','cp',name+':/work/cores/baseline/core.yaml',str(root/'native-core.yaml')],capture_output=True)
  trace=subprocess.run(['docker','cp',name+':/tmp/agent-home/sessions/.','-'],capture_output=True)
  if trace.returncode==0:pathlib.Path(p['trace']).write_bytes(trace.stdout)
  docker('rm','-f',name);stop_proxy()
elif action=='worker':
 proc=proxy_start();name=prefix+'-worker';start(name,True);load_snapshot(name,p['archive']);docker('exec',name,'bash','-ec','mkdir -p /tmp/agent-home; cp /transport/auth.json /tmp/agent-home/auth.json')
 docker('exec','-d',name,'/usr/bin/python3','/harness/relay.py')
 if p.get('decisionSchema'):
  schema=json.dumps(p['decisionSchema']).encode();buf=io.BytesIO()
  with tarfile.open(fileobj=buf,mode='w') as t:
   m=tarfile.TarInfo('decision-schema.json');m.size=len(schema);m.uid=m.gid=1000;t.addfile(m,io.BytesIO(schema))
  run(['docker','cp','-a','-',name+':/work'],input=buf.getvalue())
 args=['docker','exec','-i','-w','/work','-e','PATH=/work/.local-bin:/opt/oss/bin:/opt/xpack/bin:/usr/bin:/bin','-e','CODEX_HOME=/tmp/agent-home','-e','PB_MODEL_TOKEN=local-proxy',name,'/opt/codex-bin/codex','exec','--ignore-user-config','--ignore-rules']
 for feature in ['multi_agent','multi_agent_v2','apps','plugins','remote_plugin','skill_search','image_generation','browser_use','computer_use','enable_request_compression']:args+=['--disable',feature]
 args+=['--sandbox','danger-full-access','-c','approval_policy="never"','-c','web_search="disabled"','-c','model_provider="local"','-c','model_providers.local.name="Model-only proxy"','-c','model_providers.local.base_url="http://127.0.0.1:8091/backend-api/codex"','-c','model_providers.local.env_key="PB_MODEL_TOKEN"','-c','model_providers.local.wire_api="responses"','-c','model_reasoning_effort='+json.dumps(p['effort']),'--model',p['model'],'--json','--skip-git-repo-check','-']
 if p.get('decisionSchema'):args[-1:-1]=['--output-schema','/work/decision-schema.json','--output-last-message','/work/decision.json']
 timed=False
 try:
  q=subprocess.run(args,input=p['prompt'].encode(),timeout=p['seconds']);exitcode=q.returncode
 except subprocess.TimeoutExpired:timed=True;exitcode=None
 finally:
  docker('pause',name);snapshot(name,p['output'])
  if p.get('decisionSchema'):
   decision=subprocess.run(['docker','cp',name+':/work/decision.json',p['decisionOutput']],capture_output=True)
  report=subprocess.run(['docker','cp',name+':/work/REPORT.md','-'],capture_output=True)
  if report.returncode==0:
   with tarfile.open(fileobj=io.BytesIO(report.stdout)) as t:
    m=next(iter(t));pathlib.Path(p['report']).write_bytes(t.extractfile(m).read(32000))
  trace=subprocess.run(['docker','cp',name+':/tmp/agent-home/sessions/.','-'],capture_output=True)
  usage=None
  if trace.returncode==0:
   pathlib.Path(p['trace']).write_bytes(trace.stdout)
   with tarfile.open(fileobj=io.BytesIO(trace.stdout)) as sessions:
    for m in sessions:
     if m.isfile() and m.name.endswith('.jsonl'):
      for line in sessions.extractfile(m):
       event=json.loads(line);payload=event.get('payload',{})
       if payload.get('type')=='token_count' and payload.get('info'):usage=payload['info'].get('total_token_usage',usage)
  docker('rm','-f',name);stop_proxy()
 print('\n'+json.dumps({'type':'worker.snapshot','timedOut':timed,'exitCode':exitcode,'usage':usage}),flush=True)
else:raise ValueError(action)
