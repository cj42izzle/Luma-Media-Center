"use strict";
/* Luma internal player: native decoder first, HTTPS browser fallback.
   No third-party proxy, script loader, Dolby emulation or fake codec claims. */
const LumaPlayer=(()=>{
 let root=null,video=null,unsub=[],nativeStatus="",currentURL="",currentTitle="",onClose=null;
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function validURL(raw){
  try{const u=new URL(String(raw||"").trim());return /^https?:$/.test(u.protocol)&&!!u.hostname&&!u.username&&!u.password&&u.href.length<=6000?u:null}catch{return null}
 }
 function codecReport(){
  const probe=document.createElement("video"),check=t=>{try{return !!probe.canPlayType(t)}catch{return false}};
  const high=(()=>{try{return matchMedia("(dynamic-range: high)").matches}catch{return false}})();
  return {hdrDisplay:high,dolbyVision:check('video/mp4; codecs="dvh1.08.04"')||check('video/mp4; codecs="dvhe.08.04"'),
   dolbyDigital:check('audio/mp4; codecs="ac-3"'),dolbyDigitalPlus:check('audio/mp4; codecs="ec-3"'),
   nativeHls:check("application/vnd.apple.mpegurl")||check("application/x-mpegURL")};
 }
 function status(text,isError=false){const el=root?.querySelector(".lumaPlayerStatus");if(el){el.textContent=text;el.classList.toggle("isError",isError)}}
 function on(element,event,handler){element.addEventListener(event,handler);unsub.push(()=>element.removeEventListener(event,handler))}
 function close(silent=false){
  const callback=onClose;onClose=null;
  for(const fn of unsub.splice(0))fn();
  if(video){video.pause();video.removeAttribute("src");video.load();video=null}
  root?.remove();root=null;currentURL="";currentTitle="";
  if(!silent&&typeof callback==="function")callback();
 }
 function nativePlay(src,title){
  try{
   if(window.LumaNativePlayer&&typeof window.LumaNativePlayer.play==="function"&&typeof window.LumaDvrToken==="string"){
    const answer=JSON.parse(window.LumaNativePlayer.play(window.LumaDvrToken,src,title));
    if(answer.ok)return true;
    nativeStatus=String(answer.error||"The native player could not open this stream");
   }
   // A future signed iOS wrapper can implement this message handler.
   if(window.webkit?.messageHandlers?.lumaNativePlayer){
    window.webkit.messageHandlers.lumaNativePlayer.postMessage({action:"play",url:src,title});
    return true;
   }
  }catch(e){nativeStatus=String(e?.message||"Native playback unavailable")}
  return false;
 }
 function fmtTime(n){if(!Number.isFinite(n)||n<0)return "LIVE";const m=Math.floor(n/60);return m+":"+String(Math.floor(n%60)).padStart(2,"0")}
 function updateProgress(){
  const seek=root?.querySelector("#lumaPlayerSeek"),time=root?.querySelector("#lumaPlayerTime");
  if(!seek||!video)return;
  const end=Number(video.duration),pos=Number(video.currentTime)||0,finite=Number.isFinite(end)&&end>0;
  seek.disabled=!finite;seek.max=finite?String(Math.round(end)):100;
  if(finite)seek.value=String(Math.min(Math.round(pos),Math.round(end)));
  if(time)time.textContent=finite?fmtTime(pos)+" / "+fmtTime(end):"LIVE";
 }
 function tracks(){
  if(!root||!video)return;
  const audio=root.querySelector("#lumaPlayerAudio"),subs=root.querySelector("#lumaPlayerCaptions");
  if(audio){
   const list=video.audioTracks;
   if(list&&list.length>1){
    audio.innerHTML=[...list].map((t,i)=>'<option value="'+i+'">'+esc(t.label||t.language||"Audio "+(i+1))+'</option>').join("");
    audio.hidden=false;audio.value=String([...list].findIndex(t=>t.enabled)>=0?[...list].findIndex(t=>t.enabled):0);
   }else audio.hidden=true;
  }
  if(subs){
   const list=[...(video.textTracks||[])];
   if(list.length){
    subs.innerHTML='<option value="-1">Captions off</option>'+list.map((t,i)=>'<option value="'+i+'">'+esc(t.label||t.language||"Subtitles "+(i+1))+'</option>').join("");
    subs.hidden=false;subs.value=String(list.findIndex(t=>t.mode==="showing"));
   }else subs.hidden=true;
  }
 }
 function vlcLink(src){return "vlc-x-callback://x-callback-url/stream?url="+encodeURIComponent(src)}
 function open(options={}){
  const src=validURL(options.url||options.src);
  if(!src)return false;
  const title=String(options.title||"Now playing").slice(0,160),isLive=options.live!==false;
  close(true);nativeStatus="";
  if(nativePlay(src.href,title))return true;
  onClose=typeof options.onClose==="function"?options.onClose:null;
  currentURL=src.href;currentTitle=title;
  try{if(typeof closeModal==="function")closeModal()}catch{}
  root=document.createElement("section");root.className="lumaPlayerPortal";
  root.setAttribute("role","dialog");root.setAttribute("aria-modal","true");root.setAttribute("aria-label","Luma internal player");
  const httpBlocked=src.protocol==="http:"&&location.protocol==="https:";
  const capability=codecReport();
  root.innerHTML='<div class="lumaPlayerShell"><header class="lumaPlayerBar"><div><span class="lumaPlayerEyebrow">LUMA · INTERNAL PLAYER</span><h2>'+esc(title)+'</h2><p>Native video decoding · automatic HDR/audio selection on compatible devices</p></div><button class="lumaPlayerClose" type="button" id="lumaPlayerClose" aria-label="Close player">✕</button></header>'
   +'<div class="lumaPlayerScreen"><video id="lumaPlayerVideo" playsinline webkit-playsinline controls x-webkit-airplay="allow" preload="metadata"></video>'
   +'<div class="lumaPlayerPlaceholder" id="lumaPlayerPlaceholder" '+(httpBlocked?'':'hidden')+'><strong>HTTP channel needs native playback</strong><p>Safari cannot load HTTP IPTV inside an HTTPS website. The native Android TV player can open this stream; on iPhone, use a native IPTV player until Luma has a signed iOS app.</p></div></div>'
   +'<div class="lumaPlayerActions"><button type="button" class="secondary" id="lumaPlayerBack">−10s</button><button type="button" class="primary" id="lumaPlayerPlay">▶ Play / Pause</button><button type="button" class="secondary" id="lumaPlayerForward">+10s</button>'
   +'<button type="button" class="secondary" id="lumaPlayerLive" '+(isLive?'':'hidden')+'>● LIVE</button><button type="button" class="secondary" id="lumaPlayerPiP">Picture in Picture</button>'
   +'<button type="button" class="secondary" id="lumaPlayerAirPlay">AirPlay</button><button type="button" class="secondary" id="lumaPlayerFullscreen">Fullscreen</button>'
   +(httpBlocked?'<a class="lumaPlayerExternal" id="lumaPlayerVLC">Open in VLC</a>':'')
   +'</div><div class="lumaPlayerSeeking"><span id="lumaPlayerTime">'+(isLive?'LIVE':'0:00')+'</span><input id="lumaPlayerSeek" type="range" min="0" max="100" value="0" aria-label="Playback position" disabled></div>'
   +'<div class="lumaPlayerTracks"><label>Audio<select id="lumaPlayerAudio" hidden></select></label><label>Subtitles<select id="lumaPlayerCaptions" hidden></select></label></div>'
   +'<p class="lumaPlayerStatus" role="status">'+(httpBlocked?"HTTP is blocked in this browser. Open in VLC or use a native Luma player.":"Preparing media…")+'</p>'
   +'<div class="lumaPlayerCapability"><span>HDR display: '+(capability.hdrDisplay?"reported":"not reported")+'</span><span>Dolby Vision decoder: '+(capability.dolbyVision?"reported":"not reported")+'</span>'
   +'<span>Dolby Digital: '+(capability.dolbyDigital?"reported":"not reported")+'</span><span>Dolby Digital Plus: '+(capability.dolbyDigitalPlus?"reported":"not reported")+'</span>'
   +'<small>Decoder indications are not proof the channel contains Dolby Vision or Dolby audio. Audio output and actual video format depend on device, stream and connected equipment.</small></div></div>';
  document.body.appendChild(root);
  video=root.querySelector("video");
  root.querySelector("#lumaPlayerClose").onclick=()=>close();
  on(document,"keydown",e=>{if(e.key==="Escape")close()});
  root.querySelector("#lumaPlayerPlay").onclick=()=>{if(video.paused){video.play().catch(()=>status("Playback could not start. Check stream/codec support.",true))}else video.pause()};
  root.querySelector("#lumaPlayerBack").onclick=()=>{if(Number.isFinite(video.duration))video.currentTime=Math.max(0,video.currentTime-10)};
  root.querySelector("#lumaPlayerForward").onclick=()=>{if(Number.isFinite(video.duration))video.currentTime=Math.min(video.duration,video.currentTime+10)};
  root.querySelector("#lumaPlayerLive").onclick=()=>{try{const r=video.seekable;if(r.length)video.currentTime=r.end(r.length-1)}catch{}};
  root.querySelector("#lumaPlayerPiP").onclick=()=>video.requestPictureInPicture?.().catch(()=>status("Picture in Picture unavailable on this device",true));
  root.querySelector("#lumaPlayerFullscreen").onclick=()=>{const fn=video.webkitEnterFullscreen||video.requestFullscreen||root.requestFullscreen;if(fn)fn.call(fn===root.requestFullscreen?root:video)};
  root.querySelector("#lumaPlayerAirPlay").onclick=()=>{if(video.webkitShowPlaybackTargetPicker)video.webkitShowPlaybackTargetPicker();else status("Use the system AirPlay menu on a compatible device",true)};
  root.querySelector("#lumaPlayerSeek").oninput=e=>{if(Number.isFinite(video.duration))video.currentTime=Number(e.target.value)};
  root.querySelector("#lumaPlayerAudio").onchange=e=>{const list=video.audioTracks;if(list)for(let i=0;i<list.length;i++)list[i].enabled=i===Number(e.target.value)};
  root.querySelector("#lumaPlayerCaptions").onchange=e=>{const list=video.textTracks;if(list)for(let i=0;i<list.length;i++)list[i].mode=i===Number(e.target.value)?"showing":"disabled"};
  on(video,"timeupdate",()=>{
   updateProgress();
   if(typeof options.onProgress==="function"&&Number.isFinite(video.duration)&&video.duration>0)
    options.onProgress({seconds:video.currentTime,fraction:video.currentTime/video.duration});
  });
  on(video,"pause",()=>{
   if(typeof options.onProgress==="function"&&Number.isFinite(video.duration)&&video.duration>0)
    options.onProgress({seconds:video.currentTime,fraction:video.currentTime/video.duration,paused:true});
  });
  on(video,"ended",()=>{if(typeof options.onEnded==="function")options.onEnded()});
  on(video,"durationchange",updateProgress);
  on(video,"loadedmetadata",()=>{
   const resume=Number(options.resumeAt)||0;
   if(!isLive&&resume>0&&Number.isFinite(video.duration)&&resume<video.duration-5)video.currentTime=resume;
   tracks();updateProgress();status("Ready · the device selects the compatible media tracks");
  });
  on(video,"play",()=>status("Playing · selected audio and HDR depend on the source"));
  on(video,"waiting",()=>status("Buffering stream…"));
  on(video,"stalled",()=>status("Stream stalled; checking network…"));
  on(video,"error",()=>status("This stream could not be decoded or accessed. Try another source/codec or native player.",true));
  if(httpBlocked){
   root.querySelector("#lumaPlayerVLC").href=vlcLink(src.href);
   root.querySelector("#lumaPlayerVLC").setAttribute("rel","noopener noreferrer");
  }else{
   video.src=src.href;
   video.play().catch(()=>status("Use the Play control to begin; autoplay may be blocked."));
   if(!capability.nativeHls&&/\.m3u8(?:$|\?)/i.test(src.href))status("This browser does not report native HLS support; use a native player for this stream.",true);
  }
  return true;
 }
 return {open,close,codecReport,validURL,vlcLink,__test:{fmtTime}};
})();
