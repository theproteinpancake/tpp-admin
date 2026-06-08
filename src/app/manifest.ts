import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TPP Control — The Protein Pancake',
    short_name: 'TPP Control',
    description: 'Operations dashboard for The Protein Pancake',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7eddb',
    theme_color: '#7dadd4',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
