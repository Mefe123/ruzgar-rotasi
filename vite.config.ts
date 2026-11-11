import { defineConfig } from 'vite'

// base './' — herhangi bir statik barındırmada (GitHub Pages alt klasörü dahil) çalışır
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
})
