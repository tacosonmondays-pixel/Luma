import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { api } from './server/api.ts'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'luma-api',
      configureServer: (server) => void server.middlewares.use(api),
      configurePreviewServer: (server) => void server.middlewares.use(api),
    },
  ],
  server: { host: true, port: 4848 },
  preview: { host: true, port: 4848 },
  test: { include: ['test/**/*.test.ts'] },
})
