"""Inspect real short Worker artifacts and command evidence without granting a hardware grade."""
import pathlib,sys,json,hashlib,tarfile
from manager_context import read_rtl_archive
from command_audit import is_lint_invocation
root=pathlib.Path(sys.argv[1])
baseline=read_rtl_archive((root/'readiness/baseline.tar.gz').read_bytes())
rows=[]
for concurrency in [2,4]:
    run=root/('worker-'+str(concurrency))
    if not (run/'state.json').exists():continue
    state=json.loads((run/'state.json').read_text())
    for c in state['candidates']:
        directory=run/c['id']
        if not (directory/'submission-origin.json').exists():
            rows.append({'id':c['id'],'incomplete':True});continue
        origin=json.loads((directory/'submission-origin.json').read_text())
        if origin.get('modelCalled') is False:
            rows.append({'id':c['id'],'modelCalled':False,'replayOnly':True,'separateReplayOrigin':origin['replayInput']});continue
        # Provenance stores a Windows host path; audit the corresponding local copy in WSL.
        model_path=directory/'rtl.tar.gz'
        rtl=read_rtl_archive(model_path.read_bytes())
        changed=[name for name in sorted(set(rtl)|set(baseline)) if rtl.get(name)!=baseline.get(name)]
        comment=c['hypothesis']['claim'].split('Append exactly ',1)[1].split(' to alu.sv.',1)[0].encode()
        tiny=(changed==['alu.sv'] and rtl['alu.sv'].startswith(baseline['alu.sv']) and rtl['alu.sv'][len(baseline['alu.sv']):].strip()==comment)
        commands=[]
        for f in directory.glob('worker-*/stdout.jsonl'):
            for line in f.read_text().splitlines():
                try:e=json.loads(line)
                except ValueError:continue
                item=e.get('item',{})
                if e.get('type')=='item.completed' and item.get('type')=='command_execution':
                    commands.append({'command':item.get('command'),'exitCode':item.get('exit_code'),'output':item.get('aggregated_output')})
        lint=[x for x in commands if is_lint_invocation(x['command'])]
        catalog=directory/'model-catalog.json'
        rows.append({'id':c['id'],'changedFiles':changed,'tinyExactCommentOnly':tiny,'modelArchiveSha256':hashlib.sha256(model_path.read_bytes()).hexdigest(),'modelArchiveHashMatches':hashlib.sha256(model_path.read_bytes()).hexdigest()==origin['modelOutput']['sha256'],'independentlyGraded':False,'lintExecutions':lint,'commands':commands,'session':json.loads((directory/'worker-session-result.json').read_text()),'catalogSha256':hashlib.sha256(catalog.read_bytes()).hexdigest(),'candidateQueueSnapshot':c.get('snapshot'),'separateReplayOrigin':origin['replayInput']})
models=[r for r in rows if r.get('modelCalled') is not False]
expected=json.loads((root/'protocol.json').read_text())['maximumWorkerCalls']
result={'workers':rows,'expectedModelWorkers':expected,'allTiny':len(models)==expected and all(r.get('tinyExactCommentOnly') and r.get('modelArchiveHashMatches') for r in models),'allLintOnceAndPass':len(models)==expected and all(len(r.get('lintExecutions',[]))==1 and r['lintExecutions'][0]['exitCode']==0 for r in models),'allCompleted':len(models)==expected and all(r.get('session',{}).get('status')=='completed' for r in models),'catalogsSameBytes':all(r.get('catalogSha256') for r in models) and len({r.get('catalogSha256') for r in models})==1,'hardwareGradeForNewWorkerOutputs':None}
print(json.dumps(result,indent=2))
