package uz.gram50.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * Fon xizmati: ilova jarayoni tirik turadi — WebSocket ulanishi uzilmaydi,
 * shuning uchun xabarlar va QO'NG'IROQLAR fonda ham o'z vaqtida yetib boradi.
 * Doimiy WakeLock ishlatilmaydi — batareya tejalgan (foreground service yetarli).
 */
public class KeepAliveService extends Service {

  static final String CH_ID = "50gram_service";

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
          .setContentTitle("50 Gram fonda ishlayapti")
          .setContentText("Xabarlar va qo'ng'iroqlar o'z vaqtida yetadi")
          .setOngoing(true)
          .build();
    } else {
      n = new Notification.Builder(this)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle("50 Gram fonda ishlayapti")
          .setContentText("Xabarlar va qo'ng'iroqlar o'z vaqtida yetadi")
          .setOngoing(true)
          .build();
    }
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(1, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    } else {
      startForeground(1, n);
    }
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
  public IBinder onBind(Intent intent) { return null; }
}
