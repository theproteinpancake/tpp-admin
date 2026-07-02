// App settings: config (admin email, 2FA), staff directory, integration status.
import { supabaseLogistics } from './supabase-logistics';
import { getGoogleConnection } from './google';
import { getConnection as getXeroConnection } from './xero';

export async function getConfig(key: string): Promise<string | null> {
  const { data } = await supabaseLogistics.from('app_config').select('value').eq('key', key).maybeSingle();
  return (data?.value as string) ?? null;
}
export async function setConfig(key: string, value: string) {
  await supabaseLogistics.from('app_config').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}
export async function getConfigMany(keys: string[]): Promise<Record<string, string>> {
  const { data } = await supabaseLogistics.from('app_config').select('key, value').in('key', keys);
  return Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
}

// Heartbeat for the daily system health check: each cron route records a successful run;
// /api/whatsapp/health-check alerts the owner when an expected job hasn't run in its window.
export async function recordJobRun(job: string) {
  try { await setConfig(`health:last:${job}`, new Date().toISOString()); } catch { /* never break the job for the heartbeat */ }
}

export async function listStaff() {
  const { data } = await supabaseLogistics.from('app_users').select('*').order('created_at', { ascending: true });
  return data ?? [];
}

export async function twoFAEnabled(): Promise<boolean> {
  return (await getConfig('twofa_enabled')) === 'true';
}
export async function twoFASecret(): Promise<string | null> {
  return getConfig('twofa_secret');
}

// Integration connection status for the Settings page.
export async function integrationStatus() {
  const [primary, kate, ads, xero] = await Promise.all([
    getGoogleConnection().catch(() => null),
    getGoogleConnection('kate').catch(() => null),
    getGoogleConnection('ads').catch(() => null),
    getXeroConnection().catch(() => null),
  ]);
  return {
    gmail_primary: primary ? { connected: true, email: primary.tenant_name } : { connected: false },
    gmail_kate: kate ? { connected: true, email: kate.tenant_name } : { connected: false },
    google_ads: ads ? { connected: true, email: ads.tenant_name } : { connected: false },
    xero: xero ? { connected: true, org: xero.tenant_name } : { connected: false },
    shipbob_au: { connected: !!process.env.SHIPBOB_API_TOKEN },
    shipbob_uk: { connected: !!process.env.SHIPBOB_API_TOKEN_UK },
    // Amazon SP-API: one shared LWA client, one refresh token per marketplace (env-based, no OAuth flow).
    amazon_au: { connected: !!(process.env.AMAZON_SP_CLIENT_ID && process.env.AMAZON_SP_CLIENT_SECRET && process.env.AMAZON_SP_REFRESH_TOKEN_AU) },
    amazon_uk: { connected: !!(process.env.AMAZON_SP_CLIENT_ID && process.env.AMAZON_SP_CLIENT_SECRET && process.env.AMAZON_SP_REFRESH_TOKEN_UK) },
  };
}
