package lob.sim;

/** Deterministic PRNG (SplitMix64) with Gaussian draws via Box-Muller. */
public final class Rng {
    private long state;
    private double spare = Double.NaN;

    public Rng(long seed) {
        this.state = seed;
    }

    public long nextLong() {
        state += 0x9E3779B97F4A7C15L;
        long z = state;
        z = (z ^ (z >>> 30)) * 0xBF58476D1CE4E5B9L;
        z = (z ^ (z >>> 27)) * 0x94D049BB133111EBL;
        return z ^ (z >>> 31);
    }

    /** Uniform double in [0, 1). */
    public double nextDouble() {
        return (nextLong() >>> 11) * 0x1.0p-53;
    }

    public boolean chance(double p) {
        return nextDouble() < p;
    }

    /** Standard normal. */
    public double nextGaussian() {
        if (!Double.isNaN(spare)) {
            double v = spare;
            spare = Double.NaN;
            return v;
        }
        double u, v, s;
        do {
            u = nextDouble() * 2 - 1;
            v = nextDouble() * 2 - 1;
            s = u * u + v * v;
        } while (s >= 1 || s == 0);
        double mul = Math.sqrt(-2 * Math.log(s) / s);
        spare = v * mul;
        return u * mul;
    }

    /** Uniform int in [lo, hi] inclusive. */
    public int nextInt(int lo, int hi) {
        return lo + (int) (Math.floorMod(nextLong(), (long) hi - lo + 1));
    }
}
