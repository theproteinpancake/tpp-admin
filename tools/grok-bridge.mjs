#!/usr/bin/env node
/**
 * TPP Ops — Grok bridge.
 *
 * Runs the xAI function-calling loop against the ops API. Grok never sees the source code,
 * the database or the token: it sees TOOL DEFINITIONS, and this bridge makes the calls.
 *
 * Tool schemas are fetched from /api/ops/_schema at startup, so when new tools are added to
 * the API (orders, WROs, transfer docs) the bot picks them up with no change here.
 *
 *   export XAI_API_KEY=xai-...
 *   export OPS_API_TOKEN=...            # same value as in Vercel
 *   export OPS_BASE_URL=https://admin.theproteinpancake.co
 *
 *   node tools/grok-bridge.mjs "what were sales last week?"
 *   node tools/grok-bridge.mjs --dry     # load tools + call one, without Grok
 */
import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPS_BASE = (process.env.OPS_BASE_URL || 'https://admin.theproteinpancake.co').replace(/\/$/, '');
const OPS_TOKEN = process.env.OPS_API_TOKEN || '';
const XAI_KEY = process.env.XAI_API_KEY || '';
// Confirm the current flagship id at https://docs.x.ai/docs/models — override with XAI_MODEL.
const MODEL = process.env.XAI_MODEL || 'grok-4';
const MAX_ROUNDS = 8;

// ---------------------------------------------------------------------------
// Ops API
// ---------------------------------------------------------------------------

async function ops(tool, args = {}) {
  const res = await fetch(`${OPS_BASE}/api/ops/${tool}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPS_TOKEN}`,
      'Content-Type': 'application/json',
      'x-ops-client': 'grok',
    },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({ ok: false, error: `non-JSON response (${res.status})` }));
  // Relay failures as data, not exceptions — the model must see the real error and say so.
  return body;
}

async function loadTools() {
  const res = await fetch(`${OPS_BASE}/api/ops/_schema`, { headers: { Authorization: `Bearer ${OPS_TOKEN}` } });
  if (!res.ok) throw new Error(`_schema ${res.status} — check OPS_API_TOKEN is set in Vercel and redeployed`);
  const { tools } = await res.json();
  return tools.map((t) => {
    const properties = {};
    const required = [];
    for (const [name, desc] of Object.entries(t.args || {})) {
      // the ops API generates idempotency keys itself; never let the model choose one
      if (name === 'idempotency_key') continue;
      properties[name] = { type: 'string', description: desc };
      if (/^REQUIRED/.test(desc)) required.push(name);
    }
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.mutates ? `${t.description}\n\nWRITES REAL DATA — confirm with the user before calling.` : t.description,
        parameters: { type: 'object', properties, required },
      },
      _mutates: !!t.mutates,
    };
  });
}

/**
 * Idempotency key for a write. Derived from the conversation turn + tool + args, so a retry of
 * the SAME intent replays instead of writing twice, while a genuinely new request gets a new
 * key. Generated here, never by the model.
 */
const idemKey = (turnId, tool, args) =>
  createHash('sha256').update(`${turnId}:${tool}:${JSON.stringify(args, Object.keys(args).sort())}`).digest('hex').slice(0, 32);

// ---------------------------------------------------------------------------
// Grok loop
// ---------------------------------------------------------------------------

function systemPrompt() {
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Melbourne',
  });
  return readFileSync(join(HERE, 'grok-system-prompt.md'), 'utf8').replace('{{DATE}}', today);
}

export async function ask(userText, opts = {}) {
  const tools = opts.tools || (await loadTools());
  const mutating = new Set(tools.filter((t) => t._mutates).map((t) => t.function.name));
  const turnId = opts.turnId || randomUUID();
  const messages = [
    { role: 'system', content: systemPrompt() },
    ...(opts.history || []),
    { role: 'user', content: userText },
  ];
  const wire = tools.map(({ _mutates, ...t }) => t);
  const calls = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${XAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, tools: wire, tool_choice: 'auto' }),
    });
    if (!res.ok) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const msg = (await res.json()).choices?.[0]?.message;
    if (!msg) throw new Error('xAI returned no message');
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return { text: msg.content || '(no reply)', calls, messages };
    }

    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* model sent junk */ }
      if (mutating.has(name)) args.idempotency_key = idemKey(turnId, name, args);
      const out = await ops(name, args);
      calls.push({ name, args, ok: out?.ok !== false });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 8000) });
    }
  }
  return { text: 'That took too many steps — try narrowing the request.', calls, messages };
}

// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!OPS_TOKEN) { console.error('OPS_API_TOKEN not set'); process.exit(1); }

  if (arg === '--dry' || !arg) {
    // Prove the chain without Grok: schemas load, and a real call returns real numbers.
    const tools = await loadTools();
    console.log(`Loaded ${tools.length} tools from ${OPS_BASE}/api/ops/_schema:`);
    for (const t of tools) console.log(`  ${t._mutates ? 'WRITE' : 'read '}  ${t.function.name}`);
    const week = await ops('get_week');
    console.log('\nget_week →', week.ok ? week.data.period : week);
    if (week.ok) console.log(`  online $${week.data.online} · ${week.data.orders} orders · net $${Math.round(week.data.net)}`);
    process.exit(0);
  }

  if (!XAI_KEY) { console.error('XAI_API_KEY not set (get one at https://console.x.ai)'); process.exit(1); }
  const { text, calls } = await ask(arg);
  if (calls.length) console.log(`[tools: ${calls.map((c) => c.name).join(', ')}]\n`);
  console.log(text);
}
