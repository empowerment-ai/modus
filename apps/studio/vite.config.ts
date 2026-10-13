import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `standalone` builds one self-contained HTML file that runs offline (double-click to open).
// `BASE_PATH` lets CI publish the demo under a sub-path such as /modus/ on GitHub Pages.
// `MODUS_SERVER=http://localhost:8787 pnpm dev` sends /api (live stream included) to a running server,
// so the Monitor's Live mode works in development.
const server = process.env.MODUS_SERVER

export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), ...(mode === 'standalone' ? [viteSingleFile()] : [])],
  server: { port: 5180, ...(server ? { proxy: { '/api': { target: server, changeOrigin: true } } } : {}) },
  build: mode === 'standalone' ? { outDir: 'dist-standalone', chunkSizeWarningLimit: 4000 } : undefined,
}))
