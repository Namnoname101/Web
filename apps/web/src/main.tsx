import React from 'react';
import ReactDOM from 'react-dom/client';

import './index.css';
// Load the existing base styles before the scoped shell/Dashboard pilot styles.
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
