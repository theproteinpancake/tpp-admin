import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for our database tables
export interface Recipe {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  slug: string;
  description: string | null;
  featured_image: string | null;
  category: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'dessert' | 'baking';
  tags: string[];
  flavours: string[];
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: RecipeIngredient[];
  instructions: string[];
  tips: string | null;
  video_url: string | null;
  original_video_url: string | null;
  is_featured: boolean;
  is_published: boolean;
  source_url: string | null;
  creator_id?: string | null;
  rating: number | null;
  review_count: number | null;
  shopify_article_id: string | null;
  youtube_video_id: string | null;
}

export interface RecipeIngredient {
  amount: string;
  unit?: string;
  item: string;
  notes?: string;
}

export interface Creator {
  id: string;
  created_at: string;
  name: string;
  slug: string;
  bio: string | null;
  profile_image: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  youtube_handle: string | null;
  website: string | null;
  is_featured: boolean;
}

export interface ScheduledNotification {
  id: string;
  created_at: string;
  title: string;
  body: string;
  day_of_week: number | null; // 0-6 for Sunday-Saturday
  time: string; // HH:MM format
  is_active: boolean;
  last_sent_at: string | null;
}

export interface AppUser {
  id: string;
  created_at: string;
  email: string | null;
  push_token: string | null;
  has_completed_onboarding: boolean;
  goal: string | null;
  daily_calorie_target: number | null;
  daily_protein_target: number | null;
}
