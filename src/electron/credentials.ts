import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export interface EncryptionBackend {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}
export interface PrivateSettings { openaiKey?: string; aiModel?: string; aiModelPreferenceVersion?: number; appleAccount?: string; applePassword?: string; calendarId?: string }
export class CredentialVault {
  constructor(private readonly path: string, private readonly backend: EncryptionBackend) {}
  available(): boolean { return this.backend.isEncryptionAvailable() && this.backend.getSelectedStorageBackend?.() !== 'basic_text'; }
  read(): PrivateSettings {
    if (!existsSync(this.path)) return {};
    if (!this.available()) throw new Error('Windows secure credential storage is unavailable.');
    try { return JSON.parse(this.backend.decryptString(readFileSync(this.path))) as PrivateSettings; }
    catch { throw new Error('Saved credentials cannot be decrypted. Reconfigure credentials on this Windows account.'); }
  }
  write(settings: PrivateSettings): void {
    if (!this.available()) throw new Error('Secure credential storage is unavailable; credentials were not saved.');
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, this.backend.encryptString(JSON.stringify(settings)), { mode: 0o600 });
    renameSync(temp, this.path);
  }
}
