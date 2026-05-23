/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        gray: {
          850: '#1a1f2e',
          900: '#111827',
          800: '#1f2937',
          750: '#242d3d'
        }
      }
    }
  },
  plugins: []
};
