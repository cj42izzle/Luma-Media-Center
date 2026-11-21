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
    +'<div class="tvNavTools"><button type="button" class="tvNavTool" id="lumaTvSearch" aria-label="Search movies, shows and channels">⌕ <span>Search</span></button>'
    +'<button type="button" class="tvNavTool" id="lumaTvMore" aria-label="More sections and settings">☰ <span>More</span></button></div>';
   root.dataset.tvNavBuilt="true";
  }
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
 function markup(model,shelf){
  const items=Array.isArray(model?.items)?model.items:[],watching=Array.isArray(model?.watching)?model.watching:[],
   watchlist=Array.isArray(model?.watchlist)?model.watchlist:[],favorites=Array.isArray(model?.favorites)?model.favorites:[];
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
  const end='<footer class="tvHomeFooter"><button type="button" data-go="Recordings">● My DVR</button>'
    +'<button type="button" data-go="My Library">▰ My Library</button>'
    +'<button type="button" data-go="Settings">⚙ Settings</button></footer>';
  return '<div class="tvExperienceHome tvStreamHome" data-tv-experience="true">'+heading+strip+feature
    +continueRail+liveRail
    +(watchlist.length?shelf("Your Watchlist",watchlist,"Saved for later","Watchlist"):"")
    +(favorites.length?shelf("Your Favorites",favorites,"Titles you love","Favorites"):"")
    +showRows+end
    +'<span class="tvChannelCount" aria-label="Loaded IPTV channels">'+(total?esc(total.toLocaleString())+' IPTV channels loaded':'No IPTV channels connected yet')+'</span></div>';
 }
 function bind(){
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
 return {nav,markup,bind};
})();
