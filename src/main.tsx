import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import App from './App';
import ProductExperience from './ProductExperience';
import './styles.css';
import './design-system.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <App />
        <ProductExperience />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
