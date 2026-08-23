import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/extract': 'http://127.0.0.1:8000',
      '/ask': 'http://127.0.0.1:8000',
      '/uploads': 'http://127.0.0.1:8000',
      '/api': 'http://127.0.0.1:8000',
    },
  },
});

