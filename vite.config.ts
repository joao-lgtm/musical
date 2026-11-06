import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serve em /musical/; no dev fica na raiz
  base: command === 'build' ? '/musical/' : '/',
  plugins: [react()],
}))
