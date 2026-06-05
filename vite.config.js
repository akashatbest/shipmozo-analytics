import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/shipmozo-analytics/',
  plugins: [react(), tailwindcss()],
  build: {
    // Raise warning threshold (we know it's big; chunks below handle it)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split vendor libs into separate cached chunks.
        // Browsers cache these across deploys — only app code changes re-download.
        manualChunks(id) {
          // Chart.js + react-chartjs-2 (~400KB) — only loads on chart pages
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) {
            return 'vendor-charts'
          }
          // Supabase client
          if (id.includes('@supabase')) {
            return 'vendor-supabase'
          }
          // React core + router
          if (id.includes('react-dom') || id.includes('react-router')) {
            return 'vendor-react'
          }
          // PapaParse (CSV parsing — only needed on Upload page)
          if (id.includes('papaparse')) {
            return 'vendor-papaparse'
          }
        },
      },
    },
  },
})
