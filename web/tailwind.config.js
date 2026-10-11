/** @type {import('tailwindcss').Config} */
// v111 — 50 Gram «PINE GREEN» dizayn qatlami
// MUHIM: preflight O'CHIQ — style.css strukturasiga tegilmaydi,
// tw.css FAQAT ko'rinish (rang/soya/radius) ustidan yozadi.
module.exports = {
  content: ['./index.html'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        pine: {
          50: '#EFF7F0', 100: '#E4F2E8', 200: '#C9E5D2', 300: '#A5D4B3',
          400: '#5CB981', 500: '#27A45D', 600: '#1E8E4D', 700: '#187A41',
          800: '#156A3A', 900: '#14532D', 950: '#0B2E1A',
        },
        sage: { 100: '#F3F7EF', 200: '#E9F1E5', 300: '#DFEAD9' },
        ink: { 900: '#0F2015' },
      },
      borderRadius: { '2xl': '1.1rem', '3xl': '1.5rem', '4xl': '1.9rem' },
      boxShadow: {
        soft: '0 1px 2px rgba(18,48,30,.05), 0 8px 24px rgba(18,48,30,.07)',
        lift: '0 2px 8px rgba(18,48,30,.07), 0 18px 44px rgba(18,48,30,.12)',
      },
    },
  },
  plugins: [],
}
