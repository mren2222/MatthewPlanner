import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const requestSchema = z.object({ id:z.string().uuid(), expectedRevision:z.number().int().nonnegative(), actions:z.unknown(), sourceMessage:z.string().trim().min(1).max(10000) }).strict();
export type BridgeRequest = z.infer<typeof requestSchema>;

/** File-only inbox for a connected local Codex/Work agent. No network listener,
 * credentials, AI calls or direct DB writes. Main serializes validated service
 * mutations and publishes a credential-free snapshot. */
export class LocalPlannerBridge {
  private incoming: string;
  private results: string;
  constructor(private directory: string,
    private snapshot: () => unknown,
    private apply: (request: BridgeRequest) => { revision: number },
    private safeError: (message: string) => string) {
    this.incoming = join(directory,'incoming'); this.results = join(directory,'results');
    mkdirSync(this.incoming,{recursive:true}); mkdirSync(this.results,{recursive:true});
  }
  private write(path: string, value: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary,JSON.stringify(value,null,2),'utf8');renameSync(temporary,path); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  refresh() { this.write(join(this.directory,'snapshot.json'),{generatedAt:new Date().toISOString(),...this.snapshot() as object}); }
  process() {
    for (const filename of readdirSync(this.incoming).filter(name=>/^[0-9a-f-]{36}\.json$/i.test(name)).sort().slice(0,50)) {
      const id = filename.slice(0,-5), path = join(this.incoming,filename);
      if (!z.string().uuid().safeParse(id).success) continue;
      let result: object;
      let requestHash: string | undefined;
      try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200000) throw new Error('Invalid local request file.');
        const contents = readFileSync(path,'utf8');
        requestHash = createHash('sha256').update(contents).digest('hex');
        const request = requestSchema.parse(JSON.parse(contents));
        if (request.id !== id) throw new Error('Request ID does not match its filename.');
        result = { id, requestHash, status:'applied', ...this.apply(request) };
      } catch (error) {
        result = { id, requestHash, status:'error', message:this.safeError(error instanceof Error ? error.message : 'The local request failed.') };
      }
      // Persist the result before removing the request. A crash retries safely
      // using the transactionally persisted receipt in ActionService's store.
      this.write(join(this.results,filename),result);
      unlinkSync(path);
    }
    this.refresh();
  }
}
