import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { useStore } from './store';
import HomePage from './pages/HomePage';
import PlanPage from './pages/PlanPage';
import ObservePage from './pages/ObservePage';
import SolvePage from './pages/SolvePage';
import LearnGaussPage from './pages/LearnGaussPage';
import LearnLaplacePage from './pages/LearnLaplacePage';
import ExplorePage from './pages/ExplorePage';

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/plan', label: 'Plan' },
  { to: '/observe', label: 'Observe' },
  { to: '/solve', label: 'Solve' },
  { to: '/learn/gauss', label: 'Gauss' },
  { to: '/learn/laplace', label: 'Laplace' },
  { to: '/explore', label: 'Explore' },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const nightMode = useStore((s) => s.nightMode);
  const toggleNightMode = useStore((s) => s.toggleNightMode);
  return (
    <header className="app-header">
      <span className="brand">Orbits</span>
      <button
        type="button"
        className="nav-menu-button"
        aria-label="Toggle navigation menu"
        aria-expanded={open}
        aria-controls="nav-links"
        onClick={() => setOpen((o) => !o)}
      >
        Menu
      </button>
      <nav id="nav-links" className={open ? 'nav-links open' : 'nav-links'} aria-label="Main">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end onClick={() => setOpen(false)}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <button type="button" aria-pressed={nightMode} onClick={toggleNightMode}>
        Red night mode: {nightMode ? 'on' : 'off'}
      </button>
    </header>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/plan" element={<PlanPage />} />
      <Route path="/observe" element={<ObservePage />} />
      <Route path="/solve" element={<SolvePage />} />
      <Route path="/learn/gauss" element={<LearnGaussPage />} />
      <Route path="/learn/laplace" element={<LearnLaplacePage />} />
      <Route path="/explore" element={<ExplorePage />} />
    </Routes>
  );
}

export function Layout() {
  const nightMode = useStore((s) => s.nightMode);
  useEffect(() => {
    document.documentElement.dataset.night = nightMode ? 'red' : 'dark';
  }, [nightMode]);
  return (
    <>
      <Nav />
      <main className="app-main">
        <AppRoutes />
      </main>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Layout />
    </HashRouter>
  );
}
