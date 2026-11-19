"use strict";
/* Luma internal player: native decoder first, HTTPS browser fallback.
   No third-party proxy, script loader, Dolby emulation or fake codec claims. */
const LumaPlayer=(()=>{
 let root=null,video=null,unsub=[],nativeStatus="",currentURL="",currentTitle="",onClose=null;
 const temporaryMediaURLs=new Set();let currentObjectURL=null;
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const SETTINGS_KEY="luma.player.preferences.v1",BOOKMARKS_KEY="luma.player.bookmarks.v1";
 const DEFAULTS={speed:1,fit:"contain",zoom:1,subtitleScale:100,subtitleDelay:0,skipSeconds:10,autoNext:false};
 function safePrefs(raw={}){
  const val=(key,allowed,fallback)=>allowed.includes(raw?.[key])?raw[key]:fallback;
  return {speed:val("speed",[0.5,0.75,1,1.25,1.5,1.75,2],1),
   fit:val("fit",["contain","cover","fill"],"contain"),
   zoom:val("zoom",[1,1.15,1.3,1.5,2],1),
   subtitleScale:val("subtitleScale",[75,90,100,115,130,150,175,200],100),
   subtitleDelay:Number.isFinite(Number(raw.subtitleDelay))?Math.min(30,Math.max(-30,Number(raw.subtitleDelay))):0,
   skipSeconds:val("skipSeconds",[5,10,15,30],10),
   autoNext:raw.autoNext===true};
 }
 function storageRead(key,fallback){
  try{return JSON.parse(localStorage.getItem(key)||"null")??fallback}catch{return fallback}
 }
 let prefs=safePrefs(storageRead(SETTINGS_KEY,DEFAULTS)),subtitleSource=null,subtitleObjectURL=null;
 let sleepTimer=null,openedOptions=null,chapters=[],queue=[],queueIndex=-1,mediaKey="";
 function savePrefs(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(prefs))}catch{}}
 const pad=n=>String(Math.floor(Math.max(0,n))).padStart(2,"0");
 function parseCueTime(raw){
  const parts=String(raw||"").replace(",",".").split(":");
  if(parts.length<2||parts.length>3||parts.some(x=>!x||!Number.isFinite(Number(x))))return null;
  const value=parts.reduce((total,part)=>total*60+Number(part),0);
  return Number.isFinite(value)&&value>=0?Math.round(value*1000):null;
 }
 function formatCueTime(value){
  const ms=Math.max(0,Math.round(value)),hours=Math.floor(ms/3600000),mins=Math.floor(ms%3600000/60000),secs=Math.floor(ms%60000/1000);
  return pad(hours)+":"+pad(mins)+":"+pad(secs)+"."+String(ms%1000).padStart(3,"0");
 }
 function toVtt(source){
  if(typeof source!=="string"||source.length>1500000)throw Error("Subtitle file is empty or too large");
  let body=source.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").trim();
  if(/^WEBVTT\b/i.test(body))return body+"\n";
  body=body.replace(/^\d+\s*\n(?=\d{1,2}:\d{2}:\d{2}[,.]\d{3})/gm,"");
  body=body.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g,"$1.$2");
  if(!/-->\s*\d{1,2}:\d{2}:\d{2}[.]\d{3}/.test(body))throw Error("The file does not contain usable SRT or WebVTT subtitles");
  return "WEBVTT\n\n"+body+"\n";
 }
 function shiftVtt(text,seconds=0){
  const delta=Math.round(Math.max(-30,Math.min(30,Number(seconds)||0))*1000);
  if(!delta)return text;
  const re=/(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})/g;
  return text.replace(re,(original,start,end)=>{
   const a=parseCueTime(start),b=parseCueTime(end);
   if(a===null||b===null||b<=a)return original;
   const shiftedStart=Math.max(0,a+delta),shiftedEnd=Math.max(shiftedStart+1,b+delta);
   return formatCueTime(shiftedStart)+" --> "+formatCueTime(shiftedEnd);
  });
 }
 function normalizedChapters(input){
  if(!Array.isArray(input))return [];
  const seen=new Set();
  return input.filter(x=>x&&Number.isFinite(Number(x.time))&&Number(x.time)>=0)
   .map(x=>({time:Number(x.time),title:String(x.title||x.name||"Chapter").slice(0,100)}))
   .sort((a,b)=>a.time-b.time).filter(x=>{const t=Math.round(x.time);if(seen.has(t))return false;seen.add(t);return true}).slice(0,150);
 }
 function resolveBookmarkKey(options){
  const base=String(options.mediaId||options.id||"").trim();
  return base&&!base.includes("/")&&!["__proto__","constructor","prototype"].includes(base)&&base.length<=150?base:"";
 }
 function bookmarks(){
  const saved=storageRead(BOOKMARKS_KEY,{});
  if(!saved||typeof saved!=="object"||Array.isArray(saved))return {};
  return saved;
 }
 function bookmarkedTimes(){
  const values=bookmarks()[mediaKey];
  return Array.isArray(values)?values.filter(x=>Number.isFinite(x)&&x>=0).slice(0,40):[];
 }
 function addBookmark(time){
  if(!mediaKey||!Number.isFinite(time)||time<0)return false;
  const all=bookmarks(),items=bookmarkedTimes();
  if(!items.some(x=>Math.abs(x-time)<3))items.push(Math.round(time));
  all[mediaKey]=items.sort((a,b)=>a-b).slice(-40);
  const keys=Object.keys(all);if(keys.length>200)keys.slice(0,keys.length-200).forEach(key=>delete all[key]);
  try{localStorage.setItem(BOOKMARKS_KEY,JSON.stringify(all))}catch{return false}
  return true;
 }
 function clearSubtitle(){
  if(subtitleObjectURL){try{URL.revokeObjectURL(subtitleObjectURL)}catch{}subtitleObjectURL=null}
  subtitleSource=null;
 }
 function clearSleep(){if(sleepTimer!==null){clearTimeout(sleepTimer);sleepTimer=null}}

 function validURL(raw){
  try{
   const value=String(raw||"").trim();
   if(temporaryMediaURLs.has(value))return new URL(value);
   const u=new URL(value);
   return /^https?:$/.test(u.protocol)&&!!u.hostname&&!u.username&&!u.password&&u.href.length<=6000?u:null;
  }catch{return null}
 }
 function fileMediaID(file){
  const input=String(file.name||"")+"|"+String(file.size||0)+"|"+String(file.lastModified||0);
  let hash=2166136261;
  for(const char of input){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
  return "local:"+String(hash>>>0);
 }
 function openLocal(file,options={}){
  if(!file||typeof file.name!=="string"||!Number.isFinite(file.size)||file.size<=0)
   throw Error("Select a video file from your device");
  if(typeof URL.createObjectURL!=="function")throw Error("Local file playback is unavailable in this browser");
  const objectURL=URL.createObjectURL(file);
  temporaryMediaURLs.add(objectURL);
  const title=String(options.title||file.name||"Local video").slice(0,160);
  try{
   const success=open({...options,url:objectURL,title,live:false,mediaId:fileMediaID(file)});
   if(!success)throw Error("Unable to open the video file");
   currentObjectURL=objectURL;
   return true;
  }catch(err){
   temporaryMediaURLs.delete(objectURL);
   URL.revokeObjectURL(objectURL);
   throw err;
  }
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
  clearSleep();clearSubtitle();
  if(currentObjectURL){
   try{URL.revokeObjectURL(currentObjectURL)}catch{}
   temporaryMediaURLs.delete(currentObjectURL);currentObjectURL=null;
  }
  for(const fn of unsub.splice(0))fn();
  if(video){video.pause();video.removeAttribute("src");video.load();video=null}
  root?.remove();root=null;currentURL="";currentTitle="";
  openedOptions=null;chapters=[];queue=[];queueIndex=-1;mediaKey="";
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
 function applyPrefs(){
  if(!root||!video)return;
  video.playbackRate=prefs.speed;
  video.style.objectFit=prefs.fit;video.style.transform="scale("+prefs.zoom+")";
  for(const [id,value] of [["#lumaPlayerSpeed",prefs.speed],["#lumaPlayerFit",prefs.fit],
    ["#lumaPlayerZoom",prefs.zoom],["#lumaPlayerSkip",prefs.skipSeconds],["#lumaPlayerSubtitleSize",prefs.subtitleScale]]){
   const el=root.querySelector(id);if(el)el.value=String(value);
  }
  const d=root.querySelector("#lumaPlayerSubtitleDelay");if(d)d.value=String(prefs.subtitleDelay);
  const next=root.querySelector("#lumaPlayerAutoNext");if(next)next.checked=prefs.autoNext;
  for(const [id,sign] of [["#lumaPlayerBack","−"],["#lumaPlayerForward","+"]]){
   const el=root.querySelector(id);if(el)el.textContent=sign+prefs.skipSeconds+"s";
  }
  let style=root.querySelector("#lumaPlayerCaptionStyle");
  if(!style){style=document.createElement("style");style.id="lumaPlayerCaptionStyle";root.appendChild(style)}
  style.textContent=".lumaPlayerPortal video::cue { font-size: "+prefs.subtitleScale+"% }";
 }
 function renderChapters(){
  const label=root?.querySelector("#lumaPlayerChapterLabel"),select=root?.querySelector("#lumaPlayerChapters");
  if(!label||!select)return;
  label.hidden=chapters.length===0;
  if(!chapters.length)return;
  select.innerHTML='<option value="">Jump to chapter</option>'+chapters.map(x=>'<option value="'+x.time+'">'+fmtTime(x.time)+" · "+esc(x.title)+"</option>").join("");
 }
 function renderBookmarks(){
  const label=root?.querySelector("#lumaPlayerBookmarksLabel"),select=root?.querySelector("#lumaPlayerBookmarks");
  if(!label||!select)return;
  const items=bookmarkedTimes();
  label.hidden=items.length===0;
  if(items.length)select.innerHTML='<option value="">Bookmarked moments</option>'+items.map(time=>'<option value="'+time+'">'+fmtTime(time)+'</option>').join("");
  const add=root.querySelector("#lumaPlayerBookmark");if(add)add.hidden=!mediaKey;
 }
 function renderQueue(){
  if(!root)return;
  const prev=root.querySelector("#lumaPlayerPrevQueue"),next=root.querySelector("#lumaPlayerNextQueue");
  if(prev)prev.hidden=queueIndex<=0;
  if(next)next.hidden=queueIndex<0||queueIndex>=queue.length-1;
  const autoplay=root.querySelector(".lumaPlayerNextToggle");
  if(autoplay)autoplay.hidden=queue.length<2;
 }
 function nextQueue(direction){
  if(!openedOptions)return false;
  const item=queue[queueIndex+direction],nextIndex=queueIndex+direction;
  if(!item||!validURL(item.url))return false;
  const next={...openedOptions,...item,mediaId:item.mediaId||item.id||"",
   onProgress:typeof item.onProgress==="function"?item.onProgress:null,
   onEnded:typeof item.onEnded==="function"?item.onEnded:null,
   live:item.live===true,queue,queueIndex:nextIndex,resumeAt:Number(item.resumeAt)||0};
  return open(next);
 }
 function detectChapters(){
  if(chapters.length||!video?.textTracks)return;
  const tracksList=[...video.textTracks];
  const t=tracksList.find(t=>t.kind==="chapters");
  if(!t)return;
  try{
   t.mode="hidden";
   if(t.cues?.length){
    chapters=normalizedChapters([...t.cues].map(c=>({time:c.startTime,title:c.text})));
    renderChapters();
   }
  }catch{}
 }
 function attachImportedSubtitle(){
  if(!subtitleSource||!video||!root)return;
  for(const el of [...video.querySelectorAll('track[data-luma-import="1"]')])el.remove();
  if(subtitleObjectURL){try{URL.revokeObjectURL(subtitleObjectURL)}catch{}subtitleObjectURL=null}
  const contents=shiftVtt(subtitleSource.vtt,prefs.subtitleDelay);
  const blob=new Blob([contents],{type:"text/vtt;charset=utf-8"});
  subtitleObjectURL=URL.createObjectURL(blob);
  const node=document.createElement("track");
  node.kind="subtitles";node.label=subtitleSource.label;
  node.srclang=subtitleSource.language||"en";node.src=subtitleObjectURL;node.default=true;
  node.setAttribute("data-luma-import","1");
  on(node,"load",()=>{try{node.track.mode="showing"}catch{}tracks();status("Local subtitle file loaded")});
  video.appendChild(node);
  tracks();
 }
 async function loadSubtitleFile(file){
  if(!file) return false;
  if(!/\.(srt|vtt)$/i.test(file.name||"")||file.size>1200000)throw Error("Choose a valid SRT or VTT file under 1.2 MB");
  const contents=toVtt(await file.text());
  subtitleSource={vtt:contents,label:String(file.name||"Imported subtitles").slice(0,80),language:"en"};
  attachImportedSubtitle();
  return true;
 }
 function updateDiagnostics(){
  const el=root?.querySelector("#lumaPlayerDiagnostics");
  if(!el||!video)return;
  const width=Number(video.videoWidth)||0,height=Number(video.videoHeight)||0;
  const playback=Number.isFinite(video.duration)?"On-demand":"Live or unknown duration";
  const r=video.buffered,buffered=(()=>{try{return r?.length?Math.max(0,r.end(r.length-1)-video.currentTime):0}catch{return 0}})();
  const parts=[width&&height?width+" × "+height:"Resolution not available",playback,
    "Speed "+prefs.speed+"×","Buffered "+buffered.toFixed(1)+"s",
    "Audio tracks "+(video.audioTracks?.length??"not exposed"),
    "Subtitle tracks "+(video.textTracks?.length??0)];
  el.textContent=parts.join(" · ");
 }
 function startSleepTimer(minutes){
  clearSleep();
  if(!minutes)return;
  sleepTimer=setTimeout(()=>{
   sleepTimer=null;
   video?.pause();
   status("Sleep timer reached · Playback paused");
  },minutes*60000);
  status("Sleep timer set for "+minutes+" minutes");
 }
 function playerKey(event){
  if(!root||!video||!event||event.defaultPrevented)return;
  const target=event.target?.tagName||"";
  if(["INPUT","SELECT","TEXTAREA","BUTTON"].includes(target)||event.ctrlKey||event.altKey||event.metaKey)return;
  const key=event.key;
  if(key==="Escape"){event.preventDefault();close();return}
  if(key===" "||key==="k"||key==="K"){
   event.preventDefault();if(video.paused)video.play().catch(()=>{});else video.pause();
  }else if(key==="ArrowLeft"||key==="ArrowRight"){
   if(video.seekable?.length){event.preventDefault();const dir=key==="ArrowLeft"?-1:1;
    video.currentTime=Math.max(0,video.currentTime+dir*prefs.skipSeconds)}
  }else if(key==="m"||key==="M"){event.preventDefault();video.muted=!video.muted}
  else if(key==="f"||key==="F"){
   event.preventDefault();
   const fn=video.webkitEnterFullscreen||video.requestFullscreen||root.requestFullscreen;
   if(fn)fn.call(fn===root.requestFullscreen?root:video);
  }
 }

 function vlcLink(src){return "vlc-x-callback://x-callback-url/stream?url="+encodeURIComponent(src)}
 function open(options={}){
  const src=validURL(options.url||options.src);
  if(!src)return false;
  const title=String(options.title||"Now playing").slice(0,160),isLive=options.live!==false;
  close(true);nativeStatus="";
  if(src.protocol!=="blob:"&&nativePlay(src.href,title))return true;
  onClose=typeof options.onClose==="function"?options.onClose:null;
  openedOptions=options;mediaKey=resolveBookmarkKey(options);
  chapters=normalizedChapters(options.chapters);
  queue=Array.isArray(options.queue)?options.queue.filter(x=>validURL(x?.url)).slice(0,100):[];
  queueIndex=Number.isInteger(options.queueIndex)?Math.max(0,Math.min(queue.length-1,options.queueIndex)):-1;
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
   +'<details class="lumaPlayerOptions" id="lumaPlayerOptions"><summary>Playback options · Speed, subtitles, picture & more</summary>'
   +'<div class="lumaPlayerOptionsGrid"><label>Playback speed<select id="lumaPlayerSpeed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">Normal · 1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="1.75">1.75×</option><option value="2">2×</option></select></label>'
   +'<label>Screen fit<select id="lumaPlayerFit"><option value="contain">Fit · No crop</option><option value="cover">Fill · Crop edges</option><option value="fill">Stretch picture</option></select></label>'
   +'<label>Zoom<select id="lumaPlayerZoom"><option value="1">1×</option><option value="1.15">1.15×</option><option value="1.3">1.3×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>'
   +'<label>Skip duration<select id="lumaPlayerSkip"><option value="5">5 seconds</option><option value="10">10 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></label>'
   +'<label>Subtitle size<select id="lumaPlayerSubtitleSize"><option value="75">75%</option><option value="90">90%</option><option value="100">100%</option><option value="115">115%</option><option value="130">130%</option><option value="150">150%</option><option value="175">175%</option><option value="200">200%</option></select></label>'
   +'<label>Subtitle timing (seconds)<input id="lumaPlayerSubtitleDelay" type="number" min="-30" max="30" step="0.5" value="0"></label>'
   +'<label>Load subtitle file (SRT / VTT)<input id="lumaPlayerSubtitleFile" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" aria-label="Load subtitle file"></label>'
   +'<label>Sleep timer<select id="lumaPlayerSleep"><option value="0">Off</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label>'
   +'<label class="lumaPlayerNextToggle"><input id="lumaPlayerAutoNext" type="checkbox"> Play next in queue automatically</label>'
   +'</div><p class="lumaPlayerOptionsHint">Subtitle size depends on the device. Uploaded files remain in this player session. Native iOS/Android playback uses system track and speed menus.</p></details>'
   +'<div class="lumaPlayerNavigation"><label id="lumaPlayerChapterLabel" hidden>Chapters<select id="lumaPlayerChapters"></select></label>'
   +'<label id="lumaPlayerBookmarksLabel" hidden>Bookmarked moments<select id="lumaPlayerBookmarks"></select></label>'
   +'<button type="button" class="secondary" id="lumaPlayerBookmark">＋ Bookmark</button>'
   +'<button type="button" class="secondary" id="lumaPlayerPrevQueue" hidden>‹ Previous</button>'
   +'<button type="button" class="secondary" id="lumaPlayerNextQueue" hidden>Next ›</button></div>'
   +'<details class="lumaPlayerDiagnostics"><summary>Stream information</summary><p id="lumaPlayerDiagnostics">Media information will appear after loading.</p><small>Browser playback details are limited. Hardware Dolby/Vision decoding and audio passthrough require a compatible native device and source.</small></details>'
   +'<p class="lumaPlayerStatus" role="status">'+(httpBlocked?"HTTP is blocked in this browser. Open in VLC or use a native Luma player.":"Preparing media…")+'</p>'
   +'<div class="lumaPlayerCapability"><span>HDR display: '+(capability.hdrDisplay?"reported":"not reported")+'</span><span>Dolby Vision decoder: '+(capability.dolbyVision?"reported":"not reported")+'</span>'
   +'<span>Dolby Digital: '+(capability.dolbyDigital?"reported":"not reported")+'</span><span>Dolby Digital Plus: '+(capability.dolbyDigitalPlus?"reported":"not reported")+'</span>'
   +'<small>Decoder indications are not proof the channel contains Dolby Vision or Dolby audio. Audio output and actual video format depend on device, stream and connected equipment.</small></div></div>';
  document.body.appendChild(root);
  video=root.querySelector("video");
  applyPrefs();renderChapters();renderBookmarks();renderQueue();
  root.querySelector("#lumaPlayerClose").onclick=()=>close();
  on(document,"keydown",playerKey);
  for(const [selector,key,number] of [
   ["#lumaPlayerSpeed","speed",true],["#lumaPlayerFit","fit",false],
   ["#lumaPlayerZoom","zoom",true],["#lumaPlayerSkip","skipSeconds",true],
   ["#lumaPlayerSubtitleSize","subtitleScale",true]
  ]){
   const el=root.querySelector(selector);
   if(el)el.onchange=e=>{
    const val=number?Number(e.target.value):e.target.value;
    prefs=safePrefs({...prefs,[key]:val});savePrefs();applyPrefs();updateDiagnostics();
   };
  }
  const offset=root.querySelector("#lumaPlayerSubtitleDelay");
  if(offset)offset.onchange=e=>{
   prefs=safePrefs({...prefs,subtitleDelay:Number(e.target.value)});
   savePrefs();applyPrefs();if(subtitleSource)attachImportedSubtitle();
  };
  const fileInput=root.querySelector("#lumaPlayerSubtitleFile");
  if(fileInput)fileInput.onchange=async e=>{
   try{await loadSubtitleFile(e.target.files?.[0])}
   catch(err){status(String(err.message||err),true)}
  };
  root.querySelector("#lumaPlayerSleep").onchange=e=>startSleepTimer(Number(e.target.value));
  root.querySelector("#lumaPlayerAutoNext").onchange=e=>{
   prefs=safePrefs({...prefs,autoNext:!!e.target.checked});savePrefs();
  };
  root.querySelector("#lumaPlayerChapters").onchange=e=>{
   if(e.target.value!==""&&video.seekable?.length)video.currentTime=Number(e.target.value);
  };
  root.querySelector("#lumaPlayerBookmarks").onchange=e=>{
   if(e.target.value!==""&&video.seekable?.length)video.currentTime=Number(e.target.value);
  };
  root.querySelector("#lumaPlayerBookmark").onclick=()=>{
   if(addBookmark(video.currentTime)){renderBookmarks();status("Bookmarked "+fmtTime(video.currentTime))}
   else status("Bookmarks are available only for saved library titles.",true);
  };
  root.querySelector("#lumaPlayerPrevQueue").onclick=()=>nextQueue(-1);
  root.querySelector("#lumaPlayerNextQueue").onclick=()=>nextQueue(1);
  root.querySelector("#lumaPlayerPlay").onclick=()=>{if(video.paused){video.play().catch(()=>status("Playback could not start. Check stream/codec support.",true))}else video.pause()};
  root.querySelector("#lumaPlayerBack").onclick=()=>{if(video.seekable?.length)video.currentTime=Math.max(0,video.currentTime-prefs.skipSeconds)};
  root.querySelector("#lumaPlayerForward").onclick=()=>{if(video.seekable?.length)video.currentTime=Math.min(Number.isFinite(video.duration)?video.duration:Infinity,video.currentTime+prefs.skipSeconds)};
  root.querySelector("#lumaPlayerLive").onclick=()=>{try{const r=video.seekable;if(r.length)video.currentTime=r.end(r.length-1)}catch{}};
  root.querySelector("#lumaPlayerPiP").onclick=()=>video.requestPictureInPicture?.().catch(()=>status("Picture in Picture unavailable on this device",true));
  root.querySelector("#lumaPlayerFullscreen").onclick=()=>{const fn=video.webkitEnterFullscreen||video.requestFullscreen||root.requestFullscreen;if(fn)fn.call(fn===root.requestFullscreen?root:video)};
  root.querySelector("#lumaPlayerAirPlay").onclick=()=>{if(video.webkitShowPlaybackTargetPicker)video.webkitShowPlaybackTargetPicker();else status("Use the system AirPlay menu on a compatible device",true)};
  root.querySelector("#lumaPlayerSeek").oninput=e=>{if(Number.isFinite(video.duration))video.currentTime=Number(e.target.value)};
  root.querySelector("#lumaPlayerAudio").onchange=e=>{const list=video.audioTracks;if(list)for(let i=0;i<list.length;i++)list[i].enabled=i===Number(e.target.value)};
  root.querySelector("#lumaPlayerCaptions").onchange=e=>{const list=video.textTracks;if(list)for(let i=0;i<list.length;i++)list[i].mode=i===Number(e.target.value)?"showing":"disabled"};
  on(video,"timeupdate",()=>{
   updateProgress();updateDiagnostics();
   if(typeof options.onProgress==="function"&&Number.isFinite(video.duration)&&video.duration>0)
    options.onProgress({seconds:video.currentTime,fraction:video.currentTime/video.duration});
  });
  on(video,"pause",()=>{
   if(typeof options.onProgress==="function"&&Number.isFinite(video.duration)&&video.duration>0)
    options.onProgress({seconds:video.currentTime,fraction:video.currentTime/video.duration,paused:true});
  });
  on(video,"ended",()=>{
   if(typeof options.onEnded==="function")options.onEnded();
   if(prefs.autoNext&&queueIndex>=0&&queueIndex<queue.length-1)nextQueue(1);
  });
  on(video,"durationchange",updateProgress);
  on(video,"loadedmetadata",()=>{
   const resume=Number(options.resumeAt)||0;
   if(!isLive&&resume>0&&Number.isFinite(video.duration)&&resume<video.duration-5)video.currentTime=resume;
   tracks();detectChapters();renderChapters();updateProgress();updateDiagnostics();
   status("Ready · the device selects the compatible media tracks");
  });
  on(video,"play",()=>status("Playing · selected audio and HDR depend on the source"));
  on(video,"waiting",()=>status("Buffering stream…"));
  on(video,"stalled",()=>status("Stream stalled; checking network…"));
  on(video,"ratechange",()=>{if(!video.paused)updateDiagnostics()});
  if(video.audioTracks?.addEventListener)on(video.audioTracks,"addtrack",tracks);
  if(video.textTracks?.addEventListener)on(video.textTracks,"addtrack",()=>{tracks();detectChapters()});
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
 return {open,openLocal,close,codecReport,validURL,vlcLink,getPreferences:()=>({...prefs}),
  __test:{fmtTime,parseCueTime,formatCueTime,toVtt,shiftVtt,safePrefs,normalizedChapters,resolveBookmarkKey}};
})();
