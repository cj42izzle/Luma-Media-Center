"use strict";
/* Luma Android TV Home: live-first 10-foot layout modeled on the familiar
   streaming-TV pattern of channel ribbon, feature preview and content rails.
   All programme data originates from the user's connected IPTV/metadata sources. */
const LumaTVExperience=(()=>{
 const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const navLinks=[["Home","⌂","Home"],["Live TV","◉","Live TV"],["Guide","▦","Guide"],
  ["Catalogs","⌕","Discover"],["My Library","▰","My Stuff"],["Settings","⚙","Settings"]];
 const recentKey="luma.tv.recentChannels.v1";
 function nav(root,active){
  if(!root)return;
  if(document.body?.dataset)document.body.dataset.lumaTvView=active==="Home"?"home":"other";
  if(root.dataset.tvNavBuilt!=="true"){
   root.innerHTML='<div class="tvBrand"><strong>Luma</strong><span>TV</span></div>'
    +'<div class="tvNavRail">'+navLinks.map(([key,icon,label])=>'<button type="button" class="tvNavTab" data-tab="'+esc(key)+'" title="'+esc(label)+'" aria-label="'+esc(label)+'"><i aria-hidden="true">'+icon+'</i><span class="tvNavLabel">'+esc(label)+'</span></button>').join("")+'</div>'
    +'<div class="tvNavTools"><div class="tvSidebarSearch" role="search">'
    +'<button type="button" class="tvNavTool" id="lumaTvSearch" aria-label="Open search in sidebar">⌕ <span>Search</span></button>'
    +'<label for="lumaTvSidebarSearch">Search movies, shows, anime and channels</label>'
    +'<input id="lumaTvSidebarSearch" type="search" autocomplete="off" placeholder="Search everything" aria-label="Search movies, TV, anime and channels"></div>'
    +'<button type="button" class="tvNavTool" id="lumaTvProfile" aria-label="Choose viewer profile">◉ <span>Viewer</span></button>'
    +'<button type="button" class="tvNavTool" id="lumaTvMore" aria-label="More sections and settings">☰ <span>More</span></button></div>';
   root.dataset.tvNavBuilt="true";
   const search=root.querySelector?.("#lumaTvSidebarSearch");
   if(search?.addEventListener)search.addEventListener("input",event=>{
     const value=String(event.target.value||"");
     const header=document.querySelector?.("#search");
     if(header)header.value=value;
     if(typeof onSearch==="function")onSearch(value);
   });
  }
  const sideSearch=root.querySelector?.("#lumaTvSidebarSearch");
  if(sideSearch&&document.activeElement!==sideSearch&&typeof state!=="undefined"&&sideSearch.value!==state.q)sideSearch.value=state.q;
  for(const button of root.querySelectorAll("[data-tab]")){
   const selected=button.dataset.tab===active;
   button.classList.toggle("active",selected);
   button.setAttribute("aria-current",selected?"page":"false");
  }
 }
 function safeUrl(value){
  try{const url=new URL(String(value||""));return url.protocol==="https:"&&!url.username&&!url.password?url.href:""}
  catch{return""}
 }
 function recentIds(){
  try{const data=JSON.parse(localStorage.getItem(recentKey)||"[]");
   return Array.isArray(data)?data.filter(x=>typeof x==="string").slice(0,10):[]}
  catch{return []}
 }
 function remember(id){
  if(!id)return;
  try{localStorage.setItem(recentKey,JSON.stringify([String(id),...recentIds().filter(x=>x!==String(id))].slice(0,10)))}
  catch{}
 }
 const time=stamp=>new Date(stamp).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
 const mins=ms=>Math.max(0,Math.ceil(ms/60000));
 function progress(p,now){
  const start=Number(p?.start),end=Number(p?.end);
  return Number.isFinite(start)&&Number.isFinite(end)&&end>start?
    Math.max(0,Math.min(100,100*(now-start)/(end-start))):0;
 }
 function channelArt(c){
  const src=safeUrl(c?.logo);
  return src?'<img class="tvNetworkLogo" src="'+esc(src)+'" alt="" loading="lazy" onerror="this.remove()">'
   :'<span class="tvNetworkGlyph" aria-hidden="true">'+esc(String(c?.name||"TV").slice(0,2).toUpperCase())+'</span>';
 }
 function channelButton(c,kind="strip"){
  const suffix=kind==="strip"?"tvNetworkTile":"tvLiveTile";
  return '<button type="button" class="'+suffix+'" data-tv-channel="'+esc(c.id)+'" aria-label="Watch '+esc(c.name)+'">'
    +channelArt(c)+'<span class="tvNetworkName">'+esc(c.name)+'</span></button>';
 }
 function formatProgramMeta(p,channel,now){
  return p?esc(channel?.name||"IPTV channel")+' · '+esc(time(p.start))+'–'+esc(time(p.end))
    +(p.episode?' · '+esc(p.episode):""):esc(channel?.name||"Your channels")+' · Schedule unavailable';
 }
 function programmeTiles(channels,currentById,now){
  return channels.filter(c=>currentById.has(c.id)).slice(0,14).map(c=>{
   const p=currentById.get(c.id),pct=progress(p,now),remaining=mins(Number(p.end)-now);
   return '<button class="tvProgrammeTile" type="button" data-tv-channel="'+esc(c.id)+'" aria-label="Watch '+esc(p.title)+' on '+esc(c.name)+'">'
    +'<span class="tvProgrammeImage">'+channelArt(c)+'<span class="tvProgrammeLive">LIVE</span></span>'
    +'<span class="tvProgrammeCaption"><small>'+esc(c.name)+'</small><b>'+esc(p.title)+'</b>'
    +'<span class="tvProgrammeTime">'+remaining+' min left</span></span>'
    +'<span class="tvProgrammeProgress"><i style="width:'+pct.toFixed(1)+'%"></i></span></button>';
  }).join("");
 }
 function tvPremiereDay(item){
  const stamp=Number(item?.airStamp);
  if(Number.isFinite(stamp)&&stamp>1e11){
   const d=new Date(stamp);
   if(Number.isFinite(d.getTime()))return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  return String(item?.airdate||"");
 }
 function tvPremiereDaysAway(day){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if(!m)return null;
  const target=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]));
  if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,10)!==day)return null;
  const now=new Date(),local=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  return Math.round((target-local)/86400000);
 }
 function tvPremiereSection(model){
  const followed=Array.isArray(model?.followedRows)?model.followedRows:[],
   regular=Array.isArray(model?.calendarRows)?model.calendarRows:[];
  const seen=new Set(),rows=[];
  for(const e of [...followed,...regular]){
   if(!e?.title||Number(e.season)<1||Number(e.number)<1)continue;
   const isPremiere=Number(e.number)===1;
   if(!isPremiere&&!followed.includes(e))continue;
   const date=tvPremiereDay(e),days=tvPremiereDaysAway(date);
   if(days===null||days<0||days>90)continue;
   const key=String(e.id||e.showId+":"+e.season+":"+e.number)+":"+date;
   if(seen.has(key))continue;
   seen.add(key);rows.push({...e,day:date,days,kind:isPremiere?(Number(e.season)===1?"SERIES PREMIERE":"SEASON PREMIERE"):"NEW EPISODE"});
  }
  rows.sort((a,b)=>a.day.localeCompare(b.day)||(a.airStamp??Infinity)-(b.airStamp??Infinity));
  if(!rows.length)return "";
  return '<section class="tvHomePremieres" aria-label="Upcoming series and season premieres">'
   +'<div class="tvHomePremiereHeading"><div><span>WHAT’S COMING NEXT</span><h2>Premiere Radar</h2></div>'
   +'<button type="button" data-go="Calendar">Full Calendar ›</button></div>'
   +'<div class="tvHomePremiereRail">'+rows.slice(0,12).map(e=>{
    const image=safeUrl(e.image||e.poster);
    const countdown=e.days===0?"PREMIERES TODAY":e.days===1?"1 DAY LEFT":e.days+" DAYS LEFT";
    return '<button type="button" class="tvHomePremiereCard" data-tv-premiere-day="'+esc(e.day)+'" aria-label="'+esc(e.title)+' '+esc(e.kind)+' '+esc(countdown)+'">'
      +'<span class="tvHomePremiereArt">'+(image?'<img src="'+esc(image)+'" alt="" loading="lazy" decoding="async" onerror="this.remove()">':'<span aria-hidden="true">✦</span>')+'</span>'
      +'<span class="tvHomePremiereInfo"><small>'+esc(e.kind)+'</small><strong>'+esc(e.title)+'</strong>'
      +'<span>S'+esc(e.season)+'E'+esc(e.number)+' · '+esc(e.day)+'</span>'
      +'<em class="'+(e.days===0?"isToday":"")+'">'+esc(countdown)+'</em></span></button>';
   }).join("")+'</div></section>';
 }
 function markup(model,shelf){
  const items=Array.isArray(model?.items)?model.items:[],watching=Array.isArray(model?.watching)?model.watching:[],
   watchlist=Array.isArray(model?.watchlist)?model.watchlist:[],favoriteTitles=Array.isArray(model?.favorites)?model.favorites:[];
  const stations=typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.channels==="function"?LumaIPTV.channels():[];
  const programmes=typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.programs==="function"?LumaIPTV.programs():[];
  const recent=recentIds(),recentSet=new Set(recent),byId=new Map(),favorites=[],first=[],movies=[],series=[];
  let backdrop="";
  for(const c of stations){
   if(!c?.id||!c.name||!c.url)continue;
   byId.set(c.id,c);
   if(first.length<14)first.push(c);
   if(favorites.length<12&&typeof LumaIPTV.isFavorite==="function"&&LumaIPTV.isFavorite(c.id))favorites.push(c);
  }
  const chosen=[],seen=new Set();
  function add(c){if(c?.id&&!seen.has(c.id)&&chosen.length<14){chosen.push(c);seen.add(c.id)}}
  for(const id of recent) add(byId.get(id));
  for(const c of favorites)add(c);
  for(const c of first)add(c);
  const selected=new Set(chosen.map(c=>c.id)),now=Date.now(),currentById=new Map(),nextById=new Map();
  for(const p of programmes){
   if(!selected.has(p?.channel_id))continue;
   const start=Number(p.start),end=Number(p.end);
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
   if(start<=now&&end>now){
    const existing=currentById.get(p.channel_id);
    if(!existing||start>Number(existing.start))currentById.set(p.channel_id,p);
   }else if(start>now&&start<now+12*3600000){
    const old=nextById.get(p.channel_id);
    if(!old||start<Number(old.start))nextById.set(p.channel_id,p);
   }
  }
  const current=chosen.filter(c=>currentById.has(c.id));
  const heroChannel=current[0]||chosen[0]||null,show=heroChannel?currentById.get(heroChannel.id):null;
  const next=chosen.map(c=>({channel:c,program:nextById.get(c.id)})).filter(x=>x.program)
    .sort((a,b)=>Number(a.program.start)-Number(b.program.start)).slice(0,3);
  for(const item of items){
   if(movies.length<20&&item?.type==="Movie")movies.push(item);
   if(series.length<20&&(item?.type==="Series"||item?.type==="Anime"))series.push(item);
   if(!backdrop)backdrop=safeUrl(item?.backdrop)||safeUrl(item?.poster);
   if(movies.length>=20&&series.length>=20&&backdrop)break;
  }
  // Broadcast artwork is attached only to exact title matches; never label
  // an unrelated movie poster as the current live programme.
  const showArt=show?items.find(x=>String(x?.title||"").trim().toLowerCase()===String(show.title||"").trim().toLowerCase()):null;
  const artwork=safeUrl(showArt?.backdrop)||safeUrl(showArt?.poster);
  const total=byId.size,nowLabel=time(now);
  const heading='<header class="tvYourTVHeader"><div><span class="tvEyebrow">WELCOME TO LUMA</span><h1>Your TV <span>at '+esc(nowLabel)+'</span></h1></div>'
   +'<button type="button" class="tvGuideShortcut" data-go="Guide">▦ Go to Guide <span aria-hidden="true">›</span></button></header>';
  const strip=chosen.length?'<section class="tvTopChannels" aria-label="Recently selected and favorite TV channels">'
    +'<div class="tvTopChannelsTitle"><b>Your channels</b><small>Favorites and recently selected stations</small></div>'
    +'<div class="tvChannelStrip">'+chosen.map(c=>channelButton(c)).join("")+'</div></section>':
    '<section class="tvNoChannels"><h2>Add your TV service</h2><p>Connect your IPTV provider to see real stations and live programmes here.</p>'
    +'<button type="button" data-go="Settings">⚙ Connect TV</button></section>';
  const title=show?.title||heroChannel?.name||"Live TV is one click away";
  const description=show?.description||((heroChannel&&show)?"Watch what's airing on "+heroChannel.name+".":heroChannel?
   "You can watch this channel now. Programme information isn't available from your provider yet.":
   "Add a provider in Settings or browse your movie and series library.");
  const main='<article class="tvLiveFeature" aria-label="Featured live television">'
   +(artwork?'<img class="tvLiveArtwork" src="'+esc(artwork)+'" alt="" loading="lazy">':"")
   +'<div class="tvFeatureTint"></div>'
   +(heroChannel?'<div class="tvFeatureLogo">'+channelArt(heroChannel)+'</div>':"")
   +'<div class="tvLiveDetails"><span class="tvLiveStatus">'+(heroChannel?'● LIVE CHANNEL':'YOUR TV')+'</span>'
   +'<h2>'+esc(title)+'</h2><p class="tvFeaturedMeta">'+formatProgramMeta(show,heroChannel,now)+'</p>'
   +'<p class="tvFeaturedDesc">'+esc(description)+'</p><div class="tvFeatureActions">'
   +(heroChannel?'<button type="button" class="tvWatchButton" data-tv-channel="'+esc(heroChannel.id)+'">▶ Watch Now</button>'
    :'<button type="button" class="tvWatchButton" data-go="Settings">Connect Live TV</button>')
   +'<button type="button" class="tvOutlineButton" data-go="Guide">TV Guide</button>'
   +(show?'<button type="button" class="tvOutlineButton" data-tv-program="'+esc(show.id)+'">Show Details</button>':"")
   +'</div>'
   +(show?'<div class="tvFeatureProgress"><span style="width:'+progress(show,now).toFixed(1)+'%"></span></div>'
     +'<small class="tvTimeRemaining">'+mins(Number(show.end)-now)+' min left</small>':"")
   +'</div></article>';
  const adjacent=next.length?next.map(({channel:c,program:p})=>
    '<button type="button" class="tvUpNextItem" data-tv-program="'+esc(p.id)+'">'
    +'<span class="tvUpNextLogo">'+channelArt(c)+'</span><span><small>'+esc(time(p.start))+' · '+esc(c.name)+'</small>'
    +'<b>'+esc(p.title)+'</b><small>View programme details</small></span></button>').join(""):
    chosen.slice(1,4).map(c=>'<button type="button" class="tvUpNextItem" data-tv-channel="'+esc(c.id)+'">'
    +'<span class="tvUpNextLogo">'+channelArt(c)+'</span><span><small>LIVE CHANNEL</small><b>'+esc(c.name)+'</b>'
    +'<small>Schedule unavailable · Watch live</small></span></button>').join("");
  const feature='<section class="tvSpotlightArea" aria-label="Live TV and next programmes">'
    +main+'<aside class="tvUpNext"><div class="tvSideHeading"><h2>'+(next.length?'Coming up on your TV':'More channels')+'</h2>'
    +'<button type="button" data-go="Guide" aria-label="Open guide">›</button></div>'
    +(adjacent||'<p class="tvNoGuideMessage">Your live and upcoming programmes will appear when an IPTV guide is connected.</p>')
    +'</aside></section>';
  const continueRail=watching.length?shelf("Continue Watching",watching,"Resume your movies and episodes","Continue Watching"):
    '<section class="tvEmptyContinue"><div><h2>Continue Watching</h2>'
    +'<p>Movies and episodes you start watching will be saved here.</p></div>'
    +'<button type="button" data-go="My Library">Open My Library ›</button></section>';
  const onNow=programmeTiles(chosen,currentById,now);
  const liveRail=onNow?'<section class="tvBroadcastRail"><div class="tvBroadcastHeading"><h2>On Now</h2>'
    +'<button type="button" data-go="Guide">See all channels ›</button></div>'
    +'<div class="tvProgrammesRail">'+onNow+'</div></section>':
    chosen.length?'<section class="tvBroadcastRail"><div class="tvBroadcastHeading"><h2>Watch Live</h2>'
      +'<button type="button" data-go="Guide">Full guide ›</button></div>'
      +'<div class="tvProgrammesRail">'+chosen.slice(0,8).map(c=>channelButton(c,"live")).join("")+'</div>'
      +'<p class="tvScheduleNote">Programme listings are unavailable for these channels. Channels can still be selected.</p></section>':"";
  const showRows=(movies.length?shelf("Explore Movies",movies,"Movies available in your loaded catalog","Movies"):"")
    +(series.length?shelf("Explore TV Shows",series,"Series available in your loaded catalog","TV Shows"):"");
  const radar=tvPremiereSection(model);
  const end='<footer class="tvHomeFooter"><button type="button" data-go="Recordings">● My DVR</button>'
    +'<button type="button" data-go="My Library">▰ My Library</button>'
    +'<button type="button" data-go="Settings">⚙ Settings</button></footer>';
  return '<div class="tvExperienceHome tvStreamHome" data-tv-experience="true">'+heading+strip+feature
    +continueRail+liveRail+radar
    +(watchlist.length?shelf("Your Watchlist",watchlist,"Saved for later","Watchlist"):"")
    +(favoriteTitles.length?shelf("Your Favorites",favoriteTitles,"Titles you love","Favorites"):"")
    +(Array.isArray(model?.recommendations)&&model.recommendations.length?shelf("For You",model.recommendations,"Suggested from your watched titles, favorites and watchlist","Catalogs"):"")
    +(items.some(x=>typeof countryVerified==="function"&&countryVerified(x))?shelf("Made in "+(typeof LumaReleases!=="undefined"?LumaReleases.regionName?.()||"your country":"your country"),items.filter(x=>typeof countryVerified==="function"&&countryVerified(x)).slice(0,20),"Verified local-origin titles","Catalogs"):"")
    +showRows+(typeof LumaHome!=="undefined"?LumaHome.discoveryShelves(items,shelf,new Set([...movies,...series].map(x=>x.id))):"")+end
    +'<span class="tvChannelCount" aria-label="Loaded IPTV channels">'+(total?esc(total.toLocaleString())+' IPTV channels loaded':'No IPTV channels connected yet')+'</span></div>';
 }
 function bind(){
  for(const button of document.querySelectorAll("[data-tv-premiere-day]"))button.onclick=()=>{
   const day=String(button.dataset.tvPremiereDay||"");
   if(typeof LumaCalendar!=="undefined"&&typeof LumaCalendar.navigateToDay==="function")
    LumaCalendar.navigateToDay(day);
  };
  for(const button of document.querySelectorAll("[data-tv-channel]"))button.onclick=()=>{
   const id=button.dataset.tvChannel;
   if(typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.openChannel==="function"){
    remember(id);LumaIPTV.openChannel(id);
   }
  };
  for(const button of document.querySelectorAll("[data-tv-program]"))button.onclick=()=>{
   const id=button.dataset.tvProgram;
   if(typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.openProgramme==="function")
    LumaIPTV.openProgramme(id);
  };
 }
 return {nav,markup,bind,tvPremiereDay,tvPremiereDaysAway,tvPremiereSection};
})();
