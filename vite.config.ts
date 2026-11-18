import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serve em /musical/; no dev fica na raiz. O preview usa a mesma base do build para reproduzir a produção.
  base: command === 'build' || isPreview ? '/musical/' : '/',
  plugins: [react()],
}))
