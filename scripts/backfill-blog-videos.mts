// One-off backfill (Jul 2026): re-push every published recipe's blog HTML so the YouTube embed
// finally lands — the auto-update after YouTube upload was middleware-blocked for months
// (see lib/blogPublish.ts). Uses the same updateRecipeBlog path the dashboard button uses.
// Run: npx tsx scripts/backfill-blog-videos.mts
import { readFileSync } from 'fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  if (!line.includes('=') || line.trim().startsWith('#')) continue;
  const k = line.slice(0, line.indexOf('=')).trim();
  const v = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}

const { updateRecipeBlog } = await import('../src/lib/blogPublish');
const { supabase } = await import('../src/lib/supabase');

const { data: recipes, error } = await supabase
  .from('recipes')
  .select('id, slug, youtube_video_id')
  .not('youtube_video_id', 'is', null)
  .not('shopify_article_id', 'is', null)
  .order('updated_at', { ascending: false });
if (error) { console.error('query failed:', error.message); process.exit(1); }

console.log(`${recipes!.length} recipes to refresh\n`);
let ok = 0, failed = 0;
for (const r of recipes!) {
  try {
    const res = await updateRecipeBlog(r.id);
    if (res.ok) { ok++; console.log(`✓ ${r.slug}`); }
    else { failed++; console.log(`✗ ${r.slug}: ${res.error}`); }
  } catch (e) { failed++; console.log(`✗ ${r.slug}: ${String(e).slice(0, 160)}`); }
  await new Promise((res) => setTimeout(res, 1500)); // Shopify REST rate limit headroom
}
console.log(`\ndone: ${ok} updated, ${failed} failed`);
