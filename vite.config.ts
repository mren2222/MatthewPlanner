import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';
const nonce = randomBytes(18).toString('base64');
export default defineConfig({ plugins: [react(), { name: 'planner-csp', transformIndexHtml: { order: 'pre', handler: html => html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`) } }], html: { cspNonce: nonce }, base: './', build: { outDir: 'dist/ui', emptyOutDir: false }, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
