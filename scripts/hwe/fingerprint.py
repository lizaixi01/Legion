import sys,pathlib,json,hashlib,subprocess
repo,image,oss,xpack=sys.argv[1:];r=pathlib.Path(repo)
def output(args):return subprocess.check_output(args,text=True).strip()
files={str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['cores/baseline/rtl','formal','tools/eval','test/cosim','bench/programs','fpga'] for p in (r/folder).rglob('*') if p.is_file() and '.git' not in p.parts and '__pycache__' not in p.parts}
extra=[r/'Makefile',r/'cores/baseline/core.yaml',pathlib.Path(oss)/'share/manifest.json']
extra += [pathlib.Path(oss)/'libexec'/name for name in ['yosys','nextpnr-himbaechel','verilator_bin','sby','yices-smt2']]
extra += [pathlib.Path(xpack)/'bin'/('riscv-none-elf-'+name) for name in ['gcc','as','ld']]
repo_inputs={r/'Makefile':'repo:Makefile',r/'cores/baseline/core.yaml':'repo:cores/baseline/core.yaml'}
extra_files={repo_inputs.get(p,str(p)):hashlib.sha256(p.read_bytes()).hexdigest() for p in extra}
print(json.dumps({'commit':output(['git','-C',repo,'rev-parse','HEAD']),'riscvFormal':output(['git','-C',repo+'/formal/riscv-formal','rev-parse','HEAD']),'image':output(['docker','image','inspect',image,'--format','{{.Id}}']),'filesSha256':hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest(),'oss':oss,'xpack':xpack,'verifierSha256':hashlib.sha256(pathlib.Path(__file__).with_name('evaluate.py').read_bytes()).hexdigest(),'additionalInputs':extra_files}))
