"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const calendar=fs.readFileSync("calendar.js","utf8");
const html=fs.readFileSync("index.html","utf8");

function setup({scope,watch=[],progress={},watched=[]}={}){
 const settings=new Map([["luma.epcalendar.scope",scope]]);
 const state={items:[
  {id:"series:one",mazeId:101,title:"One Series",type:"Series"},
  {id:"series:two",mazeId:202,title:"Other Series",type:"Series"}],
  library:[],watch,watched,progress,tab:"Calendar"};
 const sandbox={state,Date,Intl,setTimeout,clearTimeout,
  localStorage:{getItem:k=>settings.get(k)||null,setItem:(k,v)=>settings.set(k,String(v))},
  LumaAccounts:{getSource:()=> "device",chosenItems:()=>[]},
  safe:s=>String(s??"")};
 vm.createContext(sandbox);
 vm.runInContext(calendar,sandbox);
 return {eval:expression=>vm.runInContext(expression,sandbox),sandbox};
}
test("all airing remains visible when just one series is on a watchlist",()=>{
 const x=setup({watch:["series:one"]});
 assert.equal(x.eval("LumaCalendar.scopeMode()"),"all");
 const n=x.eval("LumaCalendar.__test.relevant([{showId:101},{showId:202}]).length");
 assert.equal(n,2);
});
test("watchlist filter can explicitly isolate followed shows",()=>{
 const x=setup({scope:"watchlist",watch:["series:one"]});
 assert.equal(x.eval("LumaCalendar.scopeMode()"),"watchlist");
 assert.equal(x.eval("LumaCalendar.__test.relevant([{showId:101},{showId:202}]).length"),1);
});
test("shows I watch uses watch progress rather than watchlist alone",()=>{
 const x=setup({scope:"watching",watch:["series:one"],progress:{"series:two:s01e02":{fraction:.4}}});
 assert.equal(x.eval("LumaCalendar.scopeMode()"),"watching");
 assert.equal(x.eval("LumaCalendar.__test.relevant([{showId:101},{showId:202}])[0].showId"),202);
});
test("calendar and main home include navigation for all three views",()=>{
 assert.match(calendar,/data-cal-scope="all"/);
 assert.match(calendar,/data-cal-scope="watchlist"/);
 assert.match(calendar,/data-cal-scope="watching"/);
 assert.match(html,/LumaCalendar\.start\(\)/);
 assert.match(fs.readFileSync("luma-home.js","utf8"),/jump\("Calendar"/);
});

test("new, series premiere and season premiere use actual season/episode numbers",()=>{
 const x=setup();
 assert.equal(x.eval('LumaCalendar.__test.premiereLabel({season:1,number:1})'),'SERIES PREMIERE');
 assert.equal(x.eval('LumaCalendar.__test.premiereLabel({season:4,number:1})'),'SEASON PREMIERE');
 assert.equal(x.eval('LumaCalendar.__test.premiereLabel({season:4,number:2})'),'');
 assert.match(calendar,/calNewBadge/);
 assert.match(calendar,/calPremiereBadge/);
});
test("following a show missing from general schedules loads its own verified episode dates",async()=>{
 const x=setup({watch:["series:one"]});
 const day=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 let calls=0;
 x.sandbox.api=async url=>{
  if(url.includes("/shows/101/episodes")){
   calls++;
   return [{id:98811,season:1,number:1,airdate:day,airtime:"21:00",airstamp:day+"T21:00:00Z",name:"Pilot"}];
  }
  return [];
 };
 await x.eval("LumaCalendar.__test.loadFollowingEpisodes()");
 assert.equal(calls,1);
 assert.equal(x.eval('LumaCalendar.getRows().some(e=>e.showId===101&&e.season===1&&e.number===1)'),true);
 assert.equal(x.eval('LumaCalendar.__test.relevant(LumaCalendar.getRows()).length'),1);
 assert.equal(x.eval('LumaCalendar.__test.followedItems().length'),1);
});
test("calendar keeps a show in the followed rail while its date is TBA",()=>{
 const x=setup({watch:["series:one"]});
 assert.equal(x.eval('LumaCalendar.__test.followedItems()[0].title'),"One Series");
 assert.match(calendar,/Schedule not announced/);
});

test('NEW is only displayed for recently aired or upcoming original episodes',()=>{
 const x=setup(),now=Date.parse('2026-11-21T12:00:00Z');
 assert.equal(x.eval('LumaCalendar.__test.isNewEpisode({airdate:"2025-08-02"},'+now+')'),false);
 assert.equal(x.eval('LumaCalendar.__test.isNewEpisode({airdate:"2026-11-20"},'+now+')'),true);
 assert.equal(x.eval('LumaCalendar.__test.isNewEpisode({airdate:"2026-12-01"},'+now+')'),true);
 assert.equal(x.eval('LumaCalendar.__test.isNewEpisode({airdate:"2026-11-20",isRerun:true},'+now+')'),false);
 assert.match(calendar,/data-followed-day/);
 assert.match(calendar,/Upcoming episodes from your watchlist/);
});

test("premiere countdowns use local dates, including midnight and daylight-saving transitions",()=>{
 const x=setup();
 const days=(iso,year,month,day,hour=12,minute=0)=>
  x.eval("LumaCalendar.__test.daysUntilPremiere("+JSON.stringify(iso)+",new Date("+[year,month-1,day,hour,minute].join(",")+"))");
 assert.equal(days("2026-11-21",2026,11,20,23,59),1);
 assert.equal(days("2026-11-21",2026,11,21,0,1),0);
 assert.equal(days("2026-11-22",2026,11,21),1);
 assert.equal(days("2027-01-01",2026,12,31),1);
 assert.equal(days("2027-01-01",2027,1,2),-1);
 assert.equal(days("2026-03-08",2026,3,7,23,59),1);
 assert.equal(days("2026-03-08",2026,3,8,0,1),0);
 assert.equal(days("2026-11-01",2026,10,31,23,59),1);
 assert.equal(days("2026-11-01",2026,11,1,0,1),0);
 assert.equal(days("2026-02-30",2026,2,28),null);
 assert.equal(days("bad",2026,11,21),null);
});
test("countdown badges show clear Today, Tomorrow and day-count states without fabricated TBA dates",()=>{
 const x=setup();
 assert.equal(x.eval('LumaCalendar.__test.countdownDetails("2026-11-21",new Date(2026,10,21)).number'),"TODAY");
 assert.equal(x.eval('LumaCalendar.__test.countdownDetails("2026-11-22",new Date(2026,10,21)).unit'),"DAY LEFT");
 assert.equal(x.eval('LumaCalendar.__test.countdownDetails("2026-11-29",new Date(2026,10,21)).number'),"8");
 assert.equal(x.eval('LumaCalendar.__test.countdownDetails("2026-11-20",new Date(2026,10,21)).status'),"aired");
 assert.equal(x.eval('LumaCalendar.__test.countdownMarkup("")'),"");
 const date=new Date();date.setDate(date.getDate()+4);
 const iso=[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
 const badge=x.eval('LumaCalendar.__test.countdownMarkup('+JSON.stringify(iso)+')');
 assert.match(badge,/data-premiere-day=/);
 assert.match(badge,/aria-label="Premieres in 4 days"/);
 assert.match(badge,/DAYS LEFT/);
 assert.match(calendar,/visibilitychange/);
 assert.match(calendar,/addEventListener\("focus",tickCountdown\)/);
 assert.match(calendar,/setInterval\(tickCountdown,30000\)/);
});
test("calendar can move back and forward exactly one week, including across month boundaries",async()=>{
 const x=setup();
 const nodes=new Map(),node=s=>{
  if(!nodes.has(s))nodes.set(s,{innerHTML:"",value:"",textContent:"",onclick:null,onchange:null,focus(){},setAttribute(){}});
  return nodes.get(s);
 };
 x.sandbox.document={querySelector:node,querySelectorAll:()=>[],hidden:false,addEventListener(){}};
 x.sandbox.$=node;x.sandbox.$$=()=>[];
 x.sandbox.window={addEventListener(){}};
 x.sandbox.api=async()=>[];
 x.eval("LumaCalendar.render()");
 const before=x.eval("LumaCalendar.__test.getSelectedDay()");
 assert.match(node("#content").innerHTML,/id="calPreviousWeek"/);
 assert.match(node("#content").innerHTML,/id="calNextWeek"/);
 node("#calPreviousWeek").onclick();
 const previous=x.eval("LumaCalendar.__test.getSelectedDay()");
 const diff=(a,b)=>(Date.parse(a+"T12:00:00Z")-Date.parse(b+"T12:00:00Z"))/86400000;
 assert.equal(diff(previous,before),-7);
 assert.equal(x.eval("LumaCalendar.__test.getViewMode()"),"week");
 assert.match(node("#content").innerHTML,/class="calWeekStrip"/);
 node("#calNextWeek").onclick();
 assert.equal(x.eval("LumaCalendar.__test.getSelectedDay()"),before);
 await new Promise(resolve=>setImmediate(resolve));
});

test("Home can request source-backed followed episodes and jump to the exact announced week",()=>{
 const x=setup({watch:["series:one"]});
 x.sandbox.window={LumaRender(){}};
 assert.equal(x.eval('typeof LumaCalendar.upcomingFollowedRows'),"function");
 assert.equal(x.eval('typeof LumaCalendar.countdownMarkup'),"function");
 assert.equal(x.eval('LumaCalendar.navigateToDay("2026-12-12")'),true);
 assert.equal(x.eval('LumaCalendar.__test.getSelectedDay()'),"2026-12-12");
 assert.equal(x.eval('LumaCalendar.__test.getViewMode()'),"week");
 assert.equal(x.eval('LumaCalendar.navigateToDay("2026-02-30")'),false);
 assert.equal(x.eval('LumaCalendar.__test.getSelectedDay()'),"2026-12-12");
});

test("calendar uses exact episode numbers and exposes tuning during the upcoming and live window",()=>{
 const x=setup();
 assert.equal(x.eval('LumaCalendar.__test.matchesGuideEpisode({title:"The Show",season:2,number:4},{title:"The Show",episode:"S02E04"})'),true);
 assert.equal(x.eval('LumaCalendar.__test.matchesGuideEpisode({title:"The Show",season:2,number:4,episode:"Arrival"},{title:"The Show",episode:"S02E03",subtitle:"Arrival"})'),false);
 assert.equal(x.eval('LumaCalendar.__test.tuneableAiring({start:1800000,end:3600000},0)'),true);
 assert.equal(x.eval('LumaCalendar.__test.tuneableAiring({start:1800001,end:3600000},0)'),false);
 assert.equal(x.eval('LumaCalendar.__test.tuneableAiring({start:1800000,end:3600000},3600000)'),false);
});
