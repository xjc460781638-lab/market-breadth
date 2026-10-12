import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {boardKindSchema,flowReportSchema} from '../../../../lib/boards';
import {sinaCatalog,sinaCurve} from '../../../../lib/sina-flow';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request) {
  if(!await getChatGPTUser())return reply({message:'请登录'},401);
  const kind=boardKindSchema.safeParse(new URL(request.url).searchParams.get('kind'));
  if(!kind.success)return reply({message:'无效分类'},400);
  try{return reply({boards:await sinaCatalog(kind.data)});}catch{return reply({message:'新浪备用目录暂不可用'},502);}
}
export async function POST(request:Request) {
  if(!await getChatGPTUser())return reply({message:'请登录'},401);
  if(request.headers.get('origin')!==new URL(request.url).origin)return reply({message:'来源无效'},403);
  const kind=boardKindSchema.safeParse(new URL(request.url).searchParams.get('kind'));
  if(!kind.success||!env.DB)return reply({message:'存储或分类不可用'},503);
  let codes:string[];
  try{const text=await request.text();if(text.length>4000)throw Error();codes=JSON.parse(text).codes;if(!Array.isArray(codes)||!codes.length||codes.length>20||codes.some(c=>typeof c!=='string'))throw Error();}catch{return reply({message:'请求格式错误'},400);}
  const day=new Date(Date.now()+28800000).toISOString().slice(0,10);
  let catalog;
  try{catalog=await sinaCatalog(kind.data);}catch{return reply({message:'新浪目录读取失败'},502);}
  const known=new Set(catalog.map(b=>b.code));
  if(codes.some(code=>!known.has(code)))return reply({message:'未知板块'},400);
  const curves=new Map<string,Map<string,number>>();let cursor=0;
  await Promise.all(Array.from({length:5},async()=>{while(cursor<codes.length){const code=codes[cursor++];try{curves.set(code,await sinaCurve(code,day));}catch{/* Preserve explicitly missing curves. */}}}));
  if(!curves.size)return reply({message:'新浪暂无这些板块的当日有效曲线'},502);
  for(let attempt=0;attempt<4;attempt++) {
    const row=await env.DB.prepare('SELECT revision,payload FROM snapshots WHERE id=?').bind(kind.data).first<{revision:string;payload:string}>();
    if(!row)return reply({message:'目录尚未初始化'},503);
    const prior=flowReportSchema.parse(JSON.parse(row.payload));
    const keep=prior.source==='sina'&&prior.asOf.startsWith(day);
    const times=[...new Set([...(keep?prior.times:[]),...[...curves.values()].flatMap(p=>[...p.keys()])])].sort();
    const boards=catalog.map(board=>{
      const old=keep?prior.boards.find(b=>b.code===board.code):undefined;
      const points=new Map<string,number|null>(old?prior.times.map((t,i)=>[t,old.values[i]]):[]);
      for(const [t,v] of curves.get(board.code)??[])points.set(t,v);
      const last=[...points].filter(([,v])=>v!=null).sort(([a],[b])=>a.localeCompare(b)).at(-1);
      return {...board,values:times.map(t=>points.get(t)??null),asOf:last?.[0]??null,net:last?.[1]??null,error:last?null:'备用源尚未提供有效曲线'};
    });
    const report=flowReportSchema.parse({...prior,source:'sina',resolution:'minute',revision:crypto.randomUUID().replaceAll('-','').slice(0,24),collectedAt:new Date().toISOString(),asOf:times.at(-1),times,boards});
    const payload=JSON.stringify(report);
    const saved=await env.DB.prepare('UPDATE snapshots SET revision=?,collected_at=?,payload=? WHERE id=? AND revision=? RETURNING revision').bind(report.revision,report.collectedAt,payload,kind.data,row.revision).first();
    if(!saved)continue;
    await env.DB.prepare(`INSERT INTO snapshots(id,revision,collected_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=excluded.payload WHERE julianday(excluded.collected_at)>julianday(snapshots.collected_at)`).bind(kind.data+':'+day,report.revision,report.collectedAt,payload).run();
    return reply({report,updated:curves.size,failed:codes.length-curves.size});
  }
  return reply({message:'并发更新中，请重试'},409);
}
