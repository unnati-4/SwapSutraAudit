/**
 * Centralized, Platform-Wide Notification Engine for SwapSutra
 */

import {
  NotificationEventPayload,
  NotificationEventType,
  NotificationItem,
  UserNotificationPreferences
} from '../types/notification';
import { generateSwapSutraEmailHtml } from './emailTemplates';
import {apiUrl} from '../config/runtime';

const PREFS_STORAGE_KEY_PREFIX = 'swapsutra_notif_prefs_';
const BATCH_CACHE_KEY = 'swapsutra_notif_batch_cache';

export class NotificationEngine {
  /**
   * Default Preferences for any user
   */
  public static getDefaultPreferences(email: string): UserNotificationPreferences {
    return {
      email: email.toLowerCase(),
      pushEnabled: true,
      emailEnabled: true,
      categories: {
        swap: { push: true, email: true },
        message: { push: true, email: true },
        reading_room: { push: true, email: true },
        current_read: { push: true, email: true },
        readers_circle: { push: true, email: true },
        book_availability: { push: true, email: true },
        recommendation: { push: true, email: true },
        admin_approval: { push: true, email: true },
        announcement: { push: true, email: true }
      },
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00'
    };
  }

  /**
   * Get User Notification Preferences
   */
  public static getUserPreferences(email: string): UserNotificationPreferences {
    const defaults = this.getDefaultPreferences(email || '');
    // 28 Sep: everything is on for everyone. The settings screen that let a
    // reader switch channels, categories or quiet hours is gone, so choices
    // saved by it earlier are ignored (and cleared) — nobody stays silently
    // switched off by a setting they can no longer see.
    if (email) {
      try { localStorage.removeItem(`${PREFS_STORAGE_KEY_PREFIX}${email.toLowerCase()}`); } catch { /* ignore */ }
    }
    return defaults;
  }


  /**
   * Save User Notification Preferences
   */
  public static saveUserPreferences(prefs: UserNotificationPreferences): void {
    if (!prefs.email) return;
    const key = `${PREFS_STORAGE_KEY_PREFIX}${prefs.email.toLowerCase()}`;
    try {
      localStorage.setItem(key, JSON.stringify({ ...prefs, updatedAt: new Date().toISOString() }));
    } catch (e) {
      console.error('Error saving notification preferences:', e);
    }
  }

  /**
   * Check if current time falls in user's quiet hours
   */
  private static isInQuietHours(prefs: UserNotificationPreferences): boolean {
    if (!prefs.quietHoursEnabled || !prefs.quietHoursStart || !prefs.quietHoursEnd) {
      return false;
    }
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();

    const [sH, sM] = prefs.quietHoursStart.split(':').map(Number);
    const [eH, eM] = prefs.quietHoursEnd.split(':').map(Number);

    const startMin = sH * 60 + sM;
    const endMin = eH * 60 + eM;

    if (startMin < endMin) {
      return currentMin >= startMin && currentMin < endMin;
    } else {
      // Crosses midnight (e.g. 22:00 to 07:00)
      return currentMin >= startMin || currentMin < endMin;
    }
  }

  /**
   * Throttling / Batching check
   * Returns true if event should be suppressed / batched for push & email
   */
  private static shouldThrottlePushOrEmail(batchKey: string, windowMinutes = 5): boolean {
    if (!batchKey) return false;
    try {
      const rawCache = localStorage.getItem(BATCH_CACHE_KEY);
      const cache: Record<string, { count: number; lastTime: number }> = rawCache ? JSON.parse(rawCache) : {};
      const now = Date.now();
      const entry = cache[batchKey];

      if (entry && now - entry.lastTime < windowMinutes * 60 * 1000) {
        entry.count += 1;
        entry.lastTime = now;
        localStorage.setItem(BATCH_CACHE_KEY, JSON.stringify(cache));
        return true; // Throttled!
      }

      cache[batchKey] = { count: 1, lastTime: now };
      // Clean up old entries
      Object.keys(cache).forEach(k => {
        if (now - cache[k].lastTime > 60 * 60 * 1000) delete cache[k];
      });
      localStorage.setItem(BATCH_CACHE_KEY, JSON.stringify(cache));
      return false; // Not throttled
    } catch (e) {
      return false;
    }
  }

  /**
   * MAIN EVENT DISPATCHER
   * Triggered whenever something relevant happens anywhere on SwapSutra!
   */
  public static async dispatchEvent(payload: NotificationEventPayload): Promise<void> {
    const {
      type,
      category,
      recipientEmails,
      senderEmail,
      senderName,
      title,
      message,
      entityType,
      entityId,
      targetUrl = '/',
      priority = 'normal',
      batchKey,
      emailSubject,
      emailBodyCtaText
    } = payload;

    if (!recipientEmails || recipientEmails.length === 0) return;

    // Filter out self-notifications and normalize emails
    const cleanSender = (senderEmail || '').trim().toLowerCase();
    const validRecipients = [...new Set(recipientEmails)]
      .map(e => e.trim().toLowerCase())
      .filter(e => Boolean(e) && e !== cleanSender);

    if (validRecipients.length === 0) return;

    for (const recipient of validRecipients) {
      const prefs = this.getUserPreferences(recipient);
      const inQuiet = this.isInQuietHours(prefs);
      const categoryPref = prefs.categories[category] || { push: true, email: true };

      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const nowIso = new Date().toISOString();

      // 1. IN-APP NOTIFICATION (Always recorded)
      const inAppNotification: NotificationItem = {
        id: notifId,
        recipientEmail: recipient,
        senderEmail: cleanSender,
        senderName: senderName || 'SwapSutra Member',
        type,
        category,
        title,
        message,
        entityType,
        entityId,
        targetUrl,
        createdAt: nowIso,
        isRead: false,
        priority
      };

      // Send to Apps Script / server backend for in-app storage
      this.sendInAppNotificationToServer(inAppNotification).catch(err => {
        console.warn('In-app notification server sync warning:', err);
      });

      // 2. CHECK THROTTLING / BATCHING FOR PUSH & EMAIL
      const effectiveBatchKey = batchKey || `${recipient}_${category}_${entityId || type}`;
      const isThrottled = this.shouldThrottlePushOrEmail(effectiveBatchKey, 5);

      // 3. PUSH — deliberately not shown here. This code runs in the
      // SENDER's browser, so a local notification here popped up on the
      // wrong person's phone ("Asha reacted to your post" shown to Asha).
      // The recipient's own app announces new notifications when it polls
      // (announceNewNotifications in App.tsx), and server-side events push
      // through /api/notifications/relay.
      void inQuiet; void isThrottled;

      // 4. EMAIL NOTIFICATION
      if (prefs.emailEnabled && categoryPref.email && !inQuiet && (priority === 'high' || priority === 'urgent' || !isThrottled)) {
        const emailSubjectText = emailSubject || `${title} 📚`;
        const emailHtml = generateSwapSutraEmailHtml({
          recipientName: 'Reader',
          title,
          message,
          category,
          ctaText: emailBodyCtaText || 'Open SwapSutra',
          ctaUrl: targetUrl,
          senderName: senderName || 'SwapSutra',
          entityName: entityType ? `${entityType.toUpperCase()} #${entityId || ''}` : undefined
        });

        this.sendEmailNotificationToServer(recipient, emailSubjectText, emailHtml).catch(err => {
          console.warn('Email notification server sync warning:', err);
        });
      }
    }
  }

  /**
   * Helper: Send In-App Notification record to server API
   */
  private static async sendInAppNotificationToServer(notification: NotificationItem): Promise<void> {
    try {
      await fetch(apiUrl('/api/swapsutra'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createNotification',
          userEmail: notification.recipientEmail,
          senderEmail: notification.senderEmail,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          category: notification.category,
          entityType: notification.entityType,
          entityId: notification.entityId,
          targetUrl: notification.targetUrl,
          createdAt: notification.createdAt
        })
      });
    } catch (e) {
      console.error('Failed to post in-app notification to server:', e);
    }
  }

  /**
   * Helper: Send Email notification request to backend mail dispatcher
   */
  private static async sendEmailNotificationToServer(toEmail: string, subject: string, htmlContent: string): Promise<void> {
    try {
      await fetch(apiUrl('/api/notifications/send-email'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          subject,
          html: htmlContent
        })
      });
    } catch (e) {
      console.error('Failed to send email notification request:', e);
    }
  }

  // ======================================================
  // CONVENIENCE EVENT HELPERS FOR ALL PLATFORM SECTIONS
  // ======================================================

  /**
   * Community Feed / Reading Room
   */
  public static notifyPostReaction(ownerEmail: string, actorName: string, postId: string, postTitle: string) {
    this.dispatchEvent({
      type: 'community_post_reaction',
      category: 'reading_room',
      recipientEmails: [ownerEmail],
      senderName: actorName,
      title: 'New Reaction on Your Post',
      message: `${actorName} reacted to your post "${postTitle || 'Reading Room post'}".`,
      entityType: 'post',
      entityId: postId,
      targetUrl: `/reading-room?post=${postId}`,
      batchKey: `react_${ownerEmail}_${postId}`
    });
  }

  public static notifyPostComment(ownerEmail: string, actorName: string, postId: string, commentText: string) {
    this.dispatchEvent({
      type: 'community_post_comment',
      category: 'reading_room',
      recipientEmails: [ownerEmail],
      senderName: actorName,
      title: 'New Comment on Your Post',
      message: `${actorName} commented: "${commentText.slice(0, 80)}${commentText.length > 80 ? '...' : ''}"`,
      entityType: 'post',
      entityId: postId,
      targetUrl: `/reading-room?post=${postId}`
    });
  }

  public static notifyMention(mentionedEmails: string[], actorName: string, contextTitle: string, targetUrl: string) {
    this.dispatchEvent({
      type: 'community_mention',
      category: 'message',
      recipientEmails: mentionedEmails,
      senderName: actorName,
      title: 'You Were Mentioned',
      message: `${actorName} mentioned you in ${contextTitle}.`,
      targetUrl
    });
  }

  /**
   * Current Read Groups
   */
  public static notifyCurrentReadJoined(hostEmail: string, participantName: string, circleTitle: string, circleId: string) {
    this.dispatchEvent({
      type: 'current_read_joined',
      category: 'current_read',
      recipientEmails: [hostEmail],
      senderName: participantName,
      title: 'New Reader Joined Your Current Read 📚',
      message: `${participantName} joined your Current Read group for "${circleTitle}".`,
      entityType: 'current_read',
      entityId: circleId,
      targetUrl: `/readers-circle/${circleId}`,
      emailSubject: `New Reader joined your Current Read: ${circleTitle}`,
      emailBodyCtaText: 'Open Current Read'
    });
  }

  public static notifyCurrentReadGroupMessage(
    memberEmails: string[],
    senderEmail: string,
    senderName: string,
    circleTitle: string,
    circleId: string,
    msgSnippet: string
  ) {
    this.dispatchEvent({
      type: 'current_read_message',
      category: 'current_read',
      recipientEmails: memberEmails,
      senderEmail,
      senderName,
      title: `New message in ${circleTitle}`,
      message: `${senderName}: "${msgSnippet.slice(0, 90)}${msgSnippet.length > 90 ? '...' : ''}"`,
      entityType: 'current_read',
      entityId: circleId,
      targetUrl: `/readers-circle/${circleId}`,
      batchKey: `cr_msg_${circleId}`,
      emailBodyCtaText: 'View Group Discussion'
    });
  }

  public static notifyCurrentReadMilestone(memberEmails: string[], circleTitle: string, circleId: string, milestoneText: string) {
    this.dispatchEvent({
      type: 'current_read_milestone',
      category: 'current_read',
      recipientEmails: memberEmails,
      title: 'Current Read Milestone Reached! 🎉',
      message: `Group "${circleTitle}" reached a new milestone: ${milestoneText}`,
      entityType: 'current_read',
      entityId: circleId,
      targetUrl: `/readers-circle/${circleId}`,
      priority: 'high'
    });
  }

  /**
   * Readers Circles Events
   */
  public static notifyCircleEventRegistered(hostEmail: string, readerName: string, eventTitle: string, eventId: string) {
    this.dispatchEvent({
      type: 'readers_circle_registered',
      category: 'readers_circle',
      recipientEmails: [hostEmail],
      senderName: readerName,
      title: 'New Event Registration 🎟️',
      message: `${readerName} registered for your Readers Circle event "${eventTitle}".`,
      entityType: 'event',
      entityId: eventId,
      targetUrl: `/readers-circle/${eventId}`
    });
  }

  public static notifyCircleEventReminder(attendeeEmails: string[], eventTitle: string, eventDate: string, eventId: string) {
    this.dispatchEvent({
      type: 'readers_circle_reminder',
      category: 'readers_circle',
      recipientEmails: attendeeEmails,
      title: 'Readers Circle Starting Soon ⏰',
      message: `Reminder: "${eventTitle}" takes place on ${eventDate}. Check meeting link and details.`,
      entityType: 'event',
      entityId: eventId,
      targetUrl: `/readers-circle/${eventId}`,
      priority: 'high',
      emailBodyCtaText: 'Join Readers Circle'
    });
  }

  /**
   * Swap System
   */
  public static notifySwapEvent(options: {
    type: NotificationEventType;
    recipientEmail: string;
    senderName: string;
    bookTitle: string;
    swapId: string;
    customMessage?: string;
  }) {
    const { type, recipientEmail, senderName, bookTitle, swapId, customMessage } = options;

    let title = 'Swap Update';
    let message = customMessage || `Update regarding swap for "${bookTitle}".`;

    if (type === 'swap_request_received') {
      title = 'New Swap Request 🔄';
      message = `${senderName} requested to swap "${bookTitle}".`;
    } else if (type === 'swap_request_accepted') {
      title = 'Swap Request Accepted! ✅';
      message = `${senderName} accepted your swap request for "${bookTitle}".`;
    } else if (type === 'swap_request_rejected') {
      title = 'Swap Request Declined';
      message = `${senderName} declined the swap request for "${bookTitle}".`;
    } else if (type === 'swap_handover_initiated' || type === 'swap_proof_submitted') {
      title = 'Swap Handover Proof Submitted 📸';
      message = `${senderName} submitted handover confirmation for "${bookTitle}".`;
    } else if (type === 'swap_completed') {
      title = 'Swap Successfully Completed! 🌟';
      message = `Your book swap for "${bookTitle}" with ${senderName} is now complete. Please leave a rating!`;
    }

    this.dispatchEvent({
      type,
      category: 'swap',
      recipientEmails: [recipientEmail],
      senderName,
      title,
      message,
      entityType: 'swap',
      entityId: swapId,
      targetUrl: `/profile?sub=requests&swapId=${swapId}`,
      priority: 'high',
      emailSubject: `${title} - ${bookTitle}`,
      emailBodyCtaText: 'Open Swap Details'
    });
  }

  /**
   * Book Requests & Availability
   */
  public static notifyBookAvailable(interestedEmails: string[], bookTitle: string, bookId: string) {
    this.dispatchEvent({
      type: 'book_requested_available',
      category: 'book_availability',
      recipientEmails: interestedEmails,
      title: 'Book Now Available! 📖',
      message: `"${bookTitle}" is now listed and available on SwapSutra.`,
      entityType: 'book',
      entityId: bookId,
      targetUrl: `/library?bookId=${bookId}`,
      priority: 'high',
      emailBodyCtaText: 'View Available Book'
    });
  }

  /**
   * Direct Messages
   */
  public static notifyDirectMessage(recipientEmail: string, senderName: string, msgSnippet: string, chatId: string, isVoice = false) {
    this.dispatchEvent({
      type: isVoice ? 'voice_message_received' : 'direct_message_received',
      category: 'message',
      recipientEmails: [recipientEmail],
      senderName,
      title: isVoice ? `Voice Message from ${senderName} 🎙️` : `New Message from ${senderName}`,
      message: isVoice ? `${senderName} sent you a voice message.` : `"${msgSnippet.slice(0, 90)}${msgSnippet.length > 90 ? '...' : ''}"`,
      entityType: 'chat',
      entityId: chatId,
      targetUrl: `/profile?sub=chats&chatId=${chatId}`,
      batchKey: `dm_${chatId}`,
      emailBodyCtaText: 'Open Chat'
    });
  }

  /**
   * Admin Approval Auto-Notification
   */
  public static notifyAdminApprovedItem(recipientEmail: string, itemType: string, itemTitle: string, targetUrl = '/') {
    this.dispatchEvent({
      type: 'admin_item_approved',
      category: 'admin_approval',
      recipientEmails: [recipientEmail],
      title: 'Your Submission Has Been Approved! ✨',
      message: `Great news! Your ${itemType} "${itemTitle}" has been reviewed and approved by SwapSutra admins. It is now live!`,
      entityType: itemType,
      targetUrl,
      priority: 'high',
      emailSubject: `Approved: Your ${itemType} "${itemTitle}" is now live on SwapSutra`,
      emailBodyCtaText: 'View Approved Listing'
    });
  }
}
