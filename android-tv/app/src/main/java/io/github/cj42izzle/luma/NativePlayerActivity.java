package io.github.cj42izzle.luma;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.HashSet;
import java.util.Set;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/** Media3 player on the device itself — native SurfaceView/HDR and audio
 *  passthrough when supported by hardware, selected stream and AV receiver.
 *  No app-side software "Dolby decoder" or re-encoding is attempted.
 */
public final class NativePlayerActivity extends Activity {
    public static final String EXTRA_URL = "luma.stream.url";
    public static final String EXTRA_TITLE = "luma.stream.title";
    public static final String EXTRA_QUEUE = "luma.stream.queue";
    public static final String EXTRA_INDEX = "luma.stream.index";
    public static final String EXTRA_SKIP = "luma.stream.skip";
    private ExoPlayer player;
    private TextView trackLabel;
    private Button skipControl;
    private JSONObject skipPlan;
    private String currentSkip = "";
    private final Set<String> appliedSkips = new HashSet<>();
    private final Handler skipHandler = new Handler(Looper.getMainLooper());
    private final Runnable skipTicker = new Runnable() {
        @Override public void run() {
            refreshSkipControl();
            skipHandler.postDelayed(this, 800);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        String url = getIntent().getStringExtra(EXTRA_URL);
        Uri uri;
        try { uri = Uri.parse(url == null ? "" : url); }
        catch (Exception ignored) { finish(); return; }
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https")
                || scheme.equalsIgnoreCase("content"))
                || ("content".equalsIgnoreCase(scheme)?uri.getAuthority()==null:uri.getHost()==null)) {
            finish(); return;
        }

        String skips = getIntent().getStringExtra(EXTRA_SKIP);
        if (skips != null && skips.length() <= 2500 && !skips.isEmpty()) {
            try { skipPlan = new JSONObject(skips); } catch (Exception ignored) { skipPlan = null; }
        }
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.BLACK);
        PlayerView playerView = new PlayerView(this);
        playerView.setUseController(true);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
        playerView.setKeepContentOnPlayerReset(false);
        frame.addView(playerView,new FrameLayout.LayoutParams(-1,-1));

        trackLabel = new TextView(this);
        trackLabel.setTextColor(Color.WHITE);
        trackLabel.setBackgroundColor(0x9A07101F);
        trackLabel.setTextSize(13);
        trackLabel.setPadding(14,8,14,8);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        trackLabel.setText((title == null || title.isBlank() ? "Luma TV" : title) + " · Native playback");
        FrameLayout.LayoutParams labelParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        labelParams.topMargin=12;
        trackLabel.setMaxWidth(Math.max(180,getResources().getDisplayMetrics().widthPixels-220));
        frame.addView(trackLabel,labelParams);
        Button options=new Button(this);
        options.setText("⚙ Options");
        options.setTextSize(12);
        options.setTextColor(Color.WHITE);
        options.setBackgroundColor(0xB52B4562);
        FrameLayout.LayoutParams optionsLayout=new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.RIGHT);
        optionsLayout.topMargin=8;
        optionsLayout.rightMargin=12;
        frame.addView(options,optionsLayout);
        skipControl = new Button(this);
        skipControl.setTextColor(Color.WHITE);
        skipControl.setTextSize(13);
        skipControl.setBackgroundColor(0xD33D365D);
        skipControl.setVisibility(View.GONE);
        FrameLayout.LayoutParams skipLayout = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.RIGHT);
        skipLayout.bottomMargin = 95;
        skipLayout.rightMargin = 15;
        frame.addView(skipControl, skipLayout);
        skipControl.setOnClickListener(v -> performSkip(currentSkip));
        setContentView(frame);

        DefaultRenderersFactory renderers=new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true);
        player=new ExoPlayer.Builder(this).setRenderersFactory(renderers).build();
        playerView.setPlayer(player);
        options.setOnClickListener(v->NativePlayerOptions.show(this,player,playerView));
        player.addListener(new Player.Listener(){
            @Override public void onPlayerError(PlaybackException error){
                trackLabel.setText("Cannot decode or reach this stream on this TV");
                Toast.makeText(NativePlayerActivity.this,
                        "Luma cannot play this stream. Check the stream and device codec support.",
                        Toast.LENGTH_LONG).show();
            }
            @Override public void onTracksChanged(Tracks tracks){updateCodecInfo(title);}
            @Override public void onMediaItemTransition(MediaItem item,int reason){
                appliedSkips.clear();
                updateCodecInfo(title);
            }
        });
        MediaItem.Builder media=new MediaItem.Builder().setUri(uri);
        String path=uri.getPath()==null?"":uri.getPath().toLowerCase();
        if(path.endsWith(".m3u8") || url.contains("output=m3u8")){
            media.setMimeType(MimeTypes.APPLICATION_M3U8);
        }
        List<MediaItem> playlist = new ArrayList<>();
        String queueJson=getIntent().getStringExtra(EXTRA_QUEUE);
        int selectedIndex=getIntent().getIntExtra(EXTRA_INDEX,0);
        if(queueJson!=null&&queueJson.length()<=110000){
            try{
                JSONArray entries=new JSONArray(queueJson);
                if(entries.length()>1&&entries.length()<=41&&
                   selectedIndex>=0&&selectedIndex<entries.length()){
                    for(int i=0;i<entries.length();i++){
                        JSONObject entry=entries.getJSONObject(i);
                        Uri stream=Uri.parse(entry.getString("url"));
                        String type=stream.getScheme();
                        if(type==null||!(type.equalsIgnoreCase("http")||type.equalsIgnoreCase("https"))||
                           stream.getHost()==null)throw new IllegalArgumentException();
                        MediaItem.Builder next=new MediaItem.Builder().setUri(stream);
                        String name=entry.optString("title","Channel");
                        next.setMediaMetadata(new MediaMetadata.Builder()
                           .setTitle(name.substring(0,Math.min(130,name.length()))).build());
                        String streamPath=stream.getPath()==null?"":stream.getPath().toLowerCase();
                        if(streamPath.endsWith(".m3u8")||stream.toString().contains("output=m3u8"))
                            next.setMimeType(MimeTypes.APPLICATION_M3U8);
                        playlist.add(next.build());
                    }
                }
            }catch(Exception ignore){playlist.clear();}
        }
        if(playlist.size()>1){
            player.setMediaItems(playlist,selectedIndex,0L);
        }else{
            player.setMediaItem(media.setMediaMetadata(
                new MediaMetadata.Builder().setTitle(title==null?"Luma TV":title).build()).build());
        }
        player.prepare();
        player.play();
        if (skipPlan != null) skipHandler.post(skipTicker);
    }

    private void refreshSkipControl() {
        if (player == null || skipControl == null || skipPlan == null) return;
        long position = player.getCurrentPosition(), duration = player.getDuration();
        String found = "";
        for (String kind : new String[]{"recap", "intro"}) {
            JSONObject part = skipPlan.optJSONObject(kind);
            if (part == null) continue;
            double start = part.optDouble("start", -1), end = part.optDouble("end", -1);
            if (!Double.isFinite(start) || !Double.isFinite(end) || start < 0
                    || end <= start + 3 || end - start > 600 || end > 86400) continue;
            if (position >= start * 1000 && position < end * 1000 - 3000) {
                found = kind;
                break;
            }
        }
        if (found.isEmpty() && duration > 10000 && duration < 86400000) {
            double start = skipPlan.optDouble("creditsStart", -1);
            if (Double.isFinite(start) && start >= 0 && start * 1000 < duration - 5000
                    && position >= start * 1000 && position < duration - 3000)
                found = "credits";
        }
        currentSkip = found;
        skipControl.setVisibility(found.isEmpty() ? View.GONE : View.VISIBLE);
        if (!found.isEmpty()) {
            String label = found.equals("recap") ? "Skip recap" :
                    found.equals("intro") ? "Skip intro" : "Skip credits";
            skipControl.setText(label + " ››");
            if (skipPlan.optBoolean("autoSkip", false) && appliedSkips.add(found))
                performSkip(found);
        }
    }

    private void performSkip(String kind) {
        if (player == null || skipPlan == null || kind == null || kind.isEmpty()) return;
        appliedSkips.add(kind);
        long duration = player.getDuration();
        if (kind.equals("credits")) {
            if (duration > 10000 && duration < 86400000)
                player.seekTo(Math.max(0, duration - 250));
        } else {
            JSONObject part = skipPlan.optJSONObject(kind);
            if (part == null) return;
            double end = part.optDouble("end", -1);
            if (Double.isFinite(end) && end > 0 && end < 86400)
                player.seekTo(Math.round(end * 1000));
        }
        skipControl.setVisibility(View.GONE);
    }

    private void updateCodecInfo(String title){
        if(player==null||trackLabel==null)return;
        Format v=player.getVideoFormat(),a=player.getAudioFormat();
        String video="Video format unknown",audio="Audio format unknown";
        if(v!=null){
            String codec=v.codecs==null?"":v.codecs.toLowerCase();
            if(MimeTypes.VIDEO_DOLBY_VISION.equals(v.sampleMimeType)||codec.contains("dvhe")||codec.contains("dvh1")){
                video="Dolby Vision track";
            }else if(codec.contains("hvc1")||codec.contains("hev1"))video="HEVC video";
            else video="Video "+String.valueOf(v.width)+"×"+v.height;
        }
        if(a!=null){
            if(MimeTypes.AUDIO_E_AC3_JOC.equals(a.sampleMimeType)) audio="Dolby Atmos track";
            else if(MimeTypes.AUDIO_E_AC3.equals(a.sampleMimeType))audio="Dolby Digital Plus track";
            else if(MimeTypes.AUDIO_AC3.equals(a.sampleMimeType))audio="Dolby Digital track";
            else audio="Audio "+String.valueOf(a.sampleMimeType);
        }
        MediaItem playing=player.getCurrentMediaItem();
        CharSequence selectedTitle=playing==null?null:playing.mediaMetadata.title;
        final String displayTitle=selectedTitle==null?(title==null?"Luma TV":title):selectedTitle.toString();
        final String caption=displayTitle+" · "+video+" · "+audio;
        runOnUiThread(()->trackLabel.setText(caption));
    }

    @Override protected void onStop(){
        if(player!=null)player.pause();
        super.onStop();
    }
    @Override protected void onDestroy(){
        skipHandler.removeCallbacks(skipTicker);
        if(player!=null){player.release();player=null;}
        super.onDestroy();
    }
}
