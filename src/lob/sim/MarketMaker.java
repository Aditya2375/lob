package lob.sim;

import java.util.ArrayList;
import java.util.List;
import lob.book.OrderBook;
import lob.book.Side;
import lob.book.Trade;

/**
 * The market-making bot. Every requoteEvery ticks it cancels its resting
 * orders and posts a fresh bid/ask pair. Anchor is the last mid (the first
 * cycle anchors to fair value to bootstrap an empty book). Half-spread grows
 * with recent mid volatility; both quotes shift against inventory, and the
 * bot stops adding on a side once inventory hits its cap.
 */
public final class MarketMaker {
    public static final String OWNER = "mm";

    private final Params p;
    private long cashTicks = 0;   // proceeds, in ticks x units
    private long inventory = 0;   // units held
    private int fills = 0;

    // recent mid moves for the volatility estimate, chronological
    private final java.util.ArrayDeque<Long> midWindow = new java.util.ArrayDeque<>();

    public MarketMaker(Params p) {
        this.p = p;
    }

    public void onTrade(Trade t) {
        boolean botIsBuyer = (t.takerSide == Side.BUY && t.taker.equals(OWNER))
                || (t.takerSide == Side.SELL && t.maker.equals(OWNER));
        boolean involved = t.maker.equals(OWNER) || t.taker.equals(OWNER);
        if (!involved) return;
        if (botIsBuyer) {
            cashTicks -= t.priceTicks * t.qty;
            inventory += t.qty;
        } else {
            cashTicks += t.priceTicks * t.qty;
            inventory -= t.qty;
        }
        fills++;
    }

    public void observeMid(long mid) {
        midWindow.addLast(mid);
        if (midWindow.size() > 100) midWindow.removeFirst();
    }

    /** Std-dev of recent mid changes, in ticks. 0 until enough data. */
    public double recentVol() {
        int n = midWindow.size();
        if (n < 3) return 0;
        Long[] w = midWindow.toArray(new Long[0]);
        double mean = 0;
        for (int i = 1; i < n; i++) mean += w[i] - w[i - 1];
        mean /= (n - 1);
        double var = 0;
        for (int i = 1; i < n; i++) {
            double d = (w[i] - w[i - 1]) - mean;
            var += d * d;
        }
        return Math.sqrt(var / (n - 1));
    }

    /** Cancel-replace cycle. Returns the two quotes [bidTicks, askTicks]; 0 for a side it will not post. */
    public long[] requote(OrderBook book, long fairTicks) {
        book.cancelAll(OWNER);
        Long mid = book.mid();
        long anchor = mid != null ? mid : fairTicks;
        long half = p.baseHalfSpreadTicks + Math.round(p.volSpreadCoef * recentVol());
        long skew = Math.round(p.skewPerUnitTicks * inventory);
        long bid = anchor - half - skew;
        long ask = anchor + half - skew;
        if (bid <= 0) bid = 1;
        if (ask <= bid) ask = bid + 1;

        long ts = 0; // caller stamps trades through the book clock; quote ts is bookkeeping only
        if (inventory < p.maxInventory) {
            book.limit(Side.BUY, bid, p.quoteQty, ts, OWNER);
        } else {
            bid = 0;
        }
        if (inventory > -p.maxInventory) {
            book.limit(Side.SELL, ask, p.quoteQty, ts, OWNER);
        } else {
            ask = 0;
        }
        return new long[]{bid, ask};
    }

    public long cashTicks() { return cashTicks; }
    public long inventory() { return inventory; }
    public int fills() { return fills; }

    /** Total PnL marked at the given price, in ticks. */
    public long pnl(long markTicks) {
        return cashTicks + inventory * markTicks;
    }
}
