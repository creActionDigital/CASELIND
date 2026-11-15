import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

export const notificationCategorySchema = z.enum([
  'message',
  'social',
  'commerce',
  'delivery',
  'payment',
  'booking',
  'security',
  'reminder',
  'job',
  'system',
]);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const pushPlatformSchema = z.enum(['ios', 'android', 'web']);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

/** Expo push token, e.g. `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. */
export const pushTokenSchema = z
  .string()
  .max(200)
  .regex(/^(ExponentPushToken|ExpoPushToken)\[[^\]\s]{1,160}\]$/, 'not a valid Expo push token');

export const registerPushTokenRequestSchema = z.object({
  token: pushTokenSchema,
  platform: pushPlatformSchema,
});
export type RegisterPushTokenRequest = z.infer<typeof registerPushTokenRequestSchema>;

export const unregisterPushTokenRequestSchema = z.object({ token: z.string().min(1).max(200) });
export type UnregisterPushTokenRequest = z.infer<typeof unregisterPushTokenRequestSchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  category: notificationCategorySchema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.string()),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = pageQuerySchema.extend({
  unreadOnly: z.enum(['true', 'false']).optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const unreadCountSchema = z.object({ count: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

export const notificationPreferencesSchema = z.object({
  /** Categories for which no push is sent. `security` can never be listed. */
  pushDisabledCategories: z.array(notificationCategorySchema.exclude(['security'])),
  /** No push (except urgent ones) until this instant. */
  quietUntil: z.iso.datetime().nullable(),
  /** false = message pushes do not show the message text. */
  messagePreviews: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateNotificationPreferencesRequestSchema = notificationPreferencesSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdateNotificationPreferencesRequest = z.infer<typeof updateNotificationPreferencesRequestSchema>;

/** Socket.IO `notification.new` payload. */
export type NotificationNewEvent = Notification;
