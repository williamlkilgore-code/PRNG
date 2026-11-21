import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';
import { loadSheet } from './render/sprites.js';
import './ui/styles.css';

loadSheet().then(() => {
  createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
});
