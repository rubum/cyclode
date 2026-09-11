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
          bg: '#282C34',
          darker: '#21252B',
          surface: '#2C313A',
          border: '#3E4451',
          borderSubtle: '#1E2227',
          fg: '#ABB2BF',
          fgBright: '#E5E5E5',
          muted: '#5C6370',
          accent: '#61AFEF',
          green: '#98C379',
          red: '#E06C75',
          yellow: '#E5C07B',
          purple: '#C678DD',
          cyan: '#56B6C2'
        },
        dark: {
          950: '#21252B',
          900: '#282C34',
          850: '#2C313A',
          800: '#3E4451',
          750: '#4B5263',
          700: '#5C6370',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
