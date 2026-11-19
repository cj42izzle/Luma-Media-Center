package io.github.cj42izzle.luma;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.res.Configuration;
import android.content.Context;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ContentResolver;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.util.UUID;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
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
    private static final String URL = "https://cj42izzle.github.io/Luma-Media-Center/";
    private static final int DVR_FOLDER_PICKER = 7054;
    private static final int LOCAL_VIDEO_PICKER = 7055;
    private static final int NATIVE_VIDEO_PICKER = 7056;
    private ValueCallback<Uri[]> pendingFileChooser;
    private final String dvrToken = UUID.randomUUID().toString() + UUID.randomUUID().toString();
    private volatile boolean trustedPage = false;
    private boolean televisionMode = false;
    private static final String NATIVE_IPTV_JS =
        "(function(){var pending=new Map();" +
        "function expire(id){var item=pending.get(id);if(!item)return;" +
        "pending.delete(id);item.reject(new Error('IPTV request timed out'));}" +
        "window.LumaNativeIPTV={fetchText:function(url,limit){return new Promise(function(resolve,reject){" +
        "var id=Date.now().toString(36)+Math.random().toString(36).slice(2);" +
        "var item={resolve:resolve,reject:reject,parts:[],timeout:null};" +
        "item.timeout=setTimeout(function(){expire(id);},180000);pending.set(id,item);" +
        "window.LumaNativeIPTVBridge.fetchText(window.LumaDvrToken,id,String(url),Number(limit)||1024*1024);" +
        "});},_receive:function(data){var item=pending.get(data.id);if(!item)return false;" +
        "clearTimeout(item.timeout);pending.delete(data.id);" +
        "if(data.error)item.reject(new Error(data.error));else item.resolve(String(data.text||''));return true;}," +
        "_receiveChunk:function(id,chunk,last){var item=pending.get(id);if(!item)return false;" +
        "item.parts.push(String(chunk||''));clearTimeout(item.timeout);" +
        "if(last){pending.delete(id);item.resolve(item.parts.join(''));return true;}" +
        "item.timeout=setTimeout(function(){expire(id);},180000);return true;}};" +
        "})();";
    private FrameLayout root;
    private WebView browser;
    private WebChromeClient chromeClient;
    private NativeIPTVBridge iptvReader;
    private NativeUpdateManager updateManager;
    private View fullscreenVideo;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        UiModeManager modes=(UiModeManager)getSystemService(Context.UI_MODE_SERVICE);
        televisionMode=modes!=null&&modes.getCurrentModeType()==Configuration.UI_MODE_TYPE_TELEVISION;
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
        browser.addJavascriptInterface(new NativePlayerBridge(this, dvrToken), "LumaNativePlayer");
        iptvReader = new NativeIPTVBridge(this, dvrToken);
        browser.addJavascriptInterface(iptvReader, "LumaNativeIPTVBridge");
        updateManager = new NativeUpdateManager(this, dvrToken);
        browser.addJavascriptInterface(updateManager, "LumaNativeUpdates");
        settings.setDomStorageEnabled(true);
        // The APK is a native shell. Fetch the latest published Luma HTML and
        // assets each launch, without clearing the user's saved IPTV accounts.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        // File chooser grants access only to a video explicitly chosen by the user.
        settings.setAllowContentAccess(true);
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
                            + ";window.LumaNativePlatform='android-tv';" + NATIVE_IPTV_JS +
                            "document.documentElement.dataset.lumaNative='android-tv';" +
                            "var badge=document.getElementById('lumaAndroidBadge');if(badge)badge.hidden=false;" +
                            "var refresh=document.getElementById('lumaAndroidRefresh');" +
                            "if(refresh){refresh.hidden=false;refresh.onclick=function(){location.reload();};}" +
                            "var update=document.getElementById('lumaAndroidUpdate');" +
                            "if(update){update.hidden=false;update.onclick=function(){window.LumaNativeUpdates.check(window.LumaDvrToken);};}" +
                            "window.dispatchEvent(new Event('luma-native-iptv-ready'));" +
                            "window.dispatchEvent(new Event('luma-native-dvr-ready'));", null);
                }
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return !route(request.getUrl());
            }
        });
        chromeClient = new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             WebChromeClient.FileChooserParams params) {
                if (!trustedPage) return false;
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = callback;
                try {
                    Intent picker = params.createIntent();
                    startActivityForResult(picker, LOCAL_VIDEO_PICKER);
                    return true;
                } catch (ActivityNotFoundException error) {
                    pendingFileChooser.onReceiveValue(null);
                    pendingFileChooser = null;
                    Toast.makeText(TvActivity.this, "No file picker is installed", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
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
        };
        browser.setWebChromeClient(chromeClient);

        if (state != null) browser.restoreState(state);
        else browser.loadUrl(URL+"?tv=1&app=android&fresh="+System.currentTimeMillis());
        browser.requestFocus();
    }

    boolean isTrustedPage() { return trustedPage; }

    void deliverIPTVResponse(String response){
        runOnUiThread(()->{
            if(trustedPage&&browser!=null)
                browser.evaluateJavascript("window.LumaNativeIPTV?._receive("+response+");",null);
        });
    }

    // Sending a large XMLTV guide in one evaluateJavascript call can exceed the
    // WebView message budget. Transfer bounded chunks, awaiting each JS acknowledgement.
    // This also stops transferring when the user navigates away or a request expires.
    void deliverIPTVText(String id, String content){
        if(id==null||content==null)return;
        runOnUiThread(()->deliverIPTVChunk(id,content,0));
    }

    private void deliverIPTVChunk(String id,String content,int offset){
        if(!trustedPage||browser==null)return;
        int next=Math.min(content.length(),offset+48*1024);
        if(next<content.length()&&next>offset&&Character.isHighSurrogate(content.charAt(next-1)))
            next--;
        final int end=next;
        String js="window.LumaNativeIPTV&&window.LumaNativeIPTV._receiveChunk("
                +JSONObject.quote(id)+","+JSONObject.quote(content.substring(offset,end))
                +","+(end==content.length())+");";
        browser.evaluateJavascript(js,answer->{
            if("true".equals(answer)&&end<content.length())
                deliverIPTVChunk(id,content,end);
        });
    }

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

    void openDvrAlarmSettings() {
        if (Build.VERSION.SDK_INT < 31) return;
        Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
        intent.setData(Uri.parse("package:" + getPackageName()));
        try { startActivity(intent); }
        catch (ActivityNotFoundException ignored) { openDvrAppSettings(); }
    }

    void openDvrPowerSettings() {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        try { startActivity(intent); }
        catch (ActivityNotFoundException ignored) { openDvrAppSettings(); }
    }

    private void openDvrAppSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName())));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Power settings are not available on this TV",
                    Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Re-arm only pending alarms after the user changes permissions.
        DeviceDvrStore.reschedulePending(this);
        if (browser != null && trustedPage) {
            browser.evaluateJavascript("window.dispatchEvent(new Event('luma-native-dvr-power'));", null);
        }
        if (updateManager != null) updateManager.onResume();
    }

    void launchNativeMediaPicker(){
        try{
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*"); // Includes MKV, M2TS and TS files without standard video MIME on some devices.
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(intent,NATIVE_VIDEO_PICKER);
        }catch(ActivityNotFoundException err){
            Toast.makeText(this,"No device file picker is installed",Toast.LENGTH_LONG).show();
        }
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
        if(uri==null||!"content".equalsIgnoreCase(uri.getScheme()))return;
        try {
            Intent playback=new Intent(this,NativePlayerActivity.class);
            playback.putExtra(NativePlayerActivity.EXTRA_URL,uri.toString());
            playback.putExtra(NativePlayerActivity.EXTRA_TITLE,"Luma recording");
            playback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(playback);
        } catch (RuntimeException e) {
            Toast.makeText(this,"Could not open the recording in Luma",
                    Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if(requestCode==NATIVE_VIDEO_PICKER){
            if(resultCode==RESULT_OK&&data!=null&&data.getData()!=null){
                Uri uri=data.getData();
                try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}
                catch(SecurityException ignored){}
                Intent player=new Intent(this,NativePlayerActivity.class);
                player.putExtra(NativePlayerActivity.EXTRA_URL,uri.toString());
                player.putExtra(NativePlayerActivity.EXTRA_TITLE,"On-device video");
                startActivity(player);
            }
            return;
        }
        if(requestCode==LOCAL_VIDEO_PICKER){
            if(pendingFileChooser!=null){
                pendingFileChooser.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pendingFileChooser=null;
            }
            return;
        }
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
        if(!televisionMode)return; // Preserve normal status/nav bars on handheld Android.
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
            chromeClient.onHideCustomView();
            return;
        }
        browser.evaluateJavascript("(function(){" +
                "var player=document.querySelector('.lumaPlayerPortal[role=dialog]');" +
                "if(player&&player.getClientRects().length){var p=document.getElementById('lumaPlayerClose');if(p){p.click();return 'closed';}}" +
                "var modal=document.querySelector('#modal [role=dialog]');" +
                "if(modal&&modal.getClientRects().length){var m=document.getElementById('closeModal');if(m){m.click();return 'closed';}}" +
                "if(document.body.classList.contains('nav-open')){var n=document.getElementById('sidebarDismiss');if(n){n.click();return 'closed';}}" +
                "return 'none';})()", result -> {
            if ("\"closed\"".equals(result)) return;
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
        if(pendingFileChooser!=null){pendingFileChooser.onReceiveValue(null);pendingFileChooser=null;}
        if (fullscreenVideo != null) chromeClient.onHideCustomView();
        trustedPage = false;
        if (iptvReader != null) { iptvReader.shutdown(); iptvReader = null; }
        if (updateManager != null) { updateManager.shutdown(); updateManager = null; }
        if (browser != null) {
            root.removeView(browser);
            browser.stopLoading();
            browser.destroy();
            browser = null;
        }
        super.onDestroy();
    }
}
