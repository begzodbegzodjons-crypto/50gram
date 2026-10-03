package uz.gram50.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.Gravity;
import android.view.View;
import android.view.animation.AlphaAnimation;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * 50 Gram — native Android ilova (v2.4, professional).
 * - To'liq ekran splash (logotip bilan) — sahifa yuklanguncha brend ko'rinadi
 * - Qo'ng'iroqlar: JS bridge (Android50) — fonida ham to'liq ekran javob oynasi
 * - Kamera/mikrofon, fayl tanlash, fonda ishlash — hammasi brauzer cheklovisiz
 * - v2.2: ruxsatlar oqimi tubdan tuzatildi — ayrim telefonlarda (MIUI/ColorOS/OneUI)
 *   kamera/mikrofon oynasi umuman chiqmasdi: onPermissionRequest endi OS darajasidagi
 *   ruxsatni tekshirib, haqiqiy Android oynasini chiqaradi + "Sozlamalar" zaxirasi
 * - v2.3: saytdagi .apk yuklab olish havolasi ilova ichida ishlashi uchun DownloadListener
 *   qo'shildi — tizim brauzeri orqali yuklanadi
 * - v2.4: TIZIM "ORQAGA" TUGMASI endi ilovani yopmaydi — ilova ichida bir qadam orqaga
 *   qaytadi (ochiq chat/efir/oyna yopiladi, JS __50back orqali). Hech narsa ochiq
 *   bo'lmasa ilova fonga o'tadi (moveTaskToBack) — xabarlar olib kelaveradi
 * - v2.6: ESKI SAHIFA MUAMMOSI tugatildi — ilova fonda kunlar bo'ylab tursa, WebView'dagi
 *   sahifa eskirib qolardi (yangi banner/funksiyalar ko'rinmasdi). Endi 5 soatdan eski
 *   sahifa ilovaga qaytganda avtomatik yangilanadi (qo'ng'iroq paytida uzilmaydi)
 */
public class MainActivity extends Activity {

  static final String URL = "https://50gram.begzodbegzodjons.workers.dev/";
  static final String HOST = "50gram.begzodbegzodjons.workers.dev";
  static final int FILE_REQ = 1001;
  static final int MEDIA_REQ = 1002;

  /** Xizmat polling o'tkazib yuborishi uchun: ilova ekranda bo'lsa xizmat jim turadi (WS ko'rsatayapti) */
  public static volatile boolean visible = true;

  WebView web;
  FrameLayout root;
  View splash;
  ValueCallback<Uri[]> fileCb;
  volatile PermissionRequest pendingWebReq; // OS ruxsat javobi kutilayotgan web so'rovi
  volatile long lastLoadAt = 0; // sahifa oxirgi marta qachon yuklangan (5 soatlik yangilash uchun)
  final Handler main = new Handler(Looper.getMainLooper());

  /** JS <-> Native ko'prik: qo'ng'iroqlar fon rejimida native oyna ko'rsatadi */
  class Bridge {
    @JavascriptInterface
    public void callIncoming(String json) {
      try {
        JSONObject o = new JSONObject(json);
        CallAlert.show(MainActivity.this,
            o.optString("name", "Foydalanuvchi"),
            o.optBoolean("video", false),
            o.optString("id", "0"));
      } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public void callStarted() {
      CallAlert.cancel(MainActivity.this);
    }

    /** WS xizmatga o'z tokenini beradi — fonda polling ishlashi uchun (v2.5) */
    @JavascriptInterface
    public void setToken(String t) {
      try {
        if (t == null || t.length() < 8) return;
        KeepAliveService.token = t;
        getSharedPreferences("g50", MODE_PRIVATE).edit().putString("token", t).apply();
      } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public String version() { return "2.6"; }

    /** Web tomondan ruxsatlarni ataylab so'rash (masalan qo'ng'iroq tugmasi bosilganda). */
    @JavascriptInterface
    public void ensurePerms() {
      runOnUiThread(new Runnable() {
        @Override public void run() { ensureOsMediaPerms(null); }
      });
    }
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    root = new FrameLayout(this);
    web = new WebView(this);
    root.addView(web, new FrameLayout.LayoutParams(-1, -1));
    setContentView(root);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    // MUHIM: wide viewport o'chiriladi — sahifa aynan ekran kengligida (meta viewport
    // bo'yicha) render bo'ladi, aks holda ba'zi telefonlarda kontent chapga suriladi.
    s.setUseWideViewPort(false);
    s.setLoadWithOverviewMode(false);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setJavaScriptCanOpenWindowsAutomatically(true);
    s.setUserAgentString(s.getUserAgentString() + " 50GramApp/2.6");
    web.addJavascriptInterface(new Bridge(), "Android50");

    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, String url) {
        Uri u = Uri.parse(url);
        if (HOST.equals(u.getHost())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
        return true;
      }

      @Override
      public void onPageFinished(WebView v, String url) {
        lastLoadAt = System.currentTimeMillis();
        hideSplash();
      }
    });

    // FAYL YUKLAB OLISH: saytdagi .apk havolasi (yoki boshqa fayl) bosilsa —
    // tizim brauzeri/DifferentialManager orqali yuklanadi (WebView o'zi yuklamaydi)
    web.setDownloadListener(new android.webkit.DownloadListener() {
      @Override public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      // Kamera/mikrofon: avval ANDROID TIZIM ruxsatini tekshiramiz. Ruxsat berilgan
      // bo'lsa web so'rovini darhol qo'ydamiz; berilmagan bo'lsa HAQIQIY Android ruxsat
      // oynasini chiqaramiz (request.grant() ruxsatsiz holda jim ishlamay qolardi).
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(new Runnable() {
          @Override public void run() { handleWebPermRequest(request); }
        });
      }

      @Override
      public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                       FileChooserParams params) {
        if (fileCb != null) fileCb.onReceiveValue(null);
        fileCb = cb;
        try {
          startActivityForResult(params.createIntent(), FILE_REQ);
        } catch (Exception e) {
          fileCb = null;
          return false;
        }
        return true;
      }
    });

    // Bildirishnomalar (Android 13+)
    if (Build.VERSION.SDK_INT >= 33) {
      requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
    }
    // Kamera/mikrofonni OLDINDAN so'rash — lekin 1.2s KECHIKTIRIB: ayrim ROM'lar
    // (MIUI, ColorOS, OneUI) onCreate ichidagi oynani yutib yuboradi. Kechiktirilgan
    // so'rov ishonchli ko'rinadi va ilova tizim ruxsatlar ro'yxatida ko'rina boshlaydi.
    main.postDelayed(new Runnable() {
      @Override public void run() { if (web != null) ensureOsMediaPerms(null); }
    }, 1200);

    // FON QO'NG'IROQLARI UCHUN BATTERY OPTIMIZATSIYA: ilova optimizatsiyadan chiqarilmasa
    // Doze rejimi tarmoqni to'sadi — fon qo'ng'iroqlari va xabarlar kechikadi. Bir marta so'raymiz.
    main.postDelayed(new Runnable() {
      @Override public void run() { askBatteryOptimization(); }
    }, 4000);

    // SPLASH: logotip bilan to'liq ekran — sahifa tayyor bo'lgach silliq yo'qoladi
    splash = makeSplash();
    root.addView(splash, new FrameLayout.LayoutParams(-1, -1));

    if (savedInstanceState == null) {
      web.loadUrl(URL);
    } else {
      web.restoreState(savedInstanceState);
      lastLoadAt = System.currentTimeMillis();
      hideSplash();
    }
    web.resumeTimers();

    // Fon xizmati: fonda ham ulanish tirik — xabarlar va qo'ng'iroqlar o'z vaqtida
    KeepAliveService.loadToken(this);
    Intent svc = new Intent(this, KeepAliveService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);

    handleCallIntent(getIntent());
  }

  /** Batareya optimizatsiyasidan chiqarish (bir marta) — fon qo'ng'iroqlari ishonchli ishlashi uchun */
  void askBatteryOptimization() {
    try {
      if (Build.VERSION.SDK_INT < 23) return;
      android.content.SharedPreferences p = getSharedPreferences("g50", MODE_PRIVATE);
      if (p.getBoolean("batt_asked", false)) return;
      PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
      if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
      p.edit().putBoolean("batt_asked", true).apply();
      new android.app.AlertDialog.Builder(this)
          .setTitle("Qo'ng'iroqlar o'z vaqtida kelsin")
          .setMessage("Ilovani batareya optimizatsiyasidan chiqarish tavsiya etiladi — shunda qo'ng'iroqlar va xabarlar fonda ham o'z vaqtida yetadi (Telegram kabi).\n\nOchilgan oynada «Ha, ruxsat berish» ni tanlang.")
          .setPositiveButton("Sozlash", new android.content.DialogInterface.OnClickListener() {
            @Override public void onClick(android.content.DialogInterface d, int w) {
              try {
                startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())));
              } catch (Exception e) {
                try { startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); } catch (Exception ignored) { }
              }
            }
          })
          .setNegativeButton("Keyinroq", null)
          .show();
    } catch (Exception ignored) { }
  }

  // ---------------- SPLASH ----------------
  View makeSplash() {
    FrameLayout fl = new FrameLayout(this);
    fl.setBackgroundColor(Color.parseColor("#F2F5FA"));
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setGravity(Gravity.CENTER);
    int side = (int) (getResources().getDisplayMetrics().widthPixels * 0.34f);
    ImageView iv = new ImageView(this);
    iv.setImageResource(R.drawable.splash_logo);
    iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(side, side);
    lp.gravity = Gravity.CENTER;
    box.addView(iv, lp);
    TextView tv = new TextView(this);
    tv.setText("50 Gram");
    tv.setTextSize(24);
    tv.setTextColor(Color.parseColor("#0E1330"));
    tv.setLetterSpacing(-0.02f);
    LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-2, -2);
    tp.gravity = Gravity.CENTER;
    tp.topMargin = (int) (18 * getResources().getDisplayMetrics().density);
    box.addView(tv, tp);
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-1, -1);
    fl.addView(box, bp);
    return fl;
  }

  void hideSplash() {
    final View v = splash;
    if (v == null) return;
    splash = null;
    AlphaAnimation a = new AlphaAnimation(1f, 0f);
    a.setDuration(220);
    a.setFillAfter(true);
    v.startAnimation(a);
    main.postDelayed(new Runnable() {
      @Override public void run() {
        try { ((FrameLayout) v.getParent()).removeView(v); } catch (Exception ignored) { }
      }
    }, 280);
  }

  // ---------------- QO'NG'IROQ INTENTLARI (bildirishnoma tugmalari) ----------------
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleCallIntent(intent);
  }

  void handleCallIntent(Intent i) {
    if (i == null || i.getStringExtra("c") == null || web == null) return;
    final String act = i.getStringExtra("c");
    final String id = i.getStringExtra("id") == null ? "0" : i.getStringExtra("id");
    CallAlert.cancel(this);
    // JS hali yuklanmagan bo'lishi mumkin — window.__50call topilguncha (maks 8s) qayta urinamiz
    callJsWhenReady(act, id, 0);
  }

  void callJsWhenReady(final String act, final String id, final int n) {
    if (web == null) return;
    web.evaluateJavascript("!!(window.__50call)", new android.webkit.ValueCallback<String>() {
      @Override public void onReceiveValue(String v) {
        if (v != null && v.contains("true")) {
          try {
            web.evaluateJavascript("try{window.__50call('" + act + "','" + id + "')}catch(e){}", null);
          } catch (Exception ignored) { }
        } else if (n < 12) {
          main.postDelayed(new Runnable() {
            @Override public void run() { callJsWhenReady(act, id, n + 1); }
          }, 650);
        }
      }
    });
  }

  // ---------------- RUXSATLAR (kamera/mikrofon) — v2.2 tuzatish ----------------

  /** OS darajasida ruxsat berilganmi? */
  boolean osPermGranted(String p) {
    return Build.VERSION.SDK_INT < 23
        || checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
  }

  /** OS darajasida kamera/mikrofon yetishmasa haqiqiy tizim oynasini chiqaradi.
   *  done — javob kelganda qo'yiladigan web so'rovi (null bo'lishi mumkin). */
  void ensureOsMediaPerms(final PermissionRequest done) {
    if (Build.VERSION.SDK_INT < 23) {
      if (done != null) { try { done.grant(done.getResources()); } catch (Exception ignored) { } }
      return;
    }
    boolean needCam = !osPermGranted(Manifest.permission.CAMERA);
    boolean needMic = !osPermGranted(Manifest.permission.RECORD_AUDIO);
    if (!needCam && !needMic) {
      if (done != null) { try { done.grant(done.getResources()); } catch (Exception ignored) { } }
      return;
    }
    if (done != null) {
      // kutayotgan boshqa so'rov bo'lsa — tozalaymiz (sahifa qayta so'raydi)
      if (pendingWebReq != null) { try { pendingWebReq.deny(); } catch (Exception ignored) { } }
      pendingWebReq = done;
    }
    java.util.List<String> need = new java.util.ArrayList<>();
    if (needCam) need.add(Manifest.permission.CAMERA);
    if (needMic) need.add(Manifest.permission.RECORD_AUDIO);
    try {
      requestPermissions(need.toArray(new String[0]), MEDIA_REQ);
    } catch (Exception e) {
      pendingWebReq = null;
      if (done != null) { try { done.deny(); } catch (Exception ignored) { } }
    }
  }

  /** Web (getUserMedia) so'rovini OS ruxsatlari bilan moslaydi. */
  void handleWebPermRequest(final PermissionRequest request) {
    boolean needCam = false, needMic = false;
    for (String r : request.getResources()) {
      if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) needCam = true;
      if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) needMic = true;
    }
    boolean camOk = !needCam || osPermGranted(Manifest.permission.CAMERA);
    boolean micOk = !needMic || osPermGranted(Manifest.permission.RECORD_AUDIO);
    if (camOk && micOk) {
      try { request.grant(request.getResources()); } catch (Exception ignored) { }
      return;
    }
    // OS ruxsati yetishmaydi — haqiqiy tizim oynasi chiqadi, javob kelgach qo'yiladi
    ensureOsMediaPerms(request);
  }

  /** "Boshqa so'ramaslik" bosilgan bo'lsa — ilova sozlamalariga olib boruvchi oyna. */
  void openAppSettingsDialog() {
    try {
      new android.app.AlertDialog.Builder(this)
          .setTitle("Ruxsat kerak")
          .setMessage("Video qo'ng'iroqlar, ovozli xabarlar va jonli efir uchun Kamera va Mikrofon ruxsati kerak. Sozlamalarda yoqib bering.")
          .setPositiveButton("Sozlamalarga o'tish", new android.content.DialogInterface.OnClickListener() {
            @Override public void onClick(android.content.DialogInterface d, int w) {
              try {
                startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName())));
              } catch (Exception ignored) { }
            }
          })
          .setNegativeButton("Keyinroq", null)
          .show();
    } catch (Exception ignored) { }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != MEDIA_REQ) return; // POST_NOTIFICATIONS (code 1) o'z oqimida
    boolean allGranted = true;
    boolean permanent = false;
    for (int i = 0; i < permissions.length; i++) {
      if (grantResults[i] != PackageManager.PERMISSION_GRANTED) {
        allGranted = false;
        // Rad etishdan keyin rationale ko'rinmasa — "boshqa so'ramaslik" tanlangan
        if (!shouldShowRequestPermissionRationale(permissions[i])) permanent = true;
      }
    }
    final PermissionRequest pr = pendingWebReq;
    pendingWebReq = null;
    if (pr != null) {
      try {
        if (allGranted) pr.grant(pr.getResources()); else pr.deny();
      } catch (Exception ignored) { }
    }
    if (!allGranted && permanent) openAppSettingsDialog();
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode == FILE_REQ && fileCb != null) {
      fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
      fileCb = null;
      return;
    }
    super.onActivityResult(requestCode, resultCode, data);
  }

  // ---------------- ORQAGA TUGMASI (v2.4) ----------------
  // Ilova ichida bir qadam orqaga: ochiq chat/efir/istoriya/oyna yopiladi (JS __50back).
  // Hech narsa ochiq bo'lmasa — ilova FONGA o'tadi (moveTaskToBack), o'chmaydi:
  // WebSocket tirik qoladi, xabar va qo'ng'iroqlar o'z vaqtida kelaveradi.
  @Override
  public void onBackPressed() {
    if (web != null) {
      try {
        web.evaluateJavascript("(window.__50back&&window.__50back())?'1':'0'", new android.webkit.ValueCallback<String>() {
          @Override public void onReceiveValue(String v) {
            if (v == null || v.indexOf('1') < 0) backFallback();
          }
        });
        return;
      } catch (Exception ignored) { }
    }
    backFallback();
  }

  void backFallback() {
    if (web != null && web.canGoBack()) web.goBack();
    else moveTaskToBack(true); // o'chirmaymiz — fonda davom etadi
  }

  @Override
  protected void onSaveInstanceState(Bundle outState) {
    super.onSaveInstanceState(outState);
    if (web != null) web.saveState(outState);
  }

  @Override
  protected void onResume() {
    super.onResume();
    visible = true; // ilova ekranda — xizmat polling to'xtatadi (WS ko'rsatayapti)
    if (web != null) {
      web.resumeTimers();
      // v2.6 TASK 39: sahifa 5 soatdan eski bo'lib qolsa — avtomatik yangilanadi. Aks holda
      // ilova xotirada turib beradi va yangi versiya (TEST rejimi banneri ham) ko'rinmay qolardi.
      // Qo'ng'iroq oynasi ko'rinayotganda uzilmaydi — foydalanuvchi javob berishi kerak.
      if (lastLoadAt > 0 && System.currentTimeMillis() - lastLoadAt > 5 * 3600000L
          && !CallAlert.showing) {
        lastLoadAt = System.currentTimeMillis();
        try { web.reload(); } catch (Exception ignored) { }
      }
      // Ilovaga qaytganda WebSocket qayta ulanadi + fon qo'ng'irog'i UI'da ko'rinadi
      try { web.evaluateJavascript("try{window.__appResume&&window.__appResume()}catch(e){}", null); } catch (Exception e) { }
    }
  }

  @Override
  protected void onPause() {
    super.onPause();
    visible = false; // xizmat pollingni yoqadi (ilova ekranda emas endi)
  }

  // MUHIM: onPause'da pauseTimers() CHAQIRILMAYDI — fonda JS tirik turadi,
  // aks holda WebSocket uzilib, fon qo'ng'iroqlari kelmas edi.

  @Override
  protected void onDestroy() {
    if (web != null) {
      try { root.removeView(web); web.destroy(); } catch (Exception ignored) { }
      web = null;
    }
    super.onDestroy();
  }
}
