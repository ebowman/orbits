/**
 * IAU H-G absolute-magnitude system (Bowell et al. 1989).
 * V = H + 5 log10(r * delta) - 2.5 log10((1-G) phi1 + G phi2)
 * phi_i = exp(-A_i tan(alpha/2)^B_i); (A1,B1) = (3.33, 0.63), (A2,B2) = (1.87, 1.22).
 */
export function hgMagnitude(H: number, G: number, rHelioAu: number, deltaAu: number, phaseRad: number): number {
  const t = Math.tan(phaseRad / 2);
  const phi1 = Math.exp(-3.33 * t ** 0.63);
  const phi2 = Math.exp(-1.87 * t ** 1.22);
  return H + 5 * Math.log10(rHelioAu * deltaAu) - 2.5 * Math.log10((1 - G) * phi1 + G * phi2);
}
