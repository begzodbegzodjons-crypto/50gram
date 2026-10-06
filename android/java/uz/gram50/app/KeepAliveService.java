package uz.gram50.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Fon xizmati (v2.5): ilova jarayoni tirik turadi — xabarlar va QO'NG'IROQLAR fonda ham o'z vaqtida yetadi.
 *
 * Ikki mexanizm birgalikda ishlaydi:
 * 1) Foreground service — jarayon o'chmaydi, ilova ichidagi WebSocket tirik qoladi.
 * 2) POLLING — ilova fonda/ekran o'chgan holatda ham har 20 soniyada serverdan /calls/pending
 *    so'rovi yuboriladi: "ringing" qo'ng'iroq bo'lsa TO'LIQ EKRAN qo'ng'iroq oynasi chiqadi
 *    (Telegram uslubi). Bu Doze rejimida ham ishlaydi, chunki:
 *    - ilova batareya optimizatsiyasidan chiqarilgan (MainActivity so'raydi)
 *    - Partial WakeLock CPU'ni, WifiLock tarmoqni uxatmaydi
 * Ilova ekranda bo'lsa polling to'xtaydi — WebSocket allaqachon ko'rsatayapti (ikkilanish yo'q).
 */
public class KeepAliveService extends Service {

  static final String CH_ID = "50gram_service";
  static final String API_BASE = "https://50gram.begzodbegzodjons.workers.dev/api";
  static final long POLL_MS = 20000;

  /** JS tomondan Android50.setToken() orqali beriladi (MainActivity o'qiydi). */
  public static volatile String token = null;
  private static volatile boolean polling = false;
  static String lastShown = null;
  static String lastMsg = null; // v2.9: oxirgi ko'rsatilgan xabar kaliti (chat_id + matn boshi)

  final Handler h = new Handler(Looper.getMainLooper());
  PowerManager.WakeLock wl;
  WifiManager.WifiLock wfl;
  boolean screenOn = true;

  final Runnable loop = new Runnable() {
    @Override public void run() {
      try { pollPending(); } catch (Exception ignored) { }
      try { pollUnread(); } catch (Exception ignored) { } // v2.9: o'qilmagan xabarlar (fon bildirishnomasi)
      h.postDelayed(this, MainActivity.visible ? POLL_MS * 2 : POLL_MS);
    }
  };

  final BroadcastReceiver scr = new BroadcastReceiver() {
    @Override public void onReceive(Context context, Intent intent) {
      screenOn = Intent.ACTION_SCREEN_ON.equals(intent.getAction());
      if (screenOn) h.postDelayed(new Runnable() { @Override public void run() { try { pollPending(); } catch (Exception ignored) { } } }, 700);
    }
  };

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

    // CPU va tarmoq uyquda ham jonli (batareya optimizatsiyasidan chiqarilganda samarali)
    try {
      PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
      wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "50gram:keepalive");
      wl.setReferenceCounted(false);
      wl.acquire();
      WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
      if (wm != null) {
        int mode = Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
        wfl = wm.createWifiLock(mode, "50gram:wifi");
        wfl.setReferenceCounted(false);
        wfl.acquire();
      }
    } catch (Exception ignored) { }

    IntentFilter f = new IntentFilter();
    f.addAction(Intent.ACTION_SCREEN_ON);
    f.addAction(Intent.ACTION_SCREEN_OFF);
    try { registerReceiver(scr, f); } catch (Exception ignored) { }

    if (!polling) {
      polling = true;
      h.postDelayed(loop, 4000);
    }
  }

  static void loadToken(Context ctx) {
    if (token != null) return;
    try {
      SharedPreferences p = ctx.getSharedPreferences("g50", Context.MODE_PRIVATE);
      token = p.getString("token", null);
    } catch (Exception ignored) { }
  }

  boolean online() {
    try {
      ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
      NetworkInfo ni = cm == null ? null : cm.getActiveNetworkInfo();
      return ni != null && ni.isConnected();
    } catch (Exception e) { return true; }
  }

  /** /calls/pending: "ringing" qo'ng'iroq bo'lsa to'liq ekran qo'ng'iroq oynasi chiqadi. */
  void pollPending() {
    String t = token;
    if (t == null || MainActivity.visible || !online()) return;
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(API_BASE + "/calls/pending").openConnection();
      c.setConnectTimeout(9000);
      c.setReadTimeout(9000);
      c.setRequestProperty("Authorization", "Bearer " + t);
      int code = c.getResponseCode();
      if (code != 200) return;
      InputStream in = c.getInputStream();
      StringBuilder sb = new StringBuilder();
      byte[] buf = new byte[4096];
      int n;
      while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
      try { in.close(); } catch (Exception ignored) { }
      JSONObject o = new JSONObject(sb.toString());
      JSONObject call = o.optJSONObject("call");
      String cur = call == null ? null : String.valueOf(call.optLong("call_id"));
      if (call != null && cur != null && !cur.equals("0") && !cur.equals(lastShown)) {
        lastShown = cur;
        JSONObject from = call.optJSONObject("from");
        String name = "Foydalanuvchi";
        if (from != null) {
          String fn = from.optString("first_name", "").trim();
          String ln = from.optString("last_name", "").trim();
          name = (fn + " " + ln).trim();
          if (name.isEmpty()) name = from.optString("username", "Foydalanuvchi");
        }
        CallAlert.show(this, name, call.optBoolean("video", false), cur);
      } else if (call == null) {
        // Qo'ng'iroq tugadi (javob berildi/rad/otib ketdi) — bildirishnomani yopamiz
        if (lastShown != null) { CallAlert.cancel(this); lastShown = null; }
      }
    } catch (Exception ignored) {
    } finally {
      if (c != null) try { c.disconnect(); } catch (Exception ignored) { }
    }
  }

  /** /notify/unread: o'qilmagan xabar bor bo'lsa — XABAR bildirishnomasi chiqadi (v2.9).
   *  Web Push WebView'da ishlamaydi — Android xizmati polling zaxira yo'li (JS bridge
   *  Android50.pushNotify WS tirik bo'lsa DARHOL ko'rsatadi; bu — WS o'lsa ham ishlaydi). */
  void pollUnread() {
    String t = token;
    if (t == null || MainActivity.visible || !online()) return;
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(API_BASE + "/notify/unread").openConnection();
      c.setConnectTimeout(9000);
      c.setReadTimeout(9000);
      c.setRequestProperty("Authorization", "Bearer " + t);
      int code = c.getResponseCode();
      if (code != 200) return;
      InputStream in = c.getInputStream();
      StringBuilder sb = new StringBuilder();
      byte[] buf = new byte[4096];
      int n;
      while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
      try { in.close(); } catch (Exception ignored) { }
      JSONObject o = new JSONObject(sb.toString());
      int cnt = o.optInt("n", 0);
      if (cnt <= 0) { lastMsg = null; return; }
      String chatId = String.valueOf(o.optLong("chat_id", 0));
      String b = o.optString("b", "");
      String key = chatId + "|" + (b.length() > 40 ? b.substring(0, 40) : b);
      if (key.equals(lastMsg)) return; // allaqachon ko'rsatilgan — bezovta qilmaymiz
      lastMsg = key;
      G50Notify.show(this, o.optString("t", "50 Gram"), b, chatId);
    } catch (Exception ignored) {
    } finally {
      if (c != null) try { c.disconnect(); } catch (Exception ignored) { }
    }
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    loadToken(this);
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
    polling = false;
    h.removeCallbacks(loop);
    try { unregisterReceiver(scr); } catch (Exception ignored) { }
    try { if (wl != null) wl.release(); } catch (Exception ignored) { }
    try { if (wfl != null) wfl.release(); } catch (Exception ignored) { }
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) { return null; }
}
