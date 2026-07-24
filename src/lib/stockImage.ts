// Static access token for the WhatsApp stock-image route (Twilio must fetch the URL
// unauthenticated; same public-by-obscurity model as the PO image, keyed off CRON_SECRET).
import { createHash } from 'crypto';

const APP_URL = process.env.PUBLIC_APP_URL || 'https://admin.theproteinpancake.co';

export function stockImageToken(): string {
  return createHash('sha256').update(`stock-image:${process.env.CRON_SECRET || ''}`).digest('hex').slice(0, 16);
}

// Product photo maps shared by the WhatsApp image cards (stock + expiry).
export const FLAVOUR_IMG: Record<string, string> = {
  'Buttermilk': 'buttermilk.png',
  'Chocolate': 'chocolate.png',
  'Cinnamon Churro': 'cinnamonchurro.png',
  'Cookies & Cream': 'cookesandcream.png',
  'GF Buttermilk': 'gfbuttermilk.png',
  'GF Cinnamon Churro': 'gfcininamonchurro.png',
  'Maple': 'maple.png',
  'Salted Caramel': 'saltedcaramel.png',
};
export const SKU_IMG: Record<string, string> = {
  MSS: 'syrup.png', MSS8: 'syrup.png', ACCP: 'pancakepan.png', ACCF: 'flipper.png', ACCS: 'scraper.png', TWM: 'wafflemaker.png',
};

export function expiryImageUrl(site: string): string {
  return `${APP_URL}/api/whatsapp/expiry-image?site=${encodeURIComponent(site)}&k=${stockImageToken()}&t=${Date.now()}`;
}

export function stockImageUrl(site: string, sizes?: number[]): string {
  // t= busts WhatsApp/Twilio media caching so a fresh request renders fresh numbers
  const sz = sizes?.length ? `&sizes=${sizes.join(',')}` : '';
  return `${APP_URL}/api/whatsapp/stock-image?site=${encodeURIComponent(site)}${sz}&k=${stockImageToken()}&t=${Date.now()}`;
}
