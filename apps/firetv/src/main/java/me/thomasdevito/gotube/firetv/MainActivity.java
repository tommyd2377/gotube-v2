package me.thomasdevito.gotube.firetv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

public final class MainActivity extends Activity {
  private static final String LOCAL_ORIGIN = "https://gotube.local";
  private static final String LOCAL_HOST = "gotube.local";

  private WebView webView;
  private FrameLayout rootView;
  private ImageView splashView;
  private long splashStartedAtMillis;
  private String allowedTopLevelHost = LOCAL_HOST;
  private String appStartUrl = LOCAL_ORIGIN + "/tv";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    requestWindowFeature(Window.FEATURE_NO_TITLE);
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    String configuredTvUrl = readNativeConfig("tvUrl");
    String startUrl = configuredTvUrl.isEmpty() ? LOCAL_ORIGIN + "/tv" : configuredTvUrl;
    appStartUrl = startUrl;
    Uri startUri = Uri.parse(startUrl);
    if (startUri.getHost() != null) {
      allowedTopLevelHost = startUri.getHost();
    }

    webView = new WebView(this);
    webView.setBackgroundColor(Color.rgb(2, 5, 11));
    configureWebView(webView);

    rootView = new FrameLayout(this);
    rootView.setBackgroundColor(Color.rgb(2, 5, 11));
    rootView.addView(webView, new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    ));

    splashView = new ImageView(this);
    splashStartedAtMillis = SystemClock.uptimeMillis();
    splashView.setBackgroundColor(Color.rgb(2, 5, 11));
    splashView.setImageResource(R.drawable.gotube_splash);
    splashView.setScaleType(ImageView.ScaleType.CENTER_CROP);
    rootView.addView(splashView, new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    ));

    setContentView(rootView);
    webView.loadUrl(startUrl);
  }

  @SuppressLint("SetJavaScriptEnabled")
  private void configureWebView(WebView view) {
    WebSettings settings = view.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(true);
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);
    settings.setJavaScriptCanOpenWindowsAutomatically(true);
    settings.setSupportMultipleWindows(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      settings.setSafeBrowsingEnabled(true);
    }

    CookieManager cookieManager = CookieManager.getInstance();
    cookieManager.setAcceptCookie(true);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      cookieManager.setAcceptThirdPartyCookies(view, true);
    }

    view.setWebChromeClient(new GoTubeWebChromeClient());
    view.setWebViewClient(new GoTubeWebViewClient());
    view.setFocusable(true);
    view.setFocusableInTouchMode(true);
    view.requestFocus();
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (event.getAction() != KeyEvent.ACTION_DOWN || webView == null) {
      return super.dispatchKeyEvent(event);
    }

    if (isGoogleAccountUrl(webView.getUrl())) {
      return super.dispatchKeyEvent(event);
    }

    switch (event.getKeyCode()) {
      case KeyEvent.KEYCODE_DPAD_UP:
        dispatchJsKey("ArrowUp");
        return true;
      case KeyEvent.KEYCODE_DPAD_DOWN:
        dispatchJsKey("ArrowDown");
        return true;
      case KeyEvent.KEYCODE_DPAD_LEFT:
        dispatchJsKey("ArrowLeft");
        return true;
      case KeyEvent.KEYCODE_DPAD_RIGHT:
        dispatchJsKey("ArrowRight");
        return true;
      case KeyEvent.KEYCODE_DPAD_CENTER:
      case KeyEvent.KEYCODE_ENTER:
        handleSelectKey();
        return true;
      case KeyEvent.KEYCODE_MEDIA_PLAY:
      case KeyEvent.KEYCODE_MEDIA_PAUSE:
      case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
      case KeyEvent.KEYCODE_SPACE:
        dispatchJsKey(" ");
        return true;
      case KeyEvent.KEYCODE_MEDIA_REWIND:
      case KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD:
      case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
        dispatchJsKey("MediaRewind");
        return true;
      case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
      case KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD:
      case KeyEvent.KEYCODE_MEDIA_NEXT:
        dispatchJsKey("MediaFastForward");
        return true;
      default:
        return super.dispatchKeyEvent(event);
    }
  }

  @Override
  @SuppressWarnings("deprecation")
  public void onBackPressed() {
    if (webView != null && !isAppUrl(webView.getUrl())) {
      webView.loadUrl(appStartUrl);
      return;
    }
    dispatchJsKey("Backspace");
  }

  @Override
  protected void onDestroy() {
    if (webView != null) {
      webView.destroy();
      webView = null;
    }
    splashView = null;
    rootView = null;
    super.onDestroy();
  }

  private void hideSplash() {
    if (rootView == null || splashView == null) {
      return;
    }
    final ImageView view = splashView;
    long remainingSplashMillis = Math.max(0, 1000 - (SystemClock.uptimeMillis() - splashStartedAtMillis));
    splashView = null;
    view.postDelayed(new Runnable() {
      @Override
      public void run() {
        view.animate()
          .alpha(0f)
          .setDuration(180)
          .withEndAction(new Runnable() {
            @Override
            public void run() {
              if (rootView != null) {
                rootView.removeView(view);
              }
            }
          })
          .start();
      }
    }, remainingSplashMillis);
  }

  private void dispatchJsKey(String key) {
    if (webView == null) {
      return;
    }
    String escapedKey = key.replace("\\", "\\\\").replace("'", "\\'");
    dispatchJsSnippet("window.dispatchEvent(new KeyboardEvent('keydown',{key:'" + escapedKey + "',bubbles:true}));");
  }

  private void dispatchJsSnippet(String script) {
    if (webView == null) {
      return;
    }
    webView.evaluateJavascript(script, null);
  }

  private void handleSelectKey() {
    if (webView == null) {
      return;
    }
    webView.evaluateJavascript(
      "(function(){"
        + "var e=document.activeElement;"
        + "var signIn=document.querySelector('[data-tv-youtube-signin=\"true\"]:focus') || "
        + "(e && e.closest ? e.closest('[data-tv-youtube-signin=\"true\"]') : null);"
        + "if(!signIn && e && /sign\\s*in/i.test((e.textContent || '').trim())){signIn=e;}"
        + "if(signIn){return 'youtube-signin';}"
        + "if(e && (e.tagName==='INPUT' || e.tagName==='TEXTAREA')){e.focus();e.click();return 'input';}"
        + "if(e && (e.dataset.tvPlayerStage==='true' || e.dataset.tvPlayerTap==='true')){"
        + "var direct=e.dataset.tvPlayerDirect==='true';"
        + "if(!direct && e.closest){direct=!!e.closest('[data-tv-player-direct=\"true\"]');}"
        + "var f=document.querySelector('[data-tv-player-stage=\"true\"]');"
        + "if(f){var r=f.getBoundingClientRect();return (direct ? 'tap-direct:' : 'tap:')+(r.left+r.width/2)+','+(r.top+r.height/2);}"
        + "}"
        + "return 'enter';"
        + "})()",
      new ValueCallback<String>() {
        @Override
        public void onReceiveValue(String value) {
          String action = jsStringValue(value);
          if ("input".equals(action)) {
            webView.requestFocus();
            webView.postDelayed(new Runnable() {
              @Override
              public void run() {
                InputMethodManager inputMethodManager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (inputMethodManager != null) {
                  inputMethodManager.showSoftInput(webView, InputMethodManager.SHOW_FORCED);
                  inputMethodManager.toggleSoftInput(InputMethodManager.SHOW_FORCED, 0);
                }
              }
            }, 80);
            return;
          }

          if ("youtube-signin".equals(action)) {
            openYouTubeSignIn();
            return;
          }

          if (action.startsWith("tap-direct:")) {
            tapWebView(action.substring(11));
            webView.postDelayed(new Runnable() {
              @Override
              public void run() {
                dispatchJsSnippet("window.dispatchEvent(new CustomEvent('gotube-tv-native-player-tap'));");
              }
            }, 160);
            return;
          }

          if (action.startsWith("tap:")) {
            tapWebView(action.substring(4));
            return;
          }

          dispatchJsKey("Enter");
        }
      }
    );
  }

  private String jsStringValue(String value) {
    if (value == null) {
      return "";
    }
    String trimmed = value.trim();
    if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
      trimmed = trimmed.substring(1, trimmed.length() - 1);
    }
    return trimmed.replace("\\\"", "\"").replace("\\\\", "\\");
  }

  private void tapWebView(String coordinates) {
    if (webView == null) {
      return;
    }

    String[] parts = coordinates.split(",", 2);
    if (parts.length != 2) {
      dispatchJsKey("Enter");
      return;
    }

    try {
      float scale = webView.getScale();
      float x = Float.parseFloat(parts[0]) * scale;
      float y = Float.parseFloat(parts[1]) * scale;
      x = Math.max(0, Math.min(webView.getWidth() - 1, x));
      y = Math.max(0, Math.min(webView.getHeight() - 1, y));
      long downTime = SystemClock.uptimeMillis();
      MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
      MotionEvent up = MotionEvent.obtain(downTime, downTime + 80, MotionEvent.ACTION_UP, x, y, 0);
      webView.dispatchTouchEvent(down);
      webView.dispatchTouchEvent(up);
      down.recycle();
      up.recycle();
    } catch (NumberFormatException ignored) {
      dispatchJsKey("Enter");
    }
  }

  private void openYouTubeSignIn() {
    if (webView == null) {
      return;
    }
    Uri uri = new Uri.Builder()
      .scheme("https")
      .authority("accounts.google.com")
      .path("/ServiceLogin")
      .appendQueryParameter("service", "youtube")
      .appendQueryParameter("continue", "https://www.youtube.com/")
      .build();
    webView.loadUrl(uri.toString());
  }

  private String readNativeConfig(String key) {
    Properties properties = new Properties();
    try (InputStream stream = getAssets().open("gotube-native-config.properties")) {
      properties.load(stream);
      return properties.getProperty(key, "").trim();
    } catch (IOException ignored) {
      return "";
    }
  }

  private final class GoTubeWebChromeClient extends WebChromeClient {
    @Override
    public void onPermissionRequest(PermissionRequest request) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
        super.onPermissionRequest(request);
        return;
      }

      for (String resource : request.getResources()) {
        if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(resource)) {
          request.grant(new String[] { PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID });
          return;
        }
      }
      super.onPermissionRequest(request);
    }
  }

  private final class GoTubeWebViewClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      if (!request.isForMainFrame()) {
        return false;
      }
      return !isAllowedTopLevelUrl(uri) && !isAllowedYouTubeSignInUrl(uri);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      CookieManager.getInstance().flush();
      hideSplash();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      if (!LOCAL_HOST.equals(uri.getHost())) {
        return null;
      }
      return assetResponse(uri.getPath());
    }
  }

  private boolean isAllowedTopLevelUrl(Uri uri) {
    String scheme = uri.getScheme();
    String host = uri.getHost();
    if (host == null || scheme == null) {
      return false;
    }
    return ("https".equals(scheme) || "http".equals(scheme)) && host.equals(allowedTopLevelHost);
  }

  private boolean isAppUrl(String url) {
    if (url == null || url.isEmpty()) {
      return true;
    }
    return isAllowedTopLevelUrl(Uri.parse(url));
  }

  private boolean isGoogleAccountUrl(String url) {
    if (url == null || url.isEmpty()) {
      return false;
    }
    Uri uri = Uri.parse(url);
    String host = uri.getHost();
    return host != null
      && (host.equals("accounts.google.com")
        || host.equals("myaccount.google.com")
        || host.equals("www.google.com")
        || host.equals("consent.youtube.com"));
  }

  private boolean isAllowedYouTubeSignInUrl(Uri uri) {
    String scheme = uri.getScheme();
    String host = uri.getHost();
    if (scheme == null || host == null || (!"https".equals(scheme) && !"http".equals(scheme))) {
      return false;
    }

    return host.equals("accounts.google.com")
      || host.equals("myaccount.google.com")
      || host.equals("www.google.com")
      || host.equals("youtube.com")
      || host.equals("www.youtube.com")
      || host.equals("m.youtube.com")
      || host.equals("consent.youtube.com");
  }

  private WebResourceResponse assetResponse(String requestPath) {
    String path = requestPath == null || requestPath.isEmpty() ? "/" : requestPath;
    if (path.contains("..")) {
      return null;
    }

    String assetPath;
    if (path.equals("/") || path.equals("/tv") || path.equals("/tv/") || path.equals("/index.html")) {
      assetPath = "gotube/index.html";
    } else if (!path.startsWith("/api/") && path.contains(".")) {
      assetPath = "gotube" + path;
    } else if (!path.startsWith("/api/") && !path.contains(".")) {
      assetPath = "gotube/index.html";
    } else {
      return null;
    }

    try {
      InputStream stream = getAssets().open(assetPath);
      return new WebResourceResponse(mimeType(assetPath), "UTF-8", 200, "OK", responseHeaders(), stream);
    } catch (IOException ignored) {
      return null;
    }
  }

  private Map<String, String> responseHeaders() {
    Map<String, String> headers = new HashMap<String, String>();
    headers.put("Access-Control-Allow-Origin", "*");
    headers.put("Cache-Control", "no-cache");
    return headers;
  }

  private String mimeType(String path) {
    if (path.endsWith(".html")) {
      return "text/html";
    }
    if (path.endsWith(".js")) {
      return "application/javascript";
    }
    if (path.endsWith(".css")) {
      return "text/css";
    }
    if (path.endsWith(".json")) {
      return "application/json";
    }
    if (path.endsWith(".webmanifest")) {
      return "application/manifest+json";
    }
    if (path.endsWith(".svg")) {
      return "image/svg+xml";
    }
    if (path.endsWith(".png")) {
      return "image/png";
    }
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
      return "image/jpeg";
    }
    if (path.endsWith(".webp")) {
      return "image/webp";
    }
    return "application/octet-stream";
  }
}
