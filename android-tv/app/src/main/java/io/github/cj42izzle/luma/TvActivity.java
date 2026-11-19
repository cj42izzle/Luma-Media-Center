package io.github.cj42izzle.luma;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * Sideloadable Android TV preview of the public Luma website. No credentials
 * are bundled in the APK. Catalog data and user settings live in WebView.
 */
public class TvActivity extends Activity {
    private static final String URL = "https://cj42izzle.github.io/Luma-Media-Center/?tv=1";
    private FrameLayout root;
    private WebView browser;
    private View fullscreenVideo;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(8, 9, 17));
        setContentView(root);
        enterImmersive();

        browser = new WebView(this);
        browser.setBackgroundColor(Color.rgb(8, 9, 17));
        browser.setFocusable(true);
        browser.setFocusableInTouchMode(true);
        root.addView(browser, new FrameLayout.LayoutParams(-1, -1));

        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);

        browser.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return !route(request.getUrl());
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog,
                                          boolean isUserGesture, android.os.Message resultMsg) {
                if (!isUserGesture) return false;
                WebView popup = new WebView(TvActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        openExternal(request.getUrl());
                        view.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenVideo != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenVideo = view;
                fullscreenCallback = callback;
                browser.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                enterImmersive();
            }

            @Override
            public void onHideCustomView() {
                if (fullscreenVideo == null) return;
                root.removeView(fullscreenVideo);
                fullscreenVideo = null;
                browser.setVisibility(View.VISIBLE);
                if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
                fullscreenCallback = null;
                enterImmersive();
            }
        });

        if (state != null) browser.restoreState(state);
        else browser.loadUrl(URL);
        browser.requestFocus();
    }

    private boolean route(Uri uri) {
        if (uri == null) return false;
        if ("https".equalsIgnoreCase(uri.getScheme())
                && "cj42izzle.github.io".equalsIgnoreCase(uri.getHost())
                && uri.getPath() != null
                && uri.getPath().startsWith("/Luma-Media-Center/")) return true;
        openExternal(uri);
        return false;
    }

    private void openExternal(Uri uri) {
        if (uri == null) return;
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("https")
                || scheme.equalsIgnoreCase("http")
                || scheme.equalsIgnoreCase("magnet")
                || scheme.equalsIgnoreCase("stremio")
                || scheme.equalsIgnoreCase("vlc"))) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No compatible app installed for this link", Toast.LENGTH_LONG).show();
        }
    }

    private void enterImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onBackPressed() {
        if (fullscreenVideo != null) {
            browser.getWebChromeClient().onHideCustomView();
            return;
        }
        browser.evaluateJavascript("(function(){var close=document.getElementById('closeModal');if(close){close.click();return 'closed'}return 'none'})()", result -> {
            if (result != null && result.contains("closed")) return;
            if (browser.canGoBack()) browser.goBack();
            else TvActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        browser.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onDestroy() {
        if (fullscreenVideo != null) browser.getWebChromeClient().onHideCustomView();
        if (browser != null) {
            root.removeView(browser);
            browser.stopLoading();
            browser.destroy();
        }
        super.onDestroy();
    }
}
