/** Bound host checks as well as model execution to the original absolute deadline. */
export async function withinDeadline<T>(deadline:number,signal:AbortSignal|undefined,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const abort=()=>controller.abort(signal?.reason??Error('Operation cancelled'));
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  if(Date.now()>=deadline)controller.abort(Error('Original deadline exceeded'));
  else if(Number.isFinite(deadline))timer=setTimeout(()=>controller.abort(Error('Original deadline exceeded')),Math.min(2147483647,deadline-Date.now()));
  let rejectAbort!:(error:unknown)=>void;
  const stopped=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>rejectAbort(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});
  try{controller.signal.throwIfAborted();return await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return work(controller.signal);}),stopped]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);}
}
