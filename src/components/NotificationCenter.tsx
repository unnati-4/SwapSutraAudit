import React, { useState } from 'react';
import { NotificationCategory } from '../types/notification';

interface NotificationCenterProps {
  notifications: any[];
  userEmail: string;
  onOpenNotification: (notification: any) => void;
  onMarkAllRead: () => void;
  onClearNotification: (notification: any) => void;
  onClearAll: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  userEmail,
  onOpenNotification,
  onMarkAllRead,
  onClearNotification,
  onClearAll
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const normalizeCategory = (n: any): NotificationCategory => {
    const rawCat = String(n?.category || n?.type || n?.relatedType || '').toLowerCase();
    if (rawCat.includes('swap')) return 'swap';
    if (rawCat.includes('chat') || rawCat.includes('message') || rawCat.includes('dm')) return 'message';
    if (rawCat.includes('reading_room') || rawCat.includes('community') || rawCat.includes('post') || rawCat.includes('comment')) return 'reading_room';
    if (rawCat.includes('current_read') || rawCat.includes('circle')) return 'current_read';
    if (rawCat.includes('readers_circle') || rawCat.includes('event')) return 'readers_circle';
    if (rawCat.includes('book')) return 'book_availability';
    if (rawCat.includes('admin') || rawCat.includes('approval')) return 'admin_approval';
    return 'announcement';
  };

  const isUnread = (n: any) => {
    const readVal = String(n?.isRead || n?.read || 'No').trim().toLowerCase();
    return readVal !== 'yes' && readVal !== 'true';
  };

  const unreadCount = notifications.filter(isUnread).length;

  const filteredNotifications = notifications.filter((n) => {
    if (selectedCategory === 'all') return true;
    if (selectedCategory === 'unread') return isUnread(n);
    return normalizeCategory(n) === selectedCategory;
  });

  const getCategoryIcon = (n: any) => {
    const cat = normalizeCategory(n);
    switch (cat) {
      case 'swap': return '🔄';
      case 'message': return '💬';
      case 'reading_room': return '📚';
      case 'current_read': return '📖';
      case 'readers_circle': return '🎟️';
      case 'book_availability': return '📕';
      case 'admin_approval': return '✨';
      default: return '🔔';
    }
  };

  const formatRelativeTime = (timeStr?: string) => {
    if (!timeStr) return 'Recently';
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return 'Recently';
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-[var(--bg-surface)] border border-brand-border rounded-xl shadow-xs overflow-hidden max-w-4xl mx-auto text-left">
      {/* HEADER */}
      <div className="p-5 sm:p-6 border-b border-brand-border bg-[var(--bg-surface)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-brand-gold-text">Notification Center</span>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 bg-brand-brown text-white rounded-full text-2xs font-bold">
                {unreadCount} Unread
              </span>
            )}
          </div>
          <h2 className="font-serif text-2xl text-[var(--text-primary)] mt-1">Platform Notifications</h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] border border-brand-brown/20 rounded-lg hover:bg-brand-brown/5 transition-colors"
            >
              Mark All Read ✓
            </button>
          )}

          {notifications.length > 0 && (
            <button
              onClick={onClearAll}
              className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-red-700 border border-neutral-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              Clear All
            </button>
          )}

        </div>
      </div>

      {/* 28 Sep: no enable/disable here — notifications are on for everyone
          (the browser asks once, on the first tap; see NotificationAutoEnable). */}

      {/* CATEGORY FILTER TABS */}
      <div className="flex items-center gap-1 p-2 bg-[var(--bg-surface-inset)] border-b border-brand-border overflow-x-auto text-xs no-scrollbar">
        {[
          { id: 'all', label: 'All' },
          { id: 'unread', label: `Unread (${unreadCount})` },
          { id: 'swap', label: 'Swaps' },
          { id: 'reading_room', label: 'Reading Room' },
          { id: 'current_read', label: 'Current Reads' },
          { id: 'readers_circle', label: 'Circles' },
          { id: 'book_availability', label: 'Books' },
          { id: 'admin_approval', label: 'Admin' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSelectedCategory(tab.id)}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-medium transition-all ${
              selectedCategory === tab.id
                ? 'bg-brand-brown text-white shadow-xs font-semibold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* NOTIFICATIONS LIST */}
      <div className="divide-y divide-brand-border/60 max-h-[600px] overflow-y-auto">
        {filteredNotifications.length === 0 ? (
          <div className="p-12 text-center text-[var(--text-secondary)]">
            <span className="text-3xl block mb-2">📭</span>
            <p className="font-serif text-lg text-[var(--text-primary)]">No notifications found</p>
            <p className="text-xs mt-1">You're all caught up on SwapSutra activity.</p>
          </div>
        ) : (
          filteredNotifications.map((notification, idx) => {
            const unread = isUnread(notification);
            const icon = getCategoryIcon(notification);
            const timeAgo = formatRelativeTime(notification?.createdAt || notification?.created_at || notification?.timestamp);

            return (
              <div
                key={notification?.id || idx}
                className={`p-4 sm:p-5 transition-colors flex items-start gap-4 group cursor-pointer ${
                  unread ? 'bg-[var(--bg-surface-inset)]' : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-inset)]/70'
                }`}
                onClick={() => onOpenNotification(notification)}
              >
                {/* Category Icon Badge */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 ${
                  unread ? 'bg-brand-gold/20 text-[var(--text-primary)] border border-brand-gold/40' : 'bg-[var(--bg-surface-inset)] text-[var(--text-secondary)]'
                }`}>
                  {icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className={`text-sm font-semibold truncate ${unread ? 'text-[var(--text-primary)] font-bold' : 'text-[var(--text-secondary)]'}`}>
                      {notification?.title || 'SwapSutra Notification'}
                    </h3>
                    <span className="text-xs text-[var(--text-muted)] shrink-0">{timeAgo}</span>
                  </div>

                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed line-clamp-2">
                    {notification?.message || notification?.text || ''}
                  </p>

                  <div className="flex items-center gap-3 mt-2 text-xs">
                    <span className="text-brand-gold-text font-medium uppercase tracking-wider text-2xs">
                      {normalizeCategory(notification).replace(/_/g, ' ')}
                    </span>
                    {unread && (
                      <span className="inline-block w-2 h-2 rounded-full bg-brand-brown"></span>
                    )}
                  </div>
                </div>

                {/* Clear Action */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearNotification(notification);
                  }}
                  className="p-1.5 text-[var(--text-muted)] hover:text-red-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Clear notification"
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
