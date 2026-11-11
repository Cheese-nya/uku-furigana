package com.cheese.uku;

import android.app.Activity;
import android.app.Dialog;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/** The remote login WebView has no AndroidBridge or other application JS interface. */
final class PixivAccount {
    private final Activity activity;
    private final Runnable changed;
    private Dialog dialog;
    private WebView loginView;
    private volatile boolean clearing;
    static final String ORIGIN = "https://www.pixiv.net/";
    static final String LOGIN_URL = "https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F";

    PixivAccount(Activity activity, Runnable changed) {
        this.activity = activity;
        this.changed = changed;
        CookieManager.getInstance().setAcceptCookie(true);
    }

    String cookieHeader() {
        return clearing ? "" : CookieManager.getInstance().getCookie(ORIGIN);
    }

    String statusJson() {
        boolean saved = false;
        String cookies = cookieHeader();
        if (cookies != null) for (String entry : cookies.split(";")) {
            if (entry.trim().matches("PHPSESSID=[1-9][0-9]*_[^;\\s]+")) saved = true;
        }
        return "{\"supported\":true,\"loggedIn\":" + saved + "}";
    }

    void login() {
        activity.runOnUiThread(() -> {
            if (dialog != null) return;
            dialog = new Dialog(activity, android.R.style.Theme_Material_Light_NoActionBar);
            LinearLayout content = new LinearLayout(activity);
            content.setOrientation(LinearLayout.VERTICAL);
            Button done = new Button(activity);
            done.setText("完成 / Done");
            done.setContentDescription("关闭 Pixiv 登录窗口 / Close Pixiv login");
            done.setOnClickListener(view -> dialog.dismiss());
            content.addView(done, new LinearLayout.LayoutParams(-1, -2));
            loginView = new WebView(activity);
            WebSettings settings = loginView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            // Recaptcha and Pixiv's own login resources may use third-party frames.
            CookieManager.getInstance().setAcceptThirdPartyCookies(loginView, true);
            loginView.setWebChromeClient(new WebChromeClient());
            loginView.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if (!"https".equalsIgnoreCase(uri.getScheme())) return true;
                    if (!request.isForMainFrame()) return false;
                    String host = uri.getHost();
                    return host == null || !(host.equals("pixiv.net") || host.endsWith(".pixiv.net"));
                }
                @Override public void onPageFinished(WebView view, String url) {
                    CookieManager.getInstance().flush();
                    changed.run();
                }
            });
            content.addView(loginView, new LinearLayout.LayoutParams(-1, 0, 1));
            dialog.setContentView(content);
            dialog.setOnDismissListener(ignored -> {
                CookieManager.getInstance().flush();
                loginView.stopLoading();
                loginView.destroy();
                loginView = null;
                dialog = null;
                changed.run();
            });
            dialog.show();
            if (dialog.getWindow() != null) dialog.getWindow().setLayout(-1, -1);
            loginView.loadUrl(LOGIN_URL);
        });
    }

    void logout() {
        clearing = true;
        activity.runOnUiThread(() -> {
            if (dialog != null) dialog.dismiss();
            CookieManager manager = CookieManager.getInstance();
            List<String[]> expirations = new ArrayList<>();
            for (String host : new String[]{"pixiv.net", "www.pixiv.net", "accounts.pixiv.net"}) {
                String cookies = manager.getCookie("https://" + host + "/");
                if (cookies == null) continue;
                for (String entry : cookies.split(";")) {
                    String name = entry.trim().split("=", 2)[0];
                    if (name.isEmpty()) continue;
                    String expired = name + "=; Path=/; Max-Age=0; Secure";
                    expirations.add(new String[]{host, expired});
                    expirations.add(new String[]{host, expired + "; Domain=" + host});
                    expirations.add(new String[]{host, expired + "; Domain=.pixiv.net"});
                }
            }
            AtomicInteger pending = new AtomicInteger(expirations.size());
            Runnable finish = () -> {
                manager.flush();
                clearing = false;
                changed.run();
            };
            if (expirations.isEmpty()) { finish.run(); return; }
            for (String[] expiration : expirations) {
                manager.setCookie("https://" + expiration[0] + "/", expiration[1], ignored -> {
                    if (pending.decrementAndGet() == 0) finish.run();
                });
            }
        });
    }

    void destroy() { if (dialog != null) dialog.dismiss(); }
}
