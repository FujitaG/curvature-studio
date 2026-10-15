import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false },
  worker: {
    format: 'es'
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
