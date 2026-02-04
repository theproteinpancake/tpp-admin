/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // TPP Brand Colors
        caramel: '#C4814A',
        maple: '#B5651D',
        cream: '#FFF8E7',
        churro: '#F5DEB3',
        'maple-bacon': '#8B4513',
        'buttermilk-blue': '#4A90A4',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
