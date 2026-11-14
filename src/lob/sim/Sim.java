package lob.sim;

import java.util.ArrayList;
import java.util.List;
import lob.book.OrderBook;
import lob.book.Side;
import lob.book.Trade;

/**
 * One simulated session: a fair-value random walk, noise and informed
 * takers, and one market maker quoting into the book. Deterministic for a
 * given Params.seed. Series are captured per tick for charting.
 */
public final class Sim {
    public final Params p;
    public final OrderBook book = new OrderBook();
    public final MarketMaker mm;

    public long[] fundamental, mid, botBid, botAsk, inventory, pnl;
    public final List<Trade> tape = new ArrayList<>();
    // bot fills with their counterparty, for mark-out attribution
    public final List<long[]> fills = new ArrayList<>(); // ts, price, signedQty(+buy), 
    public final List<String> fillCp = new ArrayList<>();

    public Sim(Params p) {
        this.p = p;
        this.mm = new MarketMaker(p);
    }

    public void run() {
        int n = p.ticks;
        fundamental = new long[n];
        mid = new long[n];
        botBid = new long[n];
        botAsk = new long[n];
        inventory = new long[n];
        pnl = new long[n];

        Rng rng = new Rng(p.seed);
        long fair = p.startPriceTicks;
        long lastTradePrice = p.startPriceTicks;

        for (int t = 0; t < n; t++) {
            fair += Math.round(p.fundamentalVol * rng.nextGaussian());
            if (t == p.flashTick) fair += p.flashJumpTicks;
            if (fair < 1) fair = 1;

            // Noise flow: random-side market orders.
            if (rng.chance(p.noiseProb)) {
                Side s = rng.chance(0.5) ? Side.BUY : Side.SELL;
                absorb(book.market(s, rng.nextInt(1, p.noiseQtyMax), t, "noise"));
            }
            // Informed flow: trades toward fair value when the mid is off.
            if (rng.chance(p.informedProb)) {
                Long m = effectiveMid(lastTradePrice);
                if (m != null && fair != m) {
                    Side s = fair > m ? Side.BUY : Side.SELL;
                    absorb(book.market(s, rng.nextInt(1, p.informedQtyMax), t, "informed"));
                }
            }
            // Market maker cancel+replace cycle.
            if (t % p.requoteEvery == 0) {
                long[] q = mm.requote(book, fair);
                botBid[t] = q[0];
                botAsk[t] = q[1];
            } else if (t > 0) {
                botBid[t] = botBid[t - 1];
                botAsk[t] = botAsk[t - 1];
            }
            // Background depth: passive levels behind the bot's fresh quotes so
            // the ladder is real and oversize market orders walk into worse prices.
            if (t % 5 == 0) {
                topUpBackground(rng, fair);
            }

            long mark = effectiveMid(lastTradePrice);
            mm.observeMid(mark);
            fundamental[t] = fair;
            mid[t] = mark;
            inventory[t] = mm.inventory();
            pnl[t] = mm.pnl(mark);
        }
    }

    private void topUpBackground(Rng rng, long fair) {
        book.cancelAll("bg");
        Long b = book.bestBid(), a = book.bestAsk();
        long refBid = b != null ? b : fair - 10;
        long refAsk = a != null ? a : fair + 10;
        int[] gaps = {1, 6, 15, 30};
        for (int g : gaps) {
            long bp = refBid - g;
            if (bp > 0) book.limit(Side.BUY, bp, rng.nextInt(5, 40), 0, "bg");
            book.limit(Side.SELL, refAsk + g, rng.nextInt(5, 40), 0, "bg");
        }
    }

    private Long effectiveMid(long fallback) {
        Long m = book.mid();
        return m != null ? m : fallback;
    }

    private void absorb(List<Trade> trades) {
        for (Trade tr : trades) {
            tape.add(tr);
            if (tr.maker.equals(MarketMaker.OWNER) || tr.taker.equals(MarketMaker.OWNER)) {
                boolean botBuy = (tr.takerSide == Side.BUY && tr.taker.equals(MarketMaker.OWNER))
                        || (tr.takerSide == Side.SELL && tr.maker.equals(MarketMaker.OWNER));
                fills.add(new long[]{tr.ts, tr.priceTicks, botBuy ? tr.qty : -tr.qty});
                fillCp.add(tr.taker.equals(MarketMaker.OWNER) ? tr.maker : tr.taker);
            }
            mm.onTrade(tr);
        }
    }

    /** Adverse-selection attribution: signed mark-out of each bot fill to fair value 50 ticks later. */
    public long[] markOuts(String counterparty, int horizon) {
        long total = 0, qty = 0;
        for (int i = 0; i < fills.size(); i++) {
            if (!fillCp.get(i).equals(counterparty)) continue;
            long[] f = fills.get(i);
            int later = (int) Math.min(f[0] + horizon, fundamental.length - 1);
            total += (fundamental[later] - f[1]) * f[2];
            qty += Math.abs(f[2]);
        }
        return new long[]{total, qty};
    }

    /** Headline stats over the run. */
    public Stats stats() {
        Stats s = new Stats();
        s.finalPnlTicks = pnl[pnl.length - 1];
        s.finalInventory = inventory[inventory.length - 1];
        s.fills = mm.fills();
        s.trades = tape.size();

        long peak = Long.MIN_VALUE, maxDd = 0;
        double mean = 0;
        for (int i = 0; i < pnl.length; i++) {
            peak = Math.max(peak, pnl[i]);
            maxDd = Math.max(maxDd, peak - pnl[i]);
            if (i > 0) mean += pnl[i] - pnl[i - 1];
        }
        mean /= (pnl.length - 1);
        double var = 0;
        for (int i = 1; i < pnl.length; i++) {
            double d = (pnl[i] - pnl[i - 1]) - mean;
            var += d * d;
        }
        double sd = Math.sqrt(var / (pnl.length - 1));
        s.maxDrawdownTicks = maxDd;
        s.sharpePerTick = sd > 0 ? mean / sd : 0;
        return s;
    }

    public static final class Stats {
        public long finalPnlTicks;
        public long finalInventory;
        public int fills;
        public int trades;
        public long maxDrawdownTicks;
        public double sharpePerTick;
    }
}
