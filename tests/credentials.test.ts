import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialVault } from '../src/electron/credentials';
describe('CredentialVault', () => {
  it('persists ciphertext and decrypts only through the backend', () => {
    const dir = mkdtempSync(join(tmpdir(), 'planner-secret-'));
    try {
      const backend = { isEncryptionAvailable: () => true, encryptString: (s:string) => Buffer.from(s.split('').reverse().join('')), decryptString: (s:Buffer) => s.toString().split('').reverse().join('') };
      const vault = new CredentialVault(join(dir,'test.secrets'), backend);
      vault.write({ openaiKey: 'test-only-secret' });
      expect(readFileSync(join(dir,'test.secrets'),'utf8').includes('test-only-secret')).toBe(false);
      expect(vault.read().openaiKey).toBe('test-only-secret');
    } finally { rmSync(dir, { recursive:true, force:true }); }
  });
  it('fails closed if OS encryption is unavailable', () => {
    const vault = new CredentialVault('unused', { isEncryptionAvailable: () => false, encryptString: () => { throw new Error('must not run'); }, decryptString: () => '' });
    expect(() => vault.write({ openaiKey: 'test-only-secret' })).toThrow('unavailable');
  });
});
