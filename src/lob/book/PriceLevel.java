package lob.book;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;

/** One price level on one side: FIFO queue of resting orders (price-time priority). */
final class PriceLevel {
    final long priceTicks;
    final Deque<Order> queue = new ArrayDeque<>();

    PriceLevel(long priceTicks) {
        this.priceTicks = priceTicks;
    }

    long totalQty() {
        long q = 0;
        for (Order o : queue) q += o.remaining;
        return q;
    }

    /** Remove a cancelled order by id. Returns true if found. */
    boolean remove(long orderId) {
        for (Iterator<Order> it = queue.iterator(); it.hasNext();) {
            if (it.next().id == orderId) {
                it.remove();
                return true;
            }
        }
        return false;
    }
}
