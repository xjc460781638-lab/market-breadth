import {queueRefresh} from '../../../../lib/refresh-jobs';
import {boardKindSchema} from '../../../../lib/boards';
export async function POST(request:Request) {
 const parsed=boardKindSchema.safeParse(new URL(request.url).searchParams.get('kind'));
 if(!parsed.success)return new Response('Invalid kind',{status:400});
 return queueRefresh(request,parsed.data);
}
