"""Run pinned public HWE gates outside the worker. No model can edit this copy."""
import json,os,pathlib,subprocess,time,sys,shutil
sys.path.insert(0,'/work')
from tools.eval.formal import run_formal
from tools.eval.cosim import run_cosim
from tools.eval.fpga import run_fpga_eval, _build_synth_env
root=pathlib.Path('/work');out=root/'evidence';out.mkdir(exist_ok=True)
os.environ.update(RTL_DIR='cores/baseline/rtl',CORE_NAME='baseline',OBJ_DIR='cores/baseline/obj_dir',GEN_DIR='cores/baseline/generated',JOBS='4',BENCH_KEEP_FORMAL_WORKDIR='1')
(root/'cores/baseline/generated').mkdir(parents=True,exist_ok=True)
result={'status':'error','checks':{},'limitations':['Bounded riscv-formal with ALTOPS; not a full proof of real M-extension arithmetic.','CoreMark CRC plus small-program ISS cosimulation; not exhaustive workloads.','Frequency is nextpnr timing estimation, not a physical-board measurement.']}
def save():
 (out/'result.json').write_text(json.dumps(result,indent=2))
 print(json.dumps({'type':'verification.progress','stage':next(reversed(result['checks']),'starting'),'checks':list(result['checks'])}),flush=True)
def command(name,args,timeout=600,env=None):
 started=time.monotonic()
 with (out/(name+'.log')).open('w') as log:
  p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,env=env)
 result['checks'][name]={'passed':p.returncode==0,'exitCode':p.returncode,'seconds':round(time.monotonic()-started,2),'detail':(out/(name+'.log')).read_text()[-5000:] if p.returncode else ''};save()
 return p.returncode==0
try:
 if not command('lint',['make','lint','TARGET=baseline']):result['status']='fail'
 elif not command('bench',['make','bench']):result['status']='error'
 elif not command('build',['make','cosim-build','TARGET=baseline']):result['status']='fail'
 else:
  result['checks']['cosim']=run_cosim(str(root),'baseline');save()
  if not result['checks']['cosim']['passed']:result['status']='fail'
  else:
   result['checks']['formal']=run_formal(str(root),'baseline');save()
   if not result['checks']['formal']['passed']:
    why=result['checks']['formal'].get('failed_check');result['status']='error' if why in ['setup','no_checks_generated','too_few_checks_generated'] else 'timeout' if why=='timeout' else 'fail'
   elif not command('synthesis',['yosys','-c','fpga/scripts/synth.tcl'],env=_build_synth_env(root,'baseline')):result['status']='fail'
   else:
    q=run_fpga_eval(str(root),'baseline');result['checks']['fpga']=q
    if q.get('placement_failed') or q.get('bench_failed'):result['status']='fail'
    else:result['metrics']={k:q[k] for k in ['fitness','fmax_mhz','lut4','cycles']};result['status']='pass'
except subprocess.TimeoutExpired as e:result['status']='timeout';result['detail']=str(e)
except Exception as e:result['status']='error';result['detail']=repr(e)
finally:
 for path in (root/'formal').glob('last_run-*.log'):shutil.copyfile(path,out/path.name)
 for path in (root/'cores/baseline/generated').glob('pnr_seed*/nextpnr.log'):shutil.copyfile(path,out/(path.parent.name+'.log'))
 for path in (root/'formal/riscv-formal/cores').glob('baseline-*/checks/*/engine_0/trace*.vcd'):
  if path.stat().st_size<20*1024*1024:shutil.copyfile(path,out/(path.parent.parent.name+'-'+path.name))
 save()
print(json.dumps(result),flush=True)
