import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { MailCandidate } from '../core/types';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const DEFAULT_MAIL_QUERY = 'newer_than:30d -in:trash -in:spam {interview recruiter recruiting application 面试 招聘 申请}';
export interface GmailConfig { clientId: string; clientSecret?: string; refreshToken?: string }
interface TokenResult { access_token: string; refresh_token?: string; scope?: string }
class GmailRequestError extends Error {}
async function requestJson(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<any> {
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new GmailRequestError(response.status === 401 || response.status === 400 ? 'Gmail authorization expired or was rejected. Reconnect Gmail in Settings.' : response.status === 403 ? 'Gmail access was denied. Enable Gmail API and check the read-only permission in your Google project.' : 'Gmail is temporarily unavailable. Please retry.');
    return await response.json();
  } catch (error) {
    if (error instanceof GmailRequestError) throw error;
    // Provider exceptions can embed tokens, so intentionally discard their cause.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('Gmail could not connect. Check your connection and retry.');
  }
}
export async function exchangeToken(config: GmailConfig, values: Record<string, string>, fetcher: typeof fetch = fetch): Promise<TokenResult> {
  const body = new URLSearchParams({ client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), ...values });
  const token = await requestJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, fetcher) as TokenResult;
  if (!token.access_token || (token.scope && !token.scope.split(' ').includes(GMAIL_SCOPE))) throw new Error('Gmail read-only permission was not granted. Reconnect and allow it.');
  return token;
}

/** Desktop PKCE + state, bound only to IPv4 loopback and opened in the system browser. */
export async function authorizeGmail(config: GmailConfig, openBrowser: (url: string) => Promise<void>, fetcher: typeof fetch = fetch): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) throw new Error('Enter a Google Desktop OAuth client ID in Settings first.');
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Attach immediately so a launch error/callback error cannot be an unhandled rejection.
  void codePromise.catch(() => undefined);
  const server = createServer((request, response) => {
    const callback = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' || callback.pathname !== '/' || callback.searchParams.get('state') !== state) { response.writeHead(400); response.end('Invalid authorization response.'); return; }
    if (callback.searchParams.has('error') || !callback.searchParams.get('code')) { response.end('Authorization cancelled. Return to Matthew Planner.'); rejectCode(new Error('Gmail authorization was cancelled.')); return; }
    response.end('Gmail connected. You may close this tab and return to Matthew Planner.');
    resolveCode(callback.searchParams.get('code')!);
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not open the Gmail callback.');
    const redirectUri = `http://127.0.0.1:${address.port}/`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: GMAIL_SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    timeout = setTimeout(() => rejectCode(new Error('Gmail authorization timed out. Try connecting again.')), 180000);
    await openBrowser(url.href);
    const code = await codePromise;
    const token = await exchangeToken(config, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }, fetcher);
    if (!token.refresh_token) throw new Error('Gmail did not provide offline access. Reconnect Gmail and grant permission again.');
    return token.refresh_token;
  } finally { if (timeout) clearTimeout(timeout); server.close(); }
}

interface Part { mimeType?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[]; headers?: { name: string; value: string }[] }
function decode(value?: string): string { return value ? Buffer.from(value, 'base64url').toString('utf8') : ''; }
function plainHtml(value: string): string {
  return value.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
export function messageText(payload: Part): string {
  const parts: Part[] = [];
  const visit = (part: Part, depth = 0) => { if (depth > 12 || parts.length > 200) return; parts.push(part); part.parts?.forEach(child => visit(child, depth + 1)); };
  visit(payload);
  const plain = parts.filter(part => part.mimeType === 'text/plain').map(part => decode(part.body?.data)).join('\n');
  const html = parts.filter(part => part.mimeType === 'text/html').map(part => plainHtml(decode(part.body?.data))).join('\n');
  const invites = parts.filter(part => part.mimeType === 'text/calendar').map(part => decode(part.body?.data)).join('\n');
  return `${plain || html}\n${invites}`.trim().slice(0, 14000);
}
export class GmailReader {
  constructor(private config: GmailConfig, private fetcher: typeof fetch = fetch) {}
  async list(query: string): Promise<MailCandidate[]> {
    if (!this.config.refreshToken) throw new Error('Connect Gmail in Settings first.');
    const token = await exchangeToken(this.config, { grant_type: 'refresh_token', refresh_token: this.config.refreshToken }, this.fetcher);
    const get = (path: string) => requestJson(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token.access_token}` } }, this.fetcher);
    const listing = await get(`messages?${new URLSearchParams({ q: query, maxResults: '20' })}`);
    const result: MailCandidate[] = [];
    for (const entry of listing.messages ?? []) {
      if (!/^[a-zA-Z0-9_-]{1,256}$/.test(entry.id)) throw new Error('Gmail returned an invalid message identifier.');
      const message = await get(`messages/${entry.id}?format=full`);
      const payload: Part = message.payload ?? {};
      const invitations: Part[] = [];
      const collect = (part: Part, depth = 0) => { if (depth > 12 || invitations.length >= 5) return; if (part.mimeType === 'text/calendar' && part.body?.attachmentId && (part.body.size ?? 0) <= 256000) invitations.push(part); part.parts?.forEach(child => collect(child, depth + 1)); };
      collect(payload);
      for (const invitation of invitations) {
        const id = invitation.body!.attachmentId!;
        if (!/^[a-zA-Z0-9_-]{1,2048}$/.test(id)) continue;
        const attachment = await get(`messages/${entry.id}/attachments/${id}`);
        if (typeof attachment.data === 'string' && attachment.data.length <= 350000) invitation.body!.data = attachment.data;
      }
      const header = (name: string) => payload.headers?.find(value => value.name.toLowerCase() === name)?.value ?? '';
      const text = messageText(payload);
      if (!text) continue;
      const date = new Date(Number(message.internalDate));
      if (!Number.isFinite(date.getTime())) continue;
      result.push({ id: entry.id, threadId: String(message.threadId ?? entry.id), subject: header('subject').slice(0, 500), from: header('from').slice(0, 500), receivedAt: date.toISOString(), text, url: `https://mail.google.com/mail/u/0/#all/${message.threadId ?? entry.id}` });
    }
    return result.sort((a,b) => b.receivedAt.localeCompare(a.receivedAt));
  }
}
