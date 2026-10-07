/** @type {import('vite').ViteConfig} */
import { fileURLToPath } from 'url'

const tracker = 'v3.0-fix'

export default {
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  css: [
    './src/index.css',
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
    ],
  },
}