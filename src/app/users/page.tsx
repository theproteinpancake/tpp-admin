'use client';

import { useState, useEffect } from 'react';
import { Search, TrendingUp, Users, Target, Flame, Download } from 'lucide-react';
import { supabase, AppUser } from '@/lib/supabase';

interface UserStats {
  totalUsers: number;
  activeThisWeek: number;
  completedOnboarding: number;
  withPushEnabled: number;
  goalBreakdown: Record<string, number>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [stats, setStats] = useState<UserStats>({
    totalUsers: 0,
    activeThisWeek: 0,
    completedOnboarding: 0,
    withPushEnabled: 0,
    goalBreakdown: {},
  });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      const { data, error, count } = await supabase
        .from('app_users')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const usersData = data || [];
      setUsers(usersData);

      // Calculate stats
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const goalCounts: Record<string, number> = {};
      let onboarded = 0;
      let pushEnabled = 0;

      usersData.forEach(user => {
        if (user.has_completed_onboarding) onboarded++;
        if (user.push_token) pushEnabled++;
        if (user.goal) {
          goalCounts[user.goal] = (goalCounts[user.goal] || 0) + 1;
        }
      });

      setStats({
        totalUsers: count || usersData.length,
        activeThisWeek: usersData.filter(u =>
          new Date(u.created_at) >= weekAgo
        ).length,
        completedOnboarding: onboarded,
        withPushEnabled: pushEnabled,
        goalBreakdown: goalCounts,
      });
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredUsers = users.filter(user =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const goalLabels: Record<string, string> = {
    lose_weight: 'Lose Weight',
    build_muscle: 'Build Muscle',
    maintain: 'Maintain',
    metabolic_health: 'Metabolic Health',
    general_health: 'General Health',
  };

  const exportUsers = () => {
    const csv = [
      ['Email', 'Goal', 'Calorie Target', 'Protein Target', 'Onboarded', 'Push Enabled', 'Created'],
      ...users.map(u => [
        u.email || 'N/A',
        u.goal || 'Not set',
        u.daily_calorie_target?.toString() || '',
        u.daily_protein_target?.toString() || '',
        u.has_completed_onboarding ? 'Yes' : 'No',
        u.push_token ? 'Yes' : 'No',
        new Date(u.created_at).toLocaleDateString(),
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tpp-users-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-600 mt-1">View app users and analytics</p>
        </div>
        <button
          onClick={exportUsers}
          className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Download className="h-5 w-5" />
          Export CSV
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Users</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {loading ? '...' : stats.totalUsers.toLocaleString()}
              </p>
            </div>
            <div className="bg-caramel p-3 rounded-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">New This Week</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {loading ? '...' : stats.activeThisWeek}
              </p>
            </div>
            <div className="bg-green-500 p-3 rounded-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Completed Onboarding</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {loading ? '...' : `${stats.completedOnboarding}`}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {stats.totalUsers > 0 ? `${Math.round(stats.completedOnboarding / stats.totalUsers * 100)}%` : '0%'}
              </p>
            </div>
            <div className="bg-buttermilk-blue p-3 rounded-lg">
              <Target className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Push Notifications</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {loading ? '...' : stats.withPushEnabled}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {stats.totalUsers > 0 ? `${Math.round(stats.withPushEnabled / stats.totalUsers * 100)}% opted in` : '0%'}
              </p>
            </div>
            <div className="bg-purple-500 p-3 rounded-lg">
              <Flame className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Goal Breakdown */}
      {Object.keys(stats.goalBreakdown).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">User Goals</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(stats.goalBreakdown).map(([goal, count]) => (
              <div key={goal} className="text-center p-4 bg-cream rounded-lg">
                <p className="text-2xl font-bold text-caramel">{count}</p>
                <p className="text-sm text-gray-600">{goalLabels[goal] || goal}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading users...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {searchQuery ? 'No users found matching your search' : 'No users yet'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  User
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Goal
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Targets
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-cream flex items-center justify-center">
                        <span className="text-lg">🥞</span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{user.email || 'Anonymous'}</p>
                        <p className="text-xs text-gray-500">{user.id.slice(0, 8)}...</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {user.goal ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cream text-caramel">
                        {goalLabels[user.goal] || user.goal}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">Not set</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {user.daily_calorie_target ? (
                      <div className="text-sm">
                        <span className="font-medium text-gray-900">{user.daily_calorie_target}</span>
                        <span className="text-gray-500"> cal</span>
                        {user.daily_protein_target && (
                          <>
                            <span className="mx-1 text-gray-300">|</span>
                            <span className="font-medium text-maple">{user.daily_protein_target}g</span>
                            <span className="text-gray-500"> protein</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-sm">Not set</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {user.has_completed_onboarding ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Onboarded
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          New
                        </span>
                      )}
                      {user.push_token && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Push
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
