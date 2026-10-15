import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { jdUtcToTt, loadCatalog, utcToJd, type OrbitalElements } from '@astro';

const OrbitScene = lazy(() => import('../scene/OrbitScene'));

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function SceneDemo() {
  const [jd] = useState(() => jdUtcToTt(utcToJd(new Date())));
  const demo = useMemo(() => {
    const cat = loadCatalog();
    const ceres = cat.find((c) => c.name === 'Ceres' || c.name.includes('Ceres'));
    if (!ceres || 'planet' in ceres.body) return { orbits: [] };
    return { orbits: [{ elements: ceres.body as OrbitalElements, color: '#7fe0a0', label: 'Ceres' }] };
  }, []);
  if (!webglAvailable()) return <p>WebGL not available</p>;
  return (
    <Suspense fallback={<p>Loading 3D scene...</p>}>
      <OrbitScene orbits={demo.orbits} jd={jd} />
    </Suspense>
  );
}

export default function HomePage() {
  return (
    <section>
      <h1>Orbits</h1>
      <p>
        Three well-spaced observations of a solar-system object (right ascension, declination and the time of each) are enough to
        determine its orbit. Each one gives a line of sight from a moving Earth; Gauss&apos;s and Laplace&apos;s methods find the
        distances along those lines for which the object follows a Kepler orbit around the Sun. This app lets you plan the
        observations, enter your own, solve for the orbital elements, and see how the methods work.
      </p>
      <ol>
        <li>
          <Link to="/plan">Plan</Link>: what is observable tonight, and suggested nights for three good observations.
        </li>
        <li>
          <Link to="/observe">Observe</Link>: enter RA/Dec and times (or generate a synthetic set from a catalog orbit).
        </li>
        <li>
          <Link to="/solve">Solve</Link>: run Gauss and Laplace and compare with the catalog elements.
        </li>
        <li>
          Learn: step through <Link to="/learn/gauss">Gauss</Link> and <Link to="/learn/laplace">Laplace</Link>, or{' '}
          <Link to="/explore">Explore</Link> how noise and spacing affect them.
        </li>
      </ol>
      <SceneDemo />
      <h2>Credits and sources</h2>
      <ul>
        <li>JPL Small-Body Database (SBDB): asteroid orbital elements and H, G magnitudes.</li>
        <li>JPL Horizons: reference astrometry used for validation fixtures and observatory coordinates.</li>
        <li>Standish, approximate planetary positions (JPL): the Earth model.</li>
        <li>Meeus, Astronomical Algorithms: time, sidereal time and ephemeris conventions.</li>
        <li>Curtis, Orbital Mechanics for Engineering Students, and Escobal, Methods of Orbit Determination: the IOD methods.</li>
      </ul>
    </section>
  );
}
