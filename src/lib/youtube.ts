import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

// ─── Config ────────────────────────────────────────────────────────
// Supports both env vars (Vercel) and local files (dev)
const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
const CRED_PATH = path.join(SCRIPTS_DIR, 'client_secret.json');
const TOKEN_PATH = path.join(SCRIPTS_DIR, '.youtube-token.json');

// TPP product → Shopify URL mapping (for auto-detection in descriptions)
const PRODUCT_URLS: Record<string, string> = {
  'buttermilk protein pancake mix': 'https://theproteinpancake.co/products/buttermilk-protein-pancake-mix',
  'chocolate protein pancake mix': 'https://theproteinpancake.co/products/chocolate-protein-pancake-mix',
  'churro protein pancake mix': 'https://theproteinpancake.co/products/churro-protein-pancake-mix',
  'cinnamon scroll protein pancake mix': 'https://theproteinpancake.co/products/cinnamon-scroll-protein-pancake-mix',
};

// ─── Types ─────────────────────────────────────────────────────────
interface RecipeForYouTube {
  title: string;
  slug: string;
  description: string | null;
  category: string;
  tags: string[];
  flavours?: string[];
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: Array<{ amount?: string; unit?: string; item: string; notes?: string }>;
}

// ─── Auth ──────────────────────────────────────────────────────────
function hasEnvCredentials(): boolean {
  return !!(
    process.env.YOUTUBE_CLIENT_ID &&
    process.env.YOUTUBE_CLIENT_SECRET &&
    process.env.YOUTUBE_REFRESH_TOKEN
  );
}

export function isYouTubeConfigured(): boolean {
  // Check env vars first (Vercel), then local files (dev)
  return hasEnvCredentials() || (fs.existsSync(CRED_PATH) && fs.existsSync(TOKEN_PATH));
}

export async function getYouTubeAuth() {
  let client_id: string;
  let client_secret: string;
  let redirect_uri = 'http://localhost';
  let refresh_token: string;

  if (hasEnvCredentials()) {
    // Production: read from environment variables
    client_id = process.env.YOUTUBE_CLIENT_ID!;
    client_secret = process.env.YOUTUBE_CLIENT_SECRET!;
    refresh_token = process.env.YOUTUBE_REFRESH_TOKEN!;
  } else {
    // Local dev: read from files
    if (!fs.existsSync(CRED_PATH)) {
      throw new Error('YouTube not configured: missing scripts/client_secret.json');
    }
    if (!fs.existsSync(TOKEN_PATH)) {
      throw new Error(
        'YouTube not authenticated. Run the initial auth from terminal first:\n' +
        'node scripts/youtube-upload.js --video <any-video> --slug test'
      );
    }

    const credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
    const cred = credentials.installed || credentials.web;
    client_id = cred.client_id;
    client_secret = cred.client_secret;
    if (cred.redirect_uris?.[0]) redirect_uri = cred.redirect_uris[0];

    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    refresh_token = token.refresh_token;
  }

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
  oauth2Client.setCredentials({ refresh_token });

  // Always refresh to get a valid access token
  console.log('[YouTube] Refreshing access token...');
  const { credentials: newCreds } = await oauth2Client.refreshAccessToken();
  oauth2Client.setCredentials(newCreds);

  return oauth2Client;
}

// ─── Upload ────────────────────────────────────────────────────────
export async function uploadToYouTube(
  videoBuffer: Buffer,
  recipe: RecipeForYouTube
): Promise<{ videoId: string; videoUrl: string; embedUrl: string }> {
  const auth = await getYouTubeAuth();
  const youtube = google.youtube({ version: 'v3', auth });

  const title = recipe.title.substring(0, 100);
  const description = buildYouTubeDescription(recipe);
  const tags = buildTags(recipe);

  console.log(`[YouTube] Uploading: ${title} (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

  const readable = new Readable();
  readable.push(videoBuffer);
  readable.push(null);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags: tags.slice(0, 30),
        categoryId: '26', // How-to & Style
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: readable,
    },
  });

  const videoId = res.data.id!;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const embedUrl = `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`;

  console.log(`[YouTube] Uploaded! ${videoUrl}`);

  return { videoId, videoUrl, embedUrl };
}

// ─── Description Builder ───────────────────────────────────────────
export function buildYouTubeDescription(recipe: RecipeForYouTube): string {
  let desc = '';

  // Blurb
  if (recipe.description) {
    desc += recipe.description + '\n';
  }
  desc += '\n';

  // GET THIS RECIPE
  if (recipe.slug) {
    desc += `GET THIS RECIPE: https://theproteinpancake.co/blogs/recipes/${recipe.slug}\n`;
  }
  desc += `REQUEST A RECIPE: hello@theproteinpancake.co\n\n`;

  // FOLLOW US
  desc += `FOLLOW US:\n`;
  desc += `IG: https://www.instagram.com/the.proteinpancake/\n`;
  desc += `FB: https://www.facebook.com/theproteinpancake1\n`;
  desc += `TIKTOK: https://www.tiktok.com/@theproteinpancake?lang=en\n\n`;

  // BECOME A FLIPPER
  desc += `BECOME A FLIPPER: https://theproteinpancake.co\n\n`;

  // PRODUCTS USED
  const productsUsed = findProductsUsed(recipe);
  if (productsUsed.length > 0) {
    desc += `PRODUCTS USED:\n`;
    productsUsed.forEach(p => {
      desc += `${p.name}: ${p.url}\n`;
    });
    desc += '\n';
  }

  // RECIPE & NUTRITION
  desc += `RECIPE & NUTRITION:\n`;

  if (recipe.ingredients && recipe.ingredients.length > 0) {
    recipe.ingredients.forEach(ing => {
      const amount = ing.amount || '';
      const unit = ing.unit && ing.unit !== 'undefined' ? ing.unit : '';
      const notes = ing.notes ? ` (${ing.notes})` : '';
      const line = `${amount}${unit ? ' ' + unit : ''} - ${ing.item}${notes}`.trim();
      desc += `${line}  `;
    });
    desc += '\n\n';
  }

  // Nutrition
  if (recipe.calories || recipe.protein) {
    const parts = [];
    if (recipe.calories) parts.push(`Calories: ${Math.round(recipe.calories)}`);
    if (recipe.protein) parts.push(`Protein: ${Math.round(recipe.protein)}g`);
    if (recipe.carbs) parts.push(`Carbs: ${Math.round(recipe.carbs)}g`);
    if (recipe.fat) parts.push(`Fat: ${Math.round(recipe.fat)}g`);
    desc += parts.join(' | ') + '\n';
  }

  const infoParts = [];
  if (recipe.prep_time_minutes) infoParts.push(`Prep: ${recipe.prep_time_minutes} min`);
  if (recipe.cook_time_minutes) infoParts.push(`Cook: ${recipe.cook_time_minutes} min`);
  if (recipe.servings) infoParts.push(`Serves: ${recipe.servings}`);
  if (infoParts.length > 0) {
    desc += infoParts.join(' | ') + '\n';
  }

  desc += '\n';

  // Hashtags — #Shorts first so YouTube categorises as a Short
  desc += '#Shorts ' + buildHashtags(recipe);

  return desc;
}

// ─── Helpers ───────────────────────────────────────────────────────
function findProductsUsed(recipe: RecipeForYouTube) {
  const products: Array<{ name: string; url: string }> = [];
  const seen = new Set<string>();

  (recipe.ingredients || []).forEach(ing => {
    const item = (ing.item || '').toLowerCase();
    for (const [productName, url] of Object.entries(PRODUCT_URLS)) {
      if (item.includes(productName) && !seen.has(productName)) {
        seen.add(productName);
        const displayName = productName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        products.push({ name: displayName, url });
      }
    }
  });

  return products;
}

function buildHashtags(recipe: RecipeForYouTube): string {
  const tags = new Set<string>();

  tags.add('#TheProteinPancake');
  tags.add('#HighProtein');
  tags.add('#HealthyRecipe');

  const category = (recipe.category || '').toLowerCase();
  if (category === 'breakfast') { tags.add('#HealthyBreakfast'); tags.add('#BreakfastIdeas'); }
  else if (category === 'snack') { tags.add('#HealthySnack'); tags.add('#SnackIdeas'); }
  else if (category === 'dessert') { tags.add('#HealthyDessert'); tags.add('#GuiltFree'); }
  else if (category === 'dinner') { tags.add('#HealthyDinner'); tags.add('#DinnerIdeas'); }
  else if (category === 'lunch') { tags.add('#HealthyLunch'); tags.add('#LunchIdeas'); }
  else if (category === 'baking') { tags.add('#HealthyBaking'); tags.add('#ProteinBaking'); }

  (recipe.tags || []).forEach(t => {
    if (t === 'meal-prep') tags.add('#MealPrep');
    if (t === 'quick') tags.add('#QuickMeals');
    if (t === 'kid-friendly') tags.add('#KidFriendly');
    if (t === 'gluten-free') tags.add('#GlutenFree');
    if (t === 'vegetarian') tags.add('#Vegetarian');
    if (t === 'high-protein') tags.add('#HighProteinRecipe');
    if (t === 'low-carb') tags.add('#LowCarb');
  });

  (recipe.flavours || []).forEach(f => {
    if (f === 'chocolate') tags.add('#Chocolate');
    if (f === 'buttermilk') tags.add('#Buttermilk');
    if (f === 'cinnamon') tags.add('#Cinnamon');
  });

  tags.add('#ProteinRecipe');
  tags.add('#HealthyEating');

  return [...tags].join(' ');
}

function buildTags(recipe: RecipeForYouTube): string[] {
  const base = ['protein pancakes', 'healthy recipe', 'high protein', 'the protein pancake', 'healthy breakfast', 'meal prep'];
  const hashtagStr = buildHashtags(recipe);
  const hashtagTags = hashtagStr.split(' ').map(h => h.replace('#', '').replace(/([A-Z])/g, ' $1').trim());
  return [...new Set([...base, ...hashtagTags, ...(recipe.tags || []), recipe.category || 'breakfast', recipe.title])].filter(Boolean);
}
