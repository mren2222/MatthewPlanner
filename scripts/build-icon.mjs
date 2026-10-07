// Reproducible Windows icon from the repository's vector brand mark.
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir('test-results', { recursive: true });
const temp = await mkdtemp(resolve('test-results/icon-build-'));
const main = join(temp, 'main.cjs');
await writeFile(main, "require('electron').app.whenReady().then(()=>{const window=new (require('electron').BrowserWindow)({show:false});window.loadURL('about:blank')})");
const app = await electron.launch({ executablePath: electronPath, args: [main], env });
try {
  const page = await app.firstWindow({ timeout: 10000 });
  page.setDefaultTimeout(10000);
  console.log('Icon renderer ready');
  const svg = await readFile('build/icon.svg', 'utf8');
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
  const sizes = [16, 32, 48, 256];
  const images = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    images.push(await page.screenshot({ omitBackground: true, timeout: 10000 }));
    console.log(`Rendered ${size}px icon`);
  }
  await writeFile('build/icon.png', images.at(-1));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + i * 16;
    header[entry] = sizes[i] % 256; header[entry + 1] = sizes[i] % 256;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  }
  await writeFile('build/icon.ico', Buffer.concat([header, ...images]));
} finally { await app.close(); }
