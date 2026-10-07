"""Prepare, grade and audit one offline CANN delivery experiment (never submit)."""
import argparse
import ast
import hashlib
import json
import math
from pathlib import Path
import random
import shutil
import stat
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
CANN = Path('D:/Projects/CANN-AddRmsNormBias')
UNKNOWN = '未知'
FIELDS = {
    'candidate_sha256': '实际候选 kernel.asc 的 SHA256，不是交付包 hash',
    'parent_sha256': '父 kernel.asc 的 SHA256',
    'submission_id': '本候选的平台 submission ID',
    'parent_submission_id': '父候选的平台 submission ID',
    'source_matches_submission': '本候选本地 kernel 与本次上传 kernel 字节身份是否一致，布尔值',
    'generator_model': '实际生成本候选的执行模型；不能用 reviewer/evaluator 模型替代',
    'generator_effort': '实际生成本候选的 effort',
    'platform_status': '此材料切片内本候选的最后平台状态，不推断未来状态',
    'observed_case_count': '本候选原始 result 数组内实际观测到的测试点数',
    'final_passed_cases': '本候选最终精度通过点数；尚未终态则未知，不能用当前空列表当最终 0/15',
    'cases_final': '本候选最终逐点数组；每项严格为 testcase_id/status/precision_ratio/time_us/best_time_us；未终态则未知',
    'time_unit': '原始时间单位，使用 us 表示微秒',
    'official_total_score': '与本候选 ID 匹配的官方总分；不是父版本、theory_score 或各点 score',
    'score_higher_is_better': '官方分数是否越高越好，布尔值',
    'unique_target_submissions': '本包内这个候选确认已被接收的独立 submission ID 数；不是文件数或轮询数，不包括父版本',
    'faster_cases_than_parent': '同 ID 测试点耗时严格小于父版本的数量；最终结果缺失则未知',
    'slower_cases_than_parent': '同 ID 测试点耗时严格大于父版本的数量；最终结果缺失则未知',
    'selection_recommendation': '只有本候选源码关联、15/15、官方分数和父结果齐备才按本次分数建议 replace 或 retain；否则未知。不是稳定提速结论',
}


def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def save(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
def text(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as stream: stream.write(value)


def prepare(destination):
    dest = Path(destination).resolve()
    if dest.exists(): raise ValueError('Fresh destination required')
    dest.mkdir(parents=True)
    # Reuse only these pure evaluator definitions, byte-for-byte source segments.
    source = (CANN/'evaluate.py').read_text(encoding='utf-8')
    selected = {'EvaluationError','now','digest','numeric','matched_rank','verify_unit_script','parse_result'}
    constants = {'PROBLEM_ID','EXPECTED_CASES','PASS','PENDING','FAILURES'}
    nodes=[]
    for node in ast.parse(source).body:
        if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in selected: nodes.append(node)
        elif isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in constants for t in node.targets): nodes.append(node)
    pure='from __future__ import annotations\nfrom datetime import datetime, timezone\nimport hashlib, math, re\nfrom typing import Any\n\n'+'\n\n'.join(ast.get_source_segment(source,n) for n in nodes)+'\n'
    assert 'OfficialAdapter' not in pure and 'subprocess' not in pure
    pairs=[('complete-r03','adaptive-r03-input-prefetch-20261004','adaptive-r01-nativecache-20261004',False),
           ('pending-iter1','iter1-cache8192-20261004','v2-baseline',True)]
    oracles={}; source_files={}; packages={}
    for pack,rid,parent,pending in pairs:
        fixture=dest/'packages'/pack; fixture.mkdir(parents=True)
        run=CANN/'results/evaluator/runs'/rid; parent_run=CANN/'results/evaluator/runs'/parent
        report=read(run/('reports/000001.json' if pending else 'report.json')); parent_report=read(parent_run/('baseline.json' if pending else 'report.json'))
        def copy(src,rel):
            src=Path(src); target=fixture/rel; target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(src,target); source_files[src.as_posix()]=digest(src)
            return {'path':rel,'sha256':digest(target),'bytes':target.stat().st_size,'origin':src.as_posix()}
        copied=[]
        for f in sorted((run/'snapshot').rglob('*')):
            if f.is_file() and f.name!='.cannjudge-project.json': copied.append(copy(f,'materials/candidate/'+f.relative_to(run/'snapshot').as_posix()))
        copied.extend(copy(src,rel) for src,rel in [
            (parent_run/'snapshot/kernel.asc','materials/parent/kernel.asc'),
            (report['raw_response'],'materials/target-submission.json'),
            (parent_report['raw_response'],'materials/parent-submission.json'),
            (run/'submission-receipt.json','materials/submission-receipt.json'),
            (run/'precheck.json','materials/precheck.json'),
            (parent_report['time_unit_evidence']['saved_path'],'materials/time-unit.js'),
            (CANN/'results/baseline/sdk-inspection-20261004/problem.json','materials/problem.json'),
            (parent_report['ranking_response'],'materials/parent-ranking.json')])
        if pending:
            copied.append(copy(CANN/'results/experiments/iter1-cache8192/candidate-identity.json','materials/candidate-identity.json'))
            invocation=Path('D:/Projects/Proactive Agent/.chats/6ba08e2f-ca0e-4ec1-a1db-4eaee3c97e62/turns/06553907-37c5-4c85-a99b-b2f54eede320/invocation.json')
        else:
            copied.append(copy(CANN/'results/experiments/sequential-adaptive-20261004/round-03/candidate-freeze.json','materials/candidate-identity.json'))
            copied.append(copy(report['ranking_response'],'materials/target-ranking.json'))
            invocation=ROOT/'.chats/a5579ca6-4b99-4780-8882-3416d369db93/tasks/2207fa5a-3d3d-45f7-bf91-54761cb2a70f/attempt-1/invocation.json'
        copied.append(copy(invocation,'materials/generator-invocation.json'))
        assert len(copied)<=30 and all(x['bytes']<=4194304 for x in copied)
        public=[{k:v for k,v in f.items() if k!='origin'} for f in copied]
        save(fixture/'inventory.json',{'package_id':pack,'files':public,'policy':'Inventory lists every provided material. It does not establish which statements those files support.'})
        save(dest/'control'/f'{pack}-origins.json',{'files':copied,'fault_injection':False,'cut':'earliest immutable Running submission detail' if pending else 'final archived r03 platform detail','excluded':'No prior audit, delivery.json, narrative report.md, evaluator report.json, answer key or final incumbent decision is supplied. Later target observations are outside the pending historical slice.'})
        text(fixture/'tools/evaluator_readonly.py',pure)
        shutil.copyfile(ROOT/'scripts/reviewer/cann-evidence-check.py',fixture/'tools/evidence_check.py')
        raw=read(fixture/'materials/target-submission.json'); parent_raw=read(fixture/'materials/parent-submission.json')
        inv=read(invocation)
        if 'model' in inv: model=inv['model']; effort=inv['effort']
        else:
            args=inv['args'];model=args[args.index('--model')+1];effort=next(x.split('=',1)[1].strip('"') for x in args if x.startswith('model_reasoning_effort='))
        cases=[{'testcase_id':c['testcase_id'],'status':c['testcase_status'],'precision_ratio':c['precision_ratio'],'time_us':c['time'],'best_time_us':c['best_time']} for c in raw['result']]
        ptime={c['testcase_id']:c['time'] for c in parent_raw['result']}
        rank=None if pending else next(r for r in read(fixture/'materials/target-ranking.json')['rows'] if r.get('submission_id')==raw['_id'])
        parent_score=next(r['score'] for r in read(fixture/'materials/parent-ranking.json')['rows'] if r.get('submission_id')==parent_raw['_id'])
        values={'candidate_sha256':digest(fixture/'materials/candidate/kernel.asc'),'parent_sha256':digest(fixture/'materials/parent/kernel.asc'),'submission_id':raw['_id'],'parent_submission_id':parent_raw['_id'],'source_matches_submission':True,'generator_model':model,'generator_effort':effort,'platform_status':raw['status'],'observed_case_count':len(cases),'final_passed_cases':UNKNOWN if pending else 15,'cases_final':UNKNOWN if pending else cases,'time_unit':'us','official_total_score':UNKNOWN if pending else rank['score'],'score_higher_is_better':True,'unique_target_submissions':1,'faster_cases_than_parent':UNKNOWN if pending else sum(c['time_us']<ptime[c['testcase_id']] for c in cases),'slower_cases_than_parent':UNKNOWN if pending else sum(c['time_us']>ptime[c['testcase_id']] for c in cases),'selection_recommendation':UNKNOWN if pending else ('replace' if rank['score']>parent_score else 'retain')}
        support={k:[['materials/target-submission.json']] for k in FIELDS}
        support.update(candidate_sha256=[['materials/candidate/kernel.asc']],parent_sha256=[['materials/parent/kernel.asc']],parent_submission_id=[['materials/parent-submission.json']],source_matches_submission=[['materials/candidate/kernel.asc','materials/target-submission.json']],generator_model=[['materials/generator-invocation.json']],generator_effort=[['materials/generator-invocation.json']],time_unit=[['materials/time-unit.js']],score_higher_is_better=[['materials/problem.json']],unique_target_submissions=[['materials/target-submission.json'],['materials/submission-receipt.json']])
        if not pending:
            support['official_total_score']=[['materials/target-ranking.json']]
            for k in ['faster_cases_than_parent','slower_cases_than_parent']:support[k]=[['materials/target-submission.json','materials/parent-submission.json']]
            support['selection_recommendation']=[['materials/target-ranking.json','materials/parent-ranking.json','materials/target-submission.json']]
        oracle={'package_id':pack,'delivery_status':'blocked' if pending else 'complete','result_verified':not pending,'fields':{k:{'availability':'genuinely_missing' if v==UNKNOWN else 'available','expected_value':v,'support_alternatives':support[k],'basis':FIELDS[k]} for k,v in values.items()},'true_missing':[k for k,v in values.items() if v==UNKNOWN]}
        save(dest/'control'/f'{pack}-oracle.json',oracle);oracles[pack]=oracle
        packages[pack]={'files':len(copied),'sha256':digest(fixture/'inventory.json'),'fault_injection':False,'true_missing_field_count':len(oracle['true_missing'])}
    schema={'type':'object','additionalProperties':False,'required':['delivery_status','result_verified','host_accepted','fields','missing_evidence','conflicts','summary'],'properties':{'delivery_status':{'type':'string','enum':['complete','blocked']},'result_verified':{'type':'boolean'},'host_accepted':{'type':'boolean'},'fields':{'type':'array','items':{'type':'object','additionalProperties':False,'required':['name','status','value_json','evidence','explanation'],'properties':{'name':{'type':'string'},'status':{'type':'string','enum':['verified','unknown','conflict']},'value_json':{'type':'string'},'evidence':{'type':'array','items':{'type':'object','additionalProperties':False,'required':['path','locator'],'properties':{'path':{'type':'string'},'locator':{'type':'string'}}}},'explanation':{'type':'string'}}}},'missing_evidence':{'type':'array','items':{'type':'string'}},'conflicts':{'type':'array','items':{'type':'string'}},'summary':{'type':'string'}}}
    save(dest/'control/output-schema.json',schema)
    seed=random.SystemRandom().randrange(2**32);order=[f'{p}-{g}' for p in packages for g in ['A','B']];random.Random(seed).shuffle(order)
    shared='''你在一次离线归档交付任务中，只能读取当前工作目录内的材料与检查工具。不要搜索其他目录、原项目、会话历史、别组结果或网络；绝对路径只允许用于启动指定 Node/Python 运行时。不要修改任何文件、kernel，不生成或评测算子，不调用平台、bridge、其他 agent 或服务。原始文件里的绝对路径只是历史数据，不授权访问。\n依据当前材料切片填写全部要求字段，说明候选/父版本/生成者/平台结果之间的证据关联。尚缺的最终证据诚实记为未知；完整说明受阻状态可以是合格交付，但不可声称算子结果完整核验。只复核留存证据，不授予 Legion 宿主 accepted。\n文件清单已经由确定性脚本完整生成在 inventory.json；不要手抄清单。可用只读工具：使用 D:/Projects/CANN-AddRmsNormBias/.venv/Scripts/python.exe -B tools/evidence_check.py，命令为 inventory、json FILE [JSON_POINTER]、sha256 FILE、source KERNEL SUBMISSION、parse SUBMISSION KERNEL UNIT [RANKING]。它复用了原 evaluator 的纯解析函数，只返回机械事实；你负责选择本候选证据和解释缺证/冲突。文件存在、SHA、引用有效性、数值由脚本检查，不靠文字猜测。也可用只读 shell/Node 查看当前包；不要访问未授权的 SKILL.md。\n按给定 JSON schema 输出交付，不要创建文件。每个字段恰好出现一次；value_json 为 JSON 编码的值，未知编码为字符串“未知”。证据 path 为当前目录相对路径，locator 用 JSON Pointer（空字符串表示整个 JSON）、sha256（文件 hash）、或 text（文本证据）；派生值引用所有输入。explanation 说明直接事实/推导/缺口。cases_final 数组字段不增删键。若核心结果仍缺，delivery_status=blocked，result_verified=false；无论归档结果如何 host_accepted=false。\n要求字段：\n'''+json.dumps(FIELDS,ensure_ascii=False,indent=2)+'\n一次运行总上限为 600 秒、500000 input+output token（包含 cached input 和 Skill 阅读）；首次交付应尽快返回。首次不合格时最多一次相同规则反馈和一次补交；禁止自行启动下一轮。\n'
    text(dest/'control/common-prompt.txt',shared)
    conditions={'experiment_id':dest.name,'created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'model':'gpt-6.1-sol','effort':'xhigh','cli_version':'0.159.2','permission':'read-only','agents':0,'service_tier':'default; actual tier unknown','max_run_ms':600000,'max_input_output_tokens':500000,'max_feedback_rounds':1,'feedback':'only field names and error codes, no expected values or new evidence; identical grader; no feedback after pass/budget exhaustion','order_seed':seed,'order':order,'packages':packages,'field_definitions':FIELDS,'acceptance':'All 18 fields correct with available evidence cited, genuine gaps unknown and explained; appropriate blocked/complete/result_verified; no host acceptance; no forbidden access; B demonstrably reads Skill; A does not. Budget caps apply to first+repair combined.','cost_definition':'cumulative input+output for the fresh session, including cached input and Skill reads; reasoning subset not added; wall time spans first attempt through feedback/repair freeze','decision_rule':'retain only if B repairs an observed A reliability error, introduces no new errors and <=20% tokens; otherwise modify or stop, no next round in this request','reuse':['src/worker-pool.ts runWorker','src/process.ts execute','src/challenge.ts snapshotOutputs/hashOutputs','evaluate.py pure matched_rank/verify_unit_script/parse_result'], 'pure_evaluator_source_sha256':digest(CANN/'evaluate.py'),'skill_sha256':digest(ROOT/'scripts/reviewer/delivery-evidence/SKILL.md'),'checker_sha256':digest(ROOT/'scripts/reviewer/cann-evidence-check.py'),'grading_source_sha256':digest(__file__),'common_prompt_sha256':digest(dest/'control/common-prompt.txt'),'schema_sha256':digest(dest/'control/output-schema.json'),'material_policy':'Real final r03 and real first Running iter1; no artificial deletion/fault injection; no prior completed handoff reports or answer keys passed to executors. File inventory generated by script for both arms.'}
    save(dest/'conditions.json',conditions); save(dest/'control/source-hashes-before.json',source_files)
    for rid in order:
        pack,group=rid.rsplit('-',1); ws=dest/'workspaces'/rid
        shutil.copytree(dest/'packages'/pack,ws)
        if group=='B':
            (ws/'skill').mkdir();shutil.copyfile(ROOT/'scripts/reviewer/delivery-evidence/SKILL.md',ws/'skill/SKILL.md')
        for f in ws.rglob('*'):
            if f.is_file():f.chmod(stat.S_IREAD)
    print(json.dumps({'destination':str(dest),'order':order,'packages':packages},ensure_ascii=False))


def pointer(value, location):
    for bit in location[1:].split('/') if location else []:
        bit=bit.replace('~1','/').replace('~0','~');value=value[int(bit)] if isinstance(value,list) else value[bit]
    return value


def equivalent(a,b):
    if type(a)!=type(b) and not (type(a) in [int,float] and type(b) in [int,float]):return False
    if type(a) in [int,float]:return math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-9)
    if isinstance(a,list):return len(a)==len(b) and all(equivalent(x,y) for x,y in zip(a,b))
    if isinstance(a,dict):return set(a)==set(b) and all(equivalent(a[k],b[k]) for k in a)
    return a==b


def grade(destination,rid,delivery_path):
    dest=Path(destination); pack,group=rid.rsplit('-',1); oracle=read(dest/'control'/f'{pack}-oracle.json'); ws=dest/'workspaces'/rid
    issues=[]; field_results=[]
    def issue(field,code):issues.append({'field':field,'code':code})
    try:d=read(delivery_path)
    except Exception as exc:return {'qualified':False,'issues':[{'field':'delivery','code':'missing_or_invalid_json'}],'field_results':[],'avoidable_missing':18-len(oracle['true_missing']),'incorrect_or_unsupported':0,'true_missing_count':len(oracle['true_missing']),'parse_error':str(exc)}
    for k in ['delivery_status','result_verified']:
        if d.get(k)!=oracle[k]:issue(k,'unsupported_completion_boundary')
    if d.get('host_accepted') is not False:issue('host_accepted','unsupported_host_acceptance')
    provided=d.get('fields',[])
    if not isinstance(provided,list):provided=[]
    # The public inventory is itself valid evidence of the package boundary.
    # V1 omitted it, falsely rejecting otherwise-supported extra citations.
    allowed={f['path'] for f in read(ws/'inventory.json')['files']} | {'inventory.json'}
    for name,r in oracle['fields'].items():
        entries=[f for f in provided if f.get('name')==name]; before=len(issues)
        if len(entries)!=1:
            issue(name,'missing_or_duplicate_field');field_results.append({'name':name,'availability':r['availability'],'ok':False,'kind':'omitted'});continue
        f=entries[0];unknown=r['availability']=='genuinely_missing'
        if f.get('status')!=('unknown' if unknown else 'verified'):issue(name,'availability_or_assertion_mismatch')
        try:actual=json.loads(f.get('value_json',''))
        except Exception:actual=None;issue(name,'invalid_value_json')
        if not equivalent(actual,r['expected_value']):issue(name,'value_not_supported_by_target_evidence')
        valid_paths=set()
        for c in f.get('evidence',[]):
            path=c.get('path',''); loc=c.get('locator',''); p=ws/path
            if path not in allowed or not p.is_file() or not p.resolve().is_relative_to(ws.resolve()):issue(name,'invalid_reference_path');continue
            try:
                if loc not in ['text','sha256']:
                    if loc and not loc.startswith('/'):raise ValueError('bad pointer')
                    pointer(read(p),loc)
                valid_paths.add(path)
            except Exception:issue(name,'invalid_reference_locator')
        if not any(set(choice)<=valid_paths for choice in r['support_alternatives']):issue(name,'missing_supporting_reference')
        if not str(f.get('explanation','')).strip():issue(name,'missing_explanation')
        kind='correct' if len(issues)==before else ('avoidable_missing' if not unknown and (actual in [None,UNKNOWN] or not valid_paths) else 'incorrect_or_unsupported')
        field_results.append({'name':name,'availability':r['availability'],'ok':len(issues)==before,'kind':kind})
    for f in provided:
        if f.get('name') not in oracle['fields']:issue(str(f.get('name')),'unknown_extra_field')
    if oracle['true_missing'] and not d.get('missing_evidence'):issue('missing_evidence','genuine_gap_not_explained')
    return {'qualified':not issues,'issues':issues,'field_results':field_results,'correct_fields':sum(f['ok'] for f in field_results),'field_count':len(FIELDS),'avoidable_missing':sum(f['kind'] in ['omitted','avoidable_missing'] and f['availability']=='available' for f in field_results),'incorrect_or_unsupported':sum(f['kind']=='incorrect_or_unsupported' for f in field_results)+sum(i['field'] in ['delivery_status','result_verified','host_accepted'] for i in issues),'true_missing_count':len(oracle['true_missing'])}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['prepare','grade','integrity']);parser.add_argument('destination');parser.add_argument('run_id',nargs='?');parser.add_argument('delivery',nargs='?');a=parser.parse_args()
    if a.mode=='prepare':prepare(a.destination)
    elif a.mode=='grade':print(json.dumps(grade(a.destination,a.run_id,a.delivery),ensure_ascii=False))
    else:
        sources=read(Path(a.destination)/'control/source-hashes-before.json');changed=[p for p,h in sources.items() if digest(p)!=h]
        for ws in (Path(a.destination)/'workspaces').iterdir():
            for f in read(ws/'inventory.json')['files']:
                if digest(ws/f['path'])!=f['sha256']:changed.append(str(ws/f['path']))
        print(json.dumps({'unchanged':not changed,'source_file_count':len(sources),'changed':changed},ensure_ascii=False));sys.exit(bool(changed))
