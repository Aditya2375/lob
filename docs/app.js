// lob UI: replays the pinned scenarios and re-runs the engine live.
// All rendering is textContent/createElement or canvas paths; no HTML from data.
import { runSim, defaultParams } from './engine.js';

const $ = (id) => document.getElementById(id);
const TICK = 0.01;
const fmtMoney = (ticks) => (ticks < 0 ? '-' : '') + Math.abs(ticks / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPrice = (ticks) => (ticks * TICK).toFixed(2);

const els = {
  scenarios: $('scenarios'),
  topStats: $('top-stats'),
  priceSub: $('price-sub'),
  tape: $('tape-body'),
  stats: $('stats'),
  markout: $('markout'),
  rerun: $('rerun'),
};

const SCEN_ORDER = ['calm', 'volatile', 'informed', 'flash'];
const state = { data: null, current: null, scenarios: {}, labels: {} };

// ---------- scenario loading ----------
async function loadScenarios() {
  const idx = await (await fetch('data/index.json')).json();
  state.labels = idx.labels;
  // Fixed literal URLs only - the scenario set is pinned.
  const resps = await Promise.all([
    fetch('data/calm.json'),
    fetch('data/volatile.json'),
    fetch('data/informed.json'),
    fetch('data/flash.json'),
  ]);
  const names = ['calm', 'volatile', 'informed', 'flash'];
  for (let i = 0; i < names.length; i++) {
    if (resps[i].ok) state.scenarios[names[i]] = await resps[i].json();
  }
  buildPills();
  select(SCEN_ORDER[0]);
}

function buildPills() {
  els.scenarios.textContent = '';
  for (const name of SCEN_ORDER) {
    if (!state.scenarios[name]) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    b.textContent = state.labels[name] || name;
    b.dataset.name = name;
    b.addEventListener('click', () => select(name));
    els.scenarios.append(b);
  }
}

function select(name) {
  state.current = name;
  state.data = state.scenarios[name];
  for (const b of els.scenarios.querySelectorAll('.pill')) {
    b.classList.toggle('active', b.dataset.name === name);
  }
  renderAll();
}

// ---------- canvas helpers ----------
function ctx2d(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = +canvas.getAttribute('height');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function scaleY(min, max, h, pad) {
  const span = max - min || 1;
  return (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
}

function series_minmax(arrays) {
  let min = Infinity, max = -Infinity;
  for (const a of arrays) {
    for (const v of a) {
      if (v === 0) continue; // 0 means "no quote that tick" for bid/ask
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return [min, max];
}

function line(ctx, arr, xs, ys, color, width, skipZero) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < arr.length; i++) {
    if (skipZero && arr[i] === 0) { started = false; continue; }
    const x = xs(i), y = ys(arr[i]);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- charts ----------
function drawPrice(d) {
  const { ctx, w, h } = ctx2d($('chart-price'));
  const n = d.series.mid.length;
  const [min, max] = series_minmax([d.series.fundamental, d.series.mid, d.series.botBid, d.series.botAsk]);
  const xs = (i) => (i / (n - 1)) * w;
  const ys = scaleY(min, max, h, 14);
  const paper = css('--paper'), faint = css('--paper-faint'), accent = css('--accent'), line_ = css('--line');

  // grid
  ctx.strokeStyle = line_; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = 14 + (g / 4) * (h - 28);
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.globalAlpha = 1;
    const val = max - (g / 4) * (max - min);
    ctx.fillStyle = faint;
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText(fmtPrice(val), 8, y - 4);
  }

  // quote band
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < n; i++) {
    if (d.series.botAsk[i] === 0) { started = false; continue; }
    const x = xs(i), y = ys(d.series.botAsk[i]);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  for (let i = n - 1; i >= 0; i--) {
    if (d.series.botBid[i] === 0 || d.series.botAsk[i] === 0) continue;
    ctx.lineTo(xs(i), ys(d.series.botBid[i]));
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  line(ctx, d.series.fundamental, xs, ys, faint, 1, false);
  line(ctx, d.series.mid, xs, ys, paper, 1.6, false);
  line(ctx, d.series.botBid, xs, ys, accent, 0.8, true);
  line(ctx, d.series.botAsk, xs, ys, accent, 0.8, true);

  // flash marker
  if (d.params.flashTick >= 0) {
    const x = xs(d.params.flashTick);
    ctx.strokeStyle = css('--ask');
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css('--ask');
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText('flash move', Math.min(x + 6, w - 70), 16);
  }
}

function drawDepth(d) {
  const { ctx, w, h } = ctx2d($('chart-depth'));
  const bids = d.depth.bids, asks = d.depth.asks;
  const maxQ = Math.max(1, ...bids.map(r => r[1]), ...asks.map(r => r[1]));
  const rows = Math.max(bids.length, asks.length);
  const rh = Math.min(18, (h - 30) / rows);
  const midX = w / 2;
  const bidC = css('--bid'), askC = css('--ask'), faint = css('--paper-faint');

  ctx.font = '10.5px JetBrains Mono, monospace';
  for (let i = 0; i < bids.length; i++) {
    const y = h - 24 - (i + 1) * rh;
    const bw = (bids[i][1] / maxQ) * (midX - 70);
    ctx.fillStyle = bidC;
    ctx.globalAlpha = 0.75 - i * 0.04;
    ctx.fillRect(midX - 24 - bw, y, bw, rh - 4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = faint;
    ctx.textAlign = 'right';
    ctx.fillText(fmtPrice(bids[i][0]), midX - 32 - bw, y + rh - 8);
  }
  for (let i = 0; i < asks.length; i++) {
    const y = h - 24 - (i + 1) * rh;
    const bw = (asks[i][1] / maxQ) * (midX - 70);
    ctx.fillStyle = askC;
    ctx.globalAlpha = 0.75 - i * 0.04;
    ctx.fillRect(midX + 24, y, bw, rh - 4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = faint;
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(asks[i][0]), midX + 32 + bw, y + rh - 8);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = faint;
  ctx.fillText('bids', midX - 60, h - 6);
  ctx.fillText('asks', midX + 60, h - 6);
}

function drawPnl(d) {
  const { ctx, w, h } = ctx2d($('chart-pnl'));
  const pnl = d.series.pnl;
  const n = pnl.length;
  let peak = -Infinity;
  const peaks = pnl.map(v => (peak = Math.max(peak, v)));
  const min = Math.min(...pnl, 0), max = Math.max(...peaks, 1);
  const xs = (i) => (i / (n - 1)) * w;
  const ys = scaleY(min, max, h, 16);
  const paper = css('--paper'), faint = css('--paper-faint'), ask = css('--ask'), line_ = css('--line');

  // zero line
  ctx.strokeStyle = line_;
  ctx.beginPath(); ctx.moveTo(0, ys(0)); ctx.lineTo(w, ys(0)); ctx.stroke();

  // drawdown shading between peak and pnl
  ctx.fillStyle = ask;
  ctx.globalAlpha = 0.10;
  ctx.beginPath();
  ctx.moveTo(xs(0), ys(peaks[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(xs(i), ys(peaks[i]));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(xs(i), ys(pnl[i]));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = faint;
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 4]);
  line(ctx, peaks, xs, ys, faint, 0.8, false);
  ctx.setLineDash([]);
  line(ctx, pnl, xs, ys, paper, 1.6, false);

  ctx.fillStyle = faint;
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.fillText(fmtMoney(max), 8, 14);
  ctx.fillText(fmtMoney(min), 8, h - 6);
}

function drawInv(d) {
  const { ctx, w, h } = ctx2d($('chart-inv'));
  const inv = d.series.inventory;
  const n = inv.length;
  const maxAbs = Math.max(1, ...inv.map(Math.abs), d.params.maxInventory);
  const xs = (i) => (i / (n - 1)) * w;
  const ys = scaleY(-maxAbs, maxAbs, h, 10);
  const accent = css('--accent'), faint = css('--paper-faint'), line_ = css('--line');

  ctx.strokeStyle = line_;
  ctx.beginPath(); ctx.moveTo(0, ys(0)); ctx.lineTo(w, ys(0)); ctx.stroke();
  // cap rails
  ctx.strokeStyle = faint;
  ctx.setLineDash([3, 4]);
  for (const c of [d.params.maxInventory, -d.params.maxInventory]) {
    ctx.beginPath(); ctx.moveTo(0, ys(c)); ctx.lineTo(w, ys(c)); ctx.stroke();
  }
  ctx.setLineDash([]);
  line(ctx, inv, xs, ys, accent, 1.4, false);
}

// ---------- tables, stats, markout ----------
function renderTape(d) {
  els.tape.textContent = '';
  const last = d.trades.slice(-14).reverse();
  for (const [ts, price, qty, sideBuy, maker, taker] of last) {
    const tr = document.createElement('tr');
    const t0 = document.createElement('td'); t0.textContent = ts;
    const t1 = document.createElement('td'); t1.textContent = fmtPrice(price);
    t1.className = sideBuy ? 'buy' : 'sell';
    const t2 = document.createElement('td'); t2.textContent = qty;
    const t3 = document.createElement('td'); t3.textContent = taker;
    tr.append(t0, t1, t2, t3);
    els.tape.append(tr);
  }
}

function renderStats(d) {
  const s = d.stats;
  const cards = [
    ['final pnl', (s.finalPnlTicks >= 0 ? '+' : '-') + fmtMoney(s.finalPnlTicks).replace('-', ''), s.finalPnlTicks >= 0 ? 'pos' : 'neg'],
    ['fills', String(s.fills), ''],
    ['max drawdown', fmtMoney(s.maxDrawdownTicks), 'neg'],
    ['sharpe / tick', s.sharpePerTick.toFixed(3), ''],
    ['final inventory', String(s.finalInventory), ''],
    ['total trades', String(s.trades), ''],
  ];
  els.stats.textContent = '';
  for (const [k, v, cls] of cards) {
    const div = document.createElement('div');
    div.className = 'stat result-enter';
    const kk = document.createElement('div'); kk.className = 'k'; kk.textContent = k;
    const vv = document.createElement('div'); vv.className = 'v' + (cls ? ' ' + cls : ''); vv.textContent = v;
    div.append(kk, vv);
    els.stats.append(div);
  }
}

function renderMarkout(d) {
  const m = d.markout;
  const perUnit = (ticks, qty) => qty > 0 ? ticks / qty : 0;
  const blocks = [
    {
      who: 'noise flow', ticks: m.noiseTicks, qty: m.noiseQty,
      how: 'Random-side market orders. The bot earns the spread from these: buys low, sells high, and the price does not move against the fill.',
    },
    {
      who: 'informed flow', ticks: m.informedTicks, qty: m.informedQty,
      how: 'Trades that know where fair value is going. The bot fills them just before the price moves - the textbook cost of making markets.',
    },
  ];
  els.markout.textContent = '';
  for (const b of blocks) {
    const div = document.createElement('div');
    div.className = 'mo result-enter';
    const who = document.createElement('div'); who.className = 'who'; who.textContent = b.who + ' - mark-out, ' + m.horizon + ' ticks';
    const amt = document.createElement('div');
    amt.className = 'amt ' + (b.ticks >= 0 ? 'pos' : 'neg');
    amt.textContent = (b.ticks >= 0 ? '+' : '-') + fmtMoney(b.ticks).replace('-', '');
    const how = document.createElement('div'); how.className = 'how';
    how.textContent = b.how + ' (' + perUnit(b.ticks, b.qty).toFixed(2) + ' ticks per unit over ' + b.qty.toLocaleString('en-US') + ' units)';
    div.append(who, amt, how);
    els.markout.append(div);
  }
}

function renderAll() {
  const d = state.data;
  if (!d) return;
  els.priceSub.textContent = state.labels[state.current] + '. Fair value, the mid, and the bot\u2019s bid/ask around it.';
  drawPrice(d);
  drawDepth(d);
  drawPnl(d);
  drawInv(d);
  renderTape(d);
  renderStats(d);
  renderMarkout(d);
}

// ---------- live rerun ----------
const sliders = { vol: 'fundamentalVol', inf: 'informedProb', spr: 'baseHalfSpreadTicks', inv: 'maxInventory' };
function bindSliders() {
  for (const [id] of Object.entries(sliders)) {
    const el = $('sl-' + id), out = $('sl-' + id + '-v');
    const show = () => { out.textContent = el.value; };
    el.addEventListener('input', show);
    show();
  }
  els.rerun.addEventListener('click', () => {
    const p = defaultParams();
    p.fundamentalVol = +$('sl-vol').value;
    p.informedProb = +$('sl-inf').value;
    p.baseHalfSpreadTicks = +$('sl-spr').value;
    p.maxInventory = +$('sl-inv').value;
    p.seed = (Date.now() % 100000) | 0;
    const t0 = performance.now();
    const r = runSim(p);
    const ms = Math.round(performance.now() - t0);
    state.current = null;
    state.data = {
      name: 'custom', label: 'Custom run',
      params: p, series: r.series, trades: r.trades, stats: r.stats,
      markout: r.markout, depth: r.depth,
    };
    for (const b of els.scenarios.querySelectorAll('.pill')) b.classList.remove('active');
    els.priceSub.textContent = 'Custom run, seed ' + p.seed + ', computed in this tab in ' + ms + ' ms.';
    drawPrice(state.data); drawDepth(state.data); drawPnl(state.data); drawInv(state.data);
    renderTape(state.data); renderStats(state.data); renderMarkout(state.data);
  });
}

window.addEventListener('resize', () => { if (state.data) renderAll(); });

bindSliders();
loadScenarios().catch((e) => {
  els.priceSub.textContent = 'Could not load the scenario data: ' + e.message;
});
