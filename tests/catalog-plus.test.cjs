"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const script=fs.readFileSync("catalog-plus.js","utf8");
const app=fs.readFileSync("app.js","utf8"),html=fs.readFileSync("index.html","utf8");
function setup(overrides={}){
 const urls=[],body=[],store=new Map();
 const fetch=async(url,opts={})=>{
  const text=String(url);urls.push(text);
  if(text==="https://graphql.anilist.co"){
   const data=JSON.parse(opts.body);body.push(data);
   const page=data.variables.page;
   const records=Array.from({length:25},(_,i)=>({
    id:(page-1)*25+i+1,idMal:(page-1)*25+i+1000,
    title:{english:"Anime Story "+((page-1)*25+i+1)},
    startDate:{year:2020+Math.floor(i/6),month:3,day:5},
    coverImage:{large:"https://cdn.example/anime/"+(i+1)+".jpg"},
    genres:["Adventure"],description:"An animated adventure",averageScore:86,
    episodes:12
   }));
   return{ok:true,json:async()=>({data:{Page:{pageInfo:{hasNextPage:page<8},media:records}}})};
  }
  if(text.startsWith("https://v3-cinemeta.strem.io/catalog/")){
   const kind=text.includes("/series/")?"series":"movie",start=text.includes("/skip=100")?100:0;
   const metas=Array.from({length:10},(_,i)=>({
    id:"tt"+String(start+i+(kind==="series"?500:1)).padStart(7,"0"),
    name:(kind==="series"?"Show ":"Film ")+(start+i),
    releaseInfo:"2024",poster:"https://images.example/"+kind+"/"+i+".jpg",
    description:"A fictional test fixture",genres:["Action"]
   }));
   return{ok:true,json:async()=>({metas})};
  }
  throw Error("Unexpected URL "+text);
 };
 const ctx={fetch:overrides.fetch||fetch,URL,AbortController,setTimeout,clearTimeout,console,localStorage:{
  getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))}};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 return {run:expr=>vm.runInContext(expr,ctx),urls,body,ctx};
}
test("public movie/TV/anime sources are loaded independently without requiring a paid TMDB key",async()=>{
 const h=setup(),result=await h.run("LumaCatalogPlus.seed()");
 assert.equal(result.filter(v=>v.type==="Anime").length,50);
 assert.equal(result.filter(v=>v.type==="Movie").length,10);
 assert.equal(result.filter(v=>v.type==="Series").length,10);
 assert.ok(result.every(v=>!v.url&&!v.stream));
 assert.ok(h.urls.some(s=>s.includes("catalog/movie/top.json")));
 assert.ok(h.urls.some(s=>s.includes("catalog/series/top.json")));
 assert.equal(h.urls.filter(s=>s==="https://graphql.anilist.co").length,2);
 assert.ok(h.body.every(x=>x.query.includes("isAdult:false")));
});
test("Anime and movies fetch further source-backed pages rather than reusing five cached shows",async()=>{
 const h=setup();await h.run("LumaCatalogPlus.seed()");
 const next=await h.run('LumaCatalogPlus.loadMore("Anime")');
 assert.equal(next.items.length,25);
 assert.equal(next.items[0].title,"Anime Story 51");
 const movie=await h.run('LumaCatalogPlus.loadMore("Movies")');
 assert.equal(movie.items.length,10);
 assert.ok(h.urls.some(x=>x.endsWith("/catalog/movie/top/skip=100.json")));
});
test("catalog search queries sources instead of filtering only what is cached",async()=>{
 const h=setup(),results=await h.run('LumaCatalogPlus.search("Anime","Cowboy")');
 assert.equal(results.length,25);
 const last=h.body[h.body.length-1];
 assert.equal(last.variables.search,"Cowboy");
 assert.ok(h.urls.every(u=>u==="https://graphql.anilist.co"));
});
test("unavailable source does not prevent a working anime provider from filling the screen",async()=>{
 const base=setup();
 const fetch=async (url,opts)=>{
  if(String(url).includes("v3-cinemeta"))throw Error("Cinemeta offline");
  return base.ctx.fetch(url,opts);
 };
 // A direct fetch failure is isolated with allSettled, never invented as metadata.
 const h=setup({fetch:async(url,opts)=>{
  if(String(url).includes("v3-cinemeta"))throw Error("Cinemeta offline");
  const request=JSON.parse(opts.body),page=request.variables.page;
  return{ok:true,json:async()=>({data:{Page:{pageInfo:{hasNextPage:true},
   media:Array.from({length:25},(_,i)=>({
    id:(page-1)*25+i+1,title:{romaji:"Anime "+((page-1)*25+i+1)},
    startDate:{year:2023},coverImage:{large:"https://images.example/a.png"}
   }))}}})};
 }});
 const result=await h.run('LumaCatalogPlus.seed()');
 assert.equal(result.filter(x=>x.type==="Anime").length,50);
 assert.equal(result.filter(x=>x.type==="Movie").length,0);
});
test("expanded library is actually included in Luma startup, search, pagination and offline cache",()=>{
 assert.match(html,/src="\.\/catalog-plus\.js"/);
 assert.match(app,/LumaCatalogPlus\.seed\(\)/);
 assert.match(app,/LumaCatalogPlus\.loadMore\(state\.tab\)/);
 assert.match(app,/LumaCatalogPlus\.search\(section,text\)/);
 assert.match(app,/MAX_CATALOG_TITLES=12000/);
 assert.match(html,/catalog-plus\.js/);
});
