'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Save, Upload, X } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface CreatorForm {
  name: string;
  bio: string;
  profile_image: string;
  instagram_handle: string;
  tiktok_handle: string;
  youtube_handle: string;
  website: string;
  is_featured: boolean;
}

const initialForm: CreatorForm = {
  name: '',
  bio: '',
  profile_image: '',
  instagram_handle: '',
  tiktok_handle: '',
  youtube_handle: '',
  website: '',
  is_featured: false,
};

export default function NewCreatorPage() {
  const router = useRouter();
  const [form, setForm] = useState<CreatorForm>(initialForm);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `creator-${Date.now()}.${fileExt}`;
      const filePath = `creator-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('recipe-images')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('recipe-images')
        .getPublicUrl(filePath);

      setForm({ ...form, profile_image: publicUrl });
    } catch (error) {
      console.error('Image upload error:', error);
      alert('Failed to upload image. Make sure "recipe-images" bucket exists in Supabase Storage and is set to public.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const { error } = await supabase.from('creators').insert({
        name: form.name,
        bio: form.bio || null,
        profile_image: form.profile_image || null,
        instagram_handle: form.instagram_handle || null,
        tiktok_handle: form.tiktok_handle || null,
        youtube_handle: form.youtube_handle || null,
        website: form.website || null,
        is_featured: form.is_featured,
      });

      if (error) throw error;

      router.push('/creators');
    } catch (error) {
      console.error('Error saving creator:', error);
      alert('Failed to save creator');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/creators"
          className="p-2 text-gray-600 hover:text-caramel hover:bg-cream rounded-lg transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Add Creator</h1>
          <p className="text-gray-600 mt-1">Add a new recipe creator or influencer</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Profile Image */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile</h2>

          <div className="flex items-start gap-6">
            {/* Image Upload */}
            <div className="flex-shrink-0">
              {form.profile_image ? (
                <div className="relative">
                  <img
                    src={form.profile_image}
                    alt="Profile"
                    className="w-24 h-24 rounded-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, profile_image: '' })}
                    className="absolute -top-1 -right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-24 h-24 border-2 border-gray-300 border-dashed rounded-full cursor-pointer bg-gray-50 hover:bg-gray-100">
                  {uploadingImage ? (
                    <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
                  ) : (
                    <Upload className="h-6 w-6 text-gray-400" />
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

            {/* Name and Bio */}
            <div className="flex-1 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                  placeholder="Creator's name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bio
                </label>
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                  placeholder="A short bio about this creator..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Social Links */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Social Links</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Instagram Handle
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                  @
                </span>
                <input
                  type="text"
                  value={form.instagram_handle}
                  onChange={(e) => setForm({ ...form, instagram_handle: e.target.value.replace('@', '') })}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-r-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                  placeholder="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                TikTok Handle
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                  @
                </span>
                <input
                  type="text"
                  value={form.tiktok_handle}
                  onChange={(e) => setForm({ ...form, tiktok_handle: e.target.value.replace('@', '') })}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-r-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                  placeholder="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                YouTube Handle
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                  @
                </span>
                <input
                  type="text"
                  value={form.youtube_handle}
                  onChange={(e) => setForm({ ...form, youtube_handle: e.target.value.replace('@', '') })}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-r-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                  placeholder="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Website
              </label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent text-gray-900 placeholder-gray-400"
                placeholder="https://..."
              />
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Settings</h2>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.is_featured}
              onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
              className="w-5 h-5 text-caramel rounded focus:ring-caramel"
            />
            <div>
              <span className="font-medium text-gray-900">Featured Creator</span>
              <p className="text-sm text-gray-500">Show this creator prominently in the app</p>
            </div>
          </label>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-4">
          <Link
            href="/creators"
            className="px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving || !form.name}
            className="flex items-center gap-2 px-6 py-2.5 bg-caramel text-white rounded-lg hover:bg-maple disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-5 w-5" />
                Save Creator
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
