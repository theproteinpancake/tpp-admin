'use client';

import { useState, useEffect } from 'react';
import { UtensilsCrossed, Users, Bell, TrendingUp, Eye, Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface DashboardStats {
  totalRecipes: number;
  publishedRecipes: number;
  totalUsers: number;
  activeUsers: number;
  totalCreators: number;
  notificationsSent: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalRecipes: 0,
    publishedRecipes: 0,
    totalUsers: 0,
    activeUsers: 0,
    totalCreators: 0,
    notificationsSent: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        // Fetch recipe counts
        const { count: totalRecipes } = await supabase
          .from('recipes')
          .select('*', { count: 'exact', head: true });

        const { count: publishedRecipes } = await supabase
          .from('recipes')
          .select('*', { count: 'exact', head: true })
          .eq('is_published', true);

        setStats({
          totalRecipes: totalRecipes || 0,
          publishedRecipes: publishedRecipes || 0,
          totalUsers: 0, // Will populate when user table exists
          activeUsers: 0,
          totalCreators: 0,
          notificationsSent: 0,
        });
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  const statCards = [
    {
      title: 'Total Recipes',
      value: stats.totalRecipes,
      subtext: `${stats.publishedRecipes} published`,
      icon: UtensilsCrossed,
      color: 'bg-caramel',
    },
    {
      title: 'Total Users',
      value: stats.totalUsers,
      subtext: `${stats.activeUsers} active this week`,
      icon: Users,
      color: 'bg-buttermilk-blue',
    },
    {
      title: 'Creators',
      value: stats.totalCreators,
      subtext: 'Recipe contributors',
      icon: Heart,
      color: 'bg-maple',
    },
    {
      title: 'Notifications Sent',
      value: stats.notificationsSent,
      subtext: 'This month',
      icon: Bell,
      color: 'bg-green-500',
    },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome back! Here's what's happening with TPP.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((stat) => (
          <div
            key={stat.title}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {loading ? '...' : stat.value.toLocaleString()}
                </p>
                <p className="text-sm text-gray-500 mt-1">{stat.subtext}</p>
              </div>
              <div className={`${stat.color} p-3 rounded-lg`}>
                <stat.icon className="h-6 w-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
              <div className="bg-green-100 p-2 rounded-full">
                <UtensilsCrossed className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">New recipe added</p>
                <p className="text-xs text-gray-500">Chocolate Protein Pancakes</p>
              </div>
              <span className="ml-auto text-xs text-gray-400">2h ago</span>
            </div>
            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
              <div className="bg-blue-100 p-2 rounded-full">
                <Users className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">New user signup</p>
                <p className="text-xs text-gray-500">user@example.com</p>
              </div>
              <span className="ml-auto text-xs text-gray-400">4h ago</span>
            </div>
            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
              <div className="bg-purple-100 p-2 rounded-full">
                <Bell className="h-4 w-4 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Notification sent</p>
                <p className="text-xs text-gray-500">Sunday pancake reminder</p>
              </div>
              <span className="ml-auto text-xs text-gray-400">1d ago</span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-4">
            <a
              href="/recipes/new"
              className="flex flex-col items-center justify-center p-6 bg-cream rounded-lg hover:bg-churro transition-colors"
            >
              <UtensilsCrossed className="h-8 w-8 text-caramel mb-2" />
              <span className="text-sm font-medium text-gray-900">Add Recipe</span>
            </a>
            <a
              href="/creators/new"
              className="flex flex-col items-center justify-center p-6 bg-cream rounded-lg hover:bg-churro transition-colors"
            >
              <Heart className="h-8 w-8 text-caramel mb-2" />
              <span className="text-sm font-medium text-gray-900">Add Creator</span>
            </a>
            <a
              href="/notifications/new"
              className="flex flex-col items-center justify-center p-6 bg-cream rounded-lg hover:bg-churro transition-colors"
            >
              <Bell className="h-8 w-8 text-caramel mb-2" />
              <span className="text-sm font-medium text-gray-900">Send Notification</span>
            </a>
            <a
              href="/users"
              className="flex flex-col items-center justify-center p-6 bg-cream rounded-lg hover:bg-churro transition-colors"
            >
              <Users className="h-8 w-8 text-caramel mb-2" />
              <span className="text-sm font-medium text-gray-900">View Users</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
