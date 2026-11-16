import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {preloadRoute} from './lib/routePrefetch';

if (typeof window !== 'undefined') {
  preloadRoute(window.location.pathname);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
