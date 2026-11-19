package io.github.cj42izzle.luma;

import android.app.Activity;
import android.app.AlertDialog;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.List;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

/** Lightweight TV-remote-friendly playback controls built on the device's decoder.
 * No claim is made that a media file contains Dolby tracks just because a codec is supported.
 */
public final class NativePlayerOptions {
    private NativePlayerOptions(){}

    public static void show(Activity activity, ExoPlayer player, PlayerView playerView){
        if(player==null)return;
        String[] menu={"Audio track","Subtitle track","Playback speed","Picture aspect / zoom",
                "Restart","Repeat","Stream details"};
        new AlertDialog.Builder(activity).setTitle("Luma · Playback options")
          .setItems(menu,(dialog,index)->{
              switch(index){
                  case 0:selectTracks(activity,player,C.TRACK_TYPE_AUDIO);break;
                  case 1:selectTracks(activity,player,C.TRACK_TYPE_TEXT);break;
                  case 2:selectSpeed(activity,player);break;
                  case 3:selectPicture(activity,playerView);break;
                  case 4:if(player.isCommandAvailable(Player.COMMAND_SEEK_TO_DEFAULT_POSITION))
                      player.seekToDefaultPosition();break;
                  case 5:selectRepeat(activity,player);break;
                  case 6:showInfo(activity,player);break;
                  default:break;
              }
          }).setNegativeButton("Close",null).show();
    }

    private static void selectTracks(Activity activity,ExoPlayer player,int type){
        final List<String> names=new ArrayList<>();
        final List<TrackSelectionOverride> selections=new ArrayList<>();
        final boolean subtitles=type==C.TRACK_TYPE_TEXT;
        names.add(subtitles?"Subtitles off":"Automatic / best audio");selections.add(null);
        for(Tracks.Group group:player.getCurrentTracks().getGroups()){
            if(group.getType()!=type)continue;
            for(int index=0;index<group.length;index++){
                if(!group.isTrackSupported(index))continue;
                Format item=group.getTrackFormat(index);
                String label=item.label!=null&&!item.label.isEmpty()?item.label
                        :item.language!=null&&!item.language.isEmpty()?item.language
                        :"Track "+(index+1);
                String codec=item.sampleMimeType!=null?item.sampleMimeType:"";
                names.add((group.isTrackSelected(index)?"✓ ":"")+label+
                        (codec.isEmpty()?"":" · "+codec));
                selections.add(new TrackSelectionOverride(group.getMediaTrackGroup(),index));
            }
        }
        if(names.size()==1&&!subtitles){
            Toast.makeText(activity,"No alternate audio tracks in this source",Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(activity)
         .setTitle(subtitles?"Subtitles":"Audio")
         .setItems(names.toArray(new String[0]),(d,which)->{
             TrackSelectionParameters.Builder p=player.getTrackSelectionParameters().buildUpon();
             p.clearOverridesOfType(type);
             if(which==0){p.setTrackTypeDisabled(type,subtitles);}
             else{p.setTrackTypeDisabled(type,false);p.setOverrideForType(selections.get(which));}
             player.setTrackSelectionParameters(p.build());
         }).setNegativeButton("Cancel",null).show();
    }

    private static void selectSpeed(Activity activity,ExoPlayer player){
        final float[] rates={0.5f,0.75f,1f,1.25f,1.5f,1.75f,2f};
        String[] labels={"0.5×","0.75×","1× normal","1.25×","1.5×","1.75×","2×"};
        new AlertDialog.Builder(activity).setTitle("Playback speed")
         .setItems(labels,(d,i)->player.setPlaybackSpeed(rates[i]))
         .setNegativeButton("Cancel",null).show();
    }

    private static void selectPicture(Activity activity,PlayerView view){
        final int[] modes={AspectRatioFrameLayout.RESIZE_MODE_FIT,
                AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
                AspectRatioFrameLayout.RESIZE_MODE_FILL};
        new AlertDialog.Builder(activity).setTitle("Picture display")
         .setItems(new String[]{"Fit · preserve picture","Zoom · crop edges","Stretch · fill screen"},
                   (d,i)->view.setResizeMode(modes[i]))
         .setNegativeButton("Cancel",null).show();
    }

    private static void selectRepeat(Activity activity,ExoPlayer player){
        new AlertDialog.Builder(activity).setTitle("Repeat playback")
         .setItems(new String[]{"Off","Repeat current video"},(d,i)->
             player.setRepeatMode(i==1?Player.REPEAT_MODE_ONE:Player.REPEAT_MODE_OFF))
         .setNegativeButton("Cancel",null).show();
    }

    private static void showInfo(Activity activity,ExoPlayer player){
        Format video=player.getVideoFormat(),audio=player.getAudioFormat();
        StringBuilder info=new StringBuilder();
        if(video!=null){
            info.append("Video: ").append(video.width).append(" × ").append(video.height)
                .append(" · ").append(video.sampleMimeType).append("\n");
        }else info.append("Video format not available\n");
        if(audio!=null)info.append("Audio: ").append(audio.sampleMimeType)
                    .append(audio.channelCount>0?" · "+audio.channelCount+" channels":"")
                    .append("\n");
        else info.append("Audio format not available\n");
        info.append("Supported decoding and output depend on this device, receiver and source.");
        new AlertDialog.Builder(activity).setTitle("Stream details")
         .setMessage(info.toString()).setPositiveButton("Done",null).show();
    }
}
