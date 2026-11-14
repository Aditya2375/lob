package lob.sim;

/** Knobs for one simulated run. Prices are integer ticks (100 ticks = 1.00). */
public final class Params {
    public int ticks = 2000;
    public long seed = 1;
    public long startPriceTicks = 100_00;      // 100.00
    public double fundamentalVol = 6;          // per-tick sigma of the fair-value walk, in ticks
    public double noiseProb = 0.30;            // chance a noise trader sends a market order each tick
    public int noiseQtyMax = 20;
    public double informedProb = 0.06;         // chance an informed trader hits the mispricing
    public int informedQtyMax = 30;

    // Market maker
    public long baseHalfSpreadTicks = 8;       // 0.08
    public double volSpreadCoef = 0.8;         // extra half-spread per tick of recent volatility
    public double skewPerUnitTicks = 0.15;     // quote shift per unit of inventory, in ticks
    public int quoteQty = 10;
    public int maxInventory = 200;             // hard cap; bot stops adding on the offending side
    public int requoteEvery = 2;               // ticks between cancel+replace cycles

    // Optional flash move: at flashTick the fundamental jumps by flashJumpTicks.
    public int flashTick = -1;
    public long flashJumpTicks = 0;
}
