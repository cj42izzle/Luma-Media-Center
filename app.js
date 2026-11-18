
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
const libraryView={section:"all",type:"all",sort:"saved",query:"",page:0};
let collectionSearchTimer=0;
function onSearch(value){state.q=value.trim();++catalogRequestVersion;clearTimeout(searchTimer);if(!state.q){discover();return}searchTimer=setTimeout(doSearch,350);render()}
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
function nav(){const pages=[["Home","⌂"],["Catalogs","▦"],["Movies","▣"],["TV Shows","▤"],["Anime","✧"],["Releases","◷"],["Calendar","▦"],["Add-ons","✦"],["Watchlist","♡"],["Continue Watching","▶"],["My Library","▰"],["Settings","⚙"]];$("#navigation").innerHTML=pages.map(([name,icon])=>'<button class="navbutton '+(name===state.tab?"active":"")+'" data-tab="'+name+'"><span>'+icon+'</span><span>'+name+'</span></button>').join("");$$("[data-tab]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.q="";$("#search").value="";state.filter="all";render();scrollTo({top:0,behavior:"smooth"})})}
function itemHTML(x){const p=state.progress[x.id]?.fraction||0;const badge=LumaReleases.label(x);return '<button class="media" data-open="'+safe(x.id)+'"><div class="art '+(!x.poster?"no-art":"")+'" style="--c1:'+colorPick[(x.title.length)%colorPick.length]+'"><div class="posterText">'+safe(x.title)+'</div>'+(x.poster?'<img loading="lazy" src="'+safe(x.poster)+'" alt="" onerror="this.remove()"/>':'')+(state.watch.includes(x.id)?'<span class="pin">♥</span>':'')+(badge?'<span class="releaseFlag">'+safe(badge)+'</span>':'')+'</div><div class="iteminfo"><b>'+safe(x.title)+'</b><small>'+safe(x.year||"")+' · '+safe(x.type)+(x.rating?" · ★ "+safe(x.rating):"")+'</small>'+(x.genreNames?.length?'<small class="cardGenres">'+safe(x.genreNames.slice(0,2).join(" · "))+'</small>':'')+(p>0&&p<.98?'<div class="track"><div style="width:'+Math.floor(p*100)+'%"></div></div>':'')+'</div></button>'}
function shelf(title,items){return'<section class="shelf"><div class="shelfhead"><h2>'+safe(title)+'</h2><div class="railActions"><button class="railArrow" data-scroll="-1" aria-label="Scroll '+safe(title)+' left">‹</button><button class="railArrow" data-scroll="1" aria-label="Scroll '+safe(title)+' right">›</button></div></div>'+(items.length?'<div class="tiles" tabindex="0" aria-label="'+safe(title)+' horizontal titles">'+items.map(itemHTML).join("")+'</div>':'<div class="empty">No titles here yet.</div>')+'</section>'}
function hero(items){let x=items.find(y=>y.backdrop)||items.find(y=>y.poster);if(!x)return '<section class="hero fallbackHero"><div class="heroInfo"><div class="eyebrow">✦ LUMA MEDIA CENTER</div><h2>Your universe of movies & shows</h2><p>Discover real titles, follow releases, browse your Stremio add-ons and launch compatible streams in your favorite player.</p><div class="actions"><button class="primary" data-go="Add-ons">Manage add-ons</button><button class="secondary" data-go="Releases">Explore releases</button></div></div></section>';return'<section class="hero" style="--hero:'+ (x.backdrop||x.poster?'url("'+safe(x.backdrop||x.poster)+'")':'none')+'"><div class="heroInfo"><div class="eyebrow">✦ NOW DISCOVERING</div><h2>'+safe(x.title)+'</h2><div class="heroMeta">'+safe(x.year||"")+' · '+safe(x.type)+(x.rating?" · ★ "+safe(x.rating):"")+'</div><p>'+safe((x.overview||"Explore the world of cinema.").slice(0,235))+'</p><div class="actions"><button class="primary" data-open="'+safe(x.id)+'">Explore title</button><button class="secondary" data-watch="'+safe(x.id)+'">'+(state.watch.includes(x.id)?"♥ Added":"♡ Watchlist")+'</button></div></div></section>'}

function libraryGroups(){
 const device=LumaAccounts.deviceItems();
 const personal=state.library.map(normalizeOwn);
 const known=unique([...device,...personal,...state.items,...store("catalog",[])]);
 const byID=new Map(known.map(x=>[x.id,x]));
 const fromIDs=ids=>unique(ids.map(id=>byID.get(id)).filter(Boolean));
 const saved=fromIDs(state.watch);
 const watching=unique(Object.entries(state.progress)
   .filter(([,p])=>(p?.fraction||0)>.001&&(p?.fraction||0)<.98)
   .sort((a,b)=>(b[1]?.updated||0)-(a[1]?.updated||0))
   .map(([id])=>byID.get(id)).filter(Boolean));
 const watched=fromIDs(state.watched);
 return {all:unique([...watching,...saved,...watched,...personal]),saved,watching,watched,personal};
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
 const filtered=sortedTitles(titles.filter(x=>(libraryView.type==="all"||x.type===libraryView.type)
   &&(!query||[x.title,x.year].some(v=>String(v||"").toLowerCase().includes(query)))),libraryView.sort);
 const result=tilesPage(filtered,libraryView.page);libraryView.page=result.page;
 const names={all:"All saved titles",saved:"On Device watchlist",watching:"Continue Watching",watched:"Watched",personal:"Personal media"};
 return '<section class="collectionIntro"><div class="eyebrow">YOUR LIBRARY · STORED ON THIS DEVICE</div><h2>Everything you saved, in one place</h2><p>Find your saved titles, continue watching, and manage personal media. Trakt and Simkl remain separate in Watchlist and will never overwrite your device data.</p>'
   +'<div class="libraryStats">'+[["saved","Watchlist"],["watching","In progress"],["watched","Watched"],["personal","Personal media"]].map(([id,label])=>'<button class="libraryStat" data-library-section="'+id+'"><strong>'+groups[id].length+'</strong><span>'+label+'</span></button>').join("")+'</div></section>'
   +'<div class="toolbar"><button class="primary" id="addMedia">+ Add your media</button><button class="secondary" id="importBackup">Import backup</button></div>'
   +'<div class="collectionControls"><label>Collection<select id="librarySection">'+selectOptions([["all","Everything"],["saved","On Device watchlist"],["watching","Continue Watching"],["watched","Watched"],["personal","Personal media"]],libraryView.section)+'</select></label>'
   +'<label>Find a saved title<input id="libraryQuery" type="search" value="'+safe(libraryView.query)+'" placeholder="Search your library"></label>'
   +'<label>Type<select id="libraryType">'+selectOptions([["all","All types"],["Movie","Movies"],["Series","TV series"],["Anime","Anime"]],libraryView.type)+'</select></label>'
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
   for(const [selector,key] of [["#librarySection","section"],["#libraryType","type"],["#librarySort","sort"]]){
     if($(selector))$(selector).onchange=e=>{libraryView[key]=e.target.value;libraryView.page=0;render()};
   }
   $$("[data-library-section]").forEach(b=>b.onclick=()=>{libraryView.section=b.dataset.librarySection;libraryView.page=0;render()});
   if($("#libraryPrev"))$("#libraryPrev").onclick=()=>{libraryView.page--;render()};
   if($("#libraryNext"))$("#libraryNext").onclick=()=>{libraryView.page++;render()};
 }
}

function render(){paint();nav();if(state.tab==="Add-ons"){ $("#heading").textContent="Stremio Add-ons";LumaAddons.render();return;}$("#heading").textContent=state.q?"Search results":state.tab;const a=state.items;let content="";if(state.tab==="Settings"){settings();return}if(state.tab==="Calendar"){LumaCalendar.start();return}if(state.tab==="Releases"){content=LumaReleases.releasePage(a)}else if(state.tab==="My Library"){content=libraryMarkup();}else if(state.tab==="Watchlist"){content=LumaAccounts.watchlistMarkup();}else if(state.tab==="Catalogs"){content=catalogMarkup(a);}else if(state.tab==="Continue Watching"){const ids=Object.keys(state.progress).filter(k=>(state.progress[k]?.fraction||0)>.001&&(state.progress[k]?.fraction||0)<.98);content=shelf("Pick up where you left off",libraryGroups().watching);}else{const filtered=a.filter(x=>state.tab==="Home"||state.q||(state.tab==="Movies"?x.type==="Movie":state.tab==="TV Shows"?(x.type==="Series"||x.type==="Anime"):state.tab==="Anime"?(x.type==="Anime"||(x.genres||[]).includes("Anime")):true));if(state.tab==="Home"&&!state.q){content=hero([...LumaReleases.all().filter(x=>x.backdrop&&x.type==="Series"),...filtered])+LumaCalendar.homeMarkup()+LumaReleases.homepage(filtered)+shelf("Continue watching",filtered.filter(x=>(state.progress[x.id]?.fraction||0)>0&&(state.progress[x.id]?.fraction||0)<.98))}else content=shelf(state.q?"Matching titles":state.tab,filtered)}if(state.loading)content='<div class="loading"><div class="spinner"></div> Updating metadata… <button type="button" class="secondary small" id="skipLoading">Use cached titles</button></div>'+content;if(state.message)content='<div class="notice">'+safe(state.message)+'</div>'+content;$("#content").innerHTML=content;if($("#skipLoading"))$("#skipLoading").onclick=()=>{state.loading=false;state.message="Showing saved titles while providers respond.";render()};$$("[data-open]").forEach(b=>b.onclick=()=>openTitle(b.dataset.open));$$("[data-watch]").forEach(b=>b.onclick=()=>toggleWatch(b.dataset.watch));if($("#addMedia"))$("#addMedia").onclick=addMedia;if($("#importBackup"))$("#importBackup").onclick=importBackup;LumaReleases.bind();if(state.tab==="Home")LumaCalendar.bindHome();if(state.tab==="Watchlist")LumaAccounts.watchlistBind();bindCollections()}
document.addEventListener("click",e=>{const arrow=e.target.closest?.("[data-scroll]");if(!arrow)return;const shelf=arrow.closest(".shelf"),rail=shelf?.querySelector(".tiles");if(!rail)return;const direction=Number(arrow.dataset.scroll)||1;rail.scrollBy({left:direction*Math.max(rail.clientWidth*.82,230),behavior:"smooth"})});
function toggleWatch(id){state.watch=state.watch.includes(id)?state.watch.filter(v=>v!==id):[...state.watch,id];save("watch",state.watch);const title=state.items.find(x=>x.id===id);if(title){try{const cache=JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}");cache[id]={...title};localStorage.setItem("luma.device.titles.v1",JSON.stringify(cache))}catch{}if(title.type==="Series"||title.type==="Anime")LumaCalendar.registerFollow(title)}render()}
function modal(markup){$("#modal").innerHTML='<div class="shade" role="presentation"><div class="dialog" role="dialog" aria-modal="true"><button class="close" id="closeModal" aria-label="Close dialog">✕</button>'+markup+'</div></div>';$("#closeModal").onclick=closeModal;document.body.classList.add("modalOpen")}
function closeModal(){const v=$("#video");if(v){v.pause();v.removeAttribute("src");v.load()}$("#modal").innerHTML="";document.body.classList.remove("modalOpen");state.playerKey="";}
function art(x){return'<div class="detailArt" style="'+(x.backdrop||x.poster?'background-image:linear-gradient(0deg,#1a1b27 0%,#1a1b2744 100%),url(&quot;'+safe(x.backdrop||x.poster)+'&quot;)':'background:linear-gradient(125deg,#6b4281,#192b52)')+'"></div>'}
async function openTitle(id){let x=state.items.find(y=>y.id===id)||state.library.find(y=>y.id===id)||LumaAccounts.deviceItems().find(y=>y.id===id)||store("catalog",[]).find(y=>y.id===id);if(!x)return;state.selected=x;state.details=null;state.season=1;showDetails();if(x.source==="tmdb"){try{let kind=x.mediaType==="tv"?"tv":"movie";state.details=await tmdb(kind+"/"+x.tmdbId,{append_to_response:"external_ids,credits,videos"});if(state.selected?.id===id)showDetails()}catch(e){toast("Detailed metadata is temporarily unavailable.")}}else if(x.source==="tvmaze"){try{const [episodes,cast,crew]=await Promise.allSettled([api("https://api.tvmaze.com/shows/"+x.mazeId+"/episodes"),api("https://api.tvmaze.com/shows/"+x.mazeId+"/cast"),api("https://api.tvmaze.com/shows/"+x.mazeId+"/crew")]);state.details={episodes:episodes.status==="fulfilled"?episodes.value:[],cast:cast.status==="fulfilled"?cast.value:[],crew:crew.status==="fulfilled"?crew.value:[]};if(state.selected?.id===id)showDetails()}catch(e){} }}
function linkKey(x,episode){return x.id+(episode?":s"+episode.season_number+"e"+episode.episode_number:"")}
function showDetails(){let x=state.selected;if(!x)return;let html=art(x)+'<div class="detailBody"><div class="eyebrow">'+safe(x.type)+' · '+safe(x.year||"")+(x.rating?" · ★ "+safe(x.rating):"")+'</div><h2>'+safe(x.title)+'</h2><p class="detailSynopsis">'+safe(x.overview||"Description unavailable.")+'</p><button type="button" class="readMore" id="readMore">Read full description</button><div class="actions"><button class="primary" id="findStreams">▶ Find Streams</button><button class="secondary" id="toggleWatch">'+(state.watch.includes(x.id)?"♥ Saved on device":"♡ Save on device")+'</button><button class="secondary" id="markWatched">'+(state.watched.includes(x.id)?"✓ Watched":"Mark watched")+'</button>'+'</div><p class="micro detailDisclaimer">Stream results come from your installed add-ons; availability and playback depend on the source.</p>'+LumaPeople.markup(x);
if(x.type==="Series"||x.type==="Anime"){let seasons=state.details?.seasons?.filter(s=>s.season_number>0)||[];let eps=x.source==="tvmaze"?(state.details?.episodes||[]).map(e=>({id:e.id,episode_number:e.number,season_number:e.season,name:e.name,overview:e.summary?.replace(/<[^>]*>/g,""),still_path:e.image?.medium||""})):state.details?.episodes||[];html+='<section class="episodes"><h3>Episodes</h3>'+(seasons.length?'<select id="seasonSelect" aria-label="Choose season">'+seasons.map(s=>'<option value="'+s.season_number+'" '+(state.season===s.season_number?"selected":"")+'>'+safe(s.name)+'</option>').join("")+'</select>':'')+(eps.length?episodeHTML(eps,x):'<div class="micro">Select a season to load episode details. If your title has no season data, you can still add your media link.</div>')+'</section>';}
html+='</div>';modal(html);if($("#readMore"))$("#readMore").onclick=expandDetails;$("#findStreams").onclick=()=>chooseLink(x,null);$("#toggleWatch").onclick=()=>{toggleWatch(x.id);showDetails()};$("#markWatched").onclick=()=>{state.watched=state.watched.includes(x.id)?state.watched.filter(i=>i!==x.id):[...state.watched,x.id];save("watched",state.watched);showDetails()};if($("#seasonSelect"))$("#seasonSelect").onchange=async e=>{state.season=Number(e.target.value);if(x.source==="tmdb"){let d=await tmdb("tv/"+x.tmdbId+"/season/"+state.season).catch(()=>({episodes:[]}));if(state.selected?.id===x.id){state.details={...state.details,episodes:d.episodes};showDetails()}}else showDetails()};$$("[data-ep]").forEach(b=>b.onclick=()=>{const ep=JSON.parse(decodeURIComponent(b.dataset.ep));if(LumaAddons.installed())LumaAddons.lookupTitle(x,state.details?.external_ids?.imdb_id||state.details?.imdb_id||x.imdbId||"",ep);else $("#findStreams")?.click()});LumaPeople.bind(x);LumaReleases.enrichDetail(x)}
function expandDetails(){const body=document.querySelector(".detailBody");if(body){body.classList.toggle("expanded");const toggle=body.querySelector("#readMore");if(toggle)toggle.textContent=body.classList.contains("expanded")?"Show less":"Read full description"}}
function episodeHTML(eps,x){let filtered=eps.filter(e=>e.season_number===state.season);if(!filtered.length)return'<p class="micro">No episode information for this season yet.</p>';return'<div class="episodeList">'+filtered.map(e=>{let k=linkKey(x,e);return'<button class="episode" data-ep="'+encodeURIComponent(JSON.stringify({season_number:e.season_number,episode_number:e.episode_number,name:e.name}))+'"><div class="episodeNum">'+e.episode_number+'</div><div><b>'+safe(e.name||"Episode "+e.episode_number)+'</b><span>S'+e.season_number+' · E'+e.episode_number+(state.watched.includes(k)?" · ✓ Watched":"")+'</span><small>'+safe((e.overview||"").slice(0,125))+'</small></div><div class="episodeArrow">▶</div></button>'}).join("")+'</div>'}
function chooseLink(x,ep){if(!LumaAddons.installed()){modal('<div class="pad emptyStreams"><div class="eyebrow">STREAM SOURCES</div><h2>No stream add-ons installed</h2><p>Install a compatible Stremio add-on to discover available streams for this title.</p><div class="actions"><button id="goAddons" class="primary">Manage Add-ons</button><button id="backTitle" class="secondary">Back to Details</button></div></div>');$("#goAddons").onclick=()=>{closeModal();state.tab="Add-ons";render()};$("#backTitle").onclick=showDetails;return}LumaAddons.lookupTitle(x,state.details?.external_ids?.imdb_id||state.details?.imdb_id||x.imdbId||"",ep)}

function play(x,ep,url){let key=linkKey(x,ep);state.playerKey=key;modal('<div class="playerWrap"><h2>'+safe(x.title)+(ep?" · S"+ep.season_number+"E"+ep.episode_number:"")+'</h2><video id="video" controls playsinline preload="metadata"></video><div class="actions"><button class="secondary" id="backDetails">← Details</button><button class="secondary" id="changeLink">Find another stream</button><button class="secondary" id="watchedButton">✓ Mark watched</button></div><p class="micro" id="playerStatus">Loading your video… Playback progress is saved in this browser.</p></div>');const v=$("#video");v.src=url;v.onloadedmetadata=()=>{const p=state.progress[key];if(Number.isFinite(v.duration)&&p?.seconds>0&&p.seconds<v.duration-5)v.currentTime=p.seconds;$("#playerStatus").textContent="Ready to play";};v.ontimeupdate=()=>{if(!Number.isFinite(v.duration)||v.duration<=0)return;const now=Date.now();if(now-state.lastSave<3000)return;state.lastSave=now;state.progress[key]={seconds:v.currentTime,fraction:v.currentTime/v.duration,updated:now};save("progress",state.progress)};v.onpause=()=>{if(Number.isFinite(v.duration)&&v.duration>0){state.progress[key]={seconds:v.currentTime,fraction:v.currentTime/v.duration,updated:Date.now()};save("progress",state.progress)}};v.onended=()=>{state.progress[key]={seconds:0,fraction:1,updated:Date.now()};save("progress",state.progress);if(!state.watched.includes(key)){state.watched.push(key);save("watched",state.watched)}$("#playerStatus").textContent="Finished. Marked watched locally."};v.onerror=()=>$("#playerStatus").textContent="This source could not play. Check its format, access rights, network and codec support.";LumaAddons.attachPlayerButtons();$("#backDetails").onclick=()=>{v.pause();v.removeAttribute("src");v.load();showDetails()};$("#changeLink").onclick=()=>{v.pause();chooseLink(state.selected||x,ep)};$("#watchedButton").onclick=()=>{if(!state.watched.includes(key))state.watched.push(key);save("watched",state.watched);toast("Marked watched")}}
function addMedia(){modal('<div class="pad"><div class="eyebrow">PERSONAL LIBRARY</div><h2>Add your media</h2><p>Add a title and an authorized direct video URL. These are saved only to this browser.</p><form id="addForm"><label>Title<input name="title" maxlength="110" required placeholder="Movie or episode title"></label><label>Category<select name="type"><option>Movie</option><option>Series</option><option>Anime</option></select></label><label>Release year<input type="number" name="year" min="1900" max="2100" value="2026"></label><label>HTTPS video URL<input type="url" name="url" placeholder="https://example.com/movie.mp4" required></label><div class="actions"><button class="primary" type="submit">Add media</button></div></form></div>');$("#addForm").onsubmit=e=>{e.preventDefault();const d=new FormData(e.target),url=d.get("url").trim();try{if(new URL(url).protocol!=="https:")throw Error()}catch{return toast("Use a valid HTTPS URL")};let x={id:"local:"+Date.now(),title:String(d.get("title")).trim(),type:String(d.get("type")),year:String(d.get("year")),url,overview:"From your personal media library."};state.library.unshift(x);save("library",state.library);closeModal();discover();toast("Media added")}}
function settings(){let html='<div class="settingsGrid"><section class="settingCard"><h2>Appearance</h2><label>Accent color<input id="accent" type="color" value="'+safe(state.accent)+'"></label><label>Theme<select id="theme"><option value="dark">Midnight</option><option value="light">Soft light</option></select></label><label>Card spacing<select id="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label></section><section class="settingCard"><h2>Real metadata</h2><p>Luma can display real TV titles with TVmaze without a key. Add your own TMDB read-only API key or v4 read access token to unlock richer movie, TV and trending artwork.</p><label>TMDB API credential<input id="tmdbKey" type="password" autocomplete="off" placeholder="Optional read-only key / token" value="'+safe(state.tmdbKey)+'"></label><div class="actions"><button class="primary" id="saveTMDB">Save metadata settings</button><button class="secondary" id="clearTMDB">Disconnect</button></div><p class="micro">Saved locally on this device. Never paste private server-side client secrets. Browser API requests may be visible in network tools. <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Get a TMDB key</a>.</p></section><section class="settingCard"><h2>Data and privacy</h2><p>Watchlists, playback bookmarks, playback links and settings are stored in this browser. They do not yet sync through iCloud, Trakt or Simkl.</p><div class="actions"><button class="primary" id="exportData">Download backup</button><button class="secondary" id="shareBackup">Save to Files / iCloud Drive</button><button class="secondary" id="importData">Import backup</button></div><p class="micro">Export does not include the metadata API token. Keep your backups private: they may contain media URLs.</p></section><section class="settingCard"><h2>About Luma</h2><p>Made for personal media exploration and legally accessible content. Real metadata is not a streaming subscription.</p><p class="micro">TV information by TVmaze. Optional movie and television data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. The browser version of Luma does not run natively on Apple TV.</p><button class="secondary" id="refreshCatalog">Refresh catalog</button></section></div>';$("#content").innerHTML=html+LumaAccounts.settingsMarkup();LumaAccounts.bindSettings();$("#theme").value=state.theme;$("#density").value=state.density;$("#accent").oninput=e=>{state.accent=e.target.value;save("accent",state.accent);paint()};$("#theme").onchange=e=>{state.theme=e.target.value;save("theme",state.theme);paint()};$("#density").onchange=e=>{state.density=e.target.value;save("density",state.density);paint()};$("#saveTMDB").onclick=()=>{state.tmdbKey=$("#tmdbKey").value.trim();save("tmdbKey",state.tmdbKey);toast("Metadata settings saved");discover()};$("#clearTMDB").onclick=()=>{state.tmdbKey="";save("tmdbKey","");$("#tmdbKey").value="";discover()};$("#exportData").onclick=exportData;$("#shareBackup").onclick=shareBackup;$("#importData").onclick=importBackup;$("#refreshCatalog").onclick=discover}
function exportData(){const data={version:3,profile:state.profile,watch:state.watch,watchDetails:(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")}catch{return{}}})(),watched:state.watched,progress:state.progress,links:state.links,library:state.library,accent:state.accent,theme:state.theme,density:state.density},blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download="luma-backup-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
async function shareBackup(){let data={version:3,profile:state.profile,watch:state.watch,watchDetails:(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")}catch{return{}}})(),watched:state.watched,progress:state.progress,links:state.links,library:state.library,accent:state.accent,theme:state.theme,density:state.density};let file=new File([JSON.stringify(data,null,2)],"luma-device-backup.json",{type:"application/json"});try{if(typeof navigator.share!=="function"||navigator.canShare&&!navigator.canShare({files:[file]})){toast("Sharing files is not available here. Downloading a backup instead.");exportData();return}await navigator.share({files:[file],title:"Luma device backup"});toast("Choose Save to Files, then iCloud Drive if available.")}catch(e){if(e?.name!=="AbortError"){toast("Could not open file sharing. Downloading backup instead.");exportData()}}}
function importBackup(){const input=document.createElement("input");input.type="file";input.accept=".json,application/json";input.onchange=async()=>{try{let data=JSON.parse(await input.files[0].text());if(!data||typeof data!=="object"||!Array.isArray(data.library)&&!Array.isArray(data.watch))throw Error("Invalid backup");for(const k of ["watch","watched","progress","links","library","accent","theme","density"]){if(data[k]!==undefined){state[k]=data[k];save(k,data[k])}}if(data.watchDetails&&typeof data.watchDetails==="object"){try{localStorage.setItem("luma.device.titles.v1",JSON.stringify(data.watchDetails))}catch{}}toast("Backup imported");closeModal();discover()}catch{toast("Could not import this backup.")}};input.click()}
$("#search").addEventListener("input",e=>onSearch(e.target.value));document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#modal").innerHTML)closeModal()});window.addEventListener("unhandledrejection",e=>{const msg=e.reason?.message||String(e.reason||"Unknown error");if(/(?:runtime\.sendMessage\(\)|chrome\.runtime|browser\.runtime)/i.test(msg)&&/(?:tab not found|invalid call|extension context|receiving end)/i.test(msg)){e.preventDefault();console.info("Browser-extension messaging issue ignored; Luma did not initiate this request.");return}console.error("Luma background task failed:",e.reason);e.preventDefault();const sanitized=msg.replace(/https?:\/\/\S+/g,"[service URL]").slice(0,160);toast("An action failed: "+sanitized+". You can try again without losing your library.")});window.addEventListener("error",e=>{console.error("Luma script error:",e.error||e.message);const box=document.querySelector("#content");if(box&&(!box.children.length||/Loading your media universe/.test(box.textContent||""))){box.innerHTML='<div class="notice"><strong>Luma could not finish loading.</strong><p>Reload the app to retry. Your local watchlist and add-ons are kept on this device.</p><button class="primary" id="restartLuma">Retry loading</button></div>';document.querySelector("#restartLuma").onclick=()=>location.reload()}});window.LumaRender=render;paint();discover();LumaCalendar.prime().catch(()=>{});/* Offline service worker disabled to prevent stale GitHub Pages builds; keep user library in localStorage. */
