import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { setUnauthorizedHandler } from './api/client';
import { applyTheme, getStoredTheme } from './lib/theme';
import './i18n';
import './styles/global.css';

// Apply the saved theme synchronously, before React mounts, to avoid a
// flash of light-mode content while components are still rendering.
applyTheme(getStoredTheme());

setUnauthorizedHandler(() => {
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
