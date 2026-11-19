package io.github.cj42izzle.luma;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ContentResolver;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.util.UUID;
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
    private static final int DVR_FOLDER_PICKER = 7054;
    private final String dvrToken = UUID.randomUUID().toString() + UUID.randomUUID().toString();
    private volatile boolean trustedPage = false;
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
        browser.addJavascriptInterface(new DeviceDvrBridge(this, dvrToken), "LumaNativeDVR");
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
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                trustedPage = false;
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                trustedPage = trusted(Uri.parse(url));
                if (trustedPage) {
                    view.evaluateJavascript("window.LumaDvrToken=" + JSONObject.quote(dvrToken)
                            + ";window.dispatchEvent(new Event('luma-native-dvr-ready'));", null);
                }
            }
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

    boolean isTrustedPage() { return trustedPage; }

    private boolean trusted(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && "cj42izzle.github.io".equalsIgnoreCase(uri.getHost())
                && uri.getPath() != null
                && uri.getPath().startsWith("/Luma-Media-Center/");
    }

    private boolean route(Uri uri) {
        if (trusted(uri)) return true;
        openExternal(uri);
        return false;
    }

    void launchDvrFolderPicker() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(intent, DVR_FOLDER_PICKER);
        } catch (ActivityNotFoundException ex) {
            Toast.makeText(this, "No file/folder picker installed on this Android TV",
                    Toast.LENGTH_LONG).show();
        }
    }

    void openRecordedFile(Uri uri) {
        try {
            Intent playback = new Intent(Intent.ACTION_VIEW);
            String mime = getContentResolver().getType(uri);
            playback.setDataAndType(uri, mime == null ? "video/mp2t" : mime);
            playback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(playback);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Install a compatible TS player or use Files",
                    Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != DVR_FOLDER_PICKER || resultCode != RESULT_OK || data == null) return;
        Uri selected = data.getData();
        if (selected == null) return;
        try {
            getContentResolver().takePersistableUriPermission(selected,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            DeviceDvrStore.setFolder(this, selected);
            Toast.makeText(this, "Luma device DVR folder saved", Toast.LENGTH_SHORT).show();
            if (browser != null && trustedPage) {
                browser.evaluateJavascript("window.dispatchEvent(new Event('luma-native-dvr-storage'));", null);
            }
        } catch (SecurityException err) {
            Toast.makeText(this, "Folder permission was not granted", Toast.LENGTH_LONG).show();
        }
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
