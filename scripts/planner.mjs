// A connected Codex/Work task can use this local interface while Planner is open.
// Do not write the database or credentials directly.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const args=process.argv.slice(2), command=args[0];
const option=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
const directory=option('--bridge-dir') ?? join(process.env.APPDATA ?? '', 'Matthew Planner','bridge');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  const snapshot=JSON.parse(await readFile(join(directory,'snapshot.json'),'utf8'));
  if (Date.now()-Date.parse(snapshot.generatedAt)>15000 || !Number.isFinite(Date.parse(snapshot.generatedAt))) throw new Error('Matthew Planner is not connected. Open the app and retry.');
  if(command==='snapshot') process.stdout.write(JSON.stringify(snapshot,null,2)+'\n');
  else if(command==='apply') {
    const path=option('--file');if(!path)throw new Error('Use apply --file <actions.json>.');
    const input=JSON.parse(await readFile(resolve(path),'utf8'));
    if (!Number.isSafeInteger(input.expectedRevision) || !Array.isArray(input.actions) || !input.sourceMessage) throw new Error('Provide expectedRevision, actions and sourceMessage from the user request.');
    const id=input.id ?? randomUUID(), filename=`${id}.json`;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid request ID.');
    const request={id,expectedRevision:input.expectedRevision,actions:input.actions,sourceMessage:input.sourceMessage};
    await mkdir(join(directory,'incoming'),{recursive:true});
    const temporary=join(directory,'incoming',`${id}.${randomUUID()}.tmp`);
    const contents=JSON.stringify(request), requestHash=createHash('sha256').update(contents).digest('hex');
    await writeFile(temporary,contents);await rename(temporary,join(directory,'incoming',filename));
    let result;
    for(let i=0;i<150;i++) {
      try { const candidate=JSON.parse(await readFile(join(directory,'results',filename),'utf8'));if(candidate.requestHash===requestHash){result=candidate;break;}await pause(200); }
      catch(error) { if(error.code!=='ENOENT')throw error;await pause(200); }
    }
    if(!result)throw new Error(`Delivery pending; request ID ${id}. Read its result before retrying, and reuse this ID.`);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.status!=='applied')process.exitCode=1;
  } else throw new Error('Use snapshot or apply --file <actions.json>.');
} catch(error) { process.stderr.write((error instanceof Error?error.message:'Local planner request failed')+'\n');process.exitCode=1; }
