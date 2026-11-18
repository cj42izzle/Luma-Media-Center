"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const source=fs.readFileSync("collections.js","utf8");
const app=fs.readFileSync("app.js","utf8");
const releases=fs.readFileSync("releases.js","utf8");
const index=fs.readFileSync("index.html","utf8");

function setup(){
 const calls=[],dom=new Map(),memory=new Map();
 let region="US";
 const node=sel=>{
  if(!dom.has(sel))dom.set(sel,{innerHTML:"",textContent:"",value:"",dataset:{},style:{},selectionStart:0,focus(){},setSelectionRange(){},addEventListener(){},querySelector(){return null}});
  return dom.get(sel);
 };
 const state={tab:"Home",q:"",items:[],watched:[],watch:[],progress:{},tmdbKey:"testing",library:[]};
 const asTitle=(input)=>{
  const type=input.media_type==="tv"?"Series":"Movie";
  return {id:"tmdb:"+input.media_type+":"+input.id,tmdbId:input.id,mediaType:input.media_type,title:input.title||input.name,type,year:"2025",poster:"https://image.example/"+input.id+".jpg",backdrop:"",rating:"7.8",genreNames:["Drama"],source:"tmdb"};
 };
 async function tmdb(endpoint,params={}){
  calls.push({endpoint,params:{...params}});
  const isMovie=endpoint.endsWith("/movie"),isTV=endpoint.endsWith("/tv");
  if(endpoint.startsWith("watch/providers/")){
   const items=region==="CA"
    ?[{"provider_id":isMovie?108:118,"provider_name":"Netflix"},{"provider_id":isMovie?308:318,"provider_name":"HBO Max"}]
    :[{"provider_id":isMovie?8:18,"provider_name":"Netflix"},{"provider_id":isMovie?222:333,"provider_name":"HBO Max"},{"provider_id":isMovie?555:556,"provider_name":"HBO Max Amazon Channel"}];
   return {results:items};
  }
  if(endpoint==="discover/movie"){
   if(params.with_watch_providers==="8")return {results:[{id:101,title:"Netflix verified",media_type:"movie"},{id:102,title:"Other platform only",media_type:"movie"},{id:103,title:"Netflix ads only",media_type:"movie"}],total_pages:4};
   if(params.with_watch_providers==="222")return {results:[{id:301,title:"HBO Max film",media_type:"movie"}],total_pages:2};
   if(params.with_watch_providers==="108")return {results:[{id:401,title:"Canada Netflix movie",media_type:"movie"}],total_pages:1};
   return {results:[],total_pages:1};
  }
  if(endpoint==="discover/tv"){
   if(params.with_watch_providers==="18")return {results:[{id:201,name:"Netflix verified series",media_type:"tv"}],total_pages:3};
   if(params.with_watch_providers==="333")return {results:[{id:302,name:"HBO Max series",media_type:"tv"}],total_pages:2};
   if(params.with_watch_providers==="118")return {results:[{id:402,name:"Canadian Netflix TV",media_type:"tv"}],total_pages:1};
   return {results:[],total_pages:1};
  }
  if(endpoint.endsWith("/watch/providers")){
   const m=endpoint.match(/^(movie|tv)\/(\d+)\/watch\/providers$/);
   if(!m)throw Error("Unexpected watch lookup "+endpoint);
   const id=Number(m[2]),kind=m[1];
   const valid={101:8,102:222,103:8,201:18,301:222,302:333,401:108,402:118}[id];
   if(id===103)return {results:{US:{ads:[{provider_id:8}]}}};
   const offers=kind==="movie"&&id===102?{flatrate:[{provider_id:222}],rent:[{provider_id:8}]}:{flatrate:[{provider_id:valid}]};
   return {results:{[region]:offers}};
  }
  throw Error("Unexpected TMDB request: "+endpoint);
 }
 const context={state,tmdb,normalizeTMDB:asTitle,unique:items=>{const ids=new Set();return items.filter(x=>x?.id&&!ids.has(x.id)&&ids.add(x.id));},
  safe:x=>String(x??""),safeArtworkUrl:x=>String(x||"").startsWith("https://")?x:"",
  LumaReleases:{all:()=>[],feed:()=>[],getRegion:()=>region,setRegion:value=>{region=value}},
  store:()=>[],libraryGroups:()=>({saved:[],watching:[]}),suggestedTitles:()=>[],itemHTML:x=>'<article data-title="'+x.id+'">'+x.title+'</article>',
  shelf:(name,items)=>'<section>'+name+":"+items.length+"</section>",localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v))},
  $:node,$$:()=>[],render(){},window:{LumaRender(){},scrollTo(){}},URL,Date,console};
 vm.createContext(context);vm.runInContext(source+"\nthis.collections=LumaCollections;",context);
 return {x:context.collections,state,calls,node,setRegion:v=>{region=v}};
}
test("every home shelf title and release rail exposes an interactive category",()=>{
 assert.match(app,/class="shelfHeadingLink"/);
 assert.match(app,/data-collection-id/);
 assert.match(releases,/class="shelfHeadingLink"/);
 assert.match(app,/LumaCollections.open\(b.dataset.collectionId\)/);
});
test("category routing preserves the requested collection",()=>{
 const {x}=setup();
 assert.equal(x.collectionID("Netflix · movies & series"),"netflix");
 assert.equal(x.collectionID("HBO Max · movies & series"),"hbo-max");
 assert.equal(x.collectionID("Coming to cinemas"),"upcoming");
 assert.equal(x.collectionID("Adventure & fantasy"),"adventure");
 assert.equal(x.collectionID("TV series to explore","TV Shows"),"series");
 assert.equal(x.collectionID("Recently released","Releases"),"recent");
});
test("Netflix combines movies and TV only when that exact provider has a regional flatrate offer",async()=>{
 const {x,calls}=setup();
 const result=await x.loadPage("netflix",1,"all","popular","US");
 const names=[...result.items.map(x=>x.title)];
 assert.deepEqual(names,["Netflix verified series","Netflix verified"]);
 assert.ok(!names.includes("Other platform only"),"Other-provider offers must not be shown as Netflix");
 assert.ok(!names.includes("Netflix ads only"),"Ads-only entry must not be listed as subscription");
 const discovery=calls.find(c=>c.endpoint==="discover/movie");
 assert.equal(discovery.params.with_watch_providers,"8");
 assert.equal(discovery.params.with_watch_monetization_types,"flatrate");
 assert.equal(discovery.params.watch_region,"US");
 assert.equal(discovery.params.include_adult,"false");
 assert.ok(calls.some(c=>c.endpoint==="movie/101/watch/providers"));
 assert.ok(calls.some(c=>c.endpoint==="tv/201/watch/providers"));
});
test("HBO Max IDs come from the live provider list, not hard-coded brand guesses",async()=>{
 const {x,calls}=setup();
 const ids=await x.providerIDs("hbo-max","US");
 assert.equal(ids.movie,222);
 assert.equal(ids.tv,333);
 const result=await x.loadPage("hbo-max",1,"all","popular","US");
 assert.deepEqual([...result.items.map(t=>t.title)],["HBO Max series","HBO Max film"]);
 assert.ok(!calls.some(c=>c.params?.with_watch_providers==="555"),"Amazon Channel must not stand in for HBO Max");
});
test("provider IDs and subscription availability are country specific",async()=>{
 const {x,calls,setRegion}=setup();
 setRegion("CA");
 const result=await x.loadPage("netflix",1,"all","popular","CA");
 assert.deepEqual([...result.items.map(t=>t.title)],["Canadian Netflix TV","Canada Netflix movie"]);
 assert.ok(calls.some(c=>c.endpoint==="discover/movie"&&c.params.watch_region==="CA"&&c.params.with_watch_providers==="108"));
 assert.ok(!calls.some(c=>c.endpoint==="discover/movie"&&c.params.watch_region==="CA"&&c.params.with_watch_providers==="8"));
});
test("brand cards are decorative text and metadata keys are required rather than fabricated",()=>{
 const {x,state,calls}=setup();
 state.tmdbKey="";
 const html=x.providerShowcase();
 assert.match(html,/Netflix/);
 assert.match(html,/HBO Max/);
 assert.match(html,/TMDB read-only API credential/);
 assert.match(html,/data-collection-id="netflix"/);
 assert.match(html,/data-collection-id="hbo-max"/);
 assert.equal(calls.length,0,"A no-key promotional view cannot claim verified availability");
});
test("provider-specific view never substitutes generic cached titles",()=>{
 const {x,state}=setup();
 state.tmdbKey="";
 state.items=[{id:"example",title:"Unverified production company film",source:"tmdb",type:"Movie"}];
 x.open("netflix");
 assert.equal(state.tab,"Collection");
 const html=x.renderCollection();
 assert.match(html,/Enable Netflix catalog information/);
 assert.doesNotMatch(html,/Unverified production company film/);
 assert.match(html,/exact provider and country/);
});
test("standalone site ships synced collections module before app initialization",()=>{
 const scripts=[...index.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1].trim());
 assert.ok(scripts.includes(source.trim()));
 const indexOfCollections=scripts.findIndex(t=>t.includes("const LumaCollections=(()=>{"));
 const indexOfApp=scripts.findIndex(t=>t.includes('const state={tab:"Home"'));
 assert.ok(indexOfCollections>=0&&indexOfCollections<indexOfApp);
 assert.match(index,/Luma · Live Build 33/);
 assert.match(index,/Luma smart collection browsing/);
});
