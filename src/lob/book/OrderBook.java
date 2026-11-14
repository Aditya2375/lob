package lob.book;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Limit order book with price-time priority. Limit orders rest until matched;
 * market orders walk the opposite side. Self-match by the same owner is
 * rejected: the incoming order is cancelled back rather than trading with
 * itself. Prices are integer ticks, so arithmetic is exact.
 */
public final class OrderBook {
    private final TreeMap<Long, PriceLevel> bids = new TreeMap<>(); // ascending; lastKey = best bid
    private final TreeMap<Long, PriceLevel> asks = new TreeMap<>(); // ascending; firstKey = best ask
    private final Map<Long, Order> live = new HashMap<>();
    private long nextId = 1;

    private boolean selfStopped;

    public List<Trade> limit(Side side, long priceTicks, long qty, long ts, String owner) {
        Order o = new Order(nextId++, side, priceTicks, qty, ts, owner);
        List<Trade> trades = match(o);
        // selfStopped: remainder was cancelled back, never rests against itself
        if (!o.filled() && !selfStopped) {
            live.put(o.id, o);
            sideMap(side).computeIfAbsent(priceTicks, PriceLevel::new).queue.addLast(o);
        }
        return trades;
    }

    public List<Trade> market(Side side, long qty, long ts, String owner) {
        // A market order never rests; price limit is the far rail.
        Order o = new Order(nextId++, side, side == Side.BUY ? Long.MAX_VALUE : 0, qty, ts, owner);
        return match(o);
    }

    public boolean cancel(long orderId) {
        Order o = live.remove(orderId);
        if (o == null) return false;
        TreeMap<Long, PriceLevel> m = sideMap(o.side);
        PriceLevel lvl = m.get(o.priceTicks);
        if (lvl != null && lvl.remove(orderId) && lvl.queue.isEmpty()) {
            m.remove(o.priceTicks);
        }
        return true;
    }

    private List<Trade> match(Order taker) {
        selfStopped = false;
        List<Trade> trades = new ArrayList<>();
        TreeMap<Long, PriceLevel> against = sideMap(taker.side.opposite());
        while (taker.remaining > 0 && !against.isEmpty()) {
            Map.Entry<Long, PriceLevel> best = taker.side == Side.BUY
                    ? against.firstEntry() : against.lastEntry();
            if (best == null) break;
            long price = best.getKey();
            boolean crosses = taker.side == Side.BUY ? price <= taker.priceTicks : price >= taker.priceTicks;
            if (!crosses) break;
            PriceLevel lvl = best.getValue();
            Order maker = lvl.queue.peekFirst();
            if (maker.owner.equals(taker.owner)) {
                // Self-match: cancel back the incoming remainder, leave the book untouched.
                selfStopped = true;
                break;
            }
            long qty = Math.min(maker.remaining, taker.remaining);
            maker.remaining -= qty;
            taker.remaining -= qty;
            trades.add(new Trade(price, qty, taker.ts, maker, taker));
            if (maker.filled()) {
                lvl.queue.pollFirst();
                live.remove(maker.id);
                if (lvl.queue.isEmpty()) against.remove(price);
            }
        }
        return trades;
    }

    private TreeMap<Long, PriceLevel> sideMap(Side s) {
        return s == Side.BUY ? bids : asks;
    }

    public Long bestBid() {
        return bids.isEmpty() ? null : bids.lastKey();
    }

    public Long bestAsk() {
        return asks.isEmpty() ? null : asks.firstKey();
    }

    public Long mid() {
        Long b = bestBid(), a = bestAsk();
        return (b == null || a == null) ? null : (b + a) / 2;
    }

    /** Cancel every resting order owned by owner. Returns how many were cancelled. */
    public int cancelAll(String owner) {
        List<Long> ids = new ArrayList<>();
        for (Order o : live.values()) {
            if (o.owner.equals(owner)) ids.add(o.id);
        }
        int n = 0;
        for (long id : ids) if (cancel(id)) n++;
        return n;
    }

    public int liveOrderCount() {
        return live.size();
    }

    /** Snapshot of one side, best first: [priceTicks, totalQty] pairs, up to depth levels. */
    public List<long[]> depth(Side side, int levels) {
        List<long[]> out = new ArrayList<>();
        var map = side == Side.BUY ? bids.descendingMap() : asks;
        for (var e : map.entrySet()) {
            if (out.size() == levels) break;
            out.add(new long[]{e.getKey(), e.getValue().totalQty()});
        }
        return out;
    }
}
