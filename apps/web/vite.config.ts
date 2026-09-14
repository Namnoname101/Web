import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // npm workspaces also install Prisma Studio's React 18 dependency. Some icon
  // packages can otherwise resolve that copy while the app runs on React 19,
  // producing opaque "older version" element crashes in development.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
