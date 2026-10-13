import { getChatGPTUser } from '../../../chatgpt-auth';
export async function POST() {
  if (!await getChatGPTUser()) return Response.json({message:'请登录后查看'}, {status:401});
  return Response.json({message:'旧数据源已移除，等待同花顺 iFinD 采集接入；不会回退至其他数据源'}, {status:503,headers:{'Cache-Control':'no-store'}});
}
export const GET=POST;
