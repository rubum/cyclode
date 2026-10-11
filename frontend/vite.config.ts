import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'lucide-react',
      'katex',
      'recharts',
      'clsx',
      'tailwind-merge',
      'prismjs',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: {
      clientPort: process.env.FRONTEND_PORT ? Number(process.env.FRONTEND_PORT) : 5174,
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-mermaid': ['mermaid'],
          'vendor-katex': ['katex'],
          'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          'vendor-charts': ['recharts', 'd3-shape'],
          'vendor-prism': ['prismjs'],
        }
      }
    }
  }
})

