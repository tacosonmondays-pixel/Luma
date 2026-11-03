import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { api } from './server/api.ts'

export default defineConfig({
  // '/' for the helper; GitHub Pages builds with LUMA_BASE=/Luma/.
  base: process.env.LUMA_BASE || '/',
  plugins: [
    react(),
    {
      name: 'luma-api',
      configureServer: (server) => void server.middlewares.use(api),
      configurePreviewServer: (server) => void server.middlewares.use(api),
    },
    {
      // GitHub Pages answers unknown paths with 404.html: make it the app, so deep links open.
      name: 'luma-pages-404',
      apply: () => Boolean(process.env.LUMA_BASE),
      enforce: 'post',
      generateBundle(_, bundle) {
        const index = bundle['index.html']
        if (index?.type === 'asset') this.emitFile({ type: 'asset', fileName: '404.html', source: index.source })
      },
    },
  ],
  server: { host: true, port: 4848 },
  preview: { host: true, port: 4848 },
  test: { include: ['test/**/*.test.ts'] },
})
