import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Placeholder entry point; the full UI arrives in Day 2.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
