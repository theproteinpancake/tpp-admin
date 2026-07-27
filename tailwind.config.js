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

        // Staff task board (Reece's tracker). His components use semantic names
        // (bg-surface, text-ink, border-line…) rather than raw colours, so rebranding
        // is entirely this block — every card, dialog and chip follows.
        canvas: '#f7eddb',        // page bg   = cream
        surface: '#faf4e8',       // cards     = paper
        sunken: '#f2e6d2',        // wells / inset panels
        line: '#e6d8bf',          // warm borders (was cool grey)
        'line-strong': '#d6c3a2',
        ink: '#3b2a1d',           // primary text — warm near-black, not slate
        'ink-soft': '#6d5a48',
        'ink-mute': '#9c8a76',
        accent: '#bd6930',        // caramel
        'accent-soft': '#f3e2cc',
        // Priority stays semantic — these are signals, not decoration. Medium borrows
        // the brand blue; urgent/high keep conventional red/amber.
        urgent: '#dc2626',
        high: '#d97706',
        medium: '#7dadd4',
        low: '#a89880',
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
