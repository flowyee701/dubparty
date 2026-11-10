import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER = process.env.DUBPARTY_SERVER ?? 'http://localhost:3001';

// Режим https (pnpm dev:https) нужен, чтобы открыть dev-сервер с телефона в локальной сети:
// браузеры дают доступ к микрофону только в защищённом контексте.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
    // Dev-сервер доступен через Cloudflare Tunnel; свои домены — через DUBPARTY_ALLOWED_HOSTS.
    allowedHosts: [
      '.trycloudflare.com',
      ...(process.env.DUBPARTY_ALLOWED_HOSTS?.split(',').map((h) => h.trim()) ?? []),
    ],
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/socket.io': { target: SERVER, changeOrigin: true, ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
