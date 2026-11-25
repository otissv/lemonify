import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { sitePort } from './src/server/config/site-port.ts'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  server: {
    port: sitePort(process.env),
    strictPort: true,
    // The app's data, the end-to-end runs and the editor's settings are
    // written to all the time and are never source; watching them only makes
    // the dev server busy.
    watch: {
      ignored: [
        '**/.data/**',
        '**/e2e/.data/**',
        '**/e2e/.run/**',
        '**/.claude/**',
      ],
    },
  },
})

export default config
