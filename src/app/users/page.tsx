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
    <div className="px-4 py-5 sm:p-8">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-caramel sm:text-3xl">Users</h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">View app users and analytics</p>
        </div>
        <button
          onClick={exportUsers}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-paper px-3 py-2 text-sm font-medium text-caramel hover:bg-cream"
        >
          <Download className="h-4 w-4" /> <span className="hidden sm:inline">Export </span>CSV
        </button>
      </div>

      {/* Stats Grid */}
      <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <div className="bg-paper rounded-xl shadow-sm border border-gray-200 p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-sm font-medium text-gray-600">Total Users</p>
              <p className="text-2xl sm:text-3xl font-bold text-caramel mt-1">
                {loading ? '...' : stats.totalUsers.toLocaleString()}
              </p>
            </div>
            <div className="bg-caramel p-2 sm:p-3 rounded-lg">
              <Users className="h-5 w-5 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-paper rounded-xl shadow-sm border border-gray-200 p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-sm font-medium text-gray-600">New This Week</p>
              <p className="text-2xl sm:text-3xl font-bold text-caramel mt-1">
                {loading ? '...' : stats.activeThisWeek}
              </p>
            </div>
            <div className="bg-green-500 p-2 sm:p-3 rounded-lg">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-paper rounded-xl shadow-sm border border-gray-200 p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-sm font-medium text-gray-600">Completed Onboarding</p>
              <p className="text-2xl sm:text-3xl font-bold text-caramel mt-1">
                {loading ? '...' : `${stats.completedOnboarding}`}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {stats.totalUsers > 0 ? `${Math.round(stats.completedOnboarding / stats.totalUsers * 100)}%` : '0%'}
              </p>
            </div>
            <div className="bg-buttermilk-blue p-2 sm:p-3 rounded-lg">
              <Target className="h-5 w-5 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-paper rounded-xl shadow-sm border border-gray-200 p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-sm font-medium text-gray-600">Push Notifications</p>
              <p className="text-2xl sm:text-3xl font-bold text-caramel mt-1">
                {loading ? '...' : stats.withPushEnabled}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {stats.totalUsers > 0 ? `${Math.round(stats.withPushEnabled / stats.totalUsers * 100)}% opted in` : '0%'}
              </p>
            </div>
            <div className="bg-purple-500 p-2 sm:p-3 rounded-lg">
              <Flame className="h-5 w-5 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Goal Breakdown */}
      {Object.keys(stats.goalBreakdown).length > 0 && (
        <div className="bg-paper rounded-xl shadow-sm border border-gray-200 p-3 sm:p-5 mb-8">
          <h2 className="text-lg font-semibold text-caramel mb-4">User Goals</h2>
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
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by email…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-paper py-2 pl-9 pr-3 text-sm text-caramel placeholder:text-gray-400 focus:border-caramel focus:outline-none focus:ring-1 focus:ring-caramel"
        />
      </div>

      {/* Users list */}
      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-paper p-8 text-center text-gray-500">Loading users…</div>
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-paper p-8 text-center text-gray-500">
          {searchQuery ? 'No users found matching your search' : 'No users yet'}
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filteredUsers.map((user) => (
              <div key={user.id} className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium text-caramel">{user.email || 'Anonymous'}</p>
                  <span className="shrink-0 text-[11px] text-gray-400">{new Date(user.created_at).toLocaleDateString()}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {user.goal && <span className="rounded-full bg-cream px-2 py-0.5 font-medium text-caramel">{goalLabels[user.goal] || user.goal}</span>}
                  {user.daily_calorie_target && <span className="text-gray-500">{user.daily_calorie_target} cal · {user.daily_protein_target || '-'}g</span>}
                  {user.has_completed_onboarding
                    ? <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800">Onboarded</span>
                    : <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">New</span>}
                  {user.push_token && <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-800">Push</span>}
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
                        <p className="font-medium text-caramel">{user.email || 'Anonymous'}</p>
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
                        <span className="font-medium text-caramel">{user.daily_calorie_target}</span>
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
          </div>
        </>
      )}
    </div>
  );
}
