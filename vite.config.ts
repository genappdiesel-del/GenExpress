import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Cloudflare Pages builds this project as a static site.
// VITE_ variables are baked in at BUILD time, not read at runtime.
// That means changing a Supabase key later requires a new deploy.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Cloudflare Pages has a 25 MB limit per asset file.
    // Splitting the vendor code keeps any single file well under it.
    rollupOptions: {
      output: {
        // Function form: the object form is not typed for Rollup 4.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'supabase'
            if (id.includes('react')) return 'react'
            return 'vendor'
          }
          return undefined
        },
      },
    },
  },
})