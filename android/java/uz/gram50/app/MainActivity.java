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
 * 50 Gram — native Android ilova (v2.0, professional).
 * - To'liq ekran splash (logotip bilan) — sahifa yuklanguncha brend ko'rinadi
 * - Qo'ng'iroqlar: JS bridge (Android50) — fonida ham to'liq ekran javob oynasi
 * - Kamera/mikrofon, fayl tanlash, fonda ishlash — hammasi brauzer cheklovisiz
 */
public class MainActivity extends Activity {

  static final String URL = "https://50gram.begzodbegzodjons.workers.dev/";
  static final String HOST = "50gram.begzodbegzodjons.workers.dev";
  static final int FILE_REQ = 1001;
  static final int MEDIA_REQ = 1002;

  WebView web;
  FrameLayout root;
  View splash;
  ValueCallback<Uri[]> fileCb;
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

    @JavascriptInterface
    public String version() { return "2.0"; }
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
    s.setUserAgentString(s.getUserAgentString() + " 50GramApp/2.0");
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
        hideSplash();
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      // Kamera/mikrofon — qo'ng'iroqlar va jonli efir uchun brauzer cheklovisiz
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(new Runnable() {
          @Override public void run() { request.grant(request.getResources()); }
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
    // Kamera va mikrofon — qo'ng'iroqlar birinchi ochilishdan ishlashi uchun
    if (Build.VERSION.SDK_INT >= 23) {
      if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
          || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, MEDIA_REQ);
      }
    }

    // SPLASH: logotip bilan to'liq ekran — sahifa tayyor bo'lgach silliq yo'qoladi
    splash = makeSplash();
    root.addView(splash, new FrameLayout.LayoutParams(-1, -1));

    if (savedInstanceState == null) {
      web.loadUrl(URL);
    } else {
      web.restoreState(savedInstanceState);
      hideSplash();
    }
    web.resumeTimers();

    // Fon xizmati: fonda ham ulanish tirik — xabarlar va qo'ng'iroqlar o'z vaqtida
    Intent svc = new Intent(this, KeepAliveService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);

    handleCallIntent(getIntent());
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

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    // Rad etilsa ham ilova ishlaydi — keyin qo'ng'iroqda WebView o'zi qayta so'raydi
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

  @Override
  public void onBackPressed() {
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
    if (web != null) {
      web.resumeTimers();
      // Ilovaga qaytganda WebSocket qayta ulanadi + fon qo'ng'irog'i UI'da ko'rinadi
      try { web.evaluateJavascript("try{window.__appResume&&window.__appResume()}catch(e){}", null); } catch (Exception e) { }
    }
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
