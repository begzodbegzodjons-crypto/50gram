package uz.gram50.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/** Fon xizmati: brauzer cheklovlari yo'q — CPU/ulanish tirik, xabarlar o'z vaqtida keladi. */
public class KeepAliveService extends Service {

  static final String CH_ID = "50gram_service";
  PowerManager.WakeLock wl;

  @Override
  public void onCreate() {
    super.onCreate();

    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    Notification n;
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel ch = new NotificationChannel(
          CH_ID, "50 Gram xizmati", NotificationManager.IMPORTANCE_LOW);
      ch.setDescription("Ilova fonda ishlashi uchun");
      ch.setShowBadge(false);
      nm.createNotificationChannel(ch);
      n = new Notification.Builder(this, CH_ID)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle("50 Gram ishlayapti")
          .setContentText("Xabarlar o'z vaqtida yetib boradi")
          .setOngoing(true)
          .build();
    } else {
      n = new Notification.Builder(this)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle("50 Gram ishlayapti")
          .setContentText("Xabarlar o'z vaqtida yetib boradi")
          .setOngoing(true)
          .build();
    }
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(1, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    } else {
      startForeground(1, n);
    }

    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
    wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "50gram:keepalive");
    wl.acquire();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    return START_STICKY; // tizim o'chirsa qayta yoqadi
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    // Foydalanuvchi ilovani "swipe" qilib yopsa ham xizmat davom etadi
    Intent r = new Intent(getApplicationContext(), KeepAliveService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(r); else startService(r);
    super.onTaskRemoved(rootIntent);
  }

  @Override
  public void onDestroy() {
    if (wl != null && wl.isHeld()) wl.release();
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) { return null; }
}
