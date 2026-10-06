package uz.gram50.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Xabar bildirishnomalari (v2.9) — «ilova fonda turganda xabardan HECH NARSA ko'rinmasdi»
 * muammosining Android yechimi. Ikkita yo'l bir xil usul bilan ko'rsatadi:
 *  1) JS BRIDGE (Android50.pushNotify) — WebSocket tirik bo'lsa DARHOL (0s kechikish);
 *  2) KeepAliveService polling (/notify/unread) — WS o'lgan/uxlab qolgan holat uchun
 *     zaxira (~20s ichida).
 * Tap qilinganda ilova ochiladi va shu chat ko'rsatiladi (chat_id intent orqali).
 */
public class G50Notify {

  static final String CH_ID = "50gram_msgs";
  static final int BASE_ID = 3000;

  /** chat_id → barqaror notification id (har chat o'z bildirishnomasini yangilaydi) */
  static int idFor(String chatId) {
    try {
      String s = (chatId == null ? "" : chatId).trim();
      long v = Long.parseLong(s);
      return BASE_ID + (int) (Math.abs(v) % 100000L);
    } catch (Exception e) {
      return BASE_ID;
    }
  }

  static void show(Context ctx, String title, String body, String chatId) {
    try {
      NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;
      if (Build.VERSION.SDK_INT >= 26) {
        NotificationChannel ch = new NotificationChannel(CH_ID, "Xabarlar", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Yangi xabarlar");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 120, 80, 120});
        ch.setShowBadge(true);
        try {
          android.media.AudioAttributes at = new android.media.AudioAttributes.Builder()
              .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
              .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build();
          ch.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, at);
        } catch (Exception ignored) { }
        nm.createNotificationChannel(ch);
      }
      Intent tap = new Intent(ctx, MainActivity.class);
      tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      tap.putExtra("c", "chat");
      tap.putExtra("chat_id", chatId == null ? "" : chatId);
      PendingIntent pTap = PendingIntent.getActivity(ctx, 2001, tap,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      Notification.Builder b = Build.VERSION.SDK_INT >= 26
          ? new Notification.Builder(ctx, CH_ID)
          : new Notification.Builder(ctx);
      b.setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(title == null || title.length() == 0 ? "50 Gram" : title)
          .setContentText(body == null ? "" : body)
          .setStyle(new Notification.BigTextStyle().bigText(body == null ? "" : body))
          .setPriority(Notification.PRIORITY_HIGH)
          .setCategory(Notification.CATEGORY_MESSAGE)
          .setContentIntent(pTap)
          .setAutoCancel(true);
      nm.notify(idFor(chatId), b.build());
    } catch (Exception ignored) { }
  }

  /** Chat o'qilganda bildirishnomani o'chirish; bo'sh chatId — HAMMASINI tozalash. */
  static void clear(Context ctx, String chatId) {
    try {
      NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;
      if (chatId == null || chatId.trim().length() == 0) {
        // barcha xabar bildirishnomalari (3000..130000 diapazonidagi bizning idlar)
        if (Build.VERSION.SDK_INT >= 23) {
          for (Notification.StatusBarNotification sbn : nm.getActiveNotifications()) {
            int id = sbn.getId();
            if (id >= BASE_ID && id < BASE_ID + 100000) nm.cancel(id);
          }
        } else {
          nm.cancel(BASE_ID);
        }
        return;
      }
      nm.cancel(idFor(chatId));
    } catch (Exception ignored) { }
  }
}
