"use strict";
/* Luma Live: a distinct IPTV home, guide, recordings, and connection studio. */
const LumaIPTVPortal=(()=>{
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const now=()=>Date.now();
 const clock=ms=>new Date(ms).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
 const label=s=>String(s||"").replace(/\b(?:FHD|UHD|4K|1080P|720P)\b/ig,"").replace(/\s+/g," ").trim();
 const zone=s=>{
  const text=String(s||"").trim();
  const m=text.match(/(?:\b(EAST|WEST|EASTERN|PACIFIC|CENTRAL|MOUNTAIN|EST|EDT|PST|PDT|CST|CDT|MST|MDT)\b|(?:^|[\s([+])([+-]\d{1,2})(?:h|hr)?(?:[)\]\s]|$))/i);
  if(m)return (m[1]||m[2]).toUpperCase();
  const short=text.match(/(?:\(([EW])\)|\[([EW])\]|[\s_-]([EW]))(?:\s+(?:HD|FHD|UHD|4K))?$/i);
  const mark=(short?.[1]||short?.[2]||short?.[3]||"").toUpperCase();
  return mark==="E"?"EAST":mark==="W"?"WEST":"";
 };
 const episodeTag=p=>{
  if(!p)return "";
  const airing=Number(p.start)<=Date.now()&&Number(p.end)>Date.now();
  return (airing?'<span class="iptvTag iptvTagNow">● AIRING NOW</span>':"")
   +(p.is_live_event?'<span class="iptvTag iptvTagLive">● LIVE EVENT</span>':"")
   +(p.is_new&&!p.rerun?'<span class="iptvTag iptvTagNew">✦ NEW</span>':"")
   +(p.rerun?'<span class="iptvTag iptvTagRepeat">REPEAT</span>':"");
 };
 function providerCards(channels){
  const map=new Map();
  for(const c of channels){
   const name=c.provider||"Local IPTV",id=c.provider_id||name;
   if(!map.has(id))map.set(id,{id,name,count:0});
   map.get(id).count++;
  }
  return [...map.values()].map(x=>'<div class="iptvProviderChip"><span>📡</span><b>'+esc(x.name)+'</b><small>'+x.count+' channels</small></div>').join("");
 }
 function homeHTML(ctx){
  const channels=ctx.channels||[],programs=ctx.programs||[],time=now();
  const map=new Map(channels.map(c=>[c.id,c]));
  function collapseDuplicates(items){
   const groups=new Map();
   for(const entry of items){
    const station=map.get(entry.channel_id)||{};
    const strong=typeof LumaIPTV!=="undefined"?LumaIPTV.episodeSignature(entry):"";
    const network=label(station.name||"").toLowerCase().replace(/\b(east|west|eastern|pacific|central|mountain|est|edt|pst|pdt)\b/g,"").replace(/\s+/g," ").trim();
    // Without episode evidence, only fold duplicates of the same TV network.
    // A shared series title is not proof two time zones carry the same episode.
    const key=[String(entry.title||"").trim().toLowerCase(),strong||("channel:"+network),
       Math.floor(Number(entry.start||0)/300000)].join("|");
    const bucket=groups.get(key)||[];
    bucket.push(entry);groups.set(key,bucket);
   }
   return [...groups.values()].map(group=>{
     group.sort((a,b)=>Number(map.get(b.channel_id)?.quality||0)-Number(map.get(a.channel_id)?.quality||0));
     return {...group[0],alternate_count:Math.max(0,group.length-1),
      providers:[...new Set(group.map(p=>map.get(p.channel_id)?.provider||"IPTV"))]};
   });
  }
  const live=collapseDuplicates(programs.filter(p=>p.start<=time&&p.end>time&&map.has(p.channel_id)));
  live.sort((a,b)=>Number(b.is_live_event)-Number(a.is_live_event)
      ||Number(b.is_new)-Number(a.is_new)||a.title.localeCompare(b.title));
  const scheduled=collapseDuplicates(programs.filter(p=>p.start>time&&p.start<time+4*3600000&&map.has(p.channel_id)));
  scheduled.sort((a,b)=>a.start-b.start);
  const favorites=channels.filter(c=>ctx.favorites?.includes(c.id)).slice(0,16);
  const hot=live.slice(0,12),upcoming=scheduled.slice(0,9);
  const feature=hot[0]||upcoming[0],featuredChannel=feature&&map.get(feature.channel_id);
  const hero='<div class="iptvPortalHero">'
   +'<div class="iptvHeroSpotlight"><span class="iptvPortalEyebrow">LUMA LIVE · YOUR TELEVISION</span>'
   +'<h2>'+(feature?esc(feature.title):"The best of live TV, all together.")+'</h2>'
   +'<div class="iptvHeroLabels">'+(feature?episodeTag(feature):'<span class="iptvTag">YOUR IPTV SERVICES</span>')
   +(featuredChannel?'<span>📡 '+esc(featuredChannel.provider||"IPTV")+'</span>':'')+'</div>'
   +'<p>'+(feature?esc(feature.description||("On "+featuredChannel?.name+" · "+clock(feature.start)+"–"+clock(feature.end))):
    "Your channels, live programming, favorites and recordings. Every service remains identifiable, even when channels have the same name.")+'</p>'
   +'<div class="iptvPortalActions">'+(feature?'<button class="primary" data-program="'+esc(feature.id)+'">▶ View programme</button>':'')
   +'<button class="secondary" data-iptv-mode="guide">▦ Open full guide</button>'
   +'<button class="secondary" data-iptv-mode="connections">⚙ Manage services</button></div></div>'
   +'<div class="iptvHeroArtwork"><div class="iptvHeroSignal">◉</div>'
   +(featuredChannel?.logo?'<img src="'+esc(featuredChannel.logo)+'" alt="" loading="lazy" onerror="this.remove()">':'')
   +'<span>'+esc(featuredChannel?.name||"LUMA")+'</span></div></div>';
  const shortcuts='<div class="iptvPortalShortcuts">'
   +'<button data-iptv-mode="guide"><span>▦</span><strong>TV Guide</strong><small>See every channel</small></button>'
   +'<button data-iptv-mode="recordings"><span>●</span><strong>My Recordings</strong><small>Watch & manage DVR</small></button>'
   +'<button data-iptv-mode="connections"><span>⚙</span><strong>Connections</strong><small>M3U, Xtream & EPG</small></button>'
   +'<button data-iptv-mode="guide" data-iptv-fav-only="1"><span>★</span><strong>Favorites</strong><small>Your best channels</small></button></div>';
  const entry=(p,i,compact=false)=>{
   const c=map.get(p.channel_id);if(!c)return "";
   const isNow=p.start<=time&&p.end>time;
   const pct=Math.max(0,Math.min(100,100*(time-p.start)/(p.end-p.start)));
   return '<button type="button" class="iptvPortalShow" data-program="'+esc(p.id)+'"><div class="iptvPortalShowTop">'
     +'<span class="iptvPortalShowLogo">'+(c.logo?'<img src="'+esc(c.logo)+'" alt="" loading="lazy" onerror="this.remove()">':'◈')+'</span>'
     +'<div><small>'+esc(c.name)+'</small><strong>'+esc(p.title)+'</strong></div></div>'
     +'<div class="iptvPortalShowTags">'+episodeTag(p)+(zone(c.name)?'<span class="iptvTag iptvTagZone">'+esc(zone(c.name))+'</span>':'')+'</div>'
     +'<div class="iptvPortalShowFoot"><span>'+esc(c.provider||"IPTV service")+(p.alternate_count?' · +'+p.alternate_count+' more source'+(p.alternate_count===1?'':'s'):'')+'</span><span>'+clock(p.start)+'–'+clock(p.end)+'</span></div>'
     +(isNow?'<div class="iptvPortalProgress"><span style="width:'+pct.toFixed(0)+'%"></span></div>':"")+'</button>';
  };
  const nowRail='<section class="iptvPortalSection"><div class="iptvSectionTop"><div><span class="iptvPortalEyebrow">ON YOUR CHANNELS</span><h3>On right now</h3></div><button data-iptv-mode="guide" class="secondary small">Full guide ›</button></div>'
   +(hot.length?'<div class="iptvPortalRail">'+hot.map(entry).join("")+'</div>':
   '<div class="iptvPortalEmpty">Add your IPTV service and EPG to see what is airing now. <button data-iptv-mode="connections">Add service</button></div>')+'</section>';
  const upcomingRail='<section class="iptvPortalSection"><div class="iptvSectionTop"><div><span class="iptvPortalEyebrow">NEXT UP</span><h3>Coming up soon</h3></div><button data-iptv-mode="guide" class="secondary small">Explore ›</button></div>'
   +(upcoming.length?'<div class="iptvPortalRail">'+upcoming.map(entry).join("")+'</div>':
   '<p class="iptvPortalMuted">Your upcoming premieres will appear here when the guide provides listings.</p>')+'</section>';
  const favoriteCards=favorites.map(c=>'<button class="iptvPortalChannel" data-channel="'+esc(c.id)+'">'
   +(c.logo?'<img src="'+esc(c.logo)+'" alt="" onerror="this.remove()">' :'<span>◈</span>')
   +'<strong>'+esc(c.name)+'</strong><small>'+esc(c.provider||"Local IPTV")+'</small></button>').join("");
  const favRail=favorites.length?'<section class="iptvPortalSection"><div class="iptvSectionTop"><div><span class="iptvPortalEyebrow">YOUR PERSONAL CHANNELS</span><h3>Favorites</h3></div></div><div class="iptvPortalChannels">'+favoriteCards+'</div></section>':"";
  return '<section class="iptvPortalHome">'+hero+shortcuts
   +'<section class="iptvProviderSummary"><div><span class="iptvPortalEyebrow">ONE VIEW, EVERY IPTV SERVICE</span><h3>Connected services</h3><p>Duplicate channels remain selectable and show their source and timezone variant.</p></div><div class="iptvProviderChips">'
   +(channels.length?providerCards(channels):'<span class="iptvPortalMuted">No channels connected yet</span>')+'</div></section>'
   +nowRail+upcomingRail+favRail+'</section>';
 }
 function setupHTML(){
  return '<section class="iptvConnectStudio"><div class="iptvSectionTop"><div><span class="iptvPortalEyebrow">PERSONALIZED IPTV</span><h2>Connect your television</h2><p>Bring up to 10 services together. Each channel keeps its original provider name and exact guide schedule.</p></div></div>'
   +'<div class="iptvConnectCards">'
   +'<form id="iptvAddProviderM3U" class="iptvConnectCard"><div class="iptvConnectIcon">◫</div><h3>Playlist URL · M3U</h3><p>Add a direct playlist from a service you are authorized to use.</p>'
   +'<label>Service name<input name="name" required maxlength="80" placeholder="Living Room IPTV"></label>'
   +'<label>Playlist URL<input name="url" required type="url" placeholder="https://provider.example/playlist.m3u"></label>'
   +'<label>EPG URL (optional)<input name="epg" type="url" placeholder="https://guide.example/epg.xml"></label>'
   +'<button class="primary" type="submit">+ Add M3U service</button></form>'
   +'<form id="iptvAddProviderXtream" class="iptvConnectCard"><div class="iptvConnectIcon">◎</div><h3>Xtream Codes · Account</h3><p>Use your authorized IPTV account. Browser connections require HTTPS, provider CORS and a supported streaming format.</p>'
   +'<label>Service name<input name="name" required maxlength="80" placeholder="My Xtream TV"></label>'
   +'<label>Xtream server address<input name="server" required type="url" placeholder="https://provider.example:443"></label>'
   +'<div id="iptvXtreamHelp" class="iptvXtreamInfo" role="status" hidden><strong>HTTP IPTV address detected</strong><p>Because Luma uses HTTPS, your browser cannot connect to an HTTP IPTV panel directly. When you choose Connect, Luma will try HTTPS on this same host using port 443. If your service does not offer HTTPS or blocks browser access, an always-on recorder is required to use it inside Luma. This recorder must run on your own powered PC, NAS or supported device; the settings button alone cannot install it.</p><p>First ask your IPTV provider for a browser-accessible HTTPS Xtream URL. If it has none, install the DVR companion and then enter its HTTPS address in Luma.</p><a href="https://github.com/cj42izzle/Luma-Media-Center/blob/main/recorder/README.md" target="_blank" rel="noopener" class="iptvCompanionDocs">Read recorder setup instructions</a><button type="button" class="secondary small" id="iptvFindCompanion">I have a recorder · Open settings</button></div>'
   +'<div class="iptvConnectPair"><label>Username<input name="username" required autocomplete="off" maxlength="180"></label>'
   +'<label>Password<input name="password" required type="password" autocomplete="off" maxlength="180"></label></div>'
   +'<label>Output format<select name="output"><option value="m3u8">HLS · m3u8</option><option value="ts">MPEG-TS</option></select></label>'
   +'<label>Alternate EPG URL (optional)<input name="epg" type="url" placeholder="Provider default is automatic"></label>'
   +'<p class="micro">For iPhone/Safari, HLS (m3u8) is generally more compatible than direct MPEG-TS playback.</p>'
   +'<p class="iptvXtreamError" id="iptvXtreamError" role="alert" hidden></p>'
   +'<button class="primary" type="submit">+ Connect Xtream</button></form></div>'
   +'<p class="iptvConnectPrivacy">🔒 Credentials remain on this device or your own connected DVR. Browser-only Xtream URLs may contain login data; use a trusted device. Luma does not discover or bypass paid services.</p></section>';
 }
 function bind(mode){
  for(const button of document.querySelectorAll("[data-iptv-mode]"))button.onclick=()=>{
   const next=button.dataset.iptvMode;
   if(next==="home"||next==="guide"||next==="recordings"||next==="connections"){
    if(typeof state!=="undefined"){
     state.tab=next==="guide"?"Guide":next==="recordings"?"Recordings":"Live TV";
     if(typeof nav==="function")nav();
    }
    if(button.dataset.iptvFavOnly==="1"&&typeof LumaIPTV.setFilter==="function")LumaIPTV.setFilter("favorites",false);
    LumaIPTV.render(next);
    window.scrollTo({top:0,behavior:"smooth"});
   }
  };
  const m=document.querySelector("#iptvAddProviderM3U");
  if(m)m.onsubmit=async e=>{
   e.preventDefault();
   const fd=new FormData(m);
   try{await LumaIPTV.addProvider({type:"m3u",name:String(fd.get("name")||"").trim(),m3u_url:String(fd.get("url")||"").trim(),xmltv_url:String(fd.get("epg")||"").trim()});
    toast("M3U service added. Your channels are now combined.");LumaIPTV.render("connections")}
   catch(err){toast("Connection problem: "+String(err.message||err))}
  };
  const x=document.querySelector("#iptvAddProviderXtream");
  if(x){
   const server=x.querySelector('[name="server"]'),help=x.querySelector("#iptvXtreamHelp"),error=x.querySelector("#iptvXtreamError");
   const refreshHint=()=>{if(help)help.hidden=!/^http:/i.test(String(server?.value||"").trim())};
   if(server)server.addEventListener("input",refreshHint);
   refreshHint();
   const companion=x.querySelector("#iptvFindCompanion");
   if(companion)companion.onclick=()=>{
    const settings=document.querySelector(".iptvAdvancedSettings");
    if(settings){settings.open=true;settings.scrollIntoView({block:"center",behavior:"smooth"})}
    else toast("Open Live TV → Connections → DVR companion and local files.");
   };
   x.onsubmit=async e=>{
    e.preventDefault();
    if(error){error.hidden=true;error.textContent=""}
    const fd=new FormData(x);
    try{await LumaIPTV.addProvider({type:"xtream",name:String(fd.get("name")||"").trim(),server:String(fd.get("server")||"").trim(),
     username:String(fd.get("username")||"").trim(),password:String(fd.get("password")||""),
     output:String(fd.get("output")||"m3u8"),xmltv_url:String(fd.get("epg")||"").trim()});
     x.reset();toast("Xtream IPTV service connected.");LumaIPTV.render("connections")}
    catch(err){
     const msg=String(err?.message||err||"Connection unavailable");
     if(error){error.textContent=msg;error.hidden=false;error.scrollIntoView?.({block:"nearest",behavior:"smooth"})}
     else toast("Xtream connection could not be completed. Review the HTTPS/DVR instructions.");
     refreshHint();
    }
   };
  }
  for(const b of document.querySelectorAll("[data-iptv-local-remove]"))b.onclick=async()=>{
   try{await LumaIPTV.removeProvider(b.dataset.iptvLocalRemove);toast("IPTV service removed")}catch(e){toast(String(e.message||e))}
  };
 }
 return {homeHTML,setupHTML,bind,episodeTag,zone,label};
})();
