import React from 'react';
import ReactDOM from 'react-dom/client';

import './index.css';
// Load the existing base styles before the scoped shell/Dashboard pilot styles.
import App from './App';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/query-client';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
