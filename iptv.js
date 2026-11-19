
"use strict";
/* Luma Live TV: local M3U/XMLTV guide and optional authenticated always-on recorder. */
const LumaIPTV=(()=>{
 const key="luma.iptv.v1";
 let cfg;try{cfg=JSON.parse(localStorage.getItem(key)||"{}")}catch{cfg={}}
 cfg={name:"My IPTV",m3u:"",xmltv:"",host:"",token:"",favorites:[],epgSources:[],epgMappings:{},browserSources:[],...cfg};
 cfg.browserSources=Array.isArray(cfg.browserSources)?cfg.browserSources.slice(0,10):[];
 cfg.importedChannels=Array.isArray(cfg.importedChannels)?cfg.importedChannels.slice(0,3500):[];
 cfg.importedPrograms=Array.isArray(cfg.importedPrograms)?cfg.importedPrograms.slice(0,14000):[];
 cfg.epgSources=Array.isArray(cfg.epgSources)?cfg.epgSources.slice(0,25):[];
 cfg.epgMappings=cfg.epgMappings&&typeof cfg.epgMappings==="object"&&!Array.isArray(cfg.epgMappings)?cfg.epgMappings:{};
 cfg.favorites=Array.isArray(cfg.favorites)?cfg.favorites:[];
 let displayMode="home",initialized=false,channels=[],programs=[],jobs=[],rules=[],sources=[],epgSources=cfg.epgSources,epgMappings=cfg.epgMappings,loading=false,connected=false,error="",message="",filter="all",search="",offset=0,channelPage=0,selected=null,playerOpen=false;
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
 // XMLTV times are absolute UTC instants. Channel EAST/WEST labels describe the
 // feed, not an extra hour offset to be applied to its EPG start or stop times.
 const normal=s=>String(s??"").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");
 function episodeSignature(p){
  const number=normal(p?.episode);
  if(number.length>=4)return "number:"+number;
  const subtitle=normal(p?.subtitle);
  if(subtitle.length>=8&&!/^(new episode|episode available|to be announced|no information)/.test(subtitle))
   return "subtitle:"+subtitle;
  const description=normal(p?.description);
  if(description.length>=42&&!/^(no description available|information not available|program information)/.test(description))
   return "description:"+description.slice(0,240);
  return "";
 }
 function sameEpisode(a,b){
  if(normal(a?.title)!==normal(b?.title))return false;
  const first=episodeSignature(a),second=episodeSignature(b);
  return !!first&&first===second;
 }
 function alternateAirings(program,{futureOnly=false}={}){
  const now=Date.now(),limit=72*3600000;
  return programs.filter(p=>p.id!==program.id&&sameEpisode(program,p)
   &&Math.abs(Number(p.start)-Number(program.start))<=limit
   &&Number(p.end)>Number(p.start)
   &&(!futureOnly||Number(p.start)>now+60000))
   .sort((a,b)=>a.start-b.start||(Number(byID(b.channel_id)?.quality||0)-Number(byID(a.channel_id)?.quality||0)));
 }
 function preferredProgramme(program){
  return program; // Never switch IPTV sources without a deliberate user selection.
 }
 const showDate=ms=>new Date(ms).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
 const showClock=ms=>new Date(ms).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
 const hash=s=>{let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619)}return (n>>>0).toString(36)};
 function save(){localStorage.setItem(key,JSON.stringify(cfg))}
 function validURL(s){try{const u=new URL(String(s||"").trim());return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password&&!!u.hostname}catch{return false}}
 function recordHost(){const s=String(cfg.host||"").trim().replace(/\/+$/,"");return s.startsWith("https://")&&validURL(s)?s:""}
 // For an HTTPS page, only attempt an HTTPS upgrade on the original host.
 function secureFeedURL(value){
  if(!validURL(value))return "";
  const u=new URL(String(value).trim());
  if(u.protocol==="https:")return u.href.replace(/\/+$/,"");
  if(u.protocol!=="http:"||(u.port&&u.port!=="80"))return "";
  u.protocol="https:";u.port="";
  return u.href.replace(/\/+$/,"");
 }
 function browserFeedError(error,wasHTTP){
  if(wasHTTP)return "The IPTV provider uses HTTP. Luma tried HTTPS on the same host (port 443), but could not read an accessible playlist. Ask your provider for an HTTPS Xtream address, or connect your own HTTPS DVR companion to load the HTTP feed. No connection was saved.";
  if(error instanceof TypeError||/failed to fetch|networkerror|load failed|abort/i.test(String(error?.message||"")))
   return "The provider's HTTPS feed is inaccessible from this browser (possibly CORS, TLS or network restrictions). Ask for a browser-compatible HTTPS feed or use your own authenticated DVR companion. No connection was saved.";
  return String(error?.message||error||"IPTV feed unavailable");
 }
 function nativeIPTVReader(){
  return typeof window!=="undefined"&&typeof window.LumaNativeIPTV?.fetchText==="function";
 }
 async function readRemote(url,limit){
  if(!validURL(url))throw Error("Enter a valid HTTPS playlist or guide address");
  if(nativeIPTVReader())return window.LumaNativeIPTV.fetchText(url,limit);
  if(location.protocol==="https:"&&!url.startsWith("https://"))throw Error("This secure website cannot read HTTP IPTV/EPG feeds. Use a provider HTTPS address or a signed Luma native player.");
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),22000);
  try{const res=await fetch(url,{signal:ctrl.signal,cache:"no-store"});
   if(!res.ok)throw Error("Feed returned HTTP "+res.status);
   const text=await res.text();if(text.length>limit)throw Error("Feed too large for this browser");
   return text;
  }finally{clearTimeout(timer)}
 }
 function parseM3U(source){
  const clean=String(source||"").replace(/^\uFEFF/,"").trimStart();
  if(!clean.startsWith("#EXTM3U"))throw Error("Not an M3U IPTV playlist");
  let rows=[],info=null;
  for(const line of clean.split(/\r?\n/).slice(0,90000)){
   const s=line.trim();
   if(s.startsWith("#EXTINF:")){
    const a=(name)=>{const m=s.match(new RegExp("\\b"+name+'="([^"]{0,300})"',"i"));return m?m[1].trim():""};
    info={name:(s.includes(",")?s.slice(s.indexOf(",")+1):"TV Channel").trim().slice(0,100),epg_id:a("tvg-id"),logo:a("tvg-logo"),group:a("group-title"),number:a("tvg-chno")||a("channel-number"),quality:/\b4K\b/i.test(s)?2:/\b(FHD|HD|1080P)\b/i.test(s)?1:0};
   }else if(info&&s&&!s.startsWith("#")){
    if(validURL(s)){rows.push({...info,id:"iptv:"+hash(info.epg_id+"|"+info.name+"|"+s),url:s});
     if(rows.length>=9000)break}
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
  const byGuide=new Map(),byGuideFolded=new Map(),byName=new Map();
  for(const c of stations){
   if(c.epg_id){
    if(!byGuide.has(c.epg_id))byGuide.set(c.epg_id,[]);
    byGuide.get(c.epg_id).push(c);
    const lowered=String(c.epg_id).toLocaleLowerCase();
    if(!byGuideFolded.has(lowered))byGuideFolded.set(lowered,[]);
    byGuideFolded.get(lowered).push(c);
   }
   const name=c.name.toLowerCase();if(!byName.has(name))byName.set(name,[]);byName.get(name).push(c);
  }
  const results=[],seen=new Set(),now=Date.now();
  const entries=doc.getElementsByTagName("programme");
  for(let i=0;i<entries.length;i++){
   if(results.length>=80000)break;
   const el=entries[i],id=el.getAttribute("channel");
   const options=byGuide.get(id)||byGuideFolded.get(String(id||"").toLocaleLowerCase())||(!mode.strict?byName.get(names.get(id)):null)||[];
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
  if(source.type!=="xtream")return !nativeIPTVReader()&&source.secure_url||source.m3u_url;
  const panel=String(!nativeIPTVReader()&&source.secure_url||source.server||"").trim().replace(/\/+$/,""),u=new URL(panel);
  if(!validURL(panel)||u.username||u.password||!source.username||!source.password)throw Error("Invalid Xtream credentials");
  return panel+"/get.php?"+new URLSearchParams({username:source.username,password:source.password,type:"m3u_plus",output:source.output==="ts"?"mpegts":"m3u8"});
 }
 // VLC's iOS URL handler can read an HTTP playlist directly, unlike Safari fetch.
 // Invocation requires a deliberate tap; credentials go to the user's player
 // and the original IPTV service, never an intermediary proxy.
 function vlcLink(url){return "vlc-x-callback://x-callback-url/stream?url="+encodeURIComponent(url)}
 function openInVLC(source,channelURL=""){
  const url=channelURL||browserURL(source);
  if(!validURL(url))throw Error("No valid IPTV address to open");
  window.location.href=vlcLink(url);
 }
 function providerPlaylist(id){
  const source=cfg.browserSources.find(p=>p.id===id);
  if(!source)throw Error("IPTV account not found on this device");
  return browserURL(source.type==="xtream"?{...source,output:"ts"}:source);
 }
 function browserEPG(source){
  if(source.xmltv_url){
   if(nativeIPTVReader()||new URL(source.xmltv_url).protocol==="https:")return source.xmltv_url;
   return secureFeedURL(source.xmltv_url)||source.xmltv_url;
  }
  const panel=String(!nativeIPTVReader()&&source.secure_url||source.server||"").replace(/\/+$/,"");
  return source.type==="xtream"?panel+"/xmltv.php?"+new URLSearchParams({username:source.username,password:source.password}):"";
 }
 function configuredBrowserProviders(){
  const items=[...cfg.browserSources,...(cfg.m3u?[{id:"legacy",type:"m3u",name:cfg.name||"Original IPTV",m3u_url:cfg.m3u,xmltv_url:cfg.xmltv}]:[])];
  const seen=new Set();
  return items.filter(p=>{
   const id=p.type==="xtream"?"xtream:"+String(p.server||"").replace(/\/+$/,"").toLowerCase()+"|"+String(p.username||"").trim()
    :"m3u:"+String(p.m3u_url||"").trim();
   if(seen.has(id))return false;
   seen.add(id);return true;
  });
 }

 let relayProviderId="",relayReady=false,relayProbe=null;
 function relayLocation(){
  const host=String(typeof location!=="undefined"?location.hostname||"":"").toLowerCase();
  return /\.vercel\.app$/.test(host);
 }
 async function relayAvailable(){
  if(!relayLocation())return false;
  if(!relayProbe)relayProbe=fetch("/api/iptv?op=status",{credentials:"same-origin",cache:"no-store"})
   .then(async r=>r.ok&&(await r.json()).ready===true).catch(()=>false);
  return relayProbe;
 }
 async function relayJSON(url,options={}){
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(String(data.error||"IPTV secure connection failed").slice(0,180));
  return data;
 }
 async function loadViaRelay(){
  if(!relayLocation()||!(await relayAvailable()))return false;
  const source=configuredBrowserProviders().find(p=>p.type==="xtream");
  if(!source)return false;
  const connectedAccount=await relayJSON("/api/iptv?op=session",{method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({server:source.server,username:source.username,password:source.password})});
  if(!connectedAccount.ok)throw Error("Your IPTV provider did not accept this login");
  const response=await relayJSON("/api/iptv?op=channels");
  const rows=(Array.isArray(response.channels)?response.channels:[]).map(c=>({
   ...c,url:new URL(c.url,location.origin).href,provider:source.name,provider_id:source.id
  }));
  if(!rows.length)throw Error("Your IPTV provider has no available live channels");
  channels=rows;relayProviderId=source.id;relayReady=true;connected=false;
  programs=[];jobs=[];rules=[];sources=[];
  try{
   const guide=await fetch("/api/iptv?op=epg",{credentials:"same-origin",cache:"no-store"});
   if(guide.ok)programs=parseGuide(await guide.text(),channels,{sourceName:source.name,assignAll:true});
  }catch{}
  indexPrograms();
  message=channels.length+" channels · "+programs.length+" programme listings · HTTPS IPTV";
  error="";
  if(typeof LumaVOD!=="undefined"&&typeof LumaVOD.setXtreamCatalog==="function"){
   void Promise.allSettled([
    relayJSON("/api/iptv?op=catalog&action=get_vod_streams"),
    relayJSON("/api/iptv?op=catalog&action=get_series")
   ]).then(results=>{
    LumaVOD.setXtreamCatalog([{provider_id:source.id,provider:source.name,
     movies:results[0].status==="fulfilled"&&Array.isArray(results[0].value)?results[0].value:[],
     series:results[1].status==="fulfilled"&&Array.isArray(results[1].value)?results[1].value:[]}]);
   }).catch(()=>{});
  }
  return true;
 }

 const providerCache=new Map();
 const autoSecureAttempted=new Set();
 function autoSecureAddress(value){
  if(!validURL(value))return "";
  const u=new URL(value);
  if(u.protocol!=="http:")return "";
  u.protocol="https:";u.port="";
  return u.href.replace(/\/+$/,"");
 }
 const nativeLimit=25*1024*1024;
 const xtreamActions=new Set(["get_live_streams","get_live_categories","get_vod_streams","get_series","get_series_info"]);
 function xtreamPanel(source){
  const panel=String(!nativeIPTVReader()&&source.secure_url||source.server||"").trim().replace(/\/+$/,"");
  if(source.type!=="xtream"||!validURL(panel)||!source.username||!source.password)
   throw Error("A valid Xtream connection is required");
  return panel;
 }
 async function xtreamData(source,action,extras={}){
  if(!xtreamActions.has(action))throw Error("Unsupported provider catalog request");
  const panel=xtreamPanel(source);
  const parameters=new URLSearchParams({username:source.username,password:source.password,action});
  if(action==="get_series_info"){
   const id=String(extras.series_id||"");
   if(!/^\d{1,12}$/.test(id))throw Error("Invalid IPTV series ID");
   parameters.set("series_id",id);
  }
  const response=await readRemote(panel+"/player_api.php?"+parameters,nativeIPTVReader()?nativeLimit:6*1024*1024);
  let parsed;
  try{parsed=JSON.parse(response)}catch{throw Error("The provider did not return a valid Xtream API response")}
  if(parsed?.user_info?.auth===0||parsed?.error==="Not authorized")throw Error("Your IPTV service rejected these credentials");
  return parsed;
 }
 function xtreamStreamURL(providerId,kind,streamId,extension=""){
  const source=cfg.browserSources.find(x=>x.id===providerId);
  if(!source||source.type!=="xtream")return "";
  const type=kind==="movie"?"movie":kind==="series"?"series":kind==="live"?"live":"";
  const id=String(streamId||"");
  if(!type||!/^\d{1,12}$/.test(id))return "";
  const ext=String(extension||((type==="live")?(source.output==="ts"?"ts":"m3u8"):"mp4")).toLowerCase();
  if(!/^[a-z0-9]{2,6}$/.test(ext))return "";
  if(relayReady&&relayProviderId===providerId&&relayLocation())
   return location.origin+"/api/iptv?op=vod&kind="+type+"&id="+id+"&ext="+encodeURIComponent(ext);
  const panel=xtreamPanel(source);
  return panel+"/"+type+"/"+encodeURIComponent(source.username)+"/"+encodeURIComponent(source.password)+"/"+id+"."+ext;
 }
 async function xtreamById(providerId,action,extras={}){
  const source=cfg.browserSources.find(x=>x.id===providerId);
  if(!source)throw Error("IPTV provider not connected");
  return xtreamData(source,action,extras);
 }
 function parseXtreamLive(source,items,categories=[]){
  const labels=new Map((Array.isArray(categories)?categories:[]).map(c=>[String(c?.category_id||""),String(c?.category_name||"").trim().slice(0,80)]));
  if(!Array.isArray(items))return [];
  return items.slice(0,9000).flatMap(item=>{
   const id=String(item?.stream_id||"");
   if(!/^\d{1,12}$/.test(id))return [];
   const name=String(item.name||"Channel").trim().slice(0,100);
   const path=xtreamPanel(source)+"/live/"+encodeURIComponent(source.username)+"/"+encodeURIComponent(source.password)+"/"+id+"."+(source.output==="ts"?"ts":"m3u8");
   return [{id:"iptv:"+hash((source.id||source.server||"")+"|"+id),name,url:path,
    epg_id:String(item.epg_channel_id||"").slice(0,180),
    logo:String(item.stream_icon||"").slice(0,1500),group:String(item.category_name||labels.get(String(item.category_id||""))||"Live TV").slice(0,80),
    number:String(item.num||"").slice(0,12),quality:/4K|UHD/i.test(name)?2:/HD|FHD/i.test(name)?1:0}];
  });
 }
 async function loadProviderChannels(source,{fresh=false}={}){
  const key=source.type+"|"+(source.secure_url||source.server||source.m3u_url)+"|"+(source.username||"")+"|"+String(nativeIPTVReader());
  const existing=providerCache.get(key);
  if(!fresh&&existing&&Date.now()-existing.time<120000)return existing.rows;
  const failures=[];
  if(source.type==="xtream"){
   try{
    const [live,categories]=await Promise.allSettled([xtreamData(source,"get_live_streams"),xtreamData(source,"get_live_categories")]);
    if(live.status!=="fulfilled")throw live.reason;
    const apiRows=parseXtreamLive(source,live.value,categories.status==="fulfilled"?categories.value:[]);
    if(apiRows.length){providerCache.set(key,{time:Date.now(),rows:apiRows});return apiRows}
    failures.push("Xtream live-channel API returned no channels");
   }catch(e){failures.push(String(e.message||e))}
  }
  try{
   const rows=parseM3U(await readRemote(browserURL(source),nativeIPTVReader()?nativeLimit:6*1024*1024));
   if(!rows.length)throw Error("Playlist returned no playable entries");
   providerCache.set(key,{time:Date.now(),rows});
   return rows;
  }catch(e){
   failures.push(String(e.message||e));
   throw Error("Unable to load channels: "+failures.join(" · ").slice(0,180));
  }
 }
 let catalogLastSync=0,catalogPromise=null;
 async function syncCatalog(force=false){
  if(!nativeIPTVReader()&&!configuredBrowserProviders().some(p=>!p.connection_mode||p.connection_mode!=="device-import"||p.secure_url))
   return {movies:0,series:0};
  if(!force&&catalogLastSync&&Date.now()-catalogLastSync<20*60000)return {cached:true};
  if(catalogPromise)return catalogPromise;
  if(typeof LumaVOD==="undefined"||typeof LumaVOD.setXtreamCatalog!=="function")return {pending:true};
  const providers=configuredBrowserProviders().filter(p=>p.type==="xtream"&&(nativeIPTVReader()||p.connection_mode!=="device-import"||p.secure_url));
  catalogPromise=(async()=>{
   const catalogs=await Promise.all(providers.map(async source=>{
    const [movies,series]=await Promise.allSettled([
     xtreamData(source,"get_vod_streams"),xtreamData(source,"get_series")
    ]);
    return {provider_id:source.id,provider:source.name,
     movies:movies.status==="fulfilled"&&Array.isArray(movies.value)?movies.value:[],
     series:series.status==="fulfilled"&&Array.isArray(series.value)?series.value:[]};
   }));
   LumaVOD.setXtreamCatalog(catalogs);
   catalogLastSync=Date.now();
   return {movies:catalogs.reduce((n,c)=>n+c.movies.length,0),
    series:catalogs.reduce((n,c)=>n+c.series.length,0)};
  })();
  try{return await catalogPromise}finally{catalogPromise=null}
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
  // GitHub Pages is HTTPS, so HTTP playlists cannot be read with fetch().
  // Save the provider for a native iOS player or an M3U file import instead.
  // Do not describe a saved account as a verified live connection.
  const originalURL=type==="xtream"?source.server:source.m3u_url;
  const wasHTTP=new URL(originalURL).protocol==="http:";
  if(wasHTTP&&!nativeIPTVReader()){
   const same=cfg.browserSources.find(x=>x.type===source.type&&(type==="m3u"?x.m3u_url===source.m3u_url:x.server===source.server&&x.username===source.username));
   if(!same&&configuredBrowserProviders().length>=10)throw Error("Maximum 10 IPTV services");
   source.connection_mode="device-import";
   source.id=same?.id||"saved:"+hash(type+"|"+originalURL+"|"+(source.username||""));
   if(same)Object.assign(same,source);else cfg.browserSources.push(source);
   cfg.lastImportProviderId=source.id;
   save();
   await updateLocal();
   render("connections");
   return {ok:true,importRequired:true,provider_id:source.id,channels:cfg.importedChannels.filter(c=>c.provider_id===source.id).length};
  }
  if(!nativeIPTVReader()&&source.xmltv_url&&new URL(source.xmltv_url).protocol==="http:"){
   const secure=secureFeedURL(source.xmltv_url);
   if(secure)source.xmltv_url=secure;
  }
  let rows;
  try{rows=await loadProviderChannels(source,{fresh:true})}
  catch(err){throw Error(nativeIPTVReader()?String(err.message||err):browserFeedError(err,wasHTTP))}
  if(!rows.length)throw Error("The provider returned no live channels. No connection was saved.");
  const same=cfg.browserSources.find(x=>x.type===source.type&&(type==="m3u"?x.m3u_url===source.m3u_url:x.server===source.server&&x.username===source.username));
  if(!same&&configuredBrowserProviders().length>=10)throw Error("Maximum 10 IPTV services");
  source.id=same?.id||"local:"+hash(name+"|"+type+"|"+(source.server||source.m3u_url));
  source.connection_mode=nativeIPTVReader()?"native-direct":"browser-https";
  if(same)Object.assign(same,source);else cfg.browserSources.push(source);
  if(type==="m3u"&&cfg.m3u===source.m3u_url){cfg.m3u="";cfg.xmltv=""}
  save();await updateLocal();render("connections");
  return {ok:true,channels:rows.length};
 }
 async function trySecureProvider(id,alternative=""){
  const source=cfg.browserSources.find(p=>p.id===id);
  if(!source)throw Error("Choose a saved IPTV service");
  if(nativeIPTVReader())throw Error("Native Luma reads this feed directly. Use Refresh.");
  if(cfg.host&&cfg.token)throw Error("Use the connected recorder to refresh this service.");
  const supplied=String(alternative||"").trim();
  const original=source.type==="xtream"?source.server:source.m3u_url;
  if(supplied&&(!validURL(supplied)||!supplied.startsWith("https://")))
   throw Error("Enter the actual HTTPS address supplied by your IPTV provider.");
  const secure=supplied||secureFeedURL(original);
  if(!secure||!secure.startsWith("https://"))
   throw Error("This source uses a custom HTTP port. Enter the real HTTPS address from the provider; Luma cannot guess the secure port.");
  if(source.type==="xtream"&&new URL(secure).hostname.toLowerCase()!==new URL(original).hostname.toLowerCase())
   throw Error("For account security, an alternative Xtream address must use the same hostname. To change provider domains, add it as a new IPTV service.");
  const rows=await loadProviderChannels({...source,secure_url:secure},{fresh:true});
  if(!rows.length)throw Error("The HTTPS address returned no usable channels.");
  const previous={mode:source.connection_mode,secure_url:source.secure_url};
  source.secure_url=secure;source.connection_mode="browser-https";
  try{
   save();await updateLocal();
   const count=channels.filter(c=>c.provider_id===source.id).length;
   if(!count)throw Error("The verified HTTPS feed did not populate this service.");
   error="";message=source.name+": "+count+" channels loaded from its tested HTTPS feed. Playback still needs compatible HTTPS media URLs and codecs.";
   render();
   return {ok:true,channels:count,provider_id:source.id};
  }catch(err){
   source.secure_url=previous.secure_url;source.connection_mode=previous.mode;
   save();await updateLocal();
   throw err;
  }
 }
 async function removeProvider(id){
  if(connected){
   await recorder("/sources/"+encodeURIComponent(id),"DELETE");
   await recorder("/refresh","POST",{});await loadRecorder();
  }else{
   if(id==="legacy"){cfg.m3u="";cfg.xmltv=""}
   else cfg.browserSources=cfg.browserSources.filter(x=>x.id!==id);
   cfg.importedChannels=cfg.importedChannels.filter(x=>x.provider_id!==id);
   cfg.importedPrograms=cfg.importedPrograms.filter(x=>x.provider_id!==id&&!String(x.channel_id||"").startsWith(id+":"));
   if(cfg.lastImportProviderId===id)cfg.lastImportProviderId="";
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
 async function updateLocal(silent=false){
  loading=true;error="";message="";if(!silent)render();
  try{
   if(cfg.host&&cfg.token){await loadRecorder()}
   else if(await loadViaRelay()){
    // The provider's channels and HLS video are delivered over first-party HTTPS.
   }else{
    const providers=configuredBrowserProviders().filter(p=>nativeIPTVReader()||p.connection_mode!=="device-import"||p.secure_url);
    const imported=cfg.importedChannels.filter(c=>c&&c.url&&c.id&&c.provider_id);
    if(!providers.length&&!imported.length){
     channels=[];programs=[];indexPrograms();connected=false;
     message=cfg.browserSources.some(p=>p.connection_mode==="device-import")?"Account saved. Luma is automatically checking for a working HTTPS feed; HTTP-only IPTV needs native Luma.":"Connect an IPTV source to get started.";
     if(!nativeIPTVReader()){
      const source=cfg.browserSources.find(p=>p.connection_mode==="device-import"&&!autoSecureAttempted.has(p.id));
      if(source){
       autoSecureAttempted.add(source.id);
       const secure=autoSecureAddress(source.type==="xtream"?source.server:source.m3u_url);
       if(secure)void trySecureProvider(source.id,secure).catch(e=>{
        if(!channels.length){
         message="Automatic HTTPS discovery was unsuccessful. Your saved account is unchanged; a native Luma app is required for HTTP-only IPTV.";
         error="Automatic connection: "+String(e.message||e).slice(0,160);
         render();
        }
       });
      }
     }
     return;
    }
    const all=[...imported],groups=[],errors=[],ids=new Set(imported.map(c=>c.id));
    // Start independent provider requests together; failures are isolated to that
    // provider so one offline IPTV service never blanks every other service.
    const remote=await Promise.allSettled(providers.map(provider=>loadProviderChannels(provider)));
    for(let i=0;i<providers.length;i++){
     const provider=providers[i],outcome=remote[i];
     if(outcome.status!=="fulfilled"){
      errors.push(provider.name+": "+String(outcome.reason?.message||outcome.reason));
      continue;
     }
     const rows=outcome.value.map(item=>{
      const c={...item,provider:provider.name,provider_id:provider.id};
      if(ids.has(c.id))c.id=provider.id+":"+c.id;
      ids.add(c.id);return c;
     });
     all.push(...rows);groups.push({provider,rows});
    }
    if(!all.length)throw Error("No IPTV service could load. "+errors.join(" · ").slice(0,260));
    separatePlaylist(all);
    programs=[...cfg.importedPrograms.filter(p=>channels.some(c=>c.id===p.channel_id))];
    const guideResults=await Promise.allSettled(groups.map(async group=>{
     const feed=browserEPG(group.provider);
     const ordinary=channels.filter(c=>c.provider_id===group.provider.id&&!epgMappings[c.id]);
     if(!feed||!ordinary.length)return [];
     return parseGuide(await readRemote(feed,25*1024*1024),ordinary,{sourceName:group.provider.name});
    }));
    for(let i=0;i<guideResults.length;i++){
     if(guideResults[i].status==="fulfilled")programs=programs.concat(guideResults[i].value);
     else errors.push("Guide "+groups[i].provider.name+": "+String(guideResults[i].reason?.message||guideResults[i].reason));
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
    message=channels.length+" channels · "+programs.length+" guide listings · "+(groups.length?groups.length+" connected services · ":"")+imported.length+" imported channels";
    if(groups.some(g=>g.provider.type==="xtream"))void syncCatalog().catch(()=>{});
    if(errors.length)error="Some providers/EPG feeds unavailable: "+errors.join(" · ").slice(0,350);
   }
  }catch(e){error=String(e.message||e);connected=false}
  finally{loading=false;if(!silent)render()}
 }
 async function loadForCalendar(){
  if(programs.length)return;
  if(!cfg.browserSources.length&&!cfg.m3u&&!(cfg.host&&cfg.token))return;
  await updateLocal(true); // Do not replace the Calendar page with the Live TV page.
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
   +(connected?'<p class="micro">Watch recordings inside Luma using its player, or choose Save to device. Playback supports seeking on compatible streams. Direct TS playback may require native Luma or an MP4 conversion.</p>':'<div class="iptvNotice">To schedule and record even when the TV box is off, connect an always-on recorder under Connections. The TV box cannot record while completely powered off.</div>')
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
   +(j.status==="complete"?'<button class="primary small" data-watch-recording="'+esc(j.id)+'">▶ Watch in Luma</button><button class="secondary small" data-download-recording="'+esc(j.id)+'">Save to device</button>':j.status==="scheduled"?'<button class="secondary small" data-cancel-recording="'+esc(j.id)+'">Cancel</button>':'')+'</div>';
 }
 async function importPlaylistFile(file,providerId=cfg.lastImportProviderId,xmlfile=null){
  if(!file)throw Error("Choose the M3U file saved in your iPhone Files app");
  if(file.size>6*1024*1024||xmlfile&&xmlfile.size>25*1024*1024)throw Error("Playlist or guide file is too large for the browser");
  const raw=await file.text(),rows=parseM3U(raw);
  if(!rows.length)throw Error("This file does not contain usable IPTV channel URLs");
  const source=cfg.browserSources.find(p=>p.id===providerId);
  const id=source?.id||"file:local",name=source?.name||"Imported M3U";
  const imported=rows.map(c=>({...c,id:id+":"+c.id,provider_id:id,provider:name}));
  const epg=xmlfile?parseGuide(await xmlfile.text(),imported,{assignAll:true,sourceName:name}):[];
  const prevChannels=cfg.importedChannels,prevPrograms=cfg.importedPrograms;
  cfg.importedChannels=[...prevChannels.filter(c=>c.provider_id!==id),...imported].slice(0,3500);
  cfg.importedPrograms=[...prevPrograms.filter(p=>p.provider_id!==id),...epg.map(p=>({...p,provider_id:id}))].slice(0,14000);
  cfg.lastImportProviderId=id;
  try{save()}catch(e){
   cfg.importedChannels=prevChannels;cfg.importedPrograms=prevPrograms;
   throw Error("Not enough on-device storage for this playlist. Try importing a smaller channel list.");
  }
  await updateLocal();
  render("connections");
  return {ok:true,imported:imported.length,channel_count:channels.length};
 }
 async function importGuideFile(file){
  if(!file)throw Error("Choose an XMLTV guide file");
  if(file.size>25*1024*1024)throw Error("XMLTV file is too large (25 MB maximum)");
  if(!channels.length)throw Error("Load IPTV channels before importing the guide.");
  const matched=parseGuide(await file.text(),channels,{assignAll:true,sourceName:"Imported XMLTV"});
  if(!matched.length)throw Error("No upcoming/current guide listings matched your channels. Check guide dates and channel IDs.");
  const previous=cfg.importedPrograms,ids=new Set(matched.map(p=>p.channel_id));
  cfg.importedPrograms=[...previous.filter(p=>!ids.has(p.channel_id)),...matched.map(p=>({
   ...p,provider_id:byID(p.channel_id)?.provider_id||"file:local"
  }))].slice(-14000);
  try{save()}catch{cfg.importedPrograms=previous;throw Error("Storage is full. Import a smaller XMLTV file.")}
  await updateLocal();
  return {ok:true,listings:matched.length,channels:ids.size};
 }
 function formHTML(){
  return '<details class="iptvSettings iptvAdvancedSettings"><summary><span>◉ DVR companion and local files</span><small>Optional server · imports</small></summary>'
   +'<div class="iptvCompanionPanel"><div><h3>Secure DVR companion</h3><p>For HTTP-only IPTV on iPhone, this is the supported route into Luma. First run the self-hosted recorder on a powered PC, NAS, or supported server with trusted HTTPS; then enter its address and private access token below. This form does not install or run a recorder for you.</p>'
   +'<label>HTTPS recorder address<input id="iptvHost" type="url" value="'+esc(cfg.host)+'" placeholder="https://recorder.example.com"></label>'
   +'<label>Private recorder token<input id="iptvToken" type="password" autocomplete="off" value="'+esc(cfg.token)+'"></label>'
   +'<button type="button" id="iptvConnectRecorder" class="secondary">Connect DVR companion</button>'
   +'<p class="micro"><a href="https://github.com/cj42izzle/Luma-Media-Center/tree/main/recorder" target="_blank" rel="noopener">Companion setup instructions</a></p></div>'
   +'<div><h3>Import channels saved in Files</h3><p>Import a provider M3U file and an optional XMLTV guide to browse channels on this iPhone. HTTP streams can play through an installed Luma native app. Safari cannot play HTTP from this HTTPS page or keep recording while locked.</p>'
   +'<label>M3U file<input id="iptvFileM3U" type="file" accept=".m3u,.m3u8,.txt"></label>'
   +'<label>XMLTV file<input id="iptvFileGuide" type="file" accept=".xml,.xmltv,.txt"></label>'
   +'<button type="button" id="iptvLoadFiles" class="secondary">Import local files</button></div></div></details>';
 }
 function connectionsHTML(){
  const rows=connected?sources:configuredBrowserProviders().map(p=>({...p,has_guide:!!browserEPG(p),import_count:cfg.importedChannels.filter(c=>c.provider_id===p.id).length}));
  return (typeof LumaIPTVPortal!=="undefined"?LumaIPTVPortal.setupHTML():"")
   +'<section class="iptvProviderList"><div class="iptvSectionHead"><h3>Your IPTV services on this device</h3><small>'+rows.length+' / 10</small></div>'
   +(rows.length?rows.map(p=>'<div class="iptvProviderRow iptvSavedProvider"><div><b>'+esc(p.name)+'</b><small>'
       +(p.connection_mode==="device-import"?(p.import_count?p.import_count+" channels imported · Native Luma needed for HTTP playback":"Saved in Safari · Native connection required"):p.connection_mode==="native-direct"?"Native direct connection · Automatic channel and EPG sync":p.secure_url?"HTTPS feed verified · Guide sync automatic":p.type==="xtream"?"Xtream account · Guide refreshes automatically":"M3U playlist")+'</small></div>'
       +(p.connection_mode==="device-import"?'<div class="iptvSavedActions"><button class="primary small" type="button" data-iptv-import="'+esc(p.id)+'">Import M3U into Luma</button>'
        +'<button class="secondary small" type="button" data-iptv-download-m3u="'+esc(p.id)+'">Get playlist file</button></div>':"")
       +'<button type="button" class="secondary small" data-iptv-local-remove="'+esc(p.id)+'">Remove</button></div>').join("")
       :'<p class="micro">Save an IPTV account to get started. Connect an HTTPS IPTV source to play in the website, or use the native Luma app for HTTP-only IPTV.</p>')
    +'<input type="file" id="iptvQuickImportFile" accept=".m3u,.m3u8,.txt,text/plain" hidden aria-label="Import IPTV M3U file">'
    +'<p class="micro">HTTP provider: saving an account does not verify its login. For full in-app playback of an HTTP-only service, install a signed native Luma app; no third-party player is part of this workflow. You may import an M3U file for guide browsing in Safari, but its HTTP video will not play there.</p></section>'
   +formHTML()+(typeof LumaEPGUI!=="undefined"?LumaEPGUI.managerHTML():"");
 }
 function quickSetupHTML(){
  const providers=configuredBrowserProviders();
  if(!providers.length){
   return '<section class="iptvQuickSetup" aria-label="Connect IPTV service">'
    +'<span class="eyebrow">LIVE TV</span><h2>Connect your television</h2>'
    +'<p>Enter the login supplied by your IPTV provider once. Luma will try to load your channels, guide and available movies automatically.</p>'
    +'<div class="iptvQuickActions"><button class="primary" type="button" data-iptv-mode="connections">Connect IPTV</button></div></section>';
  }
  const selected=providers.find(p=>p.connection_mode==="device-import")||providers[0];
  const name=esc(selected.name||"Your IPTV service");
  const original=selected.type==="xtream"?selected.server:selected.m3u_url;
  let isHTTP=false;
  try{isHTTP=new URL(original).protocol==="http:"}catch{}
  const safariHTTP=!nativeIPTVReader()&&isHTTP&&!selected.secure_url&&!cfg.host;
  const heading=loading?"Connecting to "+name+"…":name+" is saved";
  const body=loading?"Luma is checking the connection and loading available channels and programme information."
   :safariHTTP?"This service uses HTTP, which Safari blocks. You don't need to import playlists or TV guides. Direct viewing requires the signed Luma iPhone app, which is not installed through this website."
   :"Luma could not load channels from this saved service. It will keep your account and you can retry without entering your details again.";
  const detail=error?'<details class="iptvQuickDetails"><summary>Connection details</summary><p>'+esc(String(error).slice(0,320))+'</p></details>':"";
  return '<section class="iptvQuickSetup" aria-label="IPTV connection status">'
   +'<div class="iptvQuickHeading"><span class="eyebrow">YOUR IPTV CONNECTION</span>'
   +'<span class="iptvQuickState">'+(loading?"Checking":safariHTTP?"Needs native iPhone app":"Not connected")+'</span></div>'
   +'<h2>'+heading+'</h2><p>'+body+'</p>'
   +'<div class="iptvQuickActions">'
   +(safariHTTP?'<a class="primary iptvInstallLink" href="https://github.com/cj42izzle/Luma-Media-Center/blob/main/ios/SIGNING.md" target="_blank" rel="noopener noreferrer">How to install Luma on iPhone</a>'
    :'<button type="button" class="primary" id="iptvQuickRetry" '+(loading?'disabled':'')+'>'
     +(loading?'Checking…':'↻ Try automatic connection')+'</button>')
   +'<button type="button" class="secondary" data-iptv-mode="connections">Account settings</button></div>'
   +detail+'</section>';
 }
 function guideRecovery(){
  if(!channels.length)return quickSetupHTML();
  if(programs.length)return "";
  return '<section class="iptvQuickGuideStatus" aria-label="Programme guide status">'
   +'<h3>Channels ready — guide not available yet</h3>'
   +'<p>Luma requests your provider’s programme information automatically. You can still select and watch available channels. No file import is required just to view your channel list.</p>'
   +'<button type="button" class="secondary" id="iptvQuickRetry" '+(loading?'disabled':'')+'>↻ Retry guide</button></section>';
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
  const nProviders=connected?sources.length:configuredBrowserProviders().length;
  if(displayMode==="home"){
   el.innerHTML=channels.length
    ?alert+(portal?portal.homeHTML({channels,programs,favorites:cfg.favorites}):'<div class="iptvPortalEmpty">Live TV is loading.</div>')
    :quickSetupHTML();
  }else if(displayMode==="guide"){
   el.innerHTML=channels.length
    ?'<section class="iptvGuidePage"><div class="iptvSectionHead"><div><div class="eyebrow">LIVE TELEVISION</div><h2>Channel guide</h2></div>'
     +'<span>'+channels.length+' channels · '+nProviders+' service'+(nProviders===1?'':'s')+'</span></div>'
     +alert+guideControls(groups)+guideRecovery()
     +'<div class="iptvSectionHead"><h2>On your channels</h2><span>'+showDate(windowStart())+' – '+showClock(windowStart()+3*3600000)+'</span></div>'
     +guideHTML()+'</section>'
    :'<section class="iptvGuidePage">'+quickSetupHTML()+'</section>';
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
  video.play().catch(()=>toast("This browser cannot play the stream. Open it in a compatible native Luma app."));
  closeModal();
 }
 function channelQueue(channel){
  // Keep the queue limited to visible/adjacent channels so a native Intent
  // does not carry an enormous IPTV playlist or leak every account URL.
  const selected=channel?.id;if(!selected)return {queue:[],index:-1};
  let list=getChannels();
  if(!list.some(c=>c.id===selected))list=channels;
  const at=list.findIndex(c=>c.id===selected);
  if(at<0)return {queue:[{url:channel.url,title:channel.name,live:true}],index:0};
  const start=Math.max(0,Math.min(at-18,list.length-41));
  const segment=list.slice(start,start+41);
  return {queue:segment.filter(c=>validURL(c.url)).map(c=>({
   url:c.url,title:c.name||"IPTV channel",live:true,provider:c.provider||"IPTV"
  })),index:Math.max(0,segment.findIndex(c=>c.id===selected))};
 }
 function selectChannel(id){
  const channel=byID(id);if(!channel)return;
  selected=null;
  const browserPlayable=String(channel.url||"").startsWith("https://");
  modal('<div class="iptvWatch"><div class="eyebrow">LIVE CHANNEL</div><h2>'+esc(channel.name)+'</h2>'
   +'<video id="iptvPlayer" controls playsinline preload="none"></video>'
   +'<p class="micro">'+(browserPlayable?"Browser playback depends on codec and stream format.":"This HTTP channel requires the native Luma app on this device. The HTTPS website cannot bypass Safari mixed-content restrictions.")+'</p>'
   +'<div class="actions"><button class="primary" id="iptvStartPlayback">'+"▶ Watch inside Luma"+'</button><button class="secondary" id="iptvWatchGuide" '+(browserPlayable?"":"disabled")+' >Watch & browse guide</button></div>'
   +'<div class="iptvSeriesRecorder"><h3>Record channel now</h3><p>For channels without a program listing, record a timed segment to your connected recorder.</p>'
   +'<label>Duration<select id="iptvRecordDuration"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="90">90 minutes</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option></select></label>'
   +'<button class="secondary" id="iptvRecordChannelNow">● Record Channel Now</button></div></div>');
  const video=document.querySelector("#iptvPlayer");
  document.querySelector("#iptvStartPlayback").onclick=()=>{
   if(typeof LumaPlayer!=="undefined"){
    const {queue,index}=channelQueue(channel);
    if(LumaPlayer.open({url:channel.url,title:channel.name,live:true,
     provider:channel.provider||"IPTV",queue,queueIndex:index}))return;
   }
   if(!browserPlayable){toast("This HTTP channel needs an installed native Luma app.");return}
   video.src=channel.url;video.play().catch(()=>toast("This browser cannot decode the channel. Use native Luma on a compatible device."));
  };
  document.querySelector("#iptvWatchGuide").onclick=()=>{if(browserPlayable)openGuideMiniPlayer(channel,video)};
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
  const alternatives=alternateAirings(p).slice(0,16);
  const future=alternateAirings(p,{futureOnly:true})[0];
  const zoneOf=c=>typeof LumaIPTVPortal!=="undefined"?LumaIPTVPortal.zone(c?.name||""):"";
  modal('<div class="iptvProgrammeDetail"><div class="eyebrow">'+(running?'● ON NOW':p.is_live_event?'● LIVE EVENT':p.is_new&&!p.rerun?'✦ NEW EPISODE':'PROGRAM GUIDE')+'</div><h2>'+esc(p.title)+'</h2>'
   +'<div class="iptvProgrammeMeta"><span>'+esc(channel?.name||"Unknown channel")+' · '+esc(channel?.provider||"IPTV")+'</span><span>'+showDate(p.start)+' – '+showClock(p.end)+'</span>'+(p.episode?'<span>'+esc(p.episode)+'</span>':"")+(p.rerun?'<span>Repeat</span>':"")+'</div>'
   +(p.subtitle?'<h3>'+esc(p.subtitle)+'</h3>':"")+(p.description?'<p>'+esc(p.description)+'</p>':"")
   +'<div class="iptvDetailButtons"><button class="primary" id="iptvTune">▶ Watch channel</button><button class="secondary" id="iptvRecordOnce">● Record this airing</button>'
   +(future?'<button class="secondary" id="iptvRecordUpcoming">⏺ Record next airing · '+esc(showDate(future.start))+'</button>':"")+'</div>'
   +(alternatives.length?'<section class="iptvOtherAirings"><h3>Exact episode · other time zones & providers</h3><p class="micro">Only EPG airings with matching episode numbers, subtitles or detailed descriptions appear here. All times are shown in your device timezone; the source name and broadcast feed remain visible.</p><div class="iptvAiringChoices">'
     +alternatives.map(a=>{const c=byID(a.channel_id);const zone=zoneOf(c);return '<button type="button" class="secondary small" data-iptv-alternative="'+esc(a.id)+'">'+(a.start<=Date.now()&&a.end>Date.now()?'● NOW · ':'')+esc(c?.provider||"IPTV")+' · '+esc(c?.name||"Channel")+(zone?' · '+esc(zone):'')+' · '+showDate(a.start)+(a.is_new&&!a.rerun?' · NEW':'')+'</button>'}).join("")+'</div></section>':"")
   +'<div class="iptvSeriesRecorder"><h3>Series recording</h3><p>New-only uses confirmed first-run guide markers. Every unique episode matches episode numbers, subtitles, or detailed descriptions to avoid duplicates, including reruns. Every airing also records repeats.</p>'
   +'<label>Series rule<select id="iptvSeriesMode"><option value="new">Verified new broadcasts only</option><option value="unseen">Every unique episode, including reruns (episode details)</option><option value="all">Every airing, including repeats</option></select></label>'
   +'<button class="secondary" id="iptvSeriesRecord">Schedule series</button></div></div>');
  document.querySelector("#iptvTune").onclick=()=>selectChannel(best.channel_id);
  for(const b of document.querySelectorAll("[data-iptv-alternative]"))b.onclick=()=>selectProgramme(b.dataset.iptvAlternative);
  const nextButton=document.querySelector("#iptvRecordUpcoming");
  if(nextButton)nextButton.onclick=async()=>{
   try{
    if(!connected||String(future.id).startsWith("local:"))throw Error("Connect your always-on DVR and sync the guide to record this later airing");
    await recorder("/recordings","POST",{program_id:future.id});
    toast("Next complete airing scheduled on "+(byID(future.channel_id)?.name||"IPTV")+" at "+showDate(future.start));
    closeModal();await reloadDvr();
   }catch(e){toast(String(e.message||e))}
  };
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
  const m3ufile=document.querySelector("#iptvFileM3U")?.files?.[0];
  const xmlfile=document.querySelector("#iptvFileGuide")?.files?.[0];
  try{
   if(!m3ufile&&!xmlfile)throw Error("Choose an M3U playlist or XMLTV guide file");
   if(m3ufile){
    const result=await importPlaylistFile(m3ufile,cfg.lastImportProviderId,xmlfile);
    toast(result.imported+" channels imported");
   }else{
    const result=await importGuideFile(xmlfile);
    toast(result.listings+" listings matched "+result.channels+" channels");
   }
  }catch(e){error=String(e.message||e);render("connections")}
 }
 async function syncRecorder(){
  formValues();
  try{
   if(!cfg.m3u)throw Error("Provide a provider M3U URL before syncing with DVR");
   await recorder("/sources","POST",{name:cfg.name,m3u_url:cfg.m3u,xmltv_url:cfg.xmltv});
   await loadRecorder();render();toast("Your recorder guide is synced");
  }catch(e){error=String(e.message||e);render()}
 }
 async function watchRecording(id){
  try{
   if(!connected)throw Error("Connect your Luma recorder to watch its recordings");
   const job=jobs.find(j=>j.id===id&&j.status==="complete");
   if(!job)throw Error("This recording is not ready to play");
   if(typeof LumaPlayer==="undefined")throw Error("Luma internal player is not available");
   const result=await recorder("/recordings/"+encodeURIComponent(id)+"/playback","POST",{});
   if(!result.ticket)throw Error("Recorder did not authorize playback");
   const url=recordHost()+"/recordings/"+encodeURIComponent(id)+"/stream?ticket="+encodeURIComponent(result.ticket);
   const season=String(job.episode||"").match(/S(\d{1,3})E\d{1,3}/i);
   const seriesKey=season?"dvr:"+String(job.title||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,60)+":season:"+Number(season[1]):"";
   if(!LumaPlayer.open({url,title:"Recording · "+job.title,live:false,mediaId:"recording:"+id,seriesKey}))
    throw Error("Luma could not open this recorded file");
  }catch(e){toast("Luma playback: "+String(e.message||e))}
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
  const quickImport=document.querySelector("#iptvQuickImportFile");
  if(quickImport)quickImport.onchange=async()=>{
   const file=quickImport.files?.[0];if(!file)return;
   try{const res=await importPlaylistFile(file,cfg.lastImportProviderId);toast(res.imported+" channels imported into Luma")}
   catch(e){error=String(e.message||e);render("connections")}
  };
  for(const btn of document.querySelectorAll("[data-iptv-import]"))btn.onclick=()=>{
   cfg.lastImportProviderId=btn.dataset.iptvImport;save();quickImport?.click();
  };
  for(const btn of document.querySelectorAll("[data-iptv-download-epg]"))btn.onclick=()=>{
   try{
    const source=cfg.browserSources.find(p=>p.id===btn.dataset.iptvDownloadEpg);
    if(!source)throw Error("IPTV service not found");
    const url=browserEPG(source);
    if(!validURL(url))throw Error("No XMLTV URL is available for this service");
    window.open(url,"_blank","noopener,noreferrer");
   }catch(e){toast(String(e.message||e))}
  };
  for(const btn of document.querySelectorAll("[data-iptv-download-m3u]"))btn.onclick=()=>{
   try{const url=providerPlaylist(btn.dataset.iptvDownloadM3u);window.open(url,"_blank","noopener,noreferrer")}
   catch(e){toast(String(e.message||e))}
  };
  const quickRetry=document.querySelector("#iptvQuickRetry");
  if(quickRetry)quickRetry.onclick=async()=>{
   if(loading)return;
   try{
    const saved=configuredBrowserProviders().find(p=>p.connection_mode==="device-import");
    if(saved&&!nativeIPTVReader()&&!cfg.host&&!saved.secure_url){
     const original=saved.type==="xtream"?saved.server:saved.m3u_url;
     const https=autoSecureAddress(original);
     if(!https)throw Error("This service has no verified browser-compatible HTTPS address. The signed Luma iPhone app is needed for its HTTP stream.");
     await trySecureProvider(saved.id,https);
    }else await updateLocal();
   }catch(e){
    error=String(e?.message||e);message="";
    render();
   }
  };
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
  for(const b of document.querySelectorAll("[data-watch-recording]"))b.onclick=()=>watchRecording(b.dataset.watchRecording);
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
 return {render,addProvider,trySecureProvider,importGuideFile,xtreamById,xtreamStreamURL,syncCatalog,removeProvider,setFilter,guideSources:()=>epgSources,guideMappings:()=>epgMappings,channels:()=>channels,programs:()=>programs,guideCatalog,guideAdd,guideRemove,guideSet,guideReset,favoriteToggle,isFavorite:(id)=>cfg.favorites.includes(id),isRecorderConnected:()=>connected,parseM3U,parseGuide,parseEPGCatalog,xmlTime,episodeNum,episodeSignature,sameEpisode,alternateAirings,secureFeedURL,vlcLink,openInVLC,importPlaylistFile,openProgramme:selectProgramme,currentProgramme:()=>selected,loadForCalendar,getConfig:()=>({...cfg,token:cfg.token?"••••":"",importedChannels:[],importedPrograms:[],browserSources:cfg.browserSources.map(({username,password,...rest})=>({...rest,m3u_url:rest.m3u_url?"••••":"",secure_url:rest.secure_url?"••••":"",username:username?"••••":"",password:password?"••••":""}))}),loadGuide:updateLocal};
})();
