// Re-takes the README screenshots from the demo page (sample game; nothing is sent anywhere).
// Needs Google Chrome and Node 22+. Run: node docs/demo/screenshots.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'screenshots');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = [
  ['overview', 'overview', 1440, 1500],
  ['tree', 'tree', 1440, 1050],
  ['handouts', 'handouts', 1440, 820],
  ['table', 'table', 1440, 720],
  ['corp-card', 'corp', 1440, 1250],
  ['builder', 'builder', 1440, 1400],
  ['give', 'give', 1440, 860],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'rh-shots-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--force-dark-mode',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  for (const [name, view, width, height] of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `file://${join(here, 'demo.html')}?view=${view}` });
    for (let i = 0; i < 60; i++) {
      const r = await send('Runtime.evaluate', { expression: "document.body && document.body.classList.contains('demo-ready') && document.fonts.status === 'loaded'", returnByValue: true });
      if (r.result && r.result.result && r.result.result.value) break;
      await sleep(150);
    }
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log(`${name}.png`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
