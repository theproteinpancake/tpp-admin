#!/usr/bin/env node
/**
 * Shopify → YouTube Auto-Publish Server
 * The Protein Pancake
 *
 * Listens for Shopify blog article webhooks and automatically:
 *   1. Matches the article to a recipe by slug
 *   2. Uploads the recipe video to YouTube
 *   3. Updates the Shopify blog post with the YouTube embed
 *
 * SETUP:
 *   1. Add SHOPIFY_ADMIN_TOKEN to .env (get from Shopify Admin > Settings > Apps > Your App)
 *   2. Run: npm install express dotenv
 *   3. Place video files in scripts/videos/{recipe-slug}.mp4
 *   4. Run: node scripts/setup-webhooks.js   (one-time webhook registration)
 *   5. Run: node scripts/shopify-youtube-server.js
 *
 * For local dev, use ngrok:
 *   ngrok http 3456
 *   Then update WEBHOOK_URL in .env with the ngrok URL
 *
 * For production, deploy to Render/Railway and set WEBHOOK_URL to your public URL.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// Load environment variables from .env.local (Next.js) or .env
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

// ─── Config ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3456;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || process.env.EXPO_PUBLIC_SHOPIFY_DOMAIN || 'the-protein-pancake.myshopify.com';
const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN || '';
const SHOPIFY_API_VERSION = '2024-01';
const VIDEOS_DIR = path.join(__dirname, 'videos');
const MASTER_PATH = path.join(__dirname, 'recipes-master.json');

// Import YouTube functions from existing script
const { uploadToYouTube, generateEmbedHTML, buildYouTubeDescription } = require('./youtube-upload');

// ─── Logging ───────────────────────────────────────────────────────
function log(emoji, msg) {
  const ts = new Date().toLocaleTimeString('en-AU', { hour12: false });
  console.log(`${ts} ${emoji} ${msg}`);
}

// ─── Verify Shopify HMAC ──────────────────────────────────────────
function verifyShopifyHmac(body, hmacHeader) {
  if (!SHOPIFY_SECRET) {
    log('⚠️', 'No SHOPIFY_API_SECRET set — skipping HMAC verification');
    return true;
  }
  const hash = crypto
    .createHmac('sha256', SHOPIFY_SECRET)
    .update(body, 'utf8')
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader || ''));
}

// ─── Load recipe by slug ──────────────────────────────────────────
function findRecipe(slug) {
  if (!fs.existsSync(MASTER_PATH)) {
    log('❌', 'recipes-master.json not found');
    return null;
  }
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  return (master.recipes || []).find(r => r.slug === slug) || null;
}

// ─── Find video file for recipe ───────────────────────────────────
function findVideoFile(slug) {
  if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    return null;
  }

  // Check common extensions
  const extensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  for (const ext of extensions) {
    const filePath = path.join(VIDEOS_DIR, `${slug}${ext}`);
    if (fs.existsSync(filePath)) return filePath;
  }

  return null;
}

// ─── YouTube Auth (reuse existing token) ──────────────────────────
async function getYouTubeAuth() {
  const { google } = require('googleapis');
  const credPath = path.join(__dirname, 'client_secret.json');
  const tokenPath = path.join(__dirname, '.youtube-token.json');

  if (!fs.existsSync(credPath)) {
    throw new Error('Missing client_secret.json — run youtube-upload.js first to authenticate');
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error('No YouTube token found — run youtube-upload.js --video first to authenticate');
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
  );

  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  oauth2Client.setCredentials(token);

  // Refresh if expired
  if (token.expiry_date && Date.now() >= token.expiry_date) {
    log('🔄', 'Refreshing YouTube token...');
    const { credentials: newCreds } = await oauth2Client.refreshAccessToken();
    fs.writeFileSync(tokenPath, JSON.stringify(newCreds, null, 2));
    oauth2Client.setCredentials(newCreds);
  }

  return oauth2Client;
}

// ─── Update Shopify Article with YouTube Embed ────────────────────
async function updateShopifyArticle(blogId, articleId, embedHtml, existingBody) {
  if (!SHOPIFY_ADMIN_TOKEN) {
    log('⚠️', 'No SHOPIFY_ADMIN_TOKEN set — cannot update article. Add it to .env');
    log('💡', 'Get it from: Shopify Admin → Settings → Apps → Your App → Admin API access token');
    return false;
  }

  // Insert YouTube embed at the top of the article body
  const videoSection = `
<!-- YouTube Video (auto-embedded by TPP server) -->
<div style="margin-bottom: 28px;">
${embedHtml}
</div>
<!-- End YouTube Video -->
`;

  // Check if there's already a YouTube embed
  let updatedBody;
  if (existingBody && existingBody.includes('<!-- YouTube Video')) {
    // Replace existing embed
    updatedBody = existingBody.replace(
      /<!-- YouTube Video[\s\S]*?<!-- End YouTube Video -->/,
      videoSection.trim()
    );
  } else if (existingBody && existingBody.includes('<!-- Recipe Description -->')) {
    // Insert before recipe description
    updatedBody = existingBody.replace(
      '<!-- Recipe Description -->',
      videoSection + '\n<!-- Recipe Description -->'
    );
  } else {
    // Prepend to body
    updatedBody = videoSection + (existingBody || '');
  }

  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/blogs/${blogId}/articles/${articleId}.json`;

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({
        article: {
          id: articleId,
          body_html: updatedBody,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      log('❌', `Shopify update failed (${response.status}): ${err}`);
      return false;
    }

    log('✅', `Shopify article ${articleId} updated with YouTube embed`);
    return true;
  } catch (err) {
    log('❌', `Shopify update error: ${err.message}`);
    return false;
  }
}

// ─── Handle Article Webhook ───────────────────────────────────────
async function handleArticleWebhook(article, topic) {
  const slug = article.handle;
  const title = article.title;
  const articleId = article.id;
  const blogId = article.blog_id;

  log('📝', `Article ${topic}: "${title}" (slug: ${slug})`);

  // 1. Find matching recipe
  const recipe = findRecipe(slug);
  if (!recipe) {
    log('ℹ️', `No recipe found for slug "${slug}" — skipping YouTube upload`);
    return;
  }

  // 2. Check for video file
  const videoPath = findVideoFile(slug);
  if (!videoPath) {
    log('ℹ️', `No video file found for "${slug}" in scripts/videos/ — skipping upload`);
    log('💡', `Drop a video as: scripts/videos/${slug}.mp4`);
    return;
  }

  log('🎬', `Found video: ${path.basename(videoPath)}`);

  // 3. Check if article already has a YouTube embed
  if (article.body_html && article.body_html.includes('youtube.com/embed/')) {
    log('ℹ️', `Article already has YouTube embed — skipping upload`);
    return;
  }

  // 4. Upload to YouTube
  try {
    const auth = await getYouTubeAuth();
    const result = await uploadToYouTube(videoPath, recipe, auth);

    if (!result) {
      log('❌', 'YouTube upload failed');
      return;
    }

    log('🎉', `YouTube upload complete: ${result.videoUrl}`);

    // 5. Generate embed HTML
    const embedHtml = generateEmbedHTML(result.videoId, recipe.title);

    // 6. Update Shopify article with embed
    await updateShopifyArticle(blogId, articleId, embedHtml, article.body_html);

    // 7. Log success
    log('✅', `Done! "${title}" → YouTube: ${result.videoUrl}`);

  } catch (err) {
    log('❌', `Error: ${err.message}`);
  }
}

// ─── Manual Trigger (no webhook needed) ───────────────────────────
async function handleManualTrigger(slug) {
  log('🔧', `Manual trigger for: ${slug}`);

  const recipe = findRecipe(slug);
  if (!recipe) {
    return { error: `No recipe found for slug "${slug}"` };
  }

  const videoPath = findVideoFile(slug);
  if (!videoPath) {
    return { error: `No video found. Place it at: scripts/videos/${slug}.mp4` };
  }

  try {
    const auth = await getYouTubeAuth();
    const result = await uploadToYouTube(videoPath, recipe, auth);

    if (!result) {
      return { error: 'YouTube upload failed' };
    }

    const embedHtml = generateEmbedHTML(result.videoId, recipe.title);

    // Try to update Shopify if we have the token
    if (SHOPIFY_ADMIN_TOKEN) {
      // Fetch the article by handle to get blog_id and article_id
      const article = await fetchArticleByHandle(slug);
      if (article) {
        await updateShopifyArticle(article.blog_id, article.id, embedHtml, article.body_html);
      }
    }

    return {
      success: true,
      videoUrl: result.videoUrl,
      videoId: result.videoId,
      embedHtml,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Fetch Article by Handle from Shopify ─────────────────────────
async function fetchArticleByHandle(handle) {
  if (!SHOPIFY_ADMIN_TOKEN) return null;

  try {
    // First get blogs
    const blogsUrl = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/blogs.json`;
    const blogsRes = await fetch(blogsUrl, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN },
    });
    const { blogs } = await blogsRes.json();

    // Search each blog for the article
    for (const blog of (blogs || [])) {
      const articlesUrl = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/blogs/${blog.id}/articles.json?handle=${handle}`;
      const articlesRes = await fetch(articlesUrl, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN },
      });
      const { articles } = await articlesRes.json();

      if (articles && articles.length > 0) {
        return { ...articles[0], blog_id: blog.id };
      }
    }
  } catch (err) {
    log('❌', `Error fetching article: ${err.message}`);
  }

  return null;
}

// ─── Parse JSON Body ──────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── HTTP Server ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'TPP Shopify → YouTube Auto-Publish',
      videosDir: VIDEOS_DIR,
      videosCount: fs.existsSync(VIDEOS_DIR)
        ? fs.readdirSync(VIDEOS_DIR).filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f)).length
        : 0,
    }));
    return;
  }

  // Manual trigger: POST /upload/:slug
  if (req.method === 'POST' && url.pathname.startsWith('/upload/')) {
    const slug = url.pathname.replace('/upload/', '');
    const result = await handleManualTrigger(slug);
    res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
    return;
  }

  // List available videos: GET /videos
  if (req.method === 'GET' && url.pathname === '/videos') {
    const videos = fs.existsSync(VIDEOS_DIR)
      ? fs.readdirSync(VIDEOS_DIR)
          .filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f))
          .map(f => ({
            file: f,
            slug: f.replace(/\.(mp4|mov|avi|mkv|webm)$/i, ''),
            size: `${(fs.statSync(path.join(VIDEOS_DIR, f)).size / 1024 / 1024).toFixed(1)} MB`,
          }))
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ videos }, null, 2));
    return;
  }

  // Shopify webhook: POST /webhooks/article
  if (req.method === 'POST' && url.pathname === '/webhooks/article') {
    const rawBody = await parseBody(req);

    // Verify HMAC
    const hmac = req.headers['x-shopify-hmac-sha256'];
    if (hmac && !verifyShopifyHmac(rawBody, hmac)) {
      log('🚫', 'Invalid HMAC — rejecting webhook');
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    // Respond immediately (Shopify requires < 5s response)
    res.writeHead(200);
    res.end('OK');

    // Process async
    try {
      const article = JSON.parse(rawBody);
      const topic = req.headers['x-shopify-topic'] || 'articles/update';
      await handleArticleWebhook(article, topic);
    } catch (err) {
      log('❌', `Webhook processing error: ${err.message}`);
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── Start Server ─────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('🥞 TPP Shopify → YouTube Auto-Publish Server');
  console.log('─'.repeat(50));
  console.log(`  🌐 Running on: http://localhost:${PORT}`);
  console.log(`  📁 Videos dir: ${VIDEOS_DIR}`);
  console.log(`  🔑 Shopify:    ${SHOPIFY_ADMIN_TOKEN ? '✅ Token set' : '⚠️  No SHOPIFY_ADMIN_TOKEN'}`);
  console.log(`  🎬 YouTube:    ${fs.existsSync(path.join(__dirname, '.youtube-token.json')) ? '✅ Authenticated' : '⚠️  Not yet authenticated'}`);
  console.log('');
  console.log('  Endpoints:');
  console.log(`    GET  /              Health check`);
  console.log(`    GET  /videos        List available videos`);
  console.log(`    POST /upload/:slug  Manual trigger (e.g. /upload/classic-buttermilk-protein-pancakes)`);
  console.log(`    POST /webhooks/article  Shopify webhook (auto-registered)`);
  console.log('');

  if (!SHOPIFY_ADMIN_TOKEN) {
    console.log('  ⚠️  To enable auto Shopify embed updates:');
    console.log('     1. Go to Shopify Admin → Settings → Apps → Develop apps');
    console.log('     2. Select your app (or create one)');
    console.log('     3. Configure Admin API scopes: read_content, write_content');
    console.log('     4. Install the app and copy the Admin API access token');
    console.log('     5. Add to .env: SHOPIFY_ADMIN_TOKEN=shpat_xxxxx');
    console.log('');
  }

  const videoCount = fs.existsSync(VIDEOS_DIR)
    ? fs.readdirSync(VIDEOS_DIR).filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f)).length
    : 0;
  console.log(`  📹 ${videoCount} video(s) ready in scripts/videos/`);
  console.log('');
  console.log('  Drop video files as: scripts/videos/{recipe-slug}.mp4');
  console.log('  Then publish the recipe on Shopify — the rest is automatic!');
  console.log('');
});
