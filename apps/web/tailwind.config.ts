import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: '#0b1220',
        panel: '#101a2e',
        edge: '#1f2c44',
        live: '#22c55e',
        dead: '#ef4444',
        amber: '#f59e0b',
      },
    },
  },
  plugins: [],
};

export default config;