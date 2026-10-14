/** Seeded PRNG (mulberry32): returns a function yielding uniform floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal deviate via Box-Muller from a uniform generator (consumes two uniforms). */
export function gaussian(rng: () => number): number {
  const u1 = 1 - rng(); // in (0, 1], avoids log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Seeded generator of standard normal deviates. */
export function seededGaussian(seed: number): () => number {
  const rng = mulberry32(seed);
  return () => gaussian(rng);
}
