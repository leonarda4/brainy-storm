import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, normalizePath } from 'vite'

const envDir = fileURLToPath(new URL('../', import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '')
  const hotReload = env.FRONTEND_HMR === 'true'
  const runtimeDirectories = ['data', 'pubsub', '.runtime'].map(name => normalizePath(fileURLToPath(new URL(`../${name}/`, import.meta.url))).replace(/\/$/, ''))
  const envFiles = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`].map(name => normalizePath(`${envDir}${name}`))
  return {
    envDir,
    // Only VITE_* variables become browser code; private API keys stay on servers.
    envPrefix: 'VITE_',
    plugins: [react()],
    server: {
      // A full reload or React refresh tears down microphone resources. Live
      // sessions use API updates only; opt into HMR for UI-only development.
      hmr: hotReload,
      ws: hotReload ? undefined : false,
      watch: {
        ignored: path => {
          const file = normalizePath(path)
          return runtimeDirectories.some(directory => file === directory || file.startsWith(`${directory}/`))
            || envFiles.includes(file)
        },
      },
      proxy: {
        '/api/transcriber': {
          target: env.TRANSCRIBER_TARGET || `http://127.0.0.1:${env.TRANSCRIBER_PORT || '8010'}`,
          ws: true,
          rewrite: path => path.replace(/^\/api\/transcriber/, ''),
        },
        '/api/enrichment': {
          target: env.ENRICHMENT_TARGET || 'http://127.0.0.1:8001',
          rewrite: path => path.replace(/^\/api\/enrichment/, env.ENRICHMENT_API_PREFIX || ''),
        },
      },
    },
  }
})
