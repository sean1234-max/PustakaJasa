import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Pure-function unit tests only for now (no DOM). Parser/component tests
    // that need `DOMParser` etc. can add `environment: 'jsdom'` per-file with
    // a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
