
"use strict";
/* Luma Live TV: local M3U/XMLTV guide and optional authenticated always-on recorder. */
const LumaIPTV=(()=>{
 const key="luma.iptv.v1";
 let cfg;try{cfg=JSON.parse(localStorage.getItem(key)||"{}")}catch{cfg={}}
 cfg={name:"My IPTV",m3u:"",xmltv:"",host:"",token:"",favorites:[],epgSources:[],epgMappings:{},browserSources:[],...cfg};
 cfg.browserSources=Array.isArray(cfg.browserSources)?cfg.browserSources.slice(0,10):[];
 cfg.epgSources=Array.isArray(cfg.epgSources)?cfg.epgSources.slice(0,25):[];
 cfg.epgMappings=cfg.epgMappings&&typeof cfg.epgMappings==="object"&&!Array.isArray(cfg.epgMappings)?cfg.epgMappings:{};
 cfg.favorites=Array.isArray(cfg.favorites)?cfg.favorites:[];
 let displayMode="home",initialized=false,channels=[],programs=[],jobs=[],rules=[],sources=[],epgSources=cfg.epgSources,epgMappings=cfg.epgMappings,loading=false,connected=false,error="",message="",filter="",search="",offset=0,channelPage=0,selected=null,playerOpen=false;
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
    &&Math.abs(p.start-program.start)<=15*60000
    &&(!program.episode||!p.episode||p.episode===program.episode)
    &&(!program.subtitle||!p.subtitle||p.subtitle.trim().toLowerCase()===program.subtitle.trim().toLowerCase());
  const options=programs.filter(match);
  return program; // A selected IPTV service must not silently switch providers.
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
    info={name:(s.includes(",")?s.slice(s.indexOf(",")+1):"TV Channel").trim().slice(0,100),epg_id:a("tvg-id"),logo:a("tvg-logo"),group:a("group-title"),number:a("tvg-chno")||a("channel-number"),quality:/\b4K\b/i.test(s)?2:/\b(FHD|HD|1080P)\b/i.test(s)?1:0};
   }else if(info&&s&&!s.startsWith("#")){
    if(validURL(s)){rows.push({...info,id:"iptv:"+hash(info.epg_id+"|"+info.name+"|"+s),url:s});
     if(rows.length>=2500)break}
    info=null;
   }
  }
  return rows;
 }
 function separatePlaylist(rows){
  const items=typeof LumaVOD!=="undefined"?LumaVOD.parse(rows):[];
  const ids=new Set(items.map(item=>item.id));
  if(typeof LumaVOD!=="undefined")LumaVOD.setRows(rows);
  channels=rows.filter(item=>!ids.has(item.id));
  return items.length;
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
 function parseEPGCatalog(source){
  if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error("Unsafe XMLTV declarations rejected");
  const doc=new DOMParser().parseFromString(source,"application/xml");
  if(doc.querySelector("parsererror")||doc.documentElement.nodeName!=="tv")throw Error("Invalid XMLTV guide");
  const entries=[],seen=new Set();
  for(const el of [...doc.getElementsByTagName("channel")].slice(0,10000)){
   const id=String(el.getAttribute("id")||"").slice(0,160);
   if(!id||seen.has(id))continue;seen.add(id);
   entries.push({id,name:el.getElementsByTagName("display-name")[0]?.textContent?.trim().slice(0,160)||id});
  }
  return entries;
 }
 function parseGuide(source,stations,mode={}){
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
   const id=el.getAttribute("channel"),options=byGuide.get(id)||(!mode.strict?byName.get(names.get(id)):null)||[];
   if(!options.length)continue;
   const start=xmlTime(el.getAttribute("start")),end=xmlTime(el.getAttribute("stop"));
   if(!start||end<=start||end<now-3600000||start>now+14*86400000)continue;
   const title=el.getElementsByTagName("title")[0]?.textContent?.trim().slice(0,160);if(!title)continue;
   const targets=mode.assignAll?options:[[...options].sort((a,b)=>(b.quality||0)-(a.quality||0))[0]];
   for(const channel of targets){
    const identifier="local:"+hash(channel.id+"|"+start+"|"+end+"|"+title);
    if(seen.has(identifier))continue;seen.add(identifier);
    const categories=[...el.getElementsByTagName("category")].map(x=>String(x.textContent||"").trim().toLowerCase());
    const is_live_event=!!el.getElementsByTagName("live").length||categories.some(x=>["live","live event","live sports","live sport","live broadcast"].includes(x));
    results.push({id:identifier,channel_id:channel.id,title,start,end,episode:episodeNum(el),is_live_event,
     guide_source:mode.sourceName||"",
     subtitle:el.getElementsByTagName("sub-title")[0]?.textContent?.slice(0,100)||"",
     description:el.getElementsByTagName("desc")[0]?.textContent?.slice(0,330)||"",
     is_new:!!el.getElementsByTagName("new").length||!!el.getElementsByTagName("premiere").length,
     rerun:!!el.getElementsByTagName("previously-shown").length});
   }
  }
  return results.sort((a,b)=>a.start-b.start);
 }
 function mergeGuide(existing,incoming){
  const map=new Map();
  for(const p of existing){if(!map.has(p.channel_id))map.set(p.channel_id,[]);map.get(p.channel_id).push(p)}
  const norm=s=>String(s||"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  for(const p of incoming){
   if(!map.has(p.channel_id))map.set(p.channel_id,[]);
   const rows=map.get(p.channel_id);
   const match=rows.find(x=>Math.abs(x.start-p.start)<300001&&Math.abs(x.end-p.end)<300001&&norm(x.title)===norm(p.title));
   if(match){
    match.is_live_event=!!(match.is_live_event||p.is_live_event);
    match.rerun=!!(match.rerun||p.rerun);
    match.is_new=!!(match.is_new||p.is_new)&&!match.rerun;
    for(const key of ["episode","description","subtitle"])if(String(p[key]||"").length>String(match[key]||"").length)match[key]=p[key];
   }else if(!rows.some(x=>Math.max(x.start,p.start)<Math.min(x.end,p.end)))rows.push(p);
  }
  return [...map.values()].flat().sort((a,b)=>a.start-b.start);
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
 function browserURL(source){
  if(source.type!=="xtream")return source.m3u_url;
  const panel=String(source.server||"").trim().replace(/\/+$/,""),u=new URL(panel);
  if(!validURL(panel)||u.username||u.password||!source.username||!source.password)throw Error("Invalid Xtream credentials");
  return panel+"/get.php?"+new URLSearchParams({username:source.username,password:source.password,type:"m3u_plus",output:source.output==="ts"?"ts":"m3u8"});
 }
 function browserEPG(source){
  if(source.xmltv_url)return source.xmltv_url;
  return source.type==="xtream"?String(source.server||"").replace(/\/+$/,"")+"/xmltv.php?"+new URLSearchParams({username:source.username,password:source.password}):"";
 }
 async function addProvider(input){
  const type=input.type==="xtream"?"xtream":"m3u",name=String(input.name||"My IPTV").trim().slice(0,80);
  if(!name)throw Error("Provide a service name");
  const source={type,name,xmltv_url:String(input.xmltv_url||"").trim()};
  if(type==="xtream"){
   source.server=String(input.server||"").trim().replace(/\/+$/,"");
   source.username=String(input.username||"").trim();
   source.password=String(input.password||"");
   source.output=input.output==="ts"?"ts":"m3u8";
   const panel=new URL(source.server);
   if(!validURL(source.server)||panel.username||panel.password||!source.username||!source.password)throw Error("Enter a valid Xtream account");
  }else{
   source.m3u_url=String(input.m3u_url||"").trim();
   if(!validURL(source.m3u_url))throw Error("Enter a valid playlist URL");
  }
  if(source.xmltv_url&&!validURL(source.xmltv_url))throw Error("Invalid guide URL");
  if(cfg.host&&cfg.token){
   const reply=await recorder("/sources","POST",source);
   await loadRecorder();render("connections");
   return reply;
  }
  // Direct-browser Xtream works when the provider permits cross-origin feeds.
  // The native/companion route remains recommended if CORS is restricted.
  const rows=parseM3U(await readRemote(browserURL(source),6*1024*1024));
  if(!rows.length)throw Error("The service returned no IPTV channels");
  const same=cfg.browserSources.find(x=>x.type===source.type&&(type==="m3u"?x.m3u_url===source.m3u_url:x.server===source.server&&x.username===source.username));
  if(!same&&cfg.browserSources.length>=9)throw Error("Maximum 10 services");
  source.id=same?.id||"local:"+hash(name+"|"+type+"|"+(source.server||source.m3u_url));
  if(same)Object.assign(same,source);else cfg.browserSources.push(source);
  save();await updateLocal();render("connections");
  return {ok:true,channels:rows.length};
 }
 async function removeProvider(id){
  if(connected){
   await recorder("/sources/"+encodeURIComponent(id),"DELETE");
   await recorder("/refresh","POST",{});await loadRecorder();
  }else{
   cfg.browserSources=cfg.browserSources.filter(x=>x.id!==id);
   save();await updateLocal();
  }
  render("connections");
 }
 function setFilter(value,redraw=true){filter=value;channelPage=0;if(redraw)render("guide")}
 async function loadRecorder(){
  const r=await recorder("/guide");channels=Array.isArray(r.channels)?r.channels:[];programs=Array.isArray(r.programs)?r.programs:[];indexPrograms();connected=true;
  const other=await recorder("/recordings");jobs=other.jobs||[];rules=other.rules||[];
  try{const result=await recorder("/sources");sources=result.sources||[]}catch{sources=[]}
  try{const result=await recorder("/epg/sources");epgSources=result.sources||[];epgMappings=result.mappings||{}}catch{epgSources=[];epgMappings={}}
  message=channels.length+" channels · "+programs.length+" guide programs loaded from your recorder";error="";
 }
 async function updateLocal(){
  loading=true;error="";message="";render();
  try{
   if(cfg.host&&cfg.token){await loadRecorder()}
   else{
    const providers=[...(cfg.m3u?[{id:"legacy",type:"m3u",name:cfg.name,m3u_url:cfg.m3u,xmltv_url:cfg.xmltv}]:[]),...cfg.browserSources];
    if(!providers.length)throw Error("Connect an M3U playlist or Xtream service to get started");
    const all=[],groups=[],errors=[],ids=new Set();
    for(const provider of providers){
     try{
      const rows=parseM3U(await readRemote(browserURL(provider),6*1024*1024)).map(item=>{
       const c={...item,provider:provider.name,provider_id:provider.id};
       if(ids.has(c.id))c.id=provider.id+":"+c.id;
       ids.add(c.id);return c;
      });
      all.push(...rows);groups.push({provider,rows});
     }catch(e){errors.push(provider.name+": "+String(e.message||e))}
    }
    if(!all.length)throw Error("No IPTV service could load. "+errors.join(" · ").slice(0,200));
    separatePlaylist(all);
    programs=[];
    for(const group of groups){
     const feed=browserEPG(group.provider);
     const ordinary=channels.filter(c=>c.provider_id===group.provider.id&&!epgMappings[c.id]);
     if(!feed||!ordinary.length)continue;
     try{programs.push(...parseGuide(await readRemote(feed,25*1024*1024),ordinary,{sourceName:group.provider.name}))}
     catch(e){errors.push("Guide "+group.provider.name+": "+String(e.message||e))}
    }
    for(const guide of epgSources){
     const mapped=channels.filter(c=>epgMappings[c.id]?.source_id===guide.id)
      .map(c=>({...c,epg_id:epgMappings[c.id].epg_channel_id}));
     if(!mapped.length&&!guide.auto_fill||!guide.url)continue;
     try{
      const feed=await readRemote(guide.url,25*1024*1024);
      if(mapped.length)programs=mergeGuide(programs,parseGuide(feed,mapped,{strict:true,assignAll:true,sourceName:guide.name}));
      if(guide.auto_fill)programs=mergeGuide(programs,parseGuide(feed,channels.filter(c=>!epgMappings[c.id]),{strict:true,assignAll:true,sourceName:guide.name}));
     }catch(e){errors.push("Extra guide "+guide.name+": "+String(e.message||e))}
    }
    indexPrograms();connected=false;
    message=channels.length+" channels · "+programs.length+" EPG listings · "+groups.length+" services";
    if(errors.length)error="Some providers/EPG feeds unavailable: "+errors.join(" · ").slice(0,350);
   }
  }catch(e){error=String(e.message||e);connected=false}
  finally{loading=false;render()}
 }
 function getChannels(){
  const q=search.toLowerCase(),list=channels.filter(c=>(filter==="all"||filter==="favorites"&&cfg.favorites.includes(c.id)||c.group===filter)&&(!q||[c.name,c.provider,c.group,c.epg_id].some(v=>String(v||"").toLowerCase().includes(q))||(programsByChannel.get(c.id)||[]).some(p=>[p.title,p.subtitle,p.description].some(v=>String(v||"").toLowerCase().includes(q)))));
  if(q)list.sort((a,b)=>(b.quality||0)-(a.quality||0)||a.name.localeCompare(b.name));
  return list;
 }
 function windowStart(){return Math.floor(Date.now()/1800000)*1800000+offset*3600000}
 const byChannel=id=>programsByChannel.get(id)||[];
 function guideHTML(){
  if(!channels.length)return '<div class="iptvEmpty"><h3>Connect your TV channels</h3><p>Add an IPTV playlist. You can then map every channel to a different XMLTV feed.</p></div>';
  const start=windowStart(),end=start+3*3600000,all=getChannels(),last=Math.max(0,Math.ceil(all.length/80)-1);
  channelPage=Math.min(channelPage,last);
  const current=Date.now(),nowAt=100*(current-start)/(end-start),rows=all.slice(channelPage*80,(channelPage+1)*80);
  const nowLine=nowAt>=0&&nowAt<=100?'<span class="iptvNowIndicator" style="left:'+nowAt.toFixed(2)+'%"></span>':"";
  const heading='<div class="iptvGuideHeader"><div class="iptvChannelHeading">YOUR CHANNELS</div><div class="iptvTimeHeader">'
   +Array.from({length:6},(_,i)=>'<span>'+showClock(start+i*30*60000)+'</span>').join("")+'</div></div>';
  const body=rows.map((c,i)=>{
   const entries=byChannel(c.id).filter(p=>p.end>start&&p.start<end);
   const cells=entries.map(p=>{
    const left=Math.max(0,100*(p.start-start)/(end-start)),right=Math.min(100,100*(p.end-start)/(end-start)),width=Math.max(1,right-left),
     active=p.start<=current&&p.end>current,progress=Math.max(0,Math.min(100,100*(current-p.start)/(p.end-p.start)));
    return '<button class="iptvProgram '+(active?'isLive ':'')+(p.is_new?'isNew':'')+'" type="button" style="left:'+left.toFixed(2)+'%;width:calc('+width.toFixed(2)+'% - 2px)" data-program="'+esc(p.id)+'" title="'+esc(p.title)+'"><b>'+esc(p.title)+'</b>'
     +'<span>'+showClock(p.start)+(p.episode?' · '+esc(p.episode):'')+(p.is_new&&!p.rerun?' · NEW':'')+(p.is_live_event?' · LIVE EVENT':'')+'</span>'
     +(active?'<span class="iptvLiveProgress" style="--progress:'+progress.toFixed(1)+'%"></span>':"")+'</button>';
   }).join("");
   const mapped=epgMappings[c.id],guideSource=epgSources.find(x=>x.id===mapped?.source_id);
   return '<div class="iptvGuideRow"><div class="iptvChannelCell">'
    +'<button class="iptvFavorite '+(cfg.favorites.includes(c.id)?'on':'')+'" data-iptv-fav="'+esc(c.id)+'" aria-label="Favorite '+esc(c.name)+'">'+(cfg.favorites.includes(c.id)?'★':'☆')+'</button>'
    +'<button class="iptvChannel" data-channel="'+esc(c.id)+'" title="Watch '+esc(c.name)+'"><span class="iptvChannelNumber">'+esc(c.number||String(channelPage*80+i+1))+'</span>'
    +(validURL(c.logo)?'<img loading="lazy" src="'+esc(c.logo)+'" alt="" onerror="this.remove()">':'<span class="iptvChannelGlyph">▣</span>')
    +'<span class="iptvChannelText"><strong>'+esc(c.name)+'</strong><small>'+esc(c.provider||"Local IPTV")+' · '+esc(c.group||"Live TV")+(typeof LumaIPTVPortal!=="undefined"&&LumaIPTVPortal.zone(c.name)?' · '+esc(LumaIPTVPortal.zone(c.name)):'')+'</small></span></button>'
    +'<button class="iptvMapButton" data-iptv-map="'+esc(c.id)+'" title="'+esc(guideSource?'Mapped to '+guideSource.name:'Assign EPG')+'">'+(guideSource?'✓ EPG':'EPG')+'</button></div>'
    +'<div class="iptvTimeline">'+(cells||'<span class="iptvGuideMissing">No guide · Tap EPG to assign</span>')+nowLine+'</div></div>';
  }).join("");
  return '<div class="iptvGuideScroll" tabindex="0" aria-label="Interactive television guide">'+heading+body+'</div>'
   +'<div class="iptvGuidePager"><span>'+(!all.length?'No matching channels':(channelPage*80+1)+'–'+Math.min(all.length,(channelPage+1)*80)+' of '+all.length+' channels')+'</span>'
   +'<button type="button" class="secondary small" id="iptvPrevChannels" '+(channelPage===0?'disabled':'')+'>‹ Previous channels</button>'
   +'<button type="button" class="secondary small" id="iptvNextChannels" '+(channelPage>=last?'disabled':'')+'>Next channels ›</button></div>'
   +'<p class="micro">Choose a show to watch or record. Press EPG on any channel to change its guide source. All times follow your device timezone.</p>';
 }
 function nowPlayingHTML(){
  const now=Date.now(),picks=channels.map(c=>({channel:c,show:byChannel(c.id).find(p=>p.start<=now&&p.end>now)}))
    .filter(x=>x.show).sort((a,b)=>(b.channel.quality||0)-(a.channel.quality||0)).slice(0,7);
  if(!picks.length)return "";
  return '<section class="iptvNowDeck"><div class="iptvSectionHead"><h2>On right now</h2><span>Live across your channels</span></div><div class="iptvNowCards">'
   +picks.map(({channel:c,show:p})=>'<button class="iptvNowCard" data-program="'+esc(p.id)+'"><span class="iptvOnAirDot">● ON AIR</span>'
   +'<strong>'+esc(p.title)+'</strong><small>'+esc(c.name)+' · Ends '+showClock(p.end)+'</small></button>').join("")+'</div></section>';
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
  return '<div class="iptvDvrRow"><div><strong>'+esc(j.title)+'</strong><small>'+showDate(j.start)+' · '+esc(j.status)+(j.episode?' · '+esc(j.episode):'')
   +(j.retry_pending?' · Awaiting exact episode rerun on any channel':'')+(j.retry_job_id?' · Alternate-channel retry scheduled':'')
   +(j.processing==='encoding'?' · Converting to H.265':j.processing==='hevc_complete'?' · H.265 saved':j.processing==='hevc_failed_original_kept'?' · Original kept':'')
   +(j.saved_bytes?' · Saved '+(Number(j.saved_bytes)/1048576).toFixed(1)+' MB':'')
   +(j.error?' · '+esc(j.error):'')+'</small></div>'
   +(j.status==="complete"?'<button class="secondary small" data-download-recording="'+esc(j.id)+'">Save to device</button>':j.status==="scheduled"?'<button class="secondary small" data-cancel-recording="'+esc(j.id)+'">Cancel</button>':'')+'</div>';
 }
 function formHTML(){
  return '<details class="iptvSettings iptvAdvancedSettings"><summary><span>◉ DVR companion and local files</span><small>Optional server · imports</small></summary>'
   +'<div class="iptvCompanionPanel"><div><h3>Optional DVR companion</h3><p>Use this only if you want a second device to record. The Android TV app can record locally without a server.</p>'
   +'<label>HTTPS recorder address<input id="iptvHost" type="url" value="'+esc(cfg.host)+'" placeholder="https://recorder.example.com"></label>'
   +'<label>Private recorder token<input id="iptvToken" type="password" autocomplete="off" value="'+esc(cfg.token)+'"></label>'
   +'<button type="button" id="iptvConnectRecorder" class="secondary">Connect DVR companion</button>'
   +'<p class="micro"><a href="https://github.com/cj42izzle/Luma-Media-Center/tree/main/recorder" target="_blank" rel="noopener">Companion setup instructions</a></p></div>'
   +'<div><h3>Local playlist files</h3><p>Use an M3U file and optional XMLTV guide for device-only browsing.</p>'
   +'<label>M3U file<input id="iptvFileM3U" type="file" accept=".m3u,.m3u8,.txt"></label>'
   +'<label>XMLTV file<input id="iptvFileGuide" type="file" accept=".xml,.xmltv,.txt"></label>'
   +'<button type="button" id="iptvLoadFiles" class="secondary">Import local files</button></div></div></details>';
 }
 function connectionsHTML(){
  const rows=connected?sources:[...(cfg.m3u?[{id:"legacy",name:cfg.name||"Original IPTV",type:"m3u",has_guide:!!cfg.xmltv}]:[]),
   ...cfg.browserSources.map(p=>({id:p.id,name:p.name,type:p.type,has_guide:!!browserEPG(p)}))];
  return (typeof LumaIPTVPortal!=="undefined"?LumaIPTVPortal.setupHTML():"")
   +'<section class="iptvProviderList"><div class="iptvSectionHead"><h3>Your connected IPTV services</h3><small>'+rows.length+' / 10</small></div>'
   +(rows.length?rows.map(p=>'<div class="iptvProviderRow"><div><b>'+esc(p.name)+'</b><small>'
       +(p.type==="xtream"?"Xtream account":"M3U playlist")+' · '+(p.has_guide?"EPG included":"Choose an EPG below")+'</small></div>'
       +'<button type="button" class="secondary small" data-iptv-local-remove="'+esc(p.id)+'">Remove</button></div>').join("")
       :'<p class="micro">Connect an M3U playlist or Xtream account above to get started.</p>')+'</section>'
   +formHTML()+(typeof LumaEPGUI!=="undefined"?LumaEPGUI.managerHTML():"");
 }
 function guideControls(groups){
  return '<div class="iptvToolbar"><label>Channel, programme or provider<input id="iptvSearch" type="search" value="'+esc(search)+'" placeholder="Search across all IPTV services"></label>'
   +'<label>Category<select id="iptvFilter"><option value="all">All channels</option><option value="favorites"'+(filter==="favorites"?" selected":"")+'>★ Favorites</option>'
   +groups.map(g=>'<option value="'+esc(g)+'"'+(filter===g?' selected':'')+'>'+esc(g)+'</option>').join("")+'</select></label>'
   +'<button class="secondary" id="iptvBackTime">‹ Earlier</button><button class="secondary" id="iptvNow">Now</button>'
   +'<button class="secondary" id="iptvNextTime">Later ›</button><button class="secondary" id="iptvRefresh" '+(loading?'disabled':'')+'>'
   +(loading?'Refreshing…':'↻ Refresh')+'</button></div>';
 }
 function render(view){
  if(["home","guide","recordings","connections"].includes(view))displayMode=view;
  const el=document.querySelector("#content");if(!el)return;
  const old=document.querySelector(".iptvGuideScroll"),position=old?{x:old.scrollLeft,y:old.scrollTop}:null;
  const active=document.activeElement?.id,caret=document.activeElement?.selectionStart;
  const groups=[...new Set(channels.map(c=>c.group).filter(Boolean))].sort();
  const alert=(error?'<div class="notice" role="alert">'+esc(error)+'</div>':"")
   +(message?'<div class="iptvMessage" role="status">'+esc(message)+'</div>':"");
  const portal=typeof LumaIPTVPortal!=="undefined"?LumaIPTVPortal:null;
  const nProviders=connected?sources.length:cfg.browserSources.length+(cfg.m3u?1:0);
  if(displayMode==="home"){
   el.innerHTML=alert+(portal?portal.homeHTML({channels,programs,favorites:cfg.favorites}):
    '<div class="iptvPortalEmpty">Add an IPTV service to get started.</div>');
  }else if(displayMode==="guide"){
   el.innerHTML='<section class="iptvGuidePage"><div class="iptvSectionHead"><div><div class="eyebrow">LIVE TELEVISION</div><h2>Channel guide</h2></div>'
    +'<span>'+channels.length+' channels · '+nProviders+' services</span></div>'+alert+guideControls(groups)
    +'<div class="iptvSectionHead"><h2>On your channels</h2><span>'+showDate(windowStart())+' – '+showClock(windowStart()+3*3600000)+'</span></div>'
    +guideHTML()+'</section>';
  }else if(displayMode==="recordings"){
   el.innerHTML='<section class="iptvRecordingsPage"><div class="iptvSectionHead"><div><div class="eyebrow">LUMA DVR</div><h2>Recordings</h2></div>'
    +'<button class="secondary small" data-iptv-mode="guide">+ Schedule a programme</button></div>'+alert+recordingHTML()+'</section>';
  }else {
   el.innerHTML=alert+connectionsHTML();
  }
  bind();
  if(position){const g=document.querySelector(".iptvGuideScroll");if(g){g.scrollLeft=position.x;g.scrollTop=position.y}}
  if(active==="iptvSearch"){const input=document.getElementById(active);if(input){input.focus({preventScroll:true});if(Number.isInteger(caret))input.setSelectionRange(caret,caret)}}
  if(!initialized&&((cfg.host&&cfg.token)||cfg.m3u||cfg.browserSources.length)){
   initialized=true;Promise.resolve().then(updateLocal).catch(e=>{error=String(e.message||e);render()});
  }
 }
 function openGuideMiniPlayer(channel,video){
  let dock=document.getElementById("iptvMiniDock");
  if(!dock){
   dock=document.createElement("section");dock.id="iptvMiniDock";dock.className="iptvMiniDock";
   dock.setAttribute("aria-label","Live TV mini player");document.body.appendChild(dock);
   dock.innerHTML='<div class="iptvMiniBar"><span class="iptvOnAirDot">● LIVE</span><strong id="iptvMiniTitle">Live TV</strong>'
    +'<button type="button" id="iptvMiniCollapse" title="Minimize player" aria-label="Minimize player">▁</button>'
    +'<button type="button" id="iptvMiniClose" title="Stop TV" aria-label="Stop TV">✕</button></div><div class="iptvMiniScreen"></div>';
   dock.querySelector("#iptvMiniClose").onclick=()=>{const v=dock.querySelector("video");if(v){v.pause();v.removeAttribute("src");v.load()}dock.remove()};
   dock.querySelector("#iptvMiniCollapse").onclick=()=>dock.classList.toggle("collapsed");
  }
  dock.querySelector("#iptvMiniTitle").textContent=channel.name;
  dock.querySelector(".iptvMiniScreen").replaceChildren(video);
  dock.classList.remove("collapsed");
  video.src=channel.url;
  video.play().catch(()=>toast("Browser playback unavailable; use an external player for this channel."));
  closeModal();
 }
 function selectChannel(id){
  const channel=byID(id);if(!channel)return;
  selected=null;
  modal('<div class="iptvWatch"><div class="eyebrow">LIVE CHANNEL</div><h2>'+esc(channel.name)+'</h2>'
   +'<video id="iptvPlayer" controls playsinline preload="none"></video>'
   +'<p class="micro">Browser playback requires a supported codec and stream format. If this channel does not play in-browser, use your preferred external player.</p>'
   +'<div class="actions"><button class="primary" id="iptvStartPlayback">▶ Play in Luma</button><button class="secondary" id="iptvExternalPlayer">Open external player</button><button class="secondary" id="iptvWatchGuide">Watch & browse guide</button></div>'
   +'<div class="iptvSeriesRecorder"><h3>Record channel now</h3><p>For channels without a program listing, record a timed segment to your connected recorder.</p>'
   +'<label>Duration<select id="iptvRecordDuration"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="90">90 minutes</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option></select></label>'
   +'<button class="secondary" id="iptvRecordChannelNow">● Record Channel Now</button></div></div>');
  const video=document.querySelector("#iptvPlayer");
  document.querySelector("#iptvStartPlayback").onclick=()=>{video.src=channel.url;video.play().catch(()=>toast("Playback unavailable in this browser. Try the external player."))};
  document.querySelector("#iptvExternalPlayer").onclick=()=>window.open(channel.url,"_blank","noopener");
  document.querySelector("#iptvWatchGuide").onclick=()=>openGuideMiniPlayer(channel,video);
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
  const alternatives=programs.filter(other=>other.id!==p.id&&other.title.trim().toLowerCase()===p.title.trim().toLowerCase()
   &&(!p.episode||other.episode===p.episode)&&Math.abs(other.start-p.start)<=24*3600000)
   .sort((a,b)=>a.start-b.start).slice(0,12);
  modal('<div class="iptvProgrammeDetail"><div class="eyebrow">'+(running?'● ON NOW':p.is_live_event?'● LIVE EVENT':p.is_new&&!p.rerun?'✦ NEW EPISODE':'PROGRAM GUIDE')+'</div><h2>'+esc(p.title)+'</h2>'
   +'<div class="iptvProgrammeMeta"><span>'+esc(channel?.name||"Unknown channel")+' · '+esc(channel?.provider||"IPTV")+'</span><span>'+showDate(p.start)+' – '+showClock(p.end)+'</span>'+(p.episode?'<span>'+esc(p.episode)+'</span>':"")+(p.rerun?'<span>Repeat</span>':"")+'</div>'
   +(p.subtitle?'<h3>'+esc(p.subtitle)+'</h3>':"")+(p.description?'<p>'+esc(p.description)+'</p>':"")
   +'<div class="iptvDetailButtons"><button class="primary" id="iptvTune">▶ Watch channel</button><button class="secondary" id="iptvRecordOnce">● Record this airing</button></div>'
   +(alternatives.length?'<section class="iptvOtherAirings"><h3>Other providers & time-shifted airings</h3><p class="micro">Choose a channel and time deliberately. A later showing of this exact episode can be used if recording fails.</p><div class="iptvAiringChoices">'
     +alternatives.map(a=>'<button type="button" class="secondary small" data-iptv-alternative="'+esc(a.id)+'">'+esc(byID(a.channel_id)?.provider||"IPTV")+' · '+esc(byID(a.channel_id)?.name||"Channel")+' · '+showDate(a.start)+'</button>').join("")+'</div></section>':"")
   +'<div class="iptvSeriesRecorder"><h3>Series recording</h3><p>New-only uses confirmed first-run guide markers. Every unique episode matches episode numbers, subtitles, or detailed descriptions to avoid duplicates, including reruns. Every airing also records repeats.</p>'
   +'<label>Series rule<select id="iptvSeriesMode"><option value="new">Verified new broadcasts only</option><option value="unseen">Every unique episode, including reruns (episode details)</option><option value="all">Every airing, including repeats</option></select></label>'
   +'<button class="secondary" id="iptvSeriesRecord">Schedule series</button></div></div>');
  document.querySelector("#iptvTune").onclick=()=>selectChannel(best.channel_id);
  for(const b of document.querySelectorAll("[data-iptv-alternative]"))b.onclick=()=>selectProgramme(b.dataset.iptvAlternative);
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
  const name=document.querySelector("#iptvName"),playlist=document.querySelector("#iptvM3U"),
        epg=document.querySelector("#iptvXMLTV"),host=document.querySelector("#iptvHost"),
        token=document.querySelector("#iptvToken");
  if(name)cfg.name=name.value.trim().slice(0,80)||"My IPTV";
  if(playlist)cfg.m3u=playlist.value.trim();
  if(epg)cfg.xmltv=epg.value.trim();
  if(host)cfg.host=host.value.trim();
  if(token)cfg.token=token.value.trim();
  save();
 }
 async function uploadFiles(){
  const m3ufile=document.querySelector("#iptvFileM3U")?.files?.[0],xmlfile=document.querySelector("#iptvFileGuide")?.files?.[0];
  if(!m3ufile){error="Choose an M3U playlist file first";render();return}
  if(m3ufile.size>5*1024*1024||xmlfile&&xmlfile.size>25*1024*1024){error="Uploaded guide or playlist is too large";render();return}
  try{const rows=parseM3U(await m3ufile.text());separatePlaylist(rows);programs=xmlfile?parseGuide(await xmlfile.text(),channels):[];indexPrograms();connected=false;error="";message="Loaded "+channels.length+" local channels. Connect an always-on recorder for scheduled recordings."}
  catch(e){error=String(e.message||e)}render();
 }
 async function syncRecorder(){
  formValues();
  try{
   if(!cfg.m3u)throw Error("Provide a provider M3U URL before syncing with DVR");
   await recorder("/sources","POST",{name:cfg.name,m3u_url:cfg.m3u,xmltv_url:cfg.xmltv});
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
  const on=(selector,event,handler)=>{const el=document.querySelector(selector);if(el)el[event]=handler};
  on("#iptvSources","onsubmit",e=>{e.preventDefault();formValues();updateLocal()});
  on("#iptvConnectRecorder","onclick",()=>{formValues();updateLocal()});
  on("#iptvSyncRecorder","onclick",syncRecorder);
  on("#iptvLoadFiles","onclick",uploadFiles);
  on("#iptvSearch","oninput",e=>{search=e.target.value;channelPage=0;render()});
  on("#iptvFilter","onchange",e=>{filter=e.target.value;channelPage=0;render()});
  on("#iptvPrevChannels","onclick",()=>{channelPage=Math.max(0,channelPage-1);render()});
  on("#iptvNextChannels","onclick",()=>{channelPage++;render()});
  on("#iptvBackTime","onclick",()=>{offset=Math.max(-48,offset-2);render()});
  on("#iptvNextTime","onclick",()=>{offset=Math.min(336,offset+2);render()});
  on("#iptvNow","onclick",()=>{offset=0;render()});
  if(typeof LumaEPGUI!=="undefined")LumaEPGUI.bind();
  if(typeof LumaIPTVPortal!=="undefined")LumaIPTVPortal.bind(displayMode);
  if(typeof LumaDeviceDVR!=="undefined")LumaDeviceDVR.bind();
  if(typeof LumaNativeRetry!=="undefined")LumaNativeRetry.bind();
  on("#iptvRefresh","onclick",async()=>{
   if(connected){try{await recorder("/refresh","POST",{});await loadRecorder();error="";render()}
    catch(e){error=String(e.message||e);render()}}
   else updateLocal();
  });
  for(const b of document.querySelectorAll("[data-iptv-remove]"))b.onclick=async()=>{
   try{await removeProvider(b.dataset.iptvRemove);toast("IPTV service removed")}
   catch(e){toast(String(e.message||e))}
  };
  for(const b of document.querySelectorAll("[data-program]"))b.onclick=()=>selectProgramme(b.dataset.program);
  for(const b of document.querySelectorAll("[data-channel]"))b.onclick=()=>selectChannel(b.dataset.channel);
  for(const b of document.querySelectorAll("[data-remove-rule]"))b.onclick=async()=>{
   try{await recorder("/rules/"+encodeURIComponent(b.dataset.removeRule),"DELETE");await reloadDvr()}
   catch(e){toast(String(e.message||e))}
  };
  for(const b of document.querySelectorAll("[data-cancel-recording]"))b.onclick=async()=>{
   try{await recorder("/recordings/"+encodeURIComponent(b.dataset.cancelRecording),"DELETE");await reloadDvr()}
   catch(e){toast(String(e.message||e))}
  };
  for(const b of document.querySelectorAll("[data-download-recording]"))b.onclick=()=>downloadRecording(b.dataset.downloadRecording);
 }
 async function guideCatalog(sourceId){
  const source=epgSources.find(x=>x.id===sourceId);
  if(!source)throw Error("Choose an EPG source");
  if(connected)return (await recorder("/epg/sources/"+encodeURIComponent(sourceId)+"/channels")).channels||[];
  return parseEPGCatalog(await readRemote(source.url,25*1024*1024));
 }
 async function guideAdd(name,url,autoFill=false){
  name=String(name||"").trim().slice(0,80);url=String(url||"").trim();
  if(!name||!/^https:\/\//i.test(url)&&(!connected||!/^http:\/\//i.test(url)))throw Error("Enter an EPG name and a valid XMLTV URL (HTTPS required in browser mode)");
  if(connected){
   await recorder("/epg/sources","POST",{name,url,auto_fill:!!autoFill});
   const data=await recorder("/epg/sources");epgSources=data.sources||[];epgMappings=data.mappings||{};
  }else{
   const catalog=parseEPGCatalog(await readRemote(url,25*1024*1024));
   if(!catalog.length)throw Error("XMLTV feed contains no channel IDs");
   const existing=epgSources.find(x=>x.url===url);
   if(existing){existing.name=name;existing.auto_fill=!!autoFill;}
   else{if(epgSources.length>=25)throw Error("Maximum 25 EPG sources");epgSources.push({id:"guide-"+hash(url),name,url,auto_fill:!!autoFill})}
   cfg.epgSources=epgSources;save();
  }
  render();
 }
 async function guideRemove(sourceId){
  if(connected){
   await recorder("/epg/sources/"+encodeURIComponent(sourceId),"DELETE");
   await recorder("/refresh","POST",{});await loadRecorder();
  }else{
   cfg.epgSources=cfg.epgSources.filter(x=>x.id!==sourceId);
   cfg.epgMappings=Object.fromEntries(Object.entries(cfg.epgMappings).filter(([,value])=>value.source_id!==sourceId));
   epgSources=cfg.epgSources;epgMappings=cfg.epgMappings;save();await updateLocal();
  }
  render();
 }
 async function guideSet(channelId,sourceId,epgChannelId){
  if(!byID(channelId))throw Error("IPTV channel not found");
  const available=await guideCatalog(sourceId);
  if(!available.some(x=>x.id===epgChannelId))throw Error("Choose an ID present in the selected XMLTV guide");
  if(connected){
   await recorder("/epg/mappings","POST",{channel_id:channelId,source_id:sourceId,epg_channel_id:epgChannelId});
   await loadRecorder();
  }else{
   cfg.epgMappings[channelId]={source_id:sourceId,epg_channel_id:epgChannelId};
   epgMappings=cfg.epgMappings;save();await updateLocal();
  }
  render();
 }
 async function guideReset(channelId){
  if(connected){
   await recorder("/epg/mappings/"+encodeURIComponent(channelId),"DELETE");
   await recorder("/refresh","POST",{});await loadRecorder();
  }else{
   delete cfg.epgMappings[channelId];epgMappings=cfg.epgMappings;save();await updateLocal();
  }
  render();
 }
 function favoriteToggle(channelId){
  const i=cfg.favorites.indexOf(channelId);
  if(i<0)cfg.favorites.push(channelId);else cfg.favorites.splice(i,1);
  save();render();
 }
 return {render,addProvider,removeProvider,setFilter,guideSources:()=>epgSources,guideMappings:()=>epgMappings,channels:()=>channels,programs:()=>programs,guideCatalog,guideAdd,guideRemove,guideSet,guideReset,favoriteToggle,isFavorite:(id)=>cfg.favorites.includes(id),isRecorderConnected:()=>connected,parseM3U,parseGuide,parseEPGCatalog,xmlTime,episodeNum,getConfig:()=>({...cfg,token:cfg.token?"••••":""}),loadGuide:updateLocal};
})();
