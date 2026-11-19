"use strict";
/* Connected IPTV VOD discovery. Movie/show metadata only; playback remains in LumaVOD. */
const LumaVODLibrary=(()=>{
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const norm=s=>String(s||"").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}]+/gu," ").trim();
 const pageSize=30;
 let query="",kind="all",page=0,local=[],remote=[],total=0,offset=0,
   loading=false,error="",initial=false,sourceLoaded=false,session=0,episodesToken=0,remoteLoaded=false;
 const config=()=>{try{return JSON.parse(localStorage.getItem("luma.iptv.v1")||"{}")}catch{return{}}};
 function recorderConfig(){
  const cfg=config(),host=String(cfg.host||"").trim().replace(/\/+$/,"");
  if(!/^https:\/\//i.test(host)||!cfg.token)return null;
  try{const u=new URL(host);if(!u.hostname||u.username||u.password)return null}catch{return null}
  return {host,token:cfg.token};
 }
 async function authenticated(path){
  const cfg=recorderConfig();if(!cfg)throw Error("Connect your DVR companion to browse its Xtream library.");
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),18000);
  try{
   const r=await fetch(cfg.host+path,{headers:{Authorization:"Bearer "+cfg.token},cache:"no-store",signal:ctrl.signal});
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(data.error||"IPTV catalog server responded "+r.status);
   return data;
  }finally{clearTimeout(timer)}
 }
 function addLocal(){
  local=typeof LumaVOD!=="undefined"&&typeof LumaVOD.catalog==="function"?LumaVOD.catalog():[];
 }
 function merged(){
  const groups=new Map();
  const matches=row=>(kind==="all"||row.type.toLowerCase()===kind)&&(!query||norm(row.title).includes(norm(query)));
  for(const entry of [...local,...remote].filter(matches)){
   const k=[entry.type,norm(entry.title),entry.year||""].join("|");
   if(!groups.has(k))groups.set(k,{...entry,providers:[...(entry.providers||[])],sources:[...(entry.sources||[])]});
   else{
    const stored=groups.get(k);
    for(const provider of entry.providers||[])if(!stored.providers.includes(provider))stored.providers.push(provider);
    for(const source of entry.sources||[])if(!stored.sources.some(v=>v.provider_id===source.provider_id&&v.series_id===source.series_id&&v.provider===source.provider))stored.sources.push(source);
    if(!stored.poster&&entry.poster)stored.poster=entry.poster;
    stored.episodeCount=Math.max(stored.episodeCount||0,entry.episodeCount||0);
   }
  }
  return [...groups.values()].sort((a,b)=>a.title.localeCompare(b.title)||a.year.localeCompare(b.year));
 }
 function knownArtwork(){
  const map=new Map();
  const records=typeof state!=="undefined"?state.items||[]:[];
  for(const x of records){
   if(!x?.title||!x?.poster)continue;
   const k=(x.type==="Movie"?"Movie":"Series")+"|"+norm(x.title);
   if(!map.has(k))map.set(k,[]);
   map.get(k).push(x);
  }
  return map;
 }
 function artworkFor(item,map){
  const poster=String(item.poster||"");
  if(/^https:\/\//i.test(poster))return poster;
  const key=(item.type==="Movie"?"Movie":"Series")+"|"+norm(item.title),candidates=map.get(key)||[];
  // Never borrow artwork from a different remake or a same-title series.
  const match=item.year?candidates.find(x=>String(x.year||"")===String(item.year)):
   candidates.length===1?candidates[0]:null;
  return /^https:\/\//i.test(String(match?.poster||""))?match.poster:"";
 }
 function status(){
  const count=merged().length,remaining=Math.max(0,total-offset);
  return count+" unique titles loaded"+(remaining?" · "+remaining+" more from your recorder":"");
 }
 function card(item,map,i){
  const image=artworkFor(item,map),sources=(item.providers||[]).slice(0,3).join(" · ");
  return '<button type="button" class="vodLibraryCard" data-vod-title="'+i+'">'
   +'<div class="vodLibraryArtwork">'+(image?'<img src="'+esc(image)+'" alt="" loading="lazy" onerror="this.remove()">':'<div class="vodLibraryArtworkFallback">'+(item.type==="Movie"?"🎬":"📺")+'</div>')
   +'<span class="vodLibraryType">'+(item.type==="Movie"?"MOVIE":"SERIES")+'</span></div>'
   +'<div class="vodLibraryCardText"><strong>'+esc(item.title)+'</strong>'
   +'<small>'+esc([item.year||"",sources||"Your IPTV"].filter(Boolean).join(" · "))+'</small>'
   +(item.episodeCount?'<span>'+item.episodeCount+' guide episodes</span>':"")+'</div></button>';
 }
 function pageCount(){
  const count=merged().length+Math.max(0,total-offset);
  return Math.max(1,Math.ceil(count/pageSize));
 }
 function render(){
  if(typeof state==="undefined"||state.tab!=="IPTV Library")return;
  const container=document.querySelector("#content");if(!container)return;
  if(!initial){initial=true;void bootstrap();}
  const items=merged(),pages=pageCount();
  page=Math.max(0,Math.min(page,pages-1));
  const selected=items.slice(page*pageSize,(page+1)*pageSize),artwork=knownArtwork();
  container.innerHTML='<section class="vodLibraryHero"><div class="eyebrow">LUMA · YOUR CONNECTED IPTV</div>'
   +'<h2>Movies & series from your IPTV services</h2>'
   +'<p>Browse provider-supplied video-on-demand libraries alongside Luma’s wider movie and TV discovery. Select a movie to choose a playback source, or a series to select an individual episode.</p>'
   +'<div class="vodLibraryStats"><b>'+items.length+' titles loaded</b><span>'+status()+'</span></div>'
   +'<div class="vodLibraryActions"><button class="secondary" id="vodBrowseCatalogs">Browse all movies & shows</button>'
   +'<button class="secondary" id="vodManageIPTV">Manage IPTV connections</button>'
   +'<button class="secondary" id="vodRefreshLibrary" '+(loading?'disabled':'')+'>↻ Refresh library</button></div></section>'
   +'<div class="vodLibraryControls"><label>Search your connected services<input id="vodLibrarySearch" type="search" value="'+esc(query)+'" placeholder="Find a movie, show, or title"></label>'
   +'<label>Browse<select id="vodLibraryType"><option value="all">All movies & series</option><option value="movie"'+(kind==="movie"?' selected':'')+'>Movies only</option><option value="series"'+(kind==="series"?' selected':'')+'>Series only</option></select></label></div>'
   +(error?'<div class="notice">'+esc(error)+'</div>':"")
   +(loading?'<div class="vodLibraryLoading">Loading titles from connected IPTV services…</div>':"")
   +(selected.length?'<div class="vodLibraryGrid">'+selected.map((item,i)=>card(item,artwork,i)).join("")+'</div>':
    !loading?'<div class="vodLibraryEmpty"><h3>No titles in this view</h3><p>'+(recorderConfig()||config().browserSources?.length||config().m3u?"Try a different search, or refresh your connected IPTV library.":"Connect an IPTV service to browse provider-supplied movies and TV shows.")+'</p></div>':"")
   +'<div class="vodLibraryPager"><button class="secondary" id="vodLibraryPrev" '+(page===0?'disabled':'')+'>← Previous</button><span>Page '+(page+1)+' of '+pages+'</span><button class="secondary" id="vodLibraryNext" '+(page+1>=pages?'disabled':'')+'>Next →</button></div>'
   +(offset<total?'<div class="vodLibraryMore"><button class="primary" id="vodLibraryMore" '+(loading?'disabled':'')+'>Load more titles from IPTV recorder</button></div>':"")
   +'<p class="micro">Only titles returned by your own connected IPTV services appear here. Stream access depends on your service, player, and network. Source credentials are not included in the catalog.</p>';
  const match=selected;
  const searchField=container.querySelector("#vodLibrarySearch");
  searchField.oninput=e=>{
   query=String(e.target.value||"");page=0;
   const value=query;clearTimeout(searchField._timer);
   searchField._timer=setTimeout(()=>{if(value===query){remote=[];total=0;offset=0;remoteLoaded=false;void loadRemote(true)}},400);
   // Filtering existing titles is immediate; keep field focus and selection.
   const pos=e.target.selectionStart;
   render();const focus=document.querySelector("#vodLibrarySearch");
   if(focus){focus.focus({preventScroll:true});try{focus.setSelectionRange(pos,pos)}catch{}}
  };
  container.querySelector("#vodLibraryType").onchange=e=>{kind=e.target.value;page=0;remote=[];total=0;offset=0;remoteLoaded=false;void loadRemote(true);render()};
  container.querySelector("#vodLibraryPrev").onclick=()=>{page=Math.max(0,page-1);render()};
  container.querySelector("#vodLibraryNext").onclick=async()=>{
   const target=page+1;
   if((target+1)*pageSize>items.length&&offset<total)await loadRemote(false);
   page=target;render();
  };
  for(const button of container.querySelectorAll("[data-vod-title]"))button.onclick=()=>{
   const title=match[Number(button.dataset.vodTitle)];if(title)void openTitle(title);
  };
  const more=container.querySelector("#vodLibraryMore");
  if(more)more.onclick=()=>void loadRemote(false);
  container.querySelector("#vodBrowseCatalogs").onclick=()=>{state.tab="Catalogs";window.LumaRender?.()};
  container.querySelector("#vodManageIPTV").onclick=()=>{
   state.tab="Live TV";if(typeof nav==="function")nav();
   LumaIPTV.render("connections");
  };
  container.querySelector("#vodRefreshLibrary").onclick=()=>void bootstrap(true);
 }
 async function bootstrap(force=false){
  if(sourceLoaded&&!force)return;
  const id=++session;sourceLoaded=true;loading=true;error="";render();
  try{
   if(typeof LumaIPTV!=="undefined"){
    if(force)await LumaIPTV.loadGuide(true);
    else if(!LumaIPTV.channels().length)await LumaIPTV.loadForCalendar();
   }
   if(id!==session)return;
   addLocal();remote=[];offset=0;total=0;remoteLoaded=false;
   await loadRemote(true);
  }catch(e){if(id===session)error="Unable to load one IPTV source: "+String(e.message||e).slice(0,130)}
  finally{if(id===session){loading=false;render()}}
 }
 function refreshLocal(){addLocal();render()}
 async function loadRemote(reset=false){
  const cfg=recorderConfig();if(!cfg){if(reset){remote=[];total=0;offset=0}loading=false;render();return}
  const req=++session;
  if(reset){remote=[];total=0;offset=0}
  loading=true;error="";render();
  try{
   const q=new URLSearchParams({offset:String(offset),limit:"100",type:kind,q:query.slice(0,100)});
   const response=await authenticated("/vod/catalog?"+q);
   if(req!==session)return;
   if(!Array.isArray(response.items))throw Error("Invalid IPTV catalog response");
   remote=[...remote,...response.items];total=Math.max(0,Number(response.total)||0);
   offset=Math.max(0,Number(response.offset)||0)+response.items.length;
   remoteLoaded=true;
  }catch(e){if(req===session)error="DVR catalog is unavailable: "+String(e.message||e).slice(0,130)}
  finally{if(req===session){loading=false;render()}}
 }
 function metadata(item){
  const list=typeof state!=="undefined"?state.items||[]:[];
  const match=list.find(x=>norm(x.title)===norm(item.title)&&
   (item.type===x.type||item.type==="Series"&&x.type==="Anime")&&(!item.year||!x.year||x.year===item.year));
  return match||{id:item.id,title:item.title,type:item.type,year:item.year,poster:item.poster||"",source:"iptv"};
 }
 function addonLookup(x,ep){
  if(typeof LumaAddons!=="undefined"&&typeof LumaAddons.lookupTitle==="function")
   LumaAddons.lookupTitle(x,x.imdbId||"",ep);
  else toast("Install a Luma manifest add-on to search additional sources.");
 }
 async function openTitle(item){
  const x=metadata(item);
  if(item.type==="Movie"){LumaVOD.choose(x,null,()=>addonLookup(x,null));return}
  const token=++episodesToken;
  modal('<div class="vodLibraryEpisodePicker"><div class="eyebrow">IPTV SERIES LIBRARY</div><h2>'+esc(item.title)+'</h2>'
   +'<p>Loading episode selections from your connected service…</p></div>');
  let episodes=typeof LumaVOD!=="undefined"?LumaVOD.episodes(item.title,item.year):[],remoteError="";
  const sources=(item.sources||[]).filter(s=>s.provider_id&&s.series_id).slice(0,4);
  if(sources.length){
   const results=await Promise.allSettled(sources.map(async source=>{
    const url="/vod/episodes?"+new URLSearchParams({provider_id:source.provider_id,series_id:source.series_id});
    return (await authenticated(url)).episodes||[];
   }));
   for(const result of results){
    if(result.status==="fulfilled"&&Array.isArray(result.value))episodes.push(...result.value);
    else if(result.status==="rejected")remoteError="Some IPTV providers could not supply episode details.";
   }
  }
  if(token!==episodesToken)return;
  const seen=new Set();
  episodes=episodes.filter(e=>{
   const key=Number(e.season)+":"+Number(e.number);
   if(!Number.isInteger(Number(e.season))||!Number.isInteger(Number(e.number))||seen.has(key))return false;
   seen.add(key);return true;
  }).sort((a,b)=>a.season-b.season||a.number-b.number);
  const container=document.querySelector(".vodLibraryEpisodePicker");
  if(!container)return;
  const seasons=[...new Set(episodes.map(e=>e.season))];
  container.innerHTML='<div class="eyebrow">EPISODE SELECTOR</div><h2>'+esc(item.title)+'</h2>'
   +(episodes.length?'<label>Season<select id="vodEpisodeSeason">'+seasons.map(s=>'<option value="'+s+'">Season '+s+'</option>').join("")+'</select></label>'
    +'<div id="vodEpisodeOptions"></div>':
    '<p>No numbered episodes were returned. A source may only provide titles without episode metadata, or may not be connected to the DVR companion.</p>')
   +(remoteError?'<p class="micro">'+esc(remoteError)+'</p>':"")
   +'<button class="secondary" id="vodLibraryBack">← Back to IPTV library</button>';
  const select=container.querySelector("#vodEpisodeSeason");
  const draw=()=>{
   const target=container.querySelector("#vodEpisodeOptions");if(!target)return;
   const season=Number(select.value);
   target.innerHTML='<div class="vodEpisodeGrid">'+episodes.filter(e=>e.season===season).map(e=>
    '<button type="button" class="secondary" data-play-season="'+e.season+'" data-play-episode="'+e.number+'"><strong>S'+String(e.season).padStart(2,"0")+' E'+String(e.number).padStart(2,"0")+'</strong><span>'+esc(e.title||"Episode")+'</span></button>'
   ).join("")+'</div>';
   for(const button of target.querySelectorAll("[data-play-episode]"))button.onclick=()=>{
    const ep={season_number:Number(button.dataset.playSeason),episode_number:Number(button.dataset.playEpisode)};
    LumaVOD.choose(x,ep,()=>addonLookup(x,ep));
   };
  };
  if(select){select.onchange=draw;draw()}
  container.querySelector("#vodLibraryBack").onclick=closeModal;
 }
 return {render,bootstrap,refreshLocal,merged,__test:{norm}};
})();
