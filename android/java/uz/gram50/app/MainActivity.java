package uz.gram50.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class MainActivity extends Activity {

  static final String URL = "https://50gram.begzodbegzodjons.workers.dev/";
  static final String HOST = "50gram.begzodbegzodjons.workers.dev";
  static final int FILE_REQ = 1001;
  static final int MEDIA_REQ = 1002;

  WebView web;
  FrameLayout root;
  ValueCallback<Uri[]> fileCb;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    root = new FrameLayout(this);
    web = new WebView(this);
    root.addView(web, new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
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
    s.setUserAgentString(s.getUserAgentString() + " 50GramApp/1.1");

    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, String url) {
        Uri u = Uri.parse(url);
        if (HOST.equals(u.getHost())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
        return true;
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

    if (savedInstanceState == null) {
      web.loadUrl(URL);
    } else {
      web.restoreState(savedInstanceState);
    }
    web.resumeTimers();

    // Fon xizmati: fonda ham ulanish tirik turadi
    Intent svc = new Intent(this, KeepAliveService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == MEDIA_REQ) {
      // Rad etilsa ham ilova ishlaydi — keyin qo'ng'iroqda WebView o'zi qayta so'radi
    }
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
    if (web.canGoBack()) web.goBack();
    else moveTaskToBack(true); // o'chirmaymiz — fonda davom etadi
  }

  @Override
  protected void onSaveInstanceState(Bundle outState) {
    super.onSaveInstanceState(outState);
    web.saveState(outState);
  }

  @Override
  protected void onResume() {
    super.onResume();
    web.resumeTimers();
    // Ilovaga qaytganda WebSocket qayta ulanishi (core.js ichida)
    try { web.evaluateJavascript("window.__appResume&&window.__appResume()", null); } catch (Exception e) { }
  }
}
