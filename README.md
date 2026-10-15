# Orbits

A single-page web app for initial orbit determination (IOD): give it three observations (RA/Dec and time) of an
asteroid and it computes the orbital elements with Gauss's method and Laplace's method, compares them with the
catalog, and walks through how each method works. Everything runs in the browser; the app never fetches data at runtime.

## Routes

The app uses a hash router, so it works on any static host.

| Route | Page |
| --- | --- |
| `/#/` | Home: the idea, links into the flow, a 3D orbit demo, credits |
| `/#/plan` | Plan: what is observable tonight (visibility, alt/az, magnitude) and suggested nights |
| `/#/observe` | Observe: enter observations and sites, or generate a synthetic set |
| `/#/solve` | Solve: run Gauss and Laplace, compare with catalog elements, residuals, candidate roots |
| `/#/learn/gauss` | Step-by-step Gauss walkthrough with a 3D scene |
| `/#/learn/laplace` | Step-by-step Laplace walkthrough, classical vs refined |
| `/#/explore` | Noise and spacing sensitivity of Gauss vs classical Laplace (runs in a Web Worker) |

## Making real measurements

1. Photograph the target on three nights (spacing of several days up to a few weeks works best; very short arcs are
   ill-conditioned).
2. Get RA/Dec from each photo by plate solving, for example with [astrometry.net](https://nova.astrometry.net).
3. Record the exact UTC time of each exposure. Time accuracy matters: an asteroid moves tens of arcseconds per
   minute, so a time error of a few seconds is already comparable to your astrometric error.
4. Enter the observatory in the Observe page (latitude, longitude, height) and the three observations.
5. Optionally add a 4th observation as a check. It is not used in the solve; it resolves the multi-root ambiguity
   (several physically valid roots of the Gauss polynomial) by picking the candidate that best predicts it, and the
   Solve page reports its residual for each candidate.

Synthetic sets (Observe page, "Synthetic observations") generate observations from a catalog orbit with optional
seeded noise, and optionally a 4th check observation, which is useful for trying the app without a telescope.

## Development

```bash
npm install
npm run dev         # Vite dev server
npm run build       # tsc --noEmit && vite build -> dist/
npm run preview     # serve dist/
npm test            # vitest unit tests (node env; jsdom per file)
npm run lint        # eslint (src/astro must stay framework-free)
npm run typecheck   # tsc --noEmit
npm run test:e2e    # Playwright smoke test (chromium); builds and serves dist/ itself
```

The first e2e run needs a browser: `npx playwright install chromium`. The e2e specs live in `e2e/` and are not run
by `npm test`. They use ports 4179 (preview) and 4180 (the same `dist/` under `/sub/orbits/`, to check that the
relative `base: './'` works on a sub-path host such as GitHub Pages). The smoke test generates a synthetic Ceres set,
solves it, asserts the Gauss semi-major axis is within 1% of the catalog value, and visits every route asserting there
are no console or page errors.

`npm run build` emits a static `dist/` with relative asset paths that can be hosted from any directory.

## Data refresh

`npm run fetch-data` (Node 18+, no dependencies) downloads asteroid elements from JPL SBDB into `src/data/catalog.json`
and Horizons astrometry fixtures into `tests/fixtures/horizons`. The outputs are committed; refresh only when you want
newer elements.

## Known simplifications

- Two-body (Kepler) motion only: no planetary perturbations. The catalog elements are osculating at their own
  epoch, so comparisons at another epoch carry a small perturbation error that grows with the time interval.
- The Earth is the Standish approximate ephemeris, not a full JPL ephemeris.
- No nutation, and the observatory's sidereal rotation is applied directly to the J2000 axes (precession, polar motion
  ignored; a small topocentric offset, see `src/astro/observer.ts`).
- The iterated ("refined") Laplace method converges to essentially the same answer as Gauss, since both then solve the
  same two-body problem with exact f and g functions; the interesting difference is the classical, non-iterated
  Laplace result, which is sensitive to short arcs and noise.
- Predicted positions are light-time corrected, but there is no aberration or light deflection.

## Credits and sources

- JPL Small-Body Database and Horizons (orbital elements, H/G, validation astrometry, site coordinates)
- E. M. Standish, approximate positions of the planets (JPL)
- J. Meeus, Astronomical Algorithms
- H. Curtis, Orbital Mechanics for Engineering Students; P. R. Escobal, Methods of Orbit Determination
