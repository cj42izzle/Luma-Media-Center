"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("collections.js","utf8");
function harness(){
 const calls=[],elements=new Map(),records=new Map();
 const node=k=>{if(!elements.has(k))elements.set(k,{value:"",innerHTML:"",focus(){},setSelectionRange(){}});return elements.get(k)};
 const state={tab:"Home",tmdbKey:"test_key",q:"",items:[],watch:[],watched:[]};
 const providers=[
  {provider_id:8,provider_name:"Netflix"},{provider_id:45,provider_name:"Peacock Premium"},
  {provider_id:46,provider_name:"Peacock Premium Plus"},{provider_id:78,provider_name:"Peacock Premium Amazon Channel"},
  {provider_id:80,provider_name:"Tubi TV"},{provider_id:81,provider_name:"The Roku Channel"},
  {provider_id:96,provider_name:"Crunchyroll"},{provider_id:97,provider_name:"Crunchyroll Amazon Channel"}
 ];
 const title=id=>({id,title:"Title "+id,name:"Title "+id,genre_ids:[18],original_language:"ja",release_date:"2025-04-10",vote_average:7.7});
 const offers={
  101:{flatrate:[{provider_id:45}]},102:{flatrate:[{provider_id:46}]},103:{flatrate:[{provider_id:78}]},
  201:{ads:[{provider_id:80}]},202:{free:[{provider_id:80}]},203:{rent:[{provider_id:80}]},
  301:{flatrate:[{provider_id:8}]},302:{flatrate:[{provider_id:45}]},
  401:{flatrate:[{provider_id:96}]}
 };
 async function tmdb(endpoint,params={}){
  calls.push({endpoint,params:{...params}});
  if(endpoint==="watch/providers/movie"||endpoint==="watch/providers/tv")return {results:providers};
  const m=endpoint.match(/^(movie|tv)\/(\d+)\/watch\/providers$/);
  if(m)return {results:{US:offers[Number(m[2])]||{}}};
  if(endpoint==="discover/movie"||endpoint==="discover/tv"){
   let ids=String(params.with_watch_providers||"").split("|");
   let rows=[];
   if(ids.includes("45"))rows=[title(101),title(102),title(103)];
   if(ids.includes("80"))rows=[title(201),title(202),title(203)];
   if(ids.includes("8"))rows=[title(301),title(302)];
   if(ids.includes("96"))rows=[title(401)];
   if(endpoint==="discover/tv")rows=[];
   if(Number(params.page)===2)rows=rows.map(x=>({...x,id:x.id+1000}));
   return {results:rows,total_pages:6,total_results:120};
  }
  if(endpoint==="search/movie")return {results:[title(301),title(302)],total_pages:1};
  if(endpoint==="search/tv")return {results:[],total_pages:1};
  throw Error("Unexpected endpoint "+endpoint);
 }
 let renders=0;
 const context={state,tmdb,safe:String,normalizeTMDB:m=>({id:"tmdb:"+m.media_type+":"+m.id,mediaType:m.media_type,tmdbId:m.id,
   title:m.title||m.name,type:m.media_type==="tv"?"Series":"Movie",year:"2025",poster:"https://example.com/"+m.id+".jpg",
   original_language:m.original_language,genreNames:["Drama"],rating:"7.7"}),
  unique:items=>{const seen=new Set();return items.filter(x=>x&&x.id&&!seen.has(x.id)&&seen.add(x.id))},
  LumaReleases:{all:()=>[],feed:()=>[],getRegion:()=>"US",setRegion(){}},
  store:()=>[],libraryGroups:()=>({saved:[],watching:[]}),suggestedTitles:()=>[],
  itemHTML:x=>'<div>'+x.title+'</div>',shelf:()=>"",safeArtworkUrl:x=>String(x||"").startsWith("https://")?x:"",
  $:node,$$:()=>[],render(){renders++},window:{scrollTo(){},LumaRender(){}},
  Date,URL,setTimeout,clearTimeout,console};
 vm.createContext(context);vm.runInContext(source+"\nthis.api=LumaCollections;",context);
 return {api:context.api,state,calls,node,renderCount:()=>renders};
}
test("expanded network directory includes 25 services and groups free services separately",()=>{
 const {api,state}=harness();state.tmdbKey="";
 const html=api.providerShowcase();
 assert.equal((html.match(/data-collection-id="/g)||[]).length,25);
 for(const brand of ["Netflix","HBO Max","Apple TV+","Paramount+","Peacock","Crunchyroll","STARZ","AMC+",
  "MUBI","BritBox","discovery+","Tubi","Pluto TV","The Roku Channel","Kanopy","Hoopla"])assert.ok(html.includes(brand),brand);
 assert.match(html,/Free & ad-supported/);
 assert.match(html,/Subscription networks/);
 assert.match(html,/TMDB read-only API credential/);
});
test("Peacock provider aliases combine legitimate tiers but exclude Amazon channels",async()=>{
 const {api,calls}=harness();
 const ids=await api.providerIDs("peacock","US");
 assert.equal(ids.movie,45);assert.deepEqual([...ids.movieAll],[45,46]);
 const page=await api.loadPage("peacock",1,"Movie","popular","US");
 assert.deepEqual([...page.items.map(x=>x.tmdbId)],[101,102]);
 assert.ok(!page.items.some(x=>x.tmdbId===103));
 const query=calls.find(x=>x.endpoint==="discover/movie");
 assert.equal(query.params.with_watch_providers,"45|46");
 assert.equal(query.params.with_watch_monetization_types,"flatrate");
});
test("Tubi free-and-ads listings include free/ads but exclude rent-only offers",async()=>{
 const {api,calls}=harness();
 const page=await api.loadPage("tubi",1,"Movie","popular","US");
 assert.deepEqual([...page.items.map(x=>x.tmdbId)],[201,202]);
 assert.ok(!page.items.some(x=>x.tmdbId===203));
 assert.ok(page.items.every(x=>x.offerType==="free"&&x.availabilityLabel==="Tubi"));
 const query=calls.find(x=>x.endpoint==="discover/movie");
 assert.equal(query.params.with_watch_monetization_types,"ads|free");
});
test("provider filters are sent to TMDB rather than applied to only the initial list",async()=>{
 const {api,calls}=harness();
 const page=await api.loadPage("netflix",1,"Movie","rating","US",false,{
   genre:"Drama",year:"2025",language:"ja",query:""
 });
 assert.equal(page.items.length,1);
 const discovery=calls.find(x=>x.endpoint==="discover/movie");
 assert.equal(discovery.params.with_genres,"18");
 assert.equal(discovery.params.primary_release_year,"2025");
 assert.equal(discovery.params.with_original_language,"ja");
 assert.equal(discovery.params.sort_by,"vote_average.desc");
 assert.equal(discovery.params.watch_region,"US");
});
test("network title searches verify exact streaming availability even when TMDB search has no provider filter",async()=>{
 const {api,calls}=harness();
 const page=await api.loadPage("netflix",1,"Movie","popular","US",false,{query:"Title"});
 assert.deepEqual([...page.items.map(x=>x.tmdbId)],[301]);
 assert.ok(!page.items.some(x=>x.tmdbId===302));
 const query=calls.find(x=>x.endpoint==="search/movie");
 assert.equal(query.params.query,"Title");
 assert.equal(query.params.with_watch_providers,undefined);
 assert.ok(calls.some(x=>x.endpoint==="movie/301/watch/providers"));
});
test("new collection has remote year, language, country and reset controls",()=>{
 const {api}=harness();api.open("netflix");
 const html=api.renderCollection();
 for(const id of ["collectionSearch","collectionYear","collectionLanguage","collectionGenre","collectionType","collectionSort","collectionRegion","collectionReset","collectionAutoSentinel"]){
  assert.ok(html.includes('id="'+id+'"'),"Missing "+id);
 }
 assert.match(html,/Netflix catalog/);
 assert.match(html,/Loading verified results|verified titles/i);
});
test("catalog automatically preloads verified source pages without repeated clicks",async()=>{
 const {api,state,calls}=harness();
 api.open("netflix");
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(state.tab,"Collection");
 assert.ok(calls.some(x=>x.endpoint==="discover/movie"&&Number(x.params.page)===1));
 assert.ok(calls.some(x=>x.endpoint==="discover/movie"&&Number(x.params.page)===2));
 assert.ok(api.currentItems().some(x=>x.tmdbId===301));
});

test("changing provider filters while results are loading cancels stale pages and fetches fresh data",async()=>{
 const {api,node,calls}=harness();
 api.open("netflix");
 api.bind();
 const year=node("#collectionYear");
 assert.equal(typeof year.onchange,"function");
 year.onchange({target:{value:"2025"}});
 for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(calls.some(x=>x.endpoint==="discover/movie"&&x.params.primary_release_year==="2025"),
  "The new year filter must trigger a fresh remote discover request even during an older load");
 const html=api.renderCollection();
 assert.match(html,/2025/);
 assert.doesNotMatch(html,/Checking pages…/);
});
