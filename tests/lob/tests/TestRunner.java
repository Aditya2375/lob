package lob.tests;

import java.util.List;
import lob.book.OrderBook;
import lob.book.Side;
import lob.book.Trade;

public final class TestRunner {
    static int passed = 0, failed = 0;

    static void check(String name, boolean cond) {
        if (cond) { passed++; System.out.println("  ok  " + name); }
        else { failed++; System.out.println("FAIL  " + name); }
    }

    public static void main(String[] args) {
        // 1. resting orders, best bid/ask
        OrderBook b = new OrderBook();
        check("empty book has no best", b.bestBid() == null && b.bestAsk() == null && b.mid() == null);
        b.limit(Side.BUY, 100, 10, 1, "a");
        b.limit(Side.BUY, 99, 5, 2, "a");
        b.limit(Side.SELL, 103, 7, 3, "b");
        check("best bid/ask", b.bestBid() == 100 && b.bestAsk() == 103);
        check("mid", b.mid() == 101);
        check("no trades on rest", b.liveOrderCount() == 3);

        // 2. crossing limit fills at maker price
        List<Trade> t = b.limit(Side.BUY, 103, 4, 4, "c");
        check("cross fills at maker price", t.size() == 1 && t.get(0).priceTicks == 103 && t.get(0).qty == 4);
        check("maker/taker recorded", t.get(0).maker.equals("b") && t.get(0).taker.equals("c"));

        // 3. partial fill, remainder rests
        t = b.limit(Side.BUY, 103, 10, 5, "c");
        check("partial fill consumes maker", t.size() == 1 && t.get(0).qty == 3);
        check("taker remainder rests at 103", b.bestBid() == 103 && b.liveOrderCount() == 3);

        // 4. FIFO within a level
        OrderBook f = new OrderBook();
        f.limit(Side.SELL, 100, 5, 1, "first");
        f.limit(Side.SELL, 100, 5, 2, "second");
        t = f.market(Side.BUY, 6, 3, "taker");
        check("fifo: first fills fully", t.size() == 2 && t.get(0).qty == 5 && t.get(0).maker.equals("first"));
        check("fifo: second partially", t.get(1).qty == 1 && t.get(1).maker.equals("second"));

        // 5. market order walks levels
        OrderBook w = new OrderBook();
        w.limit(Side.SELL, 101, 3, 1, "m");
        w.limit(Side.SELL, 102, 3, 2, "m");
        w.limit(Side.SELL, 105, 10, 3, "m");
        t = w.market(Side.BUY, 5, 4, "t");
        check("walks two levels", t.size() == 2 && t.get(0).priceTicks == 101 && t.get(1).priceTicks == 102);
        check("leaves ask 102 with 1 behind it", w.bestAsk() == 102);

        // 6. cancel
        OrderBook c = new OrderBook();
        c.limit(Side.BUY, 100, 10, 1, "a");
        long id = 1;
        check("cancel existing", c.cancel(id) && c.bestBid() == null);
        check("cancel unknown", !c.cancel(999));

        // 7. self-match cancelled back, book untouched
        OrderBook s = new OrderBook();
        s.limit(Side.SELL, 100, 5, 1, "same");
        t = s.limit(Side.BUY, 105, 5, 2, "same");
        check("self-match: no trade", t.isEmpty());
        check("self-match: nothing rests on bid side", s.bestBid() == null && s.bestAsk() == 100);

        // 8. depth snapshot, best first
        OrderBook d = new OrderBook();
        d.limit(Side.BUY, 100, 5, 1, "x");
        d.limit(Side.BUY, 98, 2, 2, "x");
        d.limit(Side.SELL, 101, 4, 3, "y");
        var bids = d.depth(Side.BUY, 5);
        var asks = d.depth(Side.SELL, 5);
        check("depth bids best-first", bids.size() == 2 && bids.get(0)[0] == 100 && bids.get(0)[1] == 5 && bids.get(1)[0] == 98);
        check("depth asks", asks.size() == 1 && asks.get(0)[0] == 101 && asks.get(0)[1] == 4);

        System.out.println(passed + " passed, " + failed + " failed");
        if (failed > 0) System.exit(1);
    }

    static {
        // --- sim tests appended to the same run ---
        // 9. cancelAll by owner
        OrderBook o = new OrderBook();
        o.limit(Side.BUY, 100, 5, 1, "mm");
        o.limit(Side.BUY, 99, 5, 2, "bg");
        o.limit(Side.SELL, 101, 5, 3, "mm");
        check("cancelAll removes only the owner's", o.cancelAll("mm") == 2 && o.bestBid() == 99 && o.bestAsk() == null);

        // 10. PnL accounting identity on a known sequence
        lob.sim.Params pp = new lob.sim.Params();
        pp.ticks = 400;
        pp.seed = 7;
        lob.sim.Sim sim = new lob.sim.Sim(pp);
        sim.run();
        long cash = 0, inv = 0;
        for (Trade tr : sim.tape) {
            boolean mmBuy = (tr.takerSide == Side.BUY && tr.taker.equals("mm"))
                    || (tr.takerSide == Side.SELL && tr.maker.equals("mm"));
            boolean involved = tr.maker.equals("mm") || tr.taker.equals("mm");
            if (!involved) continue;
            if (mmBuy) { cash -= tr.priceTicks * tr.qty; inv += tr.qty; }
            else { cash += tr.priceTicks * tr.qty; inv -= tr.qty; }
        }
        check("pnl identity: cash + inv*mark == tracked pnl",
                cash + inv * sim.mid[sim.mid.length - 1] == sim.pnl[sim.pnl.length - 1]);
        check("inventory identity", inv == sim.inventory[sim.inventory.length - 1]);

        // 11. determinism: same seed, byte-identical final pnl
        lob.sim.Sim s2 = new lob.sim.Sim(pp);
        s2.run();
        check("deterministic per seed", s2.pnl[s2.pnl.length - 1] == sim.pnl[sim.pnl.length - 1]
                && s2.tape.size() == sim.tape.size());

        // 12. adverse selection shows up: informed mark-out negative on the informed scenario
        lob.sim.Params ip = new lob.sim.Params();
        ip.seed = 33;
        ip.informedProb = 0.22;
        ip.informedQtyMax = 40;
        lob.sim.Sim is = new lob.sim.Sim(ip);
        is.run();
        check("informed mark-out is negative", is.markOuts("informed", 50)[0] < 0);
        check("noise mark-out is positive", is.markOuts("noise", 50)[0] > 0);
    }
}
