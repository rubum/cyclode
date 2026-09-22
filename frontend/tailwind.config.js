function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined && !String(opacityValue).startsWith('var(--tw-')) {
      return `rgba(var(${variableName}-rgb), ${opacityValue})`;
    }
    return `var(${variableName})`;
  };
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      borderColor: {
        DEFAULT: 'var(--color-border-subtle)',
      },
      colors: {
        onedark: {
          bg: withOpacity('--color-bg'),
          darker: withOpacity('--color-darker'),
          surface: withOpacity('--color-surface'),
          border: withOpacity('--color-border'),
          borderSubtle: withOpacity('--color-border-subtle'),
          fg: withOpacity('--color-fg'),
          fgBright: withOpacity('--color-fg-bright'),
          muted: withOpacity('--color-muted'),
          accent: withOpacity('--color-accent'),
          folder: withOpacity('--color-folder'),
          green: withOpacity('--color-green'),
          red: withOpacity('--color-red'),
          yellow: withOpacity('--color-yellow'),
          purple: withOpacity('--color-purple'),
          bronze: withOpacity('--color-bronze')
        },
        dark: {
          950: withOpacity('--color-darker'),
          900: withOpacity('--color-bg'),
          850: withOpacity('--color-surface'),
          800: withOpacity('--color-border'),
          750: withOpacity('--color-border-subtle'),
          700: withOpacity('--color-muted'),
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
