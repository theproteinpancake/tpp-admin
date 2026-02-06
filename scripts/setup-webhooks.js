#!/usr/bin/env node
/**
 * Register Shopify Webhooks
 * The Protein Pancake
 *
 * One-time setup to register webhooks with Shopify so the
 * auto-publish server receives events when blog articles
 * are created or updated.
 *
 * PREREQUISITES:
 *   1. SHOPIFY_ADMIN_TOKEN in .env (Admin API access token)
 *   2. WEBHOOK_URL in .env (your server's public URL)
 *
 * Usage:
 *   node scripts/setup-webhooks.js              # Register webhooks
 *   node scripts/setup-webhooks.js --list       # List existing webhooks
 *   node scripts/setup-webhooks.js --clean      # Remove TPP webhooks
 */

const fs = require('fs');
const path = require('path');

// Load environment
function loadEnv() {
  const envFiles = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || process.env.EXPO_PUBLIC_SHOPIFY_DOMAIN || 'the-protein-pancake.myshopify.com';
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const API_VERSION = '2024-01';

const BASE_URL = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
};

// ─── API Helpers ──────────────────────────────────────────────────
async function shopifyGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function shopifyPost(endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function shopifyDelete(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`DELETE ${endpoint}: ${res.status} ${await res.text()}`);
  return true;
}

// ─── List Webhooks ────────────────────────────────────────────────
async function listWebhooks() {
  console.log('\n📋 Existing Shopify Webhooks:');
  console.log('─'.repeat(50));

  const { webhooks } = await shopifyGet('/webhooks.json');

  if (!webhooks || webhooks.length === 0) {
    console.log('  No webhooks registered.\n');
    return;
  }

  for (const wh of webhooks) {
    console.log(`  ${wh.id} | ${wh.topic} → ${wh.address}`);
  }
  console.log(`\n  Total: ${webhooks.length} webhook(s)\n`);
}

// ─── Register Webhooks ────────────────────────────────────────────
async function registerWebhooks() {
  const webhookAddress = `${WEBHOOK_URL}/webhooks/article`;

  console.log('\n🔗 Registering Shopify Webhooks...');
  console.log('─'.repeat(50));
  console.log(`  Target: ${webhookAddress}`);
  console.log('');

  const topics = ['articles/create', 'articles/update'];

  // Check existing webhooks to avoid duplicates
  const { webhooks: existing } = await shopifyGet('/webhooks.json');

  for (const topic of topics) {
    const alreadyExists = (existing || []).some(
      wh => wh.topic === topic && wh.address === webhookAddress
    );

    if (alreadyExists) {
      console.log(`  ✅ ${topic} — already registered`);
      continue;
    }

    try {
      const result = await shopifyPost('/webhooks.json', {
        webhook: {
          topic,
          address: webhookAddress,
          format: 'json',
        },
      });
      console.log(`  ✅ ${topic} — registered (ID: ${result.webhook.id})`);
    } catch (err) {
      console.log(`  ❌ ${topic} — failed: ${err.message}`);
    }
  }

  console.log('\n  Done! Webhooks will fire when blog articles are created or updated.\n');
}

// ─── Clean Webhooks ───────────────────────────────────────────────
async function cleanWebhooks() {
  console.log('\n🧹 Removing article webhooks...');
  console.log('─'.repeat(50));

  const { webhooks } = await shopifyGet('/webhooks.json');
  const articleWebhooks = (webhooks || []).filter(wh =>
    wh.topic.startsWith('articles/')
  );

  if (articleWebhooks.length === 0) {
    console.log('  No article webhooks to remove.\n');
    return;
  }

  for (const wh of articleWebhooks) {
    try {
      await shopifyDelete(`/webhooks/${wh.id}.json`);
      console.log(`  🗑️  Removed: ${wh.topic} → ${wh.address} (ID: ${wh.id})`);
    } catch (err) {
      console.log(`  ❌ Failed to remove ${wh.id}: ${err.message}`);
    }
  }

  console.log('\n  Done!\n');
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  console.log('\n🥞 TPP Shopify Webhook Setup');
  console.log('─'.repeat(50));

  // Validate config
  if (!SHOPIFY_ADMIN_TOKEN) {
    console.error('\n❌ Missing SHOPIFY_ADMIN_TOKEN in .env');
    console.error('');
    console.error('   To get your Admin API access token:');
    console.error('   1. Go to: https://theproteinpancake.myshopify.com/admin/settings/apps');
    console.error('   2. Click "Develop apps" → your app (or create one)');
    console.error('   3. Under "API credentials", configure Admin API scopes:');
    console.error('      ✓ read_content');
    console.error('      ✓ write_content');
    console.error('   4. Click "Install app" and copy the Admin API access token');
    console.error('   5. Add to .env: SHOPIFY_ADMIN_TOKEN=shpat_xxxxx');
    console.error('');
    process.exit(1);
  }

  if (args.includes('--list')) {
    await listWebhooks();
    return;
  }

  if (args.includes('--clean')) {
    await cleanWebhooks();
    return;
  }

  // Register webhooks
  if (!WEBHOOK_URL) {
    console.error('\n❌ Missing WEBHOOK_URL in .env');
    console.error('');
    console.error('   Set this to your server\'s public URL:');
    console.error('');
    console.error('   For local dev (using ngrok):');
    console.error('     1. Run: ngrok http 3456');
    console.error('     2. Copy the https URL');
    console.error('     3. Add to .env: WEBHOOK_URL=https://xxxx.ngrok.io');
    console.error('');
    console.error('   For production (Render/Railway):');
    console.error('     Add to .env: WEBHOOK_URL=https://your-app.onrender.com');
    console.error('');
    process.exit(1);
  }

  await registerWebhooks();
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
});
