import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';

const el = document.getElementById('root');
if (!el) throw new Error('Root element not found');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
