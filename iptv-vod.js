"use strict";
const LumaVOD=(()=>{
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const norm=s=>String(s||"").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
 const cfg=()=>{try{return JSON.parse(localStorage.getItem("luma.iptv.v1")||"{}")}catch{return{}}};
 let cache={url:"",time:0,rows:[]};let sessionRows=[];
 let xtreamMovies=[],xtreamSeries=[];
 const episodeCache=new Map();
 function parse(rows){return(rows||[]).map(v=>{
  const group=String(v.group||"").toLowerCase(),path=(()=>{try{return new URL(v.url).pathname.toLowerCase()}catch{return""}})();
  const type=/\b(series|tv series|tv shows)\b/.test(group)||path.includes("/series/")?"series":/\b(vod|movies?|films?|cinema)\b/.test(group)||/\/movies?\//.test(path)?"movie":"";
  if(!type)return null;
  const raw=String(v.name||"");
  const ep=raw.match(/\bS(\d{1,3})[._ -]*E(\d{1,3})\b/i)
    ||raw.match(/\b(\d{1,3})\s*x\s*(\d{1,3})\b/i)
    ||raw.match(/\bSeason[ ._-]*(\d{1,3})[ ._-]*Episode[ ._-]*(\d{1,3})\b/i);
  const year=raw.match(/\b(?:19|20)\d{2}\b/);
  let title=(ep?raw.slice(0,ep.index):raw).replace(/\s*\((?:19|20)\d{2}\)\s*/g," ").replace(/\s+(?:4K|UHD|2160P|1080P|720P|FHD|HD)\s*$/i,"").trim();
  if(type==="movie"&&year&&title.endsWith(year[0])&&title!==year[0])title=title.slice(0,-4).trim();
  const quality=/\b(?:4K|UHD|2160P)\b/i.test(raw)?2:/\b(?:FHD|1080P|720P|HD)\b/i.test(raw)?1:0;
  return {...v,type,title,key:norm(title),year:year?year[0]:"",season:ep?Number(ep[1]):0,number:ep?Number(ep[2]):0,quality:Math.max(Number(v.quality)||0,quality)};
 }).filter(x=>x&&x.key)}
 function setRows(entries){
  sessionRows=parse(entries);
  if(typeof window!=="undefined")window.LumaVODLibrary?.refreshLocal?.();
 }

 function cleanXtreamTitle(value){
  return String(value||"").replace(/\s*\((?:19|20)\d{2}\)\s*/g," ")
   .replace(/\s+(?:4K|UHD|2160P|FHD|1080P|HD)\s*$/i,"").trim().slice(0,150);
 }
 function setXtreamCatalog(catalogs=[]){
  const movieRows=[],seriesRows=[];
  for(const group of catalogs){
   const id=String(group?.provider_id||""),provider=String(group?.provider||"IPTV").slice(0,80);
   if(!id)continue;
   for(const v of (Array.isArray(group.movies)?group.movies:[]).slice(0,20000)){
    const stream_id=Number(v?.stream_id),title=cleanXtreamTitle(v?.name);
    if(!Number.isSafeInteger(stream_id)||stream_id<=0||!title)continue;
    const year=String(v?.releasedate||v?.releaseDate||v?.name||"").match(/\b(?:19|20)\d{2}\b/)?.[0]||"";
    const ext=String(v?.container_extension||"mp4").toLowerCase();
    if(!/^[a-z0-9]{2,6}$/.test(ext))continue;
    movieRows.push({title,provider,provider_id:id,stream_id,extension:ext,year,
     poster:String(v?.stream_icon||"").startsWith("https://")?String(v.stream_icon).slice(0,2000):"",
     quality:/\b(4K|UHD|2160P)\b/i.test(title)?2:/\b(FHD|1080P|HD)\b/i.test(title)?1:0});
   }
   for(const v of (Array.isArray(group.series)?group.series:[]).slice(0,18000)){
    const series_id=Number(v?.series_id),title=cleanXtreamTitle(v?.name);
    if(!Number.isSafeInteger(series_id)||series_id<=0||!title)continue;
    const year=String(v?.releaseDate||v?.release_date||v?.name||"").match(/\b(?:19|20)\d{2}\b/)?.[0]||"";
    seriesRows.push({title,provider,provider_id:id,series_id,year,
     poster:String(v.cover||"").startsWith("https://")?String(v.cover).slice(0,2000):""});
   }
  }
  xtreamMovies=movieRows;xtreamSeries=seriesRows;
  if(typeof window!=="undefined")window.LumaVODLibrary?.refreshLocal?.();
 }
 async function apiEpisodes(title,year=""){
  const matching=xtreamSeries.filter(row=>norm(row.title)===norm(title)&&(!year||!row.year||row.year===String(year)));
  const all=[];
  for(const row of matching.slice(0,8)){
   const key=row.provider_id+":"+row.series_id;
   if(!episodeCache.has(key)){
    let found=[];
    try{
     if(typeof LumaIPTV==="undefined"||typeof LumaIPTV.xtreamById!=="function")throw Error("Xtream connection unavailable");
     const info=await LumaIPTV.xtreamById(row.provider_id,"get_series_info",{series_id:row.series_id});
     const seasons=Array.isArray(info?.episodes)?{"1":info.episodes}:info?.episodes||{};
     if(seasons&&typeof seasons==="object"){
      for(const [season,episodes] of Object.entries(seasons)){
       if(!Array.isArray(episodes))continue;
       for(const entry of episodes.slice(0,500)){
        const epId=Number(entry?.id),epSeason=Number(entry?.season||season),epNumber=Number(entry?.episode_num||entry?.episode);
        if(!Number.isSafeInteger(epId)||epId<=0||!Number.isInteger(epSeason)||epSeason<1||
           !Number.isInteger(epNumber)||epNumber<1)continue;
        const ext=String(entry.container_extension||"mp4").toLowerCase();
        if(!/^[a-z0-9]{2,6}$/.test(ext))continue;
        found.push({season:epSeason,number:epNumber,title:String(entry.title||"Episode "+epNumber).slice(0,160),
         provider_id:row.provider_id,provider:row.provider,stream_id:epId,extension:ext});
       }
      }
     }
    }catch{}
    episodeCache.set(key,found);
   }
   all.push(...episodeCache.get(key));
  }
  return all.sort((a,b)=>a.season-b.season||a.number-b.number);
 }
 async function getEpisodes(title,year=""){
  const original=episodes(title,year);
  const remote=await apiEpisodes(title,year);
  const seen=new Set(original.map(e=>e.season+":"+e.number));
  return [...original,...remote.filter(e=>{
   const key=e.season+":"+e.number;
   if(seen.has(key))return false;
   seen.add(key);return true;
  })].sort((a,b)=>a.season-b.season||a.number-b.number);
 }

 // Browse provider-supplied VOD metadata without exposing playable URLs.
 function catalog(){
  const groups=new Map();
  for(const row of sessionRows){
   const type=row.type==="movie"?"Movie":"Series",key=type+"|"+row.key+"|"+row.year;
   if(!groups.has(key))groups.set(key,{
    id:"iptvlib:local:"+key,type,title:row.title,year:row.year||"",
    providers:[],sources:[],poster:/^https:\/\//i.test(String(row.logo||""))?row.logo:"",
    episodeCount:0
   });
   const item=groups.get(key),provider=String(row.provider||"My IPTV");
   if(!item.providers.includes(provider))item.providers.push(provider);
   if(!item.sources.some(v=>v.provider===provider))item.sources.push({provider});
   if(type==="Series"&&row.season>0&&row.number>0)item.episodeCount++;
  }
  for(const v of [...xtreamMovies.map(v=>({...v,type:"Movie"})),...xtreamSeries.map(v=>({...v,type:"Series"}))]){
   const key=v.type+"|"+norm(v.title)+"|"+v.year;
   if(!groups.has(key))groups.set(key,{
    id:"iptvlib:xtream:"+key,type:v.type,title:v.title,year:v.year||"",
    providers:[],sources:[],poster:v.poster||"",episodeCount:0
   });
   const entry=groups.get(key);
   if(!entry.providers.includes(v.provider))entry.providers.push(v.provider);
   if(!entry.sources.some(x=>x.provider_id===v.provider_id&&x.series_id===v.series_id))
    entry.sources.push({provider:v.provider,provider_id:v.provider_id,series_id:v.series_id||"",origin:"xtream-native"});
   if(!entry.poster&&v.poster)entry.poster=v.poster;
  }
  return [...groups.values()].sort((a,b)=>a.title.localeCompare(b.title)||a.year.localeCompare(b.year));
 }
 function episodes(title,year=""){
  const name=norm(title),found=new Map();
  for(const row of sessionRows){
   if(row.type!=="series"||row.key!==name||year&&row.year&&year!==row.year||row.season<1||row.number<1)continue;
   const key=row.season+":"+row.number;
   if(!found.has(key))found.set(key,{season:row.season,number:row.number,title:"Episode "+row.number});
  }
  return [...found.values()].sort((a,b)=>a.season-b.season||a.number-b.number);
 }
 function matches(rows,x,ep){
  const kind=x.type==="Movie"?"movie":"series",year=String(x.year||"");
  return(rows||[]).filter(v=>v.type===kind&&v.key===norm(x.title)&&(!year||!v.year||year===v.year)
    &&(kind==="movie"||ep&&v.season===Number(ep.season_number||ep.season)&&v.number===Number(ep.episode_number||ep.episode)))
    .sort((a,b)=>(b.quality||0)-(a.quality||0)).slice(0,25);
 }
 async function find(x,ep){
  const c=cfg();
  const results=matches(sessionRows,x,ep).map(v=>({...v,provider:v.provider||c.name||"IPTV"}));
  const errors=[];
  if(typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.xtreamStreamURL==="function"){
   if(x.type==="Movie"){
    for(const movie of xtreamMovies.filter(v=>norm(v.title)===norm(x.title)&&(!x.year||!v.year||String(x.year)===v.year)).slice(0,25)){
     const url=LumaIPTV.xtreamStreamURL(movie.provider_id,"movie",movie.stream_id,movie.extension);
     if(url)results.push({url,name:movie.title,provider:movie.provider,quality:movie.quality||0});
    }
   }else if(ep){
    const found=await apiEpisodes(x.title,x.year);
    for(const item of found.filter(v=>v.season===Number(ep.season_number||ep.season)&&v.number===Number(ep.episode_number||ep.episode)).slice(0,25)){
     const url=LumaIPTV.xtreamStreamURL(item.provider_id,"series",item.stream_id,item.extension);
     if(url)results.push({url,name:item.title,provider:item.provider,quality:0});
    }
   }
  }
  if(c.host&&c.token){
   try{
    const u=new URL(c.host);if(u.protocol!=="https:")throw Error("DVR companion requires HTTPS");
    const q=new URLSearchParams({title:x.title,type:x.type==="Movie"?"movie":"series",year:String(x.year||"")});
    if(ep){q.set("season",String(ep.season_number||ep.season||0));q.set("episode",String(ep.episode_number||ep.episode||0))}
    const r=await fetch(c.host.replace(/\/+$/,"")+"/vod/search?"+q,{headers:{Authorization:"Bearer "+c.token},cache:"no-store"});
    const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(json.error||"DVR VOD search unavailable");
    results.push(...(json.matches||[]).map(v=>({...v,provider:v.provider||c.name||"IPTV"})));
   }catch(e){errors.push("Recorder: "+String(e.message||e))}
  }
  if(c.m3u){
   try{
    if(!/^https:\/\//i.test(c.m3u))throw Error("Browser playlists must use HTTPS; use DVR for HTTP/LAN sources");
    if(cache.url!==c.m3u||Date.now()-cache.time>15*60000){
     const r=await fetch(c.m3u,{cache:"no-store"});if(!r.ok)throw Error("IPTV playlist HTTP "+r.status);
     const txt=await r.text();if(txt.length>5*1024*1024)throw Error("IPTV playlist too large");
     cache={url:c.m3u,time:Date.now(),rows:parse(LumaIPTV.parseM3U(txt))};
    }
    results.push(...matches(cache.rows,x,ep).map(v=>({...v,provider:v.provider||c.name||"IPTV"})));
   }catch(e){errors.push("Playlist: "+String(e.message||e))}
  }
  const seen=new Set();
  const unique=results.filter(v=>{if(!/^https?:\/\//i.test(String(v.url||"")))return false;const key=v.url;if(seen.has(key))return false;seen.add(key);return true});
  unique.sort((a,b)=>(Number(b.quality)||0)-(Number(a.quality)||0));
  if(!unique.length&&errors.length)throw Error(errors.join("; "));
  return unique.slice(0,25);
 }
 async function choose(x,ep,manifest){
  const c=cfg();if(!c.m3u&&!sessionRows.length&&!xtreamMovies.length&&!xtreamSeries.length&&!(c.host&&c.token)){manifest();return}
  modal('<div class="pad"><h2>Checking IPTV sources…</h2></div>');
  let rows=[],error="";
  try{rows=await find(x,ep)}catch(e){error=String(e.message||e)}
  const installed=typeof LumaAddons!=="undefined"&&LumaAddons.installed()>0;
  const episodeLabel=ep?"Season "+esc(ep.season_number||ep.season||"?")+" · Episode "+esc(ep.episode_number||ep.episode||"?"):"Movie";
  let html='<div class="pad lumaVodChooser"><div class="lumaVodEyebrow">✦ CHOOSE PLAYBACK</div><h2>'+esc(x.title)+'</h2>'
    +'<p class="lumaVodSub">'+episodeLabel+' · Choose an IPTV stream or search your installed manifest.json add-ons.</p>'
    +'<section class="lumaVodSection"><div class="lumaVodHeading"><h3>📡 IPTV library</h3><span>'+rows.length+' matching source'+(rows.length===1?'':'s')+'</span></div>'
    +(rows.length?'<div class="lumaVodCards">'+rows.map((v,i)=>{
      const quality=Number(v.quality)||0;
      return '<article class="lumaVodCard"><div class="lumaVodMeta"><span class="lumaVodProvider">'+esc(v.provider||"IPTV")+'</span><span class="lumaVodQuality">'+(quality>=2?"4K / UHD":quality>=1?"HD":"Video")+'</span></div>'
        +'<strong class="lumaVodTitle">'+esc(v.name||v.title||"Stream")+'</strong><div class="lumaVodActions">'
        +'<button type="button" class="primary small" data-iptv-play="'+i+'">▶ Play in Luma</button>'
        +'</div></article>'
    }).join("")+'</div>':'<p class="micro">No exact IPTV match found. Try a manifest source below.</p>')
    +(error?'<p class="micro lumaVodError">IPTV lookup: '+esc(error)+'</p>':"")+'</section>'
    +'<section class="lumaVodSection"><div class="lumaVodHeading"><h3>✦ Manifest add-ons</h3><span>Other playback sources</span></div>'
    +(installed?'<p class="micro">Search installed manifest add-ons for this title or selected episode.</p><button type="button" class="primary" id="manifestChoice">Browse manifest streams</button>':'<p class="micro">No manifest add-ons installed.</p><button type="button" class="secondary" id="manageManifest">Manage Add-ons</button>')
    +'</section><button type="button" class="secondary lumaVodBack" id="vodBack">← Back to details</button></div>';
  modal(html);
  for(const btn of document.querySelectorAll("[data-iptv-play]"))btn.onclick=()=>{
    const v=rows[Number(btn.dataset.iptvPlay)];if(v&&/^https?:\/\//.test(v.url))play(x,ep,v.url);
  };
  const m=document.querySelector("#manifestChoice");if(m)m.onclick=manifest;
  const a=document.querySelector("#manageManifest");if(a)a.onclick=()=>{closeModal();state.tab="Add-ons";render()};
  document.querySelector("#vodBack").onclick=()=>showDetails();
 }
 return {choose,parse,matches,setRows,setXtreamCatalog,find,catalog,episodes,getEpisodes,__test:{apiEpisodes}};
})();