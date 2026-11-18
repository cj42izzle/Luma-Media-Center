
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store=(key,fallback)=>{try{return JSON.parse(localStorage.getItem("luma.v2."+key))??fallback}catch{return fallback}};
const save=(key,v)=>{try{localStorage.setItem("luma.v2."+key,JSON.stringify(v))}catch{toast("This browser could not save changes.")}};
const state={tab:"Home",q:"",type:"all",items:[],selected:null,details:null,season:1,profile:store("profile","You"),watch:store("watch",[]),watched:store("watched",[]),progress:store("progress",{}),links:store("links",{}),library:store("library",[]),tmdbKey:store("tmdbKey",""),accent:store("accent","#fa3f56"),theme:store("theme","dark"),density:store("density","comfortable"),filter:"all",loading:true,source:"",message:"",playerKey:"",lastSave:0};
const colorPick=["#594083","#4b6ca2","#764f78","#346c6e","#8c565b","#785b3b"];
const fallback=[["ttv:82","Game of Thrones","Series",2011],["ttv:169","Breaking Bad","Series",2008],["ttv:73","The Walking Dead","Series",2010],["ttv:431","Friends","Series",1994],["ttv:83","The Simpsons","Series",1989]];
const TMDB_GENRES={movie:{28:"Action",12:"Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",14:"Fantasy",36:"History",27:"Horror",10402:"Music",9648:"Mystery",10749:"Romance",878:"Science Fiction",10770:"TV Movie",53:"Thriller",10752:"War",37:"Western"},tv:{10759:"Action & Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",10762:"Kids",9648:"Mystery",10763:"News",10764:"Reality",10765:"Sci-Fi & Fantasy",10766:"Soap",10767:"Talk",10768:"War & Politics",37:"Western"}};
function tmdbGenreNames(type,ids){return [...new Set((ids||[]).map(id=>(TMDB_GENRES[type]||{})[id]).filter(Boolean))]}
function tmdbType(x){return x.media_type==="tv"&&x.original_language==="ja"&&(x.genre_ids||[]).includes(16)?"Anime":x.media_type==="tv"?"Series":"Movie"}
function safeArtworkUrl(path){try{const u=new URL(String(path||""));return u.protocol==="https:"&&!u.username&&!u.password?u.href:""}catch{return""}}
function idKey(x){return x?.id||""}
function image(path,w=500){if(!path)return"";if(path.startsWith("https:"))return path;return "https://image.tmdb.org/t/p/w"+w+path}
function normalizeTMDB(x){return {id:"tmdb:"+x.media_type+":"+x.id,tmdbId:x.id,mediaType:x.media_type,title:x.title||x.name||"Untitled",type:tmdbType(x),year:(x.release_date||x.first_air_date||"").slice(0,4),overview:x.overview||"No description available.",poster:image(x.poster_path),backdrop:image(x.backdrop_path,1280),rating:x.vote_average?Number(x.vote_average).toFixed(1):"",source:"tmdb",date:x.release_date||x.first_air_date||"",popularity:x.popularity||0,genres:x.genre_ids||[],genreNames:tmdbGenreNames(x.media_type,x.genre_ids||[])}}
function normalizeTVMaze(x){let y=x.show||x;return{id:"tvmaze:"+y.id,mazeId:y.id,title:y.name||"Untitled",type:(y.genres||[]).includes("Anime")?"Anime":"Series",year:(y.premiered||"").slice(0,4),overview:(y.summary||"").replace(/<[^>]*>/g,"")||"No description available.",poster:y.image?.medium||y.image?.original||"",backdrop:y.image?.original||"",rating:y.rating?.average||"",source:"tvmaze",genres:y.genres||[],date:y.premiered||"",imdbId:y.externals?.imdb||"",tvStatus:y.status||"",genreNames:y.genres||[],runtime:y.runtime||y.averageRuntime||0,network:y.network?.name||y.webChannel?.name||""}}
function normalizeChart(x,i){const imgs=x["im:image"]||[],name=x["im:name"]?.label||"Movie",entryId=x.id?.attributes?.["im:id"]||i;return{id:"applechart:"+entryId,title:name,type:"Movie",year:(x["im:releaseDate"]?.label||"").slice(0,4),overview:x.summary?.label||"Popular movie.",poster:(imgs[imgs.length-1]?.label||"").replace(/\d+x\d+bb/,"600x600bb"),backdrop:"",source:"applechart",date:x["im:releaseDate"]?.label||"",genreNames:[x.category?.attributes?.label].filter(Boolean)}}
function normalizeITunes(x){return{id:"itunes:"+x.trackId,title:x.trackName||x.collectionName||"Untitled",type:x.kind==="tv-episode"?"Series":"Movie",year:(x.releaseDate||"").slice(0,4),overview:x.longDescription||x.shortDescription||"",poster:(x.artworkUrl100||"").replace("100x100bb","600x600bb"),backdrop:"",source:"itunes",preview:x.previewUrl||"",date:x.releaseDate||"",genreNames:[x.primaryGenreName].filter(Boolean),runtime:x.trackTimeMillis?Math.round(x.trackTimeMillis/60000):0}}
function normalizeOwn(x){return{...x,type:x.type||"Movie",source:"personal",poster:safeArtworkUrl(x.poster),backdrop:safeArtworkUrl(x.backdrop)}}
function unique(items){const seen=new Set;return items.filter(x=>{if(!x?.id||seen.has(x.id))return false;seen.add(x.id);return true})}
function paint(){document.documentElement.style.setProperty("--accent",state.accent);document.documentElement.dataset.theme=state.theme;document.documentElement.dataset.density=state.density}
function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.add("visible");setTimeout(()=>t.classList.remove("visible"),4000)}
async function api(url,opts={}){let controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{let r=await fetch(url,{...opts,signal:controller.signal});if(!r.ok)throw Error("Service error "+r.status);return await r.json()}finally{clearTimeout(timer)}}
async function tmdb(endpoint,params={}){if(!state.tmdbKey)throw Error("TMDB not configured");let p=new URLSearchParams({...params,language:"en-US"}),token=state.tmdbKey.trim(),headers={};if(token.startsWith("eyJ"))headers.Authorization="Bearer "+token;else p.set("api_key",token);return api("https://api.themoviedb.org/3/"+endpoint+"?"+p, {headers})}
let catalogRequestVersion=0;
let catalogMoreLoading=false,catalogEnd=false,catalogMoreError="",tmdbMorePage=2,tvmazeMorePage=1;
async function discover(){
 const token=++catalogRequestVersion;state.loading=true;state.message="";render();
 let results=[],src="";
 try{
  if(state.tmdbKey){
   const [trends,movies,shows]=await Promise.all([tmdb("trending/all/week"),tmdb("movie/popular"),tmdb("tv/popular")]);
   results=unique([...(trends.results||[]),...(movies.results||[]).map(x=>({...x,media_type:"movie"})),...(shows.results||[]).map(x=>({...x,media_type:"tv"}))]
    .filter(x=>["movie","tv"].includes(x.media_type)).map(normalizeTMDB));
   tmdbMorePage=2;src="TMDB";
  }else{
   const [shows,movies]=await Promise.allSettled([api("https://api.tvmaze.com/shows?page=0"),api("https://itunes.apple.com/us/rss/topmovies/limit=25/json")]);
   const tv=shows.status==="fulfilled"&&Array.isArray(shows.value)?shows.value.filter(x=>x.image).map(normalizeTVMaze):[];
   const films=movies.status==="fulfilled"?(movies.value.feed?.entry||[]).map(normalizeChart):[];
   results=unique([...films,...tv]);if(!results.length)throw Error("No catalog available");
   tvmazeMorePage=1;src="TVmaze and Apple Movies";
  }
 }catch(e){state.message="Catalog unavailable right now. Check your connection or metadata key.";src="Your library";}
 if(token!==catalogRequestVersion)return;
 await LumaReleases.refresh().catch(()=>{});
 if(token!==catalogRequestVersion)return;
 const cached=store("catalog",[]);
 if(results.length)save("catalog",unique([...results,...cached]).slice(0,450));
 if(!results.length)results=cached;
 if(!results.length){results=fallback.map(([id,title,type,year])=>({id,title,type,year,overview:"Browse metadata and add your authorized media sources.",poster:"",backdrop:"",source:"offline",date:year+"-01-01"}));state.message=state.message||"Showing offline catalog picks; live release information is not available."}
 state.source=src;state.items=unique([...state.library.map(normalizeOwn),...LumaReleases.all(),...results]);
 catalogMoreLoading=false;catalogEnd=false;catalogMoreError="";state.loading=false;render();
}
async function loadMoreCatalog(){
 if(catalogMoreLoading||state.loading||catalogEnd||state.q||state.source==="Your library")return;
 const token=catalogRequestVersion;catalogMoreLoading=true;catalogMoreError="";render();
 try{
  let rows=[];
  if(state.tmdbKey){
   const page=tmdbMorePage,queries=[["movie/popular","movie"],["tv/popular","tv"],["trending/all/week",null]];
   const responses=await Promise.allSettled(queries.map(([endpoint])=>tmdb(endpoint,{page})));
   if(responses.every(r=>r.status!=="fulfilled"))throw Error("No provider available");
   responses.forEach((r,i)=>{if(r.status!=="fulfilled")return;const kind=queries[i][1];
    rows.push(...(r.value.results||[]).filter(x=>kind||["movie","tv"].includes(x.media_type))
      .map(x=>normalizeTMDB(kind?{...x,media_type:kind}:x)))});
   tmdbMorePage++;
   if(!rows.length||tmdbMorePage>12)catalogEnd=true;
  }else{
   const page=await api("https://api.tvmaze.com/shows?page="+tvmazeMorePage);
   if(!Array.isArray(page))throw Error("Unexpected TVMaze page");
   rows=page.filter(x=>x.image).map(normalizeTVMaze);
   tvmazeMorePage++;
   if(!page.length||tvmazeMorePage>12)catalogEnd=true;
  }
  if(token!==catalogRequestVersion)return;
  state.items=unique([...state.items,...rows]);
  save("catalog",unique([...state.items.filter(x=>x.source!=="personal"),...store("catalog",[])]).slice(0,600));
  if(!rows.length)catalogMoreError="No additional titles were returned.";
 }catch(e){if(token===catalogRequestVersion)catalogMoreError="Additional titles could not be loaded. Try again."}
 finally{if(token===catalogRequestVersion){catalogMoreLoading=false;render()}}
}
let searchTimer=0;
const browse={type:"all",genre:"all",sort:"featured",query:"",page:0};
const libraryView={section:"all",type:"all",sort:"saved",query:"",collection:"all",page:0};
let collectionSearchTimer=0;
function onSearch(value){if(value.trim()&&["Collection","Streaming"].includes(state.tab))state.tab="Catalogs";state.q=value.trim();++catalogRequestVersion;clearTimeout(searchTimer);if(!state.q){discover();return}searchTimer=setTimeout(doSearch,350);render()}
async function doSearch(){
 const token=++catalogRequestVersion,query=state.q;state.loading=true;render();
 try{
  let results=[];
  if(state.tmdbKey){const r=await tmdb("search/multi",{query,include_adult:"false"});results=(r.results||[]).filter(x=>["movie","tv"].includes(x.media_type)).map(normalizeTMDB)}
  else{
   const [shows,movies]=await Promise.allSettled([api("https://api.tvmaze.com/search/shows?q="+encodeURIComponent(query)),api("https://itunes.apple.com/search?country=us&entity=movie&limit=25&term="+encodeURIComponent(query))]);
   results=[...(shows.status==="fulfilled"?shows.value.map(normalizeTVMaze):[]),...(movies.status==="fulfilled"?(movies.value.results||[]).map(normalizeITunes):[])];
  }
  if(token!==catalogRequestVersion||query!==state.q)return;
  state.items=unique([...state.library.map(normalizeOwn),...results]);state.message=results.length?"":"No matching titles found.";
 }catch(e){if(token===catalogRequestVersion)state.message="Search failed. Try again or connect TMDB in Settings."}
 finally{if(token===catalogRequestVersion){state.loading=false;render()}}
}
function nav(){const pages=[["Home","⌂"],["Catalogs","▦"],["Streaming","◉"],["Movies","▣"],["TV Shows","▤"],["Anime","✧"],["Releases","◷"],["Calendar","▦"],["Add-ons","✦"],["Watchlist","♡"],["Continue Watching","▶"],["My Library","▰"],["Settings","⚙"]];$("#navigation").innerHTML=pages.map(([name,icon])=>'<button class="navbutton '+(name===state.tab||state.tab==="Collection"&&name==="Catalogs"?"active":"")+'" data-tab="'+name+'"><span>'+icon+'</span><span>'+(name==="Add-ons"?"Luma Add-ons":name)+'</span></button>').join("");$$("[data-tab]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.q="";$("#search").value="";state.filter="all";render();scrollTo({top:0,behavior:"smooth"})})}

function itemHTML(x){
 const currentProgress=progressForTitle(x),p=currentProgress.fraction,badge=LumaReleases.label(x),
  poster=safeArtworkUrl(x.poster)||safeArtworkUrl(x.backdrop),rating=Number(x.rating),
  tags=(x.genreNames||[]).slice(0,2).filter(Boolean);
 return '<button type="button" class="media lumaMediaCard" data-open="'+safe(x.id)+'" aria-label="Details for '+safe(x.title)+'">'
  +'<div class="art '+(!poster?"no-art":"has-art")+'" style="--c1:'+colorPick[x.title.length%colorPick.length]+'">'
  +'<div class="posterText">'+safe(x.title)+'</div>'
  +(poster?'<img loading="lazy" src="'+safe(poster)+'" alt="" onerror="this.remove()"/>':'')
  +'<span class="lumaCardOpen" aria-hidden="true">▶ Details</span>'
  +(state.watch.includes(x.id)?'<span class="pin" aria-label="Saved to watchlist">♥</span>':'')
  +(badge?'<span class="releaseFlag">'+safe(badge)+'</span>':'')+'</div>'
  +'<div class="iteminfo"><b>'+safe(x.title)+'</b>'
  +'<div class="cardFacts"><span>'+safe(x.year||"Year TBD")+'</span><span>'+safe(x.type)+'</span>'
  +(rating>0?'<span class="cardRating">★ '+rating.toFixed(1)+'</span>':'')+'</div>'
  +(tags.length?'<small class="cardGenres">'+safe(tags.join(" · "))+'</small>':'')
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
  +'<button class="secondary" data-watch="'+safe(x.id)+'">'+(state.watch.includes(x.id)?"♥ In watchlist":"♡ Add to watchlist")+'</button></div>'
  +'<div class="heroControls"><button type="button" data-hero-shift="-1" aria-label="Previous featured title">‹</button>'
  +'<button type="button" data-hero-shift="1" aria-label="Next featured title">›</button><span>Discover more</span></div></div></section>';
}
function homeDiscoveryRows(items){
 const all=unique((items||[]).filter(x=>x.title&&x.id)),shows=all.filter(x=>x.type==="Series"),
  anime=all.filter(x=>x.type==="Anime"||(x.genreNames||[]).includes("Animation")),
  movies=all.filter(x=>x.type==="Movie"),
  ratings=all.filter(x=>Number(x.rating)>=7).sort((a,b)=>Number(b.rating)-Number(a.rating)),
  recent=all.filter(x=>x.date&&Date.parse(x.date)&&Date.parse(x.date)<=Date.now())
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const genre=g=>all.filter(x=>(x.genreNames||[]).some(t=>t.toLowerCase().includes(g)));
 const saved=libraryGroups().saved;
 return shelf("Continue watching",libraryGroups().watching,"Pick up where you left off")
  +shelf("Your watchlist",saved,"Saved for another night","Watchlist")
  +shelf("TV series to explore",shows,"New seasons, familiar favorites and more","TV Shows")
  +shelf("Movies for tonight",movies,"Find your next movie","Movies")
  +shelf("Anime & animation",anime,"Animated stories from the catalog","Anime")
  +shelf("Top rated",ratings,"Well-rated titles from your available metadata","Catalogs")
  +shelf("Adventure & fantasy",genre("adventure").concat(genre("fantasy")),"Big worlds and epic stories","Catalogs")
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
 }).filter(([,record])=>(record?.fraction||0)>0&&record.fraction<.98);
 keys.sort((a,b)=>(b[1]?.updated||0)-(a[1]?.updated||0));
 if(!keys.length)return {fraction:0,label:""};
 const [key,record]=keys[0],ep=key.match(/:s(\d+)e(\d+)$/i)||key.match(/:(\d+):(\d+)$/);
 return {fraction:Math.max(0,Math.min(1,Number(record.fraction)||0)),label:ep?"S"+ep[1]+"E"+ep[2]:""};
}
function libraryGroups(){
 const device=LumaAccounts.deviceItems();
 const personal=state.library.map(normalizeOwn);
 const known=unique([...device,...personal,...state.items,...store("catalog",[])]);
 const byID=new Map(known.map(x=>[x.id,x]));
 const fromIDs=ids=>unique(ids.map(id=>byID.get(id)).filter(Boolean));
 const saved=fromIDs(state.watch);
 const watching=unique(Object.entries(state.progress||{})
   .filter(([,p])=>(p?.fraction||0)>.001&&(p?.fraction||0)<.98)
   .sort((a,b)=>(b[1]?.updated||0)-(a[1]?.updated||0))
   .map(([id])=>parentOfPlaybackKey(id,byID,known)).filter(Boolean));
 const watched=fromIDs(state.watched);
 return {all:unique([...watching,...saved,...watched,...personal]),saved,watching,watched,personal};
}
function suggestedTitles(items){
 const groups=libraryGroups(),liked=unique([...groups.saved,...groups.watched]);
 if(!liked.length)return [];
 const scores=new Map(),likedIDs=new Set([...groups.all.map(x=>x.id)]);
 liked.forEach(x=>(x.genreNames||[]).forEach(g=>scores.set(g,(scores.get(g)||0)+1)));
 return items.filter(x=>!likedIDs.has(x.id)&&!state.watched.includes(x.id)&&x.poster).map(x=>({
    title:x,score:(x.genreNames||[]).reduce((sum,g)=>sum+(scores.get(g)||0),0)
 })).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||(Number(b.title.rating)||0)-(Number(a.title.rating)||0))
   .slice(0,18).map(x=>x.title);
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
function catalogMarkup(items){
 const available=items.filter(x=>x.source!=="personal");
 const genres=[...new Set(available.flatMap(x=>Array.isArray(x.genreNames)?x.genreNames:[]).filter(Boolean))].sort();
 if(browse.genre!=="all"&&!genres.includes(browse.genre))browse.genre="all";
 const query=browse.query.trim().toLowerCase();
 let filtered=available.filter(x=>(browse.type==="all"||x.type===browse.type)
    &&(browse.genre==="all"||x.genreNames?.includes(browse.genre))
    &&(!query||[x.title,x.overview,x.year].some(v=>String(v||"").toLowerCase().includes(query))));
 filtered=sortedTitles(filtered,browse.sort);
 const result=tilesPage(filtered,browse.page);browse.page=result.page;
 return '<section class="collectionIntro"><div class="eyebrow">DISCOVER</div><h2>Explore movies, series and anime</h2><p>Browse real metadata from your available catalog sources. Filter loaded titles here, or use the search bar above to find more titles online.</p><span class="collectionCount">'+result.total+' matching titles</span></section>'
   +'<div class="collectionControls"><label>Find in this catalog<input id="catalogQuery" type="search" value="'+safe(browse.query)+'" placeholder="Title, year or description"></label>'
   +'<label>Type<select id="catalogType">'+selectOptions([["all","Movies, series & anime"],["Movie","Movies"],["Series","TV series"],["Anime","Anime"]],browse.type)+'</select></label>'
   +'<label>Genre<select id="catalogGenre">'+selectOptions([["all","All genres"],...genres.map(x=>[x,x])],browse.genre)+'</select></label>'
   +'<label>Sort<select id="catalogSort">'+selectOptions([["featured","Featured"],["title","Title A–Z"],["year","Newest year"],["rating","Top rated"]],browse.sort)+'</select></label></div>'
   +(result.total?'<div class="tiles collectionGrid">'+result.items.map(itemHTML).join("")+'</div>':'<div class="empty">Nothing matches those filters. Try another category or the main search bar.</div>')
   +collectionPager("catalog",result)
   +(!state.q&&state.source!=="Your library"&&!catalogEnd?'<div class="collectionLoad"><button class="primary" id="loadCatalogMore" '+(catalogMoreLoading?'disabled':'')+'>'+(catalogMoreLoading?'Loading more…':'Load more titles')+'</button></div>':'')
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
 const names={all:"All saved titles",saved:"On Device watchlist",watching:"Continue Watching",watched:"Watched",personal:"Personal media"};
 return '<section class="collectionIntro"><div class="eyebrow">YOUR LIBRARY · STORED ON THIS DEVICE</div><h2>Everything you saved, in one place</h2><p>Find your saved titles, continue watching, and manage personal media. Trakt and Simkl remain separate in Watchlist and will never overwrite your device data.</p>'
   +'<div class="libraryStats">'+[["saved","Watchlist"],["watching","In progress"],["watched","Watched"],["personal","Personal media"]].map(([id,label])=>'<button class="libraryStat" data-library-section="'+id+'"><strong>'+groups[id].length+'</strong><span>'+label+'</span></button>').join("")+'</div></section>'
   +'<div class="toolbar"><button class="primary" id="addMedia">+ Add your media</button><button class="secondary" id="importBackup">Import backup</button></div>'
   +'<div class="collectionControls"><label>Collection<select id="librarySection">'+selectOptions([["all","Everything"],["saved","On Device watchlist"],["watching","Continue Watching"],["watched","Watched"],["personal","Personal media"]],libraryView.section)+'</select></label>'
   +'<label>Find a saved title<input id="libraryQuery" type="search" value="'+safe(libraryView.query)+'" placeholder="Search your library"></label>'
   +'<label>Type<select id="libraryType">'+selectOptions([["all","All types"],["Movie","Movies"],["Series","TV series"],["Anime","Anime"]],libraryView.type)+'</select></label>'
   +'<label>Personal collection<select id="libraryCollection">'+selectOptions([["all","All collections"],...collections.map(x=>[x,x])],libraryView.collection)+'</select></label>'
   +'<label>Sort<select id="librarySort">'+selectOptions([["saved","Saved order"],["title","Title A–Z"],["year","Newest year"]],libraryView.sort)+'</select></label></div>'
   +'<div class="collectionHeading"><h2>'+names[libraryView.section]+'</h2><span>'+result.total+' titles</span></div>'
   +(result.total?'<div class="tiles collectionGrid">'+result.items.map(itemHTML).join("")+'</div>':'<div class="empty">No titles in this view. Save something to your On Device watchlist or try another filter.</div>')
   +collectionPager("library",result)
   +'<p class="micro">These are local records. Personal video links stay in your browser; selecting a cloud account under Watchlist does not import or delete anything here.</p>';
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
   },220);
 };
}
function bindCollections(){
 if(state.tab==="Catalogs"){
   bindCollectionInput("#catalogQuery",browse);
   for(const [selector,key] of [["#catalogType","type"],["#catalogGenre","genre"],["#catalogSort","sort"]]){
     if($(selector))$(selector).onchange=e=>{browse[key]=e.target.value;browse.page=0;render()};
   }
   if($("#catalogPrev"))$("#catalogPrev").onclick=()=>{browse.page--;render()};
   if($("#catalogNext"))$("#catalogNext").onclick=()=>{browse.page++;render()};
   if($("#loadCatalogMore"))$("#loadCatalogMore").onclick=loadMoreCatalog;
 }
 if(state.tab==="My Library"){
   bindCollectionInput("#libraryQuery",libraryView);
   for(const [selector,key] of [["#librarySection","section"],["#libraryType","type"],["#librarySort","sort"],["#libraryCollection","collection"]]){
     if($(selector))$(selector).onchange=e=>{libraryView[key]=e.target.value;libraryView.page=0;render()};
   }
   $$("[data-library-section]").forEach(b=>b.onclick=()=>{libraryView.section=b.dataset.librarySection;libraryView.page=0;render()});
   if($("#libraryPrev"))$("#libraryPrev").onclick=()=>{libraryView.page--;render()};
   if($("#libraryNext"))$("#libraryNext").onclick=()=>{libraryView.page++;render()};
 }
}

function render(){paint();nav();if(state.tab==="Add-ons"){ $("#heading").textContent="Luma Add-ons";LumaAddons.render();return;}$("#heading").textContent=state.q?"Search results":state.tab;const a=state.items;let content="";if(state.tab==="Settings"){settings();return}if(state.tab==="Calendar"){LumaCalendar.start();return}if(state.tab==="Releases"){content=LumaReleases.releasePage(a)}else if(state.tab==="Collection"){content=LumaCollections.renderCollection()}else if(state.tab==="Streaming"){content=LumaCollections.providerShowcase()}else if(state.tab==="My Library"){content=libraryMarkup();}else if(state.tab==="Watchlist"){content=LumaAccounts.watchlistMarkup();}else if(state.tab==="Catalogs"){content=catalogMarkup(a);}else if(state.tab==="Continue Watching"){content=shelf("Pick up where you left off",libraryGroups().watching);}else{const filtered=a.filter(x=>state.tab==="Home"||state.q||(state.tab==="Movies"?x.type==="Movie":state.tab==="TV Shows"?(x.type==="Series"||x.type==="Anime"):state.tab==="Anime"?(x.type==="Anime"||(x.genres||[]).includes("Anime")):true));if(state.tab==="Home"&&!state.q){content=hero([...LumaReleases.all().filter(x=>x.backdrop),...filtered])+LumaCalendar.homeMarkup()+LumaReleases.homepage(filtered)+LumaCollections.providerShowcase()+homeDiscoveryRows(filtered)}else content=shelf(state.q?"Matching titles":state.tab,filtered)}if(state.loading)content='<div class="loading"><div class="spinner"></div> Updating metadata… <button type="button" class="secondary small" id="skipLoading">Use cached titles</button></div>'+content;if(state.message)content='<div class="notice">'+safe(state.message)+'</div>'+content;$("#content").innerHTML=content;if($("#skipLoading"))$("#skipLoading").onclick=()=>{state.loading=false;state.message="Showing saved titles while providers respond.";render()};$$("[data-open]").forEach(b=>b.onclick=()=>openTitle(b.dataset.open));$$("[data-watch]").forEach(b=>b.onclick=()=>toggleWatch(b.dataset.watch));if($("#addMedia"))$("#addMedia").onclick=addMedia;if($("#importBackup"))$("#importBackup").onclick=importBackup;LumaReleases.bind();if(state.tab==="Home")LumaCalendar.bindHome();if(state.tab==="Watchlist")LumaAccounts.watchlistBind();if(state.tab==="Collection")LumaCollections.bind();bindCollections();$$("[data-collection-id]").forEach(b=>b.onclick=()=>LumaCollections.open(b.dataset.collectionId));$$("[data-hero-shift]").forEach(b=>b.onclick=()=>{featuredIndex+=Number(b.dataset.heroShift)||0;render()})}
document.addEventListener("click",e=>{const arrow=e.target.closest?.("[data-scroll]");if(!arrow)return;const shelf=arrow.closest(".shelf"),rail=shelf?.querySelector(".tiles");if(!rail)return;const direction=Number(arrow.dataset.scroll)||1;rail.scrollBy({left:direction*Math.max(rail.clientWidth*.82,230),behavior:"smooth"})});
function toggleWatch(id){state.watch=state.watch.includes(id)?state.watch.filter(v=>v!==id):[...state.watch,id];save("watch",state.watch);const title=state.items.find(x=>x.id===id)||LumaCollections.find(id);if(title){try{const cache=JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}");cache[id]={...title};localStorage.setItem("luma.device.titles.v1",JSON.stringify(cache))}catch{}if(title.type==="Series"||title.type==="Anime")LumaCalendar.registerFollow(title)}render()}
function modal(markup){$("#modal").innerHTML='<div class="shade" role="presentation"><div class="dialog" role="dialog" aria-modal="true"><button class="close" id="closeModal" aria-label="Close dialog">✕</button>'+markup+'</div></div>';$("#closeModal").onclick=closeModal;document.body.classList.add("modalOpen")}
function closeModal(){const v=$("#video");if(v){v.pause();v.removeAttribute("src");v.load()}$("#modal").innerHTML="";document.body.classList.remove("modalOpen");state.playerKey="";}
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
 if(detail._tvmazeEpisodes){
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
  seasonResults.set(key,list);state.details={...state.details,episodes:list};
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
   ||LumaAccounts.deviceItems().find(y=>y.id===id)||store("catalog",[]).find(y=>y.id===id)||LumaCollections.find(id);
 if(!x)return;
 const request=++detailRequestToken;
 state.selected=x;state.details=null;state.season=1;seasonBusy=x.type==="Series"||x.type==="Anime";seasonError="";
 showDetails();
 const isShow=x.type==="Series"||x.type==="Anime";
 const tmdbId=x.tmdbId||null;
 if(state.tmdbKey&&tmdbId){
  try{
   const kind=isShow?"tv":"movie";
   const result=await tmdb(kind+"/"+tmdbId,{append_to_response:"external_ids,credits,videos"});
   if(detailRequestToken!==request||state.selected?.id!==id)return;
   state.details=result;
   if(isShow){
    const seasons=(result.seasons||[]).filter(s=>s.season_number>0);
    state.season=seasons.length?Number(seasons[0].season_number):1;
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
   const list=(episodes.status==="fulfilled"&&Array.isArray(episodes.value)?episodes.value:[]).map(e=>episodeNormal(e));
   state.details={_tvmazeEpisodes:true,episodes:list,
    seasons:[...new Set(list.map(e=>e.season_number))].filter(n=>n>0).map(n=>({season_number:n,name:"Season "+n})),
    cast:cast.status==="fulfilled"?cast.value:[],crew:crew.status==="fulfilled"?crew.value:[]};
   state.season=state.details.seasons[0]?.season_number||1;
   seasonError=list.length?"":"No episodes have been published for this show.";
  }catch(e){seasonError="Episode details are unavailable. Try another show or check your connection.";}
  finally{if(detailRequestToken===request&&state.selected?.id===id){seasonBusy=false;showDetails(true)}}
 }else{seasonBusy=false;showDetails();}
}

function linkKey(x,episode){return x.id+(episode?":s"+episode.season_number+"e"+episode.episode_number:"")}

function showDetails(preserveScroll=false){
 const x=state.selected;if(!x)return;
 const dialog=preserveScroll?$("#modal .dialog"):null,oldScroll=dialog?.scrollTop||0;
 const isShow=x.type==="Series"||x.type==="Anime",meta=state.details||{};
 let html=art(x)+'<div class="detailBody lumaTitleDetail"><div class="eyebrow">'+safe(x.type)+' · '+safe(x.year||"")
   +(x.rating?' · ★ '+safe(x.rating):'')+'</div><h2>'+safe(x.title)+'</h2>'
   +'<div class="detailFacts">'+[x.network,x.tvStatus,(x.genreNames||[]).slice(0,3).join(" · ")].filter(Boolean)
       .map(v=>'<span>'+safe(v)+'</span>').join("")+'</div>'
   +'<p class="detailSynopsis">'+safe(x.overview||meta.overview||"Description unavailable.")+'</p>'
   +'<button type="button" class="readMore" id="readMore">Read full description</button>'
   +'<div class="actions"><button class="primary" id="findStreams">'+(x.source==="personal"?"▶ Play your media":isShow?"▶ Browse episode streams":"▶ Find movie streams")+'</button>'
   +'<button class="secondary" id="toggleWatch">'+(state.watch.includes(x.id)?"♥ Saved on device":"♡ Save on device")+'</button>'
   +'<button class="secondary" id="markWatched">'+(state.watched.includes(x.id)?"✓ Watched":"Mark watched")+'</button></div>';
 if(isShow){
  let seasons=Array.isArray(meta.seasons)?meta.seasons.filter(v=>Number.isInteger(Number(v.season_number))&&Number(v.season_number)>0):[];
  const episodes=Array.isArray(meta.episodes)?meta.episodes.map(e=>episodeNormal(e)):[],seen=new Set(seasons.map(v=>Number(v.season_number)));
  for(const ep of episodes){if(ep.season_number>0&&!seen.has(ep.season_number)){seasons.push({season_number:ep.season_number,name:"Season "+ep.season_number});seen.add(ep.season_number)}}
  if(!seasons.length)seasons=[{season_number:state.season||1,name:"Season "+(state.season||1)}];
  seasons.sort((a,b)=>Number(a.season_number)-Number(b.season_number));
  const count=episodes.filter(e=>e.season_number===state.season).length;
  html+='<section class="episodes episodeHub"><div class="episodeHubTop"><div><div class="eyebrow">EPISODE GUIDE</div><h3>Seasons & episodes</h3><p>Choose an individual episode to see its available playback sources.</p></div>'
   +'<label class="episodeSeasonLabel">Season<select id="seasonSelect" aria-label="Choose season">'
   +seasons.map(v=>'<option value="'+Number(v.season_number)+'"'+(Number(v.season_number)===state.season?" selected":"")+'>'+safe(v.name||"Season "+v.season_number)+'</option>').join("")
   +'</select></label></div>'
   +(seasonBusy?'<div class="episodeLoading" role="status"><span class="spinner"></span> Loading episode artwork and details…</div>'
   :count?'<div class="episodeHubCount">'+count+' episode'+(count===1?"":"s")+' in this season</div>'+episodeHTML(episodes,x)
   :'<div class="episodeEmpty"><strong>Episode guide unavailable</strong><p>'+safe(seasonError||"No episode details have been published for this season yet.")+'</p><button class="secondary" id="retrySeason">Retry episode guide</button></div>')
   +'</section>';
 }
 if(x.source==="personal")html+='<div class="actions"><button class="secondary" id="editPersonal">Edit media</button><button class="secondary" id="removePersonal">Remove media</button></div>';
 html+='<p class="micro detailDisclaimer">Metadata and streaming results depend on available providers and your authorized content access.</p>'
   +LumaPeople.markup(x)+'</div>';
 modal(html);
 if(preserveScroll&&$("#modal .dialog"))$("#modal .dialog").scrollTop=oldScroll;
 if($("#readMore"))$("#readMore").onclick=expandDetails;
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
 $("#markWatched").onclick=()=>{state.watched=state.watched.includes(x.id)?state.watched.filter(i=>i!==x.id):[...state.watched,x.id];save("watched",state.watched);showDetails(true)};
 if($("#seasonSelect"))$("#seasonSelect").onchange=e=>loadSeason(Number(e.target.value));
 if($("#retrySeason"))$("#retrySeason").onclick=()=>loadSeason(state.season);
 $$("[data-ep]").forEach(button=>button.onclick=()=>{
   let ep;try{ep=JSON.parse(decodeURIComponent(button.dataset.ep))}catch{return}
   if(!LumaAddons.installed()){chooseLink(x,ep);return}
   LumaAddons.lookupTitle(x,meta.external_ids?.imdb_id||meta.imdb_id||x.imdbId||"",ep);
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
    isWatched=state.watched.includes(key),progress=state.progress[key]?.fraction||0,
    future=!!e.air_date&&e.air_date>today,still=safeArtworkUrl(e.still||e.image?.medium||e.image?.original||"")
      ||safeArtworkUrl(x.backdrop)||safeArtworkUrl(x.poster);
  const item={season_number:sn,episode_number:n,name:e.name||"Episode "+n,air_date:e.air_date||"",runtime:e.runtime||0};
  const date=e.air_date?new Date(e.air_date+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"Air date TBD";
  return '<button type="button" class="episode episodeCinematic" data-ep="'+encodeURIComponent(JSON.stringify(item))+'" aria-label="Select season '+sn+' episode '+n+': '+safe(item.name)+'">'
   +'<div class="episodeStill">'+(still?'<img src="'+safe(still)+'" alt="" loading="lazy" onerror="this.remove()">':'<span class="episodeStillFallback">LUMA</span>')
   +'<span class="episodePlayGlyph">▶</span>'+(progress>0&&progress<.98?'<div class="episodeTrack"><span style="width:'+Math.round(progress*100)+'%"></span></div>':'')+'</div>'
   +'<div class="episodeInfo"><div class="episodeTitleRow"><strong>'+n+'. '+safe(item.name)+'</strong>'+(e.runtime?'<span>'+Number(e.runtime)+' min</span>':'')+'</div>'
   +'<p class="episodeSummary">'+safe(String(e.overview||"Episode synopsis not provided.").slice(0,220))+'</p>'
   +'<div class="episodeStatus"><span>S'+String(sn).padStart(2,"0")+'E'+String(n).padStart(2,"0")+'</span><span>'+safe(date)+'</span>'
   +(isWatched?'<span class="episodeSeen">✓ Watched</span>':future?'<span class="episodeUpcoming">Upcoming</span>':progress>0?'<span class="episodeSeen">Resume</span>':'')+'</div></div>'
   +'<span class="episodeSelectArrow" aria-hidden="true">›</span></button>';
 }).join("")+'</div>';
}

function chooseLink(x,ep){if(!LumaAddons.installed()){modal('<div class="pad emptyStreams"><div class="eyebrow">STREAM SOURCES</div><h2>No stream add-ons installed</h2><p>Install a compatible Luma add-on to discover available streams for this title.</p><div class="actions"><button id="goAddons" class="primary">Manage Add-ons</button><button id="backTitle" class="secondary">Back to Details</button></div></div>');$("#goAddons").onclick=()=>{closeModal();state.tab="Add-ons";render()};$("#backTitle").onclick=showDetails;return}LumaAddons.lookupTitle(x,state.details?.external_ids?.imdb_id||state.details?.imdb_id||x.imdbId||"",ep)}

function play(x,ep,url){let key=linkKey(x,ep);state.playerKey=key;modal('<div class="playerWrap"><h2>'+safe(x.title)+(ep?" · S"+ep.season_number+"E"+ep.episode_number:"")+'</h2><video id="video" controls playsinline preload="metadata"></video><div class="actions"><button class="secondary" id="backDetails">← Details</button><button class="secondary" id="changeLink">Find another stream</button><button class="secondary" id="watchedButton">✓ Mark watched</button></div><p class="micro" id="playerStatus">Loading your video… Playback progress is saved in this browser.</p></div>');const v=$("#video");v.src=url;v.onloadedmetadata=()=>{const p=state.progress[key];if(Number.isFinite(v.duration)&&p?.seconds>0&&p.seconds<v.duration-5)v.currentTime=p.seconds;$("#playerStatus").textContent="Ready to play";};v.ontimeupdate=()=>{if(!Number.isFinite(v.duration)||v.duration<=0)return;const now=Date.now();if(now-state.lastSave<3000)return;state.lastSave=now;state.progress[key]={seconds:v.currentTime,fraction:v.currentTime/v.duration,updated:now};save("progress",state.progress)};v.onpause=()=>{if(Number.isFinite(v.duration)&&v.duration>0){state.progress[key]={seconds:v.currentTime,fraction:v.currentTime/v.duration,updated:Date.now()};save("progress",state.progress)}};v.onended=()=>{state.progress[key]={seconds:0,fraction:1,updated:Date.now()};save("progress",state.progress);if(!state.watched.includes(key)){state.watched.push(key);save("watched",state.watched)}$("#playerStatus").textContent="Finished. Marked watched locally."};v.onerror=()=>$("#playerStatus").textContent="This source could not play. Check its format, access rights, network and codec support.";LumaAddons.attachPlayerButtons();$("#backDetails").onclick=()=>{v.pause();v.removeAttribute("src");v.load();showDetails()};$("#changeLink").onclick=()=>{v.pause();chooseLink(state.selected||x,ep)};$("#watchedButton").onclick=()=>{if(!state.watched.includes(key))state.watched.push(key);save("watched",state.watched);toast("Marked watched")}}
function removeMedia(x){
 if(!x?.id||x.source!=="personal")return;
 if(!confirm("Remove \""+x.title+"\" from this device? Its saved link and local playback history will be removed, but cloud lists will not change."))return;
 state.library=state.library.filter(item=>item.id!==x.id);save("library",state.library);
 state.watch=state.watch.filter(id=>id!==x.id);save("watch",state.watch);
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
  save("library",state.library);if(state.tab==="My Library")render();
 }catch{}
}
function addMedia(existing=null){
 const edit=existing&&existing.id&&existing.source==="personal"?existing:null;
 modal('<div class="pad"><div class="eyebrow">PERSONAL LIBRARY</div><h2>'+(edit?'Edit your media':'Add your media')+'</h2><p>Save your own direct HTTPS media URL. Optional artwork and collections stay on this device.</p><form id="addForm">'
  +'<label>Title<input name="title" maxlength="110" required value="'+safe(edit?.title||"")+'" placeholder="Movie or series title"></label>'
  +'<label>Category<select name="type">'+["Movie","Series","Anime"].map(t=>'<option'+((edit?.type||"Movie")===t?' selected':'')+'>'+t+'</option>').join("")+'</select></label>'
  +'<label>Release year<input type="number" name="year" min="1900" max="2100" value="'+safe(edit?.year||new Date().getFullYear())+'"></label>'
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
    title,type:String(data.get("type")||"Movie"),year:String(data.get("year")||""),url,poster:poster||edit?.poster||"",collection:String(data.get("collection")||"").trim(),
    overview:edit?.overview||"From your personal media library.",source:"personal"};
  state.library=edit?state.library.map(item=>item.id===x.id?x:item):[x,...state.library];
  save("library",state.library);closeModal();discover();toast(edit?"Media updated.":"Media added.");
  if(!x.poster)enrichPersonalArtwork(x.id);
 };
}
function settings(){let html='<div class="settingsGrid"><section class="settingCard"><h2>Appearance</h2><label>Accent color<input id="accent" type="color" value="'+safe(state.accent)+'"></label><label>Theme<select id="theme"><option value="dark">Midnight</option><option value="light">Soft light</option></select></label><label>Card spacing<select id="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label></section><section class="settingCard"><h2>Real metadata</h2><p>Luma can display real TV titles with TVmaze without a key. Add your own TMDB read-only API key or v4 read access token to unlock richer movie, TV and trending artwork.</p><label>TMDB API credential<input id="tmdbKey" type="password" autocomplete="off" placeholder="Optional read-only key / token" value="'+safe(state.tmdbKey)+'"></label><div class="actions"><button class="primary" id="saveTMDB">Save metadata settings</button><button class="secondary" id="clearTMDB">Disconnect</button></div><p class="micro">Saved locally on this device. Never paste private server-side client secrets. Browser API requests may be visible in network tools. <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Get a TMDB key</a>.</p></section><section class="settingCard"><h2>Data and privacy</h2><p>Watchlists, playback bookmarks, playback links and settings are stored in this browser. They do not yet sync through iCloud, Trakt or Simkl.</p><div class="actions"><button class="primary" id="exportData">Download backup</button><button class="secondary" id="shareBackup">Save to Files / iCloud Drive</button><button class="secondary" id="importData">Import backup</button></div><p class="micro">Export does not include the metadata API token. Keep your backups private: they may contain media URLs.</p></section><section class="settingCard"><h2>About Luma</h2><p>Made for personal media exploration and legally accessible content. Real metadata is not a streaming subscription.</p><p class="micro">TV information by TVmaze. Optional movie and television data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. The browser version of Luma does not run natively on Apple TV.</p><button class="secondary" id="refreshCatalog">Refresh catalog</button></section></div>';$("#content").innerHTML=html+LumaAccounts.settingsMarkup();LumaAccounts.bindSettings();$("#theme").value=state.theme;$("#density").value=state.density;$("#accent").oninput=e=>{state.accent=e.target.value;save("accent",state.accent);paint()};$("#theme").onchange=e=>{state.theme=e.target.value;save("theme",state.theme);paint()};$("#density").onchange=e=>{state.density=e.target.value;save("density",state.density);paint()};$("#saveTMDB").onclick=()=>{state.tmdbKey=$("#tmdbKey").value.trim();save("tmdbKey",state.tmdbKey);toast("Metadata settings saved");discover()};$("#clearTMDB").onclick=()=>{state.tmdbKey="";save("tmdbKey","");$("#tmdbKey").value="";discover()};$("#exportData").onclick=exportData;$("#shareBackup").onclick=shareBackup;$("#importData").onclick=importBackup;$("#refreshCatalog").onclick=discover}
function exportData(){const data={version:3,profile:state.profile,watch:state.watch,watchDetails:(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")}catch{return{}}})(),watched:state.watched,progress:state.progress,links:state.links,library:state.library,accent:state.accent,theme:state.theme,density:state.density},blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download="luma-backup-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
async function shareBackup(){let data={version:3,profile:state.profile,watch:state.watch,watchDetails:(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")}catch{return{}}})(),watched:state.watched,progress:state.progress,links:state.links,library:state.library,accent:state.accent,theme:state.theme,density:state.density};let file=new File([JSON.stringify(data,null,2)],"luma-device-backup.json",{type:"application/json"});try{if(typeof navigator.share!=="function"||navigator.canShare&&!navigator.canShare({files:[file]})){toast("Sharing files is not available here. Downloading a backup instead.");exportData();return}await navigator.share({files:[file],title:"Luma device backup"});toast("Choose Save to Files, then iCloud Drive if available.")}catch(e){if(e?.name!=="AbortError"){toast("Could not open file sharing. Downloading backup instead.");exportData()}}}
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
 return {watch,watched,library,progress,links,watchDetails,
  accent:/^#[0-9a-f]{6}$/i.test(input.accent||"")?input.accent:null,
  theme:["light","dark"].includes(input.theme)?input.theme:null,
  density:["compact","comfortable"].includes(input.density)?input.density:null};
}
function applyBackup(backup,replace=false){
 if(backup.watch!==undefined){state.watch=replace?backup.watch:[...new Set([...state.watch,...backup.watch])];save("watch",state.watch)}
 if(backup.watched!==undefined){state.watched=replace?backup.watched:[...new Set([...state.watched,...backup.watched])];save("watched",state.watched)}
 if(backup.library!==undefined){state.library=replace?backup.library:unique([...state.library,...backup.library]);save("library",state.library)}
 if(replace){state.progress=backup.progress;state.links=backup.links}else{
   state.progress={...backup.progress,...state.progress};state.links={...backup.links,...state.links};
 }
 save("progress",state.progress);save("links",state.links);
 try{
  const current=JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}");
  const merged=replace?backup.watchDetails:{...backup.watchDetails,...current};
  localStorage.setItem("luma.device.titles.v1",JSON.stringify(merged));
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
   const existing={watch:state.watch.length,watched:state.watched.length,library:state.library.length,progress:Object.keys(state.progress).length};
   const incoming={watch:backup.watch?.length||0,watched:backup.watched?.length||0,library:backup.library?.length||0,progress:Object.keys(backup.progress).length};
   modal('<div class="pad"><div class="eyebrow">RESTORE PREVIEW</div><h2>Review your Luma backup</h2><p>No saved data has been changed yet. Merge keeps existing records when titles or playback bookmarks overlap. Replace swaps the on-device records in this backup, but never changes Trakt or Simkl accounts.</p>'
    +'<div class="backupPreview"><table><thead><tr><th>Category</th><th>On this device</th><th>In backup</th></tr></thead><tbody>'
    +[["watch","Saved titles"],["watched","Watched markers"],["library","Personal media"],["progress","Playback bookmarks"]].map(([k,label])=>'<tr><td>'+label+'</td><td>'+existing[k]+'</td><td>'+incoming[k]+'</td></tr>').join("")
    +'</tbody></table></div><div class="actions"><button class="primary" id="mergeBackup">Merge safely</button><button class="secondary" id="replaceBackup">Replace local data</button><button class="secondary" id="cancelBackup">Cancel</button></div>'
    +'<p class="micro">Download a fresh backup first if you might need to undo a replacement. Credentials and add-ons are never imported from this file.</p><button class="secondary" id="backupBeforeReplace">Download current backup</button></div>');
   $("#mergeBackup").onclick=()=>{applyBackup(backup,false);closeModal();discover();toast("Backup merged. Existing local data was preserved.")};
   $("#replaceBackup").onclick=()=>{if(!confirm("Replace your on-device Luma library and playback records with this backup? Download your current backup first if needed."))return;applyBackup(backup,true);closeModal();discover();toast("Local backup restored.")};
   $("#cancelBackup").onclick=closeModal;$("#backupBeforeReplace").onclick=exportData;
  }catch(e){toast("Could not read backup: "+String(e?.message||"Invalid file").slice(0,130))}
 };
 input.click();
}
$("#search").addEventListener("input",e=>onSearch(e.target.value));document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#modal").innerHTML)closeModal()});window.addEventListener("unhandledrejection",e=>{const msg=e.reason?.message||String(e.reason||"Unknown error");if(/(?:runtime\.sendMessage\(\)|chrome\.runtime|browser\.runtime)/i.test(msg)&&/(?:tab not found|invalid call|extension context|receiving end)/i.test(msg)){e.preventDefault();console.info("Browser-extension messaging issue ignored; Luma did not initiate this request.");return}console.error("Luma background task failed:",e.reason);e.preventDefault();const sanitized=msg.replace(/https?:\/\/\S+/g,"[service URL]").slice(0,160);toast("An action failed: "+sanitized+". You can try again without losing your library.")});window.addEventListener("error",e=>{console.error("Luma script error:",e.error||e.message);const box=document.querySelector("#content");if(box&&(!box.children.length||/Loading your media universe/.test(box.textContent||""))){box.innerHTML='<div class="notice"><strong>Luma could not finish loading.</strong><p>Reload the app to retry. Your local watchlist and add-ons are kept on this device.</p><button class="primary" id="restartLuma">Retry loading</button></div>';document.querySelector("#restartLuma").onclick=()=>location.reload()}});window.LumaRender=render;paint();discover();LumaCalendar.prime().catch(()=>{});/* Offline service worker disabled to prevent stale GitHub Pages builds; keep user library in localStorage. */
