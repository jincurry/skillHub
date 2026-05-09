import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { setUnauthorizedHandler } from './api/client';
import './styles/global.css';

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
