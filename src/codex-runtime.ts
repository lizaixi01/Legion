import {join} from 'node:path';

/** Primary sessions and delegated workers must use the same frozen runtime. */
export function codexRuntime(root:string):string {
 return join(root,'.local/codex-runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
}
