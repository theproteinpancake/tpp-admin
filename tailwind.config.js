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
        caramel: '#bd6930',          // contrast caramel (primary accent)
        maple: '#9a4f24',            // darker caramel — hover/active text
        cream: '#f7eddb',            // app background (darker cream)
        paper: '#faf4e8',            // cards / highlighted segments (lighter cream)
        churro: '#efdcc0',           // soft tan accent
        // Flavour / brand palette
        tppblue: '#7dadd4',          // branded blue
        'buttermilk-blue': '#7EAFD3',
        'green-dark': '#025c46',
        'green-light': '#c4dd8c',
        chocolate: '#692e00',
        pink: '#fcc9bd',
        cookie: '#211b25',
        'maple-bacon': '#DB5B42',
        cinnamon: '#9D442B',
        'maple-orange': '#fbb033',
      },
      fontFamily: {
        sans: ['var(--font-recoleta)', 'Georgia', 'serif'],
        display: ['var(--font-recoleta)', 'Georgia', 'serif'],
        body: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
