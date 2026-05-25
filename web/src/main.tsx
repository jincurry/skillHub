import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { setUnauthorizedHandler } from './api/client';
import { applyTheme, getStoredTheme } from './lib/theme';
import { ToastHost } from './components/ToastHost';
import './i18n';
import './styles/global.css';

// Apply the saved theme synchronously, before React mounts, to avoid a
// flash of light-mode content while components are still rendering.
applyTheme(getStoredTheme());

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

setUnauthorizedHandler(() => {
  if (window.location.pathname !== basePath + '/login') {
    window.location.assign(basePath + '/login');
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basePath}>
      <App />
      <ToastHost />
    </BrowserRouter>
  </React.StrictMode>
);
