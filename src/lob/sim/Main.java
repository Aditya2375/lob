package lob.sim;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import lob.book.Side;
import lob.book.Trade;

/**
 * Generates the pinned scenario files the site replays. Usage:
 *   java lob.sim.Main <outDir>
 * Writes <outDir>/<name>.json per scenario plus index.json.
 */
public final class Main {
    public static void main(String[] args) throws IOException {
        Path out = Path.of(args.length > 0 ? args[0] : "docs/data");
        Files.createDirectories(out);

        write(out, "calm", "Calm two-sided flow", base(11));
        write(out, "volatile", "Volatile tape", volatile_(22));
        write(out, "informed", "Toxic, informed-heavy flow", informed(33));
        write(out, "flash", "Flash move", flash(44));

        Files.writeString(out.resolve("index.json"),
                "{\"scenarios\":[\"calm\",\"volatile\",\"informed\",\"flash\"],"
                + "\"labels\":{\"calm\":\"Calm two-sided flow\",\"volatile\":\"Volatile tape\","
                + "\"informed\":\"Toxic, informed-heavy flow\",\"flash\":\"Flash move\"},"
                + "\"tickSize\":0.01}\n");
        System.out.println("scenarios written to " + out);
    }

    private static Params base(long seed) {
        Params p = new Params();
        p.seed = seed;
        return p;
    }

    private static Params volatile_(long seed) {
        Params p = base(seed);
        p.fundamentalVol = 18;
        p.noiseProb = 0.45;
        return p;
    }

    private static Params informed(long seed) {
        Params p = base(seed);
        p.informedProb = 0.22;
        p.informedQtyMax = 40;
        return p;
    }

    private static Params flash(long seed) {
        Params p = base(seed);
        p.flashTick = 1000;
        p.flashJumpTicks = -600; // fair value drops 6.00 in one tick
        return p;
    }

    private static void write(Path out, String name, String label, Params p) throws IOException {
        Sim sim = new Sim(p);
        sim.run();
        Sim.Stats st = sim.stats();

        StringBuilder tapeJson = new StringBuilder("[");
        for (int i = 0; i < sim.tape.size(); i++) {
            Trade tr = sim.tape.get(i);
            if (i > 0) tapeJson.append(',');
            tapeJson.append('[').append(tr.ts).append(',').append(tr.priceTicks).append(',')
                    .append(tr.qty).append(',')
                    .append(tr.takerSide == Side.BUY ? 1 : 0).append(',')
                    .append(Json.quote(tr.maker)).append(',').append(Json.quote(tr.taker)).append(']');
        }
        tapeJson.append(']');

        String json = "{"
                + "\"name\":" + Json.quote(name) + ","
                + "\"label\":" + Json.quote(label) + ","
                + "\"params\":{"
                + "\"ticks\":" + p.ticks + ",\"seed\":" + p.seed
                + ",\"startPriceTicks\":" + p.startPriceTicks
                + ",\"fundamentalVol\":" + p.fundamentalVol
                + ",\"noiseProb\":" + p.noiseProb + ",\"informedProb\":" + p.informedProb
                + ",\"baseHalfSpreadTicks\":" + p.baseHalfSpreadTicks
                + ",\"volSpreadCoef\":" + p.volSpreadCoef
                + ",\"skewPerUnitTicks\":" + p.skewPerUnitTicks
                + ",\"quoteQty\":" + p.quoteQty + ",\"maxInventory\":" + p.maxInventory
                + ",\"requoteEvery\":" + p.requoteEvery
                + ",\"flashTick\":" + p.flashTick + ",\"flashJumpTicks\":" + p.flashJumpTicks
                + "},"
                + "\"series\":{"
                + "\"fundamental\":" + Json.longs(sim.fundamental) + ","
                + "\"mid\":" + Json.longs(sim.mid) + ","
                + "\"botBid\":" + Json.longs(sim.botBid) + ","
                + "\"botAsk\":" + Json.longs(sim.botAsk) + ","
                + "\"inventory\":" + Json.longs(sim.inventory) + ","
                + "\"pnl\":" + Json.longs(sim.pnl)
                + "},"
                + "\"trades\":" + tapeJson + ","
                + "\"stats\":{"
                + "\"finalPnlTicks\":" + st.finalPnlTicks + ","
                + "\"finalInventory\":" + st.finalInventory + ","
                + "\"fills\":" + st.fills + ",\"trades\":" + st.trades + ","
                + "\"maxDrawdownTicks\":" + st.maxDrawdownTicks + ","
                + "\"sharpePerTick\":" + String.format(java.util.Locale.ROOT, "%.4f", st.sharpePerTick)
                + "},"
                + "\"markout\":{"
                + "\"horizon\":50,"
                + "\"noiseTicks\":" + sim.markOuts("noise", 50)[0] + ","
                + "\"informedTicks\":" + sim.markOuts("informed", 50)[0] + ","
                + "\"noiseQty\":" + sim.markOuts("noise", 50)[1] + ","
                + "\"informedQty\":" + sim.markOuts("informed", 50)[1]
                + "},"
                + "\"depth\":{\"bids\":" + Json.depthRows(sim.book.depth(Side.BUY, 12))
                + ",\"asks\":" + Json.depthRows(sim.book.depth(Side.SELL, 12)) + "}"
                + "}\n";
        Files.writeString(out.resolve(name + ".json"), json);
        System.out.printf("%s: pnl=%.2f inv=%d fills=%d trades=%d maxDD=%.2f sharpe=%.3f moNoise=%.2f moInf=%.2f%n",
                name, st.finalPnlTicks / 100.0, st.finalInventory, st.fills, st.trades,
                st.maxDrawdownTicks / 100.0, st.sharpePerTick, sim.markOuts("noise", 50)[0] / 100.0, sim.markOuts("informed", 50)[0] / 100.0);
    }
}
