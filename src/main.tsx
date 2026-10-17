import { Capacitor } from '@capacitor/core';
import React from 'react';
import RuntimeErrorBoundary from './RuntimeErrorBoundary';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import App from './App';
import ProductExperience from './ProductExperience';
import './styles.css';
import './design-system.css';
import './premium-polish.css';

if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL }).catch(() => {
      // Service-worker registration is an enhancement; core online workflows remain available.
    });
  });
}

function BootSignal() {
  React.useEffect(() => {
    document.documentElement.dataset.simorghReady = 'true';
    document.getElementById('app-boot-screen')?.remove();
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RuntimeErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <BootSignal />
          <App />
          <ProductExperience />
        </AuthProvider>
      </BrowserRouter>
    </RuntimeErrorBoundary>
  </React.StrictMode>,
);
