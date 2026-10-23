// Builds the demo page as one self-contained HTML file, to share as an attachment (sample game; nothing is sent anywhere).
// Needs Node 22+. Run: node docs/demo/bundle.mjs [out.html]   (default dist/running-hot-tech-tree.html)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || join(here, '..', '..', 'dist', 'running-hot-tech-tree.html'));
const read = src => readFileSync(join(here, src), 'utf8');

const html = read('demo.html')
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${read(src).replaceAll('</script', '<\\/script')}\n</script>`)
  .replace(/<link rel="stylesheet" href="(\.[^"]+)">/g, (_, src) => `<style>\n${read(src)}\n</style>`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} (${Math.round(html.length / 1024)} KB)`);
