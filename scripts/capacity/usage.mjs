import {readFile,readdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';
const base=join(process.cwd(),'.capacity'),totals={};
for(const dir of (await readdir(base)).filter(n=>n.startsWith('probe-'))){let waves;try{waves=JSON.parse(await readFile(join(base,dir,'report.json'),'utf8'));}catch{continue;}
for(const r of waves.flatMap(w=>w.results)){const t=totals[r.backend]??={calls:0,unknownUsage:0,reportedInput:0,reportedOutput:0,reportedCached:0};t.calls++;if(!r.usage){t.unknownUsage++;continue;}t.reportedInput+=r.usage.input_tokens??r.usage.inputTokens??0;t.reportedOutput+=r.usage.output_tokens??r.usage.outputTokens??0;t.reportedCached+=r.usage.cached_input_tokens??r.usage.cacheReadTokens??0;}}
await writeFile(join(base,'usage-totals.json'),JSON.stringify(totals,null,2));console.log(totals);
