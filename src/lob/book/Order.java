package lob.book;

/** A resting or incoming order. Price is in integer ticks; quantity in units. */
public final class Order {
    public final long id;
    public final Side side;
    public final long priceTicks;
    public final long ts;
    public final String owner;
    public long remaining;

    public Order(long id, Side side, long priceTicks, long qty, long ts, String owner) {
        if (qty <= 0) throw new IllegalArgumentException("qty must be positive");
        this.id = id;
        this.side = side;
        this.priceTicks = priceTicks;
        this.remaining = qty;
        this.ts = ts;
        this.owner = owner;
    }

    public boolean filled() {
        return remaining == 0;
    }
}
