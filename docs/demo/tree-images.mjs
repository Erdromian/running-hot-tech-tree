// Draws each research tree of the demo page as its own PNG, to share where only images preview (Discord, say).
// Sample game; nothing is sent anywhere. Needs Google Chrome and Node 22+.
// Run: node docs/demo/tree-images.mjs [out-dir]   (default dist/trees)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || join(here, '..', '..', 'dist', 'trees'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 1440, SCALE = 2, PAD = 24;
// Everything but the trees goes; each tree is as wide as it needs, never scrolled.
const TREES_ONLY = `
  .main > :not(#trees), .insp { display: none !important; }
  .wrap { display: block !important; max-width: none !important; }
  .main { max-width: none !important; width: max-content !important; min-width: 100% !important; padding: ${PAD}px !important; }
  .trees { align-items: flex-start !important; }
  .tree { width: max-content !important; min-width: ${WIDTH - 2 * PAD}px !important; }
  .canvas-wrap { overflow: visible !important; width: max-content !important; min-width: 100% !important; }
`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'rh-trees-'));
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
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: SCALE, mobile: false });
  await send('Page.navigate', { url: `file://${join(here, 'demo.html')}?view=trees` });
  for (let i = 0; i < 60; i++) {
    if (await evaluate("document.body && document.body.classList.contains('demo-ready') && document.fonts.status === 'loaded'")) break;
    await sleep(150);
  }
  await evaluate(`document.head.insertAdjacentHTML('beforeend', ${JSON.stringify(`<style>${TREES_ONLY}</style>`)})`);
  await sleep(400);
  // Widen the window to the widest tree so nothing is drawn off-screen.
  const widest = await evaluate(`Math.ceil(Math.max(...[...document.querySelectorAll('.tree')].map(t => t.getBoundingClientRect().width)))`);
  await send('Emulation.setDeviceMetricsOverride', { width: Math.max(WIDTH, widest + 2 * PAD), height: 1000, deviceScaleFactor: SCALE, mobile: false });
  await sleep(400);

  const trees = await evaluate(`[...document.querySelectorAll('.tree')].map(t => {
    const r = t.getBoundingClientRect();
    return { id: t.id.replace(/^tree-/, ''), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  })`);
  for (const t of trees) {
    const clip = { x: t.x - PAD, y: t.y - PAD, width: t.w + 2 * PAD, height: t.h + 2 * PAD, scale: 1 };
    const shot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    writeFileSync(join(out, `${t.id}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log(join(out, `${t.id}.png`));
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
