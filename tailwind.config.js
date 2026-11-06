/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#070b16', 900: '#0b1220', 800: '#111a2e', 700: '#1a2542', 600: '#26345a' },
        gold: { 300: '#f3dc8a', 400: '#e6c35c', 500: '#d4af37', 600: '#b8932a' },
      },
    },
  },
  plugins: [],
};
