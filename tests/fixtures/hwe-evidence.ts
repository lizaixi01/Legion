import {readFileSync} from 'node:fs';
import type {Evidence} from '../../src/research-loop.js';

export const archivedHwe=():Evidence=>JSON.parse(readFileSync(new URL('./hwe-formal/batch-3.json',import.meta.url),'utf8'));
export const passingHwe=():Evidence=>JSON.parse(readFileSync(new URL('./hwe-formal/pass.json',import.meta.url),'utf8'));
export const formalLog=(name:string)=>readFileSync(new URL(`./hwe-formal/${name}.txt`,import.meta.url),'utf8');
/** Derived fault injection: remove the archived ch1 PREUNSAT waiver, retain real SBY records. */
export function engineErrorHwe():Evidence {
 const e=archivedHwe();
 e.checks.formal={passed:false,failed_check:'insn_xori_ch1',checks_passed:104,checks_failed:1,
  detail:formalLog('insn_xori_ch1').split('\n').filter(l=>!l.includes('Status: PREUNSAT')&&!l.includes('Assumptions are unsatisfiable!')).join('\n')};
 return e;
}
