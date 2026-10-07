import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/electron', { recursive: true });
await viteBuild();
await build({ entryPoints: ['src/electron/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/electron/main.cjs', external: ['electron', 'sql.js'], sourcemap: true });
await build({ entryPoints: ['src/electron/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/electron/preload.cjs', external: ['electron'] });
await copyFile('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/electron/sql-wasm.wasm');
