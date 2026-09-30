export type NotificationCategory = 
  | 'swap'
  | 'message'
  | 'reading_room'
  | 'current_read'
  | 'readers_circle'
  | 'book_availability'
  | 'recommendation'
  | 'admin_approval'
  | 'announcement';

export type NotificationEventType =
  // Reading Room / Community
  | 'community_post_reaction'
  | 'community_post_comment'
  | 'community_comment_reply'
  | 'community_mention'
  | 'community_recommendation_saved'
  | 'community_post_approved'
  // Current Read Groups
  | 'current_read_created'
  | 'current_read_joined'
  | 'current_read_left'
  | 'current_read_message'
  | 'current_read_reply'
  | 'current_read_mention'
  | 'current_read_milestone'
  | 'current_read_closed'
  | 'current_read_announcement'
  // Readers Circles
  | 'readers_circle_approved'
  | 'readers_circle_registered'
  | 'readers_circle_confirmed'
  | 'readers_circle_joined'
  | 'readers_circle_updated'
  | 'readers_circle_cancelled'
  | 'readers_circle_reminder'
  | 'readers_circle_starting_soon'
  | 'readers_circle_link_updated'
  | 'readers_circle_gallery_available'
  // Books / Reading Space
  | 'book_requested_available'
  | 'book_interest_listed'
  | 'book_saved_available'
  | 'book_request_received'
  | 'book_request_accepted'
  | 'book_request_rejected'
  | 'book_owner_interaction'
  // Swap System
  | 'swap_request_received'
  | 'swap_request_accepted'
  | 'swap_request_rejected'
  | 'swap_request_cancelled'
  | 'swap_status_changed'
  | 'swap_chat_message'
  | 'swap_handover_initiated'
  | 'swap_proof_submitted'
  | 'swap_sender_confirmed'
  | 'swap_receiver_confirmed'
  | 'swap_completed'
  | 'swap_disputed'
  | 'swap_dispute_updated'
  | 'swap_review_requested'
  // Direct Messaging
  | 'direct_message_received'
  | 'voice_message_received'
  // Admin & Platform
  | 'admin_item_approved'
  | 'admin_system_announcement';

export interface NotificationItem {
  id: string;
  recipientEmail: string;
  senderEmail?: string;
  senderName?: string;
  senderAvatar?: string;
  type: NotificationEventType;
  category: NotificationCategory;
  title: string;
  message: string;
  entityType?: string; // 'swap', 'book', 'post', 'circle', 'chat', etc.
  entityId?: string;
  targetUrl?: string;
  createdAt: string;
  isRead: boolean;
  readAt?: string;
  pushSentStatus?: 'sent' | 'failed' | 'skipped' | 'disabled';
  emailSentStatus?: 'sent' | 'failed' | 'skipped' | 'disabled';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  batchId?: string;
}

export interface UserNotificationPreferences {
  email: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  categories: {
    swap: { push: boolean; email: boolean };
    message: { push: boolean; email: boolean };
    reading_room: { push: boolean; email: boolean };
    current_read: { push: boolean; email: boolean };
    readers_circle: { push: boolean; email: boolean };
    book_availability: { push: boolean; email: boolean };
    recommendation: { push: boolean; email: boolean };
    admin_approval: { push: boolean; email: boolean };
    announcement: { push: boolean; email: boolean };
  };
  quietHoursEnabled?: boolean;
  quietHoursStart?: string; // "22:00"
  quietHoursEnd?: string;   // "07:00"
  updatedAt?: string;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionData {
  userEmail: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  userAgent?: string;
  subscribedAt: string;
}

export interface NotificationEventPayload {
  type: NotificationEventType;
  category: NotificationCategory;
  recipientEmails: string[]; // Strict targeted user list
  senderEmail?: string;
  senderName?: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  targetUrl?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  batchKey?: string; // For grouping rapid messages
  emailSubject?: string;
  emailBodyCtaText?: string;
}
