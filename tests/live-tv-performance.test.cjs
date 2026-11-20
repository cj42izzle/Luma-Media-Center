"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const iptv=fs.readFileSync("iptv.js","utf8"),portal=fs.readFileSync("iptv-portal.js","utf8");
const html=fs.readFileSync("index.html","utf8"),player=fs.readFileSync("luma-player.js","utf8");
function createContext(saved={},options={}){
 const map=new Map([["luma.iptv.v1",JSON.stringify(saved)]]),nativeCalls=[];
 const context={URL,URLSearchParams,Date,Math,JSON,AbortController,setTimeout,clearTimeout,
  localStorage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v))},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},location:{protocol:"https:"},
  window:options.window||{},
  LumaPlayer:{open:opts=>{nativeCalls.push(opts);return true}}};
 vm.createContext(context);
 const exposed=iptv.replace("return {render,addProvider","return {__test:{channelQueue,selectChannel},render,addProvider");
 assert.notEqual(exposed,iptv,"Could not expose private helpers in test sandbox");
 vm.runInContext(exposed,context);
 return {context,nativeCalls,run:code=>vm.runInContext(code,context)};
}
test("saved programme restoration scales to 12k entries without channel-by-channel searches",async()=>{
 const now=Date.now();
 const channels=Array.from({length:1200},(_,i)=>({id:"ch"+i,name:"Station "+i,
  url:"http://media.example/"+i+".ts",provider_id:"imported"}));
 const programs=Array.from({length:12000},(_,i)=>({id:"p"+i,channel_id:"ch"+(i%1200),
  title:"Show "+i,start:now-60000,end:now+3600000}));
 const x=createContext({importedChannels:channels,importedPrograms:programs});
 const began=Date.now();
 await x.run("LumaIPTV.loadGuide()");
 assert.equal(x.run("LumaIPTV.channels().length"),1200);
 assert.equal(x.run("LumaIPTV.programs().length"),12000);
 assert.ok(Date.now()-began<4000,"Restoring saved guide should not cause prolonged UI freezes");
 assert.match(iptv,/presentChannelIds\.has\(p\.channel_id\)/);
});
test("simultaneous native and view refreshes share one provider fetch",async()=>{
 let calls=0;
 const x=createContext({browserSources:[{id:"test",type:"m3u",name:"Demo",
  m3u_url:"http://iptv.example/list.m3u",connection_mode:"native-direct"}]},
 {window:{LumaNativeIPTV:{fetchText:async()=>{calls++;
   await new Promise(r=>setTimeout(r,20));
   return '#EXTM3U\n#EXTINF:-1,Sample Channel\nhttp://media.example/ch1.ts';}}}});
 await Promise.all([x.run("LumaIPTV.loadGuide()"),x.run("LumaIPTV.loadGuide()")]);
 assert.equal(calls,1);
 assert.equal(x.run("LumaIPTV.channels().length"),1);
});
test("Watch Live on Shield launches native immediately with correctly indexed queue",async()=>{
 const channels=[{id:"a",provider_id:"imported",name:"First",url:"http://media.example/1.ts"},
  {id:"invalid",provider_id:"imported",name:"Broken URL",url:"javascript:doBadThing()"},
  {id:"b",provider_id:"imported",name:"Third",url:"http://media.example/3.ts"}];
 const x=createContext({importedChannels:channels},{window:{LumaNativeIPTV:{fetchText:async()=>""},
  LumaNativePlayer:{play(){}}}});
 await x.run("LumaIPTV.loadGuide()");
 const queue=x.run("LumaIPTV.__test.channelQueue(LumaIPTV.channels()[2])");
 assert.equal(queue.queue.length,2);
 assert.equal(queue.queue[queue.index].url,"http://media.example/3.ts");
 x.run("LumaIPTV.__test.selectChannel('b')");
 assert.equal(x.nativeCalls.length,1);
 assert.equal(x.nativeCalls[0].nativeOnly,true);
 assert.equal(x.nativeCalls[0].queue[x.nativeCalls[0].queueIndex].url,x.nativeCalls[0].url);
 assert.match(player,/if\(options\.nativeOnly\)return false/);
 assert.match(player,/playWithSkips\(window\.LumaDvrToken,src,title/);
});
test("TV home bounds heavy episode dedup and preserves channel cards",()=>{
 let processed=0;
 const context={Date,Math,JSON,URL,URLSearchParams,
  LumaIPTV:{episodeSignature:()=>{processed++;return "episode:a"}},
  LumaIPTVPortal:null};
 vm.createContext(context);vm.runInContext(portal,context);
 const now=Date.now(),channels=Array.from({length:600},(_,i)=>({id:"c"+i,provider_id:"p",
  provider:"IPTV",name:"Station "+i,url:"https://media.example/"+i+".m3u8"}));
 const programs=Array.from({length:18000},(_,i)=>({id:"p"+i,
   channel_id:"c"+(i%600),title:"Programme "+(i%390),
   start:i<12000?now-100000:now+60000+(i%40)*120000,
   end:i<12000?now+3600000:now+3600000+(i%40)*120000}));
 context.channels=channels;context.programs=programs;
 const began=Date.now();
 const content=vm.runInContext('LumaIPTVPortal.homeHTML({channels,programs,favorites:["c20"]})',context);
 assert.ok(content.includes("Watch live"));
 assert.ok(content.includes("TV guide"));
 assert.ok(processed<=480,"Only bounded visible programme candidates should be deduplicated");
 assert.ok(Date.now()-began<4000,"Opening Live TV should avoid full-feed expensive ranking");
});
test("production page embeds the optimized Live TV source",()=>{
 assert.ok(html.includes(iptv.trim()));
 assert.match(iptv,/refreshInFlight/);
 assert.match(iptv,/nativeOnly:true/);
});
