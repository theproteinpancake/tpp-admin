// Static access token for the WhatsApp stock-image route (Twilio must fetch the URL
// unauthenticated; same public-by-obscurity model as the PO image, keyed off CRON_SECRET).
import { createHash } from 'crypto';

const APP_URL = process.env.PUBLIC_APP_URL || 'https://admin.theproteinpancake.co';

export function stockImageToken(): string {
  return createHash('sha256').update(`stock-image:${process.env.CRON_SECRET || ''}`).digest('hex').slice(0, 16);
}

export function stockImageUrl(site: string, sizes?: number[]): string {
  // t= busts WhatsApp/Twilio media caching so a fresh request renders fresh numbers
  const sz = sizes?.length ? `&sizes=${sizes.join(',')}` : '';
  return `${APP_URL}/api/whatsapp/stock-image?site=${encodeURIComponent(site)}${sz}&k=${stockImageToken()}&t=${Date.now()}`;
}
