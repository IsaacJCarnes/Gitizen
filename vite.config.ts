import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri runs `npm run dev` and loads the page from this server, so the port
// must stay fixed (it matches build.devUrl in src-tauri/tauri.conf.json).
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  // Keep Rust compiler output visible in the terminal.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // The Rust side is rebuilt by the Tauri CLI, not Vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // WebView2 (Windows) and WebKit (macOS/Linux) are both modern engines.
    target: 'es2021',
  },
})
