'use client';

import { useState, useEffect } from 'react';
import { Plus, Send, Clock, Calendar, Trash2, Edit, Bell, BellOff } from 'lucide-react';
import { supabase, ScheduledNotification } from '@/lib/supabase';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Default scheduled notifications for TPP
const DEFAULT_NOTIFICATIONS = [
  { day: 0, title: "It's Pancake Day! 🥞", body: "Our favourite day of the week! What pancakes are you making today?", time: '09:00' },
  { day: 1, title: "Monday Motivation 💪", body: "Start your week strong with a protein-packed breakfast!", time: '07:00' },
  { day: 3, title: "Midweek Meal Prep 🍳", body: "Time to plan your meals for the rest of the week!", time: '18:00' },
  { day: 5, title: "TGIF! 🎉", body: "Treat yourself to some weekend pancakes. You've earned it!", time: '17:00' },
];

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<ScheduledNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingNotification, setEditingNotification] = useState<ScheduledNotification | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formDayOfWeek, setFormDayOfWeek] = useState<number | null>(null);
  const [formTime, setFormTime] = useState('09:00');
  const [formIsOneTime, setFormIsOneTime] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, []);

  async function fetchNotifications() {
    try {
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .select('*')
        .order('day_of_week', { ascending: true });

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }

  async function toggleNotification(notification: ScheduledNotification) {
    try {
      const { error } = await supabase
        .from('scheduled_notifications')
        .update({ is_active: !notification.is_active })
        .eq('id', notification.id);

      if (error) throw error;
      setNotifications(notifications.map(n =>
        n.id === notification.id ? { ...n, is_active: !n.is_active } : n
      ));
    } catch (error) {
      console.error('Error updating notification:', error);
    }
  }

  async function deleteNotification(id: string) {
    if (!confirm('Are you sure you want to delete this notification?')) return;

    try {
      const { error } = await supabase.from('scheduled_notifications').delete().eq('id', id);
      if (error) throw error;
      setNotifications(notifications.filter(n => n.id !== id));
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  }

  async function saveNotification() {
    try {
      const notificationData = {
        title: formTitle,
        body: formBody,
        day_of_week: formIsOneTime ? null : formDayOfWeek,
        time: formTime,
        is_active: true,
      };

      if (editingNotification) {
        const { error } = await supabase
          .from('scheduled_notifications')
          .update(notificationData)
          .eq('id', editingNotification.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('scheduled_notifications')
          .insert(notificationData);

        if (error) throw error;
      }

      fetchNotifications();
      closeModal();
    } catch (error) {
      console.error('Error saving notification:', error);
      alert('Failed to save notification');
    }
  }

  async function sendNow() {
    if (!formTitle || !formBody) {
      alert('Please enter a title and body');
      return;
    }

    try {
      // Call API to send push notification to all users
      const response = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: formTitle, body: formBody }),
      });

      if (!response.ok) throw new Error('Failed to send notification');

      const result = await response.json();
      alert(`Notification sent to ${result.count} users!`);
      closeModal();
    } catch (error) {
      console.error('Error sending notification:', error);
      alert('Failed to send notification');
    }
  }

  function openEditModal(notification: ScheduledNotification) {
    setEditingNotification(notification);
    setFormTitle(notification.title);
    setFormBody(notification.body);
    setFormDayOfWeek(notification.day_of_week);
    setFormTime(notification.time);
    setFormIsOneTime(notification.day_of_week === null);
    setShowAddModal(true);
  }

  function closeModal() {
    setShowAddModal(false);
    setEditingNotification(null);
    setFormTitle('');
    setFormBody('');
    setFormDayOfWeek(null);
    setFormTime('09:00');
    setFormIsOneTime(false);
  }

  // Group notifications by day
  const scheduledByDay = DAYS_OF_WEEK.map((day, index) => ({
    day,
    index,
    notifications: notifications.filter(n => n.day_of_week === index),
  }));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Notifications</h1>
          <p className="text-gray-600 mt-1">Manage push notifications and scheduled messages</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-caramel text-white px-4 py-2.5 rounded-lg hover:bg-maple transition-colors"
        >
          <Plus className="h-5 w-5" />
          New Notification
        </button>
      </div>

      {/* Quick Send Card */}
      <div className="bg-gradient-to-r from-caramel to-maple rounded-xl p-6 text-white mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-2">Send Instant Notification</h2>
            <p className="text-white/80 text-sm">
              Reach all app users immediately with important updates
            </p>
          </div>
          <button
            onClick={() => {
              setFormIsOneTime(true);
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 bg-white text-caramel px-4 py-2 rounded-lg hover:bg-cream transition-colors"
          >
            <Send className="h-4 w-4" />
            Send Now
          </button>
        </div>
      </div>

      {/* Scheduled Notifications */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="h-5 w-5 text-caramel" />
            Scheduled Notifications
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            These notifications are sent automatically each week
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading notifications...</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {scheduledByDay.map(({ day, index, notifications: dayNotifications }) => (
              <div key={day} className="px-6 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className={`text-sm font-medium ${index === 0 ? 'text-caramel' : 'text-gray-700'}`}>
                    {day}
                    {index === 0 && ' 🥞'}
                  </span>
                </div>

                {dayNotifications.length === 0 ? (
                  <p className="text-sm text-gray-400 ml-7">No notifications scheduled</p>
                ) : (
                  <div className="space-y-2 ml-7">
                    {dayNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          notification.is_active ? 'bg-cream' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${notification.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                              {notification.title}
                            </span>
                            <span className="text-xs text-gray-500">{notification.time}</span>
                          </div>
                          <p className={`text-sm mt-0.5 ${notification.is_active ? 'text-gray-600' : 'text-gray-400'}`}>
                            {notification.body}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleNotification(notification)}
                            className={`p-2 rounded-lg transition-colors ${
                              notification.is_active
                                ? 'text-green-600 hover:bg-green-50'
                                : 'text-gray-400 hover:bg-gray-100'
                            }`}
                            title={notification.is_active ? 'Disable' : 'Enable'}
                          >
                            {notification.is_active ? (
                              <Bell className="h-4 w-4" />
                            ) : (
                              <BellOff className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => openEditModal(notification)}
                            className="p-2 text-gray-600 hover:text-caramel hover:bg-cream rounded-lg transition-colors"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => deleteNotification(notification.id)}
                            className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingNotification ? 'Edit Notification' : 'New Notification'}
              </h3>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent"
                  placeholder="e.g., It's Pancake Day! 🥞"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message *
                </label>
                <textarea
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent"
                  placeholder="Our favourite day of the week!"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formIsOneTime}
                    onChange={(e) => setFormIsOneTime(e.target.checked)}
                    className="w-4 h-4 text-caramel rounded focus:ring-caramel"
                  />
                  <span className="text-sm text-gray-700">Send immediately (one-time)</span>
                </label>
              </div>

              {!formIsOneTime && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Day of Week
                    </label>
                    <select
                      value={formDayOfWeek ?? ''}
                      onChange={(e) => setFormDayOfWeek(e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent"
                    >
                      <option value="">Select day...</option>
                      {DAYS_OF_WEEK.map((day, index) => (
                        <option key={day} value={index}>{day}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Time
                    </label>
                    <input
                      type="time"
                      value={formTime}
                      onChange={(e) => setFormTime(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-caramel focus:border-transparent"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              {formIsOneTime ? (
                <button
                  onClick={sendNow}
                  className="flex items-center gap-2 px-4 py-2 bg-caramel text-white rounded-lg hover:bg-maple transition-colors"
                >
                  <Send className="h-4 w-4" />
                  Send Now
                </button>
              ) : (
                <button
                  onClick={saveNotification}
                  className="px-4 py-2 bg-caramel text-white rounded-lg hover:bg-maple transition-colors"
                >
                  {editingNotification ? 'Save Changes' : 'Schedule'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
