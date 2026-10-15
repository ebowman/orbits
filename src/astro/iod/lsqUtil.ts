/** Wrap an angle difference (radians) into [-pi, pi]. */
export function wrapRadSigned(d: number): number {
  let x = d % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  else if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}
