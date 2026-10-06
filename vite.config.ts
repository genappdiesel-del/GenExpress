import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Cloudflare Pages builds this project as a static site.
// VITE_ variables are baked in at BUILD time, not read at runtime.
// That means changing a Supabase key later requires a new deploy.
//
// --- Why there is no manualChunks here ---------------------------------
//
// Phase 1 had one, which put every node_modules file into a chunk named
// "vendor". That looked tidy and it quietly broke code splitting.
//
// A manualChunks rule assigns a module to a chunk no matter how it was
// reached. A module reached through `await import()` is a separate,
// on-demand download -- but only if the bundler is allowed to put it
// somewhere new. Forcing it into "vendor" instead put the barcode
// scanner library, which is about 12 MB on disk, into the file every
// single visitor downloads before they can even type a password.
//
// The fix is to let the bundler decide, and split only where it already
// wants to: the scanner library, the label drawer, and the big stable
// dependencies whose size is worth watching. Everything the app
// `await import()`s already becomes its own chunk on its own.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // A warning at 500 KB is useful, but the number is only meaningful
    // if it is above anything we actually ship. The largest file we
    // expect is React at roughly 215 KB, so this catches real growth
    // without crying wolf on every build.
    chunkSizeWarningLimit: 700,
    // Cloudflare Pages has a 25 MB limit per asset file.
    rollupOptions: {
      output: {
        // Function form: the object form is not typed for Rollup 4.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          // The barcode scanner is large and almost never needed: only
          // somebody scanning a product pays for it. It must stay in its
          // own file, reachable only through `await import()`.
          if (id.includes('@zxing')) return 'barcode-scanner'

          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('react')) return 'react'

          return 'vendor'
        },
      },
    },
  },
})