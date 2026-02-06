'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Plus, X, Loader2, Video, Image as ImageIcon, Send, Youtube } from 'lucide-react';
import Link from 'next/link';
import { supabase, RecipeIngredient, Creator } from '@/lib/supabase';

interface RecipeForm {
  title: string;
  slug: string;
  description: string;
  category: string;
  tags: string[];
  flavours: string[];
  prep_time_minutes: number;
  cook_time_minutes: number;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  rating: number;
  review_count: number;
  ingredients: RecipeIngredient[];
  instructions: string[];
  tips: string;
  featured_image: string;
  video_url: string;
  is_featured: boolean;
  is_published: boolean;
  creator_id: string;
  publish_to_blog: boolean;
  upload_to_youtube: boolean;
}

const initialForm: RecipeForm = {
  title: '',
  slug: '',
  description: '',
  category: 'breakfast',
  tags: [],
  flavours: [],
  prep_time_minutes: 5,
  cook_time_minutes: 10,
  servings: 1,
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  rating: 0,
  review_count: 0,
  ingredients: [{ amount: '', unit: '', item: '', notes: '' }],
  instructions: [''],
  tips: '',
  featured_image: '',
  video_url: '',
  is_featured: false,
  is_published: false,
  creator_id: '',
  publish_to_blog: false,
  upload_to_youtube: false,
};

export default function NewRecipePage() {
  const router = useRouter();
  const [form, setForm] = useState<RecipeForm>(initialForm);
  const [saving, setSaving] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [newTag, setNewTag] = useState('');
  const [creators, setCreators] = useState<Creator[]>([]);

  // Fetch creators
  useEffect(() => {
    async function fetchCreators() {
      const { data } = await supabase
        .from('creators')
        .select('*')
        .order('name', { ascending: true });
      setCreators(data || []);
    }
    fetchCreators();
  }, []);

  // Generate slug from title
  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  };

  // Handle title change and auto-generate slug
  const handleTitleChange = (title: string) => {
    setForm({
      ...form,
      title,
      slug: generateSlug(title),
    });
  };

  // Add ingredient
  const addIngredient = () => {
    setForm({
      ...form,
      ingredients: [...form.ingredients, { amount: '', unit: '', item: '', notes: '' }],
    });
  };

  // Update ingredient
  const updateIngredient = (index: number, field: keyof RecipeIngredient, value: string) => {
    const updated = [...form.ingredients];
    updated[index] = { ...updated[index], [field]: value };
    setForm({ ...form, ingredients: updated });
  };

  // Remove ingredient
  const removeIngredient = (index: number) => {
    setForm({
      ...form,
      ingredients: form.ingredients.filter((_, i) => i !== index),
    });
  };

  // Add instruction
  const addInstruction = () => {
    setForm({ ...form, instructions: [...form.instructions, ''] });
  };

  // Update instruction
  const updateInstruction = (index: number, value: string) => {
    const updated = [...form.instructions];
    updated[index] = value;
    setForm({ ...form, instructions: updated });
  };

  // Remove instruction
  const removeInstruction = (index: number) => {
    setForm({
      ...form,
      instructions: form.instructions.filter((_, i) => i !== index),
    });
  };

  // Add tag
  const addTag = () => {
    if (newTag && !form.tags.includes(newTag)) {
      setForm({ ...form, tags: [...form.tags, newTag] });
      setNewTag('');
    }
  };

  // Remove tag
  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter(t => t !== tag) });
  };

  // Upload video to Mux
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingVideo(true);
    setVideoProgress(0);

    try {
      // Get direct upload URL from our API
      const response = await fetch('/api/mux/upload', {
        method: 'POST',
      });
      const { uploadUrl, uploadId } = await response.json();

      // Upload file directly to Mux
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          setVideoProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      await new Promise((resolve, reject) => {
        xhr.open('PUT', uploadUrl);
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(file);
      });

      // Poll for asset ready (show processing status)
      setVideoProgress(100);
      let assetId = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch(`/api/mux/upload/${uploadId}`);
        const status = await statusRes.json();

        if (status.asset_id) {
          assetId = status.asset_id;
          break;
        }
      }

      if (assetId) {
        // Get playback ID
        const assetRes = await fetch(`/api/mux/asset/${assetId}`);
        const asset = await assetRes.json();
        const playbackId = asset.playback_ids?.[0]?.id;

        if (playbackId) {
          setForm({
            ...form,
            video_url: `https://stream.mux.com/${playbackId}.m3u8`,
          });
        }
      }
    } catch (error) {
      console.error('Video upload error:', error);
      alert('Failed to upload video');
    } finally {
      setUploadingVideo(false);
      setVideoProgress(0);
    }
  };

  // Upload image to Supabase Storage
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `recipe-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('recipe-images')
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw new Error(`Upload failed: ${uploadError.message}. Make sure "recipe-images" bucket exists in Supabase Storage.`);
      }

      const { data: { publicUrl } } = supabase.storage
        .from('recipe-images')
        .getPublicUrl(filePath);

      setForm({ ...form, featured_image: publicUrl });
    } catch (error) {
      console.error('Image upload error:', error);
      alert('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  // Save recipe
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Clean up empty ingredients and instructions
      const cleanIngredients = form.ingredients.filter(i => i.item.trim());
      const cleanInstructions = form.instructions.filter(i => i.trim());

      const recipeData = {
        title: form.title,
        slug: form.slug,
        description: form.description || null,
        category: form.category,
        tags: form.tags,
        flavours: form.flavours,
        prep_time_minutes: form.prep_time_minutes,
        cook_time_minutes: form.cook_time_minutes,
        servings: form.servings,
        calories: form.calories || null,
        protein: form.protein || null,
        carbs: form.carbs || null,
        fat: form.fat || null,
        rating: form.rating || null,
        review_count: form.review_count || null,
        ingredients: cleanIngredients,
        instructions: cleanInstructions,
        tips: form.tips || null,
        featured_image: form.featured_image || null,
        video_url: form.video_url || null,
        is_featured: form.is_featured,
        is_published: form.is_published,
        creator_id: form.creator_id || null,
      };

      const { data, error } = await supabase
        .from('recipes')
        .insert(recipeData)
        .select()
        .single();

      if (error) throw error;

      // If publish to blog is enabled, create draft in Shopify
      if (form.publish_to_blog && data) {
        await fetch('/api/shopify/blog-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipeId: data.id }),
        });
      }

      // If upload to YouTube is enabled, upload the video
      if (form.upload_to_youtube && form.video_url && data) {
        try {
          const ytResponse = await fetch('/api/youtube/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipeId: data.id }),
          });

          const ytResult = await ytResponse.json();

          if (!ytResponse.ok) {
            console.error('YouTube upload error:', ytResult);
            alert(`Recipe saved but YouTube upload failed: ${ytResult.error || 'Unknown error'}`);
          }
        } catch (ytError) {
          console.error('YouTube upload error:', ytError);
        }
      }

      router.push('/recipes');
    } catch (error: unknown) {
      console.error('Error saving recipe:', error);
      const errorMessage = error instanceof Error ? error.message :
        (error as { message?: string })?.message || 'Unknown error';
      alert(`Failed to save recipe: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/recipes"
          className="p-2 text-gray-600 hover:text-caramel hover:bg-cream rounded-lg transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Add New Recipe</h1>
          <p className="text-gray-600 mt-1">Create a new recipe for the TPP app</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipe Title *
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                placeholder="e.g., Chocolate Protein Pancakes"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URL Slug
              </label>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category *
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              >
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
                <option value="dessert">Dessert</option>
                <option value="baking">Baking</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Creator / Author
              </label>
              <select
                value={form.creator_id}
                onChange={(e) => setForm({ ...form, creator_id: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900"
              >
                <option value="">No creator assigned</option>
                {creators.map((creator) => (
                  <option key={creator.id} value={creator.id}>
                    {creator.name}
                  </option>
                ))}
              </select>
              {creators.length === 0 && (
                <p className="text-sm text-gray-500 mt-1">
                  No creators yet. <Link href="/creators/new" className="text-caramel hover:underline">Add a creator first</Link>
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                placeholder="A brief description of the recipe..."
              />
            </div>
          </div>
        </div>

        {/* Media Upload */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Media</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Image Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Featured Image
              </label>
              {form.featured_image ? (
                <div className="relative">
                  <img
                    src={form.featured_image}
                    alt="Preview"
                    className="w-full h-48 object-cover rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, featured_image: '' })}
                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                  {uploadingImage ? (
                    <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
                  ) : (
                    <>
                      <ImageIcon className="h-8 w-8 text-gray-400 mb-2" />
                      <span className="text-sm text-gray-500">Click to upload image</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Video Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Recipe Video (Reels)
              </label>
              {form.video_url ? (
                <div className="relative bg-gray-900 rounded-lg h-48 flex items-center justify-center">
                  <Video className="h-12 w-12 text-white" />
                  <span className="absolute bottom-2 left-2 text-xs text-white bg-black/50 px-2 py-1 rounded">
                    Video uploaded ✓
                  </span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, video_url: '' })}
                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                  {uploadingVideo ? (
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 text-caramel animate-spin mx-auto mb-2" />
                      <span className="text-sm text-gray-500">
                        {videoProgress === 100 ? 'Processing video...' : `Uploading... ${videoProgress}%`}
                      </span>
                      <div className="w-32 h-2 bg-gray-200 rounded-full mt-2">
                        <div
                          className="h-full bg-caramel rounded-full transition-all"
                          style={{ width: `${videoProgress}%` }}
                        />
                      </div>
                      {videoProgress === 100 && (
                        <span className="text-xs text-gray-400 mt-2 block">This may take a minute...</span>
                      )}
                    </div>
                  ) : (
                    <>
                      <Video className="h-8 w-8 text-gray-400 mb-2" />
                      <span className="text-sm text-gray-500">Click to upload video</span>
                      <span className="text-xs text-gray-400 mt-1">Auto-optimized by Mux</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoUpload}
                    className="hidden"
                    disabled={uploadingVideo}
                  />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Timing & Servings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Time & Servings</h2>

          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Prep Time (min)
              </label>
              <input
                type="number"
                value={form.prep_time_minutes}
                onChange={(e) => setForm({ ...form, prep_time_minutes: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cook Time (min)
              </label>
              <input
                type="number"
                value={form.cook_time_minutes}
                onChange={(e) => setForm({ ...form, cook_time_minutes: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Servings
              </label>
              <input
                type="number"
                value={form.servings}
                onChange={(e) => setForm({ ...form, servings: parseInt(e.target.value) || 1 })}
                min="1"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Macros */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Nutrition (per serving)</h2>

          <div className="grid grid-cols-4 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Calories
              </label>
              <input
                type="number"
                value={form.calories}
                onChange={(e) => setForm({ ...form, calories: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Protein (g)
              </label>
              <input
                type="number"
                value={form.protein}
                onChange={(e) => setForm({ ...form, protein: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Carbs (g)
              </label>
              <input
                type="number"
                value={form.carbs}
                onChange={(e) => setForm({ ...form, carbs: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fat (g)
              </label>
              <input
                type="number"
                value={form.fat}
                onChange={(e) => setForm({ ...form, fat: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Ratings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Ratings (synced with Shopify)</h2>
          <p className="text-sm text-gray-500 mb-4">
            Set the recipe rating (1-5 stars) and review count. These will display in the app and sync to Shopify blog posts.
          </p>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rating (1-5)
              </label>
              <input
                type="number"
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: Math.min(5, Math.max(0, parseFloat(e.target.value) || 0)) })}
                min="0"
                max="5"
                step="0.1"
                placeholder="e.g., 4.5"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
              {form.rating > 0 && (
                <div className="mt-2 text-xl">
                  {'★'.repeat(Math.round(form.rating))}{'☆'.repeat(5 - Math.round(form.rating))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Review Count
              </label>
              <input
                type="number"
                value={form.review_count}
                onChange={(e) => setForm({ ...form, review_count: parseInt(e.target.value) || 0 })}
                min="0"
                placeholder="e.g., 42"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Ingredients */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Ingredients</h2>

          <div className="space-y-3">
            {form.ingredients.map((ingredient, index) => (
              <div key={index} className="flex items-center gap-3">
                <input
                  type="text"
                  value={ingredient.amount}
                  onChange={(e) => updateIngredient(index, 'amount', e.target.value)}
                  placeholder="1"
                  className="w-16 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                />
                <input
                  type="text"
                  value={ingredient.unit}
                  onChange={(e) => updateIngredient(index, 'unit', e.target.value)}
                  placeholder="cup"
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                />
                <input
                  type="text"
                  value={ingredient.item}
                  onChange={(e) => updateIngredient(index, 'item', e.target.value)}
                  placeholder="TPP Buttermilk Mix"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                />
                <input
                  type="text"
                  value={ingredient.notes}
                  onChange={(e) => updateIngredient(index, 'notes', e.target.value)}
                  placeholder="optional notes"
                  className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                />
                <button
                  type="button"
                  onClick={() => removeIngredient(index)}
                  className="p-2 text-gray-400 hover:text-red-500"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addIngredient}
            className="mt-4 flex items-center gap-2 text-caramel hover:text-maple"
          >
            <Plus className="h-4 w-4" />
            Add Ingredient
          </button>
        </div>

        {/* Instructions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Instructions</h2>

          <div className="space-y-3">
            {form.instructions.map((instruction, index) => (
              <div key={index} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-8 h-8 bg-caramel text-white rounded-full flex items-center justify-center text-sm font-medium">
                  {index + 1}
                </span>
                <textarea
                  value={instruction}
                  onChange={(e) => updateInstruction(index, e.target.value)}
                  placeholder="Describe this step..."
                  rows={2}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                />
                <button
                  type="button"
                  onClick={() => removeInstruction(index)}
                  className="p-2 text-gray-400 hover:text-red-500"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addInstruction}
            className="mt-4 flex items-center gap-2 text-caramel hover:text-maple"
          >
            <Plus className="h-4 w-4" />
            Add Step
          </button>
        </div>

        {/* Tags */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Tags</h2>

          <div className="flex flex-wrap gap-2 mb-4">
            {form.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-3 py-1 bg-cream text-caramel rounded-full text-sm"
              >
                {tag}
                <button type="button" onClick={() => removeTag(tag)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              placeholder="Add a tag..."
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent"
            />
            <button
              type="button"
              onClick={addTag}
              className="px-4 py-2.5 bg-cream text-caramel rounded-lg hover:bg-churro"
            >
              Add
            </button>
          </div>
        </div>

        {/* Tips */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Tips & Notes</h2>
          <textarea
            value={form.tips}
            onChange={(e) => setForm({ ...form, tips: e.target.value })}
            rows={3}
            placeholder="Any tips for making this recipe..."
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Publishing Options */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Publishing</h2>

          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.is_published}
                onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
                className="w-5 h-5 text-caramel rounded focus:ring-caramel"
              />
              <div>
                <span className="font-medium text-gray-900">Publish to App</span>
                <p className="text-sm text-gray-500">Make this recipe visible in the TPP app</p>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
                className="w-5 h-5 text-caramel rounded focus:ring-caramel"
              />
              <div>
                <span className="font-medium text-gray-900">Featured Recipe</span>
                <p className="text-sm text-gray-500">Show in featured section on home screen</p>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.publish_to_blog}
                onChange={(e) => setForm({ ...form, publish_to_blog: e.target.checked })}
                className="w-5 h-5 text-caramel rounded focus:ring-caramel"
              />
              <div>
                <span className="font-medium text-gray-900">Create Blog Draft</span>
                <p className="text-sm text-gray-500">Create a draft post on Shopify blog for editing</p>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.upload_to_youtube}
                onChange={(e) => setForm({ ...form, upload_to_youtube: e.target.checked })}
                disabled={!form.video_url}
                className="w-5 h-5 text-red-600 rounded focus:ring-red-500"
              />
              <div className="flex items-center gap-2">
                <Youtube className="h-5 w-5 text-red-600" />
                <div>
                  <span className="font-medium text-gray-900">Upload to YouTube</span>
                  <p className="text-sm text-gray-500">
                    {!form.video_url
                      ? 'Upload a video first to enable YouTube'
                      : 'Auto-upload with branded description, tags & hashtags'}
                  </p>
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="flex items-center justify-end gap-4">
          <Link
            href="/recipes"
            className="px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving || !form.title}
            className="flex items-center gap-2 px-6 py-2.5 bg-caramel text-white rounded-lg hover:bg-maple disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Send className="h-5 w-5" />
                Save Recipe
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
