import process from 'node:process'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

const apiProxy = { '/api': { target: process.env.DENTELLE_API_URL || 'http://127.0.0.1:3001', changeOrigin: false } }

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: { proxy: apiProxy },
  resolve: { alias: { events: 'events/', url: 'url/' } },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    // The loader is served as ESM in development, but its codec factories are
    // CommonJS. Explicitly pre-bundle these subpaths to provide default exports.
    include: [
      'dicom-parser',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-libjxl/decodewasmjs',
    ],
  },
  worker: { format: 'es' },
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
})
