"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const script=fs.readFileSync("iptv.js","utf8"),html=fs.readFileSync("index.html","utf8"),css=fs.readFileSync("iptv-guide-v2.css","utf8");
function fakeDoc(source){
 const fixture=JSON.parse(source);
 const child=text=>({textContent:String(text),getAttribute:()=>null});
 const channel=c=>({getAttribute:key=>key==="id"?c.id:null,
  getElementsByTagName:key=>key==="display-name"?[child(c.name)]:[]});
 const programme=p=>({getAttribute:key=>p[key]??null,
  getElementsByTagName:key=>key==="title"?[child(p.title)]:[]});
 return {querySelector:()=>null,documentElement:{nodeName:"tv"},
  getElementsByTagName:key=>key==="channel"?fixture.channels.map(channel):
   key==="programme"?fixture.programs.map(programme):[]};
}
function xmlTime(ms){
 const d=new Date(ms),z=x=>String(x).padStart(2,"0");
 return d.getUTCFullYear()+z(d.getUTCMonth()+1)+z(d.getUTCDate())+
  z(d.getUTCHours())+z(d.getUTCMinutes())+z(d.getUTCSeconds())+" +0000";
}
function harness(saved={}){
 const storage=new Map([["luma.iptv.v1",JSON.stringify(saved)]]);
 const screen={innerHTML:""};
 const document={querySelector:q=>q==="#content"?screen:null,querySelectorAll:()=>[],activeElement:{id:""}};
 const context={URL,URLSearchParams,Math,JSON,Date,setTimeout,clearTimeout,
  document,DOMParser:class{parseFromString(source){return fakeDoc(source)}},
  location:{protocol:"https:"},localStorage:{
   getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))}};
 vm.createContext(context);vm.runInContext(script,context);
 return {context,screen,run:s=>vm.runInContext(s,context)};
}
test("Android TV guide allocates channel label width and keeps text visible",()=>{
 assert.match(css,/\[data-tv="true"\] \.iptvGuideHeader,\[data-tv="true"\] \.iptvGuideRow/);
 assert.match(css,/grid-template-columns:clamp\(270px,30%,340px\) minmax\(0,1fr\)!important/);
 assert.match(css,/\[data-tv="true"\] \.iptvChannelText strong\{display:block!important/);
 assert.match(css,/\[data-tv="true"\] \.iptvChannelText small\{display:block!important/);
});
test("M3U parser uses tvg-name when the display label is blank",()=>{
 const x=harness(),m3u='#EXTM3U\n#EXTINF:-1 tvg-name="Local News" tvg-id="news.tv",\nhttp://media.example/news.ts';
 const rows=x.run("LumaIPTV.parseM3U("+JSON.stringify(m3u)+")");
 assert.equal(rows.length,1);assert.equal(rows[0].name,"Local News");
});
test("all channel variants with the same XMLTV ID receive the exact programme",()=>{
 const x=harness(),now=Date.now();
 x.context.feed=JSON.stringify({channels:[{id:"NEWS.TV",name:"News Network"}],
  programs:[{channel:"NEWS.TV",start:xmlTime(now-600000),stop:xmlTime(now+3600000),title:"News at Six"}]});
 x.context.stations=[{id:"hd",name:"News Network HD",epg_id:"NEWS.TV",quality:1},
  {id:"4k",name:"News Network 4K",epg_id:"news.tv",quality:2}];
 const rows=x.run("LumaIPTV.parseGuide(feed,stations)");
 assert.equal(rows.length,2);
 assert.deepEqual([...rows.map(r=>r.channel_id)].sort(),["4k","hd"]);
});
test("quality-suffix fallback uses only unambiguous XMLTV display names",()=>{
 const x=harness(),now=Date.now();
 x.context.feed=JSON.stringify({channels:[{id:"guide.one",name:"Station One"}],
  programs:[{channel:"guide.one",start:xmlTime(now-600000),stop:xmlTime(now+3600000),title:"Morning News"}]});
 x.context.stations=[{id:"one",name:"Station One FHD",epg_id:"provider-unknown",quality:1}];
 assert.equal(x.run("LumaIPTV.parseGuide(feed,stations)").length,1);
 x.context.feed=JSON.stringify({channels:[{id:"a",name:"Station One"},{id:"b",name:"Station One HD"}],
  programs:[{channel:"a",start:xmlTime(now-600000),stop:xmlTime(now+3600000),title:"Different Source"}]});
 assert.equal(x.run("LumaIPTV.parseGuide(feed,stations)").length,0);
});
test("guide reports actual missing EPG coverage rather than fabricated programmes",async()=>{
 const x=harness({importedChannels:[
  {id:"1",provider_id:"file:local",name:"Real Channel One",url:"http://media.example/1.ts"},
  {id:"2",provider_id:"file:local",name:"Real Channel Two",url:"http://media.example/2.ts"}
 ]});
 await x.run("LumaIPTV.loadGuide()");
 x.run("LumaIPTV.render('guide')");
 assert.match(x.screen.innerHTML,/Guide listings: 0 of 2 displayed channels/);
 assert.match(x.screen.innerHTML,/EPG sources &amp; channel mapping/);
 assert.match(x.screen.innerHTML,/Real Channel One/);
 assert.match(x.screen.innerHTML,/Schedule unavailable/);
 assert.doesNotMatch(x.screen.innerHTML,/No guide · Tap EPG to assign/);
 assert.match(x.screen.innerHTML,/tabindex="-1" role="region"/);
});
test("Xtream guide fallback checks missing channels, not global programme count",()=>{
 assert.match(script,/const missingXtream=visible\.some/);
 assert.doesNotMatch(script,/programs\.length<channels\.length/);
 assert.match(script,/restored\?\.focus\?\./);
});
test("standalone page includes synchronized IPTV and TV navigation code",()=>{
 assert.ok(html.includes(script.trim()));
 assert.ok(html.includes(fs.readFileSync("tv.js","utf8").trim()));
 assert.match(html,/iptv-guide-v2\.css/);
});
