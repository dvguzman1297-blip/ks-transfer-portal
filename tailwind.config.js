/** @type {import('tailwindcss').Config} */
// Colours that change between the dark and light theme are CSS variables (see app/globals.css).
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: v('navy-950'), 900: v('navy-900'), 800: v('navy-800'), 700: v('navy-700'), 600: v('navy-600') },
        gold: { 300: v('gold-300'), 400: v('gold-400'), 500: v('gold-500'), 600: v('gold-600') },
        slate: { 100: v('slate-100'), 200: v('slate-200'), 300: v('slate-300'), 400: v('slate-400'), 500: v('slate-500'), 600: v('slate-600') },
        rose: { 200: v('rose-200'), 300: v('rose-300'), 400: v('rose-400'), 950: v('rose-950') },
        emerald: { 200: v('emerald-200'), 300: v('emerald-300'), 400: v('emerald-400'), 950: v('emerald-950') },
        amber: { 300: v('amber-300') },
        sky: { 300: v('sky-300') },
        fuchsia: { 300: v('fuchsia-300') },
      },
    },
  },
  plugins: [],
};
