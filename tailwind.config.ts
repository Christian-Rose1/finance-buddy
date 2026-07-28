import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(222 47% 11%)',
        panel: 'hsl(222 47% 14%)',
        line: 'hsl(223 19% 26%)',
        accent: 'hsl(199 89% 48%)',
      },
    },
  },
  plugins: [],
};

export default config;
