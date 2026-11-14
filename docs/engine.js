// lob engine: matching engine, market simulation and market maker.
// Straight port of the Java core (src/lob), exact arithmetic on integer ticks.
// SplitMix64 bit ops use BigInt so seeds agree with the JDK side.

export const Side = { BUY: 0, SELL: 1 };

class Rng {
  constructor(seed) {
    this.state = BigInt(seed);
    this.spare = null;
  }
  nextLong() {
    this.state = (this.state + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & 0xFFFFFFFFFFFFFFFFn;
    return z ^ (z >> 31n);
  }
  nextDouble() {
    return Number(this.nextLong() >> 11n) * 2 ** -53;
  }
  chance(p) { return this.nextDouble() < p; }
  nextGaussian() {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
    let u, v, s;
    do {
      u = this.nextDouble() * 2 - 1;
      v = this.nextDouble() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * mul;
    return u * mul;
  }
  nextInt(lo, hi) {
    const span = BigInt(hi - lo + 1);
    let v = this.nextLong();
    if (v >= 0x8000000000000000n) v -= 0x10000000000000000n; // Java longs are signed
    const m = ((v % span) + span) % span; // Math.floorMod semantics
    return lo + Number(m);
  }
}

class Order {
  constructor(id, side, priceTicks, qty, ts, owner) {
    this.id = id; this.side = side; this.priceTicks = priceTicks;
    this.remaining = qty; this.ts = ts; this.owner = owner;
  }
}

export class OrderBook {
  constructor() {
    // bids: Map price -> queue, kept in a sorted key array (desc); asks asc.
    this.bids = new Map();
    this.asks = new Map();
    this.bidPrices = [];
    this.askPrices = [];
    this.live = new Map();
    this.nextId = 1;
    this.selfStopped = false;
  }
  _map(side) { return side === Side.BUY ? this.bids : this.asks; }
  _prices(side) { return side === Side.BUY ? this.bidPrices : this.askPrices; }
  _insertPrice(side, price) {
    const arr = this._prices(side);
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < price) lo = mid + 1; else hi = mid; }
    arr.splice(lo, 0, price);
  }
  _removePrice(side, price) {
    const arr = this._prices(side);
    const i = arr.indexOf(price);
    if (i >= 0) arr.splice(i, 1);
  }
  bestBid() { return this.bidPrices.length ? this.bidPrices[this.bidPrices.length - 1] : null; }
  bestAsk() { return this.askPrices.length ? this.askPrices[0] : null; }
  mid() {
    const b = this.bestBid(), a = this.bestAsk();
    return (b === null || a === null) ? null : Math.floor((b + a) / 2);
  }
  limit(side, priceTicks, qty, ts, owner) {
    const o = new Order(this.nextId++, side, priceTicks, qty, ts, owner);
    const trades = this._match(o);
    if (o.remaining > 0 && !this.selfStopped) {
      this.live.set(o.id, o);
      const m = this._map(side);
      if (!m.has(priceTicks)) { m.set(priceTicks, []); this._insertPrice(side, priceTicks); }
      m.get(priceTicks).push(o);
    }
    return trades;
  }
  market(side, qty, ts, owner) {
    const o = new Order(this.nextId++, side, side === Side.BUY ? Number.MAX_SAFE_INTEGER : 0, qty, ts, owner);
    return this._match(o);
  }
  cancel(id) {
    const o = this.live.get(id);
    if (!o) return false;
    this.live.delete(id);
    const m = this._map(o.side);
    const q = m.get(o.priceTicks);
    if (q) {
      const i = q.findIndex(x => x.id === id);
      if (i >= 0) q.splice(i, 1);
      if (q.length === 0) { m.delete(o.priceTicks); this._removePrice(o.side, o.priceTicks); }
    }
    return true;
  }
  cancelAll(owner) {
    const ids = [];
    for (const o of this.live.values()) if (o.owner === owner) ids.push(o.id);
    let n = 0;
    for (const id of ids) if (this.cancel(id)) n++;
    return n;
  }
  _match(taker) {
    this.selfStopped = false;
    const trades = [];
    const againstSide = taker.side === Side.BUY ? Side.SELL : Side.BUY;
    while (taker.remaining > 0) {
      const price = againstSide === Side.SELL ? this.bestAsk() : this.bestBid();
      if (price === null) break;
      const crosses = taker.side === Side.BUY ? price <= taker.priceTicks : price >= taker.priceTicks;
      if (!crosses) break;
      const q = this._map(againstSide).get(price);
      const maker = q[0];
      if (maker.owner === taker.owner) { this.selfStopped = true; break; }
      const qty = Math.min(maker.remaining, taker.remaining);
      maker.remaining -= qty;
      taker.remaining -= qty;
      trades.push({
        priceTicks: price, qty, ts: taker.ts,
        makerOrderId: maker.id, takerOrderId: taker.id,
        maker: maker.owner, taker: taker.owner, takerSide: taker.side,
      });
      if (maker.remaining === 0) {
        q.shift();
        this.live.delete(maker.id);
        if (q.length === 0) {
          this._map(againstSide).delete(price);
          this._removePrice(againstSide, price);
        }
      }
    }
    return trades;
  }
  depth(side, levels) {
    const m = this._map(side);
    const prices = side === Side.BUY ? [...this.bidPrices].reverse() : this.askPrices;
    const out = [];
    for (const pr of prices) {
      if (out.length === levels) break;
      let q = 0;
      for (const o of m.get(pr)) q += o.remaining;
      out.push([pr, q]);
    }
    return out;
  }
}

export class MarketMaker {
  static OWNER = 'mm';
  constructor(p) {
    this.p = p;
    this.cashTicks = 0;
    this.inventory = 0;
    this.fills = 0;
    this.midWindow = [];
  }
  onTrade(t) {
    const involved = t.maker === 'mm' || t.taker === 'mm';
    if (!involved) return;
    const botIsBuyer = (t.takerSide === Side.BUY && t.taker === 'mm')
        || (t.takerSide === Side.SELL && t.maker === 'mm');
    if (botIsBuyer) { this.cashTicks -= t.priceTicks * t.qty; this.inventory += t.qty; }
    else { this.cashTicks += t.priceTicks * t.qty; this.inventory -= t.qty; }
    this.fills++;
  }
  observeMid(mid) {
    this.midWindow.push(mid);
    if (this.midWindow.length > 100) this.midWindow.shift();
  }
  recentVol() {
    const w = this.midWindow, n = w.length;
    if (n < 3) return 0;
    let mean = 0;
    for (let i = 1; i < n; i++) mean += w[i] - w[i - 1];
    mean /= (n - 1);
    let v = 0;
    for (let i = 1; i < n; i++) { const d = (w[i] - w[i - 1]) - mean; v += d * d; }
    return Math.sqrt(v / (n - 1));
  }
  requote(book, fairTicks) {
    book.cancelAll('mm');
    const mid = book.mid();
    const anchor = mid !== null ? mid : fairTicks;
    const half = this.p.baseHalfSpreadTicks + Math.round(this.p.volSpreadCoef * this.recentVol());
    const skew = Math.round(this.p.skewPerUnitTicks * this.inventory);
    let bid = anchor - half - skew;
    let ask = anchor + half - skew;
    if (bid <= 0) bid = 1;
    if (ask <= bid) ask = bid + 1;
    if (this.inventory < this.p.maxInventory) book.limit(Side.BUY, bid, this.p.quoteQty, 0, 'mm');
    else bid = 0;
    if (this.inventory > -this.p.maxInventory) book.limit(Side.SELL, ask, this.p.quoteQty, 0, 'mm');
    else ask = 0;
    return [bid, ask];
  }
  pnl(markTicks) { return this.cashTicks + this.inventory * markTicks; }
}

export const defaultParams = () => ({
  ticks: 2000, seed: 1, startPriceTicks: 10000, fundamentalVol: 6,
  noiseProb: 0.30, noiseQtyMax: 20, informedProb: 0.06, informedQtyMax: 30,
  baseHalfSpreadTicks: 8, volSpreadCoef: 0.8, skewPerUnitTicks: 0.15,
  quoteQty: 10, maxInventory: 200, requoteEvery: 2, flashTick: -1, flashJumpTicks: 0,
});

export function runSim(p) {
  const book = new OrderBook();
  const mm = new MarketMaker(p);
  const rng = new Rng(p.seed);
  const n = p.ticks;
  const fundamental = new Array(n), midA = new Array(n), botBid = new Array(n),
      botAsk = new Array(n), inventory = new Array(n), pnl = new Array(n);
  const tape = [];
  const fills = [], fillCp = [];
  let fair = p.startPriceTicks;
  let lastTradePrice = p.startPriceTicks;
  const effectiveMid = () => { const m = book.mid(); return m !== null ? m : lastTradePrice; };

  const absorb = (trades) => {
    for (const tr of trades) {
      tape.push(tr);
      lastTradePrice = tr.priceTicks;
      if (tr.maker === 'mm' || tr.taker === 'mm') {
        const botBuy = (tr.takerSide === Side.BUY && tr.taker === 'mm')
            || (tr.takerSide === Side.SELL && tr.maker === 'mm');
        fills.push([tr.ts, tr.priceTicks, botBuy ? tr.qty : -tr.qty]);
        fillCp.push(tr.taker === 'mm' ? tr.maker : tr.taker);
      }
      mm.onTrade(tr);
    }
  };

  for (let t = 0; t < n; t++) {
    fair += Math.round(p.fundamentalVol * rng.nextGaussian());
    if (t === p.flashTick) fair += p.flashJumpTicks;
    if (fair < 1) fair = 1;
    if (rng.chance(p.noiseProb)) {
      const s = rng.chance(0.5) ? Side.BUY : Side.SELL;
      absorb(book.market(s, rng.nextInt(1, p.noiseQtyMax), t, 'noise'));
    }
    if (rng.chance(p.informedProb)) {
      const m = effectiveMid();
      if (fair !== m) {
        absorb(book.market(fair > m ? Side.BUY : Side.SELL, rng.nextInt(1, p.informedQtyMax), t, 'informed'));
      }
    }
    if (t % p.requoteEvery === 0) {
      const q = mm.requote(book, fair);
      botBid[t] = q[0]; botAsk[t] = q[1];
    } else if (t > 0) {
      botBid[t] = botBid[t - 1]; botAsk[t] = botAsk[t - 1];
    }
    if (t % 5 === 0) {
      book.cancelAll('bg');
      const b = book.bestBid(), a = book.bestAsk();
      const refBid = b !== null ? b : fair - 10;
      const refAsk = a !== null ? a : fair + 10;
      for (const g of [1, 6, 15, 30]) {
        const bp = refBid - g;
        if (bp > 0) book.limit(Side.BUY, bp, rng.nextInt(5, 40), 0, 'bg');
        book.limit(Side.SELL, refAsk + g, rng.nextInt(5, 40), 0, 'bg');
      }
    }
    const mark = effectiveMid();
    mm.observeMid(mark);
    fundamental[t] = fair; midA[t] = mark;
    inventory[t] = mm.inventory; pnl[t] = mm.pnl(mark);
  }

  const markOuts = (cp, horizon) => {
    let total = 0, qty = 0;
    for (let i = 0; i < fills.length; i++) {
      if (fillCp[i] !== cp) continue;
      const later = Math.min(fills[i][0] + horizon, n - 1);
      total += (fundamental[later] - fills[i][1]) * fills[i][2];
      qty += Math.abs(fills[i][2]);
    }
    return [total, qty];
  };

  let peak = -Infinity, maxDd = 0, mean = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, pnl[i]);
    maxDd = Math.max(maxDd, peak - pnl[i]);
    if (i > 0) mean += pnl[i] - pnl[i - 1];
  }
  mean /= (n - 1);
  let v = 0;
  for (let i = 1; i < n; i++) { const d = (pnl[i] - pnl[i - 1]) - mean; v += d * d; }
  const sd = Math.sqrt(v / (n - 1));

  return {
    series: { fundamental, mid: midA, botBid, botAsk, inventory, pnl },
    trades: tape.map(tr => [tr.ts, tr.priceTicks, tr.qty, tr.takerSide === Side.BUY ? 1 : 0, tr.maker, tr.taker]),
    stats: {
      finalPnlTicks: pnl[n - 1], finalInventory: inventory[n - 1], fills: mm.fills,
      trades: tape.length, maxDrawdownTicks: maxDd, sharpePerTick: sd > 0 ? mean / sd : 0,
    },
    markout: {
      horizon: 50, noiseTicks: markOuts('noise', 50)[0], informedTicks: markOuts('informed', 50)[0],
      noiseQty: markOuts('noise', 50)[1], informedQty: markOuts('informed', 50)[1],
    },
    depth: { bids: book.depth(Side.BUY, 12), asks: book.depth(Side.SELL, 12) },
  };
}
