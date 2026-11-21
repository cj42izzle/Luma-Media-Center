
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store=(key,fallback)=>{try{return JSON.parse(localStorage.getItem("luma.v2."+key))??fallback}catch{return fallback}};
const PROFILE_FIELDS=["watch","favorites","watched","progress","links"];
function cleanProfileName(value){return String(value||"").trim().replace(/\s+/g," ").slice(0,36)}
function loadProfileRegistry(){
 const previous=store("profilesV1",null),legacy=cleanProfileName(store("profile","You"))||"You";
 const rows=Array.isArray(previous?.entries)?previous.entries:[];
 const entries=[],seen=new Set();
 for(const row of rows){
  const id=String(row?.id||"");
  const name=cleanProfileName(row?.name);
  if(!name||!/^(?:default|viewer-[a-z0-9-]{4,50})$/.test(id)||seen.has(id)||entries.length>=8)continue;
  entries.push({id,name});seen.add(id);
 }
 if(!seen.has("default"))entries.unshift({id:"default",name:legacy});
 const activeId=entries.some(x=>x.id===previous?.activeId)?previous.activeId:"default";
 return {version:1,activeId,entries:entries.slice(0,8)};
}
const profileRegistry=loadProfileRegistry();
function profileStorageKey(field,id=profileRegistry.activeId){
 return id==="default"?"luma.v2."+field:"luma.v2.viewer.v1."+id+"."+field;
}
function loadProfileField(field,fallback,id=profileRegistry.activeId){
 try{
  const value=JSON.parse(localStorage.getItem(profileStorageKey(field,id))||"null");
  return field==="progress"||field==="links"?(value&&typeof value==="object"&&!Array.isArray(value)?value:fallback):
   Array.isArray(value)?value:fallback;
 }catch{return fallback}
}
function activeProfileName(){return profileRegistry.entries.find(x=>x.id===profileRegistry.activeId)?.name||"You"}
// IndexedDB keeps a durable, device-local recovery copy of private library data.
// Existing localStorage reads remain compatible with legacy Home Screen installs.
const LumaDurable=(()=>{
 const pending=new Map();
 let dbPromise,ready=false,flushing=false,restored=0,lastSuccess=0,lastError="";
 const important=k=>k==="luma.device.titles.v1"||/^luma\.v2\.(?:watch|favorites|watched|progress|links|library|profilesV1)$/.test(k)||/^luma\.v2\.viewer\.v1\.[a-z0-9-]+\.(?:watch|favorites|watched|progress|links)$/.test(k);
 function open(){
  if(dbPromise)return dbPromise;
  if(typeof indexedDB==="undefined")return Promise.resolve(null);
  dbPromise=new Promise(resolve=>{
   try{
    const request=indexedDB.open("luma-library-records",1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("records"))request.result.createObjectStore("records",{keyPath:"key"})};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{lastError="IndexedDB could not open";resolve(null)};
    request.onblocked=()=>{lastError="Close duplicate Luma tabs before retrying a backup"};
   }catch{lastError="IndexedDB is unavailable";resolve(null)}
  });return dbPromise;
 }
 async function flush(){
  if(!ready||flushing||!pending.size)return;
  flushing=true;
  try{
   const db=await open();
   if(!db){lastError=lastError||"IndexedDB unavailable";return}
   for(const [key,value] of [...pending]){
    const ok=await new Promise(resolve=>{
     try{
      const tx=db.transaction("records","readwrite");
      tx.objectStore("records").put({key,value,updated:Date.now()});
      tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
     }catch{resolve(false)}
    });
    if(!ok){lastError="Library backup write failed";break}
    if(pending.get(key)===value)pending.delete(key);
    lastSuccess=Date.now();lastError="";
   }
  }finally{flushing=false}
 }
 function remember(key,value){if(!important(key)||typeof value!=="string")return;pending.set(key,value);if(ready)void flush()}
 async function init(){
  const db=await open();
  if(!db){ready=true;return {restored,available:false}}
  let rows=[];
  try{rows=await new Promise((resolve,reject)=>{
   const req=db.transaction("records","readonly").objectStore("records").getAll();
   req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(Error("Library read failed"));
  })}catch{lastError="Library recovery read failed"}
  for(const entry of rows){
   if(!important(entry?.key)||typeof entry.value!=="string")continue;
   let local=null;try{local=localStorage.getItem(entry.key)}catch{}
   if(local===null){
    try{localStorage.setItem(entry.key,entry.value);restored++}
    catch{
     clearDisposableCaches();
     try{localStorage.setItem(entry.key,entry.value);restored++}
     catch{lastError="Storage is full; download a backup"}
    }
   }else if(!pending.has(entry.key))pending.set(entry.key,local);
  }
  try{for(let i=0;i<localStorage.length;i++){
   const key=localStorage.key(i);
   if(important(key)&&!pending.has(key))pending.set(key,localStorage.getItem(key));
  }}catch{}
  ready=true;await flush();return {restored,available:true};
 }
 const diagnostic=()=>({available:typeof indexedDB!=="undefined",ready,restored,pending:pending.size,lastSuccess,lastError});
 return {remember,init,flush,diagnostic};
})();
// Media catalog and metadata caches can be rebuilt. Never evict saved titles,
// watchlists, favorites, progress, viewers, personal media or accounts.
function quotaExceeded(error){
 return error?.name==="QuotaExceededError"||error?.name==="NS_ERROR_DOM_QUOTA_REACHED"||error?.code===22||error?.code===1014;
}
function clearDisposableCaches(){
 for(const key of ["luma.v2.catalog","luma.epcalendar.v1","luma.v2.languageLookupV1","luma.v2.contentRatingsV1","luma.v2.lastAiredV1"]){
  try{localStorage.removeItem(key)}catch{}
 }
}
function writeLocalRecord(key,payload,optional=false){
 try{localStorage.setItem(key,payload);LumaDurable.remember(key,payload);return true}
 catch(error){
  if(quotaExceeded(error)&&!optional){
   clearDisposableCaches();
   try{localStorage.setItem(key,payload);LumaDurable.remember(key,payload);return true}catch{}
  }
  if(!optional)toast("Luma cannot save on this device. Open Settings and export a backup; do not clear your data.");
  return false;
 }
}
function compactCatalogCache(rows){
 return (Array.isArray(rows)?rows:[]).filter(x=>x?.id&&x?.title&&x.source!=="personal").slice(0,360).map(x=>{
  const keys=["id","title","type","year","source","poster","backdrop","imdbId","tmdbId","mediaType","mazeId","animeId","kitsuId","itunesId","original_language","date","rating","genreNames","genres"];
  const item={};for(const k of keys)if(x[k]!==undefined)item[k]=x[k];return item;
 });
}
const save=(key,v)=>{
 const storageKey=PROFILE_FIELDS.includes(key)?profileStorageKey(key):"luma.v2."+key;
 const optional=key==="catalog"||["languageLookupV1","contentRatingsV1","lastAiredV1"].includes(key);
 return writeLocalRecord(storageKey,JSON.stringify(key==="catalog"?compactCatalogCache(v):v),optional);
};
const state={tab:"Home",q:"",type:"all",items:[],selected:null,details:null,season:1,profile:activeProfileName(),watch:loadProfileField("watch",[]),favorites:loadProfileField("favorites",[]),watched:loadProfileField("watched",[]),progress:loadProfileField("progress",{}),links:loadProfileField("links",{}),library:store("library",[]),tmdbKey:store("tmdbKey",""),accent:store("accent","#fa3f56"),theme:store("theme","dark"),density:store("density","comfortable"),showOriginalLanguage:store("showOriginalLanguage",true)!==false,showEnglishDub:store("showEnglishDub",true)!==false,showHomeExtras:store("showHomeExtras",false)===true,filter:"all",loading:true,source:"",message:"",playerKey:"",lastSave:0};
const colorPick=["#594083","#4b6ca2","#764f78","#346c6e","#8c565b","#785b3b"];
const fallback=[["ttv:82","Game of Thrones","Series",2011],["ttv:169","Breaking Bad","Series",2008],["ttv:73","The Walking Dead","Series",2010],["ttv:431","Friends","Series",1994],["ttv:83","The Simpsons","Series",1989]];
const TMDB_GENRES={movie:{28:"Action",12:"Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",14:"Fantasy",36:"History",27:"Horror",10402:"Music",9648:"Mystery",10749:"Romance",878:"Science Fiction",10770:"TV Movie",53:"Thriller",10752:"War",37:"Western"},tv:{10759:"Action & Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",10762:"Kids",9648:"Mystery",10763:"News",10764:"Reality",10765:"Sci-Fi & Fantasy",10766:"Soap",10767:"Talk",10768:"War & Politics",37:"Western"}};
function tmdbGenreNames(type,ids){return [...new Set((ids||[]).map(id=>(TMDB_GENRES[type]||{})[id]).filter(Boolean))]}

function originalLanguageName(x){
 const raw=String(x?.original_language||x?.originalLanguage||x?.language||"").trim();
 if(!raw||["und","unknown","n/a","null","undefined"].includes(raw.toLowerCase()))return "Not listed";
 if(/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(raw)){
  const tag=raw.replace(/_/g,"-");
  try{
   const name=new Intl.DisplayNames(["en"],{type:"language"}).of(tag);
   if(name&&name.toLowerCase()!==tag.toLowerCase())return name;
  }catch{}
  const common={en:"English",ja:"Japanese",ko:"Korean",zh:"Chinese",es:"Spanish",fr:"French",hi:"Hindi",de:"German",it:"Italian",pt:"Portuguese",ru:"Russian",ar:"Arabic",tr:"Turkish"};
  return common[tag.toLowerCase()]||"Not listed";
 }
 return raw.length<=60?raw:"Not listed";
}
function originalLanguageBadge(x){
 const key=langKey(x);langTitles.set(key,x);
 const name=originalLanguageName(langView(x));
 return '<small class="cardOriginalLanguage" data-language-key="'+safe(key)+'" title="'+safe("Original language: "+name)+'">'
  +'<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>'
  +'<span class="languageCaption">Original</span><span class="languageName">'+safe(name)+'</span></small>';
}

/* Cross-origin public metadata lookups, performed only for visible, non-personal titles. */
const langCache=store("languageLookupV1",{}),langTitles=new Map(),langQueue=[],langPending=new Set();
let langActive=0,langObserver=null;
function cleanLangTitle(x){return String(x?.title||"").replace(/\s*\((?:19|20)\d{2}\)\s*$/,"").trim().slice(0,110)}
function langNorm(s){return String(s||"").normalize("NFKD").toLowerCase().replace(/\s*\((?:19|20)\d{2}\)\s*$/,"").replace(/[^a-z0-9]+/g," ").trim()}
function langKey(x){return String(x?.id||"")+"|"+String(x?.year||"")+"|"+langNorm(x?.title)}
function langSaved(x){return langCache[langKey(x)]||{}}
function langView(x){const extra=langSaved(x);return {...x,original_language:x?.original_language||x?.originalLanguage||extra.original_language||"",englishDub:x?.englishDub===true||extra.englishDub===true}}
function englishDubBadge(x){
 const info=langView(x);
 if(!info.englishDub||originalLanguageName(info)==="English")return "";
 return '<small class="cardEnglishDub" data-language-key="'+safe(langKey(x))+'" title="English-language voice dub confirmed in source metadata, not necessarily the selected stream">✓ English Dub</small>';
}
function languageBadges(x){
 if(!state.showOriginalLanguage&&!state.showEnglishDub)return "";
 const key=langKey(x);langTitles.set(key,x);
 return '<span class="cardLanguageBadges" data-language-key="'+safe(key)+'">'+languageBadgeContents(x)+'</span>';
}
function languageBadgeContents(x){return (state.showOriginalLanguage?originalLanguageBadge(x):"")+(state.showEnglishDub?englishDubBadge(x):"")}
function claimValues(ent,p){return(ent?.claims?.[p]||[]).map(v=>v?.mainsnak?.datavalue?.value).filter(Boolean)}
function claimIds(ent,p){return claimValues(ent,p).map(v=>v.id).filter(v=>/^Q\d+$/.test(v||""))}
function candidateYear(ent){const ys=[];for(const p of ["P577","P580","P571"])for(const v of claimValues(ent,p)){const m=String(v.time||"").match(/^[+-]?(\d{4})-/);if(m)ys.push(Number(m[1]))}const d=String(ent?.descriptions?.en?.value||"");for(const m of d.matchAll(/\b(?:19|20)\d{2}\b/g))ys.push(Number(m[0]));return ys}
function entityMatches(ent,x){
 const title=langNorm(cleanLangTitle(x)),names=[ent?.labels?.en?.value,...(ent?.aliases?.en||[]).map(v=>v.value)];
 if(!title||!names.some(n=>langNorm(n)===title))return false;
 const desc=String(ent?.descriptions?.en?.value||"");
 const classes=claimIds(ent,"P31");
 const film=classes.includes("Q11424")||/\b(film|movie|motion picture)\b/i.test(desc);
 const tv=classes.includes("Q5398426")||/\b(television series|tv series|miniseries)\b/i.test(desc);
 return (x.type==="Movie"?film:film||tv)&&candidateYear(ent).includes(Number(x.year));
}
async function wikidata(params){
 const url="https://www.wikidata.org/w/api.php?"+new URLSearchParams({action:params.action,format:"json",origin:"*",...params});
 return api(url);
}
async function findOriginalLanguage(x){
 const title=cleanLangTitle(x),year=Number(x.year);
 if(title.length<2||!Number.isInteger(year)||year<1880||year>2100)return "";
 const seen=new Set();
 for(const phrase of [title+" "+year,title]){
  const search=await wikidata({action:"wbsearchentities",search:phrase,language:"en",type:"item",limit:"50"});
  const hits=(search?.search||[]).filter(v=>/^Q\d+$/.test(v.id||"")&&!seen.has(v.id));
  // Wikidata may rank old adaptations above new films with the same title.
  const priority=hits.filter(v=>String(v.description||"").includes(String(year))
    &&/\b(film|movie|television series|tv series)\b/i.test(String(v.description||""))
    &&!/\bfilm score\b/i.test(String(v.description||"")));
  const ids=[...priority,...hits.filter(v=>!priority.includes(v))].map(v=>v.id).slice(0,16);
  ids.forEach(v=>seen.add(v));if(!ids.length)continue;
  const found=await wikidata({action:"wbgetentities",ids:ids.join("|"),props:"claims|labels|descriptions|aliases",languages:"en"});
  const matches=Object.values(found?.entities||{}).filter(e=>entityMatches(e,x));
  const langIds=[...new Set(matches.flatMap(e=>{const originals=claimIds(e,"P364");return originals.length?originals:claimIds(e,"P407")}))];
  if(!langIds.length)continue;
  const languages=await wikidata({action:"wbgetentities",ids:langIds.slice(0,8).join("|"),props:"labels",languages:"en"});
  const labels=[...new Set(langIds.map(id=>languages?.entities?.[id]?.labels?.en?.value).filter(Boolean))];
  if(labels.length===1)return labels[0];
  if(labels.length>1&&matches.length===1)return labels.slice(0,3).join(" / ");
 }
 return "";
}
function isJapaneseAnime(x){const v=langView(x);return x?.type==="Anime"||(String(v.original_language||"").toLowerCase()==="ja"&&((x.genreNames||[]).includes("Animation")||(x.genres||[]).includes(16)))}
async function findAnimeEnglishDub(x){
 if(!isJapaneseAnime(x))return false;
 const title=cleanLangTitle(x),year=Number(x.year);
 if(!title||!Number.isInteger(year))return false;
 const data=await api("https://api.jikan.moe/v4/anime?"+new URLSearchParams({q:title.slice(0,64),limit:"10"}));
 const matches=(data?.data||[]).filter(v=>{
  const names=[v.title,v.title_english,...(v.title_synonyms||[])];
  const aired=Number(String(v.aired?.from||"").slice(0,4))||Number(v.year);
  return names.some(s=>langNorm(s)===langNorm(title))&&Number.isInteger(aired)&&Math.abs(aired-year)<=1;
 });
 if(matches.length!==1||!Number.isInteger(Number(matches[0].mal_id)))return false;
 const chars=await api("https://api.jikan.moe/v4/anime/"+Number(matches[0].mal_id)+"/characters");
 return (chars?.data||[]).some(c=>(c.voice_actors||[]).some(v=>/^English\b/i.test(String(v.language||""))));
}
function refreshLanguageBadges(key){
 if(!document.querySelectorAll)return;
 const x=langTitles.get(key);if(!x)return;
 for(const node of document.querySelectorAll(".cardLanguageBadges[data-language-key]")){
  if(node.getAttribute("data-language-key")===key)node.innerHTML=languageBadgeContents(x);
 }
}

function recordLanguage(x,patch){
 const k=langKey(x);langCache[k]={...langSaved(x),...patch};
 const all=Object.keys(langCache);
 if(all.length>400)all.sort((a,b)=>(langCache[b].updated||0)-(langCache[a].updated||0)).slice(400).forEach(k=>delete langCache[k]);
 save("languageLookupV1",langCache);refreshLanguageBadges(k);
}
async function hydrateLanguage(x){
 if(!x||["personal","offline"].includes(x.source))return;
 const now=Date.now(),entry=langSaved(x);
 const origMissing=originalLanguageName(langView(x))==="Not listed";
 if(state.showOriginalLanguage&&origMissing&&(!entry.langChecked||now-entry.langChecked>86400000)){
  try{const language=await findOriginalLanguage(x);recordLanguage(x,{original_language:language,langChecked:Date.now(),updated:Date.now()})}catch{}
 }
 if(state.showEnglishDub&&isJapaneseAnime(x)){
  const e=langSaved(x);
  if(!e.dubChecked||now-e.dubChecked>(e.englishDub?30*86400000:86400000)){
   try{recordLanguage(x,{englishDub:await findAnimeEnglishDub(x),dubChecked:Date.now(),updated:Date.now()})}catch{}
  }
 }
}
function pumpLanguageQueue(){
 while(langActive<2&&langQueue.length){
  const x=langQueue.shift(),key=langKey(x);langActive++;
  Promise.resolve().then(()=>hydrateLanguage(x)).catch(()=>{}).finally(()=>{langActive--;langPending.delete(key);pumpLanguageQueue()});
 }
}
function queueLanguage(x){
 if(!x||!x.id||["personal","offline"].includes(x.source)||(!state.showOriginalLanguage&&!state.showEnglishDub))return;
 const e=langSaved(x),now=Date.now();
 const needLanguage=state.showOriginalLanguage&&originalLanguageName(langView(x))==="Not listed"&&(!e.langChecked||now-e.langChecked>86400000);
 const needDub=state.showEnglishDub&&isJapaneseAnime(x)&&(!e.dubChecked||now-e.dubChecked>(e.englishDub?30*86400000:86400000));
 if(!needLanguage&&!needDub)return;
 const key=langKey(x);if(langPending.has(key))return;
 langPending.add(key);langQueue.push(x);pumpLanguageQueue();
}
function scanLanguageCards(){
 scanCertificateCards();
 if(typeof IntersectionObserver!=="function"||!document.querySelectorAll)return;
 langObserver?.disconnect();
 langObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){langObserver.unobserve(e.target);const x=langTitles.get(e.target.getAttribute("data-language-key"));if(x)queueLanguage(x)}},{rootMargin:"220px"});
 for(const element of document.querySelectorAll(".cardLanguageBadges[data-language-key]"))langObserver.observe(element);
}


const contentRatings=store("contentRatingsV1",{}),contentItems=new Map(),contentQueue=[],contentPending=new Set();
let contentActive=0,contentObserver=null;
function contentCountry(){return LumaReleases.getRegion?.()||"US"}
function contentKey(x){return langKey(x)+"|"+contentCountry()}
function verifiedCertificate(value){
 const v=String(value||"").trim().toUpperCase().replace(/^RATED\s+/,"");
 return ["G","PG","PG-13","R","NC-17","TV-Y","TV-Y7","TV-G","TV-PG","TV-14","TV-MA","U","12","12A","15","16","18"].includes(v)?v:"";
}
function certificateFor(x){return verifiedCertificate(x.contentRating||x.contentAdvisoryRating||contentRatings[contentKey(x)]?.value)}
function audienceBadge(x){
 const n=Number(x.rating);
 return Number.isFinite(n)&&n>0&&n<=10?'<span class="cardRating" title="'+safe(x.source==="tmdb"?"TMDB audience score":x.source==="tvmaze"?"TVmaze audience score":"Provider-reported audience score")+'">★ '+n.toFixed(1)+'/10</span>':"";
}
function certificateBadge(x){const v=certificateFor(x);return v?'<span class="cardCertificate" title="'+safe(contentCountry()+" content classification")+'">'+safe(v.startsWith("TV-")?v:"Rated "+v)+'</span>':""}
function certificateSlot(x){const k=contentKey(x);contentItems.set(k,x);return '<span class="certificateSlot" data-certificate-key="'+safe(k)+'">'+certificateBadge(x)+'</span>'}
function tmdbCertificate(data,tv,region){
 if(tv)return verifiedCertificate((data?.results||[]).find(v=>v.iso_3166_1===region)?.rating);
 const p={3:0,2:1,4:2,5:3,6:4,1:5};
 const dates=(data?.results||[]).find(v=>v.iso_3166_1===region)?.release_dates||[];
 return verifiedCertificate(dates.filter(v=>verifiedCertificate(v.certification)).sort((a,b)=>(p[a.type]??9)-(p[b.type]??9))[0]?.certification);
}
const mpaId={Q18665330:"G",Q18665334:"PG",Q18665339:"PG-13",Q18665344:"R",Q18665349:"NC-17"};
async function wikidataCertificate(x){
 if(x.type!=="Movie"||contentCountry()!=="US"||!Number(x.year))return "";
 const title=cleanLangTitle(x),year=Number(x.year),seen=new Set();if(title.length<2)return "";
 for(const q of [title+" "+year,title]){
  const r=await wikidata({action:"wbsearchentities",search:q,language:"en",type:"item",limit:"50"});
  const all=(r.search||[]).filter(v=>/^Q\d+$/.test(v.id||"")&&!seen.has(v.id));
  const preferred=all.filter(v=>String(v.description||"").includes(String(year))&&/\bfilm\b/i.test(v.description||"")&&!/film score/i.test(v.description||""));
  const ids=[...preferred,...all.filter(v=>!preferred.includes(v))].map(v=>v.id).slice(0,16);ids.forEach(id=>seen.add(id));
  if(!ids.length)continue;
  const details=await wikidata({action:"wbgetentities",ids:ids.join("|"),props:"claims|labels|descriptions|aliases",languages:"en"});
  const matches=Object.values(details.entities||{}).filter(e=>entityMatches(e,x));
  const labels=[...new Set(matches.flatMap(e=>claimIds(e,"P1657").map(id=>mpaId[id]).filter(Boolean)))];
  if(labels.length===1)return labels[0];
 }
 return "";
}
async function fetchCertificate(x){
 const region=contentCountry();
 if(state.tmdbKey&&x.tmdbId&&["tv","movie"].includes(x.mediaType)){
  const tv=x.mediaType==="tv";
  try{return tmdbCertificate(await tmdb((tv?"tv/":"movie/")+x.tmdbId+(tv?"/content_ratings":"/release_dates")),tv,region)}catch{}
 }
 if(x.type==="Movie"&&x.itunesId&&["applechart","itunes"].includes(x.source)){
  try{
   const r=await api("https://itunes.apple.com/lookup?"+new URLSearchParams({id:String(x.itunesId),country:region.toLowerCase(),entity:"movie"}));
   const found=(r.results||[]).find(v=>langNorm(v.trackName||v.collectionName)===langNorm(cleanLangTitle(x))&&Math.abs(Number(String(v.releaseDate||"").slice(0,4))-Number(x.year))<=1);
   const rating=verifiedCertificate(found?.contentAdvisoryRating);
   if(rating)return rating;
  }catch{}
 }
 try{return await wikidataCertificate(x)}catch{return ""}
}
function scanCertificateCards(){
 if(typeof IntersectionObserver!=="function"||!document.querySelectorAll)return;
 contentObserver?.disconnect();
 contentObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){
  contentObserver.unobserve(e.target);
  const k=e.target.getAttribute("data-certificate-key"),x=contentItems.get(k),known=contentRatings[k];
  if(!x||["personal","offline"].includes(x.source)||certificateFor(x)||known&&Date.now()-known.time<(known.value?30:3)*86400000||contentPending.has(k))continue;
  contentPending.add(k);contentQueue.push(x);pumpCertificates();
 }},{rootMargin:"220px"});
 for(const el of document.querySelectorAll(".certificateSlot[data-certificate-key]"))contentObserver.observe(el);
}
function pumpCertificates(){
 while(contentActive<2&&contentQueue.length){
  const x=contentQueue.shift(),k=contentKey(x);contentActive++;
  Promise.resolve().then(()=>fetchCertificate(x)).then(value=>{
   contentRatings[k]={value:verifiedCertificate(value),time:Date.now()};
   if(Object.keys(contentRatings).length>400)Object.keys(contentRatings).sort((a,b)=>contentRatings[b].time-contentRatings[a].time).slice(400).forEach(key=>delete contentRatings[key]);
   save("contentRatingsV1",contentRatings);
   for(const el of document.querySelectorAll(".certificateSlot[data-certificate-key]"))if(el.getAttribute("data-certificate-key")===k)el.innerHTML=certificateBadge(x);
  }).catch(()=>{}).finally(()=>{contentActive--;contentPending.delete(k);pumpCertificates()});
 }
}

function tmdbType(x){return x.media_type==="tv"&&x.original_language==="ja"&&(x.genre_ids||[]).includes(16)?"Anime":x.media_type==="tv"?"Series":"Movie"}
function safeArtworkUrl(path){try{const u=new URL(String(path||""));return u.protocol==="https:"&&!u.username&&!u.password?u.href:""}catch{return""}}
function idKey(x){return x?.id||""}
function image(path,w=500){if(!path)return"";if(path.startsWith("https:"))return path;return "https://image.tmdb.org/t/p/w"+w+path}
function normalizeTMDB(x){return {id:"tmdb:"+x.media_type+":"+x.id,tmdbId:x.id,mediaType:x.media_type,title:x.title||x.name||"Untitled",type:tmdbType(x),year:(x.release_date||x.first_air_date||"").slice(0,4),overview:x.overview||"No description available.",poster:image(x.poster_path),backdrop:image(x.backdrop_path,1280),rating:x.vote_average?Number(x.vote_average).toFixed(1):"",source:"tmdb",date:x.release_date||x.first_air_date||"",popularity:x.popularity||0,genres:x.genre_ids||[],original_language:x.original_language||"",genreNames:tmdbGenreNames(x.media_type,x.genre_ids||[]),origin_country:Array.isArray(x.origin_country)?x.origin_country:[],production_countries:Array.isArray(x.production_countries)?x.production_countries.map(y=>y.iso_3166_1).filter(Boolean):[]}}
function normalizeTVMaze(x){let y=x.show||x;return{id:"tvmaze:"+y.id,mazeId:y.id,title:y.name||"Untitled",type:(y.genres||[]).includes("Anime")?"Anime":"Series",year:(y.premiered||"").slice(0,4),overview:(y.summary||"").replace(/<[^>]*>/g,"")||"No description available.",poster:y.image?.medium||y.image?.original||"",backdrop:y.image?.original||"",rating:y.rating?.average||"",original_language:y.language||"",source:"tvmaze",genres:y.genres||[],date:y.premiered||"",imdbId:y.externals?.imdb||"",tvStatus:y.status||"",genreNames:y.genres||[],runtime:y.runtime||y.averageRuntime||0,network:y.network?.name||y.webChannel?.name||"",origin_country:[y.network?.country?.code||y.webChannel?.country?.code].filter(Boolean)}}
function normalizeChart(x,i){const imgs=x["im:image"]||[],name=x["im:name"]?.label||"Movie",entryId=x.id?.attributes?.["im:id"]||i;return{id:"applechart:"+entryId,title:name,type:"Movie",year:(x["im:releaseDate"]?.label||"").slice(0,4),overview:x.summary?.label||"Popular movie.",poster:(imgs[imgs.length-1]?.label||"").replace(/\d+x\d+bb/,"600x600bb"),backdrop:"",source:"applechart",itunesId:entryId,date:x["im:releaseDate"]?.label||"",genreNames:[x.category?.attributes?.label].filter(Boolean)}}
function normalizeITunes(x){return{id:"itunes:"+x.trackId,title:x.trackName||x.collectionName||"Untitled",type:x.kind==="tv-episode"?"Series":"Movie",year:(x.releaseDate||"").slice(0,4),overview:x.longDescription||x.shortDescription||"",poster:(x.artworkUrl100||"").replace("100x100bb","600x600bb"),backdrop:"",source:"itunes",itunesId:x.trackId,contentRating:verifiedCertificate(x.contentAdvisoryRating),preview:x.previewUrl||"",date:x.releaseDate||"",genreNames:[x.primaryGenreName].filter(Boolean),runtime:x.trackTimeMillis?Math.round(x.trackTimeMillis/60000):0}}
function normalizeOwn(x){return{...x,type:x.type||"Movie",source:"personal",poster:safeArtworkUrl(x.poster),backdrop:safeArtworkUrl(x.backdrop)}}
function unique(items){const seen=new Set;return items.filter(x=>{if(!x?.id||seen.has(x.id))return false;seen.add(x.id);return true})}
function isGenuineSavedTitle(x){
 const name=String(x?.title||"").trim().toLowerCase();
 return !!x?.id&&!x.unresolved&&!!name&&!["saved title","metadata unavailable","untitled"].includes(name);
}
function saveTitleSnapshot(id,title){
 if(!isGenuineSavedTitle(title))return false;
 let cache={};try{cache=JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")||{}}catch{}
 const keys=["id","title","type","year","source","poster","backdrop","overview","imdbId","tmdbId","mediaType","mazeId","animeId","malId","kitsuId","itunesId","date","rating","genreNames","genres","original_language","episodeCount","network","tvStatus"];
 const snapshot={id};for(const k of keys)if(title[k]!==undefined)snapshot[k]=k==="overview"?String(title[k]).slice(0,1100):title[k];
 cache[id]=snapshot;
 return writeLocalRecord("luma.device.titles.v1",JSON.stringify(cache));
}
const recoveryFailures=new Set();
let recoveryPromise=null;
async function lookupSavedTitle(id){
 const name=String(id||"");
 let match=name.match(/^tvmaze:(\d+)$/);
 if(match){const data=await api("https://api.tvmaze.com/shows/"+match[1]);return Number(data?.id)===Number(match[1])?{...normalizeTVMaze(data),id}:null}
 match=name.match(/^tmdb:(movie|tv):(\d+)$/);
 if(match){
  if(!state.tmdbKey)return null;
  const data=await tmdb(match[1]+"/"+match[2]);
  if(Number(data?.id)!==Number(match[2]))return null;
  return {...normalizeTMDB({...data,media_type:match[1],genre_ids:(data.genres||[]).map(x=>x.id)}),id};
 }
 match=name.match(/^(?:cinemeta:|imdb:|stremio:)(tt\d{5,12})$/);
 if(match&&typeof LumaCatalogPlus!=="undefined"){
  for(const kind of ["series","movie"]){
   try{
    const data=await api("https://v3-cinemeta.strem.io/meta/"+kind+"/"+match[1]+".json");
    const result=LumaCatalogPlus.normalizeCinemeta(data?.meta,kind);
    if(result?.imdbId===match[1])return {...result,id};
   }catch{}
  }
 }
 match=name.match(/^anilist:(\d+)$/);
 if(match&&typeof LumaCatalogPlus!=="undefined"){
  const query="query($id:Int){Media(id:$id,type:ANIME){id idMal title{english romaji native} description(asHtml:false) startDate{year month day} coverImage{large extraLarge} bannerImage averageScore genres format episodes relations{edges{relationType node{id}}}}}";
  const data=await api("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query,variables:{id:Number(match[1])}})});
  const row=LumaCatalogPlus.normalizeAnime(data?.data?.Media);
  return row?.animeId===Number(match[1])?{...row,id}:null;
 }
 match=name.match(/^kitsu:(\d+)$/);
 if(match&&typeof LumaCatalogPlus!=="undefined"){
  const data=await api("https://kitsu.io/api/edge/anime/"+match[1],{headers:{Accept:"application/vnd.api+json"}});
  const row=LumaCatalogPlus.normalizeKitsu(data?.data);
  return row?.kitsuId===Number(match[1])?{...row,id}:null;
 }
 match=name.match(/^(?:itunes:|applechart:)(\d+)$/);
 if(match){
  const data=await api("https://itunes.apple.com/lookup?"+new URLSearchParams({id:match[1],country:viewerCountry().toLowerCase()}));
  const row=(data.results||[]).find(x=>String(x.trackId)===match[1]);
  return row?{...normalizeITunes(row),id}:null;
 }
 return null;
}
// Recover by exact provider identifiers; similar titles and remakes are not interchangeable.
async function recoverSavedTitles(requested=null,force=false){
 if(recoveryPromise)return recoveryPromise;
 const keys=[...new Set((requested||[...state.watch,...state.favorites,...state.watched])
  .map(v=>String(v||"").replace(/:s\d+e\d+$/i,"")).filter(Boolean))];
 const snapshots=(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")||{}}catch{return{}}})();
 const cached=store("catalog",[]);
 const available=new Map([...cached,...Object.values(snapshots),...state.items].filter(isGenuineSavedTitle).map(x=>[x.id,x]));
 const missing=keys.filter(id=>!available.has(id)&&(force||!recoveryFailures.has(id))).slice(0,80);
 if(!missing.length)return {restored:0,missing:0};
 recoveryPromise=(async()=>{
  let restored=0;
  for(let i=0;i<missing.length;i+=4){
   const ids=missing.slice(i,i+4);
   const group=await Promise.allSettled(ids.map(async id=>({id,item:await lookupSavedTitle(id)})));
   group.forEach((outcome,index)=>{
    if(outcome.status!=="fulfilled"||!isGenuineSavedTitle(outcome.value.item)){recoveryFailures.add(ids[index]);return}
    const {id,item}=outcome.value;
    state.items=unique([item,...state.items]);
    saveTitleSnapshot(id,item);recoveryFailures.delete(id);restored++;
   });
   if(restored&&["My Library","Watchlist","Favorites","Home","Calendar"].includes(state.tab))render();
  }
  return {restored,missing:missing.length-restored};
 })().finally(()=>{recoveryPromise=null});
 return recoveryPromise;
}
function viewerCountry(){return typeof LumaReleases!=="undefined"?LumaReleases.getRegion?.()||"US":"US"}
const COUNTRY_LANGUAGES={US:"en",CA:"en",GB:"en",AU:"en",NZ:"en",IE:"en",IN:"hi",JP:"ja",KR:"ko",PH:"en",SG:"en",MY:"ms",TH:"th",ID:"id",DE:"de",FR:"fr",ES:"es",IT:"it",NL:"nl",BE:"nl",CH:"de",SE:"sv",NO:"no",DK:"da",FI:"fi",PL:"pl",PT:"pt",GR:"el",TR:"tr",BR:"pt",MX:"es",AR:"es",CL:"es",CO:"es",ZA:"en",NG:"en",KE:"en",EG:"ar",AE:"ar",SA:"ar"};
function regionOrigin(x){return [...(Array.isArray(x.origin_country)?x.origin_country:[]),...(Array.isArray(x.production_countries)?x.production_countries:[])].map(c=>String(c||"").toUpperCase())}
function countryVerified(x,code=viewerCountry()){return regionOrigin(x).includes(code)}
function countryRank(x,code=viewerCountry()){
 const confirmed=countryVerified(x,code);
 const language=COUNTRY_LANGUAGES[code]||"en";
 const original=String(x.original_language||"").toLowerCase();
 const languageMatch=original===language||original==="english"&&language==="en"||original==="japanese"&&language==="ja";
 return (confirmed?100:0)+(languageMatch?12:0)
  +Math.min(15,Math.log1p(Math.max(0,Number(x.popularity)||0))*2)
  +Math.min(10,Math.max(0,Number(x.rating)||0));
}
function countrySorted(items,code=viewerCountry()){
 return [...items].sort((a,b)=>countryRank(b,code)-countryRank(a,code));
}
/* The shared #search field is a touch/desktop control, not a TV remote target.
   TV has its own persistent sidebar search; phones have a dedicated Search tab.
   Use DOM state as well as CSS so cached assets cannot leave a duplicate field. */
function syncHeaderSearch(){
 const tv=document.documentElement.dataset.tv==="true"||
  document.documentElement.dataset.lumaNative==="android-tv";
 const compact=!tv&&typeof window.matchMedia==="function"&&window.matchMedia("(max-width: 790px)").matches;
 const hidden=tv||(compact&&state.tab!=="Catalogs");
 const wrapper=$(".top .searchWrap"),field=$("#search");
 if(wrapper){
  wrapper.hidden=hidden;
  wrapper.inert=hidden;
  wrapper.classList?.toggle?.("lumaHeaderSearchHidden",hidden);
  wrapper.setAttribute?.("aria-hidden",hidden?"true":"false");
 }
 if(field){
  field.disabled=hidden;
  field.tabIndex=hidden?-1:0;
  field.setAttribute?.("aria-hidden",hidden?"true":"false");
  if(hidden&&document.activeElement===field){
   const sidebar=tv?$("#lumaTvSidebarSearch"):null;
   if(sidebar?.focus)sidebar.focus({preventScroll:true});
   else field.blur?.();
  }
 }
}
function paint(){
 document.documentElement.style.setProperty("--accent",state.accent);
 document.documentElement.dataset.theme=state.theme;
 document.documentElement.dataset.density=state.density;
 document.documentElement.dataset.tv=(window.LumaNativePlatform==="android-tv"||
  document.documentElement.dataset.lumaNative==="android-tv"||
  new URLSearchParams(location.search||"").get("tv")==="1")?"true":"false";
 syncHeaderSearch();
}
function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.add("visible");setTimeout(()=>t.classList.remove("visible"),4000)}
async function api(url,opts={}){let controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{let r=await fetch(url,{...opts,signal:controller.signal});if(!r.ok)throw Error("Service error "+r.status);return await r.json()}finally{clearTimeout(timer)}}
async function tmdb(endpoint,params={}){if(!state.tmdbKey)throw Error("TMDB not configured");let p=new URLSearchParams({...params,language:(typeof navigator!=="undefined"&&navigator.language)||"en-US"}),token=state.tmdbKey.trim(),headers={};if(token.startsWith("eyJ"))headers.Authorization="Bearer "+token;else p.set("api_key",token);return api("https://api.themoviedb.org/3/"+endpoint+"?"+p, {headers})}
let catalogRequestVersion=0;
let catalogMoreLoading=false,catalogEnd=false,catalogMoreError="",tmdbMorePage=2,tvmazeMorePage=3;
let catalogObserver=null,catalogFallbackBound=false,catalogAutoErrors=0;
let catalogContext="",catalogWarmupKeys=new Set();
function catalogSection(){return ["Catalogs","Movies","TV Shows","Anime"].includes(state.tab)}
function resetCatalogContext(){
 if(!catalogSection()||catalogContext===state.tab)return;
 catalogContext=state.tab;catalogEnd=false;catalogMoreError="";catalogAutoErrors=0;
}
function goToResultsTop(){
 // The new results grid should be visible immediately, without returning to filters.
 const target=$("#content .collectionGrid")||$("#content .collectionHeading")||$("#content");
 if(target?.scrollIntoView)target.scrollIntoView({block:"start",behavior:"auto"});
 else if(typeof scrollTo==="function")scrollTo({top:0,behavior:"auto"});
}
function bindAutoCatalog(){
 if(catalogObserver?.disconnect)catalogObserver.disconnect();
 const marker=$("#catalogAutoLoad");
 if(!marker?.isConnected||!catalogSection()||state.q||catalogEnd||catalogAutoErrors>=3)return;
 const run=()=>{
  if(catalogSection()&&!catalogMoreLoading&&!state.loading&&!catalogEnd&&!state.q&&catalogAutoErrors<3)
   void loadMoreCatalog();
 };
 if(typeof IntersectionObserver!=="undefined"){
  catalogObserver=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting))run()},{rootMargin:"900px 0px"});
  catalogObserver.observe(marker);
 }else if(typeof window!=="undefined"){
  if(!catalogFallbackBound&&typeof window.addEventListener==="function"){
   catalogFallbackBound=true;
   window.addEventListener("scroll",()=>{
    if(!catalogSection()||catalogEnd||state.q)return;
    const el=$("#catalogAutoLoad");if(!el?.getBoundingClientRect)return;
    if(el.getBoundingClientRect().top<(Number(window.innerHeight)||800)+900)run();
   },{passive:true});
  }
 }
 const section=state.tab;
 if(!state.loading&&!catalogWarmupKeys.has(section)){
  catalogWarmupKeys.add(section);
  Promise.resolve().then(async()=>{
   for(let i=0;i<3;i++){
    if(state.tab!==section||state.loading||catalogEnd||state.q||catalogAutoErrors>=3)break;
    await loadMoreCatalog();
   }
  }).catch(()=>{});
 }
}
const CATALOG_CACHE_LIMIT=2200,MAX_CATALOG_TITLES=12000;
const TMDB_DISCOVERY_FEEDS=[
 ["trending/all/week",null],["movie/popular","movie"],["tv/popular","tv"],
 ["movie/top_rated","movie"],["tv/top_rated","tv"],["tv/on_the_air","tv"],
 ["movie/now_playing","movie"],
 ["discover/tv","tv"],["discover/movie","movie"]
];
function fromTMDBFeed(response,kind){
 return (Array.isArray(response?.results)?response.results:[])
  .filter(x=>kind||["movie","tv"].includes(x.media_type))
  .filter(x=>x?.id&&(x.title||x.name))
  .map(x=>normalizeTMDB(kind?{...x,media_type:kind}:x));
}
async function freeCatalogSeed(){
 // Use the legal public metadata endpoints, never guessed titles.
 // TVmaze pages are 250 ID slots each; Apple provides its movie chart.
 const local=new Date(),day=local.getFullYear()+"-"+String(local.getMonth()+1).padStart(2,"0")+"-"+String(local.getDate()).padStart(2,"0");
 const country=viewerCountry().toLowerCase();
 const movieFeed=async()=>{
  try{
   const r=await api("https://itunes.apple.com/"+country+"/rss/topmovies/limit=200/json");
   if(Array.isArray(r?.feed?.entry)&&r.feed.entry.length)return r;
  }catch{}
  return api("https://itunes.apple.com/"+country+"/rss/topmovies/limit=25/json");
 };
 const endpoints=[0,1,2].map(page=>api("https://api.tvmaze.com/shows?page="+page));
 endpoints.push(movieFeed(),api("https://api.tvmaze.com/schedule?country="+viewerCountry()+"&date="+day),
  api("https://api.tvmaze.com/schedule/web?date="+day));
 const responses=await Promise.allSettled(endpoints);
 let rows=[],good=0;
 responses.forEach((r,i)=>{
  if(r.status!=="fulfilled")return;
  if(i<3){
   if(Array.isArray(r.value)){good++;rows.push(...r.value.filter(x=>x.id&&x.image).map(normalizeTVMaze))}
  }else if(i===3){
   const entries=r.value?.feed?.entry;if(Array.isArray(entries)){good++;rows.push(...entries.map(normalizeChart))}
  }else if(Array.isArray(r.value)){
   // Surface newly-airing shows without treating every airing as a first-run.
   good++;rows.push(...r.value.map(e=>e?.show||e?._embedded?.show).filter(x=>x?.id&&x.image).map(normalizeTVMaze));
  }
 });
 if(!good)throw Error("No free catalog sources are available");
 tvmazeMorePage=3;
 return unique(rows);
}
async function discover(){
 const token=++catalogRequestVersion;state.loading=true;state.message="";render();
 let results=[],src="";
 try{
  if(state.tmdbKey){
   const responses=await Promise.allSettled(TMDB_DISCOVERY_FEEDS.map(([endpoint])=>tmdb(endpoint,{page:1,...(endpoint==="discover/tv"||endpoint==="discover/movie"?{with_origin_country:viewerCountry(),sort_by:"popularity.desc"}:{})})));
   const successful=responses.map((r,i)=>r.status==="fulfilled"?fromTMDBFeed(r.value,TMDB_DISCOVERY_FEEDS[i][1]):[]).flat();
   if(successful.length){results=unique(successful);tmdbMorePage=2;src="TMDB"; }
   else {results=await freeCatalogSeed();src="TVmaze and Apple Movies";state.message="TMDB could not load; showing the expanded free catalog.";}
  }else {
   results=await freeCatalogSeed();src="TVmaze and Apple Movies";
  }
 }catch(e){state.message="Catalog unavailable right now. Check your connection or metadata key.";src="Your library";}
 if(token!==catalogRequestVersion)return;
 await LumaReleases.refresh().catch(()=>{});
 if(token!==catalogRequestVersion)return;
 const cached=store("catalog",[]);
 if(results.length)save("catalog",unique([...results,...cached]).slice(0,CATALOG_CACHE_LIMIT));
 if(!results.length)results=cached;
 if(!results.length){results=fallback.map(([id,title,type,year])=>({id,title,type,year,overview:"Browse metadata and add your authorized media sources.",poster:"",backdrop:"",source:"offline",date:year+"-01-01"}));state.message=state.message||"Showing offline catalog picks; live release information is not available."}
 state.source=src;state.items=unique([...state.library.map(normalizeOwn),...LumaReleases.all(),...results,...cached]).slice(0,MAX_CATALOG_TITLES);
 catalogMoreLoading=false;catalogEnd=false;catalogMoreError="";state.loading=false;render();
 void recoverSavedTitles().catch(()=>{});
 void refreshRecommendations();
 // Expand public catalogs in the background: no TMDB key, paid API, login,
 // fictional title, or manual refresh is necessary.
 if(typeof LumaCatalogPlus!=="undefined"){
  Promise.resolve().then(()=>LumaCatalogPlus.seed()).then(rows=>{
   if(token!==catalogRequestVersion||!rows.length)return;
   state.items=unique([...state.items,...rows]).slice(0,MAX_CATALOG_TITLES);
   save("catalog",unique([...state.items.filter(x=>x.source!=="personal"),...store("catalog",[])]).slice(0,CATALOG_CACHE_LIMIT));
   if(["Home","Catalogs","Movies","TV Shows","Anime"].includes(state.tab))render();
  }).catch(()=>{});
 }
}
async function loadMoreCatalog(){
 if(catalogMoreLoading||state.loading||catalogEnd||state.q||state.source==="Your library")return;
 resetCatalogContext();
 const token=catalogRequestVersion;catalogMoreLoading=true;catalogMoreError="";
 const indicator=$("#catalogAutoLoad");if(indicator)indicator.textContent="Loading additional catalog titles automatically…";
 try{
  let rows=[];
  if(typeof LumaCatalogPlus!=="undefined"&&state.tab==="Anime"){
   const next=await LumaCatalogPlus.loadMore("Anime");
   rows=next.items;if(!next.hasNext)catalogEnd=true;
  }else if(state.source==="TMDB"&&state.tmdbKey){
   const page=tmdbMorePage,responses=await Promise.allSettled(TMDB_DISCOVERY_FEEDS.map(([endpoint])=>tmdb(endpoint,{page,...(endpoint==="discover/tv"||endpoint==="discover/movie"?{with_origin_country:viewerCountry(),sort_by:"popularity.desc"}:{})})));
   if(responses.every(r=>r.status!=="fulfilled"))throw Error("No TMDB provider available");
   let hasFuture=false;
   responses.forEach((r,i)=>{if(r.status!=="fulfilled")return;
    rows.push(...fromTMDBFeed(r.value,TMDB_DISCOVERY_FEEDS[i][1]));
    if(Number(r.value.total_pages||0)>page)hasFuture=true;
   });
   tmdbMorePage++;
   if(!hasFuture||tmdbMorePage>60)catalogEnd=true;
  }else if(typeof LumaCatalogPlus!=="undefined"&&["Catalogs","Movies","TV Shows"].includes(state.tab)){
   const next=await LumaCatalogPlus.loadMore(state.tab);
   rows=next.items;
   if(!next.hasNext)catalogEnd=true;
  }else{
   // TVmaze uses stable ID slots; an incomplete page is not the end.
   let page;
   try{page=await api("https://api.tvmaze.com/shows?page="+tvmazeMorePage)}
   catch(e){if(/404/.test(String(e.message||e))){catalogEnd=true;page=[]}else throw e}
   if(!Array.isArray(page))throw Error("Unexpected TVMaze page");
   rows=page.filter(x=>x.image&&x.id).map(normalizeTVMaze);
   tvmazeMorePage++;
   if(!page.length||tvmazeMorePage>100)catalogEnd=true;
  }
  if(token!==catalogRequestVersion)return;
  state.items=unique([...state.items,...rows]).slice(0,MAX_CATALOG_TITLES);
  if(state.items.length>=MAX_CATALOG_TITLES)catalogEnd=true;
  save("catalog",unique([...state.items.filter(x=>x.source!=="personal"),...store("catalog",[])]).slice(0,CATALOG_CACHE_LIMIT));
  if(!rows.length&&!catalogEnd)catalogMoreError="No new titles from this source page yet. Luma will continue as you scroll.";
  catalogAutoErrors=0;
 }catch(e){if(token===catalogRequestVersion){catalogAutoErrors++;catalogMoreError="Additional catalog pages are temporarily unavailable.";}}
 finally{if(token===catalogRequestVersion){
  catalogMoreLoading=false;
  const position=typeof window!=="undefined"?Number(window.scrollY)||0:0;
  const focused=document.activeElement;
  const focusID=focused?.getAttribute?.("data-open");
  render();
  if(position>0&&typeof window!=="undefined"&&typeof window.scrollTo==="function")
   window.scrollTo({top:position,behavior:"instant"});
  if(focusID){
   const target=$$("[data-open]").find(el=>el.getAttribute?.("data-open")===focusID);
   target?.focus?.({preventScroll:true});
  }
 }}
}
let searchTimer=0;
const browse={type:"all",genre:"all",sort:"featured",query:"",page:0};
const mediaBrowse={type:"all",genre:"all",sort:"featured",query:"",page:0};
const libraryView={section:"all",type:"all",sort:"saved",query:"",collection:"all",page:0};
let collectionSearchTimer=0;
function onSearch(value){if(value.trim()&&state.tab!=="Catalogs")state.tab="Catalogs";state.q=value.trim();++catalogRequestVersion;clearTimeout(searchTimer);if(!state.q){discover();return}searchTimer=setTimeout(doSearch,350);render()}
async function doSearch(){
 const token=++catalogRequestVersion,query=state.q;state.loading=true;render();
 try{
  let results=[];
  if(state.tmdbKey){const r=await tmdb("search/multi",{query,include_adult:"false"});results=(r.results||[]).filter(x=>["movie","tv"].includes(x.media_type)).map(normalizeTMDB)}
  else{
   const [shows,movies]=await Promise.allSettled([api("https://api.tvmaze.com/search/shows?q="+encodeURIComponent(query)),api("https://itunes.apple.com/search?country=us&entity=movie&limit=150&term="+encodeURIComponent(query))]);
   results=[...(shows.status==="fulfilled"?shows.value.map(normalizeTVMaze):[]),...(movies.status==="fulfilled"?(movies.value.results||[]).map(normalizeITunes):[])];
  }
  // Search the extended movie, TV and anime directories too; global search
  // must not be limited to the small locally loaded first page.
  if(typeof LumaCatalogPlus!=="undefined"){
   try{results.push(...await LumaCatalogPlus.search("Catalogs",query))}catch{}
  }
  if(token!==catalogRequestVersion||query!==state.q)return;
  state.items=unique([...state.library.map(normalizeOwn),...results]);state.message=results.length?"":"No matching titles found.";
 }catch(e){if(token===catalogRequestVersion)state.message="Search failed. Try again or connect TMDB in Settings."}
 finally{if(token===catalogRequestVersion){state.loading=false;render()}}
}
function persistProfileRegistry(){
 try{return writeLocalRecord("luma.v2.profilesV1",JSON.stringify(profileRegistry))}
 catch{toast("Viewer changes could not be saved on this device.");return false}
}
function createViewer(name){
 const cleaned=cleanProfileName(name);
 if(cleaned.length<2){toast("Enter a viewer name with at least two characters.");return false}
 if(profileRegistry.entries.length>=8){toast("Luma supports up to eight viewer profiles on this device.");return false}
 if(profileRegistry.entries.some(p=>p.name.toLowerCase()===cleaned.toLowerCase())){toast("That viewer name already exists.");return false}
 const id="viewer-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,9);
 if(!/^viewer-[a-z0-9-]{4,50}$/.test(id))return false;
 profileRegistry.entries.push({id,name:cleaned});
 if(!persistProfileRegistry()){profileRegistry.entries.pop();return false}
 return switchViewer(id);
}
function renameViewer(id,name){
 const cleaned=cleanProfileName(name),entry=profileRegistry.entries.find(p=>p.id===id);
 if(!entry||cleaned.length<2)return false;
 if(profileRegistry.entries.some(p=>p.id!==id&&p.name.toLowerCase()===cleaned.toLowerCase()))return false;
 const prior=entry.name;entry.name=cleaned;
 if(!persistProfileRegistry()){entry.name=prior;return false}
 if(id==="default")save("profile",cleaned);
 if(id===profileRegistry.activeId)state.profile=cleaned;
 render();return true;
}
function switchViewer(id){
 if(!profileRegistry.entries.some(p=>p.id===id))return false;
 if(typeof LumaPlayer!=="undefined"&&typeof LumaPlayer.close==="function")try{LumaPlayer.close(true)}catch{}
 if($("#modal")?.innerHTML)closeModal();
 const priorProfile=profileRegistry.activeId;
 profileRegistry.activeId=id;
 if(!persistProfileRegistry()){profileRegistry.activeId=priorProfile;return false}
 for(const field of PROFILE_FIELDS)state[field]=loadProfileField(field,field==="progress"||field==="links"?{}:[]);
 state.profile=activeProfileName();state.selected=null;state.details=null;state.season=1;state.playerKey="";
 state.tab="Home";state.q="";state.filter="all";
 const search=$("#search");if(search)search.value="";
 if(typeof LumaAccounts!=="undefined"&&typeof LumaAccounts.choose==="function")LumaAccounts.choose("device");
 if(typeof LumaMobileNav!=="undefined")LumaMobileNav.close();
 if(typeof recommendationRequest!=="undefined")recommendationRequest++;
 if(typeof recommendationKey!=="undefined")recommendationKey="";
 if(typeof remoteRecommendationRows!=="undefined")remoteRecommendationRows=[];
 render();
 if(typeof refreshRecommendations==="function")void refreshRecommendations();
 return true;
}
function deleteViewer(id){
 if(id==="default"||!profileRegistry.entries.some(p=>p.id===id))return false;
 if(profileRegistry.activeId===id&&!switchViewer("default"))return false;
 const previous=profileRegistry.entries;
 profileRegistry.entries=previous.filter(p=>p.id!==id);
 if(!persistProfileRegistry()){profileRegistry.entries=previous;return false}
 for(const field of PROFILE_FIELDS)try{localStorage.removeItem?.(profileStorageKey(field,id))}catch{}
 render();return true;
}
function profilesMarkup(){
 return '<section class="profileHero"><div class="eyebrow">LUMA · VIEWERS</div><h2>Who is watching?</h2>'
  +'<p>Each viewer has a separate on-device Watchlist, Favorites, watched episodes, Continue Watching and recommendations. Your original saved history stays in the first profile.</p></section>'
  +'<div class="profileCards">'+profileRegistry.entries.map((p,index)=>{
   const active=p.id===profileRegistry.activeId,watch=loadProfileField("watch",[],p.id).length,
    favorites=loadProfileField("favorites",[],p.id).length;
   return '<section class="profileCard'+(active?' active':'')+'">'
    +'<div class="profileIdentity"><span class="profileAvatar" aria-hidden="true">'+["●","★","◆","✦","◉","♥","✳","☾"][index%8]+'</span>'
    +'<div><strong>'+safe(p.name)+'</strong><small>'+watch+' watchlist · '+favorites+' favorites'+(active?' · Watching now':'')+'</small></div></div>'
    +'<div class="profileActions"><button type="button" class="primary" data-profile-switch="'+safe(p.id)+'" '+(active?'aria-current="true"':'')+'>'+(active?'Current viewer':'Switch viewer')+'</button>'
    +'<button type="button" class="secondary" data-profile-edit="'+safe(p.id)+'">Rename</button>'
    +(p.id==="default"?'':'<button type="button" class="secondary profileDelete" data-profile-delete="'+safe(p.id)+'">Delete</button>')+'</div>'
    +'<form class="profileRename" data-profile-rename="'+safe(p.id)+'" hidden><label>Viewer name<input name="viewerName" type="text" maxlength="36" required value="'+safe(p.name)+'"></label><button class="secondary" type="submit">Save name</button></form>'
    +'</section>';
  }).join("")+'</div>'
  +(profileRegistry.entries.length<8?'<form id="createProfileForm" class="profileCreate"><h3>Add a viewer</h3><label>Viewer name<input name="viewerName" type="text" maxlength="36" required placeholder="Name for this profile" autocomplete="off"></label><button type="submit" class="primary">+ Create profile</button></form>':'<p class="micro">The maximum of eight viewers has been reached.</p>')
  +'<p class="micro">Profiles are saved on this device. Connected IPTV providers, add-ons and Trakt/Simkl sign-ins remain shared; these are not password-protected accounts or cloud-synced profiles. Deleting a viewer deletes only that viewer’s local viewing history. The original profile cannot be deleted.</p>';
}
function bindProfiles(){
 $$("[data-profile-switch]").forEach(btn=>btn.onclick=()=>switchViewer(btn.dataset.profileSwitch));
 $$("[data-profile-edit]").forEach(btn=>btn.onclick=()=>{
  const form=$$("[data-profile-rename]").find(el=>el.dataset.profileRename===btn.dataset.profileEdit);
  if(form){form.hidden=!form.hidden;if(!form.hidden)form.querySelector("input")?.focus?.()}
 });
 $$("[data-profile-rename]").forEach(form=>form.onsubmit=e=>{
  e.preventDefault();const name=form.querySelector("input")?.value||"";
  if(!renameViewer(form.dataset.profileRename,name))toast("Choose a different viewer name.");
 });
 $$("[data-profile-delete]").forEach(btn=>btn.onclick=()=>{
  const id=btn.dataset.profileDelete,profile=profileRegistry.entries.find(p=>p.id===id);
  if(!profile)return;
  if(typeof confirm==="function"&&!confirm('Delete viewer "'+profile.name+'" and their saved viewing history on this device?'))return;
  deleteViewer(id);
 });
 const create=$("#createProfileForm");
 if(create)create.onsubmit=e=>{
  e.preventDefault();
  const name=create.querySelector("input")?.value||"";
  if(!createViewer(name))toast("Could not create this viewer. Check the name and available slots.");
 };
}
function nav(){
 const pill=$("#lumaProfileQuick");
 if(pill){pill.textContent="● "+state.profile;pill.setAttribute?.("aria-label","Switch viewer profile. Current viewer: "+state.profile);pill.onclick=()=>{state.tab="Profiles";state.q="";render()}}
 const tvBar=$("#lumaTvNav");
 if(tvBar&&document.documentElement.dataset.tv==="true"&&typeof LumaTVExperience!=="undefined"){
  LumaTVExperience.nav(tvBar,state.tab);
  document.body.classList.add("tvNavigationReady");
 }else document.body.classList.remove("tvNavigationReady");
 const pages=[["Home","⌂"],["Catalogs","▦"],["Streaming","◉"],["Live TV","▣"],["Guide","▦"],["Recordings","●"],["IPTV Library","▤"],["Movies","▣"],["TV Shows","▤"],["Anime","✧"],["Releases","◷"],["Calendar","▦"],["Add-ons","✦"],["Watchlist","+"],["Favorites","♥"],["Continue Watching","▶"],["My Library","▰"],["Profiles","◉"],["Settings","⚙"]];
 const quick=new Set(["Home","Live TV","Guide","Recordings","Movies","TV Shows","Anime","Watchlist","My Library"]);
 quick.add("Favorites");
 const extras=pages.filter(([name])=>!quick.has(name)&&name!=="Settings");
 const button=([name,icon])=>'<button class="navbutton '+(name===state.tab||state.tab==="Collection"&&name==="Catalogs"?"active":"")+'" data-tab="'+name+'" aria-current="'+(name===state.tab?"page":"false")+'"><span aria-hidden="true">'+icon+'</span><span>'+ (name==="Add-ons"?"Luma Add-ons":name==="Watchlist"?"My Watchlist":name)+'</span></button>';
 const primary=pages.filter(([name])=>quick.has(name)).map(row=>{
  const name=row[0];
  return (name==="Live TV"?'<span class="navGroupCaption" role="heading" aria-level="2">TELEVISION</span>':name==="Movies"?'<span class="navGroupCaption" role="heading" aria-level="2">DISCOVER</span>':name==="Watchlist"?'<span class="navGroupCaption" role="heading" aria-level="2">YOUR STUFF</span>':"")+button(row);
 }).join("");
 const showMore=extras.some(([name])=>name===state.tab);
 $("#navigation").innerHTML='<div class="lumaNavWelcome"><span class="lumaNavDot"></span><div><b>YOUR ENTERTAINMENT</b><small>Movies · Shows · Live TV</small></div></div>'
  +'<button class="navbutton lumaNavSearch" id="lumaNavSearch"><span aria-hidden="true">⌕</span><span>Search everything</span></button>'
  +primary
  +'<details class="lumaNavMore" '+(showMore?"open":"")+'><summary><span aria-hidden="true">☷</span> More to explore <span class="lumaNavChevron" aria-hidden="true">⌄</span></summary>'
  +'<div class="lumaNavExtra">'+extras.map(button).join("")+'</div></details>'
  +'<span class="navGroupCaption" role="heading" aria-level="2">PREFERENCES</span>'+button(["Settings","⚙"]);
 $$("[data-tab]").forEach(b=>b.onclick=()=>{
  state.tab=b.dataset.tab;state.q="";$("#search").value="";state.filter="all";render();
  if(typeof scrollTo==="function")scrollTo({top:0,behavior:document.documentElement.dataset.tv==="true"?"auto":"smooth"});
 });
 const tvViewer=$("#lumaTvProfile");
 if(tvViewer){tvViewer.onclick=()=>{state.tab="Profiles";state.q="";render()};tvViewer.setAttribute?.("aria-label","Choose viewer. Current viewer "+state.profile)}
 const more=$("#lumaTvMore");
 if(more)more.onclick=()=>window.LumaNavigation?.openMenu?.();
 const tvSearch=$("#lumaTvSearch");
 if(tvSearch)tvSearch.onclick=()=>{
  if(state.tab!=="Catalogs"){state.tab="Catalogs";render()}
  const sidebarInput=$("#lumaTvSidebarSearch");
  sidebarInput?.focus?.({preventScroll:true});
  sidebarInput?.select?.();
 };
 if(typeof LumaMobileNav!=="undefined")LumaMobileNav.render(state.tab);
 const searchButton=$("#lumaNavSearch");
 if(searchButton)searchButton.onclick=()=>{
  if(["Live TV","Guide","Recordings"].includes(state.tab)){state.tab="Catalogs";render()}
  const input=$("#search");if(input){input.focus({preventScroll:false});input.scrollIntoView?.({block:"nearest"})}
 };
}

/* Latest aired television episode; a whole-series watched flag never clears it. */
const lastAiredCache=store("lastAiredV1",{}),lastAiredItems=new Map(),lastAiredQueue=[],lastAiredInFlight=new Set();
let lastAiredBusy=0,lastAiredObserver=null;
function lastAiredShow(x){return x?.type==="Series"||x?.type==="Anime"}
function airDay(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function normalizeLastAired(e){
 const season=Number(e?.season_number??e?.season),number=Number(e?.episode_number??e?.number),date=String(e?.air_date||e?.airdate||"").slice(0,10);
 if(!Number.isInteger(season)||season<1||!Number.isInteger(number)||number<1||!/^\d{4}-\d\d-\d\d$/.test(date)||!Number.isFinite(Date.parse(date+"T12:00:00Z")))return null;
 const stamp=Date.parse(e?.airstamp||"");
 if(Number.isFinite(stamp)?stamp>Date.now():date>=airDay())return null;
 return {season,number,date,name:String(e?.name||"").slice(0,90)};
}
function latestAired(x){return lastAiredCache[x?.id]?.episode||null}
function hasWatchedAired(x,ep=latestAired(x)){
 if(!ep)return false;
 const keys=[x.id+":s"+ep.season+"e"+ep.number];
 for(const id of [x.imdbId,x.stremioID].filter(Boolean))keys.push("stremio:"+id+":"+ep.season+":"+ep.number);
 return keys.some(k=>state.watched.includes(k)||Number(state.progress[k]?.fraction)>=.98);
}
function newestAired(a,b){if(!a)return b;if(!b)return a;return b.date>a.date?b:b.date<a.date?a:b.season>a.season?b:b.season<a.season?a:b.number>a.number?b:a}
function lastAiredContent(x){
 const e=latestAired(x);if(!lastAiredShow(x)||!e||hasWatchedAired(x,e))return "";
 const days=Math.floor((Date.parse(airDay()+"T12:00:00Z")-Date.parse(e.date+"T12:00:00Z"))/86400000);
 const fresh=days>=0&&days<7,when=new Date(e.date+"T12:00:00Z").toLocaleDateString(undefined,{month:"short",day:"numeric",timeZone:"UTC"});
 return '<span class="latestAired '+(fresh?"fresh":"older")+'" title="'+safe(e.name||"Latest aired episode")+'"><strong>'+(fresh?"NEW EPISODE":"LAST AIRED")+'</strong><span>'+safe(when)+'</span><b>S'+String(e.season).padStart(2,"0")+'E'+String(e.number).padStart(2,"0")+'</b></span>';
}
function lastAiredSlot(x){if(!lastAiredShow(x))return "";lastAiredItems.set(x.id,x);return '<span class="lastAiredSlot" data-last-aired="'+safe(x.id)+'">'+lastAiredContent(x)+'</span>'}
function refreshLastAired(x){
 if(!document.querySelectorAll)return;
 for(const el of document.querySelectorAll(".lastAiredSlot[data-last-aired]"))if(el.getAttribute("data-last-aired")===x.id)el.innerHTML=lastAiredContent(x);
 const detail=$("#latestAiredDetail");
 if(detail&&state.selected?.id===x.id){detail.innerHTML=latestAiredDetail(x);bindLatestAired(x)}
}
function saveLastAired(x,row){
 if(!lastAiredShow(x)||!x.id)return;
 const next=normalizeLastAired(row),prev=latestAired(x);
 lastAiredCache[x.id]={episode:newestAired(prev,next)||null,checked:Date.now()};
 const keys=Object.keys(lastAiredCache);if(keys.length>600)keys.sort((a,b)=>lastAiredCache[b].checked-lastAiredCache[a].checked).slice(600).forEach(k=>delete lastAiredCache[k]);
 save("lastAiredV1",lastAiredCache);refreshLastAired(x);
}
function matchAiredShow(x,y){return !!y?.id&&langNorm(x.title)===langNorm(y.name)&&(!x.year||!y.premiered||Math.abs(Number(String(y.premiered).slice(0,4))-Number(x.year))<=1)}
async function findLatestAired(x){
 if(state.tmdbKey&&x.tmdbId)try{const result=await tmdb("tv/"+Number(x.tmdbId));const ep=normalizeLastAired(result.last_episode_to_air);if(ep)return ep}catch{}
 let id=Number(x.mazeId)||0;
 const imdb=String(x.imdbId||x.stremioID||"");
 if(!id&&/^tt\d+$/.test(imdb)){const y=await api("https://api.tvmaze.com/lookup/shows?imdb="+encodeURIComponent(imdb)).catch(()=>null);if(matchAiredShow(x,y))id=Number(y.id)}
 if(!id){const found=await api("https://api.tvmaze.com/search/shows?q="+encodeURIComponent(cleanLangTitle(x))).catch(()=>[]);const options=(Array.isArray(found)?found:[]).map(v=>v.show).filter(y=>matchAiredShow(x,y));if(options.length===1)id=Number(options[0].id)}
 if(!id)return null;
 const show=await api("https://api.tvmaze.com/shows/"+id+"?embed=previousepisode");return normalizeLastAired(show?._embedded?.previousepisode);
}
function runLastAiredQueue(){while(lastAiredBusy<2&&lastAiredQueue.length){
 const x=lastAiredQueue.shift(),key=x.id;lastAiredBusy++;
 Promise.resolve().then(()=>findLatestAired(x)).then(ep=>saveLastAired(x,ep)).catch(()=>{}).finally(()=>{lastAiredBusy--;lastAiredInFlight.delete(key);runLastAiredQueue()});
}}
function queueLastAired(x){
 if(!lastAiredShow(x)||!x.id||["offline","personal"].includes(x.source))return;
 const cached=lastAiredCache[x.id];if(cached&&Date.now()-cached.checked<(cached.episode?6:1)*3600000||lastAiredInFlight.has(x.id))return;
 lastAiredInFlight.add(x.id);lastAiredQueue.push(x);runLastAiredQueue();
}
function observeLastAired(){
 if(!document.querySelectorAll||typeof IntersectionObserver!=="function")return;
 lastAiredObserver?.disconnect();lastAiredObserver=new IntersectionObserver(entries=>{for(const ent of entries)if(ent.isIntersecting){
  lastAiredObserver.unobserve(ent.target);const x=lastAiredItems.get(ent.target.getAttribute("data-last-aired"));if(x)queueLastAired(x);
 }},{rootMargin:"250px"});
 for(const el of document.querySelectorAll(".lastAiredSlot[data-last-aired]"))lastAiredObserver.observe(el);
}
function latestAiredDetail(x){
 const e=latestAired(x);if(!lastAiredShow(x)||!e)return "";
 const date=new Date(e.date+"T12:00:00Z").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
 return '<div class="lastAiredDetail"><div><strong>Latest aired · '+safe(date)+'</strong><small>S'+String(e.season).padStart(2,"0")+'E'+String(e.number).padStart(2,"0")+(e.name?' · '+safe(e.name):"")+'</small></div><button type="button" id="markLastAired" class="secondary small">'+(hasWatchedAired(x,e)?"Mark unwatched":"✓ Mark latest watched")+'</button></div>';
}
function bindLatestAired(x){const button=$("#markLastAired");if(!button)return;button.onclick=()=>{const ep=latestAired(x);if(!ep)return;const key=x.id+":s"+ep.season+"e"+ep.number;state.watched=state.watched.includes(key)?state.watched.filter(id=>id!==key):[...state.watched,key];save("watched",state.watched);refreshLastAired(x)}}

function itemHTML(x){
 if(x?.unresolved){
  return '<article class="media lumaMissingCard"><div class="lumaMissingInner"><strong>Metadata unavailable</strong><p>Your saved entry is preserved. Luma could not yet recover its original metadata.</p><small>'+safe(x.id)+'</small><button type="button" class="secondary small" data-title-retry="'+safe(x.id)+'">Retry metadata</button></div></article>';
 }
 const currentProgress=progressForTitle(x),p=currentProgress.fraction,badge=LumaReleases.label(x),
  poster=safeArtworkUrl(x.poster)||safeArtworkUrl(x.backdrop),
  tags=(x.genreNames||[]).slice(0,2).filter(Boolean);
 return '<button type="button" class="media lumaMediaCard" data-open="'+safe(x.id)+'" aria-label="Details for '+safe(x.title)+'">'
  +'<div class="art '+(!poster?"no-art":"has-art")+'" style="--c1:'+colorPick[x.title.length%colorPick.length]+'">'
  +'<div class="posterText">'+safe(x.title)+'</div>'
  +(poster?'<img loading="lazy" src="'+safe(poster)+'" alt="" onerror="this.remove()"/>':'')
  +'<span class="lumaCardOpen" aria-hidden="true">▶ Details</span>'
  +(state.watch.includes(x.id)?'<span class="pin" aria-label="In watchlist">+</span>':'')
  +(state.favorites.includes(x.id)?'<span class="favoritePin" aria-label="Favorite">♥</span>':'')
  +(badge?'<span class="releaseFlag">'+safe(badge)+'</span>':'')+'</div>'
  +'<div class="iteminfo"><b>'+safe(x.title)+'</b>'
  +'<div class="cardFacts"><span class="cardYear">'+safe(x.year||"Year TBD")+'</span><span class="cardMediaType">'+safe(x.type)+'</span>'
  +audienceBadge(x)+certificateSlot(x)+'</div>'
  +lastAiredSlot(x)
  +languageBadges(x)
  +(tags.length?'<small class="cardGenres">'+safe(tags.join(" · "))+'</small>':'')
  +(x.availabilityLabel?'<small class="cardAvailability">'+safe(x.availabilityLabel)+(x.availabilityRegion?' · '+safe(x.availabilityRegion):'')+' · '+(x.offerType==="free"?"Free / ads":"Subscription")+'</small>':"")
  +(x.cinemaVerified&&x.theatricalDate?'<small class="cinemaReleaseDate">'+(x.cinemaKind==="upcoming"?"Premieres":"In cinemas since")+' · '+safe(new Date(x.theatricalDate+"T12:00:00Z").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}))+(x.cinemaRegion?' · '+safe(x.cinemaRegion):'')+'</small>':"")
  +(currentProgress.label?'<small class="cardResume">Resume '+safe(currentProgress.label)+'</small>':'')
  +(p>0&&p<.98?'<div class="track" aria-label="'+Math.round(p*100)+' percent watched"><div style="width:'+Math.floor(p*100)+'%"></div></div>':'')
  +'</div></button>';
}
function shelf(title,items,subtitle="",page=""){
 const entries=unique((items||[]).filter(Boolean)).slice(0,25);
 if(!entries.length)return "";
 const category=LumaCollections.collectionID(title,page);
 return '<section class="shelf lumaShelf"><div class="shelfhead">'
  +'<button type="button" class="shelfHeadingLink" data-collection-id="'+safe(category)+'" aria-label="Explore more in '+safe(title)+'">'
  +'<h2>'+safe(title)+'</h2>'+(subtitle?'<p class="shelfDescription">'+safe(subtitle)+'</p>':'')
  +'<span class="shelfHeadingExplore">Explore collection ›</span></button>'
  +'<div class="railActions"><button type="button" class="shelfViewAll" data-collection-id="'+safe(category)+'">See all <span aria-hidden="true">›</span></button>'
  +'<span class="shelfCount">'+entries.length+' titles</span>'
  +'<button class="railArrow" data-scroll="-1" aria-label="Scroll '+safe(title)+' left">‹</button>'
  +'<button class="railArrow" data-scroll="1" aria-label="Scroll '+safe(title)+' right">›</button></div></div>'
  +'<div class="tiles" tabindex="0" aria-label="'+safe(title)+' horizontal titles">'+entries.map(itemHTML).join("")+'</div></section>';
}
let featuredIndex=0;
function hero(items){
 const picks=unique((items||[]).filter(x=>x&&(safeArtworkUrl(x.backdrop)||safeArtworkUrl(x.poster)))).slice(0,12);
 if(!picks.length)return '<section class="hero heroCinematic fallbackHero"><div class="heroInfo"><div class="eyebrow">LUMA · DISCOVER</div><h2>Movies, series & stories you’ll love</h2><p>Explore releases, browse your library and find something worth watching.</p><div class="actions"><button class="primary" data-go="Catalogs">Explore catalogs</button><button class="secondary" data-go="TV Shows">Browse series</button></div></div></section>';
 featuredIndex=((featuredIndex%picks.length)+picks.length)%picks.length;
 const x=picks[featuredIndex],src=safeArtworkUrl(x.backdrop)||safeArtworkUrl(x.poster),genres=(x.genreNames||[]).slice(0,2).join(" · ");
 return '<section class="hero heroCinematic" aria-label="Featured: '+safe(x.title)+'">'
  +'<img class="heroVisual" src="'+safe(src)+'" alt="" fetchpriority="high" onerror="this.classList.add(\'imageFailed\')">'
  +'<div class="heroVeil"></div><div class="heroInfo"><div class="eyebrow">✦ NOW DISCOVERING · '+(featuredIndex+1)+' / '+picks.length+'</div>'
  +'<h2>'+safe(x.title)+'</h2><div class="heroMeta">'+safe([x.year,x.type,genres].filter(Boolean).join(" · "))
  +(Number(x.rating)>0?' · ★ '+safe(Number(x.rating).toFixed(1)):'')+'</div>'
  +'<p>'+safe(String(x.overview||"Find out why this title is worth exploring.").slice(0,260))+'</p>'
  +'<div class="actions"><button class="primary" data-open="'+safe(x.id)+'">▶ View details</button>'
  +'<button class="secondary" data-watch="'+safe(x.id)+'">'+(state.watch.includes(x.id)?"✓ In watchlist":"+ Add to watchlist")+'</button></div>'
  +'<div class="heroControls"><button type="button" data-hero-shift="-1" aria-label="Previous featured title">‹</button>'
  +'<button type="button" data-hero-shift="1" aria-label="Next featured title">›</button><span>Discover more</span></div></div></section>';
}
function cinematicHomeIntro(items){
 const titles=unique((items||[]).filter(x=>x?.id&&x.title));
 const movieCount=titles.filter(x=>x.type==="Movie").length,
    seriesCount=titles.filter(x=>x.type==="Series"||x.type==="Anime").length,
    watchCount=state.watch.length;
 return '<section class="cineIntro"><div><span class="eyebrow">LUMA · YOUR CINEMA UNIVERSE</span>'
   +'<h2>Every night deserves a great story.</h2>'
   +'<p>Find the next film you cannot stop thinking about, catch the newest episode, or return to an old favourite. Your cinema, your way.</p>'
   +'<div class="cineQuickLinks">'
   +'<button data-cine-go="Movies">◉ Browse movies</button><button data-cine-go="TV Shows">▤ Find series</button>'
   +'<button data-cine-go="Live TV">▶ Watch live TV</button><button data-cine-go="Calendar">◷ Premieres calendar</button><button data-cine-go="Watchlist">+ My watchlist</button><button data-cine-go="Favorites">♥ Favorites</button></div></div>'
   +'<div class="cineIntroStats"><span><b>'+movieCount+'</b><small>Movies to explore</small></span>'
   +'<span><b>'+seriesCount+'</b><small>Series & anime</small></span>'
   +'<span><b>'+watchCount+'</b><small>Saved to watchlist</small></span></div></section>';
}
function homeDiscoveryRows(items){
 const all=unique((items||[]).filter(x=>x.title&&x.id)),shows=all.filter(x=>x.type==="Series"),
  anime=all.filter(x=>x.type==="Anime"||(x.genreNames||[]).includes("Animation")),
  movies=all.filter(x=>x.type==="Movie"),
  ratings=all.filter(x=>Number(x.rating)>=7).sort((a,b)=>Number(b.rating)-Number(a.rating)),
  recent=all.filter(x=>x.date&&Date.parse(x.date)&&Date.parse(x.date)<=Date.now())
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const genre=g=>all.filter(x=>(x.genreNames||[]).some(t=>t.toLowerCase().includes(g)));
 const saved=libraryGroups().saved,favorites=libraryGroups().favorites;
 return (typeof LumaHome==="undefined"?shelf("Continue watching",libraryGroups().watching,"Pick up where you left off"):"")
  +shelf("Your watchlist",saved,"Saved for another night","Watchlist")
  +shelf("Your favorites",favorites,"Titles you love, separate from your watchlist","Favorites")
  +shelf("TV series to explore",shows,"New seasons, familiar favorites and more","TV Shows")
  +shelf("Movies for tonight",movies,"Find your next movie","Movies")
  +shelf("Anime & animation",anime,"Animated stories from the catalog","Anime")
  +shelf("Top rated",ratings,"Well-rated titles from your available metadata","Catalogs")
  +shelf("Adventure & fantasy",genre("adventure").concat(genre("fantasy")),"Big worlds and epic stories","Catalogs")
  +shelf("Science fiction worlds",genre("science fiction").concat(genre("sci-fi")),"From distant galaxies to future technology","Catalogs")
  +shelf("Comedy nights",genre("comedy"),"Something lighter for tonight","Catalogs")
  +shelf("Mystery & crime",genre("mystery").concat(genre("crime")),"Cases, secrets and investigations","Catalogs")
  +shelf("Horror & thrillers",genre("horror").concat(genre("thriller")),"Suspense and frightening favorites","Catalogs")
  +shelf("Documentary discoveries",genre("documentary"),"True stories and real-world discoveries","Catalogs")
  +shelf("Recently released",recent,"Titles with recent reported release dates","Releases")
  +(suggestedTitles(all).length?shelf("Because you saved these genres",suggestedTitles(all),"Based on your saved and watched titles","Catalogs"):"");
}

function parentOfPlaybackKey(key,lookup,all){
 if(lookup.has(key))return lookup.get(key);
 const parent=key.replace(/:s\d+e\d+$/i,"");
 if(lookup.has(parent))return lookup.get(parent);
 const id=parent.replace(/^stremio:/,"").replace(/:\d+:\d+$/,"");
 return all.find(x=>id&&(x.imdbId===id||x.stremioID===id))||null;
}
function progressForTitle(x){
 const keys=Object.entries(state.progress||{}).filter(([key,record])=>{
   const id=key.replace(/:s\d+e\d+$/i,"");
   return id===x.id||key===x.id||x.imdbId&&key.startsWith("stremio:"+x.imdbId)
     ||x.stremioID&&key.startsWith("stremio:"+x.stremioID);
 }).filter(([key,record])=>(record?.fraction||0)>0&&record.fraction<.98&&!state.watched.includes(key));
 keys.sort((a,b)=>(b[1]?.updated||0)-(a[1]?.updated||0));
 if(!keys.length)return {fraction:0,label:"",seconds:0,season:null,episode:null,key:""};
 const [key,record]=keys[0],ep=key.match(/:s(\d+)e(\d+)$/i)||key.match(/:(\d+):(\d+)$/);
 return {fraction:Math.max(0,Math.min(1,Number(record.fraction)||0)),
  label:ep?"S"+Number(ep[1])+"E"+Number(ep[2]):"",
  seconds:Math.max(0,Number(record.seconds)||0),
  season:ep?Number(ep[1]):null,episode:ep?Number(ep[2]):null,key};
}
// Never merge by title or year: only confirmed external identifiers identify a work.
function canonicalMediaIdentity(x){
 const type=x?.type==="Movie"?"movie":x?.type==="Series"||x?.type==="Anime"?"series":"";
 const imdb=String(x?.imdbId||"").replace(/^imdb:/,"");
 if(type&&/^tt\d{5,12}$/.test(imdb))return "imdb:"+type+":"+imdb;
 const mediaType=x?.mediaType|| (type==="movie"?"movie":"");
 if((mediaType==="movie"||mediaType==="tv")&&Number.isSafeInteger(Number(x?.tmdbId))&&Number(x.tmdbId)>0)
  return "tmdb:"+mediaType+":"+x.tmdbId;
 if(x?.animeId&&type==="series")return "anilist:"+x.animeId;
 if(x?.itunesId&&type==="movie")return "itunes:"+x.itunesId;
 return "id:"+String(x?.id||"");
}
function uniqueMediaCards(items){
 const seen=new Map(),order=[];
 for(const x of items){
  if(!x?.id)continue;
  const key=x.unresolved?"id:"+x.id:canonicalMediaIdentity(x);
  if(!seen.has(key)){seen.set(key,x);order.push(key);continue}
  const prior=seen.get(key);
  // Enrich missing artwork/details, but retain the first saved ID and links.
  seen.set(key,{...prior,poster:prior.poster||x.poster||"",year:prior.year||x.year||"",
   overview:prior.overview||x.overview||"",backdrop:prior.backdrop||x.backdrop||""});
 }
 return order.map(key=>seen.get(key));
}
function libraryGroups(){
 const device=LumaAccounts.deviceItems();
 const personal=state.library.map(normalizeOwn);
 const known=unique([...device,...personal,...state.items,...store("catalog",[])]);
 const byID=new Map(known.map(x=>[x.id,x]));
 const snapshots=(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")}catch{return{}}})();
  const fromIDs=ids=>unique(ids.map(id=>byID.get(id)||snapshots[id]).filter(Boolean));
 const saved=uniqueMediaCards(fromIDs(state.watch)),favorites=uniqueMediaCards(fromIDs(state.favorites));
 const watching=unique(Object.entries(state.progress||{})
   .filter(([,p])=>(p?.fraction||0)>.001&&(p?.fraction||0)<.98)
   .sort((a,b)=>(b[1]?.updated||0)-(a[1]?.updated||0))
   .map(([id])=>parentOfPlaybackKey(id,byID,known)).filter(Boolean));
 const watched=fromIDs(state.watched);
 return {all:uniqueMediaCards([...watching,...saved,...favorites,...watched,...personal]),saved,favorites,watching,watched,personal};
}
/* Hybrid recommendations: completed titles + favorites + watchlist are the signals.
   An already watched title, season in progress, or saved title is never a "new" recommendation.
   Use verified external IDs; titles alone never identify a different work. */
let remoteRecommendationRows=[],recommendationRequest=0,recommendationKey="";
function recommendationLibrary(){
 const groups=libraryGroups();
 const all=unique([...groups.all,...state.items,...store("catalog",[])]);
 const byID=new Map(all.map(x=>[x.id,x]));
 const seen=new Map();
 const add=(x,weight)=>{
  if(!x?.id||!x?.title)return;
  const old=seen.get(x.id);
  if(!old||weight>old.weight)seen.set(x.id,{item:x,weight});
 };
 groups.favorites.forEach(x=>add(x,6));
 groups.saved.forEach(x=>add(x,3));
 [...state.watched,...Object.keys(state.progress||{}).filter(k=>Number(state.progress[k]?.fraction)>=.98)]
  .forEach(id=>{
   const parent=String(id).replace(/:s\d+e\d+$/i,"");
   add(byID.get(parent),4);
  });
 return [...seen.values()].sort((a,b)=>b.weight-a.weight);
}
function recommendationExcludedKeys(){
 const groups=libraryGroups();
 const byID=new Map(unique([...groups.all,...state.items,...store("catalog",[])]).map(x=>[x.id,x]));
 const blocked=new Set([...state.watched,...state.watch,...state.favorites,...Object.keys(state.progress||{})]);
 const all=[...blocked].map(id=>byID.get(String(id).replace(/:s\d+e\d+$/i,""))).filter(Boolean);
 const canon=new Set();
 for(const x of all){
  if(x.tmdbId)canon.add("tmdb:"+String(x.tmdbId)+":"+(x.type==="Movie"?"movie":"tv"));
  if(x.imdbId)canon.add("imdb:"+String(x.imdbId).toLowerCase());
  if(x.malId)canon.add("mal:"+x.malId);
  if(x.title&&x.year)canon.add("title:"+String(x.type)+"|"+String(x.title).trim().toLowerCase()+"|"+x.year);
 }
 return {blocked,canon};
}
function recommendationIsUnseen(x,excluded=recommendationExcludedKeys()){
 if(!x?.id||!x?.title||!x.poster||excluded.blocked.has(x.id))return false;
 if(x.tmdbId&&excluded.canon.has("tmdb:"+String(x.tmdbId)+":"+(x.type==="Movie"?"movie":"tv")))return false;
 if(x.imdbId&&excluded.canon.has("imdb:"+String(x.imdbId).toLowerCase()))return false;
 if(x.malId&&excluded.canon.has("mal:"+x.malId))return false;
 if(x.year&&excluded.canon.has("title:"+String(x.type)+"|"+String(x.title).trim().toLowerCase()+"|"+x.year))return false;
 return true;
}
function suggestedTitles(items){
 const signals=recommendationLibrary(),excluded=recommendationExcludedKeys();
 if(!signals.length)return [];
 const genres=new Map(),kinds=new Map(),langs=new Map();
 for(const {item:x,weight} of signals){
  for(const genre of x.genreNames||[]){
   const name=String(genre).trim().toLowerCase();
   if(name)genres.set(name,(genres.get(name)||0)+weight);
  }
  kinds.set(x.type,(kinds.get(x.type)||0)+weight);
  const language=String(x.original_language||"").toLowerCase();
  if(language)langs.set(language,(langs.get(language)||0)+weight);
 }
 const scored=unique([...(remoteRecommendationRows||[]),...(items||[])]).filter(x=>recommendationIsUnseen(x,excluded)).map(x=>{
  const genreScore=(x.genreNames||[]).reduce((total,g)=>total+(genres.get(String(g).toLowerCase())||0),0);
  const direct=Number(x.recommendedByTMDB)||0;
  const score=genreScore*2+direct*22
    +((genreScore||direct)?(kinds.get(x.type)||0)*.35:0)
    +(langs.has(String(x.original_language||"").toLowerCase())?3:0)
    +(countryVerified(x)?4:0)
    +Math.min(6,Number(x.rating)||0);
  return {x,score,match:genreScore>0||direct>0};
 }).filter(row=>row.match);
 scored.sort((a,b)=>b.score-a.score||String(a.x.title).localeCompare(String(b.x.title)));
 const seen=new Set();
 return scored.filter(({x})=>{
  const k=x.tmdbId?"tmdb:"+x.tmdbId+":"+(x.type==="Movie"?"movie":"tv"):
    x.imdbId?"imdb:"+x.imdbId:"title:"+x.type+":"+x.title.toLowerCase()+":"+x.year;
  if(seen.has(k))return false;
  seen.add(k);return true;
 }).slice(0,24).map(row=>row.x);
}
async function refreshRecommendations(){
 if(!state.tmdbKey)return;
 const seeds=recommendationLibrary().filter(({item:x})=>x.tmdbId&&["Movie","Series","Anime"].includes(x.type)).slice(0,6);
 if(!seeds.length)return;
 const seedKey=viewerCountry()+"|"+seeds.map(x=>x.item.id+":"+x.weight).join(",");
 if(seedKey===recommendationKey)return;
 recommendationKey=seedKey;
 const request=++recommendationRequest;
 const jobs=await Promise.allSettled(seeds.map(async ({item,weight})=>{
  const type=item.type==="Movie"?"movie":"tv";
  const data=await tmdb(type+"/"+item.tmdbId+"/recommendations",{page:1});
  return (data.results||[]).slice(0,20).map(row=>({
   ...normalizeTMDB({...row,media_type:type}),
   recommendedByTMDB:Math.max(1,weight/2)
  }));
 }));
 if(request!==recommendationRequest)return;
 const good=jobs.filter(x=>x.status==="fulfilled").flatMap(x=>x.value);
 if(good.length){
  remoteRecommendationRows=unique(good);
  if(state.tab==="Home"||state.tab==="Catalogs")render();
 }else recommendationKey="";
}
function tilesPage(items,page,size=24){
 const count=Math.max(1,Math.ceil(items.length/size));
 const index=Math.max(0,Math.min(page,count-1));
 return {page:index,pages:count,total:items.length,items:items.slice(index*size,(index+1)*size)};
}
function collectionPager(prefix,result){
 if(result.pages<=1)return "";
 return '<nav class="collectionPager" aria-label="Results pages"><button class="secondary" id="'+prefix+'Prev" '+(result.page===0?'disabled':'')+'>← Previous</button><span>Page '+(result.page+1)+' of '+result.pages+'</span><button class="secondary" id="'+prefix+'Next" '+(result.page+1===result.pages?'disabled':'')+'>Next →</button></nav>';
}
function selectOptions(options,value){
 return options.map(([id,label])=>'<option value="'+safe(id)+'"'+(id===value?' selected':'')+'>'+safe(label)+'</option>').join("");
}
function sortedTitles(items,order){
 const out=[...items];
 if(order==="title")out.sort((a,b)=>String(a.title||"").localeCompare(String(b.title||"")));
 if(order==="year")out.sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0));
 if(order==="rating")out.sort((a,b)=>(Number(b.rating)||0)-(Number(a.rating)||0));
 return out;
}
function channelSearchMarkup(query){
 const q=String(query||"").trim().toLowerCase();
 if(q.length<2||typeof LumaIPTV==="undefined"||typeof LumaIPTV.channels!=="function")return "";
 const channels=LumaIPTV.channels();if(!Array.isArray(channels))return "";
 const matches=channels.filter(ch=>
   [ch.name,ch.group,ch.provider,ch.tvg_name].some(v=>String(v||"").toLowerCase().includes(q))).slice(0,18);
 if(!matches.length)return "";
 return '<section class="lumaChannelSearch" aria-label="Matching live TV channels"><div class="collectionHeading"><h2>Live TV channels</h2><span>'+matches.length+' matches</span></div>'
  +'<div class="lumaChannelSearchGrid">'+matches.map(ch=>'<button type="button" class="lumaChannelSearchCard" data-search-channel="'+safe(ch.id)+'"><span aria-hidden="true">▣</span><b>'+safe(ch.name)+'</b><small>'+safe(ch.group||"Watch live")+'</small></button>').join("")+'</div></section>';
}
function catalogMarkup(items){
 const section=state.tab,focused=["Movies","TV Shows","Anime"].includes(section),view=focused?mediaBrowse:browse;
 resetCatalogContext();
 const title=section==="Movies"?"Explore the movie library":section==="TV Shows"?"Explore the TV series library":section==="Anime"?"Explore anime & animation":"Explore movies, series and anime";
 const available=items.filter(x=>x.source!=="personal"&&x.id);
 const isInSection=x=>section==="Movies"?x.type==="Movie":section==="TV Shows"?(x.type==="Series"||x.type==="Anime"):section==="Anime"?(x.type==="Anime"||(x.genreNames||[]).includes("Animation")):true;
 const scoped=available.filter(isInSection),genres=[...new Set(scoped.flatMap(x=>Array.isArray(x.genreNames)?x.genreNames:[]).filter(Boolean))].sort();
 if(view.genre!=="all"&&!genres.includes(view.genre))view.genre="all";
 const query=view.query.trim().toLowerCase();
 let filtered=scoped.filter(x=>(focused||view.type==="all"||x.type===view.type)
    &&(view.genre==="all"||x.genreNames?.includes(view.genre))
    &&(!query||[x.title,x.overview,x.year].some(v=>String(v||"").toLowerCase().includes(query))));
 filtered=sortedTitles(filtered,view.sort);
 if(view.sort==="featured"&&section!=="Anime"&&!query)filtered=countrySorted(filtered);
  if(typeof LumaCatalogPlus!=="undefined"&&["Catalogs","Anime","TV Shows"].includes(section))
   filtered=LumaCatalogPlus.groupCatalogRows(filtered);
 const result=tilesPage(filtered,view.page,focused?30:24);view.page=result.page;
 return '<section class="collectionIntro"><div class="eyebrow">LUMA · EXPANDED DISCOVERY</div><h2>'+safe(title)+'</h2>'
   +'<p>Browse a growing directory from multiple public movie, TV, and anime metadata sources. Search beyond the current page, or load more verified titles. Content is metadata, not guaranteed playback availability.</p>'
   +'<span class="collectionCount">'+result.total+' matching titles · '+scoped.length+' currently loaded</span></section>'
   +'<div class="collectionControls"><label>Find in this catalog<input id="catalogQuery" type="search" value="'+safe(view.query)+'" placeholder="Title, year or description"></label>'
   +(focused?"":'<label>Type<select id="catalogType">'+selectOptions([["all","Movies, series & anime"],["Movie","Movies"],["Series","TV series"],["Anime","Anime"]],view.type)+'</select></label>')
   +'<label>Genre<select id="catalogGenre">'+selectOptions([["all","All genres"],...genres.map(x=>[x,x])],view.genre)+'</select></label>'
   +'<label>Sort<select id="catalogSort">'+selectOptions([["featured","Featured"],["title","Title A–Z"],["year","Newest year"],["rating","Top rated"]],view.sort)+'</select></label></div>'
   +(result.total?'<div class="tiles collectionGrid">'+result.items.map(itemHTML).join("")+'</div>':'<div class="empty">Nothing matches those filters. Try another category or the main search bar.</div>')
   +collectionPager("catalog",result)
   +(!state.q&&state.source!=="Your library"&&!catalogEnd?
     '<div class="collectionLoad" id="catalogAutoLoad" role="status">'+
     (catalogMoreLoading?'Fetching more titles…':catalogAutoErrors>=3?'Provider is temporarily unavailable.':'More movies, shows and anime load automatically as you scroll.')+'</div>':"")
   +(catalogMoreError?'<div class="notice">'+safe(catalogMoreError)+'</div>':'');
}
function libraryMarkup(){
 const groups=libraryGroups();
 const titles=groups[libraryView.section]||groups.all;
 const query=libraryView.query.trim().toLowerCase();
 const collections=[...new Set(state.library.map(x=>String(x.collection||"").trim()).filter(Boolean))].sort();
 if(libraryView.collection!=="all"&&!collections.includes(libraryView.collection))libraryView.collection="all";
 const filtered=sortedTitles(titles.filter(x=>(libraryView.type==="all"||x.type===libraryView.type)
   &&(libraryView.collection==="all"||x.collection===libraryView.collection)
   &&(!query||[x.title,x.year].some(v=>String(v||"").toLowerCase().includes(query)))),libraryView.sort);
 const result=tilesPage(filtered,libraryView.page);libraryView.page=result.page;
 const names={all:"All saved titles",saved:"On Device watchlist",favorites:"Favorites",watching:"Continue Watching",watched:"Watched",personal:"Personal media"};
 return '<section class="collectionIntro"><div class="eyebrow">YOUR LIBRARY · STORED ON THIS DEVICE</div><h2>Everything you saved, in one place</h2><p>Find your saved titles, continue watching, and manage personal media. Trakt and Simkl remain separate in Watchlist and will never overwrite your device data.</p>'
   +'<div class="libraryStats">'+[["saved","Watchlist"],["favorites","Favorites"],["watching","In progress"],["watched","Watched"],["personal","Personal media"]].map(([id,label])=>'<button class="libraryStat" data-library-section="'+id+'"><strong>'+groups[id].length+'</strong><span>'+label+'</span></button>').join("")+'</div></section>'
   +'<div class="toolbar"><button class="primary" id="addMedia">+ Add your media</button><button class="secondary" id="playLocalVideo">▶ Play a video file</button><button class="secondary" id="importBackup">Import backup</button>'
   +'<input type="file" id="lumaLocalVideoInput" accept="video/*,.mkv,.avi,.ts,.m2ts,.mp4,.mov,.webm" hidden aria-label="Choose a video file from this device">'
   +'<p class="micro">Files you select play directly on this device. No video is uploaded to Luma. Browser codec support varies; MKV, DTS and some Dolby formats may need a native player.</p></div>'
   +'<div class="collectionControls"><label>Collection<select id="librarySection">'+selectOptions([["all","Everything"],["saved","On Device watchlist"],["favorites","Favorites"],["watching","Continue Watching"],["watched","Watched"],["personal","Personal media"]],libraryView.section)+'</select></label>'
   +'<label>Find a saved title<input id="libraryQuery" type="search" value="'+safe(libraryView.query)+'" placeholder="Search your library"></label>'
   +'<label>Type<select id="libraryType">'+selectOptions([["all","All types"],["Movie","Movies"],["Series","TV series"],["Anime","Anime"]],libraryView.type)+'</select></label>'
   +'<label>Personal collection<select id="libraryCollection">'+selectOptions([["all","All collections"],...collections.map(x=>[x,x])],libraryView.collection)+'</select></label>'
   +'<label>Sort<select id="librarySort">'+selectOptions([["saved","Saved order"],["title","Title A–Z"],["year","Newest year"]],libraryView.sort)+'</select></label></div>'
   +'<div class="collectionHeading"><h2>'+names[libraryView.section]+'</h2><span>'+result.total+' titles</span></div>'
   +(filtered.some(x=>x.unresolved)?'<div class="notice" role="status">Some saved titles need metadata. Luma preserves their original IDs and attempts recovery.</div>':"")
   +(result.total?'<div class="tiles collectionGrid">'+result.items.map(itemHTML).join("")+'</div>':'<div class="empty">No titles in this view. Save something to your On Device watchlist or try another filter.</div>')
   +collectionPager("library",result)
   +'<p class="micro">These are local records. Personal video links stay in your browser; selecting a cloud account under Watchlist does not import or delete anything here.</p>';
}
function favoritesMarkup(){
 const saved=libraryGroups().favorites;
 const grouped=typeof LumaCatalogPlus==="undefined"?saved:LumaCatalogPlus.groupCatalogRows(saved);
 return '<section class="collectionIntro"><div class="eyebrow">YOUR FAVORITES · ON THIS DEVICE</div><h2>Favorites</h2>'
  +'<p>Keep the shows and movies you love here. Favorites and your Watchlist are independent: adding or removing a title in one never changes the other.</p>'
  +'<div class="collectionCount">'+grouped.length+' favorites</div></section>'
  +(grouped.length?'<div class="tiles collectionGrid">'+grouped.map(itemHTML).join("")+'</div>'
    :'<div class="empty">No favorites yet. Open a movie, series or anime and tap ♥ Add to Favorites.</div>');
}
function bindCollectionInput(id,target){
 const input=$(id);if(!input)return;
 input.oninput=e=>{
   const text=e.target.value;
   clearTimeout(collectionSearchTimer);
   collectionSearchTimer=setTimeout(()=>{
     target.query=text;target.page=0;render();
     const replacement=$(id);
     if(replacement){replacement.focus();try{replacement.setSelectionRange(text.length,text.length)}catch{}}
     // Search beyond titles currently loaded on this phone. On every
     // keystroke only the latest debounced query may update the catalog.
     if(id==="#catalogQuery"&&text.trim().length>=3&&typeof LumaCatalogPlus!=="undefined"){
      const section=state.tab;
      Promise.resolve().then(()=>LumaCatalogPlus.search(section,text)).then(rows=>{
       if(state.tab!==section||target.query!==text||!rows.length)return;
       state.items=unique([...rows,...state.items]).slice(0,MAX_CATALOG_TITLES);
       render();
      }).catch(()=>{});
     }
   },500);
 };
}
function bindCollections(){
 if(["Catalogs","Movies","TV Shows","Anime"].includes(state.tab)){
   const view=state.tab==="Catalogs"?browse:mediaBrowse;
   bindCollectionInput("#catalogQuery",view);
   for(const [selector,key] of [["#catalogType","type"],["#catalogGenre","genre"],["#catalogSort","sort"]]){
     if($(selector))$(selector).onchange=e=>{view[key]=e.target.value;view.page=0;render()};
   }
   if($("#catalogPrev"))$("#catalogPrev").onclick=()=>{view.page--;render();goToResultsTop()};
   if($("#catalogNext"))$("#catalogNext").onclick=()=>{view.page++;render();goToResultsTop()};
   bindAutoCatalog();
 }
 if(state.tab==="My Library"){
   bindCollectionInput("#libraryQuery",libraryView);
   for(const [selector,key] of [["#librarySection","section"],["#libraryType","type"],["#librarySort","sort"],["#libraryCollection","collection"]]){
     if($(selector))$(selector).onchange=e=>{libraryView[key]=e.target.value;libraryView.page=0;render()};
   }
   $$("[data-library-section]").forEach(b=>b.onclick=()=>{libraryView.section=b.dataset.librarySection;libraryView.page=0;render()});
   if($("#libraryPrev"))$("#libraryPrev").onclick=()=>{libraryView.page--;render();goToResultsTop()};
   if($("#libraryNext"))$("#libraryNext").onclick=()=>{libraryView.page++;render();goToResultsTop()};
 }
}

function render(){paint();nav();if(document.body?.dataset)document.body.dataset.lumaSection=["Live TV","Guide","Recordings"].includes(state.tab)?"iptv":"";if(state.tab==="IPTV Library"){ $("#heading").textContent="IPTV Movie & Series Library";if(typeof LumaVODLibrary!=="undefined")LumaVODLibrary.render();else $("#content").innerHTML='<div class="notice">IPTV library is still loading. Refresh this page if it does not appear.</div>';return;}if(state.tab==="Add-ons"){ $("#heading").textContent="Luma Add-ons";LumaAddons.render();scanLanguageCards();observeLastAired();return;}if(["Live TV","Guide","Recordings"].includes(state.tab)){ $("#heading").textContent=state.tab==="Live TV"?"Live TV":state.tab==="Guide"?"TV Guide":"My Recordings";LumaIPTV.render(state.tab==="Live TV"?"home":state.tab==="Guide"?"guide":"recordings");return;}$("#heading").textContent=state.q?"Search results":state.tab;const a=state.items;let content="";if(state.tab==="Settings"){settings();return}if(state.tab==="Calendar"){LumaCalendar.start();return}if(state.tab==="Releases"){content=LumaReleases.releasePage(a)}else if(state.tab==="Collection"){content=LumaCollections.renderCollection()}else if(state.tab==="Streaming"){content=LumaCollections.providerShowcase()}else if(state.tab==="My Library"){content=libraryMarkup();}else if(state.tab==="Watchlist"){content=LumaAccounts.watchlistMarkup();}else if(state.tab==="Favorites"){content=favoritesMarkup();}else if(state.tab==="Profiles"){content=profilesMarkup();}else if(["Catalogs","Movies","TV Shows","Anime"].includes(state.tab)){content=channelSearchMarkup(state.q)+catalogMarkup(a);}else if(state.tab==="Continue Watching"){content=shelf("Pick up where you left off",libraryGroups().watching);}else{const filtered=a.filter(x=>state.tab==="Home"||state.q||(state.tab==="Movies"?x.type==="Movie":state.tab==="TV Shows"?(x.type==="Series"||x.type==="Anime"):state.tab==="Anime"?(x.type==="Anime"||(x.genres||[]).includes("Anime")):true));if(state.tab==="Home"&&!state.q){
 const homepageModel={
  items:filtered,watching:libraryGroups().watching,
  calendarRows:typeof LumaCalendar!=="undefined"&&typeof LumaCalendar.getRows==="function"?LumaCalendar.getRows():[],
  dvrJobs:typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.dvrJobs==="function"?LumaIPTV.dvrJobs():[],
  deviceJobs:typeof LumaDeviceDVR!=="undefined"&&LumaDeviceDVR.available()?LumaDeviceDVR.jobs():[],
  watchlist:libraryGroups().saved,favorites:libraryGroups().favorites,
  recommendations:suggestedTitles(filtered)
 };
 // TV home should stay focused and scrollable, not stack duplicate catalog,
 // calendar, provider and release modules beneath the curated dashboard.
 if(document.documentElement.dataset.tv==="true"&&typeof LumaTVExperience!=="undefined")
  content=LumaTVExperience.markup(homepageModel,shelf);
 else{
  content='<div class="lumaHomePage">'
   +hero([...LumaReleases.all().filter(x=>x.backdrop),...filtered])
   +(typeof LumaHome!=="undefined"?LumaHome.markup(homepageModel,shelf):cinematicHomeIntro(filtered))
   +'</div>';
 }
}else content=shelf(state.q?"Matching titles":state.tab,filtered)}if(state.loading)content='<div class="loading"><div class="spinner"></div> Updating metadata… <button type="button" class="secondary small" id="skipLoading">Use cached titles</button></div>'+content;if(state.message)content='<div class="notice">'+safe(state.message)+'</div>'+content;$("#content").innerHTML=content;if($("#skipLoading"))$("#skipLoading").onclick=()=>{state.loading=false;state.message="Showing saved titles while providers respond.";render()};$$("[data-open]").forEach(b=>b.onclick=()=>openTitle(b.dataset.open));$$("[data-watch]").forEach(b=>b.onclick=()=>toggleWatch(b.dataset.watch));
 $$("[data-title-retry]").forEach(b=>b.onclick=()=>{recoveryFailures.delete(b.dataset.titleRetry);void recoverSavedTitles([b.dataset.titleRetry],true)});
 $$("[data-search-channel]").forEach(b=>b.onclick=()=>{
  if(typeof LumaIPTV==="undefined"||typeof LumaIPTV.openChannel!=="function")return;
  LumaIPTV.openChannel(b.dataset.searchChannel);
 });if($("#addMedia"))$("#addMedia").onclick=addMedia;if($("#playLocalVideo"))$("#playLocalVideo").onclick=()=>{
  try{
   if(typeof window.LumaNativePlayer?.openFile==="function"&&window.LumaDvrToken){
    const result=JSON.parse(window.LumaNativePlayer.openFile(window.LumaDvrToken));
    if(result.ok)return;
   }
   if(window.webkit?.messageHandlers?.lumaNativePlayer){
    window.webkit.messageHandlers.lumaNativePlayer.postMessage({action:"openFile"});
    return;
   }
  }catch{}
  $("#lumaLocalVideoInput")?.click();
 };if($("#lumaLocalVideoInput"))$("#lumaLocalVideoInput").onchange=e=>{const file=e.target.files?.[0];if(!file)return;try{if(typeof LumaPlayer==="undefined")throw Error("Luma player unavailable");LumaPlayer.openLocal(file,{title:file.name})}catch(err){toast(String(err.message||err))}};if($("#importBackup"))$("#importBackup").onclick=importBackup;LumaReleases.bind();if(state.tab==="Home"){
  if(document.documentElement.dataset.tv==="true"&&typeof LumaTVExperience!=="undefined")LumaTVExperience.bind();
  else{
   LumaCalendar.bindHome();
   if(typeof LumaHome!=="undefined")LumaHome.bind();
  }
  $$("[data-cine-go]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.cineGo;state.q="";$("#search").value="";render();scrollTo({top:0,behavior:"smooth"})});
}if(state.tab==="Watchlist")LumaAccounts.watchlistBind();if(state.tab==="Profiles")bindProfiles();if(state.tab==="Collection")LumaCollections.bind();bindCollections();$$("[data-collection-id]").forEach(b=>b.onclick=()=>LumaCollections.open(b.dataset.collectionId));$$("[data-hero-shift]").forEach(b=>b.onclick=()=>{featuredIndex+=Number(b.dataset.heroShift)||0;render()});scanLanguageCards();observeLastAired()}
document.addEventListener("click",event=>{
 const jump=event.target.closest?.("[data-go]");
 if(!jump)return;
 const next=String(jump.dataset.go||"");
 const available=["Home","Live TV","Guide","Recordings","Catalogs","Movies","TV Shows","Anime","Calendar",
  "Watchlist","Favorites","My Library","Profiles","IPTV Library","Releases","Streaming","Add-ons","Continue Watching","Settings"];
 if(!available.includes(next))return;
 event.preventDefault();
 state.tab=next;state.q="";state.filter="all";
 const input=$("#search");if(input)input.value="";
 render();
 if(typeof scrollTo==="function")scrollTo({top:0,behavior:document.documentElement.dataset.tv==="true"?"auto":"smooth"});
});
document.addEventListener("click",e=>{const arrow=e.target.closest?.("[data-scroll]");if(!arrow)return;const shelf=arrow.closest(".shelf"),rail=shelf?.querySelector(".tiles");if(!rail)return;const direction=Number(arrow.dataset.scroll)||1;rail.scrollBy({left:direction*Math.max(rail.clientWidth*.82,230),behavior:"smooth"})});
function cacheSavedTitle(id){
 const title=state.items.find(x=>x.id===id)||state.library.find(x=>x.id===id)||LumaCollections.find(id);
 return saveTitleSnapshot(id,title);
}
function toggleFavorite(id){
 const next=state.favorites.includes(id)?state.favorites.filter(v=>v!==id):[...state.favorites,id];
 if(!save("favorites",next))return;
 state.favorites=next;cacheSavedTitle(id);recommendationKey="";render();void refreshRecommendations();
}
function consolidateAnimeCollections(family){
 const root=family.root,ids=new Set(family.entries.map(x=>x.id));
 let changed=false;
 for(const list of ["watch","favorites"]){
  const entries=state[list];
  if(!entries.some(id=>id!==root.id&&ids.has(id)))continue;
  state[list]=[...new Set(entries.map(id=>ids.has(id)?root.id:id))];
  save(list,state[list]);changed=true;
 }
 if(changed)cacheSavedTitle(root.id);
}
function toggleWatch(id){
 const adding=!state.watch.includes(id),next=adding?[...state.watch,id]:state.watch.filter(v=>v!==id);
 if(!save("watch",next))return;
 state.watch=next;
 const title=state.items.find(x=>x.id===id)||LumaAccounts.deviceItems().find(x=>x.id===id)||LumaCollections.find(id);
 if(adding&&isGenuineSavedTitle(title))cacheSavedTitle(id);
 if(title&&(title.type==="Series"||title.type==="Anime"))LumaCalendar.registerFollow(title);
 recommendationKey="";render();void refreshRecommendations();
}
let lastModalOpener=null;
function modal(markup){
 if(!$("#modal").innerHTML)lastModalOpener=document.activeElement;
 $("#modal").innerHTML='<div class="shade" role="presentation"><div class="dialog" role="dialog" aria-modal="true"><button class="close" id="closeModal" aria-label="Close dialog">✕</button>'+markup+'</div></div>';$("#closeModal").onclick=closeModal;document.body.classList.add("modalOpen");scanLanguageCards()}
function closeModal(){const v=$("#video");if(v){v.pause();v.removeAttribute("src");v.load()}$("#modal").innerHTML="";document.body.classList.remove("modalOpen");state.playerKey="";
 const fallback=$$("[data-open]").find(b=>b.dataset?.open===state.selected?.id);
 (lastModalOpener?.isConnected?lastModalOpener:fallback)?.focus?.({preventScroll:true});
 lastModalOpener=null;}
function art(x){return'<div class="detailArt" style="'+(x.backdrop||x.poster?'background-image:linear-gradient(0deg,#1a1b27 0%,#1a1b2744 100%),url(&quot;'+safe(x.backdrop||x.poster)+'&quot;)':'background:linear-gradient(125deg,#6b4281,#192b52)')+'"></div>'}

let detailRequestToken=0,seasonBusy=false,seasonError="";
const seasonResults=new Map();
function episodeNormal(episode,seasonFallback=1){
 const s=Number(episode.season_number??episode.season??seasonFallback);
 const n=Number(episode.episode_number??episode.number??episode.episode);
 return {
  id:episode.id,season_number:Number.isFinite(s)?s:1,episode_number:Number.isFinite(n)?n:0,
  name:episode.name||episode.title||"Episode "+(n||""),overview:String(episode.overview||episode.summary||"").replace(/<[^>]*>/g,""),
  still:safeArtworkUrl(episode.still)||episode.image?.original||episode.image?.medium||image(episode.still_path||"",500),
  air_date:episode.air_date||episode.airdate||"",runtime:episode.runtime||0
 };
}
async function findTVMazeShow(x){
 if(x.mazeId)return {id:x.mazeId};
 if(x.imdbId&&/^tt\d+$/.test(x.imdbId))try{
   return await api("https://api.tvmaze.com/lookup/shows?imdb="+encodeURIComponent(x.imdbId));
 }catch{}
 const q=String(x.title||"").trim();if(!q)return null;
 const options=await api("https://api.tvmaze.com/search/shows?q="+encodeURIComponent(q));
 const key=v=>String(v||"").trim().normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
 const matched=(Array.isArray(options)?options:[]).map(r=>r.show).filter(v=>v&&key(v.name)===key(q))
  .filter(v=>!x.year||!v.premiered||Math.abs(Number(v.premiered.slice(0,4))-Number(x.year))<=1);
 return matched.length===1?matched[0]:null;
}
async function loadSeason(number,request=detailRequestToken){
 const x=state.selected;if(!x)return;
 const season=Number(number);if(!Number.isInteger(season)||season<0)return;
 state.season=season;
 const detail=state.details||{};const tmid=x.tmdbId||detail.id;
 if(detail._tvmazeEpisodes||detail._animeFamily){
   seasonBusy=false;seasonError="";showDetails(true);return;
 }
 if(!state.tmdbKey||!tmid){seasonBusy=false;seasonError="Season episodes are unavailable from the configured metadata source.";showDetails(true);return;}
 const key=String(tmid)+":"+season;
 if(seasonResults.has(key)){
   state.details={...detail,episodes:seasonResults.get(key)};
   seasonBusy=false;seasonError="";showDetails(true);return;
 }
 seasonBusy=true;seasonError="";state.details={...detail,episodes:[]};showDetails(true);
 try{
  const result=await tmdb("tv/"+tmid+"/season/"+season);
  if(detailRequestToken!==request||state.selected?.id!==x.id||state.season!==season)return;
  const list=(Array.isArray(result.episodes)?result.episodes:[]).map(e=>episodeNormal(e,season));
  seasonResults.set(key,list);state.details={...state.details,episodes:list};for(const ep of list)saveLastAired(x,ep);
  seasonError=list.length?"":"No episode guide has been published for this season.";
 }catch(err){
  if(detailRequestToken!==request||state.selected?.id!==x.id||state.season!==season)return;
  seasonError="Could not load this season. Check your connection and retry.";
 }finally{
  if(detailRequestToken===request&&state.selected?.id===x.id&&state.season===season){seasonBusy=false;showDetails(true)}
 }
}
async function openTitle(id){
 const x=state.items.find(y=>y.id===id)||state.library.find(y=>y.id===id)
   ||LumaAccounts.deviceItems().find(y=>y.id===id)||libraryGroups().favorites.find(y=>y.id===id)||store("catalog",[]).find(y=>y.id===id)||LumaCollections.find(id);
 if(!x)return;
 const request=++detailRequestToken;
 state.selected=x;state.details=null;
 const resume=progressForTitle(x);
 state.season=resume.season||1;seasonBusy=x.type==="Series"||x.type==="Anime";seasonError="";
 showDetails();
 const isShow=x.type==="Series"||x.type==="Anime";
 if(isShow&&x.animeId&&typeof LumaCatalogPlus!=="undefined"){
  try{
   const family=await LumaCatalogPlus.animeFamily(x);
   if(detailRequestToken!==request||state.selected?.id!==id)return;
   consolidateAnimeCollections(family);
   state.items=unique([family.root,...state.items]);cacheSavedTitle(family.root.id);
   state.selected=family.root;
   const seasons=family.entries.map((entry,index)=>({
    season_number:index+1,name:"Season "+(index+1)+" · "+entry.title,
    animeId:entry.animeId,episodeCount:entry.episodeCount
   }));
   const episodes=family.entries.flatMap((entry,index)=>{
    const count=Math.min(Math.max(0,Number(entry.episodeCount)||0),400);
    return Array.from({length:count},(_,number)=>({
     season_number:index+1,episode_number:number+1,
     name:"Episode "+(number+1),animeSourceId:entry.id,animeSourceTitle:entry.title
    }));
   });
   state.details={_animeFamily:true,seasons,episodes,animeFamilyCount:family.entries.length};
   state.season=seasons.some(s=>s.season_number===resume.season)?resume.season:(seasons.find(s=>s.animeId===family.selectedId)?.season_number||1);
   seasonBusy=false;seasonError=episodes.length?"":"This anime has no verified episode counts in its metadata.";
   showDetails(true);return;
  }catch(error){
   if(detailRequestToken!==request)return;
   // Offline/unavailable anime relations fall back to another verified guide.
  }
 }
 const tmdbId=x.tmdbId||null;
 if(state.tmdbKey&&tmdbId){
  try{
   const kind=isShow?"tv":"movie";
   const result=await tmdb(kind+"/"+tmdbId,{append_to_response:"external_ids,credits,videos"});
   if(detailRequestToken!==request||state.selected?.id!==id)return;
   state.details=result;
   if(isShow){
    saveLastAired(x,result.last_episode_to_air);
    const seasons=(result.seasons||[]).filter(s=>s.season_number>0);
    state.season=seasons.some(s=>Number(s.season_number)===resume.season)?resume.season:(seasons.length?Number(seasons[0].season_number):1);
    await loadSeason(state.season,request);
   }else{seasonBusy=false;showDetails();}
   return;
  }catch(e){if(detailRequestToken!==request)return;}
 }
 if(isShow){
  try{
   const match=await findTVMazeShow(x);
   if(detailRequestToken!==request||state.selected?.id!==id)return;
   if(!match?.id)throw Error("No exact episode guide match");
   const [episodes,cast,crew]=await Promise.allSettled([
    api("https://api.tvmaze.com/shows/"+match.id+"/episodes"),
    api("https://api.tvmaze.com/shows/"+match.id+"/cast"),
    api("https://api.tvmaze.com/shows/"+match.id+"/crew")
   ]);
   if(detailRequestToken!==request||state.selected?.id!==id)return;
   const list=(episodes.status==="fulfilled"&&Array.isArray(episodes.value)?episodes.value:[]).map(e=>episodeNormal(e));for(const ep of list)saveLastAired(x,ep);
   state.details={_tvmazeEpisodes:true,episodes:list,
    seasons:[...new Set(list.map(e=>e.season_number))].filter(n=>n>0).map(n=>({season_number:n,name:"Season "+n})),
    cast:cast.status==="fulfilled"?cast.value:[],crew:crew.status==="fulfilled"?crew.value:[]};
   state.season=state.details.seasons.some(s=>s.season_number===resume.season)?resume.season:(state.details.seasons[0]?.season_number||1);
   seasonError=list.length?"":"No episodes have been published for this show.";
  }catch(e){seasonError="Episode details are unavailable. Try another show or check your connection.";}
  finally{if(detailRequestToken===request&&state.selected?.id===id){seasonBusy=false;showDetails(true)}}
 }else{seasonBusy=false;showDetails();}
}

function linkKey(x,episode){return x.id+(episode?":s"+episode.season_number+"e"+episode.episode_number:"")}
function episodeIsWatched(x,episode){
 const key=linkKey(x,episode);
 return state.watched.includes(key)||Number(state.progress[key]?.fraction)>=.98;
}
function setEpisodeWatched(x,episode,watched){
 const key=linkKey(x,episode);
 state.watched=watched?[...new Set([...state.watched,key])]:state.watched.filter(id=>id!==key);
 save("watched",state.watched);
 if(!watched&&Number(state.progress[key]?.fraction)>=.98){
  delete state.progress[key];save("progress",state.progress);
 }
 refreshLastAired(x);
 recommendationKey="";void refreshRecommendations();
}

function showDetails(preserveScroll=false){
 const x=state.selected;if(!x)return;
 const dialog=preserveScroll?$("#modal .dialog"):null,oldScroll=dialog?.scrollTop||0;
 const focused=preserveScroll&&typeof document!=="undefined"?document.activeElement:null;
 const focusId=focused?.id||"",focusEpisode=focused?.getAttribute?.("data-episode-watch")||"";
 const isShow=x.type==="Series"||x.type==="Anime",meta=state.details||{};
 let html=art(x)+'<div class="detailBody lumaTitleDetail"><div class="eyebrow">'+safe(x.type)+' · '+safe(x.year||"")
   +(Number(x.rating)>0?' · ★ '+safe(Number(x.rating).toFixed(1))+'/10':'')+'</div><h2>'+safe(x.title)+'</h2><div class="detailContentRating">'+certificateSlot(x)+'</div>'
   +'<div id="latestAiredDetail">'+latestAiredDetail(x)+'</div>'
   +'<div class="detailFacts">'+[x.network,x.tvStatus,(x.genreNames||[]).slice(0,3).join(" · ")].filter(Boolean)
       .map(v=>'<span>'+safe(v)+'</span>').join("")+'</div>'
   +'<p class="detailSynopsis">'+safe(x.overview||meta.overview||"Description unavailable.")+'</p>'
   +'<button type="button" class="readMore" id="readMore">Read full description</button>'
   +'<div class="actions"><button class="primary" id="findStreams">'+(x.source==="personal"?"▶ Play your media":isShow?"▶ Browse episode streams":"▶ Find movie streams")+'</button>'
   +'<button class="secondary" id="toggleWatch">'+(state.watch.includes(x.id)?"✓ In Watchlist":"+ Add to Watchlist")+'</button>'
   +'<button class="secondary" id="toggleFavorite">'+(state.favorites.includes(x.id)?"♥ In Favorites":"♡ Add to Favorites")+'</button>'
   +'<button class="secondary" id="markWatched">'+(state.watched.includes(x.id)?"✓ Title watched":"Mark title watched")+'</button></div>';
 if(isShow){
  let seasons=Array.isArray(meta.seasons)?meta.seasons.filter(v=>Number.isInteger(Number(v.season_number))&&Number(v.season_number)>0):[];
  const episodes=Array.isArray(meta.episodes)?meta.episodes.map(e=>episodeNormal(e)):[],seen=new Set(seasons.map(v=>Number(v.season_number)));
  for(const ep of episodes){if(ep.season_number>0&&!seen.has(ep.season_number)){seasons.push({season_number:ep.season_number,name:"Season "+ep.season_number});seen.add(ep.season_number)}}
  if(!seasons.length)seasons=[{season_number:state.season||1,name:"Season "+(state.season||1)}];
  seasons.sort((a,b)=>Number(a.season_number)-Number(b.season_number));
  const seasonEpisodes=episodes.filter(e=>e.season_number===state.season);
  const count=seasonEpisodes.length,watchedCount=seasonEpisodes.filter(e=>episodeIsWatched(x,e)).length;
  const today=new Date().toISOString().slice(0,10);
  const resume=progressForTitle(x);
  const nextEpisode=seasonEpisodes.find(e=>resume.season===e.season_number&&resume.episode===e.episode_number&&!episodeIsWatched(x,e))
   ||seasonEpisodes.find(e=>!episodeIsWatched(x,e)&&(!e.air_date||e.air_date<=today));
  html+='<section class="episodes episodeHub"><div class="episodeHubTop"><div><div class="eyebrow">EPISODE GUIDE</div><h3>Seasons & episodes</h3><p>Choose an episode to play, or mark it watched/unwatched without playing it.</p>'
   +(meta._animeFamily?'<p class="micro">Related anime seasons are verified through AniList sequel relations. Episode numbers reflect season counts; individual episode dates and names are not supplied.</p>':'')+'</div>'
   +'<label class="episodeSeasonLabel">Season<select id="seasonSelect" aria-label="Choose season">'
   +seasons.map(v=>'<option value="'+Number(v.season_number)+'"'+(Number(v.season_number)===state.season?" selected":"")+'>'+safe(v.name||"Season "+v.season_number)+'</option>').join("")
   +'</select></label></div>'
   +(seasonBusy?'<div class="episodeLoading" role="status"><span class="spinner"></span> Loading episode artwork and details…</div>'
   :count?'<div class="episodeHubCount">'+watchedCount+' of '+count+' episodes watched'
   +(nextEpisode?' · Next S'+state.season+'E'+nextEpisode.episode_number:'')+'</div>'
   +(nextEpisode?'<button type="button" class="primary episodeNext" id="playNextEpisode">'+(resume.season===nextEpisode.season_number&&resume.episode===nextEpisode.episode_number
   ?'▶ Resume S'+resume.season+'E'+resume.episode+' at '+Math.floor(resume.seconds/60)+'m'
   :'▶ Play next unwatched episode')+'</button>':'')
   +episodeHTML(episodes,x)
   :'<div class="episodeEmpty"><strong>Episode guide unavailable</strong><p>'+safe(seasonError||"No episode details have been published for this season yet.")+'</p><button class="secondary" id="retrySeason">Retry episode guide</button></div>')
   +'</section>';
 }
 if(x.source==="personal")html+='<div class="actions"><button class="secondary" id="editPersonal">Edit media</button><button class="secondary" id="removePersonal">Remove media</button></div>';
 html+='<p class="micro detailDisclaimer">Metadata and streaming results depend on available providers and your authorized content access.</p>'
   +LumaPeople.markup(x)+'</div>';
 modal(html);
 if(preserveScroll&&$("#modal .dialog")){
  $("#modal .dialog").scrollTop=oldScroll;
  const selector=focusEpisode?'[data-episode-watch="'+focusEpisode+'"]':focusId?"#"+focusId:"";
  if(selector)$("#modal "+selector)?.focus?.({preventScroll:true});
 }
 if($("#readMore"))$("#readMore").onclick=expandDetails;bindLatestAired(x);
 $("#findStreams").onclick=()=>{
  if(x.source==="personal"&&x.url)return play(x,null,x.url);
  if(isShow){
   const first=$("#modal [data-ep]");
   if(first){first.click();return;}
   toast("Select a season after the episode list loads.");
   return;
  }
  chooseLink(x,null);
 };
 if($("#editPersonal"))$("#editPersonal").onclick=()=>addMedia(x);
 if($("#removePersonal"))$("#removePersonal").onclick=()=>removeMedia(x);
 $("#toggleWatch").onclick=()=>{toggleWatch(x.id);showDetails(true)};
 if($("#toggleFavorite"))$("#toggleFavorite").onclick=()=>{toggleFavorite(x.id);showDetails(true)};
 $("#markWatched").onclick=()=>{state.watched=state.watched.includes(x.id)?state.watched.filter(i=>i!==x.id):[...state.watched,x.id];save("watched",state.watched);showDetails(true)};
 if($("#seasonSelect"))$("#seasonSelect").onchange=e=>loadSeason(Number(e.target.value));
 if($("#playNextEpisode"))$("#playNextEpisode").onclick=()=>{
  const today=new Date().toISOString().slice(0,10);
  const eligible=(Array.isArray(meta.episodes)?meta.episodes:[]).map(e=>episodeNormal(e))
    .filter(e=>e.season_number===state.season&&(!e.air_date||e.air_date<=today))
    .sort((a,b)=>a.episode_number-b.episode_number);
  const resume=progressForTitle(x);
  const next=eligible.find(e=>resume.season===e.season_number&&resume.episode===e.episode_number&&!episodeIsWatched(x,e))
   ||eligible.find(e=>!episodeIsWatched(x,e));
  if(next)chooseLink(x,next);
 };
 if($("#retrySeason"))$("#retrySeason").onclick=()=>loadSeason(state.season);
 $$("[data-episode-watch]").forEach(button=>button.onclick=()=>{
   const parts=button.dataset.episodeWatch.split(":").map(Number);
   if(parts.length!==2||!parts.every(Number.isInteger)||parts.some(v=>v<1))return;
   const ep={season_number:parts[0],episode_number:parts[1]};
   setEpisodeWatched(x,ep,!episodeIsWatched(x,ep));
   showDetails(true);
   $("#modal [data-episode-watch='"+parts.join(":")+"']")?.focus?.();
 });
 $$("[data-ep]").forEach(button=>button.onclick=()=>{
   let ep;try{ep=JSON.parse(decodeURIComponent(button.dataset.ep))}catch{return}
   chooseLink(x,ep);
 });
 LumaPeople.bind(x);LumaReleases.enrichDetail(x);
}

function expandDetails(){const body=document.querySelector(".detailBody");if(body){body.classList.toggle("expanded");const toggle=body.querySelector("#readMore");if(toggle)toggle.textContent=body.classList.contains("expanded")?"Show less":"Read full description"}}

function episodeHTML(eps,x){
 const filtered=eps.filter(e=>e.season_number===state.season).sort((a,b)=>a.episode_number-b.episode_number);
 if(!filtered.length)return '<div class="episodeEmpty">No episode details for this season yet.</div>';
 const today=new Date().toISOString().slice(0,10);
 return '<div class="episodeList cinematicEpisodeList">'+filtered.map(e=>{
  const key=linkKey(x,e),n=Number(e.episode_number)||0,sn=Number(e.season_number)||state.season,
    isWatched=episodeIsWatched(x,e),progress=state.progress[key]?.fraction||0,
    future=!!e.air_date&&e.air_date>today,still=safeArtworkUrl(e.still||e.image?.medium||e.image?.original||"")
      ||safeArtworkUrl(x.backdrop)||safeArtworkUrl(x.poster);
  const item={season_number:sn,episode_number:n,name:e.name||"Episode "+n,air_date:e.air_date||"",runtime:e.runtime||0};
  const date=e.air_date?new Date(e.air_date+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"Air date TBD";
  return '<div class="episodeRow"><button type="button" class="episode episodeCinematic" data-ep="'+encodeURIComponent(JSON.stringify(item))+'" aria-label="Select season '+sn+' episode '+n+': '+safe(item.name)+'">'
   +'<div class="episodeStill">'+(still?'<img src="'+safe(still)+'" alt="" loading="lazy" onerror="this.remove()">':'<span class="episodeStillFallback">LUMA</span>')
   +'<span class="episodePlayGlyph">▶</span>'+(progress>0&&progress<.98?'<div class="episodeTrack"><span style="width:'+Math.round(progress*100)+'%"></span></div>':'')+'</div>'
   +'<div class="episodeInfo"><div class="episodeTitleRow"><strong>'+n+'. '+safe(item.name)+'</strong>'+(e.runtime?'<span>'+Number(e.runtime)+' min</span>':'')+'</div>'
   +'<p class="episodeSummary">'+safe(String(e.overview||"Episode synopsis not provided.").slice(0,220))+'</p>'
   +'<div class="episodeStatus"><span>S'+String(sn).padStart(2,"0")+'E'+String(n).padStart(2,"0")+'</span><span>'+safe(date)+'</span>'
   +(isWatched?'<span class="episodeSeen">✓ Watched</span>':future?'<span class="episodeUpcoming">Upcoming</span>':progress>0?'<span class="episodeSeen">Resume</span>':'')+'</div></div>'
   +'<span class="episodeSelectArrow" aria-hidden="true">›</span></button>'
   +'<button type="button" class="episodeWatchToggle '+(isWatched?'isWatched':'')+'" data-episode-watch="'+sn+':'+n+'" aria-pressed="'+(isWatched?'true':'false')+'" aria-label="'+(isWatched?'Mark season '+sn+' episode '+n+' unwatched':'Mark season '+sn+' episode '+n+' watched')+'">'
   +(isWatched?'↶ Mark unwatched':'✓ Mark watched')+'</button></div>';
 }).join("")+'</div>';
}

function chooseLink(x,ep){const manifest=()=>{if(!LumaAddons.installed()){modal('<div class="pad emptyStreams"><div class="eyebrow">STREAM SOURCES</div><h2>No stream add-ons installed</h2><p>Install a compatible Luma add-on to discover available streams for this title.</p><div class="actions"><button id="goAddons" class="primary">Manage Add-ons</button><button id="backTitle" class="secondary">Back to Details</button></div></div>');$("#goAddons").onclick=()=>{closeModal();state.tab="Add-ons";render()};$("#backTitle").onclick=showDetails;return}LumaAddons.lookupTitle(x,state.details?.external_ids?.imdb_id||state.details?.imdb_id||x.imdbId||"",ep)};if(typeof LumaVOD!=="undefined")return LumaVOD.choose(x,ep,manifest);return manifest();}

function play(x,ep,url){
 let key=linkKey(x,ep);state.playerKey=key;
 if(typeof LumaPlayer!=="undefined"&&LumaPlayer.open({
  url,mediaId:key,seriesKey:ep?"series:"+String(x.id)+":season:"+String(ep.season_number):"",chapters:Array.isArray(x.chapters)?x.chapters:[],title:x.title+(ep?" · S"+ep.season_number+"E"+ep.episode_number:""),live:false,
  resumeAt:state.progress[key]?.seconds||0,
  onProgress:info=>{
   const now=Date.now();if(!info.paused&&now-state.lastSave<3000)return;
   state.lastSave=now;
   state.progress[key]={seconds:info.seconds,fraction:info.fraction,updated:now};
   save("progress",state.progress);
  },
  onEnded:()=>{
   state.progress[key]={seconds:0,fraction:1,updated:Date.now()};save("progress",state.progress);
   if(!state.watched.includes(key)){state.watched.push(key);save("watched",state.watched)}
   if(ep)refreshLastAired(x);
  },
  onClose:()=>{if(state.selected)showDetails()}
 }))return;
 modal('<div class="playerWrap"><h2>'+safe(x.title)+(ep?" · S"+ep.season_number+"E"+ep.episode_number:"")+'</h2><video id="video" controls playsinline preload="metadata"></video><div class="actions"><button class="secondary" id="backDetails">← Details</button><button class="secondary" id="changeLink">Find another stream</button><button class="secondary" id="watchedButton">✓ Mark watched</button></div><p class="micro" id="playerStatus">Loading your video… Playback progress is saved in this browser.</p></div>');const v=$("#video");v.src=url;v.onloadedmetadata=()=>{const p=state.progress[key];if(Number.isFinite(v.duration)&&p?.seconds>0&&p.seconds<v.duration-5)v.currentTime=p.seconds;$("#playerStatus").textContent="Ready to play";};v.ontimeupdate=()=>{if(!Number.isFinite(v.duration)||v.duration<=0)return;const now=Date.now();if(now-state.lastSave<3000)return;state.lastSave=now;state.progress[key]={seconds:v.currentTime,fraction:v.currentTime/v.duration,updated:now};save("progress",state.progress)};v.onpause=()=>{if(Number.isFinite(v.duration)&&v.duration>0){state.progress[key]={seconds:v.currentTime,fraction:v.currentTime/v.duration,updated:Date.now()};save("progress",state.progress)}};v.onended=()=>{state.progress[key]={seconds:0,fraction:1,updated:Date.now()};save("progress",state.progress);if(!state.watched.includes(key)){state.watched.push(key);save("watched",state.watched)}if(ep)refreshLastAired(x);$("#playerStatus").textContent="Finished. Marked watched locally."};v.onerror=()=>$("#playerStatus").textContent="This source could not play. Check its format, access rights, network and codec support.";LumaAddons.attachPlayerButtons();$("#backDetails").onclick=()=>{v.pause();v.removeAttribute("src");v.load();showDetails()};$("#changeLink").onclick=()=>{v.pause();chooseLink(state.selected||x,ep)};$("#watchedButton").onclick=()=>{if(!state.watched.includes(key))state.watched.push(key);save("watched",state.watched);if(ep)refreshLastAired(x);toast("Marked watched")}}
function removeMedia(x){
 if(!x?.id||x.source!=="personal")return;
 if(!confirm("Remove \""+x.title+"\" from this device? Its saved link and local playback history will be removed, but cloud lists will not change."))return;
 state.library=state.library.filter(item=>item.id!==x.id);save("library",state.library);
 state.watch=state.watch.filter(id=>id!==x.id);save("watch",state.watch);
 state.favorites=state.favorites.filter(id=>id!==x.id);save("favorites",state.favorites);
 state.watched=state.watched.filter(id=>id!==x.id&&!id.startsWith(x.id+":s"));save("watched",state.watched);
 for(const id of Object.keys(state.progress)){if(id===x.id||id.startsWith(x.id+":s"))delete state.progress[id]}
 save("progress",state.progress);closeModal();discover();toast("Removed from this device.");
}
async function enrichPersonalArtwork(id){
 const entry=state.library.find(x=>x.id===id);if(!entry||entry.poster||!state.tmdbKey)return;
 try{
  const result=await tmdb("search/multi",{query:entry.title,include_adult:"false"});
  const key=v=>String(v||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const matches=(result.results||[]).filter(x=>["movie","tv"].includes(x.media_type))
    .filter(x=>x.media_type===(entry.type==="Movie"?"movie":"tv"))
    .filter(x=>key(x.title||x.name)===key(entry.title))
    .filter(x=>!entry.year||Math.abs(Number((x.release_date||x.first_air_date||"").slice(0,4))-Number(entry.year))<=1);
  if(matches.length!==1)return;
  const current=state.library.find(x=>x.id===id);
  if(!current||current.poster||current.title!==entry.title)return;
  current.poster=image(matches[0].poster_path);current.backdrop=image(matches[0].backdrop_path,1280);
  if(!current.original_language)current.original_language=matches[0].original_language||"";
  save("library",state.library);if(state.tab==="My Library")render();
 }catch{}
}
function addMedia(existing=null){
 const edit=existing&&existing.id&&existing.source==="personal"?existing:null;
 modal('<div class="pad"><div class="eyebrow">PERSONAL LIBRARY</div><h2>'+(edit?'Edit your media':'Add your media')+'</h2><p>Save your own direct HTTPS media URL. Optional artwork and collections stay on this device.</p><form id="addForm">'
  +'<label>Title<input name="title" maxlength="110" required value="'+safe(edit?.title||"")+'" placeholder="Movie or series title"></label>'
  +'<label>Category<select name="type">'+["Movie","Series","Anime"].map(t=>'<option'+((edit?.type||"Movie")===t?' selected':'')+'>'+t+'</option>').join("")+'</select></label>'
  +'<label>Release year<input type="number" name="year" min="1900" max="2100" value="'+safe(edit?.year||new Date().getFullYear())+'"></label>'
  +'<label>Original language (optional)<input name="original_language" maxlength="60" value="'+safe(edit?.original_language||"")+'" placeholder="e.g. English, Japanese"></label>'
  +'<label>HTTPS video URL<input type="url" name="url" value="'+safe(edit?.url||"")+'" placeholder="https://example.com/movie.mp4" required></label>'
  +'<label>Collection (optional)<input name="collection" maxlength="60" value="'+safe(edit?.collection||"")+'" placeholder="Family movies, Favorites…"></label>'
  +'<label>Artwork URL (optional)<input name="poster" type="url" value="'+safe(edit?.poster||"")+'" placeholder="https://example.com/poster.jpg"></label>'
  +'<div class="actions"><button class="primary" type="submit">'+(edit?'Save changes':'Add media')+'</button><button class="secondary" type="button" id="cancelMedia">Cancel</button></div></form>'
  +'<p class="micro">If TMDB is configured and the title and year match uniquely, Luma may add poster artwork automatically. It never changes your media URL.</p></div>');
 $("#cancelMedia").onclick=()=>edit?(state.selected=edit,showDetails()):closeModal();
 $("#addForm").onsubmit=e=>{
  e.preventDefault();const data=new FormData(e.target),url=String(data.get("url")||"").trim(),poster=String(data.get("poster")||"").trim();
  try{const parsed=new URL(url);if(parsed.protocol!=="https:"||parsed.username||parsed.password)throw Error("Invalid URL")}catch{return toast("Use a valid HTTPS media URL without embedded credentials.")}
  if(poster&&!safeArtworkUrl(poster))return toast("Poster artwork must use HTTPS.");
  const title=String(data.get("title")||"").trim();if(!title)return toast("Enter a title.");
  const x={...(edit||{}),id:edit?.id||"local:"+Date.now()+":"+Math.random().toString(36).slice(2,8),
    title,type:String(data.get("type")||"Movie"),year:String(data.get("year")||""),original_language:String(data.get("original_language")||"").trim(),url,poster:poster||edit?.poster||"",collection:String(data.get("collection")||"").trim(),
    overview:edit?.overview||"From your personal media library.",source:"personal"};
  state.library=edit?state.library.map(item=>item.id===x.id?x:item):[x,...state.library];
  save("library",state.library);closeModal();discover();toast(edit?"Media updated.":"Media added.");
  if(!x.poster)enrichPersonalArtwork(x.id);
 };
}
function settings(){let html='<div class="settingsGrid"><section class="settingCard"><h2>Viewer profiles</h2><p>Active viewer: <strong>'+safe(state.profile)+'</strong>. Each viewer keeps a separate watchlist, favorites, watched episodes and recommendations.</p><button class="primary" id="manageProfiles">Manage viewers</button></section><section class="settingCard"><h2>Appearance</h2><label>Accent color<input id="accent" type="color" value="'+safe(state.accent)+'"></label><label>Theme<select id="theme"><option value="dark">Midnight</option><option value="light">Soft light</option></select></label><label>Card spacing<select id="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label></section><section class="settingCard"><h2>Card labels</h2><p>Choose which language details appear on movie and TV cards. These preferences stay on this device.</p><label class="languageToggle" for="toggleOriginalLanguage"><span><b>Original language</b><small>Show the original spoken language below each title.</small></span><input id="toggleOriginalLanguage" type="checkbox" '+(state.showOriginalLanguage?'checked':'')+'></label><label class="languageToggle" for="toggleEnglishDub"><span><b>English dub badge</b><small>Only show verified English voice dubs. Audio availability can vary by stream.</small></span><input id="toggleEnglishDub" type="checkbox" '+(state.showEnglishDub?'checked':'')+'></label></section><section class="settingCard"><h2>Home screen</h2><p>Keep Home focused on watching. Optional extras appear after your library shelves.</p><label class="languageToggle" for="toggleHomeExtras"><span><b>Weather and news</b><small>Show weather and headlines below your watchlist, favorites and viewing activity.</small></span><input id="toggleHomeExtras" type="checkbox" '+(state.showHomeExtras?'checked':'')+'></label></section><section class="settingCard"><h2>Country & discovery</h2><p>Prioritize movies and shows made in your selected country while keeping international titles available. The browser locale provides the initial country; you can change it.</p><label for="lumaDiscoveryCountry">Preferred country<select id="lumaDiscoveryCountry">'+Object.entries(LumaReleases.REGION_NAMES||{US:"United States"}).map(([code,label])=>'<option value="'+safe(code)+'">'+safe(label)+'</option>').join("")+'</select></label></section><section class="settingCard"><h2>Real metadata</h2><p>Luma can display real TV titles with TVmaze without a key. Add your own TMDB read-only API key or v4 read access token to unlock richer movie, TV and trending artwork.</p><label>TMDB API credential<input id="tmdbKey" type="password" autocomplete="off" placeholder="Optional read-only key / token" value="'+safe(state.tmdbKey)+'"></label><div class="actions"><button class="primary" id="saveTMDB">Save metadata settings</button><button class="secondary" id="clearTMDB">Disconnect</button></div><p class="micro">Saved locally on this device. Never paste private server-side client secrets. Browser API requests may be visible in network tools. <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Get a TMDB key</a>.</p></section><section class="settingCard"><h2>Data and privacy</h2><p>Watchlists, playback bookmarks, playback links and settings are stored in this browser. They do not yet sync through iCloud, Trakt or Simkl.</p><div class="actions"><button class="primary" id="exportData">Download backup</button><button class="secondary" id="shareBackup">Save to Files / iCloud Drive</button><button class="secondary" id="importData">Import backup</button></div><p class="micro">Export does not include the metadata API token. Keep your backups private: they may contain media URLs.</p></section><section class="settingCard"><h2>Move your library to another device</h2><p>Share a local backup from this phone or TV, then import it on your other device using Merge safely. Favorites, Watchlist, and watched episodes stay separate and your existing library is preserved.</p><div class="actions"><button class="primary" id="transferBackup">Share library backup</button><button class="secondary" id="transferRestore">Import from other device</button></div><p class="micro">This is a manual transfer, not automatic cloud synchronization. Native Apple TV backup import is not yet supported.</p></section><section class="settingCard"><h2>Install Luma on your devices</h2><p><strong>iPhone:</strong> Open the permanent Luma link in Safari. Tap Share, choose Add to Home Screen, keep Open as Web App enabled and tap Add. The Home Screen app opens the latest Luma site.</p><p><strong>Android TV:</strong> The Luma TV APK preview opens the same live site with remote control navigation. Find it in GitHub Releases after the TV build completes.</p><p class="micro"><a href="https://cj42izzle.github.io/Luma-Media-Center/" target="_blank" rel="noopener">Permanent Luma address</a> · Internet required</p></section><section class="settingCard"><h2>About Luma</h2><p>Made for personal media exploration and legally accessible content. Real metadata is not a streaming subscription.</p><p class="micro">TV information by TVmaze. Optional movie and television data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. The browser version of Luma does not run natively on Apple TV.</p><button class="secondary" id="refreshCatalog">Refresh catalog</button></section></div>';$("#content").innerHTML=html+LumaAccounts.settingsMarkup();LumaAccounts.bindSettings();if($("#lumaDiscoveryCountry")){
 $("#lumaDiscoveryCountry").value=viewerCountry();
 $("#lumaDiscoveryCountry").onchange=e=>{
  const before=viewerCountry();
  LumaReleases.setRegion?.(e.target.value);
  if(before!==viewerCountry()){
   tmdbMorePage=2;catalogEnd=false;catalogContext="";
   recommendationKey="";void discover();
  }
 };
}$("#theme").value=state.theme;$("#density").value=state.density;$("#accent").oninput=e=>{state.accent=e.target.value;save("accent",state.accent);paint()};$("#theme").onchange=e=>{state.theme=e.target.value;save("theme",state.theme);paint()};$("#density").onchange=e=>{state.density=e.target.value;save("density",state.density);paint()};$("#toggleOriginalLanguage").onchange=e=>{state.showOriginalLanguage=!!e.target.checked;save("showOriginalLanguage",state.showOriginalLanguage)};$("#toggleEnglishDub").onchange=e=>{state.showEnglishDub=!!e.target.checked;save("showEnglishDub",state.showEnglishDub)};if($("#toggleHomeExtras"))$("#toggleHomeExtras").onchange=e=>{state.showHomeExtras=!!e.target.checked;save("showHomeExtras",state.showHomeExtras);if(state.showHomeExtras&&typeof LumaHome!=="undefined")LumaHome.prime(true).catch(()=>{});};$("#saveTMDB").onclick=()=>{state.tmdbKey=$("#tmdbKey").value.trim();save("tmdbKey",state.tmdbKey);toast("Metadata settings saved");discover()};$("#clearTMDB").onclick=()=>{state.tmdbKey="";save("tmdbKey","");$("#tmdbKey").value="";discover()};$("#exportData").onclick=exportData;$("#shareBackup").onclick=shareBackup;$("#importData").onclick=importBackup;$("#refreshCatalog").onclick=discover;if($("#manageProfiles"))$("#manageProfiles").onclick=()=>{state.tab="Profiles";render()};if($("#transferBackup"))$("#transferBackup").onclick=shareBackup;if($("#transferRestore"))$("#transferRestore").onclick=importBackup}
function exportData(){const data={version:3,profile:state.profile,watch:state.watch,favorites:state.favorites,watchDetails:(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")}catch{return{}}})(),watched:state.watched,progress:state.progress,links:state.links,library:state.library,accent:state.accent,theme:state.theme,density:state.density},blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download="luma-backup-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
async function shareBackup(){let data={version:3,profile:state.profile,watch:state.watch,favorites:state.favorites,watchDetails:(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")}catch{return{}}})(),watched:state.watched,progress:state.progress,links:state.links,library:state.library,accent:state.accent,theme:state.theme,density:state.density};let file=new File([JSON.stringify(data,null,2)],"luma-device-backup.json",{type:"application/json"});try{if(typeof navigator.share!=="function"||navigator.canShare&&!navigator.canShare({files:[file]})){toast("Sharing files is not available here. Downloading a backup instead.");exportData();return}await navigator.share({files:[file],title:"Luma device backup"});toast("Choose Save to Files, then iCloud Drive if available.")}catch(e){if(e?.name!=="AbortError"){toast("Could not open file sharing. Downloading backup instead.");exportData()}}}
function cleanBackup(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||(!Array.isArray(input.watch)&&!Array.isArray(input.library)))throw Error("This is not a supported Luma backup.");
 const validIDs=list=>{
  if(!Array.isArray(list)||list.length>15000)throw Error("Invalid title IDs in backup.");
  return [...new Set(list.filter(x=>typeof x==="string"&&x.length>0&&x.length<=255))];
 };
 const safeObject=(obj,max=6000)=>{
  if(!obj||typeof obj!=="object"||Array.isArray(obj))return {};
  const rows=Object.entries(obj);if(rows.length>max)throw Error("Backup has too many entries.");
  return Object.fromEntries(rows.filter(([k,v])=>k.length>0&&k.length<=255&&!["__proto__","prototype","constructor"].includes(k)&&v&&typeof v==="object"));
 };
 const watch=input.watch===undefined?undefined:validIDs(input.watch);
 const favorites=input.favorites===undefined?undefined:validIDs(input.favorites);
 const watched=input.watched===undefined?undefined:validIDs(input.watched);
 let library;
 if(input.library!==undefined){
  if(!Array.isArray(input.library)||input.library.length>5000)throw Error("Invalid personal library in backup.");
  library=unique(input.library.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)
    &&typeof x.id==="string"&&x.id.length<=255&&typeof x.title==="string"&&x.title.trim().length>0&&x.title.length<=180)
    .map(x=>({
     id:x.id,title:x.title.slice(0,180),type:["Movie","Series","Anime"].includes(x.type)?x.type:"Movie",
     year:String(x.year||"").slice(0,4),url:typeof x.url==="string"&&x.url.startsWith("https://")?x.url.slice(0,2500):"",
     collection:String(x.collection||"").slice(0,60),
     poster:safeArtworkUrl(x.poster),backdrop:safeArtworkUrl(x.backdrop),
     overview:String(x.overview||"From your personal media library.").slice(0,1200)
    })));
 }
 const rawProgress=safeObject(input.progress);
 const progress=Object.fromEntries(Object.entries(rawProgress).filter(([,v])=>Number.isFinite(Number(v.fraction))&&Number(v.fraction)>=0&&Number(v.fraction)<=1)
   .map(([k,v])=>[k,{seconds:Math.max(0,Number(v.seconds)||0),fraction:Number(v.fraction),updated:Number(v.updated)||0}]));
 const rawLinks=safeObject(input.links);
 const links=Object.fromEntries(Object.entries(rawLinks).filter(([,v])=>JSON.stringify(v).length<5000));
 const details=safeObject(input.watchDetails);
 const watchDetails=Object.fromEntries(Object.entries(details).filter(([,v])=>typeof v.title==="string"&&v.title.length<=180)
    .map(([id,v])=>[id,{...v,id,title:v.title.slice(0,180),poster:safeArtworkUrl(v.poster),backdrop:safeArtworkUrl(v.backdrop)}]));
 return {watch,favorites,watched,library,progress,links,watchDetails,
   profile:cleanProfileName(input.profile)||"",
  accent:/^#[0-9a-f]{6}$/i.test(input.accent||"")?input.accent:null,
  theme:["light","dark"].includes(input.theme)?input.theme:null,
  density:["compact","comfortable"].includes(input.density)?input.density:null};
}
function applyBackup(backup,replace=false){
 if(backup.watch!==undefined){state.watch=replace?backup.watch:[...new Set([...state.watch,...backup.watch])];save("watch",state.watch)}
 if(backup.favorites!==undefined){state.favorites=replace?backup.favorites:[...new Set([...state.favorites,...backup.favorites])];save("favorites",state.favorites)}
 if(backup.watched!==undefined){state.watched=replace?backup.watched:[...new Set([...state.watched,...backup.watched])];save("watched",state.watched)}
 if(backup.library!==undefined){state.library=replace?backup.library:unique([...state.library,...backup.library]);save("library",state.library)}
 if(replace){state.progress=backup.progress;state.links=backup.links}else{
   state.progress={...backup.progress,...state.progress};state.links={...backup.links,...state.links};
 }
 save("progress",state.progress);save("links",state.links);
 try{
  const current=JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}");
  const merged=replace?backup.watchDetails:{...backup.watchDetails,...current};
  writeLocalRecord("luma.device.titles.v1",JSON.stringify(merged));
 }catch{toast("Some title snapshots could not be restored.")}
 if(replace){
  if(backup.accent){state.accent=backup.accent;save("accent",state.accent)}
  if(backup.theme){state.theme=backup.theme;save("theme",state.theme)}
  if(backup.density){state.density=backup.density;save("density",state.density)}
 }
}
function importBackup(){
 const input=document.createElement("input");input.type="file";input.accept=".json,application/json";
 input.onchange=async()=>{
  const file=input.files?.[0];if(!file)return;
  try{
   if(file.size>8*1024*1024)throw Error("Backup is too large (maximum 8 MB).");
   const backup=cleanBackup(JSON.parse(await file.text()));
   const existing={watch:state.watch.length,favorites:state.favorites.length,watched:state.watched.length,library:state.library.length,progress:Object.keys(state.progress).length};
   const incoming={watch:backup.watch?.length||0,favorites:backup.favorites?.length||0,watched:backup.watched?.length||0,library:backup.library?.length||0,progress:Object.keys(backup.progress).length};
   modal('<div class="pad"><div class="eyebrow">RESTORE PREVIEW</div><h2>Review your Luma backup</h2><p><strong>Restore into '+safe(state.profile)+'</strong> (current viewer). Backup source: '+safe(backup.profile||"Unknown viewer")+'. Other viewer profiles on this device will not be changed.</p><p>No saved data has been changed yet. Merge keeps existing records when titles or playback bookmarks overlap. Replace swaps the on-device records in this backup, but never changes Trakt or Simkl accounts.</p>'
    +'<div class="backupPreview"><table><thead><tr><th>Category</th><th>On this device</th><th>In backup</th></tr></thead><tbody>'
    +[["watch","Watchlist"],["favorites","Favorites"],["watched","Watched markers"],["library","Personal media"],["progress","Playback bookmarks"]].map(([k,label])=>'<tr><td>'+label+'</td><td>'+existing[k]+'</td><td>'+incoming[k]+'</td></tr>').join("")
    +'</tbody></table></div><div class="actions"><button class="primary" id="mergeBackup">Merge safely</button><button class="secondary" id="replaceBackup">Replace local data</button><button class="secondary" id="cancelBackup">Cancel</button></div>'
    +'<p class="micro">Download a fresh backup first if you might need to undo a replacement. Credentials and add-ons are never imported from this file.</p><button class="secondary" id="backupBeforeReplace">Download current backup</button></div>');
   $("#mergeBackup").onclick=()=>{applyBackup(backup,false);closeModal();discover();toast("Backup merged. Existing local data was preserved.")};
   $("#replaceBackup").onclick=()=>{if(!confirm("Replace your on-device Luma library and playback records with this backup? Download your current backup first if needed."))return;applyBackup(backup,true);closeModal();discover();toast("Local backup restored.")};
   $("#cancelBackup").onclick=closeModal;$("#backupBeforeReplace").onclick=exportData;
  }catch(e){toast("Could not read backup: "+String(e?.message||"Invalid file").slice(0,130))}
 };
 input.click();
}
$("#search").addEventListener("input",e=>onSearch(e.target.value));document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#modal").innerHTML)closeModal()});window.addEventListener("unhandledrejection",e=>{const msg=e.reason?.message||String(e.reason||"Unknown error");if(/(?:runtime\.sendMessage\(\)|chrome\.runtime|browser\.runtime)/i.test(msg)&&/(?:tab not found|invalid call|extension context|receiving end)/i.test(msg)){e.preventDefault();console.info("Browser-extension messaging issue ignored; Luma did not initiate this request.");return}console.error("Luma background task failed:",e.reason);e.preventDefault();const sanitized=msg.replace(/https?:\/\/\S+/g,"[service URL]").slice(0,160);toast("An action failed: "+sanitized+". You can try again without losing your library.")});window.addEventListener("error",e=>{console.error("Luma script error:",e.error||e.message);const box=document.querySelector("#content");if(box&&(!box.children.length||/Loading your media universe/.test(box.textContent||""))){box.innerHTML='<div class="notice"><strong>Luma could not finish loading.</strong><p>Reload the app to retry. Your local watchlist and add-ons are kept on this device.</p><button class="primary" id="restartLuma">Retry loading</button></div>';document.querySelector("#restartLuma").onclick=()=>location.reload()}});window.addEventListener?.("luma-native-iptv-ready",()=>{
 paint();
 if(document.documentElement.dataset.tv==="true")nav();
});
window.addEventListener?.("resize",()=>syncHeaderSearch());
window.LumaRender=render;paint();
void LumaDurable.init().then(({restored})=>{
 if(restored){
  for(const field of PROFILE_FIELDS)state[field]=loadProfileField(field,field==="progress"||field==="links"?{}:[]);
  state.library=store("library",state.library);
  render();void recoverSavedTitles().catch(()=>{});
 }
}).catch(()=>{});
discover();LumaCalendar.prime().catch(()=>{});
if(typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.loadForCalendar==="function"){
 Promise.resolve().then(()=>LumaIPTV.loadForCalendar()).then(()=>{
  if(state.tab==="Home")render();
 }).catch(()=>{});
}
if(typeof LumaHome!=="undefined")LumaHome.prime().catch(()=>{});/* Offline service worker disabled to prevent stale GitHub Pages builds; keep user library in localStorage. */
