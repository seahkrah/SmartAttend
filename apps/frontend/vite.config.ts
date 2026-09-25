import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The dev server proxies /api to the backend.
 *
 * Twenty-six pages and components call the API with a relative `/api/...`
 * URL, which is right in production — the two are served from one origin —
 * and in development depends entirely on this proxy. It pointed at port 3000
 * while the backend has always defaulted to 5000 and its own .env pins 5000,
 * so every one of those pages answered an empty 500 locally and had done for
 * as long as the proxy has existed.
 *
 * The target follows the same variable the backend reads, so the two cannot
 * drift apart again by editing one of them.
 */
const target = process.env.VITE_API_PROXY_TARGET
  || `http://127.0.0.1:${process.env.PORT || 5000}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
      },
    },
  },
})
