package uz.gram50.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Kirayotgan qo'ng'iroq: Telegram-uslubidagi TO'LIQ EKRAN bildirishnoma
 * (qulf ekranda ham ko'rinadi) + "Javob berish" / "Rad etish" tugmalari.
 * Ilova fonida bo'lganda WebSocket orqali kelgan qo'ng'iroqni shu oyna ko'rsatadi.
 */
public class CallAlert {

  static final String CH_ID = "50gram_calls";
  static final int NOTIF_ID = 2001;
  /** Qo'ng'iroq oynasi ko'rinayotgani (MainActivity kabi oqimlar uchun — reload buzmasin) */
  public static volatile boolean showing = false;

  static void show(Context ctx, String name, boolean video, String callId) {
    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel ch = new NotificationChannel(CH_ID, "Qo'ng'iroqlar", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("Kirayotgan qo'ng'iroqlar");
      ch.enableVibration(true);
      ch.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 400});
      ch.setBypassDnd(false);
      nm.createNotificationChannel(ch);
    }

    // Barcha tugmalar ilovani ochadi (singleTask) — JS __50call oqimi davom etadi
    Intent answer = new Intent(ctx, MainActivity.class);
    answer.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    answer.putExtra("c", "answer");
    answer.putExtra("id", callId);
    PendingIntent pAnswer = PendingIntent.getActivity(ctx, 1001, answer,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Intent decline = new Intent(ctx, MainActivity.class);
    decline.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    decline.putExtra("c", "decline");
    decline.putExtra("id", callId);
    PendingIntent pDecline = PendingIntent.getActivity(ctx, 1002, decline,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Intent tap = new Intent(ctx, MainActivity.class);
    tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    tap.putExtra("c", "open");
    tap.putExtra("id", callId);
    PendingIntent pTap = PendingIntent.getActivity(ctx, 1003, tap,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Notification.Builder b = Build.VERSION.SDK_INT >= 26
        ? new Notification.Builder(ctx, CH_ID)
        : new Notification.Builder(ctx);
    b.setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle((video ? "📹 " : "📞 ") + name)
        .setContentText(video ? "Video qo'ng'iroq — javob bering" : "Qo'ng'iroq — javob bering")
        .setPriority(Notification.PRIORITY_MAX)
        .setCategory(Notification.CATEGORY_CALL)
        .setContentIntent(pTap)
        .setAutoCancel(true)
        .setOngoing(true)
        .setOnlyAlertOnce(false);
    b.addAction(new Notification.Action.Builder(null, "✓ Javob berish", pAnswer).build());
    b.addAction(new Notification.Action.Builder(null, "✕ Rad etish", pDecline).build());
    if (Build.VERSION.SDK_INT >= 21) {
      // To'liq ekran: qulf ekranda ham butun oyna ochiladi (ruxsat berilgan bo'lsa)
      b.setFullScreenIntent(pTap, true);
    }
    try { nm.notify(NOTIF_ID, b.build()); showing = true; } catch (Exception ignored) { }
  }

  static void cancel(Context ctx) {
    showing = false;
    try {
      NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) nm.cancel(NOTIF_ID);
    } catch (Exception ignored) { }
  }
}
