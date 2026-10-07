import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { authorizeGmail, DEFAULT_MAIL_QUERY, GMAIL_SCOPE, GmailReader, messageText } from '../src/mail/gmail';
import { emailActions } from '../src/mail/actions';
import type { FixedEvent, MailCandidate, Task } from '../src/core/types';

const encode=(value:string)=>Buffer.from(value).toString('base64url');
const mail:MailCandidate={id:'email1',threadId:'thread1',subject:'Interview',from:'Recruiter',receivedAt:'2026-10-07T12:00:00Z',text:'Interview tomorrow',url:'https://mail.google.com/mail/u/0/#all/thread1'};
const task:Task={id:'t',title:'Prep',status:'planned',priority:'normal',plannedDate:'2026-10-07',notes:'邮件线程: thread1',createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z'};
const event:FixedEvent={id:'e',title:'Interview',startAt:'2026-10-08T17:00:00Z',endAt:'2026-10-08T18:00:00Z',timezone:'America/Los_Angeles',source:'local',notes:'邮件线程: thread1',createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z'};
describe('Gmail read-only desktop access',()=>{
  it('uses only Gmail readonly with PKCE, validates state, and exchanges a loopback code',async()=>{
    let challenge='';
    const transport=vi.fn<typeof fetch>(async(_url,init)=>{const body=new URLSearchParams(String(init?.body));expect(body.get('grant_type')).toBe('authorization_code');expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge);return Response.json({access_token:'unit-access-placeholder',refresh_token:'unit-refresh-placeholder',scope:GMAIL_SCOPE});});
    const result=await authorizeGmail({clientId:'unit-client.apps.googleusercontent.com'},async value=>{
      const url=new URL(value);expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('scope')).toBe(GMAIL_SCOPE);expect(url.searchParams.get('code_challenge_method')).toBe('S256');challenge=url.searchParams.get('code_challenge')!;
      const callback=new URL(url.searchParams.get('redirect_uri')!);expect(callback.hostname).toBe('127.0.0.1');callback.search=new URLSearchParams({code:'unit-code',state:'wrong'}).toString();expect((await fetch(callback)).status).toBe(400);
      callback.searchParams.set('state',url.searchParams.get('state')!);expect((await fetch(callback)).status).toBe(200);
    },transport);
    expect(result).toBe('unit-refresh-placeholder');expect(transport).toHaveBeenCalledTimes(1);
  });
  it('handles denied consent without requesting a token',async()=>{
    const transport=vi.fn<typeof fetch>();
    await expect(authorizeGmail({clientId:'unit-client.apps.googleusercontent.com'},async value=>{const url=new URL(value);const callback=new URL(url.searchParams.get('redirect_uri')!);callback.search=new URLSearchParams({error:'access_denied',state:url.searchParams.get('state')!}).toString();await fetch(callback);},transport)).rejects.toThrow('cancelled');
    expect(transport).not.toHaveBeenCalled();
  });
  it('reads filtered messages using GET without any send/delete/modify method',async()=>{
    const transport=vi.fn<typeof fetch>(async(value,init)=>{
      const url=String(value);
      if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'unit-access-placeholder',scope:GMAIL_SCOPE});
      expect(init?.method ?? 'GET').toBe('GET');
      if(url.includes('messages?')){expect(new URL(url).searchParams.get('q')).toBe(DEFAULT_MAIL_QUERY);return Response.json({messages:[{id:'email1'}]});}
      return Response.json({threadId:'thread1',internalDate:'1791374400000',payload:{mimeType:'text/plain',body:{data:encode('Interview tomorrow')},headers:[{name:'Subject',value:'Interview'}]}});
    });
    const result=await new GmailReader({clientId:'unit-client',refreshToken:'unit-refresh-placeholder'},transport).list(DEFAULT_MAIL_QUERY);
    expect(result[0]).toMatchObject({id:'email1',subject:'Interview',text:'Interview tomorrow'});expect(transport).toHaveBeenCalledTimes(3);
  });
  it('extracts plain text once, retains invitations, and does not execute HTML',()=>{
    expect(messageText({parts:[{mimeType:'text/plain',body:{data:encode('Hello')}},{mimeType:'text/html',body:{data:encode('<b>Hello</b>')}},{mimeType:'text/calendar',body:{data:encode('DTSTART:20261008T170000Z')}}]})).toBe('Hello\nDTSTART:20261008T170000Z');
    expect(messageText({mimeType:'text/html',body:{data:encode('<script>bad()</script><p>Interview &amp; prep</p>')}})).toContain('Interview & prep');
    expect(messageText({mimeType:'text/html',body:{data:encode('<script>bad()</script>')}})).not.toContain('bad');
  });
  it('does not expose provider exception details',async()=>{
    const reader=new GmailReader({clientId:'unit-client',refreshToken:'unit-refresh-placeholder'},async()=>{throw new Error('private provider contents');});
    await expect(reader.list(DEFAULT_MAIL_QUERY)).rejects.toThrow('Gmail could not connect');
  });
});
describe('selected-email action isolation',()=>{
  it('preserves source/thread metadata when email extraction replaces notes',()=>{
    const result=emailActions({message:'ok',actions:[{type:'update_task',taskId:'t',patch:{notes:'Updated preparation'}}]},mail,{tasks:[task],fixedEvents:[]},'2026-10-07');
    expect(result[0]).toMatchObject({type:'update_task',patch:{notes:expect.stringContaining('邮件线程: thread1')}});
  });
  it('links sources and defaults new tasks to today',()=>{const result=emailActions({message:'ok',actions:[{type:'create_task',task:{title:'Prepare'}}]},mail,{tasks:[],fixedEvents:[]},'2026-10-07');expect(result).toMatchObject([{type:'create_task',task:{plannedDate:'2026-10-07',notes:expect.stringContaining(mail.url)}}]);});
  it('deduplicates existing events and converts same-thread reschedules into updates',()=>{
    const reply={message:'ok',actions:[{type:'create_fixed_event' as const,event:{title:event.title,startAt:event.startAt,endAt:event.endAt,timezone:event.timezone}}]};
    expect(emailActions(reply,mail,{tasks:[],fixedEvents:[event]},'2026-10-07')).toEqual([]);
    const changed={...reply,actions:[{...reply.actions[0],event:{...reply.actions[0].event,startAt:'2026-10-08T19:00:00Z',endAt:'2026-10-08T20:00:00Z'}}]};
    expect(emailActions(changed,mail,{tasks:[],fixedEvents:[event]},'2026-10-07')[0]).toMatchObject({type:'update_fixed_event',eventId:'e'});
  });
  it('refuses completion, retrospective records, unrelated mutations and ambiguous extraction',()=>{
    for(const actions of [[{type:'complete_task' as const,taskId:'t'}],[{type:'cancel_task' as const,taskId:'unrelated'}],[{type:'delete_fixed_event' as const,eventId:'cloud'}]])expect(()=>emailActions({message:'ok',actions},mail,{tasks:[task],fixedEvents:[{...event,id:'cloud',source:'icloud'}]},'2026-10-07')).toThrow();
    expect(()=>emailActions({message:'ok',actions:[],clarification:'Which timezone?'},mail,{tasks:[],fixedEvents:[]},'2026-10-07')).toThrow('timezone');
  });
});
