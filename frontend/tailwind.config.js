/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        onedark: {
          bg: 'var(--color-bg, #282C34)',
          darker: 'var(--color-darker, #21252B)',
          surface: 'var(--color-surface, #2C313A)',
          border: 'var(--color-border, #3E4451)',
          borderSubtle: 'var(--color-border-subtle, #1E2227)',
          fg: 'var(--color-fg, #ABB2BF)',
          fgBright: 'var(--color-fg-bright, #E5E5E5)',
          muted: 'var(--color-muted, #5C6370)',
          accent: 'var(--color-accent, #E5C07B)',
          folder: 'var(--color-folder, #E5C07B)',
          green: 'var(--color-green, #98C379)',
          red: 'var(--color-red, #E06C75)',
          yellow: 'var(--color-yellow, #E5C07B)',
          purple: 'var(--color-purple, #C678DD)',
          bronze: 'var(--color-bronze, #D19A66)'
        },
        dark: {
          950: 'var(--color-darker, #21252B)',
          900: 'var(--color-bg, #282C34)',
          850: 'var(--color-surface, #2C313A)',
          800: 'var(--color-border, #3E4451)',
          750: 'var(--color-border-subtle, #4B5263)',
          700: 'var(--color-muted, #5C6370)',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
        sans: ['Plus Jakarta Sans', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
