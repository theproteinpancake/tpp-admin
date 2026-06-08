// Shopify Admin API token via the client-credentials grant (recommended for headless,
// own-store Dev Dashboard apps). The token always reflects the app version's current
// scopes — with protected customer data auto-granted for a custom app — so scope changes
// never require an in-admin re-approval prompt. Falls back to a static token if client
// credentials aren't configured.
export const SHOPIFY_SHOP = process.env.SHOPIFY_STORE_DOMAIN || 'the-protein-pancake.myshopify.com';

let cached: { token: string; exp: number } | null = null;

export async function getShopifyToken(): Promise<string> {
  const cid = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!cid || !secret) {
    const stat = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    if (stat) return stat; // fallback until client creds are added
    throw new Error('Shopify not configured (need SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET, or SHOPIFY_ADMIN_ACCESS_TOKEN)');
  }
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(`https://${SHOPIFY_SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cid, client_secret: secret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Shopify client-credentials ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}
