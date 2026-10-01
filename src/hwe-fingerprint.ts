type Json=string|number|boolean|null|Json[]|{[key:string]:Json};
const repositoryKeys=new Set(['repo:Makefile','repo:cores/baseline/core.yaml']);
const legacyRepository=/^(\/[^\\]+)\/\.local\/hwe-bench\/(Makefile|cores\/baseline\/core\.yaml)$/;

function sorted(value:unknown):Json {
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(sorted);
 if(typeof value!=='object'||!value)throw Error('Fingerprint must contain JSON values');
 return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,sorted(v)]));
}

/** Only the two known repository inputs may move. Tool paths and all hashes remain exact. */
function canonical(value:unknown):Json {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid fingerprint');
 const result={...value} as Record<string,unknown>;
 if(Object.hasOwn(result,'additionalInputs')){
  const inputs=result.additionalInputs;if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))throw Error('Invalid inputs');
  const entries=new Map<string,string>(),legacyRoots=new Set<string>();
  for(const [key,hash] of Object.entries(inputs)){
   if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid input hash');
   const match=legacyRepository.exec(key);
   if(match){if(match[1]!.split('/').some(part=>part==='.'||part==='..'))throw Error('Invalid repository path');legacyRoots.add(match[1]!);}
   const normalized=match?'repo:'+match[2]:key;
   if(entries.has(normalized))throw Error('Duplicate input identity');entries.set(normalized,hash);
  }
  if(legacyRoots.size>1)throw Error('Repository inputs refer to different roots');
  if([...entries.keys()].some(key=>repositoryKeys.has(key))&&![...repositoryKeys].every(key=>entries.has(key)))throw Error('Missing repository input');
  result.additionalInputs=Object.fromEntries(entries);
 }
 return sorted(result);
}

export function fingerprintDifferences(expected:unknown,current:unknown):string[] {
 try{
  const before=canonical(expected) as Record<string,Json>,after=canonical(current) as Record<string,Json>;
  return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
 }catch(error){return ['Invalid fingerprint: '+String(error)];}
}

/** Accept content-identical checkout relocation; reject every substantive environment change. */
export function fingerprintMatches(expected:unknown,current:unknown):boolean {
 return fingerprintDifferences(expected,current).length===0;
}
