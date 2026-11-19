
"use strict";
/* Luma Live TV: local M3U/XMLTV guide and optional authenticated always-on recorder. */
const LumaIPTV=(()=>{
 const key="luma.iptv.v1";
 let cfg;try{cfg=JSON.parse(localStorage.getItem(key)||"{}")}catch{cfg={}}
 cfg={name:"My IPTV",m3u: "",xmltv:"",host:"",token:"",...cfg};
 let channels=[],programs=[],jobs=[],rules=[],loading=false,connected=false,error="",message="",filter="",search="",offset=0,selected=null,playerOpen=false;
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const byID=id=>channels.find(c=>c.id===id);
 const programsByChannel=new Map();
 function indexPrograms(){
  programsByChannel.clear();
  for(const p of programs){
   if(!programsByChannel.has(p.channel_id))programsByChannel.set(p.channel_id,[]);
   programsByChannel.get(p.channel_id).push(p);
  }
 }
 function preferredProgramme(program){
  const match=(p)=>p.title.trim().toLowerCase()===program.title.trim().toLowerCase()
    &&Math.abs(p.start-program.start)<=15*60000;
  const options=programs.filter(match);
  return options.sort((a,b)=>(byID(b.channel_id)?.quality||0)-(byID(a.channel_id)?.quality||0))[0]||program;
 }
 const showDate=ms=>new Date(ms).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
 const showClock=ms=>new Date(ms).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
 const hash=s=>{let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619)}return (n>>>0).toString(36)};
 function save(){localStorage.setItem(key,JSON.stringify(cfg))}
 function validURL(s){try{const u=new URL(String(s||"").trim());return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password&&!!u.hostname}catch{return false}}
 function recordHost(){const s=String(cfg.host||"").trim().replace(/\/+$/,"");return s.startsWith("https://")&&validURL(s)?s:""}
 async function readRemote(url,limit){
  if(!validURL(url))throw Error("Enter a valid HTTPS playlist or guide address");
  if(location.protocol==="https:"&&!url.startsWith("https://"))throw Error("The web app requires an HTTPS feed. Use the recorder companion for HTTP/LAN sources.");
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),22000);
  try{const res=await fetch(url,{signal:ctrl.signal,cache:"no-store"});
   if(!res.ok)throw Error("Feed returned HTTP "+res.status);
   const text=await res.text();if(text.length>limit)throw Error("Feed too large for this browser");
   return text;
  }finally{clearTimeout(timer)}
 }
 function parseM3U(source){
  if(!String(source||"").trimStart().startsWith("#EXTM3U"))throw Error("Not an M3U IPTV playlist");
  let rows=[],info=null;
  for(const line of source.split(/\r?\n/).slice(0,75000)){
   const s=line.trim();
   if(s.startsWith("#EXTINF:")){
    const a=(name)=>{const m=s.match(new RegExp("\\b"+name+'="([^"]{0,300})"',"i"));return m?m[1].trim():""};
    info={name:(s.includes(",")?s.slice(s.indexOf(",")+1):"TV Channel").trim().slice(0,100),epg_id:a("tvg-id"),logo:a("tvg-logo"),group:a("group-title"),quality:/\b4K\b/i.test(s)?2:/\b(FHD|HD|1080P)\b/i.test(s)?1:0};
   }else if(info&&s&&!s.startsWith("#")){
    if(validURL(s)){rows.push({...info,id:"iptv:"+hash(info.epg_id+"|"+info.name+"|"+s),url:s});
     if(rows.length>=2500)break}
    info=null;
   }
  }
  return rows;
 }
 function xmlTime(value){
  const m=String(value||"").match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(?:\s*([+-])(\d\d)(\d\d))?/);
  if(!m)return 0;
  const y=+m[1],mo=+m[2],d=+m[3],h=+m[4],min=+m[5],sec=+(m[6]||0);
  const offset=(+(m[8]||0)*60+ +(m[9]||0))*(m[7]==="-"?-1:1);
  return Date.UTC(y,mo-1,d,h,min,sec)-offset*60000;
 }
 function episodeNum(el){
  for(const e of [...el.getElementsByTagName("episode-num")]){
   const sys=e.getAttribute("system")||"",v=(e.textContent||"").trim();
   if(sys==="xmltv_ns"){const m=v.match(/^(\d+)(?:\/\d+)?\s*\.\s*(\d+)(?:\/\d+)?/);if(m)return "S"+String(+m[1]+1).padStart(2,"0")+"E"+String(+m[2]+1).padStart(2,"0")}
   if(sys==="onscreen"&&/S\d+E\d+/i.test(v))return v.match(/S\d+E\d+/i)[0].toUpperCase();
   if(sys==="dd_progid"&&v.startsWith("EP"))return v.slice(0,65);
  }return "";
 }
 function parseGuide(source,stations){
  if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error("Unsafe XMLTV declarations rejected");
  const doc=new DOMParser().parseFromString(source,"application/xml");
  if(doc.querySelector("parsererror")||doc.documentElement.nodeName!=="tv")throw Error("Invalid XMLTV guide");
  const names=new Map([...doc.getElementsByTagName("channel")].map(c=>[c.getAttribute("id"),c.getElementsByTagName("display-name")[0]?.textContent?.trim().toLowerCase()||""]));
  const byGuide=new Map(),byName=new Map();
  for(const c of stations){
   if(c.epg_id){if(!byGuide.has(c.epg_id))byGuide.set(c.epg_id,[]);byGuide.get(c.epg_id).push(c)}
   const name=c.name.toLowerCase();if(!byName.has(name))byName.set(name,[]);byName.get(name).push(c);
  }
  const results=[],seen=new Set(),now=Date.now();
  for(const el of [...doc.getElementsByTagName("programme")].slice(0,28000)){
   const id=el.getAttribute("channel"),options=byGuide.get(id)||byName.get(names.get(id))||[];
   if(!options.length)continue;
   const channel=[...options].sort((a,b)=>b.quality-a.quality)[0];
   const start=xmlTime(el.getAttribute("start")),end=xmlTime(el.getAttribute("stop"));
   if(!start||end<=start||end<now-3600000||start>now+14*86400000)continue;
   const title=el.getElementsByTagName("title")[0]?.textContent?.trim().slice(0,160);if(!title)continue;
   const identifier="local:"+hash(channel.id+"|"+start+"|"+end+"|"+title);
   if(seen.has(identifier))continue;seen.add(identifier);
   results.push({id:identifier,channel_id:channel.id,title,start,end,episode:episodeNum(el),
    subtitle:el.getElementsByTagName("sub-title")[0]?.textContent?.slice(0,100)||"",
    description:el.getElementsByTagName("desc")[0]?.textContent?.slice(0,330)||"",
    is_new:!!el.getElementsByTagName("new").length||!!el.getElementsByTagName("premiere").length,
    rerun:!!el.getElementsByTagName("previously-shown").length});
  }
  return results.sort((a,b)=>a.start-b.start);
 }
 async function recorder(path,method="GET",body){
  const host=recordHost();if(!host)throw Error("Enter the HTTPS address of your always-on recorder");
  if(!cfg.token)throw Error("Enter your recorder access token");
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),18000);
  try{
   const res=await fetch(host+path,{method,headers:{Authorization:"Bearer "+cfg.token,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,signal:ctrl.signal,cache:"no-store"});
   const out=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(out.error||"Recorder returned HTTP "+res.status);
   return out;
  }finally{clearTimeout(timeout)}
 }
 async function loadRecorder(){
  const r=await recorder("/guide");channels=Array.isArray(r.channels)?r.channels:[];programs=Array.isArray(r.programs)?r.programs:[];indexPrograms();connected=true;
  const other=await recorder("/recordings");jobs=other.jobs||[];rules=other.rules||[];
  message=channels.length+" channels · "+programs.length+" guide programs loaded from your recorder";error="";
 }
 async function updateLocal(){
  loading=true;error="";message="";render();
  try{
   if(cfg.host&&cfg.token){await loadRecorder()}
   else{
    if(!cfg.m3u)throw Error("Add a playlist URL or upload an M3U file");
    channels=parseM3U(await readRemote(cfg.m3u,5*1024*1024));if(!channels.length)throw Error("No playable entries were found in the playlist");
    programs=cfg.xmltv?parseGuide(await readRemote(cfg.xmltv,25*1024*1024),channels):[];indexPrograms();
    connected=false;message=channels.length+" channels · "+programs.length+" program entries";
   }
  }catch(e){error=String(e.message||e);connected=false}finally{loading=false;render()}
 }
 function getChannels(){
  const q=search.toLowerCase(),list=channels.filter(c=>(filter==="all"||c.group===filter)&&(!q||c.name.toLowerCase().includes(q)||(programsByChannel.get(c.id)||[]).some(p=>[p.title,p.subtitle,p.description].some(v=>String(v||"").toLowerCase().includes(q)))));
  if(q)list.sort((a,b)=>(b.quality||0)-(a.quality||0)||a.name.localeCompare(b.name));
  return list.slice(0,350);
 }
 function windowStart(){return Math.floor(Date.now()/1800000)*1800000+offset*3600000}
 const byChannel=id=>programsByChannel.get(id)||[];
 function guideHTML(){
  if(!channels.length)return '<div class="iptvEmpty"><h3>No channels loaded</h3><p>Add your own authorized IPTV playlist and XMLTV guide. You can browse channels without a paid guide API.</p></div>';
  const start=windowStart(),end=start+3*3600000,rows=getChannels(),timeCount=6;
  const heading='<div class="iptvGuideHeader"><div class="iptvChannelHeading">CHANNEL</div><div class="iptvTimeHeader">'+Array.from({length:timeCount},(_,i)=>'<span>'+showClock(start+i*30*60000)+'</span>').join("")+'</div></div>';
  const body=rows.map(c=>{
   const entries=byChannel(c.id).filter(p=>p.end>start&&p.start<end);
   const programsHTML=entries.map(p=>{
     const left=Math.max(0,(p.start-start)/(end-start)*100),right=Math.min(100,(p.end-start)/(end-start)*100),width=Math.max(1,right-left);
     const current=p.start<=Date.now()&&p.end>Date.now();
     return '<button class="iptvProgram '+(current?'isLive ':'')+(p.is_new?'isNew':'')+'" type="button" style="left:'+left.toFixed(2)+'%;width:calc('+width.toFixed(2)+'% - 2px)" data-program="'+esc(p.id)+'" title="'+esc(p.title)+'"><b>'+esc(p.title)+'</b><span>'+showClock(p.start)+(p.episode?' · '+esc(p.episode):'')+(p.is_new?' · NEW':'')+'</span></button>';
   }).join("");
   return '<div class="iptvGuideRow"><button class="iptvChannel" data-channel="'+esc(c.id)+'" title="Tune to '+esc(c.name)+'">'+(validURL(c.logo)?'<img loading="lazy" src="'+esc(c.logo)+'" alt="" onerror="this.remove()">':'<span class="iptvChannelGlyph">▣</span>')+'<span><strong>'+esc(c.name)+'</strong><small>'+esc(c.group||"Live TV")+'</small></span><em>▶</em></button><div class="iptvTimeline">'+(programsHTML||'<span class="iptvGuideMissing">No guide information for this time</span>')+'</div></div>';
  }).join("");
  return '<div class="iptvGuideScroll" tabindex="0" aria-label="Live IPTV program guide">'+heading+body+'</div><p class="micro">'+rows.length+' channels shown · select a programme to see available tuning and recording actions. Guide times use your device timezone.</p>';
 }
 function recordingHTML(){
  const scheduled=jobs.filter(j=>["scheduled","recording"].includes(j.status)),done=jobs.filter(j=>!["scheduled","recording"].includes(j.status)).slice(-35).reverse();
  return '<div class="iptvRecordings"><div class="iptvSectionHead"><h2>My DVR</h2><span>'+scheduled.length+' scheduled / recording</span></div>'
   +(connected?'<p class="micro">Your always-on recorder stores Transport Stream (.ts) files on its own storage. Download completed recordings to this device with Save to device.</p>':'<div class="iptvNotice">To schedule and record even when the TV box is off, connect an always-on recorder under Connections. The TV box cannot record while completely powered off.</div>')
   +(rules.length?'<h3>Series rules</h3>'+rules.map(r=>'<div class="iptvDvrRow"><div><strong>'+esc(r.title)+'</strong><small>'+esc(r.mode==="new"?"Guide-confirmed new only":r.mode==="unseen"?"Every unique episode (incl. reruns)":"Every airing")+'</small></div><button class="secondary small" data-remove-rule="'+esc(r.id)+'">Remove</button></div>').join(""):"")
   +'<h3>Upcoming & active</h3>'+(scheduled.length?scheduled.map(jobRow).join(""):'<p class="micro">No upcoming recordings.</p>')
   +'<h3>Recording history</h3>'+(done.length?done.map(jobRow).join(""):'<p class="micro">No recordings yet.</p>')+'</div>';
 }
 function jobRow(j){
  return '<div class="iptvDvrRow"><div><strong>'+esc(j.title)+'</strong><small>'+showDate(j.start)+' · '+esc(j.status)+(j.episode?' · '+esc(j.episode):'')+'</small></div>'
   +(j.status==="complete"?'<button class="secondary small" data-download-recording="'+esc(j.id)+'">Save to device</button>':j.status==="scheduled"?'<button class="secondary small" data-cancel-recording="'+esc(j.id)+'">Cancel</button>':'')+'</div>';
 }
 function formHTML(){
  return '<details class="iptvSettings" '+(!channels.length?'open':'')+'><summary><span>⚙ Connections & sources</span><small>Playlist, TV guide and recorder settings</small></summary><div class="iptvSettingsGrid"><form id="iptvSources">'
   +'<label>Playlist name<input id="iptvName" maxlength="80" value="'+esc(cfg.name)+'" placeholder="My IPTV"></label>'
   +'<label>M3U playlist URL<input id="iptvM3U" type="url" value="'+esc(cfg.m3u)+'" placeholder="https://provider.example/list.m3u"></label>'
   +'<label>XMLTV guide URL (optional)<input id="iptvXMLTV" type="url" value="'+esc(cfg.xmltv)+'" placeholder="https://provider.example/epg.xml"></label>'
   +'<div class="iptvFormActions"><button type="submit" class="primary">Save & load guide</button><button type="button" class="secondary" id="iptvSyncRecorder">Sync to recorder</button></div>'
   +'<p class="micro">Use streams and guides you are authorized to access. Some providers block browser requests; the always-on recorder can fetch your feeds directly.</p></form>'
   +'<div class="iptvRecorderSettings"><h3>Always-on DVR companion</h3><p>Optional: connect an HTTPS recorder running on your own always-powered device. It stores programmes and scheduled series even when this TV is off.</p>'
   +'<label>Recorder HTTPS address<input id="iptvHost" type="url" placeholder="https://recorder.example.com" value="'+esc(cfg.host)+'"></label>'
   +'<label>Recorder access token<input id="iptvToken" type="password" autocomplete="off" value="'+esc(cfg.token)+'" placeholder="Private recorder token"></label>'
   +'<button type="button" class="secondary" id="iptvConnectRecorder">Connect & load DVR</button><p class="micro"><a href="https://github.com/cj42izzle/Luma-Media-Center/tree/main/recorder" target="_blank" rel="noopener">Recorder setup and self-hosting instructions</a>. Private credentials remain in this device storage.</p></div></div>'
   +'<div class="iptvFileImport"><label>M3U file <input id="iptvFileM3U" type="file" accept=".m3u,.m3u8,.txt"></label><label>XMLTV file <input id="iptvFileGuide" type="file" accept=".xml,.xmltv,.txt"></label><button class="secondary" id="iptvLoadFiles" type="button">Load files locally</button><p class="micro">Local files enable browsing without provider CORS support, but scheduled recordings require the recorder to have network-accessible source URLs.</p></div></details>';
 }
 function render(){
  const target=document.querySelector("#content");if(!target)return;
  const groups=[...new Set(channels.map(c=>c.group).filter(Boolean))].sort();
  target.innerHTML='<section class="iptvHero"><div class="eyebrow">LUMA LIVE TV</div><h2>Live channels. Smarter guide. Your DVR.</h2><p>Browse an interactive live TV grid, tune to the exact channel and schedule programmes or recurring series on your own recorder.</p><div class="iptvHeroStats"><span><b>'+channels.length+'</b> Channels</span><span><b>'+programs.length+'</b> Programmes</span><span class="'+(connected?'iptvConnected':'')+'">'+(connected?'● DVR connected':'○ DVR not connected')+'</span></div></section>'
   +formHTML()
   +(error?'<div class="notice" role="alert">'+esc(error)+'</div>':"")
   +(message?'<div class="iptvMessage" role="status">'+esc(message)+'</div>':"")
   +'<div class="iptvToolbar"><label>Channel search<input id="iptvSearch" type="search" value="'+esc(search)+'" placeholder="Search channels or shows"></label>'
   +'<label>Category<select id="iptvFilter"><option value="all">All channels</option>'+groups.map(g=>'<option value="'+esc(g)+'"'+(filter===g?' selected':'')+'>'+esc(g)+'</option>').join("")+'</select></label>'
   +'<button class="secondary" id="iptvBackTime">‹ Earlier</button><button class="secondary" id="iptvNow">Now</button><button class="secondary" id="iptvNextTime">Later ›</button><button class="secondary" id="iptvRefresh" '+(loading?'disabled':'')+'>'+(loading?'Refreshing…':'↻ Refresh')+'</button></div>'
   +'<div class="iptvSectionHead"><h2>Program guide</h2><span>'+showDate(windowStart())+' – '+showClock(windowStart()+3*3600000)+'</span></div>'
   +guideHTML()+recordingHTML();
  bind();
 }
 function selectChannel(id){
  const channel=byID(id);if(!channel)return;
  selected=null;
  modal('<div class="iptvWatch"><div class="eyebrow">LIVE CHANNEL</div><h2>'+esc(channel.name)+'</h2>'
   +'<video id="iptvPlayer" controls playsinline preload="none"></video>'
   +'<p class="micro">Browser playback requires a supported codec and stream format. If this channel does not play in-browser, use your preferred external player.</p>'
   +'<div class="actions"><button class="primary" id="iptvStartPlayback">▶ Play in Luma</button><button class="secondary" id="iptvExternalPlayer">Open external player</button></div>'
   +'<div class="iptvSeriesRecorder"><h3>Record channel now</h3><p>For channels without a program listing, record a timed segment to your connected recorder.</p>'
   +'<label>Duration<select id="iptvRecordDuration"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="90">90 minutes</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option></select></label>'
   +'<button class="secondary" id="iptvRecordChannelNow">● Record Channel Now</button></div></div>');
  const video=document.querySelector("#iptvPlayer");
  document.querySelector("#iptvStartPlayback").onclick=()=>{video.src=channel.url;video.play().catch(()=>toast("Playback unavailable in this browser. Try the external player."))};
  document.querySelector("#iptvExternalPlayer").onclick=()=>window.open(channel.url,"_blank","noopener");
  document.querySelector("#iptvRecordChannelNow").onclick=async()=>{
   try{
    if(!connected)throw Error("Connect your always-on DVR recorder before starting a recording");
    const minutes=Number(document.querySelector("#iptvRecordDuration").value)||60;
    await recorder("/recordings/manual","POST",{channel_id:channel.id,title:channel.name,minutes});
    toast("Recording scheduled: "+minutes+" minutes");
    closeModal();await reloadDvr();
   }catch(e){toast(String(e.message||e))}
  };
 }
 function selectProgramme(id){
  const p=programs.find(v=>v.id===id);if(!p)return;
  selected=p;
  const best=preferredProgramme(p),channel=byID(best.channel_id),running=p.start<=Date.now()&&p.end>Date.now();
  modal('<div class="iptvProgrammeDetail"><div class="eyebrow">'+(running?'● ON AIR':p.is_new?'NEW PREMIERE':'PROGRAM GUIDE')+'</div><h2>'+esc(p.title)+'</h2>'
   +'<div class="iptvProgrammeMeta"><span>'+esc(channel?.name||"Unknown channel")+'</span><span>'+showDate(p.start)+' – '+showClock(p.end)+'</span>'+(p.episode?'<span>'+esc(p.episode)+'</span>':"")+(p.rerun?'<span>Repeat</span>':"")+'</div>'
   +(p.subtitle?'<h3>'+esc(p.subtitle)+'</h3>':"")+(p.description?'<p>'+esc(p.description)+'</p>':"")
   +'<div class="iptvDetailButtons"><button class="primary" id="iptvTune">▶ Watch channel</button><button class="secondary" id="iptvRecordOnce">● Record this airing</button></div>'
   +'<div class="iptvSeriesRecorder"><h3>Series recording</h3><p>New-only uses confirmed first-run guide markers. Every unique episode matches episode numbers, subtitles, or detailed descriptions to avoid duplicates, including reruns. Every airing also records repeats.</p>'
   +'<label>Series rule<select id="iptvSeriesMode"><option value="new">Verified new broadcasts only</option><option value="unseen">Every unique episode, including reruns (episode details)</option><option value="all">Every airing, including repeats</option></select></label>'
   +'<button class="secondary" id="iptvSeriesRecord">Schedule series</button></div></div>');
  document.querySelector("#iptvTune").onclick=()=>selectChannel(best.channel_id);
  document.querySelector("#iptvRecordOnce").onclick=async()=>{try{
   if(!connected||p.id.startsWith("local:"))throw Error("Connect and sync your always-on recorder before scheduling");
   await recorder("/recordings","POST",{program_id:best.id});toast("Recording scheduled");closeModal();await reloadDvr();
  }catch(e){toast(String(e.message||e))}};
  document.querySelector("#iptvSeriesRecord").onclick=async()=>{try{
   if(!connected||p.id.startsWith("local:"))throw Error("Connect your recorder and reload the guide first");
   await recorder("/rules","POST",{channel_id:best.channel_id,title:p.title,mode:document.querySelector("#iptvSeriesMode").value});
   toast("Series recording rule saved");closeModal();await reloadDvr();
  }catch(e){toast(String(e.message||e))}};
 }
 async function reloadDvr(){try{const r=await recorder("/recordings");jobs=r.jobs||[];rules=r.rules||[];render()}catch(e){error=String(e.message||e);render()}}
 function formValues(){
  cfg.name=document.querySelector("#iptvName").value.trim().slice(0,80)||"My IPTV";
  cfg.m3u=document.querySelector("#iptvM3U").value.trim();
  cfg.xmltv=document.querySelector("#iptvXMLTV").value.trim();
  cfg.host=document.querySelector("#iptvHost").value.trim();
  cfg.token=document.querySelector("#iptvToken").value.trim();
  save();
 }
 async function uploadFiles(){
  const m3ufile=document.querySelector("#iptvFileM3U")?.files?.[0],xmlfile=document.querySelector("#iptvFileGuide")?.files?.[0];
  if(!m3ufile){error="Choose an M3U playlist file first";render();return}
  if(m3ufile.size>5*1024*1024||xmlfile&&xmlfile.size>25*1024*1024){error="Uploaded guide or playlist is too large";render();return}
  try{channels=parseM3U(await m3ufile.text());programs=xmlfile?parseGuide(await xmlfile.text(),channels):[];indexPrograms();connected=false;error="";message="Loaded "+channels.length+" local channels. Connect an always-on recorder for scheduled recordings."}
  catch(e){error=String(e.message||e)}render();
 }
 async function syncRecorder(){
  formValues();
  try{
   if(!cfg.m3u)throw Error("Provide a provider M3U URL before syncing with DVR");
   await recorder("/sources","POST",{m3u_url:cfg.m3u,xmltv_url:cfg.xmltv});
   await loadRecorder();render();toast("Your recorder guide is synced");
  }catch(e){error=String(e.message||e);render()}
 }
 async function downloadRecording(id){
  try{
   const url=recordHost()+"/recordings/"+encodeURIComponent(id)+"/file",r=await fetch(url,{headers:{Authorization:"Bearer "+cfg.token}});
   if(!r.ok)throw Error("Recording download unavailable");
   const blob=await r.blob(),file=jobs.find(j=>j.id===id);
   const link=document.createElement("a"),href=URL.createObjectURL(blob);
   link.href=href;link.download=String(file?.file||"luma-recording.ts").replace(/[^A-Za-z0-9_.-]/g,"_");
   document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
  }catch(e){toast(String(e.message||e))}
 }
 function bind(){
  document.querySelector("#iptvSources").onsubmit=e=>{e.preventDefault();formValues();updateLocal()};
  document.querySelector("#iptvConnectRecorder").onclick=()=>{formValues();updateLocal()};
  document.querySelector("#iptvSyncRecorder").onclick=syncRecorder;
  document.querySelector("#iptvLoadFiles").onclick=uploadFiles;
  document.querySelector("#iptvSearch").oninput=e=>{search=e.target.value;render()};
  document.querySelector("#iptvFilter").onchange=e=>{filter=e.target.value;render()};
  document.querySelector("#iptvBackTime").onclick=()=>{offset=Math.max(-48,offset-2);render()};
  document.querySelector("#iptvNextTime").onclick=()=>{offset=Math.min(336,offset+2);render()};
  document.querySelector("#iptvNow").onclick=()=>{offset=0;render()};
  document.querySelector("#iptvRefresh").onclick=async()=>{if(connected){try{await recorder("/refresh","POST",{});await loadRecorder();error="";render()}catch(e){error=String(e.message||e);render()}}else updateLocal()};
  for(const b of document.querySelectorAll("[data-program]"))b.onclick=()=>selectProgramme(b.dataset.program);
  for(const b of document.querySelectorAll("[data-channel]"))b.onclick=()=>selectChannel(b.dataset.channel);
  for(const b of document.querySelectorAll("[data-remove-rule]"))b.onclick=async()=>{try{await recorder("/rules/"+encodeURIComponent(b.dataset.removeRule),"DELETE");await reloadDvr()}catch(e){toast(String(e.message||e))}};
  for(const b of document.querySelectorAll("[data-cancel-recording]"))b.onclick=async()=>{try{await recorder("/recordings/"+encodeURIComponent(b.dataset.cancelRecording),"DELETE");await reloadDvr()}catch(e){toast(String(e.message||e))}};
  for(const b of document.querySelectorAll("[data-download-recording]"))b.onclick=()=>downloadRecording(b.dataset.downloadRecording);
 }
 return {render,parseM3U,parseGuide,xmlTime,episodeNum,getConfig:()=>({...cfg,token:cfg.token?"••••":""}),loadGuide:updateLocal};
})();
