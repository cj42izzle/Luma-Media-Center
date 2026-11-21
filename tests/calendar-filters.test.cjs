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
