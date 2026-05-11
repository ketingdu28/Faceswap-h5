/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        bgBlack: '#000000',
        bgDeepGreen: '#001a12',
        accentGreen: '#00ff9d',
        textSoft: '#e2e8f0',
      },
      boxShadow: {
        accentGlow: '0 0 15px rgba(0, 255, 157, 0.3)',
      },
    },
  },
  plugins: [],
}
