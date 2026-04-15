import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0f766e',
          dark: '#134e4a',
          light: '#14b8a6',
        },
      },
    },
  },
  plugins: [],
};
export default config;
