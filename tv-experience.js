"use strict";
/* Luma's dedicated ten-foot interface for Android TV boxes.
 * All actions route to existing Luma features and real connected data. */
const LumaTVExperience=(()=>{
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const navLinks=[["Home","⌂","Home"],["Live TV","◉","Live TV"],["Guide","▦","Guide"],
   ["Movies","▣","Movies"],["TV Shows","▤","Series"],["My Library","▰","Library"],
   ["Recordings","●","DVR"],["Settings","⚙","Settings"]];
 function nav(root,active){
  if(!root)return;
  if(root.dataset.tvNavBuilt!=="true"){
   root.innerHTML='<div class="tvBrand"><strong>Luma</strong><span>TV</span></div>'
    +'<div class="tvNavRail">'+navLinks.map(([key,icon,label])=>'<button type="button" class="tvNavTab" data-tab="'+esc(key)+'"><i aria-hidden="true">'+icon+'</i>'+esc(label)+'</button>').join("")+'</div>'
    +'<div class="tvNavTools"><button type="button" class="tvNavTool" id="lumaTvSearch" aria-label="Search all content">⌕ <span>Search</span></button>'
    +'<button type="button" class="tvNavTool" id="lumaTvMore" aria-label="All Luma sections">☰ <span>More</span></button></div>';
   root.dataset.tvNavBuilt="true";
  }
  for(const button of root.querySelectorAll("[data-tab]")){
   const selected=button.dataset.tab===active;
   button.classList.toggle("active",selected);
   button.setAttribute("aria-current",selected?"page":"false");
  }
 }
 function safeUrl(value){
  try{const u=new URL(String(value||""));return u.protocol==="https:"&&!u.username&&!u.password?u.href:""}
  catch{return""}
 }
 function quick(tab,label,icon,description){
  return '<button class="tvQuickCard" type="button" data-go="'+esc(tab)+'"><span class="tvQuickIcon" aria-hidden="true">'+icon+'</span>'
   +'<span class="tvQuickText"><b>'+esc(label)+'</b><small>'+esc(description)+'</small></span><span class="tvQuickArrow" aria-hidden="true">›</span></button>';
 }
 function markup(model,shelf){
  const items=Array.isArray(model?.items)?model.items:[],watching=Array.isArray(model?.watching)?model.watching:[];
  const live=typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.channels==="function"?LumaIPTV.channels():[];
  const favorites=[],regular=[],movies=[],series=[];
  for(const c of live){
   if(!c?.id||!c?.name||!c?.url)continue;
   if(regular.length<6)regular.push(c);
   if(favorites.length<6&&typeof LumaIPTV.isFavorite==="function"&&LumaIPTV.isFavorite(c.id))favorites.push(c);
   if(regular.length>=6&&favorites.length>=6)break;
  }
  let cover="";
  for(const item of items){
   if(movies.length<22&&item?.type==="Movie")movies.push(item);
   else if(series.length<22&&(item?.type==="Series"||item?.type==="Anime"))series.push(item);
   if(!cover)cover=safeUrl(item?.backdrop)||safeUrl(item?.poster);
   if(movies.length>=22&&series.length>=22&&cover)break;
  }
  const featured=[...favorites,...regular.filter(c=>!favorites.some(f=>f.id===c.id))].slice(0,6);
  const connected=live.length>0;
  const hero='<section class="tvHero" aria-label="Your TV home">'
   +(cover?'<img class="tvHeroImage" src="'+esc(cover)+'" alt="" loading="eager">':"")
   +'<div class="tvHeroShade"></div><div class="tvHeroCopy">'
   +'<span class="tvEyebrow">LUMA · DESIGNED FOR YOUR TV</span>'
   +'<h2>'+(connected?'Everything you love to watch.':'Your entertainment starts here.')+'</h2>'
   +'<p>'+(connected?'Live channels, your saved library and the programmes you follow — all in one place.':'Connect your television service or start exploring movies and TV series.')+'</p>'
   +'<div class="tvHeroActions"><button class="tvPrimary" type="button" data-go="Live TV">▶ Watch Live TV</button>'
   +'<button class="tvSecondary" type="button" data-go="Guide">▦ TV Guide</button>'
   +'<button class="tvSecondary" type="button" data-go="My Library">My Library</button></div>'
   +'<small class="tvHeroCount">'+(connected?esc(live.length.toLocaleString())+' IPTV channels loaded':'No IPTV channels connected yet')+'</small>'
   +'</div></section>';
  const tiles='<section class="tvBlock"><div class="tvBlockHeading"><h2>Jump right in</h2><p>One press takes you where you want to go</p></div><div class="tvQuickGrid">'
   +quick("Live TV","Watch TV","◉","Your live channels")
   +quick("Guide","TV Guide","▦","On now and next")
   +quick("Movies","Movies","▣","Explore films")
   +quick("TV Shows","Series","▤","Shows and episodes")
   +quick("My Library","My Library","▰","Your saved content")
   +quick("Recordings","DVR","●","Scheduled recordings")
   +quick("Calendar","Calendar","◷","New episodes")
   +quick("Settings","Settings","⚙","Accounts & setup")
   +'</div></section>';
  const stations=featured.length
   ?'<section class="tvBlock"><div class="tvBlockHeading"><h2>Turn on a channel</h2><p>Your actual connected TV stations</p>'
    +'<button data-go="Guide" class="tvSeeAll" type="button">Full guide ›</button></div>'
    +'<div class="tvChannelRail">'+featured.map(c=>'<button type="button" class="tvChannelCard" data-tv-channel="'+esc(c.id)+'" aria-label="Watch '+esc(c.name)+'">'
     +(safeUrl(c.logo)?'<img src="'+esc(safeUrl(c.logo))+'" alt="" loading="lazy">':'<span class="tvChannelGlyph" aria-hidden="true">▣</span>')
     +'<b>'+esc(c.name)+'</b><small>'+esc(c.group||c.provider||"Live TV")+'</small>'
     +'<span>▶ Watch live</span></button>').join("")+'</div></section>'
   :'<section class="tvBlock tvEmpty"><div><h2>Bring your channels into Luma</h2><p>Add your IPTV service to watch channels and view available schedules.</p></div>'
    +'<button class="tvSecondary" type="button" data-go="Settings">⚙ Settings</button></section>';
  const resume=watching.length?shelf("Continue watching",watching,"Pick up where you left off","Continue Watching")
    :'<section class="tvBlock tvEmpty"><div><h2>Continue watching</h2><p>Titles will appear here when you start watching.</p></div>'
     +'<button class="tvSecondary" type="button" data-go="My Library">Open library</button></section>';
  return '<div class="tvExperienceHome" data-tv-experience="true">'+hero+tiles+stations+resume
   +(movies.length?shelf("Explore movies",movies,"Browse your current movie catalog","Movies"):"")
   +(series.length?shelf("Discover series",series,"Explore TV shows and anime","TV Shows"):"")
   +'<footer class="tvExperienceFooter"><span>Luma · Made for your living room</span>'
   +'<button type="button" data-go="Settings">⚙ Sources & settings</button></footer></div>';
 }
 function bind(){
  for(const button of document.querySelectorAll("[data-tv-channel]"))button.onclick=()=>{
   if(typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.openChannel==="function")
    LumaIPTV.openChannel(button.dataset.tvChannel);
  };
 }
 return {nav,markup,bind};
})();
