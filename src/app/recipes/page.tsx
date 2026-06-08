'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Filter, Eye, Edit, Trash2, Video, Image, RefreshCw, Loader2 } from 'lucide-react';
import { supabase, Recipe } from '@/lib/supabase';

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    fetchRecipes();
  }, []);

  async function fetchRecipes() {
    try {
      const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRecipes(data || []);
    } catch (error) {
      console.error('Error fetching recipes:', error);
    } finally {
      setLoading(false);
    }
  }

  async function deleteRecipe(id: string) {
    if (!confirm('Are you sure you want to delete this recipe?')) return;

    try {
      const { error } = await supabase.from('recipes').delete().eq('id', id);
      if (error) throw error;
      setRecipes(recipes.filter(r => r.id !== id));
    } catch (error) {
      console.error('Error deleting recipe:', error);
      alert('Failed to delete recipe');
    }
  }

  async function togglePublished(recipe: Recipe) {
    try {
      const { error } = await supabase
        .from('recipes')
        .update({ is_published: !recipe.is_published })
        .eq('id', recipe.id);

      if (error) throw error;
      setRecipes(recipes.map(r =>
        r.id === recipe.id ? { ...r, is_published: !r.is_published } : r
      ));
    } catch (error) {
      console.error('Error updating recipe:', error);
    }
  }

  // Bulk sync all recipes with Shopify article IDs
  async function bulkSyncToShopify() {
    // Get recipes that have a Shopify article ID
    const recipesToSync = recipes.filter(r => r.shopify_article_id);

    if (recipesToSync.length === 0) {
      alert('No recipes are linked to Shopify blog posts yet. Create blog drafts from individual recipe edit pages first.');
      return;
    }

    if (!confirm(`Sync ${recipesToSync.length} recipe(s) to Shopify?\n\nThis will update all linked blog posts with current recipe data including ratings.`)) {
      return;
    }

    setSyncing(true);
    setSyncProgress({ current: 0, total: recipesToSync.length });

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < recipesToSync.length; i++) {
      const recipe = recipesToSync[i];
      setSyncProgress({ current: i + 1, total: recipesToSync.length });

      try {
        const response = await fetch('/api/shopify/blog-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipeId: recipe.id }),
        });

        if (response.ok) {
          results.success++;
        } else {
          const result = await response.json();
          results.failed++;
          results.errors.push(`${recipe.title}: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`${recipe.title}: Network error`);
      }
    }

    setSyncing(false);
    setSyncProgress({ current: 0, total: 0 });

    // Show results
    let message = `Sync complete!\n\n✅ ${results.success} recipe(s) synced successfully`;
    if (results.failed > 0) {
      message += `\n❌ ${results.failed} failed`;
      if (results.errors.length > 0) {
        message += `\n\nErrors:\n${results.errors.slice(0, 5).join('\n')}`;
        if (results.errors.length > 5) {
          message += `\n... and ${results.errors.length - 5} more`;
        }
      }
    }
    alert(message);
  }

  // Count recipes linked to Shopify
  const linkedToShopifyCount = recipes.filter(r => r.shopify_article_id).length;

  const filteredRecipes = recipes.filter(recipe => {
    const matchesSearch = recipe.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || recipe.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', 'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'baking'];

  return (
    <div className="px-4 py-5 sm:p-8">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-caramel sm:text-3xl">Recipes</h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Manage your recipe library</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {linkedToShopifyCount > 0 && (
            <button
              onClick={bulkSyncToShopify}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-lg bg-tppblue px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {syncing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /><span>{syncProgress.current}/{syncProgress.total}</span></>
              ) : (
                <><RefreshCw className="h-4 w-4" /><span className="hidden sm:inline">Sync to Shopify </span>({linkedToShopifyCount})</>
              )}
            </button>
          )}
          <Link href="/recipes/new" className="flex items-center gap-1.5 rounded-lg bg-caramel px-3 py-2 text-sm font-medium text-white hover:bg-maple">
            <Plus className="h-4 w-4" /> Add<span className="hidden sm:inline"> Recipe</span>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search recipes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-paper py-2 pl-9 pr-3 text-sm text-caramel placeholder:text-gray-400 focus:border-caramel focus:outline-none focus:ring-1 focus:ring-caramel"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="shrink-0 rounded-lg border border-gray-300 bg-paper px-2 py-2 text-sm text-caramel focus:border-caramel focus:outline-none"
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Recipes list */}
      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-paper p-8 text-center text-gray-500">Loading recipes…</div>
      ) : filteredRecipes.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-paper p-8 text-center text-gray-500">
          No recipes found. <Link href="/recipes/new" className="text-caramel hover:underline">Add your first recipe</Link>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filteredRecipes.map((recipe) => (
              <div key={recipe.id} className="flex gap-3 rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
                {recipe.featured_image ? (
                  <img src={recipe.featured_image} alt={recipe.title} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-cream text-2xl">🥞</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-semibold text-caramel">{recipe.title}</p>
                    <span className="shrink-0 rounded-full bg-cream px-2 py-0.5 text-[10px] font-medium capitalize text-caramel">{recipe.category}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500">{recipe.calories || '-'} cal · {recipe.protein || '-'}g protein · {(recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0)} min</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button onClick={() => togglePublished(recipe)} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${recipe.is_published ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{recipe.is_published ? 'Published' : 'Draft'}</button>
                    {recipe.shopify_article_id && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Linked</span>}
                    {recipe.rating ? <span className="text-[11px] text-amber-500">★ {recipe.rating.toFixed(1)}</span> : null}
                    <div className="ml-auto flex items-center gap-0.5">
                      <Link href={`/recipes/${recipe.id}`} className="rounded p-1.5 text-gray-500 hover:bg-cream hover:text-caramel"><Eye className="h-4 w-4" /></Link>
                      <Link href={`/recipes/${recipe.id}/edit`} className="rounded p-1.5 text-gray-500 hover:bg-cream hover:text-caramel"><Edit className="h-4 w-4" /></Link>
                      <button onClick={() => deleteRecipe(recipe.id)} className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-paper shadow-sm md:block">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Recipe
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Category
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Macros
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Rating
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Media
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Blog
                </th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRecipes.map((recipe) => (
                <tr key={recipe.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {recipe.featured_image ? (
                        <img
                          src={recipe.featured_image}
                          alt={recipe.title}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-cream flex items-center justify-center">
                          <span className="text-2xl">🥞</span>
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-caramel">{recipe.title}</p>
                        <p className="text-sm text-gray-500">
                          {recipe.prep_time_minutes || 0} + {recipe.cook_time_minutes || 0} min
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cream text-caramel capitalize">
                      {recipe.category}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm">
                      <span className="font-medium text-caramel">{recipe.calories || '-'}</span>
                      <span className="text-gray-500"> cal</span>
                      <span className="mx-1 text-gray-300">|</span>
                      <span className="font-medium text-maple">{recipe.protein || '-'}g</span>
                      <span className="text-gray-500"> protein</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {recipe.rating ? (
                      <div className="text-sm">
                        <span className="text-amber-500">{'★'.repeat(Math.round(recipe.rating))}{'☆'.repeat(5 - Math.round(recipe.rating))}</span>
                        <span className="text-gray-500 ml-1">({recipe.review_count || 0})</span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-sm">No ratings</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {recipe.featured_image && (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <Image className="h-4 w-4" />
                        </span>
                      )}
                      {recipe.video_url && (
                        <span className="inline-flex items-center gap-1 text-blue-600">
                          <Video className="h-4 w-4" />
                        </span>
                      )}
                      {!recipe.featured_image && !recipe.video_url && (
                        <span className="text-gray-400 text-sm">No media</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => togglePublished(recipe)}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        recipe.is_published
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {recipe.is_published ? 'Published' : 'Draft'}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    {recipe.shopify_article_id ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                        Linked
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">Not linked</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/recipes/${recipe.id}`}
                        className="p-2 text-gray-600 hover:text-caramel hover:bg-cream rounded-lg transition-colors"
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`/recipes/${recipe.id}/edit`}
                        className="p-2 text-gray-600 hover:text-caramel hover:bg-cream rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => deleteRecipe(recipe.id)}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
