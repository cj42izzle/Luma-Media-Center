
"use strict";
/* Browser-only Luma add-on client using compatible third-party manifests. Nothing is proxied; private credentials stay on this device. */
const LumaAddons=(()=>{
let list=read(),catalog=[],mode="manage",notice="",loading=false,term="",detail=null,episode=null,streams=[],selectedStream=null,streamFailures=[],streamChecks=0;
let catalogFeeds=[],pendingFeeds=[],catalogToken=0,moreLoading=false,addonPage=0,feedCursor=0,localTerm="",addonType="all",addonProvider="all",addonGenre="all",addonSort="featured",addonCatalog="all",remoteGenre="";
let unsupportedCatalogs=0;
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
async function fetchJSON(url){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
 try{
  const res=await fetch(url,{mode:"cors",credentials:"omit",signal:c.signal,redirect:"follow",headers:{"Accept":"application/json"}});
  if(res.redirected){
    const target=new URL(res.url);
    if(target.protocol!=="https:"||!target.hostname||target.username||target.password||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(target.hostname)||target.hostname.endsWith(".local"))throw Error("Add-on redirected to an unsupported address.");
  }
  if(!res.ok)throw Error("HTTP "+res.status+(res.status===404?" (resource missing)":res.status===401||res.status===403?" (authorization required)":res.status===429?" (rate limited)":""));
  const body=await res.text();
  if(body.length>1500000)throw Error("Add-on response exceeds 1.5 MB.");
  try{return JSON.parse(body)}catch{throw Error("Add-on returned invalid JSON, not a compatible resource.")}
 }catch(e){
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
function item(m,a,t,catalogInfo=null){if(!m||typeof m.id!=="string")return null;const id="addon:"+a.manifest.id+":"+t+":"+m.id;return {id,title:String(m.name||m.title||"Untitled"),type:t==="series"?"Series":t==="movie"?"Movie":t==="anime"?"Anime":t,stremioID:m.id,stremioType:t,addonID:a.manifest.id,provider:a.manifest.name,catalogID:catalogInfo?.id||"",catalogName:catalogInfo?.name||"",overview:m.description||"",poster:m.poster&&/^https:\/\//i.test(m.poster)?m.poster:"",backdrop:m.background&&/^https:\/\//i.test(m.background)?m.background:"",year:m.releaseInfo||m.year||"",genreNames:Array.isArray(m.genres)?m.genres.filter(x=>typeof x==="string").slice(0,12):[],source:"stremio"}}
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
 if(pageItems.length)html+='<div class="tiles collectionGrid">'+pageItems.map(x=>'<button class="media" data-addon-open="'+safe(x.id)+'"><div class="art" style="--c1:#43376a"><div class="posterText">'+safe(x.title)+'</div>'+(x.poster?'<img loading="lazy" src="'+safe(x.poster)+'" alt="" onerror="this.remove()">':'')+'</div><div class="iteminfo"><b>'+safe(x.title)+'</b><small>'+safe(x.type)+' · '+safe(x.provider)+(x.year?' · '+safe(x.year):'')+'</small></div></button>').join("")+'</div>';
 else if(!loading)html+='<div class="empty">No matching titles. Try another filter, search supported feeds, or install a catalog add-on.</div>';
 if(pages>1)html+='<nav class="collectionPager" aria-label="Catalog results pages"><button class="secondary" id="addonPrev" '+(addonPage===0?'disabled':'')+'>← Previous</button><span>Page '+(addonPage+1)+' of '+pages+'</span><button class="secondary" id="addonNext" '+(addonPage===pages-1?'disabled':'')+'>Next →</button></nav>';
 if(more)html+='<div class="collectionLoad"><button class="primary" id="addonMore" '+(moreLoading||loading?'disabled':'')+'>'+(moreLoading?'Loading more…':'Load later pages')+'</button><span class="micro">Only supported on feeds advertising skip pagination.</span></div>';
 if(pendingFeeds.length)html+='<div class="collectionLoad"><button class="secondary" id="addonMoreFeeds" '+(moreLoading||loading?'disabled':'')+'>Load next catalogs ('+pendingFeeds.length+' remaining)</button></div>';
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
 if($("#addonPrev"))$("#addonPrev").onclick=()=>{addonPage--;render()};
 if($("#addonNext"))$("#addonNext").onclick=()=>{addonPage++;render()};
 if($("#addonMore"))$("#addonMore").onclick=loadMoreCatalogs;
 if($("#addonMoreFeeds"))$("#addonMoreFeeds").onclick=loadNextCatalogFeeds;
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
async function fetchFeedPages(feeds,token){
 const outcomes=[];
 for(let i=0;i<feeds.length;i+=6){
   if(token!==catalogToken)break;
   const chunk=await Promise.allSettled(feeds.slice(i,i+6).map(async feed=>{
     const extra={};if(feed.search)extra.search=feed.search;
     if(feed.genre)extra.genre=feed.genre;
     if(feed.skip)extra.skip=feed.skip;
     const data=await fetchJSON(endpoint(feed.a,"catalog",feed.c.type,feed.c.id,extra));
     if(!Array.isArray(data?.metas))throw Error("Invalid catalog response.");
     return {feed,metas:data.metas.slice(0,100)};
   }));
   outcomes.push(...chunk.map((result,j)=>({...result,feed:feeds[i+j]})));
 }
 return outcomes;
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

function render(){const target=$("#content");if(!target)return;bindNavigation();const count=list.length;let html='<section class="addonsHero"><div class="eyebrow">LUMA ADD-ONS</div><h2>One home for your favorite add-ons</h2><p>Add multiple Luma-compatible manifests, manage each source independently, discover its catalogs and select compatible streams in a cinematic library.</p><div class="addonTabs"><button class="secondary '+(mode==="manage"?"selected":"")+'" id="addonManage">Manage ('+count+')</button><button class="secondary '+(mode==="browse"?"selected":"")+'" id="addonBrowse">Browse add-on titles</button></div></section>';if(mode==="manage"){html+='<section class="settingCard addonInstall"><h2>Install a Luma add-on</h2><form id="addonForm"><label for="addonURL">Manifest URL</label><div class="addonInputRow"><input id="addonURL" type="url" required spellcheck="false" placeholder="https://example.org/manifest.json"><button class="primary" '+(loading?"disabled":"")+' type="submit">Install</button></div></form><details class="bulkAdd"><summary>Install multiple manifest URLs at once</summary><label for="bulkURL">One manifest.json URL per line</label><textarea id="bulkURL" rows="5" placeholder="https://addon-one.example/manifest.json&#10;https://addon-two.example/manifest.json"></textarea><button class="secondary" type="button" id="bulkInstall">Install URL list</button><p class="micro">Imports up to 25 URLs in one batch; you can repeat for more. Each add-on is checked independently.</p></details><p class="micro">Add as many supported add-ons as you want. Use HTTPS. Only install add-ons you trust; some configured manifest links contain personal tokens, which remain in your browser storage.</p></section><section class="shelf"><div class="shelfhead"><h2>Installed add-ons</h2><span>'+active().length+' enabled · '+count+' total</span></div>'+(count?'<div class="addonList">'+list.map((a,i)=>'<div class="addonItem"><div class="addonAvatar">'+safe(a.manifest.name.charAt(0).toUpperCase())+'</div><div class="addonDescription"><b>'+safe(a.manifest.name)+'</b><span>v'+safe(a.manifest.version)+' · '+safe(a.manifest.types.join(", "))+'</span><p>'+safe(a.manifest.description)+'</p><small>'+a.manifest.catalogs.length+' catalog'+(a.manifest.catalogs.length===1?'':'s')+' · '+(a.manifest.resources.some(r=>(typeof r==="string"?r:r.name)==="stream")?'Stream source':'Catalog / metadata only')+'</small></div><div class="addonControls"><label><input type="checkbox" data-toggle="'+i+'" '+(a.enabled?"checked":"")+'> Enabled</label><button class="secondary small" data-test="'+i+'">Check</button><button class="secondary small" data-refresh-manifest="'+i+'">Refresh</button><button class="secondary small" data-remove="'+i+'">Remove</button></div></div>').join("")+'</div>':'<div class="empty">No add-ons installed yet. Add your first manifest above.</div>')+'</section>'}else{html+=catalogBrowseMarkup()}if(notice)html='<div class="notice">'+safe(notice)+'</div>'+html;target.innerHTML=html;$("#addonManage").onclick=()=>{mode="manage";notice="";render()};$("#addonBrowse").onclick=()=>{mode="browse";notice="";if(!catalog.length)refreshCatalogs();else render()};if($("#addonForm"))$("#addonForm").onsubmit=async e=>{e.preventDefault();const url=e.target.elements.addonURL.value;loading=true;notice="Connecting to manifest…";render();try{const m=await install(url);notice="Installed "+m.name+". You can install another manifest."}catch(err){notice=err.message}finally{loading=false;render()}};if($("#bulkInstall"))$("#bulkInstall").onclick=async()=>{const text=$("#bulkURL").value;const urls=[...new Set(text.split(/[\r\n]+/).map(x=>x.trim()).filter(Boolean))].slice(0,25);if(!urls.length){notice="Paste at least one URL.";render();return}loading=true;notice="Installing "+urls.length+" add-ons…";render();let successes=[],failures=[];for(const url of urls){try{const m=await install(url);successes.push(m.name)}catch(e){failures.push("Entry "+(successes.length+failures.length+1)+": "+String(e.message||e))}}notice="Installed "+successes.length+" of "+urls.length+" add-ons."+(failures.length?" "+failures.slice(0,4).join("; ")+(failures.length>4?" and "+(failures.length-4)+" more errors.":""):"");loading=false;render()};$$("[data-toggle]").forEach(b=>b.onchange=()=>{list[Number(b.dataset.toggle)].enabled=b.checked;saveAddons();render()});$$("[data-remove]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.remove);if(confirm("Remove "+list[i].manifest.name+"?")){list.splice(i,1);saveAddons();render()}});$$("[data-test]").forEach(b=>b.onclick=async()=>{const a=list[Number(b.dataset.test)];notice="Checking "+a.manifest.name+"…";render();try{const m=validateManifest(await fetchJSON(a.url));notice="Manifest online: "+m.name+" ("+m.version+"). This checks the manifest, not every stream endpoint."}catch(err){notice=err.message}render()});$$("[data-refresh-manifest]").forEach(b=>b.onclick=async()=>{const index=Number(b.dataset.refreshManifest),add=list[index];if(!add)return;notice="Refreshing add-on configuration…";render();try{const updated=await refreshManifest(index);notice="Updated "+updated.name+": "+updated.catalogs.length+" catalogs available. Installed settings preserved."}catch(err){notice="Could not refresh "+add.manifest.name+": "+String(err.message||err)}render()});if($("#refreshAddons"))$("#refreshAddons").onclick=refreshCatalogs;bindCatalogControls();$$("[data-addon-open]").forEach(b=>b.onclick=()=>openItem(b.dataset.addonOpen))}

async function refreshCatalogs(){
 const token=++catalogToken;
 loading=true;moreLoading=false;notice="";addonPage=0;feedCursor=0;catalog=[];catalogFeeds=[];
 const available=availableFeeds(),initial=available.slice(0,24);
 pendingFeeds=available.slice(24);
 render();
 const outcomes=await fetchFeedPages(initial,token);
 if(token!==catalogToken)return;
 catalogFeeds=initial;const errors=applyFeedResponses(outcomes);
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
 $$("[data-episode]").forEach(b=>b.onclick=()=>{const picked=videos[Number(b.dataset.episode)];if(picked)getStreams(picked)});
}

let streamRequestToken=0;

async function getStreams(e){
 streamFilter="all";streamSort="quality";streamPage=0;streamProviderFilter="all";
 episode=e||null;const x=detail;if(!x)return;
 const token=++streamRequestToken,videoID=e?.id||x.stremioID,
  candidates=active().filter(a=>supports(a,"stream",x.stremioType,videoID));
 streams=[];streamFailures=[];streamChecks=candidates.length;
 modal('<div class="pad"><h2>Finding playback options…</h2><p>Checking '+candidates.length+' compatible add-on source'+(candidates.length===1?"":"s")+'.</p></div>');
 if(!candidates.length){showStreams("No enabled source supports this title ID and media type. Check the add-on details under Luma Add-ons.");return}
 let ready=false;
 await Promise.all(candidates.map(async a=>{
  try{
   const response=await fetchJSON(endpoint(a,"stream",x.stremioType,videoID));
   if(token!==streamRequestToken)return;
   if(!Array.isArray(response?.streams))throw Error("The add-on returned no valid streams list.");
   const next=response.streams.slice(0,100).map(raw=>({raw,provider:a.manifest.name}))
     .filter(item=>item.raw&&typeof item.raw==="object");
   streams.push(...next);
   if(next.length&&!ready){ready=true;showStreams("")}
  }catch(err){
   if(token===streamRequestToken)streamFailures.push({provider:a.manifest.name,reason:String(err.message||err).slice(0,160)});
  }
 }));
 if(token!==streamRequestToken)return;
 if(!streams.length)showStreams("No direct playback options were returned by the available sources.");
 else showStreams("");
}

function directURL(s){const u=s?.url;if(typeof u!=="string")return"";try{const p=new URL(u);return ["https:","http:"].includes(p.protocol)?p.href:""}catch{return""}}

let streamFilter="all",streamSort="quality",streamPage=0,streamLastMessage="",streamProviderFilter="all";
function streamQuality(raw){
 const txt=String(raw?.title||"")+" "+String(raw?.name||"");
 if(/\b(?:2160p|4k|uhd)\b/i.test(txt))return{tag:"4K",order:4};
 if(/\b(?:1080p|full[\s-]?hd|fhd)\b/i.test(txt))return{tag:"1080p",order:3};
 if(/\b(?:720p|hd)\b/i.test(txt))return{tag:"720p",order:2};
 if(/\b(?:480p|sd)\b/i.test(txt))return{tag:"SD",order:1};
 return{tag:"Unknown",order:0};
}
function sizeFromStream(raw){
 let n=Number(raw?.behaviorHints?.videoSize);
 if(!Number.isFinite(n)||n<=0){let found=String(raw?.title||"").match(/(\d+(?:\.\d+)?)\s*(GiB|GB|MiB|MB)\b/i);if(found){let m=Number(found[1]),unit=found[2].toUpperCase();n=m*(unit==="GIB"?1073741824:unit==="GB"?1e9:unit==="MIB"?1048576:1e6)}}
 if(!Number.isFinite(n)||n<=0)return"";
 return n>=1e9?(n/1e9).toFixed(1)+" GB":(n/1e6).toFixed(0)+" MB";
}
function streamTags(raw){
 const text=String(raw?.title||"")+" "+String(raw?.name||"");
 const tags=[];
 if(/\b(?:HEVC|H\.?265|x265)\b/i.test(text))tags.push("HEVC");
 else if(/\b(?:H\.?264|x264|AVC)\b/i.test(text))tags.push("H.264");
 if(/\b(?:Dolby[\s.]?Vision|DV)\b/i.test(text))tags.push("Dolby Vision");
 else if(/\bHDR(?:10\+?)?\b/i.test(text))tags.push("HDR");
 if(/\b(?:Atmos)\b/i.test(text))tags.push("Atmos");
 if(/\b(?:5\.1|7\.1)\b/.test(text))tags.push("Surround");
 if(/\b(?:REMUX)\b/i.test(text))tags.push("Remux");
 return tags.slice(0,4);
}

function streamInfo(entry,index){
 const raw=entry.raw||{},url=directURL(raw),quality=streamQuality(raw);
 const full=String(raw.title||raw.name||"Stream "+(index+1)).trim();
 const line=(String(raw.name||"").split("\n").find(Boolean)||full.split("\n").find(Boolean)||"Playback source").trim();
 return {entry,index,url,quality,full,display:line.slice(0,95),size:sizeFromStream(raw),tags:streamTags(raw)};
}
function playerPreference(){try{return localStorage.getItem("luma.player.preference")||""}catch{return""}}
function cleanStreamResults(entries){
 const seen=new Set();
 return entries.filter(row=>{
  const src=directURL(row.raw);
  if(!src)return true;
  const key=src+"|"+String(row.raw?.title||"")+"|"+String(row.raw?.name||"");
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
}
function showStreams(message=""){
 streamLastMessage=message;
 const popup=$("#modal .dialog"),scroll=popup?.scrollTop||0;
 const infos=cleanStreamResults(streams).map(streamInfo);
 const playable=infos.filter(s=>s.url).length,providers=[...new Set(infos.map(s=>s.entry.provider))].sort();
 if(streamProviderFilter!=="all"&&!providers.includes(streamProviderFilter))streamProviderFilter="all";
 let results=infos.filter(s=>(streamProviderFilter==="all"||s.entry.provider===streamProviderFilter)
  &&(streamFilter==="all"||streamFilter==="playable"&&!!s.url
     ||streamFilter==="4K"&&s.quality.tag==="4K"||streamFilter==="1080p"&&s.quality.tag==="1080p"));
 results.sort((a,b)=>{
  if(streamSort==="provider")return a.entry.provider.localeCompare(b.entry.provider)||b.quality.order-a.quality.order;
  if(streamSort==="original")return a.index-b.index;
  if(streamSort==="small")return (parseFloat(a.size)||Infinity)-(parseFloat(b.size)||Infinity);
  return Number(!!b.url)-Number(!!a.url)||b.quality.order-a.quality.order||a.entry.provider.localeCompare(b.entry.provider);
 });
 const perPage=10,totalPages=Math.max(1,Math.ceil(results.length/perPage));
 streamPage=Math.min(Math.max(0,streamPage),totalPages-1);
 const shown=results.slice(streamPage*perPage,(streamPage+1)*perPage);
 const name=detail?.title||"Title",poster=String(detail?.poster||"");
 const seasonInfo=episode&&(episode.season||episode.season_number)
   ?' · S'+String(episode.season||episode.season_number).padStart(2,"0")+'E'+String(episode.episode||episode.episode_number||1).padStart(2,"0"):"";
 let html='<div class="pad streamResults lumaStreamResults">'
  +'<div class="streamResultsTop"><div class="streamTitleBlock">'
  +(poster&&/^https:\/\//i.test(poster)?'<img class="streamTitlePoster" src="'+safe(poster)+'" alt="" loading="lazy" onerror="this.remove()">':"")
  +'<div><div class="eyebrow">PLAYBACK OPTIONS</div><h2>'+safe(name)+'</h2>'
  +(seasonInfo?'<p class="streamEpisodeLabel">Selected episode'+seasonInfo+'</p>':"")
  +'<p class="streamCount">'+infos.length+' source'+(infos.length===1?"":"s")+' · '+playable+' direct link'+(playable===1?"":"s")+' · '+providers.length+' provider'+(providers.length===1?"":"s")+'</p></div></div></div>';
 if(streamFailures.length)html+='<details class="streamWarnings"><summary>'+streamFailures.length+' add-on'+(streamFailures.length===1?"":"s")+' unavailable · Other results remain usable</summary>'
  +'<div class="streamWarningItems">'+streamFailures.map(v=>'<p><b>'+safe(v.provider)+'</b><span>'+safe(v.reason)+'</span></p>').join("")+'</div></details>';
 if(message)html+='<p class="streamInlineMessage">'+safe(message)+'</p>';
 html+='<div class="streamToolbar">'
  +'<label>Show<select id="streamFilter"><option value="all">All sources</option><option value="playable">Direct links only</option><option value="4K">4K / UHD</option><option value="1080p">1080p / FHD</option></select></label>'
  +'<label>Provider<select id="streamProvider"><option value="all">All providers</option>'+providers.map(v=>'<option value="'+safe(v)+'">'+safe(v)+'</option>').join("")+'</select></label>'
  +'<label>Sort<select id="streamSort"><option value="quality">Playable & best quality</option><option value="provider">Provider</option><option value="small">Smallest file first</option><option value="original">Original order</option></select></label>'
  +'</div>';
 if(shown.length)html+='<p class="streamPageStatus">Showing '+(streamPage*perPage+1)+'–'+Math.min((streamPage+1)*perPage,results.length)+' of '+results.length+'</p>'
  +'<div class="addonStreamList">'+shown.map(v=>{
   const tags=[v.size,...v.tags].filter(Boolean);
   return '<article class="addonStream streamCompact"><div class="streamBody">'
    +'<div class="streamCardHead"><strong class="streamDisplayName">'+safe(v.display)+'</strong><span class="streamQualityBadge">'+safe(v.quality.tag)+'</span></div>'
    +'<div class="streamMeta"><span class="streamProvider">'+safe(v.entry.provider)+'</span>'
    +tags.map(t=>'<span class="streamTag">'+safe(t)+'</span>').join("")+'</div>'
    +(v.full!==v.display?'<details class="streamTechnical"><summary>View technical release information</summary><p>'+safe(v.full.slice(0,300))+'</p></details>':"")
    +'</div><div class="streamActions">'+(v.url?'<button type="button" class="primary streamPlay" data-source="'+v.index+'" aria-label="Choose a player for '+safe(v.display)+'">▶ '+(playerPreference()?"Play":"Choose player")+'</button>'
     :'<span class="streamUnavailable">No direct URL supplied</span>')+'</div></article>';
  }).join("")+'</div>';
 else html+='<div class="empty">No playback options match these filters. Change the filter or try another add-on.</div>';
 if(totalPages>1)html+='<nav class="streamPager" aria-label="Stream result pages"><button class="secondary" id="streamPrev" '+(streamPage===0?"disabled":"")+'>← Previous</button><span>Page '+(streamPage+1)+' of '+totalPages+'</span><button class="secondary" id="streamNext" '+(streamPage===totalPages-1?"disabled":"")+'>Next →</button></nav>';
 html+='<div class="streamFooter"><button class="secondary" id="streamChangePlayer">Change preferred player</button><button class="secondary" id="backStreamDetail">← Back to title</button>'
  +'<p class="micro">Quality and size are based on provider labels; playback depends on the source and your selected external player. Luma does not resolve torrents internally.</p></div></div>';
 modal(html);
 if($("#modal .dialog"))$("#modal .dialog").scrollTop=scroll;
 $("#streamFilter").value=streamFilter;$("#streamSort").value=streamSort;
 if($("#streamProvider"))$("#streamProvider").value=streamProviderFilter;
 $("#streamFilter").onchange=e=>{streamFilter=e.target.value;streamPage=0;showStreams(streamLastMessage)};
 $("#streamSort").onchange=e=>{streamSort=e.target.value;streamPage=0;showStreams(streamLastMessage)};
 if($("#streamProvider"))$("#streamProvider").onchange=e=>{streamProviderFilter=e.target.value;streamPage=0;showStreams(streamLastMessage)};
 $("#backStreamDetail").onclick=showDetail;
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
function subtitleURL(raw){
 const list=Array.isArray(raw?.subtitles)?raw.subtitles:[];
 for(const x of list){const u=typeof x==="string"?x:x?.url;if(typeof u==="string")try{const p=new URL(u);if(["https:","http:"].includes(p.protocol))return p.href}catch{}}
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
function launchMatch(x,imdb,ep){detail={id:x.id,title:x.title,overview:x.overview||"",poster:x.poster||"",backdrop:x.backdrop||"",provider:"Luma metadata",year:x.year||"",poster:x.poster||"",stremioType:x.type==="Movie"?"movie":"series",stremioID:imdb,addonID:"luma",videos:[]};const chosen=ep?{id:imdb+":"+ep.season_number+":"+ep.episode_number,season:ep.season_number,episode:ep.episode_number}:null;episode=chosen;getStreams(chosen)}
function askForId(x,ep,reason="",choices=[]){
  const validChoices=choices.filter(m=>checkIMDb(m.id)).slice(0,10);
  const choiceUI=validChoices.length?'<div class="matchChoices"><p class="micro">Choose the correct release from these metadata results:</p>'+validChoices.map((m,i)=>'<button class="matchChoice" data-match="'+i+'"><span class="matchMovie">'+safe(m.name||m.title||x.title)+'</span><span>'+safe(m.releaseInfo||m.year||"Year unknown")+'</span><span class="matchArrow">Select ›</span></button>').join("")+'</div>':'';
  modal('<div class="pad matchPanel"><div class="eyebrow">MATCH MOVIE</div><h2>'+safe(x.title)+'</h2>'+(choiceUI||'<p>We could not verify the correct movie automatically. Add an IMDb title ID only if you know it.</p>')+(reason?'<p class="micro">'+safe(reason)+'</p>':'')+'<details class="manualMatch"><summary>Enter IMDb ID manually</summary><form id="manualIMDB"><label>IMDb title ID<input type="text" name="imdb" pattern="tt[0-9]{5,12}" autocomplete="off" placeholder="tt1234567" required></label><button class="primary" type="submit">Find Streams</button></form></details><button class="secondary" type="button" id="backFromMatch">Back to Details</button></div>');
  const proceed=id=>{imdbCache[x.id]=id;try{localStorage.setItem("luma.imdb.ids.v1",JSON.stringify(imdbCache))}catch{}launchMatch(x,id,ep)};
  $$("[data-match]").forEach(b=>b.onclick=()=>{const candidate=validChoices[Number(b.dataset.match)];if(candidate)proceed(candidate.id)});
  const form=$("#manualIMDB");if(form)form.onsubmit=e=>{e.preventDefault();const id=String(e.target.elements.imdb.value).trim();if(!checkIMDb(id))return toast("Enter a valid IMDb ID.");proceed(id)};
  $("#backFromMatch").onclick=()=>{if(state.selected?.id===x.id)showDetails();else closeModal()};
}
async function lookupTitle(x,imdb,ep){
  const known=[imdb,x.imdbId,imdbCache[x.id],state.details?.external_ids?.imdb_id,state.details?.imdb_id].find(checkIMDb);
  if(known)return launchMatch(x,known,ep);
  const type=x.type==="Movie"?"movie":"series",year=parseInt(x.year,10)||null;
  modal('<div class="pad"><h2>Finding the correct title…</h2><p>Checking metadata IDs for '+safe(x.title)+'.</p></div>');
  try{
    const title=String(x.title).replace(/\s*\((?:19|20)\d{2}\)\s*$/,"").trim();
    const endpoint="https://v3-cinemeta.strem.io/catalog/"+type+"/top/search="+encodeURIComponent(title)+".json";
    const response=await fetchJSON(endpoint);
    const candidates=(Array.isArray(response.metas)?response.metas:[]).filter(m=>checkIMDb(m.id)&&cleanMediaName(m.name||m.title)===cleanMediaName(title));
    const exact=candidates.filter(m=>{const y=parseInt(String(m.releaseInfo||m.year||m.released||"").match(/(?:19|20)\d{2}/)?.[0],10);return year&&Number.isFinite(y)&&Math.abs(y-year)<=1});
    const chosen=exact.length===1?exact[0]:(!year&&candidates.length===1?candidates[0]:null);
    if(chosen){imdbCache[x.id]=chosen.id;try{localStorage.setItem("luma.imdb.ids.v1",JSON.stringify(imdbCache))}catch{}return launchMatch(x,chosen.id,ep)}
    if(x.tmdbId){const tmdbId="tmdb:"+x.tmdbId;const epID=ep?tmdbId+":"+ep.season_number+":"+ep.episode_number:tmdbId;const matches=active().filter(a=>supports(a,"stream",type,epID)&&a.manifest.idPrefixes?.some(p=>p.startsWith("tmdb")||p==="tmdb:"));if(matches.length===active().filter(a=>supports(a,"stream",type,epID)).length&&matches.length)return launchMatch(x,tmdbId,ep)}
    askForId(x,ep,candidates.length?"Select the matching release year so Luma can use the correct stream ID.":"No matching title found in the add-on metadata catalog.",candidates)
  }catch(err){askForId(x,ep,"Automatic lookup was unavailable ("+String(err.message||err).replace(/https?:\/\/\S+/g,"service").slice(0,110)+").")}
}
function attachPlayerButtons(){const video=$("#video");if(!video)return;const url=video.currentSrc||video.src;if(!url||!/^https?:/.test(url))return;const controls=video.parentElement.querySelector(".actions");if(!controls||controls.querySelector("[data-external]"))return;const pair=[["infuse","Open in Infuse"],["vidhub","Open in VidHub"]];for(const [id,label]of pair){const b=document.createElement("button");b.className="secondary";b.dataset.external=id;b.textContent=label;b.onclick=()=>handoff(id,url,document.querySelector(".playerWrap h2")?.textContent||"Luma Video",video.currentTime||0);controls.appendChild(b)}}
return {open,render,attachPlayerButtons,lookupTitle,installed:()=>list.length};
})();
