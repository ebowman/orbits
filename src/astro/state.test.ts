import { describe, expect, it } from 'vitest';
import { GM_SUN } from './constants';
import { meanMotion, periodDays, perihelionQ, timeOfPerihelion, type OrbitalElements } from './elements';
import { elementsToState, stateToElements } from './state';
import { propagate, lagrangeFG } from './propagate';
import { norm, sub, type Vec3 } from './vec';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrap = (d: number) => Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
const mk = (o: Partial<OrbitalElements>): OrbitalElements => ({
  a: 2.5, e: 0.3, i: 0.4, Omega: 1.1, omega: 2.2, M0: 0.7, epochJd: 2460000.5, frame: 'eclipticJ2000', ...o,
});
const dist = (a: Vec3, b: Vec3) => norm(sub(a, b));

describe('elements helpers', () => {
  it('period, q, n, Tp', () => {
    const el = mk({ a: 1, e: 0.5, M0: 0.1 });
    expect(periodDays(el)).toBeCloseTo(365.2568983, 4);
    expect(perihelionQ(el)).toBeCloseTo(0.5, 12);
    expect(timeOfPerihelion(el)).toBeCloseTo(el.epochJd - 0.1 / meanMotion(1), 9);
    expect(periodDays(mk({ a: -2, e: 1.5 }))).toBe(Infinity);
    expect(perihelionQ(mk({ a: -2, e: 1.5 }))).toBeCloseTo(1, 12);
  });
});

describe('round trip', () => {
  it('200 random elliptic orbits', () => {
    const rand = rng(12345);
    for (let k = 0; k < 200; k++) {
      const el = mk({
        a: 0.5 + rand() * 30,
        e: 0.05 + rand() * 0.9,
        i: 0.05 + rand() * (Math.PI - 0.1),
        Omega: rand() * 2 * Math.PI,
        omega: rand() * 2 * Math.PI,
        M0: rand() * 2 * Math.PI,
      });
      const jd = el.epochJd + rand() * 1000;
      const { r, v } = elementsToState(el, jd);
      const { elements: b, warnings } = stateToElements(r, v, jd);
      expect(warnings).toEqual([]);
      expect(Math.abs(b.a - el.a) / el.a).toBeLessThan(1e-10);
      expect(Math.abs(b.e - el.e) / el.e).toBeLessThan(1e-10);
      expect(Math.abs(b.i - el.i) / el.i).toBeLessThan(1e-10);
      expect(wrap(b.Omega - el.Omega)).toBeLessThan(1e-10);
      expect(wrap(b.omega - el.omega)).toBeLessThan(1e-10);
      const Mexp = el.M0 + meanMotion(el.a) * (jd - el.epochJd);
      expect(wrap(b.M0 - Mexp)).toBeLessThan(1e-10);
      expect(b.epochJd).toBe(jd);
    }
  });
  it('hyperbolic round trip', () => {
    const el = mk({ a: -3, e: 1.5, M0: -0.8 });
    const { r, v } = elementsToState(el, el.epochJd);
    const { elements: b } = stateToElements(r, v, el.epochJd);
    expect(b.a).toBeCloseTo(el.a, 9);
    expect(b.e).toBeCloseTo(el.e, 9);
    expect(wrap(b.omega - el.omega)).toBeLessThan(1e-9);
    expect(b.M0).toBeCloseTo(el.M0, 9);
  });
  it('circular inclined: omega=0, M from node', () => {
    const el = mk({ e: 0, omega: 0, M0: 1.3 });
    const { r, v } = elementsToState(el, el.epochJd);
    const { elements: b } = stateToElements(r, v, el.epochJd);
    expect(b.omega).toBe(0);
    expect(wrap(b.M0 - 1.3)).toBeLessThan(1e-9);
    expect(wrap(b.Omega - el.Omega)).toBeLessThan(1e-9);
  });
  it('equatorial eccentric: Omega=0', () => {
    for (const i of [0, Math.PI]) {
      const el = mk({ i, Omega: 0, omega: 0.9, e: 0.4 });
      const { r, v } = elementsToState(el, el.epochJd);
      const { elements: b } = stateToElements(r, v, el.epochJd);
      expect(b.Omega).toBe(0);
      expect(b.i).toBeCloseTo(i, 9);
      expect(wrap(b.omega - 0.9)).toBeLessThan(1e-9);
      expect(wrap(b.M0 - 0.7)).toBeLessThan(1e-9);
    }
  });
  it('circular and equatorial', () => {
    const el = mk({ i: 0, Omega: 0, omega: 0, e: 0, M0: 2.0 });
    const { r, v } = elementsToState(el, el.epochJd);
    const { elements: b } = stateToElements(r, v, el.epochJd);
    expect(b.Omega).toBe(0);
    expect(b.omega).toBe(0);
    expect(wrap(b.M0 - 2.0)).toBeLessThan(1e-9);
  });
  it('near-parabolic: no NaN, warning flagged', () => {
    for (const e of [1 - 1e-10, 1, 1 + 1e-10]) {
      const q = 1;
      const mu = GM_SUN;
      const r: Vec3 = [q, 0, 0];
      const vmag = Math.sqrt((mu * (1 + e)) / q);
      const { elements: b, warnings } = stateToElements(r, [0, vmag, 0.0], 2460000.5, mu);
      for (const x of [b.a, b.e, b.i, b.Omega, b.omega, b.M0]) expect(Number.isFinite(x)).toBe(true);
      expect(warnings.length).toBeGreaterThan(0);
    }
  });
  it('throws on degenerate state', () => {
    expect(() => stateToElements([1, 0, 0], [1, 0, 0], 0)).toThrow();
  });
});

describe('propagate', () => {
  it('full period returns to start (several eccentricities)', () => {
    for (const e of [0.1, 0.6, 0.95]) {
      const el = mk({ a: 2.7, e });
      const { r, v } = elementsToState(el, el.epochJd);
      const P = periodDays(el);
      const end = propagate(r, v, P);
      expect(dist(end.r, r)).toBeLessThan(1e-9);
      expect(dist(end.v, v)).toBeLessThan(1e-9);
      const back = propagate(r, v, -P);
      expect(dist(back.r, r)).toBeLessThan(1e-9);
    }
  });
  it('matches elementsToState at later/earlier times', () => {
    const rand = rng(777);
    for (let k = 0; k < 40; k++) {
      const el = mk({ a: 0.8 + rand() * 10, e: rand() * 0.9, i: rand() * 3, Omega: rand() * 6, omega: rand() * 6, M0: rand() * 6 });
      const s0 = elementsToState(el, el.epochJd);
      const dt = (rand() - 0.5) * 2000;
      const s1 = elementsToState(el, el.epochJd + dt);
      const p = propagate(s0.r, s0.v, dt);
      expect(dist(p.r, s1.r)).toBeLessThan(1e-10);
      expect(dist(p.v, s1.v)).toBeLessThan(1e-10);
    }
  });
  it('hyperbolic matches elementsToState, forward and backward', () => {
    const el = mk({ a: -2, e: 1.8, M0: -1.5 });
    const s0 = elementsToState(el, el.epochJd);
    for (const dt of [-300, -10, 10, 200, 800]) {
      const s1 = elementsToState(el, el.epochJd + dt);
      const p = propagate(s0.r, s0.v, dt);
      expect(dist(p.r, s1.r)).toBeLessThan(1e-9);
      expect(dist(p.v, s1.v)).toBeLessThan(1e-9);
    }
  });
  it('near-parabolic propagation is finite and consistent', () => {
    const el = mk({ a: 500, e: 1 - 1 / 500, M0: -0.001, omega: 0.3 });
    const s0 = elementsToState(el, el.epochJd);
    const s1 = elementsToState(el, el.epochJd + 50);
    const p = propagate(s0.r, s0.v, 50);
    expect(dist(p.r, s1.r)).toBeLessThan(1e-9);
  });
  it('lagrange f,g satisfy f*gdot - fdot*g = 1; dt=0 is identity', () => {
    const el = mk({});
    const { r, v } = elementsToState(el, el.epochJd);
    for (const dt of [-40, 0, 25, 400]) {
      const c = lagrangeFG(r, v, dt);
      expect(c.f * c.gdot - c.fdot * c.g).toBeCloseTo(1, 11);
    }
    const z = propagate(r, v, 0);
    expect(dist(z.r, r)).toBe(0);
  });
});
