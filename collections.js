"use strict";
/* Luma collections. Provider-specific listings are only shown after per-title, per-region
   subscription (flatrate) verification. Streaming metadata is TMDB / JustWatch sourced. */
const LumaCollections=(()=>{
 const services={
  netflix:{label:"Netflix",match:/^netflix$/i,tone:"netflix",description:"Verified Netflix subscription movies and series."},
  "hbo-max":{label:"HBO Max",match:/^(hbo max|max)$/i,tone:"hbo",description:"HBO Max subscription titles in your selected country."},
  disney:{label:"Disney+",match:/^(disney plus|disney\+)$/i,tone:"disney",description:"Disney+ movies and series."},
  hulu:{label:"Hulu",match:/^hulu$/i,tone:"hulu",description:"Hulu subscription titles."},
  prime:{label:"Prime Video",match:/^amazon prime video$/i,tone:"prime",description:"Titles included with Amazon Prime Video."},
  apple:{label:"Apple TV+",match:/^(apple tv\+|apple tv plus)$/i,tone:"apple",description:"Titles included with Apple TV+ (not Apple TV rentals)."},
  paramount:{label:"Paramount+",match:/^(paramount plus|paramount\+)$/i,tone:"paramount",description:"Paramount+ subscription titles."},
  peacock:{label:"Peacock",match:/^(peacock|peacock premium|peacock premium plus)$/i,tone:"peacock",description:"Peacock subscription titles."},
  crunch:{label:"Crunchyroll",match:/^crunchyroll$/i,tone:"crunch",description:"Anime and animation included with Crunchyroll."},
  starz:{label:"STARZ",match:/^starz$/i,tone:"starz",description:"STARZ films and original series."},
  amc:{label:"AMC+",match:/^(amc\+|amc plus)$/i,tone:"amc",description:"AMC+ subscription series and movies."},
  discovery:{label:"discovery+",match:/^(discovery\+|discovery plus)$/i,tone:"discovery",description:"discovery+ documentary and entertainment titles."},
  britbox:{label:"BritBox",match:/^britbox$/i,tone:"britbox",description:"British series and films available on BritBox."},
  shudder:{label:"Shudder",match:/^shudder$/i,tone:"shudder",description:"Horror, thriller and suspense releases available on Shudder."},
  mgm:{label:"MGM+",match:/^(mgm\+|mgm plus)$/i,tone:"mgm",description:"MGM+ subscription movies and series."},
  mubi:{label:"MUBI",match:/^mubi$/i,tone:"mubi",description:"Independent and arthouse titles on MUBI."},
  criterion:{label:"Criterion Channel",match:/^(criterion channel|the criterion channel)$/i,tone:"criterion",description:"Cinema classics and curated films on Criterion Channel."},
  acorn:{label:"Acorn TV",match:/^acorn tv$/i,tone:"acorn",description:"Mystery, drama and international TV titles on Acorn TV."},
  viki:{label:"Rakuten Viki",match:/^(rakuten viki|viki)$/i,tone:"viki",description:"Asian dramas and series available with Viki's subscription."},
  tubi:{label:"Tubi",match:/^(tubi|tubi tv)$/i,tone:"tubi",monetization:["ads","free"],description:"Movies and shows reported as free or ad-supported on Tubi."},
  pluto:{label:"Pluto TV",match:/^pluto tv$/i,tone:"pluto",monetization:["ads","free"],description:"Free or ad-supported movies and shows on Pluto TV."},
  roku:{label:"The Roku Channel",match:/^(the roku channel|roku channel)$/i,tone:"roku",monetization:["ads","free"],description:"Free or ad-supported titles on The Roku Channel."},
  plex:{label:"Plex",match:/^plex$/i,tone:"plex",monetization:["ads","free"],description:"Free or ad-supported titles on Plex."},
  kanopy:{label:"Kanopy",match:/^kanopy$/i,tone:"kanopy",monetization:["free"],description:"Kanopy titles reported free with participating-library access."},
  hoopla:{label:"Hoopla",match:/^hoopla$/i,tone:"hoopla",monetization:["free"],description:"Hoopla titles reported free with participating-library access."}
 };
 const serviceOrder=["netflix","hbo-max","disney","hulu","prime","apple","paramount","peacock","crunch","starz","amc","discovery","britbox","shudder","mgm","mubi","criterion","acorn","viki","tubi","pluto","roku","plex","kanopy","hoopla"];
 function serviceTiers(id){return services[id]?.monetization||["flatrate"]}
 function freeService(id){return serviceTiers(id).some(t=>t==="ads"||t==="free")}

 const definitions={
  discover:{title:"Explore all titles",subtitle:"Discover something new",description:"Browse movies, series and animation from Luma's available metadata sources.",tone:"discovery"},
  movies:{title:"Movies for tonight",subtitle:"Film collection",description:"Find new movies and old favorites, organized for browsing.",tone:"cinema"},
  series:{title:"TV series to explore",subtitle:"Series collection",description:"Discover television series, returning favorites and new stories.",tone:"series"},
  anime:{title:"Anime & animation",subtitle:"Animation collection",description:"Explore animation and Japanese anime, with available posters and release information.",tone:"anime"},
  rated:{title:"Top rated",subtitle:"Audience favorites",description:"Highly rated titles from the available metadata collection.",tone:"rated"},
  adventure:{title:"Adventure & fantasy",subtitle:"Beyond the ordinary",description:"Discover exciting journeys, fantasy and big-screen adventures.",tone:"adventure"},
  scifi:{title:"Science fiction worlds",subtitle:"Future & beyond",description:"Real science-fiction titles across movies, shows and animation.",tone:"adventure"},
  comedy:{title:"Comedy nights",subtitle:"Something funny",description:"Films and shows tagged as comedy by their metadata source.",tone:"series"},
  mystery:{title:"Mystery & crime",subtitle:"Cases and secrets",description:"Investigative dramas and crime stories from the catalog.",tone:"rated"},
  horror:{title:"Horror & thrillers",subtitle:"Something intense",description:"Horror and thriller titles from available feeds.",tone:"cinema"},
  documentary:{title:"Documentary discoveries",subtitle:"Real stories",description:"Documentaries available in your catalog metadata.",tone:"discovery"},
  recent:{title:"Recently released",subtitle:"Fresh discoveries",description:"Newer releases based on published release dates, not proof of streaming availability.",tone:"recent"},
  watchlist:{title:"Your watchlist",subtitle:"Saved for later",description:"Titles saved on this device. Cloud watchlists stay separate.",tone:"watchlist"},
  continue:{title:"Continue watching",subtitle:"Resume your stories",description:"Titles with saved playback progress on this device.",tone:"continue"},
  recommended:{title:"Because you saved these genres",subtitle:"Picked around your tastes",description:"Suggestions inferred from genres in your saved titles, not paid recommendations.",tone:"rated"},
  trending:{title:"Trending today",subtitle:"What people are exploring",description:"Trending titles reported by the metadata source.",tone:"trending"},
  theaters:{title:"In cinemas now",subtitle:"New theatrical releases",description:"Recent first theatrical releases verified for your selected country. This is not a real-time theater schedule.",tone:"cinema"},
  upcoming:{title:"Coming to cinemas",subtitle:"Upcoming new films",description:"New movies with confirmed upcoming theatrical release dates in your selected country. Older re-releases and digital-only titles are excluded.",tone:"cinema"},
  subscription:{title:"Subscription streaming listings",subtitle:"Across streaming services",description:"Titles reported with subscription availability. Select a service for a verified provider-specific view.",tone:"discovery"},
  popularMovies:{title:"Popular movies",subtitle:"In the spotlight",description:"Movies from the current popular metadata feed.",tone:"cinema"}
 };
 const countries={US:"United States",GB:"United Kingdom",CA:"Canada",AU:"Australia"};
 let current={id:"discover",type:"all",sort:"popular",genre:"all",year:"all",language:"all",query:"",page:0,items:[],totalPages:0,loading:false,error:"",hasMore:false,verifiedErrors:0,reportedCandidates:0,failedRequests:0,visibleCount:72};
 let token=0,homeLoading=false,homeKey="",homeReady=new Map(),homeErrors=new Map(),homeCheckedAt=0,searchTimer=null;
 let catalogObserver=null,scrollBound=false;
 function observeAutomaticPages(){
  if(catalogObserver?.disconnect)catalogObserver.disconnect();
  const marker=$("#collectionAutoLoad");
  if(!marker||state.tab!=="Collection"||!state.tmdbKey)return;
  const reveal=()=>{
   if(current.loading)return;
   if(current.visibleCount<currentItems().length){
    current.visibleCount+=48;render();return;
   }
   if((current.page===0||current.hasMore)&&current.failedRequests<10)void loadMore();
  };
  if(typeof IntersectionObserver!=="undefined"){
   catalogObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))reveal()},{rootMargin:"800px 0px"});
   catalogObserver.observe(marker);
  }else if(typeof window!=="undefined"&&!scrollBound&&typeof window.addEventListener==="function"){
   scrollBound=true;
   window.addEventListener("scroll",()=>{
    if(state.tab!=="Collection")return;
    const target=$("#collectionAutoLoad");
    if(target?.getBoundingClientRect?.().top<(Number(window.innerHeight)||800)+800)reveal();
   },{passive:true});
  }
 }
 const providerList=new Map(),verification=new Map(),resultCache=new Map(),PROVIDER_TTL=90*60*1000,VERIFY_TTL=2*60*60*1000;
 function now(){return Date.now()}
 function region(){return LumaReleases.getRegion?.()||"US"}
 function provider(id){return services[id]||null}
 function definition(id){return services[id]||definitions[id]||definitions.discover}
 function isProvider(id){return !!services[id]}
 function collectionID(title,page=""){
  const name=String(title||"").toLowerCase();
  for(const id of serviceOrder){
   if(services[id].label.toLowerCase()===name.trim()||name.startsWith(services[id].label.toLowerCase()+" ·"))return id;
  }
  if(/netflix/.test(name))return "netflix";
  if(/hbo\s*max|(^|\s)max(\s|$)/.test(name))return "hbo-max";
  if(/disney\+/.test(name))return "disney";
  if(/prime video/.test(name))return "prime";
  if(/hulu/.test(name))return "hulu";
  if(/continue|pick up/.test(name))return "continue";
  if(/watchlist/.test(name))return "watchlist";
  if(/anime|animation/.test(name))return "anime";
  if(/science fiction|sci-fi|space worlds/.test(name))return "scifi";
  if(/comedy nights/.test(name))return "comedy";
  if(/mystery & crime|crime & mystery/.test(name))return "mystery";
  if(/horror & thriller/.test(name))return "horror";
  if(/documentary discover/.test(name))return "documentary";
  if(/adventure|fantasy/.test(name))return "adventure";
  if(/top.rated|highest.rated/.test(name))return "rated";
  if(/because you|recommended/.test(name))return "recommended";
  if(/upcoming|coming to/.test(name))return "upcoming";
  if(/theatrical|theaters|cinemas/.test(name))return "theaters";
  if(/streaming listings|subscription streaming/.test(name))return "subscription";
  if(/just released|recently released/.test(name))return "recent";
  if(/trending|spotlight/.test(name))return "trending";
  if(/popular movies|movies to discover/.test(name))return "popularMovies";
  if(/tv series|top shows|series to explore/.test(name))return "series";
  if(/movies for|movie collection|films/.test(name))return "movies";
  const byPage={"TV Shows":"series","Movies":"movies","Anime":"anime","Watchlist":"watchlist","Continue Watching":"continue","Releases":"recent","Catalogs":"discover"};
  return byPage[page]||"discover";
 }
 function allCatalog(){
  return unique([...(state.items||[]),...LumaReleases.all(),...store("catalog",[])].filter(x=>x?.id));
 }
 function localItems(id){
  if(isProvider(id))return [];
  const all=allCatalog(),kind=x=>String(x.type||"");
  const recent=x=>{const t=Date.parse(x.date||"");return Number.isFinite(t)&&t<=now()&&t>=now()-45*86400000&&
    (x.type!=="Movie"||LumaReleases.originalRecent(x.originalReleaseDate||(x.year?x.year+"-01-01":x.date)))};
  if(id==="watchlist")return libraryGroups().saved;
  if(id==="continue")return libraryGroups().watching;
  if(id==="recommended")return suggestedTitles(all);
  if(id==="movies")return all.filter(x=>kind(x)==="Movie");
  if(id==="series")return all.filter(x=>kind(x)==="Series"||kind(x)==="Anime");
  if(id==="anime")return all.filter(x=>kind(x)==="Anime"||(x.genreNames||[]).some(g=>/animat|anime/i.test(g)));
  if(id==="rated")return all.filter(x=>Number(x.rating)>=7).sort((a,b)=>Number(b.rating)-Number(a.rating));
  if(id==="adventure")return all.filter(x=>(x.genreNames||[]).some(g=>/adventure|fantasy/i.test(g)));
  if(id==="scifi")return all.filter(x=>(x.genreNames||[]).some(g=>/science fiction|sci-fi|sci fi|sci-fi & fantasy/i.test(g)));
  if(id==="comedy")return all.filter(x=>(x.genreNames||[]).some(g=>/comedy/i.test(g)));
  if(id==="mystery")return all.filter(x=>(x.genreNames||[]).some(g=>/mystery|crime/i.test(g)));
  if(id==="horror")return all.filter(x=>(x.genreNames||[]).some(g=>/horror|thriller/i.test(g)));
  if(id==="documentary")return all.filter(x=>(x.genreNames||[]).some(g=>/documentary/i.test(g)));
  if(id==="recent")return all.filter(recent).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  if(id==="upcoming")return LumaReleases.upcomingMovies();
  if(id==="trending")return unique([...LumaReleases.feed("trending"),...all]);
  if(id==="theaters")return LumaReleases.inTheaters();
  if(id==="popularMovies")return unique([...LumaReleases.feed("popularMovies"),...all.filter(x=>x.type==="Movie")]);
  if(id==="subscription")return unique([...LumaReleases.feed("streamingMovies"),...LumaReleases.feed("streamingTV")]);
  return all;
 }
 function providerMatch(key,name){return !!services[key]?.match.test(String(name||"").trim())}
 async function providerIDs(key,area){
  const cacheKey=key+"|"+area,old=providerList.get(cacheKey);
  if(old&&now()-old.time<PROVIDER_TTL)return old.value;
  const results=await Promise.allSettled(["movie","tv"].map(async kind=>{
   const data=await tmdb("watch/providers/"+kind,{watch_region:area});
   const matches=(Array.isArray(data?.results)?data.results:[])
     .filter(v=>providerMatch(key,v.provider_name)&&Number.isInteger(Number(v.provider_id))&&Number(v.provider_id)>0);
   return {kind,ids:[...new Set(matches.map(v=>Number(v.provider_id)))]};
  }));
  const ids={movie:null,tv:null,movieAll:[],tvAll:[]},errors=[];
  for(const outcome of results){
   if(outcome.status==="fulfilled"){
    ids[outcome.value.kind+"All"]=outcome.value.ids;
    ids[outcome.value.kind]=outcome.value.ids[0]||null;
   }else errors.push(String(outcome.reason?.message||"provider lookup failed"));
  }
  if(!ids.movie&&!ids.tv)throw Error(errors.length
   ?"Could not retrieve provider IDs for "+(countries[area]||area)+". Check your TMDB configuration."
   :"This service is not listed for "+(countries[area]||area)+" by TMDB.");
  providerList.set(cacheKey,{value:ids,time:now()});
  return ids;
 }
 const GENRE_ID_MAP={
  movie:{"Action":28,"Adventure":12,"Animation":16,"Comedy":35,"Crime":80,"Documentary":99,"Drama":18,"Family":10751,"Fantasy":14,"History":36,"Horror":27,"Music":10402,"Mystery":9648,"Romance":10749,"Science Fiction":878,"Thriller":53,"War":10752,"Western":37},
  tv:{"Action & Adventure":10759,"Animation":16,"Comedy":35,"Crime":80,"Documentary":99,"Drama":18,"Family":10751,"Kids":10762,"Mystery":9648,"Reality":10764,"Sci-Fi & Fantasy":10765,"Talk":10767,"War & Politics":10768,"Western":37}
 };
 const languages={all:"All languages",en:"English",ja:"Japanese",ko:"Korean",es:"Spanish",fr:"French",hi:"Hindi",zh:"Chinese"};
 function filtersFor(kind,filter={}){
  const params={};
  if(filter.genre&&filter.genre!=="all"){
   const genre=GENRE_ID_MAP[kind]?.[filter.genre];
   if(genre)params.with_genres=String(genre);
  }
  if(filter.year&&filter.year!=="all"){
   const y=Number(filter.year);
   if(Number.isInteger(y)&&y>=1900&&y<=new Date().getFullYear()+2)params[kind==="tv"?"first_air_date_year":"primary_release_year"]=String(y);
  }
  if(filter.language&&filter.language!=="all"&&languages[filter.language])params.with_original_language=filter.language;
  return params;
 }
 function itemMatchesFilter(item,filter={}){
  if(filter.genre&&filter.genre!=="all"&&!(item.genreNames||[]).includes(filter.genre))return false;
  if(filter.year&&filter.year!=="all"&&Number(item.year)!==Number(filter.year))return false;
  if(filter.language&&filter.language!=="all"&&item.original_language&&item.original_language!==filter.language)return false;
  return true;
 }
 async function verifyOne(item,kind,providerId,area,monetization=["flatrate"]){
  const validIds=(Array.isArray(providerId)?providerId:[providerId]).filter(Boolean).map(Number);
  if(!validIds.length||!item.tmdbId)return false;
  const tiers=Array.isArray(monetization)?monetization:["flatrate"];
  const key=[kind,item.tmdbId,area,validIds.join(","),...tiers].join("|"),old=verification.get(key);
  if(old&&now()-old.time<VERIFY_TTL)return old.ok;
  const entry=await tmdb(kind+"/"+item.tmdbId+"/watch/providers");
  const offers=entry?.results?.[area]||{};
  const ok=tiers.some(t=>Array.isArray(offers[t])&&offers[t].some(p=>validIds.includes(Number(p.provider_id))));
  verification.set(key,{ok,time:now()});
  return ok;
 }
 async function verifiedTitles(rows,ids,area,limit=40,monetization=["flatrate"]){
  const out=[],errors=[];
  const candidates=rows.slice(0,limit);
  for(let i=0;i<candidates.length;i+=5){
   const chunk=candidates.slice(i,i+5);
   const found=await Promise.allSettled(chunk.map(async item=>{
    const kind=item.mediaType==="tv"?"tv":"movie",providerID=ids[kind+"All"]?.length?ids[kind+"All"]:[ids[kind]];
    if(!providerID)return null;
    return await verifyOne(item,kind,providerID,area,monetization)?item:null;
   }));
   found.forEach((v,j)=>{if(v.status==="fulfilled"&&v.value)out.push(v.value);else if(v.status==="rejected")errors.push(chunk[j].title)});
  }
  return {items:unique(out),errors:errors.length,candidates:candidates.length};
 }
 function discoveryConfig(id,kind){
  const isTv=kind==="tv",params={include_adult:"false"};
  if(id==="anime"){params.with_genres="16";if(isTv)params.with_original_language="ja";}
  if(id==="adventure"){params.with_genres=isTv?"10765":"12|14";}
  if(id==="rated"){params["vote_count.gte"]="150";}
  if(id==="recent"){
   const d=new Date();d.setDate(d.getDate()-60);
   params[isTv?"first_air_date.gte":"primary_release_date.gte"]=d.toISOString().slice(0,10);
   params[isTv?"first_air_date.lte":"primary_release_date.lte"]=new Date().toISOString().slice(0,10);
  }
  if(id==="upcoming"&&!isTv)params["primary_release_date.gte"]=new Date().toISOString().slice(0,10);
  return params;
 }
 function apiSort(sort,kind){
  if(sort==="rating")return "vote_average.desc";
  if(sort==="newest")return kind==="tv"?"first_air_date.desc":"primary_release_date.desc";
  return "popularity.desc";
 }
 async function loadPage(id,page,type,sort,area,preview=false,filter={}){
  const cleanFilter={genre:filter.genre||"all",year:filter.year||"all",language:filter.language||"all",query:String(filter.query||"").trim().slice(0,120)};
  if(id==="upcoming"||id==="theaters"){
   if(type==="Series")return {items:[],pages:1,errors:0,candidates:0,failed:0};
   const cinemaFilters={...cleanFilter,genreId:GENRE_ID_MAP.movie[cleanFilter.genre]||null};
   const data=await LumaReleases.cinemaTitles(id,page,area,{limit:20,filter:cinemaFilters});
   return {items:data.items,pages:data.pages,errors:data.errors,candidates:data.candidates,failed:0};
  }
  const cacheKey=[id,page,type,sort,area,preview?"preview":"full",JSON.stringify(cleanFilter)].join("|");
  const cached=resultCache.get(cacheKey);
  if(cached&&now()-cached.time<30*60*1000)return cached.value;
  const kinds=type==="Movie"?["movie"]:type==="Series"?["tv"]:["tv","movie"];
  const ids=isProvider(id)?await providerIDs(id,area):null;
  const subscriptionTypes=isProvider(id)?serviceTiers(id):["flatrate"];
  const queries=kinds.map(async kind=>{
   if(ids&&!ids[kind])return {items:[],pages:0,total:0,errors:0,candidates:0};
   const params={...discoveryConfig(id,kind),...filtersFor(kind,cleanFilter),page,sort_by:apiSort(sort,kind)};
   let endpoint="discover/"+kind;
   if(ids){
    params.watch_region=area;
    params.with_watch_providers=(ids[kind+"All"]?.length?ids[kind+"All"]:[ids[kind]]).join("|");
    params.with_watch_monetization_types=subscriptionTypes.join("|");
   }else if(id==="subscription"){
    params.watch_region=area;params.with_watch_monetization_types="flatrate";
   }else if(id==="trending"){endpoint="trending/"+kind+"/day";}
   else if(id==="theaters"&&kind==="movie")endpoint="movie/now_playing";
   else if(id==="upcoming"&&kind==="movie")endpoint="movie/upcoming";
   else if(id==="popularMovies"&&kind==="movie")endpoint="movie/popular";
   if(cleanFilter.query){
    endpoint="search/"+kind;
    // Search results are NOT provider-filtered by TMDB; every displayed title
    // must pass the exact provider's regional availability check below.
    const q=cleanFilter.query;
    for(const k of Object.keys(params))if(!["page","include_adult"].includes(k))delete params[k];
    params.query=q;
   }
   const data=await tmdb(endpoint,params);
   const rows=(Array.isArray(data?.results)?data.results:[])
    .filter(x=>Number.isFinite(Number(x.id))&&x.id)
    .map(x=>normalizeTMDB({...x,media_type:kind}))
    .filter(x=>!cleanFilter.query||itemMatchesFilter(x,cleanFilter));
   if(!ids)return {items:rows,pages:Math.min(Number(data?.total_pages)||1,500),total:Number(data?.total_results)||rows.length,errors:0,candidates:rows.length};
   const verified=await verifiedTitles(rows,ids,area,preview?8:40,subscriptionTypes);
   return {items:verified.items.map(x=>({...x,availabilityLabel:services[id]?.label||"",availabilityRegion:area,offerType:freeService(id)?"free":"subscription"})),pages:Math.min(Number(data?.total_pages)||1,500),total:Number(data?.total_results)||rows.length,errors:verified.errors,candidates:verified.candidates};
  });
  const settled=await Promise.allSettled(queries),good=settled.filter(x=>x.status==="fulfilled");
  if(!good.length)throw Error("The catalog service could not retrieve titles. Check the TMDB key, permissions or network.");
  const all=unique(good.flatMap(x=>x.value.items));
  const value={items:all,pages:Math.max(1,...good.map(x=>x.value.pages)),errors:good.reduce((sum,x)=>sum+x.value.errors,0),
   candidates:good.reduce((sum,x)=>sum+x.value.candidates,0),failed: settled.length-good.length};
  if(good.length!==settled.length&&!all.length)throw Error("This collection could not be verified in "+(countries[area]||area)+".");
  resultCache.set(cacheKey,{value,time:now()});
  return value;
 }
 function getPreview(id){const entry=homeReady.get(id+"|"+region());return entry?.items||[]}
 function find(id){
  return current.items.find(x=>x.id===id)||[...homeReady.values()].flatMap(v=>v.items||[]).find(x=>x.id===id)||null;
 }
 async function loadHome(){
  if(!state.tmdbKey||homeLoading)return;
  const area=region(),key=String(state.tmdbKey).slice(0,12)+"|"+area;
  if(homeKey===key&&now()-homeCheckedAt<10*60*1000)return;
  homeKey=key;homeCheckedAt=now();homeLoading=true;
  try{
   await Promise.allSettled(["netflix","hbo-max"].map(async id=>{
    try{
     const data=await loadPage(id,1,"all","popular",area,true);
     homeReady.set(id+"|"+area,{items:data.items,updated:now()});homeErrors.delete(id+"|"+area);
    }catch(e){homeErrors.set(id+"|"+area,String(e?.message||"Unavailable"))}
   }));
  }finally{
   homeLoading=false;
   if(["Home","Streaming"].includes(state.tab)&&!state.q)window.LumaRender?.();
  }
 }
 function serviceCard(id){
  const entry=services[id],free=freeService(id);
  return '<button type="button" class="platformTile platform-'+safe(entry.tone)+'" data-collection-id="'+id+'" aria-label="Browse '+safe(entry.label)+' '+(free?"free or ad-supported":"subscription")+' titles">'
   +'<span class="platformIcon">'+(free?"▶":"✦")+'</span><strong>'+safe(entry.label)+'</strong>'
   +'<span>'+(free?"Free / with ads":"Subscription")+' <span aria-hidden="true">›</span></span></button>';
 }
 function providerShowcase(){
  const area=region();
  let html='<section class="lumaPlatformShowcase"><div class="platformIntro"><div><div class="eyebrow">STREAMING SERVICE DIRECTORY</div>'
   +'<h2>Find your next favorite show</h2><p>Explore subscription and free streaming services in '+safe(countries[area]||area)+'. Each company page checks its own reported catalog rather than guessing from a film’s producer.</p></div></div>'
   +'<div class="platformGroup"><div class="platformGroupHead"><h3>Subscription networks</h3><span>'+serviceOrder.filter(id=>!freeService(id)).length+' services</span></div>'
   +'<div class="platformTiles">'+serviceOrder.filter(id=>!freeService(id)).map(serviceCard).join("")+'</div></div>'
   +'<div class="platformGroup"><div class="platformGroupHead"><h3>Free & ad-supported</h3><span>'+serviceOrder.filter(freeService).length+' services</span></div>'
   +'<div class="platformTiles">'+serviceOrder.filter(freeService).map(serviceCard).join("")+'</div></div>';
  if(!state.tmdbKey)html+='<p class="platformKeyMessage">To display verified service catalogs, add a TMDB read-only API credential in <button type="button" data-go="Settings">Settings</button>. Luma will not assign titles to providers without evidence.</p>';
  html+='</section>';
  if(state.tmdbKey){
   const checkKey=String(state.tmdbKey).slice(0,12)+"|"+area;
   if(!homeLoading&&(homeKey!==checkKey||now()-homeCheckedAt>=10*60*1000))void loadHome();
   for(const id of ["netflix","hbo-max"]){
    const items=getPreview(id);
    if(items.length)html+=shelf(services[id].label+" · movies & series",items,"Subscription titles reported in "+(countries[area]||area),id);
    const error=homeErrors.get(id+"|"+area);
    if(error&&state.tab==="Streaming")html+='<p class="platformLoading">'+safe(services[id].label)+': '+safe(error)+'</p>';
   }
   if(homeLoading&&!getPreview("netflix").length&&!getPreview("hbo-max").length)html+='<p class="platformLoading">Checking featured network listings…</p>';
  }
  return html;
 }
 function open(id){
  if(!services[id]&&!definitions[id])id="discover";
  token++;current={id,type:"all",sort:"popular",genre:"all",year:"all",language:"all",query:"",page:0,items:[],totalPages:0,loading:false,error:"",hasMore:false,verifiedErrors:0,reportedCandidates:0,failedRequests:0,visibleCount:72};
  state.tab="Collection";state.q="";
  if($("#search"))$("#search").value="";
  window.scrollTo?.({top:0,behavior:"smooth"});
  render();
  if(state.tmdbKey&&id!=="continue"&&id!=="watchlist"&&id!=="recommended")void loadMore();
 }
 function resetResults(){
  token++;
  current.loading=false;current.page=0;current.items=[];current.totalPages=0;current.hasMore=false;
  current.verifiedErrors=0;current.reportedCandidates=0;current.failedRequests=0;current.error="";current.visibleCount=72;
  render();
  if(state.tmdbKey&&current.id!=="continue"&&current.id!=="watchlist"&&current.id!=="recommended")void loadMore();
 }
 async function loadMore(){
  if(current.loading||!state.tmdbKey)return;
  const session=token,id=current.id,area=region(),type=current.type,sort=current.sort,filter={
   genre:current.genre,year:current.year,language:current.language,query:current.query
  };
  const batch=isProvider(id)?2:1,first=current.page+1;
  current.loading=true;current.error="";render();
  let lastError="";
  try{
   for(let n=0;n<batch;n++){
    const page=first+n;if(session!==token||state.tab!=="Collection")return;
    if(page>80||current.totalPages&&page>current.totalPages)break;
    let data;
    try{data=await loadPage(id,page,type,sort,area,false,filter);}
    catch(e){lastError=String(e?.message||"Catalog temporarily unavailable").slice(0,180);break;}
    if(session!==token||state.tab!=="Collection")return;
    current.page=page;current.totalPages=data.pages;
    current.verifiedErrors+=data.errors;current.reportedCandidates+=data.candidates;current.failedRequests+=data.failed;
    current.items=unique([...current.items,...data.items]);
    current.hasMore=page<data.pages&&page<80;
    // Display additional results as soon as the first batch completes.
    if(n+1<batch){render();}
    if(!current.hasMore)break;
   }
   if(session!==token||state.tab!=="Collection")return;
   if(lastError)current.error=lastError+(current.items.length?" Previously loaded results are still available.":"");
   else if(!current.items.length)current.error=isProvider(id)
    ?"No verified titles matched these filters yet. Try another year or genre.":"No matching titles on these pages.";
  }finally{if(session===token){current.loading=false;render();}}
 }

 function currentItems(){
  const id=current.id,source=isProvider(id)?current.items:unique([...current.items,...localItems(id)]);
  const q=current.query.trim().toLowerCase();
  let rows=source.filter(x=>(current.type==="all"||x.type===current.type||(current.type==="Series"&&x.type==="Anime"))
    &&(current.genre==="all"||(x.genreNames||[]).includes(current.genre))
    &&(current.year==="all"||Number(x.year)===Number(current.year))
    &&(current.language==="all"||!x.original_language||x.original_language===current.language)
    &&(!q||[x.title,x.overview,x.year,x.genreNames?.join(" ")].some(v=>String(v||"").toLowerCase().includes(q))));
  if(current.sort==="title")rows.sort((a,b)=>String(a.title).localeCompare(String(b.title)));
  if(current.sort==="rating")rows.sort((a,b)=>Number(b.rating||0)-Number(a.rating||0));
  if(current.sort==="newest")rows.sort((a,b)=>Number(b.year||0)-Number(a.year||0));
  return rows;
 }
 function renderCollection(){
  const id=current.id,d=definition(id),allItems=currentItems(),items=allItems.slice(0,current.visibleCount),area=region(),network=isProvider(id),
   isFree=network&&freeService(id),isCinema=id==="upcoming"||id==="theaters";
  const base=network?services[id].description:d.description;
  const artwork=items.find(x=>safeArtworkUrl(x.backdrop))||items.find(x=>safeArtworkUrl(x.poster));
  const src=artwork&&safeArtworkUrl(artwork.backdrop||artwork.poster);
  const genres=Object.keys(GENRE_ID_MAP.movie).concat(Object.keys(GENRE_ID_MAP.tv));
  const genreChoices=[...new Set([...genres,...current.items.flatMap(x=>x.genreNames||[]),...localItems(id).flatMap(x=>x.genreNames||[])])].sort();
  const titleCount=items.filter(x=>x.type==="Movie").length,
   showCount=items.filter(x=>x.type==="Series"||x.type==="Anime").length;
  const nowYear=new Date().getFullYear();
  const years=Array.from({length:Math.min(30,nowYear-1999)},(_,i)=>nowYear-i);
  let html='<section class="collectionFeature collection-'+safe(d.tone)+'">'
   +(src?'<img class="collectionFeatureArt" src="'+safe(src)+'" alt="" onerror="this.remove()" loading="eager">':'')
   +'<div class="collectionFeatureShade"></div><div class="collectionFeatureContent">'
   +'<div class="eyebrow">'+(network?(isFree?"FREE STREAMING NETWORK":"SUBSCRIPTION NETWORK"):"LUMA COLLECTIONS")+' · '+safe(d.subtitle||"EXPLORE")+'</div>'
   +'<h2>'+safe(d.label||d.title)+'</h2><p>'+safe(base)+'</p>'
   +'<div class="collectionFeatureActions"><button class="secondary" id="collectionBack">← Home</button>'
   +'<button class="secondary" id="collectionBrowse">All Luma catalogs</button></div></div></section>';
  if(network)html+='<p class="collectionAccuracy"><strong>'+(isFree?"Free / ad-supported":"Subscription")+' listings · '+safe(countries[area]||area)+'</strong>. Only titles verified for this exact provider and country are shown. '
   +(isFree?"Free streaming may require ads or participating-library access.":"Subscription availability does not guarantee your account includes a specific title.")
   +' <span>Source: TMDB / JustWatch metadata.</span></p>';
  if(isCinema)html+='<p class="collectionAccuracy"><strong>Verified theatrical dates · '+safe(countries[area]||area)+'</strong>. Showing only new movies with country-specific limited or wide theatrical dates, not old-film re-releases or digital-only releases. This does not confirm theater showtimes.</p>';
  if(!state.tmdbKey&&network)html+='<div class="collectionNeedKey"><h3>Enable '+safe(d.label)+' catalog information</h3>'
   +'<p>Connect a read-only TMDB API credential to retrieve actual '+safe(d.label)+' movies and TV series. Luma will not invent the contents of a streaming service.</p>'
   +'<button class="primary" data-go="Settings">Configure TMDB in Settings</button></div>';
  html+='<div class="collectionControls collectionBrowseFilters">'
   +'<label>Search '+(network?"this network":"loaded titles")+'<input id="collectionSearch" type="search" value="'+safe(current.query)+'" placeholder="Search movies and shows"></label>'
   +'<label>Content<select id="collectionType"><option value="all">'+(isCinema?"Cinema movies only":"Movies & series")+'</option>'
   +'<option value="Movie"'+(current.type==="Movie"?" selected":"")+'>Movies</option>'
   +(isCinema?"":'<option value="Series"'+(current.type==="Series"?" selected":"")+'>TV & anime</option>')+'</select></label>'
   +'<label>Genre<select id="collectionGenre"><option value="all">All genres</option>'
   +genreChoices.map(g=>'<option value="'+safe(g)+'"'+(current.genre===g?" selected":"")+'>'+safe(g)+'</option>').join("")+'</select></label>'
   +'<label>Release year<select id="collectionYear"><option value="all">All years</option>'
   +years.map(y=>'<option value="'+y+'"'+(String(current.year)===String(y)?" selected":"")+'>'+y+'</option>').join("")+'</select></label>'
   +'<label>Language<select id="collectionLanguage">'+Object.entries(languages).map(([v,name])=>'<option value="'+v+'"'+(current.language===v?" selected":"")+'>'+safe(name)+'</option>').join("")+'</select></label>'
   +'<label>Sort<select id="collectionSort"><option value="popular">Popular first</option>'
   +'<option value="rating"'+(current.sort==="rating"?" selected":"")+'>Highest rated</option>'
   +'<option value="newest"'+(current.sort==="newest"?" selected":"")+'>Newest releases</option>'
   +'<option value="title"'+(current.sort==="title"?" selected":"")+'>Title A–Z (loaded)</option></select></label>'
   +(network?'<label>Country<select id="collectionRegion">'+Object.entries(countries).map(([code,label])=>'<option value="'+code+'"'+(area===code?" selected":"")+'>'+safe(label)+'</option>').join("")+'</select></label>':"")
   +'<button type="button" class="secondary collectionReset" id="collectionReset">Reset filters</button></div>';
  html+='<div class="collectionResultsHeader"><div><h3>'+safe(network?d.label+" catalog":"Explore titles")+'</h3>'
   +'<p>'+items.length+' matching titles · '+titleCount+' movies · '+showCount+' TV / anime'
   +(current.page?' · '+current.page+' catalog page'+(current.page===1?"":"s")+' checked':"")+'</p>'
   +'</div>'+(current.loading?'<span class="collectionLoading">Loading verified results…</span>':"")+'</div>';
  if(items.length)html+='<div class="collectionGallery">'+items.map(itemHTML).join("")+'</div>';
  else if(!current.loading)html+='<div class="collectionEmpty">'+(current.error?safe(current.error):state.tmdbKey?"No verified titles yet. Try another year, genre or search query.":"Add a TMDB read-only key to load this service’s catalog.")+'</div>';
  if(current.error&&items.length)html+='<p class="collectionError">'+safe(current.error)+'</p>';
  if(current.verifiedErrors||current.failedRequests)html+='<p class="collectionCaution">'+current.verifiedErrors+' availability checks and '+current.failedRequests+' catalog requests could not be completed. Unverified titles were not displayed.</p>';
  if(state.tmdbKey&&!["continue","watchlist","recommended"].includes(id)
     &&(current.page===0||current.hasMore||current.visibleCount<allItems.length)){
   html+='<div class="collectionLoadMore" id="collectionAutoLoad" role="status">'+
    (current.loading?'Loading additional verified titles…':'More verified titles load automatically as you browse.')+'</div>';
  }
  if(allItems.length>items.length)html+='<p class="micro">Showing '+items.length+' of '+allItems.length+' loaded titles. Scroll to see the rest.</p>';
  return html;
 }
 function bind(){
  if($("#collectionBack"))$("#collectionBack").onclick=()=>{token++;state.tab="Home";render();window.scrollTo?.({top:0,behavior:"smooth"})};
  if($("#collectionBrowse"))$("#collectionBrowse").onclick=()=>{token++;state.tab="Catalogs";render()};
  observeAutomaticPages();
  if($("#collectionReset"))$("#collectionReset").onclick=()=>{
   current.type="all";current.sort="popular";current.genre="all";current.year="all";current.language="all";current.query="";
   resetResults();
  };
  if($("#collectionSearch")){
   const field=$("#collectionSearch");
   field.oninput=e=>{
    const v=String(e.target.value||"");current.query=v;
    if(searchTimer)clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
     const value=current.query;resetResults();
     const next=$("#collectionSearch");if(next){next.focus();try{next.setSelectionRange(value.length,value.length)}catch{}}
    },430);
   };
  }
  for(const [selector,key] of [["#collectionGenre","genre"],["#collectionType","type"],["#collectionYear","year"],["#collectionLanguage","language"],["#collectionSort","sort"]]){
   const el=$(selector);if(el)el.onchange=e=>{current[key]=e.target.value;resetResults()};
  }
  if($("#collectionRegion"))$("#collectionRegion").onchange=e=>{
   LumaReleases.setRegion?.(e.target.value);resetResults();
  };
 }
 return {collectionID,providerShowcase,open,renderCollection,bind,find,loadMore,loadPage,providerIDs,verifyOne,currentItems,localItems,services,getPreview};
})();
