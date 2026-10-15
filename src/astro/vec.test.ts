import { describe, expect, it } from 'vitest';
import { add, cross, dot, norm, rotateX, rotateZ, scale, sub, unit, type Vec3 } from './vec';

const a: Vec3 = [1, 2, 3];
const b: Vec3 = [-4, 0.5, 2];

describe('vec', () => {
  it('basic arithmetic', () => {
    expect(add(a, b)).toEqual([-3, 2.5, 5]);
    expect(sub(a, b)).toEqual([5, 1.5, 1]);
    expect(scale(a, 2)).toEqual([2, 4, 6]);
    expect(dot(a, b)).toBeCloseTo(-4 + 1 + 6, 12);
    expect(norm([3, 4, 0])).toBe(5);
  });
  it('cross/dot identities', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    const c = cross(a, b);
    expect(dot(c, a)).toBeCloseTo(0, 12);
    expect(dot(c, b)).toBeCloseTo(0, 12);
    expect(cross(a, b)).toEqual(scale(cross(b, a), -1));
    // Lagrange: |a x b|^2 = |a|^2|b|^2 - (a.b)^2
    expect(dot(c, c)).toBeCloseTo(dot(a, a) * dot(b, b) - dot(a, b) ** 2, 10);
  });
  it('unit and zero vector', () => {
    expect(norm(unit(a))).toBeCloseTo(1, 14);
    expect(() => unit([0, 0, 0])).toThrow(/zero/);
  });
  it('rotations', () => {
    const x = rotateZ([1, 0, 0], Math.PI / 2);
    expect(x[0]).toBeCloseTo(0, 14);
    expect(x[1]).toBeCloseTo(1, 14);
    const y = rotateX([0, 1, 0], Math.PI / 2);
    expect(y[1]).toBeCloseTo(0, 14);
    expect(y[2]).toBeCloseTo(1, 14);
    expect(norm(rotateX(rotateZ(a, 0.7), -1.1))).toBeCloseTo(norm(a), 12);
  });
});
