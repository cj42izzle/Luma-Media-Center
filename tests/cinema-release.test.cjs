"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const releasesSource=fs.readFileSync("releases.js","utf8");
const collectionsSource=fs.readFileSync("collections.js","utf8");
const homeSource=fs.readFileSync("app.js","utf8");
const index=fs.readFileSync("index.html","utf8");
const CLOCK=Date.UTC(2026,10,18,18,0,0);
const oldDate="2005-06-15";
const presets=[
 {id:1,name:"New film",original:"2026-11-10",US:[{type:3,date:"2026-12-05"}]},
 {id:2,name:"Old film rerelease",original:oldDate,US:[{type:3,date:"2026-12-05"}]},
 {id:3,name:"Digital only",original:"2026-11-15",US:[{type:4,date:"2026-12-07"}]},
 {id:4,name:"Limited theatrical premiere",original:"2026-10-12",US:[{type:2,date:"2026-11-29"}]},
 {id:5,name:"In theaters now",original:"2026-10-30",US:[{type:3,date:"2026-11-09"}]},
 {id:6,name:"UK release only",original:"2026-10-22",US:[{type:3,date:"2026-10-04"}],GB:[{type:3,date:"2026-12-01"}]},
 {id:7,name:"Unknown origin",original:"",US:[{type:3,date:"2026-12-01"}]},
 {id:8,name:"Too far away",original:"2026-10-20",US:[{type:3,date:"2027-05-05"}]},
 {id:9,name:"Old film in theaters",original:"1999-10-23",US:[{type:2,date:"2026-11-10"}]},
 {id:10,name:"Recent limited release",original:"2026-10-22",US:[{type:2,date:"2026-11-15"}]},
 {id:11,name:"Previously released now",original:"2026-09-02",US:[{type:2,date:"2026-11-01"},{type:3,date:"2026-12-06"}]},
 {id:12,name:"Not in selected region",original:"2026-10-31",GB:[{type:3,date:"2026-12-03"}]},
 {id:13,name:"Delayed regional premiere",original:"2025-09-20",US:[{type:3,date:"2026-12-18"}]}
];
function setup(){
 const calls=[],storage=new Map([["luma.catalog.feeds.v2.US",JSON.stringify({time:CLOCK,feeds:{upcoming:[{title:"Obsolete cache title",id:"old"}]}})]]);
 const state={tmdbKey:"test-public-key",tab:"Home",items:[]};
 let region="US";
 class FakeDate extends Date {static now(){return CLOCK}}
 const records=new Map(presets.map(p=>[p.id,p]));
 const tmdb=async (endpoint,params={})=>{
  calls.push({endpoint,params:{...params}});
  if(endpoint==="discover/movie")return {results:presets.map(p=>({id:p.id,title:p.name,media_type:"movie",release_date:"2026-12-01",genre_ids:[18],original_language:"en"})),total_pages:5,total_results:100};
  if(endpoint.startsWith("movie/")&&endpoint!== "movie/upcoming"&&endpoint!=="movie/now_playing"){
   const id=Number(endpoint.split("/")[1]),record=records.get(id);
   if(!record)throw Error("Unknown movie: "+id);
   return {id,release_date:record.original,release_dates:{results:Object.entries({US:record.US,GB:record.GB})
      .filter(([,value])=>Array.isArray(value)).map(([country,entries])=>({iso_3166_1:country,
       release_dates:entries.map(e=>({type:e.type,release_date:e.date+"T00:00:00.000Z"}))}))}};
  }
  return {results:[],total_pages:1};
 };
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))};
 const context={Date:FakeDate,state,localStorage,tmdb,normalizeTMDB:x=>({id:"tmdb:movie:"+x.id,tmdbId:x.id,title:x.title,year:String(x.release_date||"").slice(0,4),
  mediaType:"movie",type:"Movie",date:x.release_date,poster:"https://example.org/"+x.id+".jpg",genreNames:["Drama"]}),
  safe:x=>String(x??""),itemHTML:x=>'<article data-movie="'+x.tmdbId+'">'+x.title+'</article>',
  LumaCollections:{collectionID:()=> "upcoming"},document:{querySelectorAll:()=>[]},
  $:()=>({value:""}),render(){},unique:items=>items,URLSearchParams,console};
 vm.createContext(context);vm.runInContext(releasesSource+"\nthis.releases=LumaReleases;",context);
 return {release:context.releases,calls,state,storage,records,context};
}
test("cinema query limits dates by country, theatrical type, and original premiere era",()=>{
 const {release}=setup();
 const query=release.cinemaQuery("upcoming","US",CLOCK);
 assert.equal(query.region,"US");
 assert.equal(query.with_release_type,"2|3");
 assert.equal(query["release_date.gte"],"2026-11-18");
 assert.equal(query["release_date.lte"],"2027-03-18");
 assert.equal(query["primary_release_date.gte"],"2024-01-01");
 assert.equal(query.sort_by,"release_date.asc");
 const theaters=release.cinemaQuery("theaters","US",CLOCK);
 assert.equal(theaters["release_date.gte"],"2026-10-21");
 assert.equal(theaters["release_date.lte"],"2026-11-18");
});
test("upcoming movies exclude 20-year-old rereleases, digital-only films and previously opened cinemas",async()=>{
 const {release,calls}=setup();
 const data=await release.cinemaTitles("upcoming",1,"US",{clock:CLOCK,limit:20});
 assert.deepEqual([...data.items.map(x=>x.tmdbId)],[4,1,13]);
 for(const id of [2,3,5,6,7,8,9,10,11,12])assert.ok(!data.items.some(x=>x.tmdbId===id),String(id));
 const discovery=calls.find(x=>x.endpoint==="discover/movie");
 assert.equal(discovery.params.with_release_type,"2|3");
 assert.equal(discovery.params.region,"US");
 assert.equal(data.items[0].theatricalDate,"2026-11-29");
 assert.equal(data.items[0].year,"2026");
 assert.ok(data.items.every(x=>x.cinemaVerified&&x.cinemaRegion==="US"));
});
test("In cinemas shows only recent first theatrical releases in selected region",async()=>{
 const {release}=setup();
 const data=await release.cinemaTitles("theaters",1,"US",{clock:CLOCK,limit:20});
 assert.deepEqual([...data.items.map(x=>x.tmdbId)],[10,5,11]);
 assert.ok(!data.items.some(x=>x.tmdbId===9),"1999 re-release cannot be labeled new in cinemas");
 assert.ok(!data.items.some(x=>x.tmdbId===3),"digital-only cannot be theatrical");
});
test("regional dates do not leak across countries",async()=>{
 const {release}=setup();
 const data=await release.cinemaTitles("upcoming",1,"GB",{clock:CLOCK,limit:20});
 assert.ok(data.items.some(x=>x.tmdbId===6));
 assert.ok(data.items.some(x=>x.tmdbId===12));
 assert.ok(!data.items.some(x=>x.tmdbId===1));
 assert.ok(data.items.every(x=>x.cinemaRegion==="GB"));
});
test("Cinema title searches still check first theatrical date and original movie release year",async()=>{
 const {release,calls}=setup();
 const data=await release.cinemaTitles("upcoming",1,"US",{clock:CLOCK,limit:20,filter:{query:"film"}});
 assert.ok(data.items.every(x=>x.cinemaVerified));
 assert.ok(!data.items.some(x=>x.tmdbId===2));
 // Direct TMDB search is not allowed to imply a cinema release.
 assert.ok(calls.some(x=>x.endpoint==="search/movie"));
});
test("Stale release cache v2 is ignored and old film entries never reappear on the cinema rails",async()=>{
 const {release,state,calls,storage}=setup();
 await release.refresh();
 const page=release.homepage([]);
 assert.match(page,/Coming to cinemas/);
 assert.match(page,/Limited theatrical premiere/);
 assert.doesNotMatch(page,/Old film rerelease|Obsolete cache title|Digital only/);
 assert.ok(calls.some(x=>x.endpoint==="discover/movie"));
 assert.ok(!calls.some(x=>x.endpoint==="movie/upcoming"),"unverified generic upcoming feed must not be reused");
 assert.ok(storage.has("luma.catalog.feeds.v3.US"));
 const releasePage=release.releasePage([]);
 assert.match(releasePage,/Country for cinema and streaming releases/);
 assert.doesNotMatch(releasePage,/Old film rerelease|Digital only|Old film in theaters/);
});
test("Cinema labels and collection views do not resurrect old future-dated movies",()=>{
 const {release,context}=setup();
 assert.equal(release.label({type:"Movie",year:"2005",date:"2026-12-01"}),"");
 const source=collectionsSource;
 assert.match(source,/if\(id==="upcoming"\)return LumaReleases\.upcomingMovies\(\)/);
 assert.match(source,/if\(id==="theaters"\)return LumaReleases\.inTheaters\(\)/);
 assert.doesNotMatch(source,/id==="upcoming"\)return unique\(\[\.\.\.LumaReleases.feed\("upcoming"\)/);
 assert.match(index,/Luma · Live Build 33/);
 assert.match(homeSource,/LumaReleases\.homepage\(filtered\)/);
});
test("Invalid theatrical dates and noncinema types are rejected",()=>{
 const {release}=setup();
 const detail={release_date:"2026-10-04"};
 const wrongType={results:[{iso_3166_1:"US",release_dates:[{type:4,release_date:"2026-12-01T12:00:00Z"}]}]};
 assert.equal(release.verifyCinemaRecord(detail,wrongType,"upcoming","US",CLOCK),null);
 const invalid={results:[{iso_3166_1:"US",release_dates:[{type:3,release_date:"2026-02-30T00:00:00Z"}]}]};
 assert.equal(release.verifyCinemaRecord(detail,invalid,"upcoming","US",CLOCK),null);
});
