import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { getPrismaClient } from '@personal-schedule/database';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config } from '../../src/config.js';
import { createDeadlineReminders } from '../../src/jobs/worker-loop.js';

// This suite persists only in the dedicated test DB; never touch a real student's records.
const enabled = new URL(process.env.DATABASE_URL || 'postgres://localhost/unset').pathname.endsWith('_test');
describe.skipIf(!enabled)('API with real PostgreSQL', () => {
  let server:Server, base:string, cookieA:string, cookieB:string;
  let taskId:string, proposalId:string, userAId:string, userBId:string;
  const from = new Date(Date.now()+86_400_000), to = new Date(Date.now()+3*86_400_000);
  const request = (path:string, method='GET', data?:unknown, cookie=cookieA, origin=config.webOrigin) => fetch(`${base}/api/v1${path}`,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  beforeAll(async()=>{
    server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',r));
    base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const a=await request('/auth/demo','POST',{},''); expect(a.status).toBe(201); cookieA=a.headers.get('set-cookie')!.split(';')[0]; userAId=(await a.json()).user.id;
    const b=await request('/auth/demo','POST',{},''); expect(b.status).toBe(201); cookieB=b.headers.get('set-cookie')!.split(';')[0]; userBId=(await b.json()).user.id;
  },30000);
  afterAll(async()=>{ await new Promise<void>((r,e)=>server.close(x=>x?e(x):r())); await getPrismaClient().$disconnect(); });
  it('requires login, hides secrets and rejects foreign origins',async()=>{
    expect((await request('/auth/me','GET',undefined,'')).status).toBe(401);
    const meResponse=await request('/auth/me');
    expect(meResponse.headers.get('cache-control')).toContain('no-store');
    const me=await meResponse.json(); expect(me.user).not.toHaveProperty('passwordHash');
    expect((await request('/bootstrap')).headers.get('cache-control')).toContain('no-store');
    expect((await request('/tasks','POST',{},cookieA,'https://untrusted.example')).status).toBe(403);
  });
  it('keeps provider sync cursors private while exposing safe UED term controls',async()=>{
    const prisma=getPrismaClient();
    await prisma.integration.createMany({data:[
      {userId:userAId,provider:'OUTLOOK',status:'CONNECTED',encryptedSecret:'test-only',cursor:{nextLink:'https://graph.example/private-token',completedThrough:'2026-09-14T00:00:00.000Z'}},
      {userId:userAId,provider:'UED',status:'CONNECTED',encryptedSecret:'test-only',cursor:{mappedPages:['private-worker-detail'],uedTimetableBaselineTerms:['2026:1'],uedTermMode:'CURRENT',uedTerm:{academicYear:2026,semester:1},uedTermChoices:{academicYears:[{value:2026,label:'2026–2027'}],semesters:[{value:1,label:'HK 1'}],selected:{academicYear:2026,semester:1}}}},
    ]});
    const state=await (await request('/bootstrap')).json();
    const outlook=state.integrations.find((item:{provider:string})=>item.provider==='OUTLOOK');
    const ued=state.integrations.find((item:{provider:string})=>item.provider==='UED');
    expect(outlook).not.toHaveProperty('cursor');
    expect(ued.cursor).toEqual({uedTermMode:'CURRENT',uedTerm:{academicYear:2026,semester:1},uedTermChoices:{academicYears:[{value:2026,label:'2026–2027'}],semesters:[{value:1,label:'HK 1'}],selected:{academicYear:2026,semester:1}}});
    expect(JSON.stringify(state.integrations)).not.toContain('private-token');
    expect(JSON.stringify(state.integrations)).not.toContain('private-worker-detail');
    expect(JSON.stringify(state.integrations)).not.toContain('uedTimetableBaselineTerms');
  });
  it('validates tasks and isolates students',async()=>{
    expect((await request('/tasks','POST',{title:''})).status).toBe(400);
    const r=await request('/tasks','POST',{title:'Integration test work',durationMinutes:60,deadline:to.toISOString(),priority:'HIGH'});
    expect(r.status).toBe(201); taskId=(await r.json()).id;
    expect((await request(`/tasks/${taskId}`,'PATCH',{title:'hijacked'},cookieB)).status).toBe(404);
  });
  it('creates a proposal without changing accepted blocks',async()=>{
    const r=await request('/scheduling/proposals','POST',{fromDate:from.toISOString(),toDate:to.toISOString()});
    expect(r.status).toBe(201); const body=await r.json(); proposalId=body.id;
    expect(body.payload.blocks.length).toBeGreaterThan(0);
    const state=await (await request(`/bootstrap?fromDate=${from.toISOString()}&toDate=${to.toISOString()}`)).json();
    expect(state.blocks).toHaveLength(0);
    expect(state.tasks.find((t:{id:string})=>t.id===taskId).isScheduled).toBe(false);
  });
  it('atomically accepts once even under duplicate concurrent requests',async()=>{
    const responses=await Promise.all([request(`/suggestions/${proposalId}/accept`,'POST',{}),request(`/suggestions/${proposalId}/accept`,'POST',{})]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    const state=await (await request(`/bootstrap?fromDate=${from.toISOString()}&toDate=${to.toISOString()}`)).json();
    expect(state.tasks.find((t:{id:string})=>t.id===taskId).isScheduled).toBe(true);
    expect(state.blocks.filter((b:{taskId:string})=>b.taskId===taskId).reduce((n:number,b:{startTime:string,endTime:string})=>n+(Date.parse(b.endTime)-Date.parse(b.startTime))/60000,0)).toBe(60);
    const first=state.blocks[0];
    expect((await request('/events','POST',{title:'Overlap',startTime:first.startTime,endTime:first.endTime})).status).toBe(409);
  });
  it('expires a proposal when the underlying schedule changes',async()=>{
    await request(`/tasks/${taskId}/unschedule`,'POST',{});
    const p=await (await request('/scheduling/proposals','POST',{fromDate:from.toISOString(),toDate:to.toISOString()})).json();
    await request(`/tasks/${taskId}`,'PATCH',{title:'Changed work'});
    expect((await request(`/suggestions/${p.id}/accept`,'POST',{})).status).toBe(409);
  });
  it('plans an unscheduled in-progress task and preserves its status when accepted',async()=>{
    const created=await request('/tasks','POST',{title:'Continue in-progress work',durationMinutes:30,deadline:to.toISOString(),priority:'HIGH'},cookieB);
    expect(created.status).toBe(201);
    const activeTask=await created.json();
    expect((await request(`/tasks/${activeTask.id}/status`,'PATCH',{status:'IN_PROGRESS'},cookieB)).status).toBe(200);

    const proposed=await request('/scheduling/proposals','POST',{fromDate:from.toISOString(),toDate:to.toISOString()},cookieB);
    expect(proposed.status).toBe(201);
    const proposal=await proposed.json();
    expect(proposal.payload.blocks.some((block:{taskId:string})=>block.taskId===activeTask.id)).toBe(true);
    expect((await request(`/suggestions/${proposal.id}/accept`,'POST',{},cookieB)).status).toBe(200);

    const state=await (await request(`/bootstrap?fromDate=${from.toISOString()}&toDate=${to.toISOString()}`,'GET',undefined,cookieB)).json();
    expect(state.tasks.find((task:{id:string})=>task.id===activeTask.id)).toMatchObject({status:'IN_PROGRESS',isScheduled:true});
  });
  it('removes future sessions without resetting in-progress work to to-do',async()=>{
    const created=await request('/tasks','POST',{title:'Keep progress while unscheduling',durationMinutes:30,deadline:to.toISOString(),priority:'MEDIUM'},cookieB);
    const activeTask=await created.json();
    await request(`/tasks/${activeTask.id}/status`,'PATCH',{status:'IN_PROGRESS'},cookieB);
    await getPrismaClient().taskScheduleBlock.create({data:{userId:userBId,taskId:activeTask.id,startTime:from,endTime:new Date(+from+30*60_000),status:'SCHEDULED',origin:'AUTO'}});
    await getPrismaClient().task.update({where:{id:activeTask.id},data:{isScheduled:true}});

    const response=await request(`/tasks/${activeTask.id}/unschedule`,'POST',{},cookieB);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status:'IN_PROGRESS',isScheduled:false});
    expect(await getPrismaClient().taskScheduleBlock.count({where:{taskId:activeTask.id,status:'SCHEDULED'}})).toBe(0);
  });
  it('keeps the elapsed part of a current session in history when work stops',async()=>{
    const prisma=getPrismaClient();
    const created=await request('/tasks','POST',{title:'Current focus history',durationMinutes:60,deadline:to.toISOString(),priority:'MEDIUM'},cookieB);
    const activeTask=await created.json();
    const originalEnd=new Date(Date.now()+30*60_000);
    const currentBlock=await prisma.taskScheduleBlock.create({data:{userId:userBId,taskId:activeTask.id,
      startTime:new Date(Date.now()-30*60_000),endTime:originalEnd,status:'SCHEDULED',origin:'AUTO'}});
    const futureBlock=await prisma.taskScheduleBlock.create({data:{userId:userBId,taskId:activeTask.id,
      startTime:from,endTime:new Date(+from+30*60_000),status:'SCHEDULED',origin:'AUTO'}});
    await prisma.task.update({where:{id:activeTask.id},data:{isScheduled:true}});

    const before=Date.now();
    expect((await request(`/tasks/${activeTask.id}/status`,'PATCH',{status:'COMPLETED'},cookieB)).status).toBe(200);
    const after=Date.now();
    const [elapsed,future]=await Promise.all([
      prisma.taskScheduleBlock.findUniqueOrThrow({where:{id:currentBlock.id}}),
      prisma.taskScheduleBlock.findUniqueOrThrow({where:{id:futureBlock.id}}),
    ]);
    expect(elapsed.status).toBe('COMPLETED');
    expect(+elapsed.endTime).toBeGreaterThanOrEqual(before);
    expect(+elapsed.endTime).toBeLessThanOrEqual(after);
    expect(+elapsed.endTime).toBeLessThan(+originalEnd);
    expect(future.status).toBe('CANCELLED');
  });
  it('keeps completed sessions as history while a reopened task can be edited and planned again',async()=>{
    const prisma=getPrismaClient();
    const reopenedTask=await prisma.task.create({data:{userId:userBId,title:'Reopened historical work',durationMinutes:30,
      deadline:to,priority:'MEDIUM',status:'COMPLETED',isScheduled:false,completedAt:new Date()}});
    const historicalEnd=new Date(Date.now()-30*60_000), historicalStart=new Date(+historicalEnd-30*60_000);
    const historicalBlock=await prisma.taskScheduleBlock.create({data:{userId:userBId,taskId:reopenedTask.id,
      startTime:historicalStart,endTime:historicalEnd,status:'COMPLETED',origin:'AUTO'}});

    const reopened=await request(`/tasks/${reopenedTask.id}/status`,'PATCH',{status:'PENDING'},cookieB);
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({status:'PENDING',isScheduled:false,completedAt:null});
    const edited=await request(`/tasks/${reopenedTask.id}`,'PATCH',{durationMinutes:45},cookieB);
    expect(edited.status).toBe(200);

    const proposed=await request('/scheduling/proposals','POST',{fromDate:from.toISOString(),toDate:to.toISOString()},cookieB);
    expect(proposed.status).toBe(201);
    const proposal=await proposed.json();
    const newPieces=proposal.payload.blocks.filter((block:{taskId:string})=>block.taskId===reopenedTask.id);
    expect(newPieces.reduce((total:number,block:{startTime:string,endTime:string})=>total+
      (Date.parse(block.endTime)-Date.parse(block.startTime))/60_000,0)).toBe(45);
    expect((await request(`/suggestions/${proposal.id}/accept`,'POST',{},cookieB)).status).toBe(200);

    expect(await prisma.taskScheduleBlock.findUnique({where:{id:historicalBlock.id}})).toMatchObject({status:'COMPLETED'});
    expect(await prisma.task.findUnique({where:{id:reopenedTask.id}})).toMatchObject({status:'PENDING',isScheduled:true});
  });
  it('creates every eligible deadline reminder without first-page starvation',async()=>{
    const prisma=getPrismaClient();
    const deadline=new Date(Date.now()+12*3_600_000);
    const marker=`Reminder batch ${randomUUID()}`;
    const rows=Array.from({length:501},(_,index)=>({userId:userAId,title:`${marker} ${index}`,
      durationMinutes:30,deadline,priority:'LOW' as const,status:'PENDING' as const}));
    await prisma.task.createMany({data:rows});

    const inserted=await createDeadlineReminders();
    expect(inserted).toBeGreaterThanOrEqual(501);
    const tasks=await prisma.task.findMany({where:{userId:userAId,title:{startsWith:marker}},select:{id:true}});
    const keys=tasks.map(task=>`deadline:${task.id}:${deadline.toISOString()}`);
    expect(await prisma.notification.count({where:{userId:userAId,dedupeKey:{in:keys}}})).toBe(501);
    expect(await createDeadlineReminders()).toBe(0);
    const state=await (await request('/bootstrap')).json();
    expect(state.tasks.filter((task:{title:string})=>task.title.startsWith(marker))).toHaveLength(501);
    expect(state.taskHistoryPage).not.toHaveProperty('activeTruncated');
    const additional=await request('/tasks','POST',{title:'Active work remains uncapped',durationMinutes:30,deadline,priority:'LOW'});
    expect(additional.status).toBe(201);
    await prisma.task.delete({where:{id:(await additional.json()).id}});
  });
  it('does not permit accepting another student proposal',async()=>{
    expect((await request(`/suggestions/${proposalId}/accept`,'POST',{},cookieB)).status).toBe(404);
  });
  it('returns today, upcoming and past agenda independently of the requested calendar week',async()=>{
    const prisma=getPrismaClient();
    const pastStart=new Date(Date.now()-2*3_600_000), pastEnd=new Date(Date.now()-3_600_000);
    const futureStart=new Date(Date.now()+8*86_400_000), futureEnd=new Date(+futureStart+50*60_000);
    await prisma.event.createMany({data:[
      {userId:userBId,title:'Recent agenda history',startTime:pastStart,endTime:pastEnd,eventType:'PERSONAL',status:'SCHEDULED'},
      {userId:userBId,title:'Hidden cancelled history',startTime:pastStart,endTime:pastEnd,eventType:'PERSONAL',status:'CANCELLED'},
      {userId:userBId,title:'Beyond selected week',startTime:futureStart,endTime:futureEnd,eventType:'CLASS',status:'SCHEDULED'},
    ]});
    const rangeStart=new Date(), rangeEnd=new Date(Date.now()+86_400_000);
    const state=await (await request(`/bootstrap?fromDate=${rangeStart.toISOString()}&toDate=${rangeEnd.toISOString()}`, 'GET', undefined, cookieB)).json();
    expect(state.events.some((event:{title:string})=>event.title==='Beyond selected week')).toBe(false);
    expect(state.agendaOverview.upcoming.events.some((event:{title:string})=>event.title==='Beyond selected week')).toBe(true);
    expect(state.agendaOverview.past.events.some((event:{title:string})=>event.title==='Recent agenda history')).toBe(true);
    expect(state.agendaOverview.past.events.some((event:{title:string})=>event.title==='Hidden cancelled history')).toBe(false);
    const stateA=await (await request('/bootstrap','GET',undefined,cookieA)).json();
    expect(JSON.stringify(stateA.agendaOverview)).not.toContain('Beyond selected week');
  });
  it('accepts or rejects copied UED evidence only after the student decides',async()=>{
    const prisma=getPrismaClient();
    const user=await prisma.user.findUniqueOrThrow({where:{id:userAId}});
    const createSuggestion=async(title:string)=>{
      const externalId=`ued-e2e:${randomUUID()}`;
      const startTime=new Date(Date.now()+8*86_400_000), endTime=new Date(+startTime+50*60_000);
      const suggestion=await prisma.suggestion.create({data:{userId:userAId,kind:'EVENT_CHANGE',status:'PENDING',
        titleVi:`UED: ${title}`,titleEn:`UED: ${title}`,baseVersion:user.scheduleVersion,sourceKey:`UED:${externalId}`,
        expiresAt:new Date(Date.now()+3_600_000),payload:{externalId,action:'CREATE',changes:{title,startTime:startTime.toISOString(),endTime:endTime.toISOString(),location:'TEST-ROOM',eventType:'CLASS'},evidence:{source:'UED',subject:title,excerpt:'Copied test evidence'}}}});
      return {suggestion,externalId};
    };
    const accepted=await createSuggestion('Copied timetable class');
    expect((await request(`/suggestions/${accepted.suggestion.id}/accept`,'POST',{})).status).toBe(200);
    expect(await prisma.event.findFirst({where:{userId:userAId,source:'SCHOOL_PORTAL',externalId:accepted.externalId}})).toMatchObject({title:'Copied timetable class',status:'SCHEDULED'});

    const rejected=await createSuggestion('Rejected copied class');
    expect((await request(`/suggestions/${rejected.suggestion.id}/reject`,'POST',{})).status).toBe(200);
    expect(await prisma.event.findFirst({where:{userId:userAId,externalId:rejected.externalId}})).toBeNull();
    expect(await prisma.suggestion.findUnique({where:{id:rejected.suggestion.id}})).toMatchObject({status:'REJECTED'});
  });
  it('paginates closed task history without duplicates or silent loss',async()=>{
    const prisma=getPrismaClient();
    const marker=`History page ${randomUUID()}`;
    const instant=Date.now();
    await prisma.task.createMany({data:Array.from({length:55},(_,index)=>({
      userId:userBId,title:`${marker} ${index}`,durationMinutes:30,
      deadline:new Date(instant+86_400_000),priority:'LOW' as const,status:'COMPLETED' as const,
      completedAt:new Date(instant-index*1_000),createdAt:new Date(instant-index*1_000),updatedAt:new Date(instant-index*1_000),
    }))});
    try {
      const initial=await (await request('/bootstrap','GET',undefined,cookieB)).json();
      const first=initial.tasks.filter((task:{title:string})=>task.title.startsWith(marker));
      expect(first.length).toBeGreaterThan(0);
      expect(initial.taskHistoryPage).toEqual(expect.objectContaining({hasMore:true,nextCursor:expect.any(String)}));
      expect(initial.taskHistoryPage).not.toHaveProperty('activeTruncated');
      expect(initial.tasks.every((task:Record<string,unknown>)=>!('scheduleBlocks' in task))).toBe(true);
      const counts=await prisma.task.groupBy({by:['status'],where:{userId:userBId},_count:{_all:true}});
      const count=(status:string)=>counts.find(row=>row.status===status)?._count._all||0;
      expect(initial.taskStats).toEqual({
        active:count('PENDING')+count('IN_PROGRESS'),completed:count('COMPLETED'),cancelled:count('CANCELLED'),
      });

      const collected=[...first];
      let cursor:string|null=initial.taskHistoryPage.nextCursor;
      const firstCursor=cursor;
      for (let page=0; cursor && page<10 && collected.length<55; page++) {
        const nextResponse=await request(`/tasks/history?cursor=${encodeURIComponent(cursor)}`,'GET',undefined,cookieB);
        expect(nextResponse.status).toBe(200);
        const next=await nextResponse.json();
        collected.push(...next.tasks.filter((task:{title:string})=>task.title.startsWith(marker)));
        cursor=next.page.nextCursor;
      }
      const ids=collected.map((task:{id:string})=>task.id);
      expect(ids).toHaveLength(55);
      expect(new Set(ids).size).toBe(55);
      expect((await request('/tasks/history?cursor=not-valid','GET',undefined,cookieB)).status).toBe(400);
      expect((await request('/tasks/history?limit=101','GET',undefined,cookieB)).status).toBe(400);
      const isolated=await (await request(`/tasks/history?cursor=${encodeURIComponent(firstCursor!)}`,'GET',undefined,cookieA)).json();
      expect(isolated.tasks.some((task:{title:string})=>task.title.startsWith(marker))).toBe(false);
    } finally {
      await prisma.task.deleteMany({where:{userId:userBId,title:{startsWith:marker}}});
    }
  });
  it('paginates every saved task session with task and user isolation',async()=>{
    const prisma=getPrismaClient();
    const marker=`Block page ${randomUUID()}`;
    const now=Date.now();
    const task=await prisma.task.create({data:{userId:userBId,title:marker,durationMinutes:30,
      deadline:new Date(now+3*86_400_000),priority:'MEDIUM',status:'IN_PROGRESS',isScheduled:true}});
    const another=await prisma.task.create({data:{userId:userBId,title:`${marker} other`,durationMinutes:30,
      deadline:new Date(now+3*86_400_000),priority:'MEDIUM'}});
    await prisma.taskScheduleBlock.createMany({data:Array.from({length:107},(_,index)=>{
      const future=index===0;
      const startTime=new Date(future?now+86_400_000:now-(index+1)*3_600_000);
      return {userId:userBId,taskId:task.id,startTime,endTime:new Date(+startTime+30*60_000),
        status:(index>=105?'CANCELLED':future?'SCHEDULED':'COMPLETED') as 'CANCELLED'|'SCHEDULED'|'COMPLETED',origin:'AUTO' as const};
    })});
    try {
      const blocks: {id:string;status:string}[]=[];
      let cursor:string|null=null;
      let firstCursor:string|null=null;
      for (let page=0;page<10;page++) {
        const response=await request(`/tasks/${task.id}/schedule-blocks?limit=17${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,'GET',undefined,cookieB);
        expect(response.status).toBe(200);
        const body=await response.json();
        expect(body.hasFutureBlocks).toBe(true);
        expect(body.blocks.length).toBeLessThanOrEqual(17);
        blocks.push(...body.blocks);
        cursor=body.page.nextCursor;
        firstCursor??=cursor;
        if (!body.page.hasMore) { expect(cursor).toBeNull(); break; }
      }
      expect(blocks).toHaveLength(105);
      expect(new Set(blocks.map(block=>block.id)).size).toBe(105);
      expect(blocks.some(block=>block.status==='CANCELLED')).toBe(false);

      const foreign=await request(`/tasks/${task.id}/schedule-blocks`,'GET',undefined,cookieA);
      expect(foreign.status).toBe(404);
      expect((await foreign.json()).error.code).toBe('NOT_FOUND');
      const crossTask=await request(`/tasks/${another.id}/schedule-blocks?cursor=${encodeURIComponent(firstCursor!)}`,'GET',undefined,cookieB);
      expect(crossTask.status).toBe(400);
      expect((await crossTask.json()).error.code).toBe('INVALID_TASK_BLOCK_CURSOR');
      expect((await request(`/tasks/${task.id}/schedule-blocks?cursor=invalid`,'GET',undefined,cookieB)).status).toBe(400);
      expect((await request(`/tasks/${task.id}/schedule-blocks?limit=101`,'GET',undefined,cookieB)).status).toBe(400);
      expect((await request(`/tasks/${task.id}/schedule-blocks?extra=true`,'GET',undefined,cookieB)).status).toBe(400);
    } finally {
      await prisma.task.deleteMany({where:{id:{in:[task.id,another.id]},userId:userBId}});
    }
  });
  it('logs out and revokes the server-side session',async()=>{
    expect((await request('/auth/logout','POST',{})).status).toBe(200);
    expect((await request('/auth/me')).status).toBe(401);
  });
});
