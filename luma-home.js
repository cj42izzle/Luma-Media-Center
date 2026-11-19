"use strict";
/* Luma's TV-first personal home. Uses real playback, DVR, schedule and news data.
   No synthetic release dates, invented recordings or fabricated news stories. */
const LumaHome=(()=>{
 const LOCATION_KEY="luma.home.newsLocation.v1",NEWS_KEY="luma.home.newsCache.v1",NEWS_TTL=25*60*1000;
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const text=s=>String(s??"").trim();
 const safeURL=value=>{try{const u=new URL(String(value||""));return /^https?:$/.test(u.protocol)?u.href:""}catch{return""}};
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||"null")||fallback}catch{return fallback}};
 const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{}};
 const humanDate=value=>{const time=Date.parse(String(value||""));return Number.isFinite(time)?new Date(time).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"Date unavailable"};
 const timeText=value=>{const t=Number(value),date=Number.isFinite(t)&&t>1e11?new Date(t):new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"Date pending"};
 const lastDate=x=>{const str=String(x?.date||x?.releaseDate||x?.firstAirDate||"");if(!/^\d{4}-\d\d-\d\d$/.test(str))return 0;if(x.source==="cinemeta"&&str.endsWith("-01-01"))return 0;return Date.parse(str+"T12:00:00Z")||0};
 let city=text(read(LOCATION_KEY,"Reno, NV")).slice(0,80)||"Reno, NV";
 let articles=read(NEWS_KEY,{city:"Reno, NV",at:0,local:[],national:[]});
 if(!articles||typeof articles!=="object"||!Array.isArray(articles.local)||!Array.isArray(articles.national))
  articles={city,at:0,local:[],national:[]};
 let busy=false,inflight=null;
 const locationQuery=()=>{const q=city.split(",").map(text).filter(Boolean);return q.length>1?'"'+q[0]+'" "'+q.slice(1).join(" ")+'"': '"'+city+'"';};
 const linkToNews=local=>local?"https://news.google.com/search?q="+encodeURIComponent(city+" news")+"&hl=en-US&gl=US&ceid=US:en":"https://news.google.com/topstories?hl=en-US&gl=US&ceid=US:en";
 function parseArticles(data){
  const seen=new Set(),now=Date.now();
  return (Array.isArray(data?.articles)?data.articles:[]).flatMap(row=>{
   const title=text(row?.title).slice(0,170),url=safeURL(row?.url);
   if(!title||title.length<8||!url||seen.has(url))return [];
   const stamp=String(row?.seendate||"").replace(/\D/g,"");
   let date=0;
   if(stamp.length>=12)date=Date.UTC(Number(stamp.slice(0,4)),Number(stamp.slice(4,6))-1,Number(stamp.slice(6,8)),Number(stamp.slice(8,10)),Number(stamp.slice(10,12)));
   if(!date||date>now+86400000||date<now-7*86400000)return [];
   seen.add(url);
   return [{title,url,source:text(row.domain||row.sourcecountry||"News").slice(0,90),
    date,language:text(row.language).slice(0,25)}];
  }).slice(0,9);
 }
 async function fetchHeadlines(local){
  const query=(local?locationQuery()+' sourcelang:english':'"United States" sourcelang:english');
  const endpoint="https://api.gdeltproject.org/api/v2/doc/doc?"+new URLSearchParams({
   query,mode:"ArtList",format:"json",sort:"DateDesc",maxrecords:"20",timespan:"3d"
  });
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12500);
  try{
   const response=await fetch(endpoint,{signal:ctrl.signal,cache:"no-store"});
   if(!response.ok)throw Error("News feed returned "+response.status);
   const data=await response.json();
   return parseArticles(data);
  }finally{clearTimeout(timer)}
 }
 function prime(force=false){
  if(inflight)return inflight;
  if(!force&&articles.city===city&&Date.now()-Number(articles.at||0)<NEWS_TTL)
   return Promise.resolve(articles);
  busy=true;
  inflight=(async()=>{
   const [local,national]=await Promise.allSettled([fetchHeadlines(true),fetchHeadlines(false)]);
   const next={city,at:Date.now(),
    local:local.status==="fulfilled"?local.value:(articles.city===city?articles.local:[]),
    national:national.status==="fulfilled"?national.value:articles.national};
   articles=next;write(NEWS_KEY,next);
   return next;
  })().finally(()=>{
   busy=false;inflight=null;
   if(typeof state!=="undefined"&&state.tab==="Home"&&typeof window!=="undefined")window.LumaRender?.();
  });
  return inflight;
 }
 function cleanCity(value){
  const v=text(value).replace(/\s+/g," ");
  if(v.length<2||v.length>70||!/^[\p{L}0-9 .,'-]+$/u.test(v))throw Error("Enter a city and state, for example Reno, NV");
  return v;
 }
 function changeCity(value){
  const v=cleanCity(value);
  if(v===city)return Promise.resolve(articles);
  city=v;write(LOCATION_KEY,v);
  articles={city,at:0,local:[],national:articles.national};
  return prime(true);
 }
 function newTitles(items,kind,days=145){
  const now=Date.now(),start=now-days*86400000,seen=new Set();
  return (Array.isArray(items)?items:[]).filter(x=>{
   if(kind==="Movie"?x?.type!=="Movie":!(x?.type==="Series"||x?.type==="Anime"))return false;
   const date=lastDate(x);if(!date||date<start||date>now+86400000||seen.has(x.id))return false;
   seen.add(x.id);return true;
  }).sort((a,b)=>lastDate(b)-lastDate(a)).slice(0,24);
 }
 function premiereRows(rows){
  const now=Date.now(),future=now+21*86400000;
  return (Array.isArray(rows)?rows:[]).filter(x=>{
   if(Number(x?.season)!==1||Number(x?.number)!==1)return false;
   const ts=Number(x.airStamp)||Date.parse(String(x.airdate||"")+"T12:00:00Z");
   return Number.isFinite(ts)&&ts>=now-8*3600000&&ts<future;
  }).sort((a,b)=>(Number(a.airStamp)||Date.parse(a.airdate))-(Number(b.airStamp)||Date.parse(b.airdate))).slice(0,10);
 }
 const jump=(tab,label,desc,icon)=>'<button type="button" class="lumaHomeJump" data-go="'+esc(tab)+'"><span class="lumaHomeJumpIcon" aria-hidden="true">'+icon+'</span><strong>'+esc(label)+'</strong><small>'+esc(desc)+'</small></button>';
 function emptySection(name,description,tab,button){
  return '<section class="lumaHomePanel lumaHomeEmpty"><div class="lumaHomeSectionHead"><h2>'+esc(name)+'</h2></div>'
   +'<p>'+esc(description)+'</p><button type="button" class="secondary" data-go="'+esc(tab)+'">'+esc(button)+'</button></section>';
 }
 function dvrSection(online,device){
  const rows=[];
  for(const job of (Array.isArray(online)?online:[]))rows.push({...job,kind:"server"});
  for(const job of (Array.isArray(device)?device:[]))rows.push({...job,kind:"device"});
  rows.sort((a,b)=>(Number(b.start)||0)-(Number(a.start)||0));
  const list=rows.filter(x=>["complete","partial","recording","scheduled"].includes(x.status)).slice(0,8);
  return '<section class="lumaHomePanel lumaHomeDvr" aria-label="Your DVR recordings">'
   +'<div class="lumaHomeSectionHead"><div><span class="eyebrow">SAVED TELEVISION</span><h2>DVR Recordings</h2></div>'
   +'<button class="secondary small" type="button" data-go="Recordings">View DVR ›</button></div>'
   +(list.length?'<div class="lumaHomeDvrRail">'+list.map(job=>{
    const ready=["complete","partial"].includes(job.status)&&job.id;
    const status=job.status==="complete"?"Ready to watch":job.status==="recording"?"Recording now":job.status==="scheduled"?"Scheduled":"Partially saved";
    return '<button type="button" class="lumaHomeDvrItem" '+(ready?'data-home-recording="'+esc(job.id)+'" data-home-rec-source="'+job.kind+'"':'data-go="Recordings"')+'>'
     +'<span class="lumaDvrIcon" aria-hidden="true">'+(ready?"▶":"●")+'</span>'
     +'<strong>'+esc(job.title||"Untitled recording")+'</strong>'
     +'<small>'+esc(status)+(job.start?" · "+esc(timeText(job.start)):"")+'</small></button>';
   }).join("")+'</div>':
    '<div class="lumaHomeEmptyInner"><p>No DVR recordings yet. Your scheduled and completed shows will appear here once a recorder is connected.</p>'
    +'<button class="secondary" type="button" data-go="Recordings">Open DVR</button></div>')
   +'</section>';
 }
 function premiereSection(rows){
  const matches=premiereRows(rows);
  return '<section class="lumaHomePanel lumaHomePremieres" aria-label="Upcoming TV series premieres">'
   +'<div class="lumaHomeSectionHead"><div><span class="eyebrow">FIRST EPISODES</span><h2>New TV Shows Premiering</h2></div>'
   +'<button class="secondary small" type="button" data-go="Calendar">TV Calendar ›</button></div>'
   +(matches.length?'<div class="lumaHomePremiereRail">'+matches.map(x=>
    '<button type="button" class="lumaHomePremiere" data-go="Calendar"><span class="lumaPremiereTag">NEW SERIES</span>'
    +'<strong>'+esc(x.title)+'</strong><small>'+esc(x.episode||"Series premiere")+'</small>'
    +'<span>'+esc(x.timeLabel&&x.timeLabel!=="Time not announced"?x.timeLabel:humanDate(x.airdate))
    +(x.channel?" · "+esc(x.channel):"")+'</span></button>').join("")+'</div>':
    '<div class="lumaHomeEmptyInner"><p>No confirmed series premieres in the currently loaded broadcast schedule. New first episodes will appear when their dates are published.</p>'
    +'<button class="secondary" type="button" data-go="Calendar">Explore airing shows</button></div>')
   +'</section>';
 }
 function newsSection(local){
  const list=Array.isArray(local?articles.local:articles.national)?(local?articles.local:articles.national):[];
  const name=local?"Local News":"News & Headlines",url=linkToNews(local);
  return '<section class="lumaHomePanel lumaHomeNews" aria-label="'+name+'">'
   +'<div class="lumaHomeSectionHead"><div><span class="eyebrow">'+(local?"AROUND YOU":"CURRENT HEADLINES")+'</span><h2>'+esc(name)+'</h2></div>'
   +'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">More news ↗</a></div>'
   +(local?'<form class="lumaNewsLocation" id="lumaNewsCityForm"><label for="lumaNewsCity">Local area</label>'
    +'<input id="lumaNewsCity" type="text" value="'+esc(city)+'" maxlength="70" placeholder="City, state" autocomplete="address-level2">'
    +'<button type="submit" class="secondary small">Change</button></form>':"")
   +(list.length?'<div class="lumaHomeNewsList">'+list.slice(0,6).map(x=>
    '<a class="lumaHomeNewsStory" href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'
    +'<span class="lumaNewsSource">'+esc(x.source||"News")+' · '+esc(humanDate(new Date(x.date).toISOString()))+'</span>'
    +'<strong>'+esc(x.title)+'</strong><span class="lumaNewsArrow" aria-hidden="true">↗</span></a>').join("")+'</div>':
    '<div class="lumaHomeEmptyInner"><p>'+(busy?"Loading headlines from public news sources…":"Live headlines are temporarily unavailable. Open the source to see verified reporting.")+'</p>'
    +'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Browse '+(local?"local":"national")+' news ↗</a></div>')
   +(local&&/reno/i.test(city)?'<div class="lumaHomeNewsPublishers"><a href="https://www.2news.com/" target="_blank" rel="noopener noreferrer">KTVN</a>'
    +'<a href="https://www.kolotv.com/" target="_blank" rel="noopener noreferrer">KOLO</a>'
    +'<a href="https://www.rgj.com/" target="_blank" rel="noopener noreferrer">RGJ</a>'
    +'<a href="https://mynews4.com/" target="_blank" rel="noopener noreferrer">KRNV</a></div>':"")
   +'</section>';
 }
 function markup(model,shelf){
  const items=Array.isArray(model?.items)?model.items:[],watching=Array.isArray(model?.watching)?model.watching:[];
  const movies=newTitles(items,"Movie",180),shows=newTitles(items,"Series",240);
  const released=typeof LumaReleases!=="undefined"?LumaReleases.inTheaters?.()||[]:[];
  const newMovies=[...released.filter(x=>x?.cinemaVerified),...movies].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
  return '<div class="lumaHomeDashboard">'
   +'<nav class="lumaHomeQuick" aria-label="Quick navigation">'
   +jump("Live TV","Live TV","Watch your channels","▣")
   +jump("Guide","TV Guide","What’s on next","▦")
   +jump("Recordings","Recordings","Your DVR","●")
   +jump("Calendar","TV Premieres","New episodes","◷")
   +jump("Anime","Anime","Discover more","✧")
   +'</nav>'
   +(watching.length?shelf("Resume Watching",watching,"Continue from your last saved position","Continue Watching"):
    emptySection("Resume Watching","Your movies and episodes appear here once you start watching something.","My Library","Explore your library"))
   +dvrSection(model?.dvrJobs,model?.deviceJobs)
   +(newMovies.length?shelf("New Movies",newMovies,"Recent reported releases and verified theatrical listings","Movies"):
     emptySection("New Movies","Recent movie releases appear as metadata is published. Your library never fills this row with old titles labeled new.","Movies","Browse movies"))
   +(shows.length?shelf("New TV Shows",shows,"Recently premiered series","TV Shows"):
     emptySection("New TV Shows","New series are added when reliable first-air dates are available.","TV Shows","Find TV shows"))
   +premiereSection(model?.calendarRows)
   +'<div class="lumaHomeNewsGrid">'+newsSection(true)+newsSection(false)+'</div>'
   +'</div>';
 }
 function bind(){
  const form=document.querySelector("#lumaNewsCityForm");
  if(form)form.onsubmit=e=>{
   e.preventDefault();
   const value=document.querySelector("#lumaNewsCity")?.value||"";
   changeCity(value).catch(err=>{if(typeof toast==="function")toast(String(err.message||err))});
  };
  for(const button of document.querySelectorAll("[data-home-recording]"))button.onclick=()=>{
   const id=button.dataset.homeRecording,source=button.dataset.homeRecSource;
   try{
    if(source==="device"&&typeof LumaDeviceDVR!=="undefined"&&LumaDeviceDVR.available())LumaDeviceDVR.call("open",id);
    else if(source==="server"&&typeof LumaIPTV!=="undefined")LumaIPTV.watchRecording(id);
    else throw Error("Recording is not available on this device");
   }catch(e){if(typeof toast==="function")toast(String(e?.message||e))}
  };
 }
 if(typeof window!=="undefined"){
  window.addEventListener("luma-native-dvr-ready",()=>{if(typeof state!=="undefined"&&state.tab==="Home")window.LumaRender?.()});
  window.addEventListener("luma-native-dvr-storage",()=>{if(typeof state!=="undefined"&&state.tab==="Home")window.LumaRender?.()});
 }
 return {markup,bind,prime,changeCity,parseArticles,newTitles,premiereRows,getLocation:()=>city,getNews:()=>articles};
})();
