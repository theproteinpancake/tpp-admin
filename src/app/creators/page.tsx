'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Edit, Trash2, Instagram, ExternalLink } from 'lucide-react';
import { supabase, Creator } from '@/lib/supabase';

export default function CreatorsPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchCreators();
  }, []);

  async function fetchCreators() {
    try {
      const { data, error } = await supabase
        .from('creators')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setCreators(data || []);
    } catch (error) {
      console.error('Error fetching creators:', error);
    } finally {
      setLoading(false);
    }
  }

  async function deleteCreator(id: string) {
    if (!confirm('Are you sure you want to delete this creator?')) return;

    try {
      const { error } = await supabase.from('creators').delete().eq('id', id);
      if (error) throw error;
      setCreators(creators.filter(c => c.id !== id));
    } catch (error) {
      console.error('Error deleting creator:', error);
      alert('Failed to delete creator');
    }
  }

  const filteredCreators = creators.filter(creator =>
    creator.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Creators</h1>
          <p className="text-gray-600 mt-1">Manage recipe creators and influencers</p>
        </div>
        <Link
          href="/creators/new"
          className="flex items-center gap-2 bg-caramel text-white px-4 py-2.5 rounded-lg hover:bg-maple transition-colors"
        >
          <Plus className="h-5 w-5" />
          Add Creator
        </Link>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search creators..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent"
          />
        </div>
      </div>

      {/* Creators Grid */}
      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading creators...</div>
      ) : filteredCreators.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500 mb-4">No creators found.</p>
          <Link href="/creators/new" className="text-caramel hover:underline">
            Add your first creator
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCreators.map((creator) => (
            <div
              key={creator.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Header with profile image */}
              <div className="h-24 bg-gradient-to-r from-caramel to-maple relative">
                {creator.profile_image ? (
                  <img
                    src={creator.profile_image}
                    alt={creator.name}
                    className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 w-20 h-20 rounded-full border-4 border-white object-cover"
                  />
                ) : (
                  <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 w-20 h-20 rounded-full border-4 border-white bg-cream flex items-center justify-center">
                    <span className="text-3xl">👨‍🍳</span>
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="pt-12 pb-6 px-6 text-center">
                <h3 className="text-lg font-semibold text-gray-900">{creator.name}</h3>
                {creator.bio && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{creator.bio}</p>
                )}

                {/* Social Links */}
                <div className="flex items-center justify-center gap-3 mt-4">
                  {creator.instagram_handle && (
                    <a
                      href={`https://instagram.com/${creator.instagram_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-gray-600 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-colors"
                    >
                      <Instagram className="h-5 w-5" />
                    </a>
                  )}
                  {creator.tiktok_handle && (
                    <a
                      href={`https://tiktok.com/@${creator.tiktok_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-gray-600 hover:text-black hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
                      </svg>
                    </a>
                  )}
                  {creator.website && (
                    <a
                      href={creator.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <ExternalLink className="h-5 w-5" />
                    </a>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-100">
                  <Link
                    href={`/creators/${creator.id}/edit`}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-caramel hover:bg-cream rounded-lg transition-colors"
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </Link>
                  <button
                    onClick={() => deleteCreator(creator.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>

                {/* Featured badge */}
                {creator.is_featured && (
                  <div className="absolute top-4 right-4">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                      ⭐ Featured
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
