import { defineConfig } from 'vite';
export default defineConfig({
  worker: { format: 'es' },
  server: {
    port: Number(process.env.MANDATE_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 3001}` },
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
