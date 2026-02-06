#!/usr/bin/env node
/**
 * YouTube Upload & Shopify Embed Script
 * The Protein Pancake
 *
 * Uploads recipe videos to YouTube and generates embed code
 * for Shopify blog posts.
 *
 * SETUP:
 * 1. Go to https://console.cloud.google.com
 * 2. Create a project (or select existing)
 * 3. Enable "YouTube Data API v3"
 * 4. Create OAuth 2.0 credentials (Desktop App type)
 * 5. Download credentials as client_secret.json
 * 6. Place client_secret.json in scripts/ folder
 * 7. Run: npm install googleapis
 * 8. Run: node scripts/youtube-upload.js --video path/to/video.mp4 --title "Recipe Title"
 *
 * Usage:
 *   node scripts/youtube-upload.js --video ./videos/classic-pancakes.mp4 --slug classic-buttermilk-protein-pancakes
 *   node scripts/youtube-upload.js --bulk    # Upload all videos from recipes-master.json
 *   node scripts/youtube-upload.js --embed   # Just generate embed codes for existing YouTube URLs
 *
 * The script will:
 *   1. Upload the video to your YouTube channel
 *   2. Set title, description, tags from recipe data
 *   3. Generate the embed iframe code
 *   4. Optionally update the Shopify blog post with the embed
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Brand settings for YouTube
const CHANNEL_DEFAULTS = {
  categoryId: '26',  // How-to & Style
  defaultLanguage: 'en',
  privacyStatus: 'public',
  tags: ['protein pancakes', 'healthy recipe', 'high protein', 'the protein pancake', 'healthy breakfast', 'meal prep', 'high protein recipe'],
};

// TPP product → Shopify URL mapping
const PRODUCT_URLS = {
  'buttermilk protein pancake mix': 'https://theproteinpancake.co/products/buttermilk-protein-pancake-mix',
  'chocolate protein pancake mix': 'https://theproteinpancake.co/products/chocolate-protein-pancake-mix',
  'churro protein pancake mix': 'https://theproteinpancake.co/products/churro-protein-pancake-mix',
  'cinnamon scroll protein pancake mix': 'https://theproteinpancake.co/products/cinnamon-scroll-protein-pancake-mix',
};

// ─── YouTube Upload Function ──────────────────────────────────────
async function uploadToYouTube(videoPath, recipe, auth) {
  const { google } = require('googleapis');
  const youtube = google.youtube({ version: 'v3', auth });

  const title = recipe.title;
  const description = buildYouTubeDescription(recipe);

  // Build dynamic tags from hashtags + recipe data
  const hashtagStr = buildHashtags(recipe);
  const hashtagTags = hashtagStr.split(' ').map(h => h.replace('#', '').replace(/([A-Z])/g, ' $1').trim());
  const tags = [
    ...new Set([
      ...CHANNEL_DEFAULTS.tags,
      ...hashtagTags,
      ...(recipe.tags || []),
      recipe.category || 'breakfast',
      recipe.title,
    ])
  ].filter(Boolean);

  console.log(`  📤 Uploading: ${title}`);
  console.log(`  📁 File: ${videoPath}`);

  const fileSize = fs.statSync(videoPath).size;
  console.log(`  📏 Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.substring(0, 100), // YouTube max 100 chars
          description,
          tags: tags.slice(0, 30), // YouTube max ~500 chars total
          categoryId: CHANNEL_DEFAULTS.categoryId,
          defaultLanguage: CHANNEL_DEFAULTS.defaultLanguage,
        },
        status: {
          privacyStatus: CHANNEL_DEFAULTS.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    }, {
      onUploadProgress: (evt) => {
        const pct = Math.round((evt.bytesRead / fileSize) * 100);
        process.stdout.write(`\r  ⏳ Progress: ${pct}%`);
      },
    });

    const videoId = res.data.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const embedUrl = `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`;

    console.log(`\n  ✅ Uploaded! Video ID: ${videoId}`);
    console.log(`  🔗 URL: ${videoUrl}`);

    return { videoId, videoUrl, embedUrl };
  } catch (err) {
    console.error(`\n  ❌ Upload failed: ${err.message}`);
    if (err.errors) {
      err.errors.forEach(e => console.error(`     ${e.message}`));
    }
    return null;
  }
}

// ─── Build YouTube Description ────────────────────────────────────
function buildYouTubeDescription(recipe) {
  let desc = '';

  // ── Recipe blurb ──
  if (recipe.description) {
    desc += recipe.description + '\n';
  }
  desc += '\n';

  // ── GET THIS RECIPE / GET OUR APP ──
  if (recipe.slug) {
    desc += `GET THIS RECIPE: https://theproteinpancake.co/blogs/recipes/${recipe.slug}\n`;
  }
  desc += `REQUEST A RECIPE: hello@theproteinpancake.co\n`;
  desc += '\n';

  // ── FOLLOW US ──
  desc += `FOLLOW US:\n`;
  desc += `IG: https://www.instagram.com/the.proteinpancake/\n`;
  desc += `FB: https://www.facebook.com/theproteinpancake1\n`;
  desc += `TIKTOK: https://www.tiktok.com/@theproteinpancake?lang=en\n`;
  desc += '\n';

  // ── BECOME A FLIPPER ──
  desc += `BECOME A FLIPPER: https://theproteinpancake.co\n`;
  desc += '\n';

  // ── PRODUCTS USED ──
  const productsUsed = findProductsUsed(recipe);
  if (productsUsed.length > 0) {
    desc += `PRODUCTS USED:\n`;
    productsUsed.forEach(p => {
      desc += `${p.name}: ${p.url}\n`;
    });
    desc += '\n';
  }

  // ── RECIPE & NUTRITION ──
  desc += `RECIPE & NUTRITION:\n`;

  // Ingredients as a compact list
  if (recipe.ingredients && recipe.ingredients.length > 0) {
    recipe.ingredients.forEach(ing => {
      if (typeof ing === 'string') {
        desc += `${ing}  `;
      } else {
        const amount = ing.amount || '';
        const unit = ing.unit && ing.unit !== 'undefined' ? ing.unit : '';
        const notes = ing.notes ? ` (${ing.notes})` : '';
        const line = `${amount}${unit ? ' ' + unit : ''} - ${ing.item}${notes}`.trim();
        desc += `${line}  `;
      }
    });
    desc += '\n\n';
  }

  // Nutrition summary
  if (recipe.calories || recipe.protein) {
    const parts = [];
    if (recipe.calories) parts.push(`Calories: ${Math.round(recipe.calories)}`);
    if (recipe.protein) parts.push(`Protein: ${Math.round(recipe.protein)}g`);
    if (recipe.carbs) parts.push(`Carbs: ${Math.round(recipe.carbs)}g`);
    if (recipe.fat) parts.push(`Fat: ${Math.round(recipe.fat)}g`);
    desc += parts.join(' | ') + '\n';
  }

  // Prep/cook/serves
  const infoParts = [];
  if (recipe.prep_time_minutes) infoParts.push(`Prep: ${recipe.prep_time_minutes} min`);
  if (recipe.cook_time_minutes) infoParts.push(`Cook: ${recipe.cook_time_minutes} min`);
  if (recipe.servings) infoParts.push(`Serves: ${recipe.servings}`);
  if (infoParts.length > 0) {
    desc += infoParts.join(' | ') + '\n';
  }

  desc += '\n';

  // ── Hashtags — #Shorts first so YouTube categorises as a Short ──
  desc += '#Shorts ' + buildHashtags(recipe);

  return desc;
}

// ─── Find TPP products used in recipe ─────────────────────────────
function findProductsUsed(recipe) {
  const products = [];
  const seen = new Set();

  (recipe.ingredients || []).forEach(ing => {
    const item = (typeof ing === 'string' ? ing : ing.item || '').toLowerCase();
    for (const [productName, url] of Object.entries(PRODUCT_URLS)) {
      if (item.includes(productName) && !seen.has(productName)) {
        seen.add(productName);
        // Capitalise for display
        const displayName = productName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        products.push({ name: displayName, url });
      }
    }
  });

  return products;
}

// ─── Build hashtags from recipe data ──────────────────────────────
function buildHashtags(recipe) {
  const tags = new Set();

  // Always include brand tags
  tags.add('#TheProteinPancake');
  tags.add('#HighProtein');
  tags.add('#HealthyRecipe');

  // Category-based tags
  const category = (recipe.category || '').toLowerCase();
  if (category === 'breakfast') {
    tags.add('#HealthyBreakfast');
    tags.add('#BreakfastIdeas');
  } else if (category === 'snack') {
    tags.add('#HealthySnack');
    tags.add('#SnackIdeas');
  } else if (category === 'dessert') {
    tags.add('#HealthyDessert');
    tags.add('#GuiltFree');
  } else if (category === 'dinner') {
    tags.add('#HealthyDinner');
    tags.add('#DinnerIdeas');
  } else if (category === 'lunch') {
    tags.add('#HealthyLunch');
    tags.add('#LunchIdeas');
  } else if (category === 'baking') {
    tags.add('#HealthyBaking');
    tags.add('#ProteinBaking');
  }

  // Subcategory
  const sub = (recipe.subcategory || '').toLowerCase();
  if (sub.includes('pancake')) tags.add('#ProteinPancakes');
  if (sub.includes('smoothie')) tags.add('#ProteinSmoothie');
  if (sub.includes('salad')) tags.add('#HealthySalad');
  if (sub.includes('bowl')) tags.add('#ProteinBowl');

  // Tag-based
  (recipe.tags || []).forEach(t => {
    if (t === 'meal-prep') tags.add('#MealPrep');
    if (t === 'quick') tags.add('#QuickMeals');
    if (t === 'kid-friendly') tags.add('#KidFriendly');
    if (t === 'gluten-free') tags.add('#GlutenFree');
    if (t === 'vegetarian') tags.add('#Vegetarian');
    if (t === 'high-protein') tags.add('#HighProteinRecipe');
    if (t === 'low-carb') tags.add('#LowCarb');
  });

  // Flavour-based
  (recipe.flavours || []).forEach(f => {
    if (f === 'chocolate') tags.add('#Chocolate');
    if (f === 'buttermilk') tags.add('#Buttermilk');
    if (f === 'cinnamon') tags.add('#Cinnamon');
  });

  // Generic
  tags.add('#ProteinRecipe');
  tags.add('#HealthyEating');

  return [...tags].join(' ');
}

// ─── Generate Embed HTML ──────────────────────────────────────────
function generateEmbedHTML(videoId, title) {
  return `<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 12px; margin-bottom: 28px;">
  <iframe
    src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen
    loading="lazy"
    title="${title || 'Recipe Video'}"
  ></iframe>
</div>`;
}

// ─── OAuth2 Authentication ────────────────────────────────────────
async function authenticate() {
  const { google } = require('googleapis');

  const credPath = path.join(__dirname, 'client_secret.json');
  const tokenPath = path.join(__dirname, '.youtube-token.json');

  if (!fs.existsSync(credPath)) {
    console.error('\n❌ Missing client_secret.json');
    console.error('   Download OAuth credentials from Google Cloud Console');
    console.error('   and save as scripts/client_secret.json');
    console.error('\n   Setup guide: https://developers.google.com/youtube/v3/getting-started\n');
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
  );

  // Check for existing token
  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oauth2Client.setCredentials(token);

    // Refresh if expired
    if (token.expiry_date && Date.now() >= token.expiry_date) {
      console.log('  🔄 Refreshing token...');
      const { credentials: newCreds } = await oauth2Client.refreshAccessToken();
      fs.writeFileSync(tokenPath, JSON.stringify(newCreds, null, 2));
      oauth2Client.setCredentials(newCreds);
    }

    return oauth2Client;
  }

  // New authorization flow
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
  });

  console.log('\n🔑 Authorize this app by visiting this URL:\n');
  console.log(authUrl);
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise(resolve => {
    rl.question('Enter the authorization code: ', resolve);
  });
  rl.close();

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.log('  ✅ Token saved for future use.\n');

  return oauth2Client;
}

// ─── Main CLI ─────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  console.log('\n🎬 The Protein Pancake - YouTube Upload & Embed');
  console.log('─'.repeat(50));

  // --embed mode: just generate embed codes from existing YouTube URLs
  if (args.includes('--embed')) {
    const masterPath = path.join(__dirname, 'recipes-master.json');
    const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
    const recipes = master.recipes || [];

    console.log('\nGenerating embed codes for recipes with YouTube URLs...\n');

    let count = 0;
    for (const recipe of recipes) {
      if (!recipe.video_url) continue;
      const match = recipe.video_url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (!match) continue;

      const videoId = match[1];
      const embed = generateEmbedHTML(videoId, recipe.title);
      console.log(`📹 ${recipe.title}`);
      console.log(`   YouTube: https://www.youtube.com/watch?v=${videoId}`);
      console.log(`   Embed:\n${embed}\n`);
      count++;
    }

    console.log(`Generated ${count} embed codes.\n`);
    return;
  }

  // --video mode: upload a single video
  const videoArg = args.indexOf('--video');
  const slugArg = args.indexOf('--slug');
  const titleArg = args.indexOf('--title');

  if (videoArg >= 0) {
    const videoPath = args[videoArg + 1];
    if (!videoPath || !fs.existsSync(videoPath)) {
      console.error(`\n❌ Video file not found: ${videoPath}\n`);
      process.exit(1);
    }

    // Get recipe data
    let recipe = { title: 'The Protein Pancake Recipe', slug: '', tags: [] };

    if (slugArg >= 0) {
      const masterPath = path.join(__dirname, 'recipes-master.json');
      if (fs.existsSync(masterPath)) {
        const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
        const found = (master.recipes || []).find(r => r.slug === args[slugArg + 1]);
        if (found) recipe = found;
      }
    }

    if (titleArg >= 0) {
      recipe.title = args[titleArg + 1];
    }

    const auth = await authenticate();
    const result = await uploadToYouTube(videoPath, recipe, auth);

    if (result) {
      console.log('\n📋 Embed HTML (paste into Shopify):');
      console.log('─'.repeat(50));
      console.log(generateEmbedHTML(result.videoId, recipe.title));
    }
    return;
  }

  // --bulk mode: upload all videos
  if (args.includes('--bulk')) {
    console.log('\n⚠️  Bulk upload requires video files to be locally available.');
    console.log('    Ensure video_url in recipes-master.json points to local MP4 files');
    console.log('    or use --video for individual uploads.\n');

    const masterPath = path.join(__dirname, 'recipes-master.json');
    const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
    const withVideos = (master.recipes || []).filter(r => r.video_url && fs.existsSync(r.video_url));

    if (withVideos.length === 0) {
      console.log('No local video files found in recipe data.\n');
      console.log('To upload a specific video:');
      console.log('  node scripts/youtube-upload.js --video ./video.mp4 --slug recipe-slug\n');
      return;
    }

    const auth = await authenticate();
    let uploaded = 0;

    for (const recipe of withVideos) {
      const result = await uploadToYouTube(recipe.video_url, recipe, auth);
      if (result) {
        recipe.video_url = result.videoUrl;
        uploaded++;
      }
      // Rate limit: wait 5 seconds between uploads
      await new Promise(r => setTimeout(r, 5000));
    }

    // Save updated master with YouTube URLs
    fs.writeFileSync(masterPath, JSON.stringify(master, null, 2));
    console.log(`\n✅ Uploaded ${uploaded} videos. Updated recipes-master.json.\n`);
    return;
  }

  // Show help
  console.log(`
Usage:
  node scripts/youtube-upload.js --video <path> --slug <recipe-slug>
    Upload a single video for a recipe

  node scripts/youtube-upload.js --video <path> --title "My Recipe"
    Upload with custom title

  node scripts/youtube-upload.js --embed
    Generate embed codes for existing YouTube URLs in recipes

  node scripts/youtube-upload.js --bulk
    Bulk upload all videos

Setup:
  1. Enable YouTube Data API v3 at https://console.cloud.google.com
  2. Create OAuth 2.0 credentials (Desktop App)
  3. Save as scripts/client_secret.json
  4. Run any upload command - you'll be prompted to authorize
  `);
}

module.exports = { uploadToYouTube, generateEmbedHTML, buildYouTubeDescription };

if (require.main === module) {
  main().catch(console.error);
}
