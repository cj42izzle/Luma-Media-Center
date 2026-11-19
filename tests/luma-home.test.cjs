"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const code=fs.readFileSync("luma-home.js","utf8");
const app=fs.readFileSync("app.js","utf8"),html=fs.readFileSync("index.html","utf8");
const iso=delta=>new Date(Date.now()+delta*86400000).toISOString().slice(0,10);
function harness(options={}){
 const storage=new Map(),calls=[],buttons=options.buttons||[];
 const state={tab:"Home"},window={addEventListener(){},LumaRender(){}};
 const document={querySelector:()=>null,querySelectorAll:()=>buttons};
 const ctx={URL,URLSearchParams,Date,Math,JSON,console,setTimeout,clearTimeout,AbortController,
  state,document,window,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
  LumaReleases:{inTheaters:()=>[]},
  fetch:options.fetch||(async url=>{calls.push(String(url));return {ok:true,json:async()=>({articles:[]})})};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,calls,storage,run:expr=>vm.runInContext(expr,ctx)};
}
test("home includes the requested practical sections and Reno local headlines",()=>{
 const h=harness();
 const today=iso(-2),tomorrow=iso(1);
 const model={items:[{id:"newmovie",title:"Verified new movie",type:"Movie",date:today,source:"tmdb"},
  {id:"newshow",title:"New series",type:"Series",date:today,source:"tvmaze"}],
  watching:[{id:"resume1",title:"Saved episode",type:"Series"}],
  calendarRows:[{id:"ep1",title:"Premiere Show",season:1,number:1,episode:"Pilot",airdate:tomorrow,timeLabel:"8 PM",channel:"Network"}],
  dvrJobs:[{id:"job1",title:"Recorded Film",status:"complete",start:Date.now()-10000}],deviceJobs:[]};
 h.ctx.payload=model;
 const output=h.run("LumaHome.markup(payload,(name,items)=>'<section>'+name+': '+items.length+'</section>')");
 for(const name of ["Resume Watching","DVR Recordings","New Movies","New TV Shows","New TV Shows Premiering","Local News","News & Headlines"])
  assert.ok(output.includes(name),"Missing "+name);
 assert.match(output,/data-home-recording="job1"/);
 assert.match(output,/Premiere Show/);
 assert.match(output,/Verified new movie/);
 assert.match(output,/id="lumaNewsCityForm"/);
 assert.match(output,/KTVN/);
 assert.match(output,/data-go="Guide"/);
});
test("release rows only label titles new when a real recent date exists",()=>{
 const h=harness(),today=iso(-4),longAgo=iso(-1000);
 h.ctx.rows=[{id:"valid",title:"A",date:today,type:"Movie",source:"tmdb"},
  {id:"old",title:"B",date:longAgo,type:"Movie",source:"tmdb"},
  {id:"yearonly",title:"C",date:today.slice(0,4)+"-01-01",type:"Movie",source:"cinemeta"},
  {id:"undated",title:"D",date:"",type:"Movie",source:"tvmaze"}];
 const result=h.run('LumaHome.newTitles(rows,"Movie",90)');
 assert.deepEqual(Array.from(result.map(x=>x.id)),["valid"]);
});
test("premiere row requires an S01E01 with a confirmed current/future air date",()=>{
 const h=harness();
 h.ctx.rows=[{id:"first",title:"Series 1",season:1,number:1,airdate:iso(2)},
  {id:"second",title:"Series 2",season:1,number:2,airdate:iso(2)},
  {id:"old",title:"Series 3",season:1,number:1,airdate:iso(-80)}];
 const results=h.run("LumaHome.premiereRows(rows)");
 assert.deepEqual(Array.from(results.map(x=>x.title)),["Series 1"]);
});
test("news headlines reject unsafe URLs, dedupe articles, and escape titles",()=>{
 const h=harness(),stamp=new Date().toISOString().replace(/[-:T.Z]/g,"").slice(0,14);
 h.ctx.payload={articles:[
  {title:"Local <script>attack</script> headlines",url:"https://publisher.example/story",seendate:stamp,domain:"Local News"},
  {title:"Another headline",url:"https://publisher.example/story",seendate:stamp,domain:"Local News"},
  {title:"Dangerous JavaScript",url:"javascript:alert(1)",seendate:stamp,domain:"Unknown"}]};
 const stories=h.run("LumaHome.parseArticles(payload)");
 assert.equal(stories.length,1);
 assert.equal(stories[0].source,"Local News");
 assert.equal(stories[0].url,"https://publisher.example/story");
});
test("headline API is queried via supported GDELT cross-origin JSON and preserves a local city",async()=>{
 const stamp=new Date().toISOString().replace(/[-:T.Z]/g,"").slice(0,14);
 const h=harness({fetch:async url=>({ok:true,json:async()=>({articles:[
  {title:"Verified current public headline",url:"https://example.com/news",seendate:stamp,domain:"Publisher"}
 ]})})});
 await h.run("LumaHome.prime(true)");
 const items=h.run("LumaHome.getNews()");
 assert.equal(items.local.length,1);
 assert.equal(items.national.length,1);
 assert.equal(items.city,"Reno, NV");
});
test("home's recording action opens the real DVR stream or device recording, never fake media",()=>{
 const records=[],h=harness({buttons:[{dataset:{homeRecording:"123",homeRecSource:"server"},onclick:null}]});
 h.ctx.LumaIPTV={watchRecording:id=>records.push(id)};
 h.run("LumaHome.bind()");
 const button=h.ctx.document.querySelectorAll()[0];
 assert.equal(typeof button.onclick,"function");
 button.onclick();
 assert.deepEqual(records,["123"]);
});
test("live standalone Luma includes Home styling, news integration and real DVR API",()=>{
 assert.match(html,/src="\.\/luma-home\.js"/);
 assert.match(html,/href="\.\/luma-premium\.css"/);
 assert.match(app,/LumaHome\.markup\(homepageModel,shelf\)/);
 assert.match(app,/LumaHome\.bind\(\)/);
 assert.match(app,/LumaHome\.prime\(\)/);
 assert.match(html,/LumaHome\.markup/);
});
