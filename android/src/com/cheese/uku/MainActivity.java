package com.cheese.uku;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.view.KeyEvent;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_RESULT_CODE = 1001;
    private static final String VIRTUAL_HOST = "localhost";
    private static final String START_URL = "https://localhost/index.html";
    private static final String PIXIV_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private static final String TAG = "UkuFurigana";
    private static final int MAX_RENDERER_RESTARTS = 3;
    private static final long RENDERER_RESTART_WINDOW_MS = 60_000L;
    private static int rendererRestarts = 0;
    private static long rendererRestartWindowStart = 0L;

    public static final int NATIVE_LOG_MAX_BYTES = 64 * 1024;
    public static final int NATIVE_LOG_TRIM_BYTES = 32 * 1024;
    private static final String NATIVE_LOG_FILE = "native.log";
    private static final String PREFS_NAME = "uku_native_log";
    private static final String PREF_LAST_EXIT_TS = "last_exit_timestamp";
    private static final Object LOG_LOCK = new Object();

    private WebView webView;
    private boolean readerVolumeKeysEnabled = false;
    private int readerVolumeKeysHeld = 0;
    private PixivAccount pixivAccount;
    private ValueCallback<Uri[]> filePathCallback;

    public class AndroidNativeBridge {
        @JavascriptInterface
        public void setReaderVolumeKeysEnabled(boolean enabled) {
            runOnUiThread(() -> {
                String url = webView == null ? null : webView.getUrl();
                readerVolumeKeysEnabled = enabled && hasWindowFocus() && url != null
                        && "https".equals(Uri.parse(url).getScheme())
                        && VIRTUAL_HOST.equals(Uri.parse(url).getHost());
            });
        }

        @JavascriptInterface
        public String getPixivAccountStatus() { return pixivAccount.statusJson(); }

        @JavascriptInterface
        public String openPixivLogin() {
            pixivAccount.login();
            return pixivAccount.statusJson();
        }

        @JavascriptInterface
        public String logoutPixiv() {
            pixivAccount.logout();
            return "{\"supported\":true,\"loggedIn\":false}";
        }

        @JavascriptInterface
        public String saveFile(String filename, String base64Data) {
            if (filename == null || filename.trim().isEmpty()) {
                filename = "furigana_export.txt";
            }
            final String safeName = filename.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                String mimeType = guessMimeType(safeName);
                String savedLocation;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/UkuFurigana");

                    ContentResolver resolver = getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        throw new IOException("Unable to create MediaStore Downloads entry");
                    }
                    try (OutputStream out = resolver.openOutputStream(uri)) {
                        if (out == null) {
                            throw new IOException("Unable to open output stream");
                        }
                        out.write(bytes);
                        out.flush();
                    }
                    savedLocation = "Download/UkuFurigana/" + safeName;
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "UkuFurigana");
                    if (!dir.exists()) {
                        dir.mkdirs();
                    }
                    File outFile = new File(dir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(bytes);
                        fos.flush();
                    }
                    savedLocation = outFile.getAbsolutePath();
                }

                final String toastMsg = "已保存至: " + savedLocation;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, toastMsg, Toast.LENGTH_SHORT).show());
                return "{\"success\":true,\"path\":\"" + savedLocation.replace("\"", "\\\"") + "\"}";
            } catch (Exception e) {
                String err = e.getMessage() != null ? e.getMessage().replace("\"", "'") : "Save failed";
                return "{\"success\":false,\"error\":\"" + err + "\"}";
            }
        }

        @JavascriptInterface
        public void syncTheme(String bgHex, boolean isDark) {
            final String safeHex = (bgHex != null && bgHex.matches("^#[0-9a-fA-F]{6}$"))
                    ? bgHex
                    : (isDark ? "#000000" : "#F2F2F7");
            runOnUiThread(() -> applySystemBarAndWebViewTheme(safeHex, isDark));
        }

        @JavascriptInterface
        public String getAppVersion() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                String versionName = info.versionName != null ? info.versionName : "0.0.0";
                long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? info.getLongVersionCode()
                        : info.versionCode;
                JSONObject json = new JSONObject();
                json.put("versionName", versionName);
                json.put("versionCode", versionCode);
                return json.toString();
            } catch (Exception e) {
                return formatErrorJson(e.getMessage() != null ? e.getMessage() : "version-error");
            }
        }

        @JavascriptInterface
        public String getNativeLog() {
            return readNativeLog(MainActivity.this);
        }

        @JavascriptInterface
        public String startUpdateDownload(String argsJson) {
            try {
                return UpdateManager.getInstance(MainActivity.this).startUpdateDownload(argsJson);
            } catch (Exception e) {
                return formatErrorJson(e.getMessage() != null ? e.getMessage() : "start-download-error");
            }
        }

        @JavascriptInterface
        public String getUpdateState() {
            try {
                return UpdateManager.getInstance(MainActivity.this).getUpdateState();
            } catch (Exception e) {
                return "{\"phase\":\"error\",\"progress\":0,\"error\":\"state-error\"}";
            }
        }

        @JavascriptInterface
        public String installUpdate() {
            try {
                return UpdateManager.getInstance(MainActivity.this).installUpdate(MainActivity.this);
            } catch (Exception e) {
                return formatErrorJson(e.getMessage() != null ? e.getMessage() : "install-error");
            }
        }

        @JavascriptInterface
        public String cancelUpdateDownload() {
            try {
                return UpdateManager.getInstance(MainActivity.this).cancelUpdateDownload();
            } catch (Exception e) {
                return formatErrorJson(e.getMessage() != null ? e.getMessage() : "cancel-error");
            }
        }

        @JavascriptInterface
        public String openQqGroup(String uin) {
            try {
                if (uin == null || !uin.matches("^\\d{5,12}$")) {
                    return "{\"success\":false,\"error\":\"invalid-uin\"}";
                }
                Uri uri = Uri.parse("mqqapi://card/show_pslcard?src_type=internal&version=1&uin="
                        + uin + "&card_type=group&source=qrcode");
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(intent);
                    return "{\"success\":true}";
                } catch (ActivityNotFoundException e) {
                    return "{\"success\":false}";
                }
            } catch (Exception e) {
                return formatErrorJson(e.getMessage() != null ? e.getMessage() : "qq-open-error");
            }
        }
    }

    private boolean isSystemDark() {
        return (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    private void pushSystemTheme() {
        if (webView != null) {
            webView.evaluateJavascript("window.__furiganaSystemDark=" + (isSystemDark() ? "true" : "false") + ";window.dispatchEvent(new Event('furigana-system-theme'));", null);
        }
    }

    private void applySystemBarAndWebViewTheme(String bgHex, boolean isDark) {
        int color;
        try {
            color = Color.parseColor(bgHex);
        } catch (IllegalArgumentException e) {
            color = Color.parseColor(isDark ? "#000000" : "#F2F2F7");
        }
        Window window = getWindow();
        if (window != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                android.view.View decorView = window.getDecorView();
                int flags = decorView.getSystemUiVisibility();
                if (!isDark) {
                    flags |= android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                } else {
                    flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!isDark) {
                        flags |= android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    } else {
                        flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    }
                }
                decorView.setSystemUiVisibility(flags);
            }
        }
        if (webView != null) {
            webView.setBackgroundColor(color);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        pixivAccount = new PixivAccount(this, () -> {
            if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new Event('uku-pixiv-account-change'));", null);
        });
        recordHistoricalExitReasons();
        UpdateManager.cleanupInstalled(this);

        Window window = getWindow();
        if (window != null) {
            window.requestFeature(Window.FEATURE_NO_TITLE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
                window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            }
        }

        webView = new WebView(this);
        webView.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
        applySystemBarAndWebViewTheme(isSystemDark() ? "#000000" : "#F2F2F7", isSystemDark());
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.addJavascriptInterface(new AndroidNativeBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                readerVolumeKeysEnabled = false;
                super.onPageStarted(view, url, favicon);
                pushSystemTheme();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pushSystemTheme();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) {
                    return super.shouldInterceptRequest(view, request);
                }

                String host = uri.getHost();
                String path = uri.getPath();
                if (host != null && host.equalsIgnoreCase(VIRTUAL_HOST)) {
                    if ("/api/pixiv-ajax".equals(path)) {
                        return handlePixivAjaxProxy(uri.getQueryParameter("id"));
                    }
                    if ("/api/pixiv-image".equals(path)) {
                        return handlePixivImageProxy(uri.getQueryParameter("url"));
                    }
                    return serveLocalAsset(path);
                }

                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Without this the dead renderer leaves "This page couldn't load" (or takes the app down).
                // Tear the WebView down and rebuild the activity so the app comes back on its own.
                boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
                int priorityAtExit = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null)
                        ? detail.rendererPriorityAtExit()
                        : -1;
                Log.w(TAG, "WebView renderer gone (" + (crashed ? "crash" : "killed by system, likely low memory") + ")");
                appendNativeLog(MainActivity.this, "renderer-gone didCrash=" + crashed + " priorityAtExit=" + priorityAtExit);
                if (view != null) {
                    ViewGroup parent = (ViewGroup) view.getParent();
                    if (parent != null) parent.removeView(view);
                    view.destroy();
                }
                webView = null;

                long now = System.currentTimeMillis();
                if (now - rendererRestartWindowStart > RENDERER_RESTART_WINDOW_MS) {
                    rendererRestartWindowStart = now;
                    rendererRestarts = 0;
                }
                if (++rendererRestarts > MAX_RENDERER_RESTARTS) {
                    Toast.makeText(MainActivity.this, "页面反复崩溃，请重新打开应用", Toast.LENGTH_LONG).show();
                    finish();
                } else {
                    recreate();
                }
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String host = uri.getHost();
                if (host != null && host.equalsIgnoreCase(VIRTUAL_HOST)) {
                    return false;
                }
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                        return true;
                    } catch (ActivityNotFoundException ignored) {
                        return false;
                    }
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                Intent intent;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && fileChooserParams != null) {
                    intent = fileChooserParams.createIntent();
                } else {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                }

                try {
                    startActivityForResult(intent, FILE_CHOOSER_RESULT_CODE);
                } catch (ActivityNotFoundException e) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // 朗读（TTS）已移除，应用无麦克风 / 摄像头用途：一律拒绝网页发起的权限请求。
                request.deny();
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return super.onConsoleMessage(consoleMessage);
            }
        });

        // After a renderer restart the saved bundle holds no WebView state, so restoreState returns null.
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_URL);
        }
    }

    private WebResourceResponse serveLocalAsset(String rawPath) {
        String cleanPath = (rawPath == null || rawPath.isEmpty() || "/".equals(rawPath))
                ? "index.html"
                : rawPath.replaceFirst("^/+", "");

        AssetManager assets = getAssets();
        InputStream stream = null;
        String resolvedPath = cleanPath;

        try {
            if (cleanPath.endsWith(".dat.gz")) {
                try {
                    stream = assets.open("www/" + cleanPath + ".bin");
                } catch (IOException ignored) {
                    stream = assets.open("www/" + cleanPath);
                }
            } else {
                try {
                    stream = assets.open("www/" + cleanPath);
                } catch (IOException e) {
                    if (!cleanPath.contains(".")) {
                        try {
                            resolvedPath = cleanPath + ".html";
                            stream = assets.open("www/" + resolvedPath);
                        } catch (IOException e2) {
                            resolvedPath = cleanPath + "/index.html";
                            stream = assets.open("www/" + resolvedPath);
                        }
                    } else {
                        throw e;
                    }
                }
            }

            String mimeType = guessMimeType(resolvedPath);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");

            WebResourceResponse response = new WebResourceResponse(mimeType, "UTF-8", stream);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                response.setResponseHeaders(headers);
            }
            return response;
        } catch (IOException e) {
            return createJsonResponse(404, "Not Found", "{\"error\":\"Asset not found\"}");
        }
    }

    private WebResourceResponse handlePixivAjaxProxy(String id) {
        if (id == null || !id.matches("^\\d{4,15}$")) {
            return createJsonResponse(400, "Bad Request", "{\"error\":true,\"message\":\"Invalid Pixiv ID\"}");
        }
        HttpURLConnection conn = null;
        try {
            URL url = new URL("https://www.pixiv.net/ajax/novel/" + id);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", PIXIV_UA);
            conn.setRequestProperty("Referer", "https://www.pixiv.net/");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Accept-Language", "ja,zh-CN;q=0.9,en;q=0.8");
            // Only this fixed Pixiv endpoint gets the local account session. Never relay it.
            conn.setInstanceFollowRedirects(false);
            String cookies = pixivAccount.cookieHeader();
            if (cookies != null && !cookies.isEmpty()) conn.setRequestProperty("Cookie", cookies);

            int status = conn.getResponseCode();
            InputStream in = (status >= 200 && status < 400) ? conn.getInputStream() : conn.getErrorStream();
            byte[] bytes = readAllBytes(in);
            String body = new String(bytes, StandardCharsets.UTF_8);
            return createJsonResponse(status >= 200 && status < 300 ? 200 : status, "OK", body);
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage().replace("\"", "'") : "Network error";
            return createJsonResponse(502, "Bad Gateway", "{\"error\":true,\"message\":\"" + msg + "\"}");
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private WebResourceResponse handlePixivImageProxy(String imageUrl) {
        if (imageUrl == null || !imageUrl.startsWith("https://")) {
            return createJsonResponse(400, "Bad Request", "{\"error\":\"Invalid image URL\"}");
        }
        HttpURLConnection conn = null;
        try {
            URL url = new URL(imageUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", PIXIV_UA);
            conn.setRequestProperty("Referer", "https://www.pixiv.net/");

            int status = conn.getResponseCode();
            if (status >= 200 && status < 300) {
                String contentType = conn.getContentType();
                if (contentType == null || !contentType.startsWith("image/")) {
                    contentType = "image/jpeg";
                }
                byte[] bytes = readAllBytes(conn.getInputStream());
                String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                String json = "{\"dataUrl\":\"data:" + contentType + ";base64," + b64 + "\"}";
                return createJsonResponse(200, "OK", json);
            }
            return createJsonResponse(status, "Error", "{\"error\":\"Image fetch failed\"}");
        } catch (Exception e) {
            return createJsonResponse(502, "Bad Gateway", "{\"error\":\"Image proxy exception\"}");
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private WebResourceResponse createJsonResponse(int statusCode, String reason, String jsonBody) {
        ByteArrayInputStream stream = new ByteArrayInputStream(jsonBody.getBytes(StandardCharsets.UTF_8));
        WebResourceResponse response = new WebResourceResponse("application/json", "UTF-8", stream);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            response.setStatusCodeAndReasonPhrase(statusCode, reason != null && !reason.isEmpty() ? reason : "OK");
            response.setResponseHeaders(headers);
        }
        return response;
    }

    private static byte[] readAllBytes(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) != -1) {
            buffer.write(chunk, 0, n);
        }
        return buffer.toByteArray();
    }

    private static String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (lower.endsWith(".srt")) return "application/x-subrip";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".dat.gz") || lower.endsWith(".bin") || lower.endsWith(".gz")) {
            return "application/octet-stream";
        }
        String ext = MimeTypeMap.getFileExtensionFromUrl(lower);
        if (ext != null) {
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (mime != null) return mime;
        }
        return "application/octet-stream";
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        int bit = code == KeyEvent.KEYCODE_VOLUME_UP ? 1 : code == KeyEvent.KEYCODE_VOLUME_DOWN ? 2 : 0;
        if (bit == 0) return super.dispatchKeyEvent(event);
        // A consumed DOWN always consumes its matching UP, even if a sheet or backgrounding disabled capture.
        if (event.getAction() == KeyEvent.ACTION_UP && (readerVolumeKeysHeld & bit) != 0) {
            readerVolumeKeysHeld &= ~bit;
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            if ((readerVolumeKeysHeld & bit) != 0 && event.getRepeatCount() > 0) return true;
            // A new physical press clears a stale DOWN if its UP was delivered while unfocused.
            readerVolumeKeysHeld &= ~bit;
            if (readerVolumeKeysEnabled && hasWindowFocus() && webView != null && event.getRepeatCount() == 0) {
                readerVolumeKeysHeld |= bit;
                String direction = code == KeyEvent.KEYCODE_VOLUME_UP ? "previous" : "next";
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('uku-reader-page-turn',{detail:{direction:'"
                        + direction + "'}}));", null);
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) readerVolumeKeysEnabled = false;
        if (webView != null) webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('uku-reader-native-focus',{detail:{active:"
                        + (hasFocus ? "true" : "false") + "}}));", null);
    }

    @Override
    protected void onPause() {
        readerVolumeKeysEnabled = false;
        if (webView != null) webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('uku-reader-native-focus',{detail:{active:false}}));", null);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        readerVolumeKeysEnabled = false;
        if (pixivAccount != null) pixivAccount.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                }
                if (results == null && data.getDataString() != null) {
                    results = new Uri[]{Uri.parse(data.getDataString())};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // Let the page decide first: close the open sheet, or step up one screen (reader -> library -> workbench).
        // Only when it reports nothing left to go back to does the key fall through and leave the app.
        webView.evaluateJavascript(
                "(function(){try{return !!(window.__ukuBack&&window.__ukuBack());}catch(e){return false;}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        MainActivity.super.onBackPressed();
                    }
                });
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        pushSystemTheme();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    private void recordHistoricalExitReasons() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                if (am == null) return;
                List<ApplicationExitInfo> reasons = am.getHistoricalProcessExitReasons(getPackageName(), 0, 5);
                if (reasons == null || reasons.isEmpty()) return;

                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                long lastTs = prefs.getLong(PREF_LAST_EXIT_TS, 0L);
                long maxTs = lastTs;

                for (int i = reasons.size() - 1; i >= 0; i--) {
                    ApplicationExitInfo info = reasons.get(i);
                    if (info == null) continue;
                    long ts = info.getTimestamp();
                    if (ts <= lastTs) continue;
                    if (ts > maxTs) maxTs = ts;

                    String reasonName = exitReasonToString(info.getReason());
                    String desc = info.getDescription();
                    if (desc == null) {
                        desc = "";
                    } else {
                        desc = desc.replace('\r', ' ').replace('\n', ' ').trim();
                    }
                    String entry = "exit reason=" + reasonName
                            + " status=" + info.getStatus()
                            + " importance=" + info.getImportance()
                            + " description=" + desc;
                    appendNativeLog(this, ts > 0 ? ts : System.currentTimeMillis(), entry);
                }

                if (maxTs > lastTs) {
                    prefs.edit().putLong(PREF_LAST_EXIT_TS, maxTs).apply();
                }
            } catch (Throwable ignored) {
            }
        }
    }

    private static String exitReasonToString(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_UNKNOWN:
                return "REASON_UNKNOWN";
            case ApplicationExitInfo.REASON_EXIT_SELF:
                return "REASON_EXIT_SELF";
            case ApplicationExitInfo.REASON_SIGNALED:
                return "REASON_SIGNALED";
            case ApplicationExitInfo.REASON_LOW_MEMORY:
                return "REASON_LOW_MEMORY";
            case ApplicationExitInfo.REASON_CRASH:
                return "REASON_CRASH";
            case ApplicationExitInfo.REASON_CRASH_NATIVE:
                return "REASON_CRASH_NATIVE";
            case ApplicationExitInfo.REASON_ANR:
                return "REASON_ANR";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE:
                return "REASON_INITIALIZATION_FAILURE";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE:
                return "REASON_PERMISSION_CHANGE";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE:
                return "REASON_EXCESSIVE_RESOURCE_USAGE";
            case ApplicationExitInfo.REASON_USER_REQUESTED:
                return "REASON_USER_REQUESTED";
            case ApplicationExitInfo.REASON_USER_STOPPED:
                return "REASON_USER_STOPPED";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED:
                return "REASON_DEPENDENCY_DIED";
            case ApplicationExitInfo.REASON_OTHER:
                return "REASON_OTHER";
            case ApplicationExitInfo.REASON_FREEZER:
                return "REASON_FREEZER";
            default:
                return "REASON_" + reason;
        }
    }

    public static void appendNativeLog(Context context, String message) {
        appendNativeLog(context, System.currentTimeMillis(), message);
    }

    public static void appendNativeLog(Context context, long timestampMs, String message) {
        if (context == null || message == null) return;
        synchronized (LOG_LOCK) {
            try {
                File logFile = new File(context.getFilesDir(), NATIVE_LOG_FILE);
                String safeMsg = message.replace('\r', ' ').replace('\n', ' ');
                String line = formatIsoTimestamp(timestampMs) + " " + safeMsg + "\n";
                byte[] lineBytes = line.getBytes(StandardCharsets.UTF_8);

                try (FileOutputStream fos = new FileOutputStream(logFile, true)) {
                    fos.write(lineBytes);
                    fos.flush();
                }

                if (logFile.length() > NATIVE_LOG_MAX_BYTES) {
                    byte[] tail = readTailBytes(logFile, NATIVE_LOG_TRIM_BYTES);
                    try (FileOutputStream fos = new FileOutputStream(logFile, false)) {
                        fos.write(tail);
                        fos.flush();
                    }
                }
            } catch (Throwable ignored) {
            }
        }
    }

    public static String readNativeLog(Context context) {
        if (context == null) return "";
        synchronized (LOG_LOCK) {
            try {
                File logFile = new File(context.getFilesDir(), NATIVE_LOG_FILE);
                if (!logFile.isFile()) return "";
                byte[] bytes = readTailBytes(logFile, NATIVE_LOG_MAX_BYTES);
                return new String(bytes, StandardCharsets.UTF_8);
            } catch (Throwable ignored) {
                return "";
            }
        }
    }

    private static byte[] readTailBytes(File file, int maxBytes) throws IOException {
        if (file == null || !file.isFile() || maxBytes <= 0) {
            return new byte[0];
        }
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            long len = raf.length();
            if (len <= 0) {
                return new byte[0];
            }
            int toRead = (int) Math.min(len, (long) maxBytes);
            raf.seek(len - toRead);
            byte[] buf = new byte[toRead];
            raf.readFully(buf);
            return buf;
        }
    }

    private static String formatIsoTimestamp(long timestampMs) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(timestampMs));
    }

    private static String formatErrorJson(String message) {
        String safe = (message != null ? message : "error").replace("\\", "\\\\").replace("\"", "'");
        return "{\"success\":false,\"error\":\"" + safe + "\"}";
    }
}
