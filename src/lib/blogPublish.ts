// Push a recipe's regenerated HTML into its existing Shopify blog article.
// Lives in lib (not just the API route) so server code — e.g. the YouTube upload route adding
// the embed after upload — can call it DIRECTLY. The old pattern (an HTTP fetch to our own
// /api/shopify/blog-update) never worked from the server: the cookieless self-call got bounced
// to /login by middleware and swallowed as "non-critical", which is why published blogs were
// missing their videos even though youtube_video_id was saved fine.
import { supabase } from './supabase';
import { generateBlogHtml } from './blog-html';
import { generateMetaTitle, generateMetaDescription } from './seo-utils';

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'theproteinpancake.myshopify.com';

export type BlogUpdateResult =
  | { ok: true; articleId: number | string; articleUrl: string }
  | { ok: false; error: string; status: number };

export async function updateRecipeBlog(recipeId: string): Promise<BlogUpdateResult> {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'Shopify integration not configured', status: 500 };

  const { data: recipe, error } = await supabase.from('recipes').select('*').eq('id', recipeId).single();
  if (error || !recipe) return { ok: false, error: 'Recipe not found', status: 404 };
  if (!recipe.shopify_article_id) {
    return { ok: false, error: 'This recipe has not been published to Shopify yet. Use "Create Blog Draft" first.', status: 400 };
  }

  const blogContent = generateBlogHtml(recipe);
  const H = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  // Find the blog that contains this article
  const blogsResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs.json`, { headers: H });
  if (!blogsResponse.ok) return { ok: false, error: 'Failed to fetch Shopify blogs', status: 500 };
  const { blogs } = await blogsResponse.json();

  let targetBlogId: number | null = null;
  for (const blog of blogs) {
    const articleCheck = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs/${blog.id}/articles/${recipe.shopify_article_id}.json`,
      { headers: H },
    );
    if (articleCheck.ok) { targetBlogId = blog.id; break; }
  }
  if (!targetBlogId) {
    // Article not found - clear the stale ID and prompt to create new
    await supabase.from('recipes').update({ shopify_article_id: null }).eq('id', recipeId);
    return { ok: false, error: 'The linked Shopify article was not found. It may have been deleted. Please create a new blog draft.', status: 404 };
  }

  // Visible article title = the CLEAN recipe title. The SEO title (with the "| High Protein
  // …" suffix) lives ONLY in the global.title_tag metafield, which Shopify serves to search
  // engines. Using the SEO title as article.title was why every post showed the suffix on the
  // site and Luke had to hand-delete it before saving.
  const articleTitle = recipe.title;
  const seoTitle = recipe.meta_title || generateMetaTitle(recipe);
  const metaDescription = recipe.meta_description || generateMetaDescription(recipe);

  const putArticle = (withImage: boolean) => fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs/${targetBlogId}/articles/${recipe.shopify_article_id}.json`,
    {
      method: 'PUT', headers: H,
      body: JSON.stringify({
        article: {
          id: recipe.shopify_article_id,
          title: articleTitle,
          body_html: blogContent,
          summary_html: metaDescription,
          tags: recipe.tags?.join(', ') || '',
          ...(withImage && recipe.featured_image && { image: { src: recipe.featured_image, alt: articleTitle } }),
        },
      }),
    },
  );

  let updateResponse = await putArticle(true);
  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    // A dead featured_image URL (e.g. deleted from Shopify's CDN) 422s the WHOLE update —
    // retry without the image so the body still lands; the article keeps its existing image.
    if (updateResponse.status === 422 && /image upload failed/i.test(errorText)) {
      console.warn(`Blog update for ${recipe.slug}: featured image failed to download, retrying without it`);
      updateResponse = await putArticle(false);
    }
    if (!updateResponse.ok) {
      console.error('Failed to update article:', updateResponse.status, errorText);
      return { ok: false, error: `Failed to update blog post: ${errorText}`, status: 500 };
    }
  }
  const { article } = await updateResponse.json();

  // Ensure the SEO metafields exist/refresh — with the suffix gone from the visible title,
  // Shopify would fall back to that clean title in search results unless global.title_tag is
  // actually set (older articles may predate the draft route writing it).
  try {
    await upsertArticleMetafield(targetBlogId, article.id, 'title_tag', seoTitle);
    await upsertArticleMetafield(targetBlogId, article.id, 'description_tag', metaDescription);
  } catch (e) { console.warn('SEO metafield upsert failed (article body still updated):', String(e).slice(0, 160)); }

  return { ok: true, articleId: article.id, articleUrl: `https://${SHOPIFY_STORE_DOMAIN}/admin/blogs/${targetBlogId}/articles/${article.id}` };
}

// Create-or-update a `global` namespace metafield on an article (Shopify's SEO title/description).
async function upsertArticleMetafield(blogId: number, articleId: number | string, key: string, value: string) {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
  const H = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
  const base = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs/${blogId}/articles/${articleId}/metafields`;
  const listRes = await fetch(`${base}.json?namespace=global&key=${key}`, { headers: H });
  if (!listRes.ok) throw new Error(`metafield list ${listRes.status}`);
  const existing = ((await listRes.json()).metafields || [])[0];
  const metafield = { namespace: 'global', key, value, type: 'single_line_text_field' };
  const res = existing
    ? await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/metafields/${existing.id}.json`, {
        method: 'PUT', headers: H, body: JSON.stringify({ metafield: { id: existing.id, value } }) })
    : await fetch(`${base}.json`, { method: 'POST', headers: H, body: JSON.stringify({ metafield }) });
  if (!res.ok) throw new Error(`metafield ${key} ${existing ? 'update' : 'create'} ${res.status}: ${(await res.text()).slice(0, 120)}`);
}
