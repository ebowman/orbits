/**
 * Reusable 3D heliocentric scene. Props-driven; reads no store.
 *
 * Units: 1 scene unit = 1 AU. Display frame is ecliptic J2000.
 * Axis mapping (ecliptic -> three.js, right-handed): (x, y, z) -> (x, z, -y), so ecliptic north (+z)
 * is three's up axis (+y), the vernal equinox (+x) stays +x, and the ecliptic plane is three's XZ plane.
 *
 * Input conventions:
 *  - orbits[].elements: OrbitalElements (ecliptic J2000), sampled by sampleOrbit.
 *  - points[].pos, rays[].from, rays[].dir: J2000 EQUATORIAL vectors in AU (what astro state/observer
 *    functions return); the component converts them to ecliptic for display. dir need not be unit length.
 *  - rays[].length: drawn length in AU.
 *  - jd (TT): if given, each orbit gets a marker at its body position at that time.
 *
 * Rendering is on demand (frameloop="demand"); geometry is memoized and disposed by R3F on unmount.
 */
import { useMemo, useState } from 'react';
import { Vector3 } from 'three';
import { Canvas } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { planetElements, unit, type OrbitalElements, type PlanetName, type Vec3 } from '@astro';
import { bodyPositionEcliptic, sampleOrbit, toDisplay } from './geometry';

export type SceneOrbit = { elements: OrbitalElements; color: string; label: string; dashed?: boolean };
export type ScenePoint = { pos: Vec3; color: string; label: string };
export type SceneRay = { from: Vec3; dir: Vec3; length: number; color: string; label: string };
export type OrbitSceneProps = {
  orbits?: SceneOrbit[];
  points?: ScenePoint[];
  rays?: SceneRay[];
  /** Julian date (TT) for body markers on each orbit. */
  jd?: number;
  /** Initial value of the "other planets" toggle. */
  showPlanets?: boolean;
  height?: number | string;
};

/** Ecliptic (x,y,z) -> three.js (x,z,-y). */
export const eclToScene = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];

const PLANETS: { name: PlanetName; color: string }[] = [
  { name: 'Mercury', color: '#9a9a9a' },
  { name: 'Venus', color: '#d8b46a' },
  { name: 'Mars', color: '#c1533a' },
  { name: 'Jupiter', color: '#c9a77c' },
  { name: 'Saturn', color: '#b9a36b' },
];
const X_AXIS = new Vector3(1, 0, 0);
const ORIGIN = new Vector3(0, 0, 0);
const REF_JD = 2451545.0;
const LABEL_STYLE = { fontSize: 11, color: '#ddd', whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none' } as const;

function Label({ pos, color, children }: { pos: Vec3; color?: string; children: string }) {
  return (
    <Html position={pos} style={{ ...LABEL_STYLE, color: color ?? '#ddd' }} zIndexRange={[10, 0]}>
      <span style={{ marginLeft: 8 }}>{children}</span>
    </Html>
  );
}

function OrbitLine({ o }: { o: SceneOrbit }) {
  const pts = useMemo(() => sampleOrbit(o.elements, 512).map((p) => eclToScene(p)), [o.elements]);
  return <Line points={pts} color={o.color} lineWidth={1.2} dashed={o.dashed} dashSize={0.08} gapSize={0.05} />;
}

function Marker({ pos, color, label, r = 0.035 }: { pos: Vec3; color: string; label: string; r?: number }) {
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[r, 16, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Label pos={[0, 0, 0]} color={color}>
        {label}
      </Label>
    </group>
  );
}

function RayLine({ r }: { r: SceneRay }) {
  const { pts, tip } = useMemo(() => {
    const from = eclToScene(toDisplay(r.from));
    const d = eclToScene(toDisplay(unit(r.dir)));
    const end: Vec3 = [from[0] + d[0] * r.length, from[1] + d[1] * r.length, from[2] + d[2] * r.length];
    return { pts: [from, end] as Vec3[], tip: end };
  }, [r.from, r.dir, r.length]);
  return (
    <>
      <Line points={pts} color={r.color} lineWidth={1.5} />
      <Label pos={tip} color={r.color}>
        {r.label}
      </Label>
    </>
  );
}

function Scene({ orbits, points, rays, jd, showPlanets }: Required<Pick<OrbitSceneProps, 'orbits' | 'points' | 'rays' | 'showPlanets'>> & { jd?: number }) {
  const earth = useMemo(() => planetElements('EMBary', jd ?? REF_JD), [jd]);
  const planets = useMemo(
    () => PLANETS.map((p) => ({ ...p, el: planetElements(p.name, REF_JD) })),
    [],
  );
  const extent = useMemo(() => {
    let m = 2;
    for (const o of orbits) m = Math.max(m, o.elements.a * (1 + o.elements.e) || 0);
    if (showPlanets) m = Math.max(m, 10);
    return Math.min(Math.ceil(m), 12);
  }, [orbits, showPlanets]);
  const markers = useMemo(
    () => (jd === undefined ? [] : orbits.map((o) => ({ pos: eclToScene(bodyPositionEcliptic(o.elements, jd)), o }))),
    [orbits, jd],
  );
  return (
    <>
      <gridHelper args={[extent * 2, extent * 2, '#556', '#2a2a3a']} />
      <mesh>
        <sphereGeometry args={[0.06, 24, 16]} />
        <meshBasicMaterial color="#ffd54a" />
      </mesh>
      <Label pos={[0, 0.1, 0]} color="#ffd54a">
        Sun
      </Label>
      <OrbitLine o={{ elements: earth, color: '#4aa3ff', label: 'Earth' }} />
      {showPlanets && planets.map((p) => <OrbitLine key={p.name} o={{ elements: p.el, color: p.color, label: p.name, dashed: true }} />)}
      {orbits.map((o, i) => (
        <OrbitLine key={`${o.label}-${i}`} o={o} />
      ))}
      {markers.map((m, i) => (
        <Marker key={`m-${m.o.label}-${i}`} pos={m.pos} color={m.o.color} label={m.o.label} />
      ))}
      {jd !== undefined && <Marker pos={eclToScene(bodyPositionEcliptic(earth, jd))} color="#4aa3ff" label="Earth" />}
      {points.map((p, i) => (
        <Marker key={`p-${i}`} pos={eclToScene(toDisplay(p.pos))} color={p.color} label={p.label} r={0.025} />
      ))}
      {rays.map((r, i) => (
        <RayLine key={`r-${i}`} r={r} />
      ))}
      {/* vernal equinox arrow (+x) */}
      <arrowHelper args={[X_AXIS, ORIGIN, 1.5, '#ff6b6b', 0.15, 0.08]} />
      <Label pos={[1.6, 0, 0]} color="#ff6b6b">
        {'vernal equinox (+x)'}
      </Label>
      <OrbitControls makeDefault enableDamping={false} />
    </>
  );
}

export default function OrbitScene({ orbits = [], points = [], rays = [], jd, showPlanets: initialPlanets = false, height = 420 }: OrbitSceneProps) {
  const [showPlanets, setShowPlanets] = useState(initialPlanets);
  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <label style={{ position: 'absolute', zIndex: 1, top: 6, left: 8, fontSize: 12, color: '#ddd' }}>
        <input type="checkbox" checked={showPlanets} onChange={(e) => setShowPlanets(e.target.checked)} /> other planets
      </label>
      <Canvas frameloop="demand" camera={{ position: [0, 4, 6], fov: 50, near: 0.01, far: 1000 }} style={{ background: '#0b0d14' }}>
        <Scene orbits={orbits} points={points} rays={rays} jd={jd} showPlanets={showPlanets} />
      </Canvas>
    </div>
  );
}
