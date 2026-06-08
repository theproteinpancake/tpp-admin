import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import AppShell from '@/components/AppShell';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// Branded Recoleta (self-hosted) — exposed as a CSS var, applied to headings in globals.css
const recoleta = localFont({
  src: [
    { path: '../../assets/fonts/recoleta-regular.woff2', weight: '400', style: 'normal' },
    { path: '../../assets/fonts/recoleta-semibold.woff2', weight: '600', style: 'normal' },
    { path: '../../assets/fonts/recoleta-bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-recoleta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TPP Control - The Protein Pancake',
  description: 'Operations dashboard for The Protein Pancake',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'TPP Control' },
};

export const viewport: Viewport = {
  themeColor: '#7dadd4',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${recoleta.variable}`}>
      <body className={inter.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
