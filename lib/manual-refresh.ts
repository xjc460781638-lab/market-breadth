export async function manualRefresh(url:string,onMessage:(value:string)=>void) {
  const response=await fetch(url,{method:'POST',signal:AbortSignal.timeout(30000)});
  const job=await response.json() as {id?:string;message?:string};
  if(!response.ok||!job.id)throw Error(job.message||'刷新提交失败');
  onMessage(job.message||'正在刷新…');
  for(let i=0;i<300;i++) {
    await new Promise(resolve=>setTimeout(resolve,2000));
    const res=await fetch('/api/refresh-jobs?id='+encodeURIComponent(job.id),{cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw Error('刷新任务状态读取失败，请稍后重新查看');
    const status=await res.json() as {status:string;message:string};
    onMessage(status.message);
    if(status.status==='done'){window.dispatchEvent(new Event('ifind-refreshed'));return;}
    if(status.status==='error')throw Error(status.message);
  }
  throw Error('任务仍在本机运行，请稍后重新查看结果');
}
