"""WSL/Docker effects for the first ProgramBench task. No hidden scores in inference."""
import sys, json, os, subprocess, pathlib, hashlib, uuid, time, base64, datetime, signal, tarfile, contextlib, io
ACTION, REQUEST = sys.argv[1:3]
data=json.load(open(REQUEST));S=data['settings'];P=data['payload'];ROOT=pathlib.Path(S['root'])
if S.get('egressProxy'):os.environ['HTTPS_PROXY']=S['egressProxy'];os.environ['HTTP_PROXY']=S['egressProxy']
PREFIX='proactive-pb-'+hashlib.sha256(S['root'].encode()).hexdigest()[:12]
IMAGE='programbench/'+S['instance'].replace('__','_1776_')+':task_cleanroom_v6'
PRIVATE=pathlib.Path.home()/'.cache'/PREFIX

def run(args,**kwargs):
    return subprocess.run(args,check=True,capture_output=True,**kwargs)
def docker(*args,**kwargs):return run(['docker',*args],**kwargs)
def container_name(workspace):return PREFIX+'-'+hashlib.sha256(workspace.encode()).hexdigest()[:10]
def common(name):return ['run','-d','--name',name,'--label','proactive.run='+PREFIX,'--network','none','--user','agent','--cpus','2','--memory','4g','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges']
def cleanup():
    grade_pid=PRIVATE/'grade.pid'
    if grade_pid.exists():
        pid=int(grade_pid.read_text())
        cmdline=pathlib.Path('/proc')/str(pid)/'cmdline'
        if pid!=os.getpid() and cmdline.exists() and S['root'].encode() in cmdline.read_bytes():
            try:os.kill(pid,signal.SIGTERM)
            except ProcessLookupError:pass
        grade_pid.unlink()
    names=docker('ps','-aq','--filter','label=proactive.run='+PREFIX).stdout.decode().split()
    if names:docker('rm','-f',*names)
    pidfile=PRIVATE/'proxy.pid'
    if pidfile.exists():
        pid=int(pidfile.read_text())
        try:
            cmdline=pathlib.Path('/proc')/str(pid)/'cmdline'
            if cmdline.exists() and str(PRIVATE/'model.sock').encode() in cmdline.read_bytes():os.kill(pid,signal.SIGTERM)
        except ProcessLookupError:pass
        pidfile.unlink()

def prepare():
    PRIVATE.mkdir(parents=True,exist_ok=True)
    digest=docker('image','inspect',IMAGE,'--format','{{.Id}}').stdout.decode().strip()
    # Only an allowlisted model endpoint is exposed; credentials remain on the host.
    proxy=open(ROOT/'model-transport.log','wb')
    process=subprocess.Popen([sys.executable,str(pathlib.Path(S['scripts'])/'model_proxy.py'),S['auth'],str(PRIVATE/'model.sock')],stdout=proxy,stderr=proxy,start_new_session=True)
    (PRIVATE/'proxy.pid').write_text(str(process.pid));proxy.close()
    for _ in range(50):
        if (PRIVATE/'model.sock').exists():break
        if process.poll() is not None:raise RuntimeError('Model transport startup failed')
        time.sleep(.1)
    else:raise RuntimeError('Model transport socket unavailable')
    # Placeholder JWT carries no real bearer credential. The host proxy authenticates.
    encode=lambda obj:base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
    token=encode({'alg':'none'})+'.'+encode({'exp':4102444800,'https://api.openai.com/auth':{'chatgpt_account_id':'local-proxy','chatgpt_plan_type':'pro'}})+'.x'
    (PRIVATE/'auth.json').write_text(json.dumps({'auth_mode':'chatgpt','tokens':{'id_token':token,'access_token':token,'refresh_token':'unused','account_id':'local-proxy'},'last_refresh':datetime.datetime.now(datetime.timezone.utc).isoformat()}))
    # Public development cases are fixed before any candidate is started.
    cases=[{'args':[],'stdin':'{"name":"Ada","age":3}\n'}, {'args':[],'stdin':'[1,true,null,"x"]\n'}, {'args':[],'stdin':'{"nested":{"x":1},"empty":[]}\n'}, {'args':['--ungron'],'stdin':'json = {};\njson.a = 1;\n'}]
    (ROOT/'public-cases.json').write_text(json.dumps(cases,indent=2))
    print(json.dumps({'adapter':'programbench-gron-v1','instance':S['instance'],'image':IMAGE,'imageId':digest,'upstreamCommit':run(['git','-C',S['repository'],'rev-parse','HEAD']).stdout.decode().strip(),'codexVersion':run([S['codex'],'--version']).stdout.decode().strip(),'model':S['model'],'effort':S['effort'],'network':'none + model-only Unix socket','publicCasesSha256':hashlib.sha256((ROOT/'public-cases.json').read_bytes()).hexdigest(),'hiddenFeedback':'grade only after selection and worker teardown'}))

def worker():
    name=container_name(P['workspace'])
    if not P.get('sessionId'):
        docker(*common(name),'-v',str(PRIVATE)+':/transport:ro','-v',S['scripts']+':/harness:ro','-v',str(pathlib.Path(S['codex']).parent)+':/opt/codex-bin:ro','--entrypoint','/bin/sh',IMAGE,'-c','sleep infinity')
        docker('exec',name,'sh','-ec','mkdir -p /tmp/reference /tmp/agent-home; mv /workspace/executable /tmp/reference/executable; cp /transport/auth.json /tmp/agent-home/auth.json; test -x /tmp/reference/executable; test -w /workspace; /tmp/reference/executable --help >/dev/null')
        docker('exec','-d',name,'python3','/harness/relay.py')
    prompt=P['prompt']+'\nThe reference program is /tmp/reference/executable (black-box probing only). Inspect the supplied documentation under /workspace. Work in /workspace. Create compile.sh which rebuilds ./executable from your source without internet. Do not copy the reference binary. Keep all source needed for compilation in /workspace. Do not access /transport except model communication. Public development cases: '+(ROOT/'public-cases.json').read_text()
    (pathlib.Path(P['attemptDir'])/'prompt.txt').write_text(prompt)
    args=['docker','exec','-i','-w','/workspace','-e','CODEX_HOME=/tmp/agent-home','-e','PB_MODEL_TOKEN=local-proxy',name,'/opt/codex-bin/codex','exec','--ignore-user-config','--ignore-rules','--disable','multi_agent','--disable','multi_agent_v2','--disable','apps','--disable','plugins','--disable','remote_plugin','--disable','skill_search','--disable','image_generation','--disable','browser_use','--disable','computer_use','--disable','enable_request_compression','--sandbox','danger-full-access','-c','approval_policy="never"','-c','web_search="disabled"','-c','model_provider="local"','-c','model_providers.local.name="Model-only proxy"','-c','model_providers.local.base_url="http://127.0.0.1:8091/backend-api/codex"','-c','model_providers.local.env_key="PB_MODEL_TOKEN"','-c','model_providers.local.wire_api="responses"','-c','model_reasoning_effort='+json.dumps(S['effort'])]
    if P.get('sessionId'):args+=['resume',P['sessionId']]
    args+=['--model',S['model'],'--json','--skip-git-repo-check','-']
    (pathlib.Path(P['attemptDir'])/'invocation.json').write_text(json.dumps({'command':args,'network':'none','container':name}))
    timed_out=False
    try:
        result=subprocess.run(args,input=prompt.encode(),timeout=P['timeoutMs']/1000)
        if result.returncode:raise RuntimeError('Codex process failed: '+str(result.returncode))
    except subprocess.TimeoutExpired:
        timed_out=True
    # Pause before exporting: a timed-out docker exec client does not stop its process.
    docker('pause',name)
    try:
        archive=docker('cp',name+':/workspace/.','-').stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as source, tarfile.open(pathlib.Path(P['workspace'],'submission.tar.gz'),'w:gz') as target:
            for member in source:
                parts=pathlib.PurePosixPath(member.name).parts
                if parts and parts[0] in {'executable','.git'}:continue
                target.addfile(member,source.extractfile(member) if member.isfile() else None)
        trace=docker('cp',name+':/tmp/agent-home/sessions/.','-').stdout
        pathlib.Path(P['attemptDir'],'session-trace.tar').write_bytes(trace)
        usage=None
        with tarfile.open(fileobj=io.BytesIO(trace)) as traces:
            for member in traces:
                if not member.isfile() or not member.name.endswith('.jsonl'):continue
                for line in traces.extractfile(member):
                    event=json.loads(line);payload=event.get('payload',{})
                    if payload.get('type')=='token_count' and payload.get('info'):
                        usage=payload['info'].get('total_token_usage',usage)
        print(json.dumps({'type':'worker.snapshot','timedOut':timed_out,'usage':usage}),flush=True)
    finally:
        if not timed_out:docker('unpause',name)

def check():
    archive=pathlib.Path(P['workspace'])/'submission.tar.gz'
    if not archive.exists():print(json.dumps({'checks':[{'id':'public-behavior','status':'fail','detail':'No source submission archive'}],'artifacts':[]}));return
    # Reject unsafe archive entries before using docker's tar extraction.
    with tarfile.open(archive) as tar:
        for entry in tar:
            if pathlib.PurePosixPath(entry.name).is_absolute() or '..' in pathlib.PurePosixPath(entry.name).parts or not (entry.isfile() or entry.isdir()):raise RuntimeError('Unsafe submission archive entry')
    name=PREFIX+'-check-'+uuid.uuid4().hex[:8]
    docker(*common(name),'--entrypoint','/bin/sh',IMAGE,'-c','sleep infinity')
    status='error';details=[]
    try:
        cases=json.loads((ROOT/'public-cases.json').read_text());expected=[]
        for case in cases:
            r=subprocess.run(['docker','exec','-i','-w','/workspace',name,'./executable',*case['args']],input=case['stdin'].encode(),capture_output=True,timeout=15)
            expected.append((r.returncode,r.stdout,r.stderr))
        # Remove the oracle and all initial files before reconstructing from source.
        docker('exec',name,'python3','-c',"import shutil,pathlib; p=pathlib.Path('/workspace'); [(shutil.rmtree(x) if x.is_dir() and not x.is_symlink() else x.unlink()) for x in p.iterdir()]")
        docker('exec','-i',name,'tar','xzf','-','-C','/workspace',input=archive.read_bytes())
        build=subprocess.run(['docker','exec','-w','/workspace',name,'sh','-c','rm -f ./executable; chmod +x compile.sh && ./compile.sh'],capture_output=True,timeout=100)
        if build.returncode:status='fail';details=['Build failed: '+build.stderr.decode(errors='replace')[-4000:]]
        else:
            status='pass'
            for index,(case,wanted) in enumerate(zip(cases,expected)):
                r=subprocess.run(['docker','exec','-i','-w','/workspace',name,'./executable',*case['args']],input=case['stdin'].encode(),capture_output=True,timeout=15)
                passed=(r.returncode,r.stdout,r.stderr)==wanted
                if not passed:status='fail'
                details.append({'case':index,'passed':passed,'expected':[wanted[0],wanted[1].decode(errors='replace'),wanted[2].decode(errors='replace')],'actual':[r.returncode,r.stdout.decode(errors='replace'),r.stderr.decode(errors='replace')]})
    finally:docker('rm','-f',name)
    print(json.dumps({'checks':[{'id':'public-behavior','status':status,'detail':json.dumps(details)},{'id':'hidden-tests','status':'not_checked','detail':'Unavailable during inference'}],'artifacts':[{'path':'submission.tar.gz','sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}]}))

def grade():
    PRIVATE.mkdir(parents=True,exist_ok=True)
    cleanup()
    # No worker or manager is running when evaluator data becomes available.
    from programbench.submission import benchmark_instances, score_instance
    from programbench.eval.eval_batch import run_eval_batch
    from programbench.constants import DOCKER_RUN_ARGS
    DOCKER_RUN_ARGS.extend(['--label','proactive.run='+PREFIX])
    # Only pip gets the dependency-download proxy. HTTP(S)_PROXY would also
    # redirect the submitted program's loopback requests and corrupt scores.
    if S.get('egressProxy'):
        DOCKER_RUN_ARGS.extend(['-e','PIP_PROXY='+S['egressProxy']])
    (PRIVATE/'grade.pid').write_text(str(os.getpid()))
    with open(ROOT/'official-eval.stdout.log','w') as stdout, open(ROOT/'official-eval.stderr.log','w') as stderr, contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        run_eval_batch(sources=[ROOT/'scoring'],workers=1,branch_workers=1,docker_cpus=2)
    (PRIVATE/'grade.pid').unlink(missing_ok=True)
    path=ROOT/'scoring'/S['instance']/(S['instance']+'.eval.json');raw=json.loads(path.read_text())
    if raw.get('error_code') or raw.get('test_branch_errors') or not raw.get('test_results'):
        raise RuntimeError('Official evaluator did not finish cleanly; inspect saved evaluator evidence')
    score=score_instance(path,benchmark_instances()[S['instance']])
    print(json.dumps({'instance':S['instance'],'score':score,'errorCode':raw.get('error_code'),'branchErrors':raw.get('test_branch_errors'),'warnings':raw.get('warnings'),'evaluationFile':str(path),'scope':'one development task, not benchmark success-rate evidence'}))

try:
    if ACTION=='prepare':prepare()
    elif ACTION=='worker':worker()
    elif ACTION=='check':check()
    elif ACTION=='stop':cleanup();print('{}')
    elif ACTION=='grade':grade()
    else:raise ValueError('Unknown action')
except Exception as error:
    print(type(error).__name__+': '+str(error),file=sys.stderr);sys.exit(1)
