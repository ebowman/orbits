import { lazy, Suspense, useMemo, useState } from 'react';
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
      <p>Initial orbit determination from three nights of RA/Dec.</p>
      <SceneDemo />
    </section>
  );
}
