import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {peekCachedAuthRole} from './hooks/useAuth';
import {preloadRoute} from './lib/routePrefetch';

if (typeof window !== 'undefined') {
  const path = window.location.pathname;
  if (path === '/' || path === '') {
    const cachedRole = peekCachedAuthRole();
    preloadRoute(cachedRole === 'admin' ? '/admin' : cachedRole ? '/inventory' : '/auth');
  } else {
    preloadRoute(path);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
