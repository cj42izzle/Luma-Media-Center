package io.github.cj42izzle.luma;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
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
    private ExoPlayer player;
    private TextView trackLabel;

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
        frame.addView(trackLabel,labelParams);
        setContentView(frame);

        DefaultRenderersFactory renderers=new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true);
        player=new ExoPlayer.Builder(this).setRenderersFactory(renderers).build();
        playerView.setPlayer(player);
        player.addListener(new Player.Listener(){
            @Override public void onPlayerError(PlaybackException error){
                trackLabel.setText("Cannot decode or reach this stream on this TV");
                Toast.makeText(NativePlayerActivity.this,
                        "Luma cannot play this stream. Check the stream and device codec support.",
                        Toast.LENGTH_LONG).show();
            }
            @Override public void onTracksChanged(Tracks tracks){updateCodecInfo(title);}
        });
        MediaItem.Builder media=new MediaItem.Builder().setUri(uri);
        String path=uri.getPath()==null?"":uri.getPath().toLowerCase();
        if(path.endsWith(".m3u8") || url.contains("output=m3u8")){
            media.setMimeType(MimeTypes.APPLICATION_M3U8);
        }
        player.setMediaItem(media.build());
        player.prepare();
        player.play();
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
        final String caption=(title==null||title.isBlank()?"Luma TV":title)+" · "+video+" · "+audio;
        runOnUiThread(()->trackLabel.setText(caption));
    }

    @Override protected void onStop(){
        if(player!=null)player.pause();
        super.onStop();
    }
    @Override protected void onDestroy(){
        if(player!=null){player.release();player=null;}
        super.onDestroy();
    }
}
