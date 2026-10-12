import { getChatGPTUser } from '../../../chatgpt-auth';
export async function GET(request: Request) {
  if (!await getChatGPTUser()) return new Response('Unauthorized',{status:401});
  const codes = new URL(request.url).searchParams.get('codes')?.split(',') ?? [];
  if (!codes.length || codes.length > 50 || codes.some(code=>!/^(00|30|60|68)\d{4}$/.test(code))) return new Response('Invalid codes',{status:400});
  try {
    const response=await fetch('https://qt.gtimg.cn/q='+codes.map(code=>(code.startsWith('6')?'sh':'sz')+code).join(','),{signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw Error('Quote source unavailable');
    const text=await response.text();
    const rows=[];
    for(const match of text.matchAll(/v_(?:sh|sz)(\d{6})="([^"]*)"/g)) {
      const fields=match[2].split('~'),stamp=fields[30];
      if(!codes.includes(match[1])||!/^\d{14}$/.test(stamp??''))continue;
      const time=`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12,14)}+08:00`;
      rows.push({f12:match[1],f2:Number(fields[3]),f18:Number(fields[4]),f124:Date.parse(time)/1000});
    }
    return Response.json({data:{diff:rows}},{headers:{'Cache-Control':'no-store'}});
  } catch {return Response.json({message:'腾讯备用行情源暂不可用'},{status:502});}
}
