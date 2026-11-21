"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const code=fs.readFileSync("luma-home.js","utf8");
const app=fs.readFileSync("app.js","utf8"),html=fs.readFileSync("index.html","utf8");
const iso=delta=>new Date(Date.now()+delta*86400000).toISOString().slice(0,10);
function harness(options={}){
 const storage=new Map(),calls=[],buttons=options.buttons||[];
 const state={tab:"Home",showHomeExtras:true},window={addEventListener(){},LumaRender(){}};
 const document={querySelector:()=>null,querySelectorAll:selector=>
  !selector?buttons:buttons.filter(b=>selector.includes("data-weather-range")?!!b.dataset.weatherRange:
   selector.includes("data-home-channel")?!!b.dataset.homeChannel:
   selector.includes("data-home-recording")?!!b.dataset.homeRecording:
   selector.includes("data-home-premiere-day")?!!b.dataset.homePremiereDay:false)};
 const ctx={URL,URLSearchParams,Date,Math,JSON,console,setTimeout,clearTimeout,AbortController,
  state,document,window,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
  LumaReleases:{inTheaters:()=>[]},
  fetch:options.fetch||(async url=>{calls.push(String(url));return {ok:true,json:async()=>({articles:[]})};})};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,calls,storage,run:expr=>vm.runInContext(expr,ctx)};
}
test("home includes the requested practical sections and Reno local headlines",()=>{
 const h=harness();
 const today=iso(-2),tomorrow=iso(1);
 const model={items:[{id:"newmovie",title:"Verified new movie",type:"Movie",date:today,source:"tmdb"},
  {id:"newshow",title:"New series",type:"Series",date:today,source:"tvmaze"}],
  watching:[{id:"resume1",title:"Saved episode",type:"Series"}],
  watchingProgress:[{id:"resume1",label:"S2E3",fraction:.52,seconds:1400}],
  followedRows:[{id:"ep2",showId:199,title:"Returning Show",season:3,number:1,episode:"Back Again",airdate:tomorrow,timeLabel:"9 PM"}],
  calendarRows:[{id:"ep1",title:"Premiere Show",season:1,number:1,episode:"Pilot",airdate:tomorrow,timeLabel:"8 PM",channel:"Network"}],
  dvrJobs:[{id:"job1",title:"Recorded Film",status:"complete",start:Date.now()-10000}],deviceJobs:[]};
 h.ctx.payload=model;
 const output=h.run("LumaHome.markup(payload,(name,items)=>'<section>'+name+': '+items.map(x=>x.title).join(', ')+'</section>')");
 for(const name of ["Continue Watching","Up Next","Premiere Radar","DVR Recordings","Fresh Movies","New TV Shows","Local News","News & Headlines"])
  assert.ok(output.includes(name),"Missing "+name);
 assert.match(output,/data-home-recording="job1"/);
 assert.match(output,/Premiere Show/);
 assert.match(output,/Fresh Movies: (?:1|Verified new movie)/);
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
test("Premiere Radar includes confirmed series and season premieres, not ordinary episodes",()=>{
 const h=harness();
 h.ctx.rows=[{id:"first",title:"Series 1",season:1,number:1,airdate:iso(2)},
  {id:"second",title:"Series 2",season:1,number:2,airdate:iso(2)},
  {id:"returning",title:"Season 3",season:4,number:1,airdate:iso(3)},
  {id:"old",title:"Series 3",season:1,number:1,airdate:iso(-80)}];
 const results=h.run("LumaHome.premiereRows(rows)");
 assert.deepEqual(Array.from(results.map(x=>x.title)),["Series 1","Season 3"]);
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
 assert.match(html,/src="\.\/luma-home\.js(?:\?v=[^"]+)?"/);
 assert.match(html,/href="\.\/luma-premium\.css"/);
 assert.match(app,/LumaHome\.markup\(homepageModel,shelf\)/);
 assert.match(app,/LumaHome\.bind\(\)/);
 assert.match(app,/LumaHome\.prime\(\)/);
 assert.match(html,/LumaHome\.markup/);
});

test("opening Home also initializes real IPTV guide/recorder data for its DVR cards",()=>{
 assert.match(app,/LumaIPTV\.loadForCalendar\(\)/);
 assert.match(app,/if\(state\.tab==="Home"\)render\(\)/);
});


test("live local TV row chooses real city-labelled stations and ignores national news channels",()=>{
 const h=harness();
 h.ctx.lineup=[
  {id:"cbs",name:"KTVN News 2",url:"http://my-iptv.example/live/2",group:"US"},
  {id:"abc",name:"ABC KOLO 8 Reno",url:"https://my-iptv.example/live/8",group:"Nevada local"},
  {id:"nbc",name:"KRNV NBC HD",url:"https://my-iptv.example/live/4",group:"USA"},
  {id:"national",name:"CBS News 24/7",url:"https://my-iptv.example/live/99",group:"US News"},
  {id:"othercity",name:"CBS San Francisco",url:"https://my-iptv.example/live/5",group:"California"},
  {id:"invalid",name:"KOLO ABC Reno",url:"javascript:alert(1)",group:"Local"}
 ];
 const matched=h.run('LumaHome.localStations(lineup,"Reno, NV")');
 assert.deepEqual(Array.from(matched.map(x=>x.id).sort()),["abc","cbs","nbc"]);
 h.ctx.other=[{id:"denver",name:"Denver NBC local news",group:"Colorado",url:"https://example.com/tv"}];
 assert.equal(h.run('LumaHome.localStations(other,"Denver, CO").length'),1);
 assert.equal(h.run('LumaHome.localStations(other,"Reno, NV").length'),0);
});
test("weather provides real hourly/daily model data with honest 30-day limits",async()=>{
 const days=Array.from({length:16},(_,i)=>iso(i));
 const response={
  current:{time:days[0]+"T10:00",temperature_2m:47,apparent_temperature:41,
   relative_humidity_2m:55,wind_speed_10m:9,weather_code:2},
  hourly:{time:[days[0]+"T10:00",days[0]+"T11:00"],temperature_2m:[47,50],
   precipitation_probability:[5,10],weather_code:[2,2]},
  daily:{time:days,weather_code:Array(16).fill(2),temperature_2m_max:Array(16).fill(61),
   temperature_2m_min:Array(16).fill(36),precipitation_probability_max:Array(16).fill(20),
   uv_index_max:Array(16).fill(3),wind_speed_10m_max:Array(16).fill(13),
   sunrise:Array(16).fill(days[0]+"T07:00"),sunset:Array(16).fill(days[0]+"T16:50")}
 };
 const buttons=[{dataset:{weatherRange:"30"},onclick:null}];
 const urls=[],h=harness({buttons,fetch:async url=>{
  urls.push(String(url));
  return {ok:true,json:async()=>String(url).includes("geocoding-api.open-meteo.com")
   ?{results:[{name:"Reno",admin1:"Nevada",latitude:39.53,longitude:-119.81}]}
   :response};
 }});
 await h.run("LumaHome.primeWeather(true)");
 assert.equal(h.run("LumaHome.getWeather().city"),"Reno, NV");
 assert.equal(h.run("LumaHome.weatherDays(LumaHome.getWeather().data).length"),16);
 assert.ok(urls.some(x=>x.includes("forecast_days=16")));
 let html=h.run("LumaHome.weatherMarkup()");
 for(const label of ["Today","7 days","14 days","Month","Feels like","Sunrise / sunset"])
  assert.ok(html.includes(label),"Missing weather detail: "+label);
 h.run('LumaHome.chooseWeatherRange("30")');
 html=h.run("LumaHome.weatherMarkup()");
 assert.match(html,/30-day planning calendar/);
 assert.match(html,/Forecast pending/);
 assert.doesNotMatch(html,/NaN|undefined°/);
});
test("Home avoids duplicate catalog sections and supports D-pad poster scrolling",()=>{
 const tv=fs.readFileSync("tv.js","utf8");
 assert.match(app,/content='<div class="lumaHomePage">'/);
 assert.match(tv,/function moveWithinRail/);
 assert.match(tv,/cards\[next\]\.scrollIntoView/);
 assert.match(html,/function moveWithinRail/);
 assert.match(html,/content='<div class="lumaHomePage">'/);
 const start=app.indexOf('content=\'<div class="lumaHomePage">\'');
 assert.ok(start>0);
 const end=app.indexOf('}else content=shelf(',start);
 assert.ok(end>start);
 assert.doesNotMatch(app.slice(start,end),/LumaCalendar\.homeMarkup|LumaReleases\.homepage|homeDiscoveryRows/);
});

test("Home prioritizes verified premieres from followed series and keeps unknown air dates off cards",()=>{
 const h=harness(),today=new Date(),isoLocal=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
 const future=new Date(today.getFullYear(),today.getMonth(),today.getDate()+5),when=isoLocal(future);
 h.ctx.general=[{id:"r1",showId:22,title:"Return of Series",season:3,number:1,airdate:when},
  {id:"r2",showId:33,title:"No Date",season:2,number:1,airdate:""}];
 h.ctx.follow=[{id:"r1",showId:22,title:"Return of Series",season:3,number:1,airdate:when},
  {id:"up1",showId:44,title:"Followed Drama",season:2,number:4,airdate:when}];
 const rows=h.run("LumaHome.radarRows(general,follow)");
 assert.equal(rows.length,2);
 assert.equal(rows[0].kind,undefined); // kind is assigned in presentation, not source metadata
 assert.equal(h.run('LumaHome.premiereKind(general[0])'),"SEASON PREMIERE");
 assert.equal(h.run('LumaHome.premiereKind(follow[1])'),"NEW EPISODE");
 assert.equal(h.run('LumaHome.dayDistance('+JSON.stringify(when)+')'),5);
 const markup=h.run("LumaHome.markup({items:[],watching:[],calendarRows:general,followedRows:follow},()=>\"\")");
 assert.match(markup,/Premiere Radar/);
 assert.match(markup,/SEASON PREMIERE/);
 assert.match(markup,/NEW EPISODE/);
 assert.match(markup,/data-premiere-day=/);
 assert.doesNotMatch(markup,/No Date/);
});
test("Home's premiere cards open the exact airing week, not merely today's Calendar",()=>{
 const day="2026-12-02",selected=[],button={dataset:{homePremiereDay:day},onclick:null};
 const h=harness({buttons:[button]});
 h.ctx.LumaCalendar={navigateToDay:date=>selected.push(date)};
 h.run("LumaHome.bind()");
 assert.equal(typeof button.onclick,"function");
 button.onclick();assert.deepEqual(selected,[day]);
});
test("Home hides unsupported empty entertainment rails and keeps iPhone shortcuts horizontal",()=>{
 const h=harness();
 const html=h.run('LumaHome.markup({items:[],watching:[],calendarRows:[],watchlist:[],favorites:[],recommendations:[],dvrJobs:[],deviceJobs:[]},()=>\"\")');
 assert.match(html,/lumaHomeQuick/);
 assert.doesNotMatch(html,/lumaHomePremiereRail|lumaHomeResume|lumaHomeDvrRail/);
 assert.doesNotMatch(html,/No DVR recordings yet|No confirmed series premieres/);
 const css=fs.readFileSync("luma-premium.css","utf8");
 assert.match(css,/\.lumaHomeAtelier \.lumaHomeQuick\{display:flex/);
 assert.match(css,/\.lumaHomeResume\{/);
 assert.match(css,/\.lumaHomeRadar\{/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/prefers-reduced-motion/);
});
