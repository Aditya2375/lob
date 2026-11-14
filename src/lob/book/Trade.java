package lob.book;

/** One executed trade: taker crossed a resting maker order. */
public final class Trade {
    public final long priceTicks;
    public final long qty;
    public final long ts;
    public final long makerOrderId;
    public final long takerOrderId;
    public final String maker;
    public final String taker;
    public final Side takerSide;

    public Trade(long priceTicks, long qty, long ts, Order maker, Order taker) {
        this.priceTicks = priceTicks;
        this.qty = qty;
        this.ts = ts;
        this.makerOrderId = maker.id;
        this.takerOrderId = taker.id;
        this.maker = maker.owner;
        this.taker = taker.owner;
        this.takerSide = taker.side;
    }
}
