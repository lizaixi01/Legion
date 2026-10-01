/** Convert a host drive path without importing an evaluation runner. */
export function linuxPath(path:string){const match=/^([A-Za-z]):[\\/](.*)$/.exec(path);return match?'/mnt/'+match[1]!.toLowerCase()+'/'+match[2]!.replaceAll('\\','/'):path;}
