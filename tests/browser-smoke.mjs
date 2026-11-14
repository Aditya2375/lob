/**
 * Browser smoke test: serves docs/, drives headless Chrome over CDP, and
 * checks the demo works on the real packed site - scenario pills, charts drawn,
 * tape, stats, markout cards, live rerun through the JS engine, no page
 * exceptions. Runs locally and in CI (ubuntu-latest ships google-chrome).
 * SMOKE_SHOTS=1 writes smoke-*.png screenshots for visual review.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const HTTP_PORT = 8947;
const CDP_PORT = 9347;
const SHOTS = process.env.SMOKE_SHOTS === '1';
const root = new URL('..', import.meta.url).pathname;

const server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1', '--directory', `${root}docs`], { stdio: 'ignore' });
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, 'about:blank',
], { stdio: 'ignore' });

const cleanup = (code) => {
  try { chrome.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
  process.exit(code);
};
setTimeout(() => { console.error('smoke: timeout'); cleanup(1); }, 180000);
process.on('SIGINT', () => cleanup(2));

async function waitFor(fn, label, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'ok' : 'NOT OK'} - ${name}${detail ? ' - ' + detail : ''}`);
};

await waitFor(async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok, 'chrome devtools');
const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let mid = 0;
const rpcPending = new Map();
const consoleErrors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && rpcPending.has(msg.id)) {
    rpcPending.get(msg.id)(msg);
    rpcPending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'page exception');
  }
};
const cdp = (method, params = {}) => new Promise((resolve) => {
  const id = ++mid;
  rpcPending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const res = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
};
const shot = async (name) => {
  if (!SHOTS) return;
  await new Promise((r) => setTimeout(r, 900));
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${root}smoke-${name}.png`, Buffer.from(r.result.data, 'base64'));
};

await cdp('Runtime.enable');
await cdp('Page.enable');
if (SHOTS) await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });

// Boot: scenario pills, first scenario rendered.
await waitFor(() => evaluate(`document.querySelectorAll('#scenarios .pill').length === 4`), 'scenario pills');
const active = await evaluate(`document.querySelector('#scenarios .pill.active')?.textContent ?? ''`);
check('boot: calm scenario active', /calm/i.test(active), active);
await waitFor(() => evaluate(`document.querySelectorAll('#stats .stat').length === 6`), 'stat cards');
const pnlCard = await evaluate(`document.querySelector('#stats .stat .v').textContent`);
check('boot: final pnl card populated', pnlCard.trim().length > 0, pnlCard);
const tapeRows = await evaluate(`document.querySelectorAll('#tape-body tr').length`);
check('boot: trade tape populated', tapeRows === 14, `${tapeRows} rows`);
const markoutCards = await evaluate(`document.querySelectorAll('#markout .mo').length`);
check('boot: mark-out attribution rendered', markoutCards === 2, `${markoutCards} cards`);
const infMo = await evaluate(`document.querySelectorAll('#markout .mo .amt')[1].textContent`);
check('boot: informed mark-out is a loss', infMo.startsWith('-'), infMo);

// Charts actually drew pixels (canvas is not blank).
const drew = await evaluate(`(() => {
  const c = document.getElementById('chart-price');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 3; i < d.length; i += 400) if (d[i] > 0) lit++;
  return lit;
})()`);
check('boot: price chart drew pixels', drew > 50, `${drew} lit samples`);
await shot('home');

// Switch scenario: flash shows the marker text and updates stats.
await evaluate(`[...document.querySelectorAll('#scenarios .pill')].find(b => /flash/i.test(b.textContent)).click()`);
await waitFor(() => evaluate(`document.querySelector('#price-sub').textContent.toLowerCase().includes('flash')`), 'flash selected');
const flashPnl = await evaluate(`document.querySelector('#stats .stat .v').textContent`);
check('scenario: flash stats differ from calm', flashPnl !== pnlCard, `calm=${pnlCard} flash=${flashPnl}`);
await shot('flash');

// Live rerun: sliders + rerun produce a custom run through the JS engine.
await evaluate(`(() => {
  const d = document.querySelector('.tune');
  d.open = true;
  const s = document.getElementById('sl-inf');
  s.value = '0.2';
  s.dispatchEvent(new Event('input'));
  document.getElementById('rerun').click();
})()`);
await waitFor(() => evaluate(`document.querySelector('#price-sub').textContent.includes('Custom run')`), 'custom rerun');
const customSub = await evaluate(`document.querySelector('#price-sub').textContent`);
check('rerun: custom run computed in-tab', /seed \d+/.test(customSub), customSub.slice(0, 80));
const customStats = await evaluate(`document.querySelectorAll('#stats .stat').length`);
check('rerun: stats re-rendered', customStats === 6, `${customStats} cards`);
await shot('custom');

check('no page exceptions', consoleErrors.length === 0, consoleErrors[0] ?? '');

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
cleanup(failed.length ? 1 : 0);
