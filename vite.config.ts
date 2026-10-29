import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Local dev: the API runs on :3001 (backend `npm run dev`). On Vercel, VITE_API_URL points at the VPS.
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
})
