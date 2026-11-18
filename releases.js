
"use strict";
/* Built-in normalized metadata and release discovery layer. Authoritative availability comes from verified external catalogs, never inferred from a release date. */
const LumaReleases=(()=>{
const DAY=86400000,TTL=60*60*1000,CINEMA_MAX_AGE_YEARS=2;
let feeds={},errors=[],details=new Map(),cinemaDetails=new Map();
let region=(()=>{try{const x=localStorage.getItem("luma.region")||"US";return ["US","GB","CA","AU"].includes(x)?x:"US"}catch{return"US"}})();
function date(x){return x?.theatricalDate||x?.date||x?.releaseDate||x?.firstAirDate||x?.premiered||""}
function day(s){
 if(typeof s!=="string")return null;
 const m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);if(!m)return null;
 const n=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]));
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===m[1]+"-"+m[2]+"-"+m[3]?n:null;
}
function iso(ms){return new Date(ms).toISOString().slice(0,10)}
function utcToday(clock=Date.now()){return day(iso(clock))}
function dayShift(offset,clock=Date.now()){return iso(utcToday(clock)+offset*DAY)}
function daysFromNow(x,clock=Date.now()){
 const t=day(date(x));return t===null?null:Math.round((t-utcToday(clock))/DAY);
}
function originalRecent(value,clock=Date.now()){
 const original=day(value);if(original===null)return false;
 const year=new Date(original).getUTCFullYear(),current=new Date(clock).getUTCFullYear();
 return year>=current-CINEMA_MAX_AGE_YEARS&&year<=current+2;
}
function cinemaQuery(kind="upcoming",area=region,clock=Date.now()){
 if(!["upcoming","theaters"].includes(kind))throw Error("Unknown cinema category.");
 const current=new Date(clock).getUTCFullYear(),upcoming=kind==="upcoming";
 return {region:area,with_release_type:"2|3",include_adult:"false",
  "release_date.gte":dayShift(upcoming?0:-28,clock),
  "release_date.lte":dayShift(upcoming?120:0,clock),
  "primary_release_date.gte":(current-CINEMA_MAX_AGE_YEARS)+"-01-01",
  sort_by:upcoming?"release_date.asc":"release_date.desc"};
}
function verifyCinemaRecord(data,release,kind,area,clock=Date.now()){
 if(!data||!originalRecent(data.release_date,clock))return null;
 const rows=Array.isArray(release?.results)?release.results:Array.isArray(data.release_dates?.results)?data.release_dates.results:[];
 const located=rows.find(r=>r.iso_3166_1===area);
 if(!located||!Array.isArray(located.release_dates))return null;
 const first=located.release_dates.filter(r=>Number(r.type)===2||Number(r.type)===3)
  .map(r=>day(r.release_date)).filter(v=>v!==null).sort((a,b)=>a-b)[0];
 if(first===undefined)return null;
 const lower=utcToday(clock)+(kind==="upcoming"?0:-28)*DAY;
 const upper=utcToday(clock)+(kind==="upcoming"?120:0)*DAY;
 if(first<lower||first>upper)return null;
 return {originalReleaseDate:iso(day(data.release_date)),theatricalDate:iso(first),cinemaRegion:area};
}
async function movieDetail(id){
 const key=String(id),old=cinemaDetails.get(key);
 if(old&&Date.now()-old.time<6*60*60*1000)return old.value;
 const value=await tmdb("movie/"+key,{append_to_response:"release_dates"});
 if(!value||!value.id)throw Error("Movie details missing");
 cinemaDetails.set(key,{time:Date.now(),value});
 return value;
}
async function cinemaTitles(kind="upcoming",page=1,area=region,opts={}){
 const clock=opts.clock??Date.now(),limit=opts.limit??18;
 const input=await tmdb("discover/movie",{...cinemaQuery(kind,area,clock),page});
 const candidates=(Array.isArray(input?.results)?input.results:[]).filter(x=>x&&Number.isInteger(Number(x.id))&&Number(x.id)>0).slice(0,limit);
 const checked=[];let failures=0;
 for(let i=0;i<candidates.length;i+=6){
  const group=await Promise.allSettled(candidates.slice(i,i+6).map(async raw=>{
   const detail=await movieDetail(raw.id);
   const confirmation=verifyCinemaRecord(detail,detail.release_dates,kind,area,clock);
   if(!confirmation)return null;
   const x=normalizeTMDB({...raw,media_type:"movie"});
   return {...x,...confirmation,year:confirmation.originalReleaseDate.slice(0,4),
    date:confirmation.theatricalDate,cinemaVerified:true,cinemaKind:kind};
  }));
  for(const item of group){if(item.status==="fulfilled"&&item.value)checked.push(item.value);else if(item.status==="rejected")failures++}
 }
 const uniqueIDs=new Set();
 const items=checked.filter(x=>{if(uniqueIDs.has(x.id))return false;uniqueIDs.add(x.id);return true});
 items.sort((a,b)=>(day(a.theatricalDate)-day(b.theatricalDate))*(kind==="upcoming"?1:-1));
 return {items,errors:failures,pages:Math.min(Math.max(1,Number(input?.total_pages)||1),100),
  candidates:candidates.length};
}
function verifiedFeed(kind,clock=Date.now()){
 return (Array.isArray(feeds[kind])?feeds[kind]:[]).filter(x=>x?.cinemaVerified&&x?.cinemaKind===kind
   &&x?.cinemaRegion===region&&originalRecent(x.originalReleaseDate,clock)
   &&(()=>{const offset=daysFromNow(x,clock);return offset!==null&&(kind==="upcoming"?offset>=0&&offset<=120:offset>=-28&&offset<=0)})());
}
function upcomingMovies(){return verifiedFeed("upcoming")}
function inTheaters(){return verifiedFeed("theaters")}
function label(x){
 if(x?.cinemaVerified){
  const d=daysFromNow(x);
  if(d===null)return "";
  return x.cinemaKind==="upcoming"?"In cinemas "+String(x.theatricalDate||"").slice(5):
   "In cinemas · "+String(x.cinemaRegion||region);
 }
 const d=daysFromNow(x);if(d===null)return"";
 if(x?.type==="Movie"&&d>0&&!originalRecent(x.originalReleaseDate||(x.year?x.year+"-01-01":x.date)))return"";
 if(d>0)return"Coming "+(d<31?"soon":"later");
 if(d>=-30)return"New release";
 return"";
}
function cacheKey(){return"luma.catalog.feeds.v3."+region}
function cached(){
 try{
  const x=JSON.parse(localStorage.getItem(cacheKey())||"null");
  if(!x||!x.feeds||Date.now()-x.time>TTL)return null;
  const cachedFeeds=x.feeds;
  for(const kind of ["upcoming","theaters"]){
   cachedFeeds[kind]=(Array.isArray(cachedFeeds[kind])?cachedFeeds[kind]:[])
    .filter(item=>item?.cinemaVerified&&item.cinemaRegion===region&&originalRecent(item.originalReleaseDate));
  }
  return cachedFeeds;
 }catch{return null}
}
function saveFeeds(){try{localStorage.setItem(cacheKey(),JSON.stringify({time:Date.now(),feeds}))}catch{}}
function titles(xs){
 return (Array.isArray(xs)?xs:[]).map(x=>normalizeTMDB(x.media_type?x:{...x,media_type:x.title?"movie":"tv"}))
  .filter(x=>x.poster||x.backdrop);
}
async function refresh(){
 if(!state.tmdbKey){feeds={};return}
 const previous=cached();if(previous){feeds=previous;return}
 const names=[["trending","trending/all/day"],["popularMovies","movie/popular"],["popularTV","tv/popular"],
  ["onAir","tv/on_the_air"],["streamingMovies","discover/movie"],["streamingTV","discover/tv"]];
 const jobs=names.map(async([name,path])=>({name,items:titles((await tmdb(path,name.startsWith("streaming")?
  {watch_region:region,with_watch_monetization_types:"flatrate",sort_by:"popularity.desc"}:{region})).results||[])}));
 jobs.push((async()=>({name:"upcoming",items:(await cinemaTitles("upcoming",1,region,{limit:16})).items}))());
 jobs.push((async()=>({name:"theaters",items:(await cinemaTitles("theaters",1,region,{limit:16})).items}))());
 const outcomes=await Promise.allSettled(jobs),fresh={};errors=[];
 for(const item of outcomes){if(item.status==="fulfilled")fresh[item.value.name]=item.value.items;
  else errors.push(String(item.reason?.message||item.reason).slice(0,120))}
 feeds=Object.keys(fresh).length?fresh:previous||{};
 if(Object.keys(fresh).length)saveFeeds();
}
function all(){return Object.values(feeds).flat()}

function rail(name,items,limit=16){if(!items?.length)return"";const ids=new Set;const uniqueItems=items.filter(x=>{if(ids.has(x.id))return false;ids.add(x.id);return true}).slice(0,limit);return'<section class="shelf lumaShelf"><div class="shelfhead"><button type="button" class="shelfHeadingLink" data-collection-id="'+safe(LumaCollections.collectionID(name))+'"><h2>'+safe(name)+'</h2><span class="shelfHeadingExplore">Explore collection ›</span></button><div class="railActions"><button type="button" class="shelfViewAll" data-collection-id="'+safe(LumaCollections.collectionID(name))+'">See all ›</button><button class="railArrow" data-scroll="-1" aria-label="Scroll '+safe(name)+' left">‹</button><button class="railArrow" data-scroll="1" aria-label="Scroll '+safe(name)+' right">›</button></div></div><div class="tiles" tabindex="0" aria-label="'+safe(name)+' horizontal titles">'+uniqueItems.map(x=>itemHTML(x).replace('class="media lumaMediaCard"','class="media lumaMediaCard releaseCard"')).join("")+'</div></section>'}
function homepage(items){
 const upcoming=upcomingMovies(),cinemas=inTheaters();
 const recent=items.filter(x=>{
  const d=daysFromNow(x);return d!==null&&d<=0&&d>=-45
   &&(x.type!=="Movie"||originalRecent(x.originalReleaseDate||x.year+"-01-01"));
 });
 const sections=feeds.trending?.length?rail("🔥 Trending today",feeds.trending):rail("Spotlight",items.slice(0,20));
 const nowStreaming=(feeds.streamingMovies?.length||feeds.streamingTV?.length)?
  rail("▶ Subscription streaming listings · "+region,[...(feeds.streamingMovies||[]),...(feeds.streamingTV||[])]):"";
 const cinema=cinemas.length?rail("🎟 In cinemas · "+region,cinemas):"";
 const soon=upcoming.length?rail("📆 Coming to cinemas · "+region,upcoming):"";
 const cinematic=feeds.popularMovies?.length?rail("🎬 Popular movies",feeds.popularMovies)
  :rail("🎬 Movies to discover",items.filter(x=>x.type==="Movie"));
 return '<div class="categoryStrip">'
  +'<button data-go="Releases"><b>✦ New & upcoming</b><span>Verified cinema release dates</span></button>'
  +'<button data-go="Calendar"><b>📅 TV Calendar</b><span>New episodes & air times</span></button>'
  +'<button data-collection-id="theaters"><b>🎟 In cinemas</b><span>'+(state.tmdbKey?"Theatrical releases · "+region:"TMDB required")+'</span></button>'
  +'<button data-collection-id="upcoming"><b>📆 Coming to cinemas</b><span>'+(state.tmdbKey?"Upcoming new films · "+region:"TMDB required")+'</span></button>'
  +'<button data-go="TV Shows"><b>📺 Series</b><span>Browse top shows</span></button>'
  +'<button data-go="Add-ons"><b>✧ Add-ons</b><span>Luma catalog sources</span></button></div>'
  +sections+nowStreaming+cinema+soon+rail("✨ Just released",recent)+cinematic;
}
function releasePage(items){
 const upcoming=upcomingMovies(),cinemas=inTheaters();
 const recent=items.filter(x=>{
  const d=daysFromNow(x);return d!==null&&d<=0&&d>=-35
    &&(x.type!=="Movie"||originalRecent(x.originalReleaseDate||x.year+"-01-01"));
 }).sort((a,b)=>(day(date(b))||0)-(day(date(a))||0));
 const info='<section class="releaseIntro"><div class="eyebrow">LUMA RELEASE RADAR</div><h2>Discover what’s new and next</h2>'
  +'<p>Coming to cinemas shows only new movies with verified regional theatrical release dates. Older film re-releases, digital-only releases and TV premieres are excluded from cinema rows. TV episodes have their own calendar.</p>'
  +'<label>Country for cinema and streaming releases <select id="regionSelect">'
  +'<option value="US">United States</option><option value="GB">United Kingdom</option><option value="CA">Canada</option><option value="AU">Australia</option></select></label>'
  +'<p class="micro">'+(state.tmdbKey?"TMDB connected. Cinema release dates are checked by country and theatrical release type."
    :"Connect a TMDB read-only API credential in Settings to load verified cinema dates.")+'</p></section>';
 const sections=rail("📆 Coming to cinemas · "+region,upcoming,35)
  +rail("🎟 In cinemas · "+region,cinemas,35)
  +rail("Recently released titles",recent,30)
  +(feeds.streamingMovies?.length||feeds.streamingTV?.length?
     rail("Subscription streaming listings",[
      ...(feeds.streamingMovies||[]),...(feeds.streamingTV||[])],30):"");
 return info+sections+(upcoming.length||cinemas.length?"":'<div class="empty">No verified new theatrical listings have loaded for '+safe(region)+'. This does not mean no cinemas are showing movies. Check your TMDB connection or select another country.</div>');
}
function bind(){
 document.querySelectorAll("[data-go]").forEach(x=>x.onclick=()=>{state.tab=x.dataset.go;state.q="";$("#search").value="";render()});
 if($("#regionSelect")){
  $("#regionSelect").value=region;
  $("#regionSelect").onchange=e=>{
   setRegion(e.target.value);
   refresh().then(()=>{state.items=unique([...state.items,...all()]);render()}).catch(()=>render());
   render();
  };
 }
}

function providerNames(arr){return Array.isArray(arr)?arr.slice(0,10).map(p=>p.provider_name).filter(Boolean).join(", "):""}
async function enrichDetail(x){if(!x?.tmdbId||!state.tmdbKey)return;const key=x.mediaType+":"+x.tmdbId+":"+region;let data=details.get(key);if(!data){try{const path=x.mediaType==="tv"?"tv":"movie";const [providers,releases]=await Promise.allSettled([tmdb(path+"/"+x.tmdbId+"/watch/providers"),x.mediaType==="movie"?tmdb("movie/"+x.tmdbId+"/release_dates"):tmdb("tv/"+x.tmdbId)]);data={providers:providers.status==="fulfilled"?providers.value:null,releases:releases.status==="fulfilled"?releases.value:null};details.set(key,data)}catch{return}}if(state.selected?.id!==x.id)return;const panel=document.querySelector(".detailBody");if(!panel)return;panel.querySelector("#lumaAvailability")?.remove();let p=data.providers?.results?.[region]||{},types=[["flatrate","Subscription streaming"],["free","Free streaming"],["ads","Free with ads"],["rent","Rent"],["buy","Buy"]],rows=types.map(([k,name])=>p[k]?.length?'<div class="providerRow"><b>'+name+'</b><span>'+safe(providerNames(p[k]))+'</span></div>':"").join("");let releaseInfo="",next="",kind=x.mediaType==="movie"?"Movie":"TV";if(kind==="Movie"){const us=data.releases?.results?.find(r=>r.iso_3166_1===region);const entries=us?.release_dates||[];const theatrical=entries.filter(d=>d.type===2||d.type===3).map(d=>d.release_date?.slice(0,10)).filter(Boolean).sort()[0];const digital=entries.filter(d=>d.type===4).map(d=>d.release_date?.slice(0,10)).filter(Boolean).sort()[0];releaseInfo=(theatrical?'<div class="providerRow"><b>Reported theatrical release</b><span>'+safe(theatrical)+'</span></div>':"")+(digital?'<div class="providerRow"><b>Reported digital release</b><span>'+safe(digital)+'</span></div>':"")}else{next=data.releases?.next_episode_to_air?.air_date||"";releaseInfo=next?'<div class="providerRow"><b>Next episode airs</b><span>'+safe(next)+'</span></div>':""}const heading=rows?'<span class="availabilityBadge">Provider listings available</span>':'<span class="statusUnknown">Streaming availability not confirmed</span>';let section=document.createElement("section");section.id="lumaAvailability";section.className="availabilityPanel";section.innerHTML='<h3>Release & availability in '+safe(region)+'</h3>'+heading+releaseInfo+(rows||'<p class="micro">No current provider entries were returned for this country. This does not prove a title is unavailable.</p>')+(p.link?'<p><a href="'+safe(p.link)+'" target="_blank" rel="noopener noreferrer">Check provider listings ↗</a></p>':'')+'<p class="micro">Listings and dates provided by TMDB and JustWatch. They may be delayed or incomplete. A theatrical release date does not confirm current cinema showtimes.</p>';panel.appendChild(section)}
function feed(name){return Array.isArray(feeds[name])?[...feeds[name]]:[]}
function getRegion(){return region}
function setRegion(value){
 if(!["US","GB","CA","AU"].includes(value)||value===region)return region;
 region=value;feeds={};errors=[];
 try{localStorage.setItem("luma.region",region)}catch{}
 return region;
}
return{refresh,all,homepage,releasePage,bind,enrichDetail,label,feed,getRegion,setRegion,cinemaQuery,cinemaTitles,verifyCinemaRecord,originalRecent,upcomingMovies,inTheaters,day,dayShift,verifiedFeed}
})();
