import {queueRefresh} from '../../../../lib/refresh-jobs';
export async function POST(request:Request) {
 return queueRefresh(request,'analytics');
}
