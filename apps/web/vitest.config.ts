import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'node',
    maxWorkers: 1,
    fileParallelism: false,
  },
});
