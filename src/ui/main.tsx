import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './workspace.css';
import './calendar.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
