
"use strict";
/* Browser-only Luma add-on client using compatible third-party manifests. Nothing is proxied; private credentials stay on this device. */
const LumaAddons=(()=>{
let list=read(),catalog=[],mode="manage",notice="",loading=false,term="",detail=null,episode=null,streams=[],selectedStream=null,streamFailures=[];
let catalogFeeds=[],pendingFeeds=[],catalogToken=0,moreLoading=false,addonPage=0,feedCursor=0,localTerm="",addonType="all",addonProvider="all",addonGenre="all",addonSort="featured",addonCatalog="all",remoteGenre="";
let unsupportedCatalogs=0,addonObserver=null,addonScrollBound=false;
function observeAddonPages(){
 if(addonObserver?.disconnect)addonObserver.disconnect();
 const marker=$("#addonAutoMore");
 if(mode!=="browse"||!marker?.isConnected)return;
 const advance=()=>{
  if(loading||moreLoading)return;
  if(pendingFeeds.length)void loadNextCatalogFeeds();
  else if(catalogFeeds.some(f=>f.hasMore))void loadMoreCatalogs();
 };
 if(typeof IntersectionObserver!=="undefined"){
  addonObserver=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting))advance();
  },{rootMargin:"700px 0px"});
  addonObserver.observe(marker);
 }else if(!addonScrollBound&&typeof window!=="undefined"&&typeof window.addEventListener==="function"){
  addonScrollBound=true;
  window.addEventListener("scroll",()=>{
   if(mode!=="browse")return;
   const target=$("#addonAutoMore");
   if(target?.getBoundingClientRect?.().top<(Number(window.innerHeight)||800)+700)advance();
  },{passive:true});
 }
}
function read(){try{let v=JSON.parse(localStorage.getItem("luma.addons.v1")||"[]");return Array.isArray(v)?v.filter(x=>x&&typeof x.url==="string"&&x.manifest?.id):[]}catch{return[]}}
function saveAddons(){try{localStorage.setItem("luma.addons.v1",JSON.stringify(list))}catch{toast("Could not save add-ons")}}
function validateURL(raw){let u;try{u=new URL(String(raw).trim())}catch{throw Error("Enter a full manifest.json URL.")}if(u.protocol!=="https:"||!u.hostname||u.username||u.password||u.port&&u.port!=="443")throw Error("Use a public HTTPS manifest URL without embedded credentials or a custom port.");if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)||u.hostname.endsWith(".local"))throw Error("Private-network addresses are not supported by this browser app.");if(!u.pathname.endsWith("/manifest.json"))throw Error("The URL needs to end with /manifest.json.");if(u.hash)throw Error("Remove URL fragments.");return u.href}
function validateManifest(m){
 if(!m||typeof m!=="object"||!String(m.id||"").trim()||!String(m.name||"").trim()||!Array.isArray(m.resources)||!Array.isArray(m.types)){
  throw Error("Invalid add-on manifest: provide id, name, resources and types.");
 }
 const resources=m.resources.filter(x=>typeof x==="string"||x&&typeof x.name==="string").slice(0,50);
 const types=m.types.filter(x=>typeof x==="string"&&x.length<50).slice(0,30);
 const catalogs=(Array.isArray(m.catalogs)?m.catalogs:[]).filter(x=>x&&typeof x.type==="string"&&typeof x.id==="string").slice(0,70);
 if(!resources.length||!types.length)throw Error("The manifest has no supported resources or media types.");
 return {id:String(m.id).slice(0,150),name:String(m.name).slice(0,140),version:String(m.version||"1.0.0").slice(0,50),
   description:String(m.description||"").slice(0,400),resources,types,catalogs,
   idPrefixes:Array.isArray(m.idPrefixes)?m.idPrefixes.filter(x=>typeof x==="string").slice(0,30):[]};
}
async function fetchJSON(url,{streamList=false}={}){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
 try{
  const res=await fetch(url,{mode:"cors",credentials:"omit",signal:c.signal,redirect:"follow",headers:{"Accept":"application/json"}});
  if(res.redirected){
    const target=new URL(res.url);
    if(target.protocol!=="https:"||!target.hostname||target.username||target.password||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(target.hostname)||target.hostname.endsWith(".local"))throw Error("Add-on redirected to an unsupported address.");
  }
  if(!res.ok)throw Error("HTTP "+res.status+(res.status===404?" (resource missing)":res.status===401||res.status===403?" (authorization required)":res.status===429?" (rate limited)":""));
  if(streamList)return await res.json();
  const body=await res.text();
  if(body.length>1500000)throw Error("Add-on response exceeds 1.5 MB.");
  try{return JSON.parse(body)}catch{throw Error("Add-on returned invalid JSON, not a compatible resource.")}
 }catch(e){
  if(e instanceof SyntaxError)throw Error("Add-on returned invalid JSON.");
  if(e.name==="AbortError")throw Error("Add-on timed out after 15 seconds.");
  if(e instanceof TypeError)throw Error("Browser could not reach the add-on. Check connectivity, CORS and your configured URL.");
  throw e;
 }finally{clearTimeout(timer)}
}
function endpoint(add,resource,type,id,extra){let u=new URL(add.url),prefix=u.pathname.slice(0,-"manifest.json".length),parts=[resource,type,id].map(x=>encodeURIComponent(String(x)));let suffix=extra&&Object.keys(extra).length?"/"+Object.entries(extra).map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&"):"";u.pathname=prefix+parts.join("/")+suffix+".json";return u.href}
function supports(add,res,type,id=""){let m=add.manifest;return m.resources.some(r=>{if(typeof r==="string")return r===res&&m.types.includes(type)&&(!id||!m.idPrefixes?.length||m.idPrefixes.some(p=>id.startsWith(p)));return r.name===res&&(!r.types||r.types.includes(type))&&(!id||!r.idPrefixes?.length||r.idPrefixes.some(p=>id.startsWith(p)))})}
const active=()=>list.filter(x=>x.enabled);
async function install(raw){const url=validateURL(raw);if(list.some(x=>x.url===url))throw Error("Already installed.");const manifest=validateManifest(await fetchJSON(url));if(list.some(x=>x.manifest.id===manifest.id))throw Error("An add-on with this ID is already installed. Remove it first to change its URL.");list.push({url,manifest,enabled:true});saveAddons();return manifest}
async function refreshManifest(index){
 const add=list[index];if(!add)return;
 const json=await fetchJSON(add.url),manifest=validateManifest(json);
 if(manifest.id!==add.manifest.id)throw Error("Manifest ID changed. Reinstall this add-on to change its identity.");
 add.manifest=manifest;add.checkedAt=Date.now();saveAddons();
 return manifest;
}
function item(m,a,t,catalogInfo=null){if(!m||typeof m.id!=="string")return null;const id="addon:"+a.manifest.id+":"+t+":"+m.id;return {id,title:String(m.name||m.title||"Untitled"),type:t==="series"?"Series":t==="movie"?"Movie":t==="anime"?"Anime":t,stremioID:m.id,stremioType:t,addonID:a.manifest.id,provider:a.manifest.name,catalogID:catalogInfo?.id||"",catalogName:catalogInfo?.name||"",overview:m.description||"",poster:m.poster&&/^https:\/\//i.test(m.poster)?m.poster:"",backdrop:m.background&&/^https:\/\//i.test(m.background)?m.background:"",year:m.releaseInfo||m.year||"",genreNames:Array.isArray(m.genres)?m.genres.filter(x=>typeof x==="string").slice(0,12):[],original_language:m.original_language||m.originalLanguage||"",englishDub:m.englishDub===true||m.english_dub===true||Array.isArray(m.dubbed_languages)&&m.dubbed_languages.some(code=>/^(en|eng|english)$/i.test(String(code))),rating:m.imdbRating||m.rating||"",contentRating:m.contentRating||m.certification||m.ageRating||"",source:"stremio"}}
function bindNavigation(){let nav=$("#navigation");if(!nav)return;if(nav.querySelector('[data-tab="Add-ons"]'))return;if(!nav.querySelector("[data-addon-nav]")){let b=document.createElement("button");b.className="navbutton";b.setAttribute("data-addon-nav","");b.innerHTML="<span>✦</span><span>Luma Add-ons</span>";nav.appendChild(b)}nav.querySelector("[data-addon-nav]").onclick=()=>{state.tab="Add-ons";state.q="";$("#search").value="";mode="manage";render()};nav.querySelector("[data-addon-nav]").classList.toggle("active",state.tab==="Add-ons")}

function catalogBrowseMarkup(){
 const providers=[...new Map(active().map(x=>[x.manifest.id,x.manifest.name])).entries()];
 const genres=[...new Set(catalog.flatMap(x=>x.genreNames||[]).filter(Boolean))].sort();
 const catalogs=[...new Map(catalogFeeds.map(f=>[f.a.manifest.id+":"+f.c.id,{id:f.a.manifest.id+":"+f.c.id,name:f.a.manifest.name+" · "+(f.c.name||f.c.id)}])).values()];
 const remoteGenres=[...new Set(active().flatMap(a=>(a.manifest.catalogs||[]).flatMap(c=>(c.extra||[]).filter(e=>e.name==="genre").flatMap(e=>Array.isArray(e.options)?e.options:[]))))].filter(x=>typeof x==="string").sort();
 if(addonCatalog!=="all"&&!catalogs.some(c=>c.id===addonCatalog))addonCatalog="all";
 if(addonProvider!=="all"&&!providers.some(([id])=>id===addonProvider))addonProvider="all";
 if(addonGenre!=="all"&&!genres.includes(addonGenre))addonGenre="all";
 const q=localTerm.trim().toLowerCase();
 const items=catalog.filter(x=>(addonType==="all"||x.type===addonType)
   &&(addonProvider==="all"||x.addonID===addonProvider)
   &&(addonCatalog==="all"||x.addonID+":"+x.catalogID===addonCatalog)
   &&(addonGenre==="all"||x.genreNames?.includes(addonGenre))
   &&(!q||[x.title,x.overview,x.year].some(s=>String(s||"").toLowerCase().includes(q))));
 if(addonSort==="title")items.sort((a,b)=>a.title.localeCompare(b.title));
 if(addonSort==="year")items.sort((a,b)=>(parseInt(b.year,10)||0)-(parseInt(a.year,10)||0));
 if(addonSort==="provider")items.sort((a,b)=>a.provider.localeCompare(b.provider)||a.title.localeCompare(b.title));
 const size=24,pages=Math.max(1,Math.ceil(items.length/size));
 addonPage=Math.max(0,Math.min(addonPage,pages-1));
 const pageItems=items.slice(addonPage*size,(addonPage+1)*size), more=catalogFeeds.some(f=>f.hasMore);
 let html='<section class="collectionIntro"><h2>Browse your add-on catalogs</h2><p>Search compatible Luma catalog feeds, filter titles, and load later pages when a catalog supports pagination. Your add-ons and saved lists stay on this device.</p><span class="collectionCount">'+items.length+' visible titles · '+catalog.length+' loaded</span></section>'
   +'<div class="toolbar addonCatalogSearch"><label>Search provider feeds<input class="addonSearch" id="addonSearch" type="search" value="'+safe(term)+'" placeholder="Search across compatible add-ons"></label><button class="primary" id="addonRunSearch">Search feeds</button><button class="secondary" id="refreshAddons">Refresh catalogs</button></div>'
   +'<p class="micro">Feed search only queries add-ons that support the catalog search parameter. Use "Filter loaded" below to search titles already downloaded from all feeds.</p>'
   +'<div class="collectionControls"><label>Filter loaded<input id="addonLocalFilter" type="search" value="'+safe(localTerm)+'" placeholder="Search loaded titles"></label><label>Type<select id="addonType"><option value="all"'+(addonType==="all"?' selected':'')+'>All types</option><option value="Movie"'+(addonType==="Movie"?' selected':'')+'>Movies</option><option value="Series"'+(addonType==="Series"?' selected':'')+'>TV series</option><option value="Anime"'+(addonType==="Anime"?' selected':'')+'>Anime</option></select></label>'
   +'<label>Source<select id="addonProvider"><option value="all">All add-ons</option>'+providers.map(([id,name])=>'<option value="'+safe(id)+'"'+(addonProvider===id?' selected':'')+'>'+safe(name)+'</option>').join("")+'</select></label>'
   +'<label>Genre<select id="addonGenre"><option value="all">All genres</option>'+genres.map(g=>'<option value="'+safe(g)+'"'+(addonGenre===g?' selected':'')+'>'+safe(g)+'</option>').join("")+'</select></label>'
   +'<label>Catalog<select id="addonCatalog"><option value="all">All catalogs</option>'+catalogs.map(c=>'<option value="'+safe(c.id)+'"'+(addonCatalog===c.id?' selected':'')+'>'+safe(c.name)+'</option>').join("")+'</select></label>'
   +'<label>Provider genre<select id="addonRemoteGenre"><option value="">Default / all available</option>'+remoteGenres.map(g=>'<option value="'+safe(g)+'"'+(remoteGenre===g?' selected':'')+'>'+safe(g)+'</option>').join("")+'</select></label>'
   +'<label>Sort<select id="addonSort"><option value="featured"'+(addonSort==="featured"?' selected':'')+'>Catalog order</option><option value="title"'+(addonSort==="title"?' selected':'')+'>Title A–Z</option><option value="year"'+(addonSort==="year"?' selected':'')+'>Newest year</option><option value="provider"'+(addonSort==="provider"?' selected':'')+'>Source</option></select></label></div>';
 if(loading)html+='<div class="loading">Loading catalog pages…</div>';
 if(pageItems.length)html+='<div class="tiles collectionGrid">'+pageItems.map(x=>'<button class="media" data-addon-open="'+safe(x.id)+'"><div class="art" style="--c1:#43376a"><div class="posterText">'+safe(x.title)+'</div>'+(x.poster?'<img loading="lazy" src="'+safe(x.poster)+'" alt="" onerror="this.remove()">':'')+'</div><div class="iteminfo"><b>'+safe(x.title)+'</b><small>'+safe(x.type)+' · '+safe(x.provider)+(x.year?' · '+safe(x.year):'')+'</small><div class="cardFacts"><span class="cardYear">'+safe(x.year||"—")+'</span><span class="cardMediaType">'+safe(x.type)+'</span>'+(typeof audienceBadge==="function"?audienceBadge(x):"")+(typeof certificateSlot==="function"?certificateSlot(x):"")+'</div>'+(typeof lastAiredSlot==="function"?lastAiredSlot(x):"")+(typeof originalLanguageBadge==="function"?languageBadges(x):'<small class="cardOriginalLanguage">Original · Not listed</small>')+'</div></button>').join("")+'</div>';
 else if(!loading)html+='<div class="empty">No matching titles. Try another filter, search supported feeds, or install a catalog add-on.</div>';
 if(pages>1)html+='<nav class="collectionPager" aria-label="Catalog results pages"><button class="secondary" id="addonPrev" '+(addonPage===0?'disabled':'')+'>← Previous</button><span>Page '+(addonPage+1)+' of '+pages+'</span><button class="secondary" id="addonNext" '+(addonPage===pages-1?'disabled':'')+'>Next →</button></nav>';
 if(more)html+='<div class="collectionLoad" id="addonAutoMore" role="status">More add-on titles load automatically as you scroll.<button id="addonMore" type="button" hidden>Load later pages</button></div>';
 if(pendingFeeds.length)html+='<div class="collectionLoad" '+(more?'':'id="addonAutoMore"')+' role="status">Checking '+pendingFeeds.length+' additional provider catalogs automatically.<button id="addonMoreFeeds" type="button" hidden>Load next catalogs</button></div>';
 if(catalogFeeds.length||unsupportedCatalogs)html+='<details class="catalogDiagnostics"><summary>Source diagnostics · '+catalogFeeds.filter(f=>f.error).length+' unavailable · '+unsupportedCatalogs+' unsupported</summary><div class="catalogHealth">'
   +catalogFeeds.map(f=>'<div><b>'+safe(f.a.manifest.name)+' · '+safe(f.c.name||f.c.id)+'</b><span>'+(f.error?safe(f.error):f.lastCount+' received'+(f.genre?' · genre: '+safe(f.genre):''))+'</span></div>').join("")
   +(unsupportedCatalogs?'<p class="micro">'+unsupportedCatalogs+' catalog(s) require parameters the browser cannot determine. Those were skipped without affecting other feeds.</p>':'')
   +'</div></details>';
 return html;
}
function bindCatalogControls(){
 if($("#addonRunSearch"))$("#addonRunSearch").onclick=()=>{term=$("#addonSearch")?.value.trim()||"";addonPage=0;refreshCatalogs()};
 if($("#addonSearch"))$("#addonSearch").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("#addonRunSearch")?.click()}};
 if($("#addonLocalFilter"))$("#addonLocalFilter").oninput=e=>{localTerm=e.target.value;addonPage=0;updateVisibleCatalog()};
 for(const [selector,key] of [["#addonType","type"],["#addonProvider","provider"],["#addonGenre","genre"],["#addonSort","sort"],["#addonCatalog","catalog"]]){
   const field=$(selector);if(field)field.onchange=e=>{
     if(key==="type")addonType=e.target.value;
     if(key==="provider")addonProvider=e.target.value;
     if(key==="genre")addonGenre=e.target.value;
     if(key==="sort")addonSort=e.target.value;
     if(key==="catalog")addonCatalog=e.target.value;
     addonPage=0;render();
   };
 }
 if($("#addonPrev"))$("#addonPrev").onclick=()=>{addonPage--;render();$("#content")?.scrollIntoView?.({block:"start",behavior:"auto"})};
 if($("#addonNext"))$("#addonNext").onclick=()=>{addonPage++;render();$("#content")?.scrollIntoView?.({block:"start",behavior:"auto"})};
 if($("#addonMore"))$("#addonMore").onclick=loadMoreCatalogs;
 if($("#addonMoreFeeds"))$("#addonMoreFeeds").onclick=loadNextCatalogFeeds;
 observeAddonPages();
 if($("#addonRemoteGenre"))$("#addonRemoteGenre").onchange=e=>{remoteGenre=e.target.value;refreshCatalogs()};
}
let catalogFilterTimer=0;
function updateVisibleCatalog(){
 clearTimeout(catalogFilterTimer);
 catalogFilterTimer=setTimeout(()=>{
   render();
   const field=$("#addonLocalFilter");if(field){field.focus();try{field.setSelectionRange(localTerm.length,localTerm.length)}catch{}}
 },200);
}
function dedupeCatalog(items){
 const ids=new Set();
 return items.filter(x=>{if(ids.has(x.id))return false;ids.add(x.id);return true});
}
function availableFeeds(){
 const feeds=[];unsupportedCatalogs=0;
 for(const a of active()){
  for(const catalog of a.manifest.catalogs||[]){
   if(!["movie","series","anime","tv"].includes(catalog?.type)||!catalog?.id||!supports(a,"catalog",catalog.type))continue;
   const extra=Array.isArray(catalog.extra)?catalog.extra:[];
   const required=extra.filter(e=>e?.isRequired).map(e=>e.name);
   const search=extra.some(e=>e?.name==="search");
   if((term&&!search)||(!term&&required.includes("search"))){continue}
   if(required.some(name=>!["search","genre","skip"].includes(name))){unsupportedCatalogs++;continue}
   const genre=extra.find(e=>e?.name==="genre");
   const genreOptions=Array.isArray(genre?.options)?genre.options.filter(x=>typeof x==="string"):[];
   const chosenGenre=remoteGenre&&genreOptions.includes(remoteGenre)?remoteGenre:genre?.isRequired?genreOptions[0]||"":remoteGenre&&genre?remoteGenre:"";
   if(genre?.isRequired&&!chosenGenre){unsupportedCatalogs++;continue}
   feeds.push({a,c:catalog,genre:chosenGenre,skip:0,hasMore:extra.some(e=>e?.name==="skip"),pages:0,search:term,error:"",lastCount:0});
  }
 }
 return feeds;
}
async function fetchFeedPages(feeds,token,firstTitles){
 const outcomes=new Array(feeds.length);
 let next=0;
 async function readNext(){
  while(token===catalogToken && next<feeds.length){
   const index=next++,feed=feeds[index];
   try{
    const extra={};
    if(feed.search)extra.search=feed.search;
    if(feed.genre)extra.genre=feed.genre;
    if(feed.skip)extra.skip=feed.skip;
    const data=await fetchJSON(endpoint(feed.a,"catalog",feed.c.type,feed.c.id,extra));
    if(!Array.isArray(data?.metas))throw Error("Invalid catalog response.");
    outcomes[index]={status:"fulfilled",value:{feed,metas:data.metas.slice(0,100)},feed};
   }catch(reason){outcomes[index]={status:"rejected",reason,feed}}
   if(firstTitles && token===catalogToken && outcomes[index].status==="fulfilled"){
    const rows=outcomes[index].value.metas.map(meta=>item(meta,feed.a,feed.c.type,feed.c)).filter(Boolean);
    if(rows.length){firstTitles(rows);firstTitles=null}
   }
  }
 }
 await Promise.all(Array.from({length:Math.min(6,feeds.length)},readNext));
 return outcomes.filter(Boolean);
}
function applyFeedResponses(outcomes){
 let incoming=[],errors=0;
 for(const result of outcomes){
   if(result.status!=="fulfilled"){errors++;result.feed.error="Unavailable or browser request blocked";result.feed.hasMore=false;continue}
   const {feed,metas}=result.value;
   feed.pages++;
   feed.lastCount=metas.length;feed.error="";feed.skip+=metas.length;
   feed.hasMore=feed.hasMore&&metas.length>0&&feed.pages<8;
   incoming.push(...metas.map(meta=>item(meta,feed.a,feed.c.type,feed.c)).filter(Boolean));
 }
 catalog=dedupeCatalog([...catalog,...incoming]);
 return errors;
}

function render(){const target=$("#content");if(!target)return;bindNavigation();const count=list.length;let html='<section class="addonsHero"><div class="eyebrow">LUMA ADD-ONS</div><h2>One home for your favorite add-ons</h2><p>Add multiple Luma-compatible manifests, manage each source independently, discover its catalogs and select compatible streams in a cinematic library.</p><div class="addonTabs"><button class="secondary '+(mode==="manage"?"selected":"")+'" id="addonManage">Manage ('+count+')</button><button class="secondary '+(mode==="browse"?"selected":"")+'" id="addonBrowse">Browse add-on titles</button></div></section>';if(mode==="manage"){html+='<section class="settingCard addonInstall"><h2>Install a Luma add-on</h2><form id="addonForm"><label for="addonURL">Manifest URL</label><div class="addonInputRow"><input id="addonURL" type="url" required spellcheck="false" placeholder="https://example.org/manifest.json"><button class="primary" '+(loading?"disabled":"")+' type="submit">Install</button></div></form><details class="bulkAdd"><summary>Install multiple manifest URLs at once</summary><label for="bulkURL">One manifest.json URL per line</label><textarea id="bulkURL" rows="5" placeholder="https://addon-one.example/manifest.json&#10;https://addon-two.example/manifest.json"></textarea><button class="secondary" type="button" id="bulkInstall">Install URL list</button><p class="micro">Imports up to 25 URLs in one batch; you can repeat for more. Each add-on is checked independently.</p></details><p class="micro">Add as many supported add-ons as you want. Use HTTPS. Only install add-ons you trust; some configured manifest links contain personal tokens, which remain in your browser storage.</p></section><section class="shelf"><div class="shelfhead"><h2>Installed add-ons</h2><span>'+active().length+' enabled · '+count+' total</span></div>'+(count?'<div class="addonList">'+list.map((a,i)=>'<div class="addonItem"><div class="addonAvatar">'+safe(a.manifest.name.charAt(0).toUpperCase())+'</div><div class="addonDescription"><b>'+safe(a.manifest.name)+'</b><span>v'+safe(a.manifest.version)+' · '+safe(a.manifest.types.join(", "))+'</span><p>'+safe(a.manifest.description)+'</p><small>'+a.manifest.catalogs.length+' catalog'+(a.manifest.catalogs.length===1?'':'s')+' · '+(a.manifest.resources.some(r=>(typeof r==="string"?r:r.name)==="stream")?'Stream source':'Catalog / metadata only')+'</small></div><div class="addonControls"><label><input type="checkbox" data-toggle="'+i+'" '+(a.enabled?"checked":"")+'> Enabled</label><button class="secondary small" data-test="'+i+'">Check</button><button class="secondary small" data-refresh-manifest="'+i+'">Refresh</button><button class="secondary small" data-remove="'+i+'">Remove</button></div></div>').join("")+'</div>':'<div class="empty">No add-ons installed yet. Add your first manifest above.</div>')+'</section>'}else{html+=catalogBrowseMarkup()}if(notice)html='<div class="notice">'+safe(notice)+'</div>'+html;target.innerHTML=html;$("#addonManage").onclick=()=>{mode="manage";notice="";render()};$("#addonBrowse").onclick=()=>{mode="browse";notice="";if(!catalog.length)refreshCatalogs();else render()};if($("#addonForm"))$("#addonForm").onsubmit=async e=>{e.preventDefault();const url=e.target.elements.addonURL.value;loading=true;notice="Connecting to manifest…";render();try{const m=await install(url);notice="Installed "+m.name+". You can install another manifest."}catch(err){notice=err.message}finally{loading=false;render()}};if($("#bulkInstall"))$("#bulkInstall").onclick=async()=>{const text=$("#bulkURL").value;const urls=[...new Set(text.split(/[\r\n]+/).map(x=>x.trim()).filter(Boolean))].slice(0,25);if(!urls.length){notice="Paste at least one URL.";render();return}loading=true;notice="Installing "+urls.length+" add-ons…";render();let successes=[],failures=[];for(const url of urls){try{const m=await install(url);successes.push(m.name)}catch(e){failures.push("Entry "+(successes.length+failures.length+1)+": "+String(e.message||e))}}notice="Installed "+successes.length+" of "+urls.length+" add-ons."+(failures.length?" "+failures.slice(0,4).join("; ")+(failures.length>4?" and "+(failures.length-4)+" more errors.":""):"");loading=false;render()};$$("[data-toggle]").forEach(b=>b.onchange=()=>{list[Number(b.dataset.toggle)].enabled=b.checked;saveAddons();render()});$$("[data-remove]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.remove);if(confirm("Remove "+list[i].manifest.name+"?")){list.splice(i,1);saveAddons();render()}});$$("[data-test]").forEach(b=>b.onclick=async()=>{const a=list[Number(b.dataset.test)];notice="Checking "+a.manifest.name+"…";render();try{const m=validateManifest(await fetchJSON(a.url));notice="Manifest online: "+m.name+" ("+m.version+"). This checks the manifest, not every stream endpoint."}catch(err){notice=err.message}render()});$$("[data-refresh-manifest]").forEach(b=>b.onclick=async()=>{const index=Number(b.dataset.refreshManifest),add=list[index];if(!add)return;notice="Refreshing add-on configuration…";render();try{const updated=await refreshManifest(index);notice="Updated "+updated.name+": "+updated.catalogs.length+" catalogs available. Installed settings preserved."}catch(err){notice="Could not refresh "+add.manifest.name+": "+String(err.message||err)}render()});if($("#refreshAddons"))$("#refreshAddons").onclick=refreshCatalogs;bindCatalogControls();$$("[data-addon-open]").forEach(b=>b.onclick=()=>openItem(b.dataset.addonOpen));if(typeof scanLanguageCards==="function")scanLanguageCards();if(typeof observeLastAired==="function")observeLastAired()}

async function refreshCatalogs(){
 const token=++catalogToken;
 loading=true;moreLoading=false;notice="";addonPage=0;feedCursor=0;catalog=[];catalogFeeds=[];
 const available=availableFeeds(),initial=available.slice(0,24);
 pendingFeeds=available.slice(24);
 render();
 const outcomes=await fetchFeedPages(initial,token,rows=>{
  catalog=dedupeCatalog(rows);
  if(mode==="browse"&&state.tab==="Add-ons")render();
 });
 if(token!==catalogToken)return;
 catalog=[];catalogFeeds=initial;const errors=applyFeedResponses(outcomes);
 loading=false;
 if(errors)notice=errors+" catalog feed(s) could not load; use Source diagnostics to see which.";
 if(!initial.length)notice=term?"No enabled catalog advertises search support. Clear the search to browse available titles.":"No compatible catalogs found. Check installed add-ons or required catalog parameters.";
 render();
}
async function loadNextCatalogFeeds(){
 if(loading||moreLoading||!pendingFeeds.length)return;
 const token=catalogToken,upcoming=pendingFeeds.splice(0,12);
 moreLoading=true;render();
 const outcomes=await fetchFeedPages(upcoming,token);
 if(token!==catalogToken)return;
 catalogFeeds.push(...upcoming);
 const errors=applyFeedResponses(outcomes);moreLoading=false;
 notice=errors?errors+" additional catalog feed(s) could not load.":"";
 render();
}
async function loadMoreCatalogs(){
 if(moreLoading||loading)return;
 const activeFeeds=catalogFeeds.filter(f=>f.hasMore);
 if(!activeFeeds.length)return;
 const token=catalogToken;
 moreLoading=true;render();
 const selected=Array.from({length:Math.min(8,activeFeeds.length)},(_,i)=>activeFeeds[(feedCursor+i)%activeFeeds.length]);
 feedCursor=(feedCursor+selected.length)%activeFeeds.length;
 const outcomes=await fetchFeedPages(selected,token);
 if(token!==catalogToken)return;
 const previous=catalog.length,errors=applyFeedResponses(outcomes);
 moreLoading=false;
 if(errors)notice=errors+" catalog page(s) could not load. The other sources remain available.";
 else if(catalog.length===previous)notice="No new titles in this batch. Try loading another page if more are available.";
 else notice="";
 render();
}


let addonSeason=1,addonDetailBusy=false,addonDetailError="";
async function openItem(id){
 const found=catalog.find(x=>x.id===id);if(!found)return;
 detail={...found};episode=null;addonSeason=1;addonDetailBusy=true;addonDetailError="";showDetail();
 const add=list.find(x=>x.manifest.id===found.addonID);
 if(add&&supports(add,"meta",found.stremioType,found.stremioID)){
  try{
   const r=await fetchJSON(endpoint(add,"meta",found.stremioType,found.stremioID));
   if(detail?.id!==id)return;
   if(!r?.meta||typeof r.meta!=="object")throw Error("No detailed metadata returned.");
   const meta=r.meta;
   detail={...detail,overview:meta.description||detail.overview,
     videos:Array.isArray(meta.videos)?meta.videos:[],poster:meta.poster||detail.poster,
     backdrop:meta.background||detail.backdrop,year:meta.releaseInfo||detail.year};
   addonSeason=[...new Set(detail.videos.map(v=>Number(v.season)||1).filter(n=>Number.isInteger(n)&&n>0))].sort((a,b)=>a-b)[0]||1;
  }catch(e){addonDetailError="Episode metadata unavailable from this add-on. You can open Luma's full TV guide or try another source."}
 }else addonDetailError="This source does not publish a detailed episode guide.";
 if(detail?.id===id){addonDetailBusy=false;showDetail()}
}

function showDetail(){
 if(!detail)return;
 const x=detail,videos=Array.isArray(x.videos)?x.videos.slice(0,1000):[];
 const show=x.type==="Series"||x.type==="Anime";
 const seasons=[...new Set(videos.map(e=>Number(e.season)).filter(n=>Number.isInteger(n)&&n>0))].sort((a,b)=>a-b);
 if(show&&seasons.length&&!seasons.includes(addonSeason))addonSeason=seasons[0];
 const available=show?videos.filter(e=>(Number(e.season)||1)===addonSeason):videos;
 let html='<div class="addonDetailBanner" '+(x.backdrop?'style="background-image:linear-gradient(0deg,#181a29,transparent),url(&quot;'+safe(x.backdrop)+'&quot;)"':'')+'></div>'
  +'<div class="pad lumaAddonDetail"><div class="eyebrow">'+safe(x.provider)+' · '+safe(x.type)+'</div><h2>'+safe(x.title)+'</h2>'
  +'<p>'+safe(x.overview||"Browse playback options from installed Luma Add-ons.")+'</p>'
  +'<div class="actions"><button class="primary" id="findStreams">'+(show?"▶ Find episode sources":"▶ Find movie sources")+'</button>'
  +(show?'<button class="secondary" id="fullEpisodeGuide">Open full episode guide</button>':"")
  +'<button class="secondary" id="backToAddons">Back to catalog</button></div>';
 if(show){
  html+='<section class="episodeHub"><div class="episodeHubTop"><div><div class="eyebrow">SERIES GUIDE</div><h3>Select an episode</h3><p>Choose a season, then an episode to find playback options.</p></div>'
   +(seasons.length?'<label class="episodeSeasonLabel">Season<select id="addonSeason">'+seasons.map(n=>'<option value="'+n+'"'+(n===addonSeason?" selected":"")+'>Season '+n+'</option>').join("")+'</select></label>':"")
   +'</div>';
  if(addonDetailBusy)html+='<div class="episodeLoading"><span class="spinner"></span> Loading episodes…</div>';
  else if(available.length)html+='<div class="episodeHubCount">'+available.length+' episodes</div><div class="episodeList cinematicEpisodeList">'
   +available.map((e,i)=>{const id=videos.indexOf(e),pic=e.thumbnail||e.poster||x.backdrop||"",released=e.released||e.air_date||"";
    return '<button class="episode episodeCinematic" type="button" data-episode="'+id+'">'
     +'<div class="episodeStill">'+(pic&&/^https:\/\//.test(pic)?'<img src="'+safe(pic)+'" alt="" loading="lazy" onerror="this.remove()">':'<span class="episodeStillFallback">LUMA</span>')+'<span class="episodePlayGlyph">▶</span></div>'
     +'<div class="episodeInfo"><div class="episodeTitleRow"><strong>'+safe(e.episode||i+1)+'. '+safe(e.title||e.name||"Episode "+(i+1))+'</strong></div>'
     +'<p class="episodeSummary">'+safe((e.overview||e.description||"Choose this episode to view its available sources.").slice(0,190))+'</p>'
     +'<div class="episodeStatus"><span>S'+String(e.season||addonSeason).padStart(2,"0")+'E'+String(e.episode||i+1).padStart(2,"0")+'</span>'
     +(released?'<span>'+safe(String(released).slice(0,10))+'</span>':"")+'</div></div><span class="episodeSelectArrow">›</span></button>';
   }).join("")+'</div>';
  else html+='<div class="episodeEmpty"><strong>Episode list not supplied</strong><p>'+safe(addonDetailError||"Try Luma's full episode guide for this series.")+'</p></div>';
  html+='</section>';
 }
 html+='<p class="micro">Stream availability and episode metadata depend on each source and your authorized access.</p></div>';
 modal(html);
 $("#findStreams").onclick=()=>show&&available.length?getStreams(available[0]):getStreams(null);
 $("#backToAddons").onclick=()=>{closeModal();render()};
 if($("#fullEpisodeGuide"))$("#fullEpisodeGuide").onclick=()=>{
  const copy={...x,source:"addon",imdbId:/^tt\d+$/.test(x.stremioID||"")?x.stremioID:""};
  state.items=unique([copy,...state.items]);openTitle(copy.id);
 };
 if($("#addonSeason"))$("#addonSeason").onchange=e=>{addonSeason=Number(e.target.value);showDetail()};
 $$("[data-episode]").forEach(b=>b.onclick=()=>{const picked=videos[Number(b.dataset.episode)];if(picked)getStreams(picked,captureStreamOrigin(b))});
}

let streamRequestToken=0,returnFromStreams=null,pendingProviders=new Map();
function captureStreamOrigin(button){
 return typeof captureStreamReturn==="function"?captureStreamReturn(button):null;
}

async function getStreams(e,back=captureStreamOrigin()){
 streamChoices={};streamSort="quality";streamPage=0;streamQuery="";extraFiltersOpen=false;
 returnFromStreams=back||showDetail;
 episode=e||null;const x=detail;if(!x)return;
 const token=++streamRequestToken,videoID=e?.id||x.stremioID;
 const candidates=active().filter(a=>supports(a,"stream",x.stremioType,videoID));
 streams=[];streamFailures=[];
 pendingProviders=new Map(candidates.map(a=>[a.manifest.id,a.manifest.name]));
 showStreams(candidates.length?"":"No enabled source supports this title ID and media type. Check your add-ons.");
 await Promise.all(candidates.map(async addon=>{
  const {id,name}=addon.manifest;
  try{
   const response=await fetchJSON(endpoint(addon,"stream",x.stremioType,videoID),{streamList:true});
   if(token!==streamRequestToken)return;
   if(!Array.isArray(response?.streams))throw Error("The add-on returned no valid streams list.");
   for(const raw of response.streams){
    if(raw&&typeof raw==="object"&&!Array.isArray(raw))streams.push({raw,provider:name,providerId:id});
   }
  }catch(err){
   if(token===streamRequestToken)streamFailures.push({provider:name,reason:String(err.message||err).slice(0,160)});
  }finally{
   if(token===streamRequestToken){
    pendingProviders.delete(id);
    if($('[data-stream-request="'+token+'"]'))showStreams(!pendingProviders.size&&!streams.length?"No releases were returned for this title.":"");
   }
  }
 }));
}

function directURL(s){const u=s?.url;if(typeof u!=="string")return"";try{const p=new URL(u);return ["https:","http:"].includes(p.protocol)?p.href:""}catch{return""}}

const streamFacets=[
 ["provider","Manifest provider"],["quality","Quality"],["delivery","Link type"],["cache","Cache status"],
 ["audio","Audio language"],["subtitles","Subtitle language"],["edition","Audio edition"],["range","Dynamic range"],
 ["codec","Video codec"],["sound","Audio format"],["release","Release type"],["size","File size"],
 ["debrid","Debrid service"],["availability","Seeders"]
];
let streamChoices={},streamSort="quality",streamPage=0,streamLastMessage="",streamQuery="",extraFiltersOpen=false;
function streamQuality(text,resolution){
 const reported=typeof resolution==="object"&&resolution?Number(resolution.height):Number(resolution);
 const dimensions=String(resolution||text).match(/\b(\d{3,5})\s*[x×]\s*(\d{3,5})\b/i)||text.match(/\b(\d{3,5})\s*[x×]\s*(\d{3,5})\b/i);
 const height=dimensions?Number(dimensions[2]):reported;
 if([4320,2160,1440,1080,720,576,480].includes(height))text=height+"p";

 if(/\b(?:4320p|8k)\b/i.test(text))return {tag:"8K",order:6};
 if(/\b(?:2160p|4k|uhd)\b/i.test(text))return {tag:"4K",order:5};
 if(/\b1440p\b/i.test(text))return {tag:"1440p",order:4};
 if(/\b(?:1080[pi]|full[\s-]?hd|fhd)\b/i.test(text))return {tag:"1080p",order:3};
 if(/\b720p\b/i.test(text))return {tag:"720p",order:2};
 if(/\b(?:480[pi]|576[pi]|sd)\b/i.test(text))return {tag:"SD",order:1};
 return {tag:"Unspecified",order:0};
}
function streamBytes(raw,text){
 const bytes=Number(raw.behaviorHints?.videoSize??raw.size);
 if(Number.isFinite(bytes)&&bytes>0)return bytes;
 const match=text.match(/\b(\d+(?:[.,]\d+)?)\s*(GiB|GB|MiB|MB)\b/i);
 return match?Number(match[1].replace(",","."))*({gib:2**30,gb:1e9,mib:2**20,mb:1e6}[match[2].toLowerCase()]):0;
}
const languageNames=typeof Intl.DisplayNames==="function"?new Intl.DisplayNames(["en"],{type:"language"}):null;
function streamLanguages(values){
 return [...new Set(values.flatMap(v=>{
  if(typeof v!=="string")return [];
  return v.split(/[,;/+|]/).map(s=>s.trim()).filter(Boolean).map(s=>{
   if(/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(s)){
    try{return languageNames?.of(s.toLowerCase())||s}catch{}
   }
   const name=s.slice(0,50);
   return /^[a-z ]+$/i.test(name)?name.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()):name;
  });
 }).filter(v=>!/^(?:und|unknown|unspecified|undetermined|undetermined language|unknown language)$/i.test(v)))];
}
function languageTracks(raw,kind){
 const sources=kind==="audio"?[raw.audioLanguages,raw.audioTracks,raw.language]:[raw.subtitles,raw.subtitleLanguages];
 const values=sources.flat().map(v=>typeof v==="string"&&!v.includes("://")?v:v?.lang||v?.language);
 const lines=[raw.description,raw.title].filter(Boolean).join("\n");
 const labels=/\b(audio(?:\s+languages?)?|languages?|subtitles?(?:\s+languages?)?|subs?)\s*[:=]\s*/gi;
 const matches=[...lines.matchAll(labels)];
 for(let i=0;i<matches.length;i++){
  const m=matches[i],audio=!/^sub/i.test(m[1]);
  if(audio!==(kind==="audio"))continue;
  const segment=lines.slice(m.index+m[0].length,matches[i+1]?.index).split(/[\r\n]/)[0];
  values.push(segment.replace(/[\s|;,·/–-]+$/g,""));
 }
 return streamLanguages(values);
}
function streamInfo(entry,index){
 const raw=entry.raw||{},url=directURL(raw),filename=String(raw.behaviorHints?.filename||"");
 const full=[raw.title,raw.description,filename].filter(v=>typeof v==="string"&&v.trim()).filter((v,i,a)=>a.indexOf(v)===i).join("\n")||String(raw.name||"");
 const text=[raw.name,full,raw.quality,raw.resolution].filter(Boolean).join(" ").replace(/_/g," ");
 const quality=streamQuality(text,raw.resolution),bytes=streamBytes(raw,text);
 const size=bytes?(bytes>=1e9?(bytes/1e9).toFixed(1)+" GB":(bytes/1e6).toFixed(0)+" MB"):"";
 const fields={provider:[entry.providerId||entry.provider],quality:[quality.tag],audio:languageTracks(raw,"audio"),
  subtitles:languageTracks(raw,"subtitles"),codec:[],range:[],release:[],sound:[],edition:[],cache:[],delivery:[],size:[],debrid:[],availability:[]};
 const tags=(field,pairs)=>{for(const [label,re] of pairs)if(re.test(text))fields[field].push(label)};
 tags("codec",[["HEVC",/\b(?:HEVC|H[. ]?265|x265)\b/i],["H.264",/\b(?:H[. ]?264|x264|AVC)\b/i],["AV1",/\bAV1\b/i],["VP9",/\bVP9\b/i]]);
 tags("range",[["Dolby Vision",/\b(?:Dolby[ .-]?Vision|DoVi|DV)\b/i],["HDR10+",/\bHDR10(?:\+|plus)/i],["HDR",/\bHDR(?:10)?\b/i],["SDR",/\bSDR\b/i]]);
 tags("sound",[["Atmos",/\bAtmos\b/i],["TrueHD",/\bTrueHD\b/i],["DTS",/\bDTS\b/i],["5.1",/\b5\.1\b/],["7.1",/\b7\.1\b/]]);
 tags("release",[["Remux",/\bRemux\b/i],["Blu-ray",/\b(?:blu[ .-]?ray|BDRip|BRRip)\b/i],["WEB-DL",/\bWEB[ .-]?DL\b/i],["WEBRip",/\bWEB[ .-]?Rip\b/i],["HDTV",/\bHDTV\b/i],["CAM",/\b(?:HDCAM|CAMRip|CAM)\b/i]]);
 tags("edition",[["Dual audio",/\bdual[ .-]+audio\b/i],["Multi audio",/\bmulti[ .-]+audio\b/i],["Dubbed",/\bdubbed\b/i]]);
 const service=String(raw.debridService||"")+" "+String(raw.name||"");
 for(const [label,pattern] of [["Real-Debrid",/\bReal[ .-]?Debrid\b|\bRD(?=\+|\])/i],["TorBox",/\bTorBox\b|\bTB(?=\+|\])/i],
  ["AllDebrid",/\bAll[ .-]?Debrid\b|\bAD(?=\+|\])/i],["Premiumize",/\bPremiumize\b|\bPM(?=\+|\])/i]])
  if(pattern.test(service))fields.debrid.push(label);
 if(url)fields.delivery.push("Direct link");
 if(raw.infoHash||/^magnet:\?/i.test(raw.url||""))fields.delivery.push("Torrent");
 if(raw.externalUrl)fields.delivery.push("External link");
 if(typeof raw.cached==="boolean")fields.cache.push(raw.cached?"Cached":"Uncached");
 else if(/\b(?:uncached|not cached|needs caching)\b/i.test(text))fields.cache.push("Uncached");
 else if(/\bcached\b|\[(?:RD|AD|PM|TB)\+\]/i.test(text))fields.cache.push("Cached");
 if(bytes)fields.size.push(bytes<1e9?"Under 1 GB":bytes<5e9?"1–5 GB":bytes<20e9?"5–20 GB":"20 GB or more");
 const seeded=text.match(/(?:👤\s*|\bseed(?:er)?s?\s*[:=]\s*)(\d[\d,]*)/i);
 const count=raw.seeders??(seeded&&seeded[1].replaceAll(",",""));
 const seeds=count!=null&&count!==""&&Number.isSafeInteger(Number(count))&&Number(count)>=0?Number(count):null;
 if(seeds!==null)fields.availability.push(seeds===0?"No reported seeds":seeds<10?"1–9 seeders":seeds<50?"10–49 seeders":"50+ seeders");
 const badges=[...fields.delivery,...fields.cache,...fields.debrid,...fields.release,...fields.codec,...fields.range,...fields.sound,...fields.edition,
  ...fields.audio.map(v=>"Audio · "+v),...fields.subtitles.map(v=>"Subs · "+v)];
 for(const [key] of streamFacets)if(!fields[key].length)fields[key]=["Unspecified"];
 const searchText=[entry.provider,text,...Object.values(fields).flat(),size].join(" ").toLowerCase();
 return {entry,index,url,quality,full,searchText,display:(filename||String(raw.title||raw.description||raw.name||"Stream "+(index+1)).split("\n")[0]).slice(0,150),
  size,bytes,seeds,fields,tags:badges};
}
const streamSortOptions=[["quality","Playable & best quality"],["small","Smallest file"],["large","Largest file"],["seeds","Most seeders"],["provider","Manifest name"],["original","Original order"]];
function facetSelect(key,label,counts,anyCount,providerNames){
 const selected=streamChoices[key];
 const values=[...counts.keys()];
 if(selected&&!counts.has(selected))values.push(selected);
 const name=v=>key==="provider"?(providerNames.get(v)||v):v;
 const ranks={"8K":6,"4K":5,"1440p":4,"1080p":3,"720p":2,"SD":1};
 values.sort((a,b)=>Number(a==="Unspecified")-Number(b==="Unspecified")||
  (key==="quality"?(ranks[b]||0)-(ranks[a]||0):0)||name(a).localeCompare(name(b)));
 const id=key==="provider"?"streamProvider":"stream-"+key;
 return '<label'+(selected?' class="streamFacetActive"':'')+'>'+label+'<select id="'+id+'" data-stream-facet="'+key+'"><option value="">Any ('+anyCount+')</option>'+
  values.map(v=>'<option value="'+safe(v)+'"'+(selected===v?' selected':'')+'>'+safe(name(v))+' ('+(counts.get(v)||0)+')</option>').join("")+'</select></label>';
}
function matchingStreams(infos){
 const results=[],selected=Object.entries(streamChoices);
 const counts=Object.fromEntries(streamFacets.map(([k])=>[k,new Map()]));
 const totals=Object.fromEntries(streamFacets.map(([k])=>[k,0]));
 const terms=streamQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
 for(const info of infos){
  if(!terms.every(term=>info.searchText.includes(term)))continue;
  const misses=selected.filter(([k,v])=>!info.fields[k].includes(v));
  if(misses.length>1)continue;
  if(!misses.length)results.push(info);
  for(const [key] of (misses.length?misses:streamFacets)){
   totals[key]++;
   for(const value of info.fields[key])counts[key].set(value,(counts[key].get(value)||0)+1);
  }
 }
 return {results,counts,totals};
}
function presetStorageKey(){
 return typeof profileStorageKey==="function"?profileStorageKey("streamFilterPresets"):"luma.v2.streamFilterPresets";
}
function readPresets(){
 try{
  const saved=JSON.parse(localStorage.getItem(presetStorageKey())||"[]");
  if(!Array.isArray(saved))return [];
  return saved.filter(p=>typeof p?.name==="string"&&p.name.trim()&&p.filters&&typeof p.filters==="object").map(p=>({
   name:p.name,
   filters:Object.fromEntries(streamFacets.filter(([k])=>Object.hasOwn(p.filters,k)&&typeof p.filters[k]==="string"&&p.filters[k]).map(([k])=>[k,p.filters[k]])),
   sort:streamSortOptions.some(([k])=>k===p.sort)?p.sort:"quality"
  }));
 }catch{return []}
}
function writePresets(presets){
 try{localStorage.setItem(presetStorageKey(),JSON.stringify(presets));return true}
 catch{toast("This device could not save the preset.");return false}
}
function presetList(presets){
 return presets.map((p,i)=>{
  const current=p.sort===streamSort&&streamFacets.every(([k])=>p.filters[k]===streamChoices[k]);
  return '<span class="streamPresetChip"><button type="button" data-preset-apply="'+i+'" aria-pressed="'+current+'">'+safe(p.name)+'</button>'
   +'<button type="button" data-preset-remove="'+i+'" aria-label="Remove preset '+safe(p.name)+'">×</button></span>';
 }).join("");
}
function playerPreference(){try{return localStorage.getItem("luma.player.preference")||""}catch{return""}}
function cleanStreamResults(entries,seen=new Set()){
 return entries.filter(row=>{
  const src=directURL(row.raw);
  if(!src)return true;
  const key=JSON.stringify([row.providerId||row.provider,row.raw]);
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
}
let indexedStreams=null,indexedCount=0,indexedInfos=[],indexedKeys=new Set();
function showStreams(message=""){
 streamLastMessage=message;
 if(indexedStreams!==streams){
  indexedStreams=streams;indexedCount=0;indexedInfos=[];indexedKeys=new Set();
 }
 if(indexedCount<streams.length){
  const added=streams.slice(indexedCount).map((entry,i)=>({...entry,_originalIndex:indexedCount+i}));
  for(const row of cleanStreamResults(added,indexedKeys))indexedInfos.push(streamInfo(row,row._originalIndex));
  indexedCount=streams.length;
 }
 const infos=indexedInfos;
 const playable=infos.filter(s=>s.url).length,providers=new Map();
 for(const v of infos)providers.set(v.fields.provider[0],v.entry.provider);
 const names=[...providers.values()];
 for(const [id,name] of providers)if(names.indexOf(name)!==names.lastIndexOf(name))providers.set(id,name+" · "+id);
 const selected=Object.keys(streamChoices),{results,counts,totals}=matchingStreams(infos);
 results.sort((a,b)=>{
  if(streamSort==="provider")return a.entry.provider.localeCompare(b.entry.provider)||b.quality.order-a.quality.order;
  if(streamSort==="original")return a.index-b.index;
  if(streamSort==="seeds")return (b.seeds??-1)-(a.seeds??-1);
  if(streamSort==="small"||streamSort==="large"){
   if(!a.bytes||!b.bytes)return Number(!a.bytes)-Number(!b.bytes);
   return streamSort==="small"?a.bytes-b.bytes:b.bytes-a.bytes;
  }
  return Number(!!b.url)-Number(!!a.url)||b.quality.order-a.quality.order||a.entry.provider.localeCompare(b.entry.provider);
 });
 const perPage=10,totalPages=Math.max(1,Math.ceil(results.length/perPage));
 streamPage=Math.min(Math.max(0,streamPage),totalPages-1);
 const shown=results.slice(streamPage*perPage,(streamPage+1)*perPage);
 const name=detail?.title||"Title",poster=String(detail?.poster||"");
 const seasonInfo=episode&&(episode.season||episode.season_number)
   ?' · S'+String(episode.season||episode.season_number).padStart(2,"0")+'E'+String(episode.episode||episode.episode_number||1).padStart(2,"0"):"";
 let html='<div class="pad streamResults lumaStreamResults" data-stream-request="'+streamRequestToken+'">'
  +'<div class="streamResultsTop"><div class="streamTitleBlock">'
  +(poster&&/^https:\/\//i.test(poster)?'<img class="streamTitlePoster" src="'+safe(poster)+'" alt="" loading="lazy" onerror="this.remove()">':"")
  +'<div><div class="eyebrow">PLAYBACK OPTIONS</div><h2>'+safe(name)+'</h2>'
  +(seasonInfo?'<p class="streamEpisodeLabel">Selected episode'+seasonInfo+'</p>':"")
  +'<p class="streamCount">'+infos.length+' source'+(infos.length===1?"":"s")+' · '+playable+' direct link'+(playable===1?"":"s")+' · '+providers.size+' provider'+(providers.size===1?"":"s")+'</p></div></div></div>';
 html+='<div class="streamManifestStatus" aria-live="polite">';
 if(pendingProviders.size)html+='<p class="streamPending">Checking '+[...pendingProviders.values()].map(safe).join(", ")+'…</p>';
 if(streamFailures.length)html+='<details class="streamWarnings"><summary>'+streamFailures.length+' add-on'+(streamFailures.length===1?"":"s")+' unavailable · Other results remain usable</summary>'
  +'<div class="streamWarningItems">'+streamFailures.map(v=>'<p><b>'+safe(v.provider)+'</b><span>'+safe(v.reason)+'</span></p>').join("")+'</div></details>';
 if(message)html+='<p class="streamInlineMessage">'+safe(message)+'</p>';
 html+='</div>';
 const selectFacet=([key,label])=>facetSelect(key,label,counts[key],totals[key],providers);
 const presets=readPresets();
 const hiddenCount=streamFacets.slice(2).filter(([key])=>streamChoices[key]).length;
 html+='<section class="streamFilters" aria-label="Stream filters"><div class="streamFilterHeading"><h3>Filter streams</h3><button type="button" id="streamReset" '+(!selected.length&&!streamQuery&&streamSort==="quality"?"disabled":"")+'>Reset</button></div>'
  +'<label class="streamQueryLabel">Search releases<input id="streamQuery" type="search" value="'+safe(streamQuery)+'" placeholder="Filename, provider or release tag" autocomplete="off"></label>'
  +'<div class="streamFacetGrid">'+streamFacets.slice(0,2).map(selectFacet).join("")+'<label>Sort by<select id="streamSort">'+streamSortOptions.map(([v,t])=>'<option value="'+v+'"'+(streamSort===v?' selected':'')+'>'+t+'</option>').join("")+'</select></label></div>'
  +'<details id="streamMoreFilters"'+(extraFiltersOpen?" open":"")+'><summary>More filters'+(hiddenCount?' · '+hiddenCount+' active':'')+'</summary><div class="streamFacetGrid">'+streamFacets.slice(2).map(selectFacet).join("")+'</div></details></section>';
 html+='<section class="streamPresets" aria-label="Filter presets"><div class="streamPresetTop"><h3>Presets</h3><button type="button" id="streamSavePreset"'+(!selected.length&&streamSort==="quality"?' disabled':'')+'>Save preset</button></div>'
  +'<div class="streamPresetList">'+presetList(presets)+'</div><form id="streamPresetForm" hidden><label>Preset name<input name="presetName" maxlength="48" required autocomplete="off"></label><button class="secondary" type="submit">Save</button><button class="secondary" type="button" id="streamPresetCancel">Cancel</button></form></section>';
 html+='<div class="streamOutput">';
 if(shown.length)html+='<p class="streamPageStatus" role="status">Showing '+(streamPage*perPage+1)+'–'+Math.min((streamPage+1)*perPage,results.length)+' of '+results.length+'</p>'
  +'<div class="addonStreamList">'+shown.map(v=>{
   const tags=[v.size,v.seeds!==null?v.seeds+" seeders":"",...v.tags].filter(Boolean);
   return '<article class="addonStream streamCompact"><div class="streamBody">'
    +'<div class="streamCardHead"><strong class="streamDisplayName">'+safe(v.display)+'</strong><span class="streamQualityBadge">'+safe(v.quality.tag)+'</span></div>'
    +'<div class="streamMeta"><span class="streamProvider">'+safe(v.entry.provider)+'</span>'
    +tags.map(t=>'<span class="streamTag">'+safe(t)+'</span>').join("")+'</div>'
    +(v.full!==v.display?'<details class="streamTechnical"><summary>View technical release information</summary><p>'+safe(v.full.slice(0,300))+'</p></details>':"")
    +'</div><div class="streamActions">'+(v.url?'<button type="button" class="primary streamPlay" data-source="'+v.index+'" aria-label="Choose a player for '+safe(v.display)+'">▶ '+(playerPreference()?"Play":"Choose player")+'</button>'
     :'<span class="streamUnavailable">No direct URL supplied</span>')+'</div></article>';
  }).join("")+'</div>';
 else if(infos.length)html+='<div class="streamNoMatch" role="status"><strong>'+ (pendingProviders.size?'No matches from providers checked so far':'No matching streams')+'</strong><button class="secondary" id="streamClearFilters">Clear filters</button></div>';
 if(totalPages>1)html+='<nav class="streamPager" aria-label="Stream result pages"><button class="secondary" id="streamPrev" '+(streamPage===0?"disabled":"")+'>← Previous</button><span>Page '+(streamPage+1)+' of '+totalPages+'</span><button class="secondary" id="streamNext" '+(streamPage===totalPages-1?"disabled":"")+'>Next →</button></nav>';
 html+='</div><div class="streamFooter"><button class="secondary" id="streamChangePlayer">Change preferred player</button><button class="secondary" id="backStreamDetail">← Back to title</button>'
  +'<p class="micro">Release details, cache status and seeder counts come from your manifest providers. Playback requires a direct link.</p></div></div>';
 const current=$('.lumaStreamResults[data-stream-request="'+streamRequestToken+'"]');
 if(current?.matches?.(".lumaStreamResults")){
  const next=document.createElement("template");next.innerHTML=html;
  const update=selector=>{
   const before=current.querySelector(selector),after=next.content.querySelector(selector);
   if(before.innerHTML!==after.innerHTML)before.innerHTML=after.innerHTML;
  };
  for(const selector of [".streamCount",".streamManifestStatus","#streamMoreFilters summary",".streamPresetList",".streamOutput"])update(selector);
  for(const select of current.querySelectorAll("[data-stream-facet],#streamSort")){
   const replacement=next.content.querySelector("#"+select.id);
   if(select.innerHTML!==replacement.innerHTML)select.replaceChildren(...replacement.childNodes);
   select.value=streamChoices[select.dataset.streamFacet]||(select.id==="streamSort"?streamSort:"");
   select.parentElement.className=replacement.parentElement.className;
  }
  for(const id of ["streamReset","streamSavePreset"])$("#"+id).disabled=next.content.querySelector("#"+id).disabled;
  if($("#streamQuery").value!==streamQuery)$("#streamQuery").value=streamQuery;
 }else modal(html);
 const updateFilters=event=>{
  const control=event.target;
  extraFiltersOpen=$("#streamMoreFilters").open;
  if(control.id==="streamSort")streamSort=control.value;
  else if(control.value)streamChoices[control.dataset.streamFacet]=control.value;
  else delete streamChoices[control.dataset.streamFacet];
  streamPage=0;showStreams(streamLastMessage);
  $("#"+control.id)?.focus?.({preventScroll:true});
 };
 $("#streamMoreFilters").ontoggle=e=>{if(e.target.isConnected)extraFiltersOpen=e.target.open};
 $$("[data-stream-facet]").forEach(input=>input.onchange=updateFilters);
 $("#streamSort").onchange=updateFilters;
 $("#streamQuery").oninput=e=>{streamQuery=e.target.value;streamPage=0;showStreams(streamLastMessage)};
 const form=$("#streamPresetForm");
 $("#streamSavePreset").onclick=()=>{form.hidden=false;form.elements.presetName.focus()};
 $("#streamPresetCancel").onclick=()=>{form.hidden=true;form.reset();$("#streamSavePreset").focus()};
 form.onsubmit=e=>{
  e.preventDefault();
  const name=form.elements.presetName.value.trim();
  if(!name){form.elements.presetName.focus();return}
  const latest=readPresets(),saved={name,filters:{...streamChoices},sort:streamSort};
  const index=latest.findIndex(p=>p.name.toLowerCase()===name.toLowerCase());
  if(index<0)latest.push(saved);else latest[index]=saved;
  if(writePresets(latest)){form.reset();form.hidden=true;showStreams(streamLastMessage);toast("Preset saved")}
 };
 $$("[data-preset-apply]").forEach(b=>b.onclick=()=>{
  const p=presets[Number(b.dataset.presetApply)];if(!p)return;
  streamChoices={...p.filters};streamSort=p.sort;streamPage=0;showStreams(streamLastMessage);
 });
 $$("[data-preset-remove]").forEach(b=>b.onclick=()=>{
  const name=presets[Number(b.dataset.presetRemove)]?.name;
  if(writePresets(readPresets().filter(p=>p.name!==name)))showStreams(streamLastMessage);
 });
 const resetFilters=()=>{streamChoices={};streamSort="quality";streamQuery="";streamPage=0;showStreams(streamLastMessage);$("#streamProvider")?.focus?.({preventScroll:true})};
 $("#streamReset").onclick=resetFilters;
 if($("#streamClearFilters"))$("#streamClearFilters").onclick=resetFilters;
 $("#backStreamDetail").onclick=returnFromStreams||showDetail;
 $("#streamChangePlayer").onclick=()=>{try{localStorage.removeItem("luma.player.preference")}catch{}showStreams(streamLastMessage)};
 if($("#streamPrev"))$("#streamPrev").onclick=()=>{streamPage--;showStreams(streamLastMessage)};
 if($("#streamNext"))$("#streamNext").onclick=()=>{streamPage++;showStreams(streamLastMessage)};
 $$("[data-source]").forEach(b=>b.onclick=()=>{
  const i=Number(b.dataset.source);
  if(!playerPreference())return playerPicker(i,name);
  const entry=streams[i],url=entry&&directURL(entry.raw);if(!url)return playerPicker(i,name);
  const pref=playerPreference(),ep=episode;
  if(pref==="browser"||!["infuse","vidhub"].includes(pref))return playerPicker(i,name);
  const key="stremio:"+(ep?.id||detail.stremioID),position=state.progress[key]?.seconds||0;
  handoff(pref,url,playerFilename(entry,name,ep),position,subtitleURL(entry.raw));
 });
}

function playerFilename(stream,name,ep){
 const movie=detail||{},base=String(movie.title||name||"Video").replace(/\s*\((?:19|20)\d{2}\)\s*$/,"").replace(/[<>:"/\\|?*\u0000-\u001f]/g," ").replace(/\s+/g," ").trim().slice(0,110)||"Video";
 const year=String(movie.year||state.selected?.year||"").match(/\b(?:19|20)\d{2}\b/)?.[0]||String(name||"").match(/\b(?:19|20)\d{2}\b/)?.[0]||"";
 const sourceName=stream?.raw?.behaviorHints?.filename||"";
 const pathExtension=(()=>{try{return new URL(stream?.raw?.url||"").pathname.match(/\.(mp4|mkv|mov|m4v|avi|ts|m3u8|webm)$/i)?.[1]}catch{return""}})();
 const extension=(String(sourceName).match(/\.(mp4|mkv|mov|m4v|avi|ts|m3u8|webm)$/i)?.[1]||pathExtension||"mp4").toLowerCase();
 const cleanId=String(movie.stremioID||"").match(/^(tt\d{5,12}|tmdb:\d+)/)?.[0]||"";
 const idTag=cleanId.startsWith("tt")?" {imdb-"+cleanId+"}":cleanId.startsWith("tmdb:")?" {tmdb-"+cleanId.slice(5)+"}":"";
 const suffix=ep?" S"+String(ep.season||ep.season_number||1).padStart(2,"0")+"E"+String(ep.episode||ep.episode_number||1).padStart(2,"0"):"";
 return (base+(year?" ("+year+")":"")+idTag+suffix+"."+extension).slice(0,235);
}
function subtitleURL(raw,language=streamChoices.subtitles){
 const list=Array.isArray(raw?.subtitles)?raw.subtitles:[];
 for(const track of list){
  if(language&&language!=="Unspecified"&&!streamLanguages([track?.lang||track?.language]).includes(language))continue;
  const address=typeof track==="string"?track:track?.url;
  if(typeof address!=="string")continue;
  try{const url=new URL(address);if(["https:","http:"].includes(url.protocol))return url.href}catch{}
 }
 return "";
}
function playerPicker(index,name){
 const s=streams[index];if(!s)return;const url=directURL(s.raw);if(!url)return;const ep=episode;
 const filename=playerFilename(s,name,ep),sub=subtitleURL(s.raw);
 const key="stremio:"+(ep?.id||detail.stremioID),position=state.progress[key]?.seconds||0;
 const remembered=(()=>{try{return localStorage.getItem("luma.player.preference")||""}catch{return""}})();
 modal('<div class="pad"><div class="eyebrow">READY TO PLAY</div><h2>'+safe(name)+'</h2><p>Source: '+safe(s.provider)+'</p><div class="playerFilenamePreview">Metadata filename: <b>'+safe(filename)+'</b></div><div class="playerChoices"><button class="playerChoice" id="extInfuse"><b>▶ Infuse</b><span>Open in Infuse on Apple devices</span></button><button class="playerChoice" id="extVidHub"><b>▶ VidHub</b><span>Open in VidHub on supported devices</span></button><button class="playerChoice" id="extBrowser"><b>▶ Luma Player</b><span>Try native browser playback</span></button><button class="playerChoice" id="extShare"><b>↗ Other player</b><span>Open the device share sheet with the video link</span></button><button class="playerChoice" id="extCopy"><b>⧉ Copy source URL</b><span>Copy the direct media link</span></button></div><p class="micro">Title, year, IMDb/TMDB ID and episode number are placed in the filename for supported player metadata matching. Playback speed is controlled by the stream host, format and receiving player.</p><button class="secondary" id="backStreamList">← Back to sources</button></div>');
 const savePlayer=p=>{try{localStorage.setItem("luma.player.preference",p)}catch{}};
 $("#extInfuse").onclick=()=>{savePlayer("infuse");handoff("infuse",url,filename,position,sub)};
 $("#extVidHub").onclick=()=>{savePlayer("vidhub");handoff("vidhub",url,filename,position,sub)};
 $("#extBrowser").onclick=()=>{savePlayer("browser");const x={id:key,title:name,type:"Movie",url};closeModal();play(x,null,url);try{if("mediaSession"in navigator)navigator.mediaSession.metadata=new MediaMetadata({title:detail?.title||name,artist:detail?.stremioType==="series"?"TV series":"Movie",album:ep?"Season "+(ep.season||1)+", Episode "+(ep.episode||1):String(detail?.year||""),artwork:detail?.poster?[{src:detail.poster}]:[]})}catch{}};
 $("#extShare").onclick=async()=>{try{if(typeof navigator.share==="function")await navigator.share({title:filename,text:filename,url});else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);toast("Link copied. Paste it into your player.")}else prompt("Copy this URL into your player:",url)}catch(e){if(e?.name!=="AbortError")toast("This player cannot accept a shared video from Safari.")}};$("#extCopy").onclick=()=>{navigator.clipboard?.writeText(url).then(()=>toast("Copied source URL")).catch(()=>prompt("Copy this source URL:",url))};
 $("#backStreamList").onclick=()=>showStreams(streamLastMessage);
}
function handoff(target,url,filename,position,sub){
 if(!["infuse","vidhub"].includes(target))return;
 const p=new URLSearchParams();p.set("url",url);p.set("filename",filename);p.set("position",String(Math.max(0,Math.floor(Number(position)||0))));
 if(sub)p.set("sub",sub);
 if(target==="vidhub")p.set("x-source","Luma");
 const scheme=target==="infuse"?"infuse://x-callback-url/play?":"open-vidhub://x-callback-url/play?";
 // Send the original signed URL untouched as a URLSearchParams-encoded value. No preflight, rewriting or URL shorteners.
 const a=document.createElement("a");a.href=scheme+p.toString();a.style.display="none";document.body.appendChild(a);a.click();a.remove();
}
function open(){state.tab="Add-ons";mode="manage";render()}
const imdbCache=(()=>{try{return JSON.parse(localStorage.getItem("luma.imdb.ids.v1")||"{}")}catch{return {}}})();
function cleanMediaName(s){return String(s||"").replace(/\s*\((?:19|20)\d{2}\)\s*$/,"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function checkIMDb(v){return /^tt\d{5,12}$/.test(String(v||""))}
function launchMatch(x,imdb,ep,back){detail={id:x.id,type:x.type,title:x.title,overview:x.overview||"",poster:x.poster||"",backdrop:x.backdrop||"",provider:"Luma metadata",year:x.year||"",poster:x.poster||"",stremioType:x.type==="Movie"?"movie":"series",stremioID:imdb,addonID:"luma",videos:[]};const chosen=ep?{id:imdb+":"+ep.season_number+":"+ep.episode_number,season:ep.season_number,episode:ep.episode_number}:null;episode=chosen;return getStreams(chosen,back)}
function askForId(x,ep,reason,choices,back){
  const validChoices=choices.filter(m=>checkIMDb(m.id)).slice(0,10);
  const choiceUI=validChoices.length?'<div class="matchChoices"><p class="micro">Choose the correct release from these metadata results:</p>'+validChoices.map((m,i)=>'<button class="matchChoice" data-match="'+i+'"><span class="matchMovie">'+safe(m.name||m.title||x.title)+'</span><span>'+safe(m.releaseInfo||m.year||"Year unknown")+'</span><span class="matchArrow">Select ›</span></button>').join("")+'</div>':'';
  modal('<div class="pad matchPanel"><div class="eyebrow">MATCH MOVIE</div><h2>'+safe(x.title)+'</h2>'+(choiceUI||'<p>We could not verify the correct movie automatically. Add an IMDb title ID only if you know it.</p>')+(reason?'<p class="micro">'+safe(reason)+'</p>':'')+'<details class="manualMatch"><summary>Enter IMDb ID manually</summary><form id="manualIMDB"><label>IMDb title ID<input type="text" name="imdb" pattern="tt[0-9]{5,12}" autocomplete="off" placeholder="tt1234567" required></label><button class="primary" type="submit">Find Streams</button></form></details><button class="secondary" type="button" id="backFromMatch">Back to Details</button></div>');
  const proceed=id=>{imdbCache[x.id]=id;try{localStorage.setItem("luma.imdb.ids.v1",JSON.stringify(imdbCache))}catch{}launchMatch(x,id,ep,back)};
  $$("[data-match]").forEach(b=>b.onclick=()=>{const candidate=validChoices[Number(b.dataset.match)];if(candidate)proceed(candidate.id)});
  const form=$("#manualIMDB");if(form)form.onsubmit=e=>{e.preventDefault();const id=String(e.target.elements.imdb.value).trim();if(!checkIMDb(id))return toast("Enter a valid IMDb ID.");proceed(id)};
  $("#backFromMatch").onclick=back||closeModal;
}
async function lookupTitle(x,imdb,ep,back=captureStreamOrigin()){
  const known=[imdb,x.imdbId,imdbCache[x.id],state.details?.external_ids?.imdb_id,state.details?.imdb_id].find(checkIMDb);
  if(known)return launchMatch(x,known,ep,back);
  const type=x.type==="Movie"?"movie":"series",year=parseInt(x.year,10)||null;
  modal('<div class="pad"><h2>Finding the correct title…</h2><p>Checking metadata IDs for '+safe(x.title)+'.</p></div>');
  try{
    const title=String(x.title).replace(/\s*\((?:19|20)\d{2}\)\s*$/,"").trim();
    const endpoint="https://v3-cinemeta.strem.io/catalog/"+type+"/top/search="+encodeURIComponent(title)+".json";
    const response=await fetchJSON(endpoint);
    const candidates=(Array.isArray(response.metas)?response.metas:[]).filter(m=>checkIMDb(m.id)&&cleanMediaName(m.name||m.title)===cleanMediaName(title));
    const exact=candidates.filter(m=>{const y=parseInt(String(m.releaseInfo||m.year||m.released||"").match(/(?:19|20)\d{2}/)?.[0],10);return year&&Number.isFinite(y)&&Math.abs(y-year)<=1});
    const chosen=exact.length===1?exact[0]:(!year&&candidates.length===1?candidates[0]:null);
    if(chosen){imdbCache[x.id]=chosen.id;try{localStorage.setItem("luma.imdb.ids.v1",JSON.stringify(imdbCache))}catch{}return launchMatch(x,chosen.id,ep,back)}
    if(x.tmdbId){const tmdbId="tmdb:"+x.tmdbId;const epID=ep?tmdbId+":"+ep.season_number+":"+ep.episode_number:tmdbId;const matches=active().filter(a=>supports(a,"stream",type,epID)&&a.manifest.idPrefixes?.some(p=>p.startsWith("tmdb")||p==="tmdb:"));if(matches.length===active().filter(a=>supports(a,"stream",type,epID)).length&&matches.length)return launchMatch(x,tmdbId,ep,back)}
    askForId(x,ep,candidates.length?"Select the matching release year so Luma can use the correct stream ID.":"No matching title found in the add-on metadata catalog.",candidates,back)
  }catch(err){askForId(x,ep,"Automatic lookup was unavailable ("+String(err.message||err).replace(/https?:\/\/\S+/g,"service").slice(0,110)+").",[],back)}
}
function attachPlayerButtons(){const video=$("#video");if(!video)return;const url=video.currentSrc||video.src;if(!url||!/^https?:/.test(url))return;const controls=video.parentElement.querySelector(".actions");if(!controls||controls.querySelector("[data-external]"))return;const pair=[["infuse","Open in Infuse"],["vidhub","Open in VidHub"]];for(const [id,label]of pair){const b=document.createElement("button");b.className="secondary";b.dataset.external=id;b.textContent=label;b.onclick=()=>handoff(id,url,document.querySelector(".playerWrap h2")?.textContent||"Luma Video",video.currentTime||0);controls.appendChild(b)}}
return {open,render,attachPlayerButtons,lookupTitle,installed:()=>list.length};
})();
