"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const file=path=>fs.readFileSync(path,"utf8");
const iptv=file("iptv.js"),html=file("index.html");
function harness(saved={}){
 const storage=new Map(Object.entries(saved).map(([key,value])=>[key,JSON.stringify(value)]));
 const events={},page={protocol:"https:",href:"https://cj42izzle.github.io/Luma-Media-Center/?tv=1&app=android"};
 const window={addEventListener:(name,callback)=>{events[name]=callback}};
 const context={URL,URLSearchParams,Math,Date,JSON,console,window,location:page,
   setTimeout,clearTimeout,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))}};
 vm.createContext(context);vm.runInContext(iptv,context);
 return {context,window,events,storage,eval:expr=>vm.runInContext(expr,context)};
}
test("Shield APK has its own launcher and native networking and explicitly refreshes the current site",()=>{
 const app=file("android-tv/app/src/main/java/io/github/cj42izzle/luma/TvActivity.java");
 const manifest=file("android-tv/app/src/main/AndroidManifest.xml");
 const build=file("android-tv/app/build.gradle");
 assert.match(manifest,/android.intent.category.LEANBACK_LAUNCHER/);
 assert.match(manifest,/android.permission.INTERNET/);
 assert.match(app,/WebSettings.LOAD_NO_CACHE/);
 assert.match(app,/luma-native-iptv-ready/);
 assert.match(app,/LumaNativeIPTVBridge/);
 assert.match(app,/window.LumaNativePlatform='android-tv'/);
 assert.match(build,/versionCode 6/);
 assert.match(html,/Install actual Android TV APK/);
 assert.match(html,/id="lumaAndroidBadge"/);
 assert.match(html,/id="lumaAndroidRefresh"/);
 assert.match(file("install.html"),/Luma-AndroidTV-Preview\.apk/);
});
test("native Android bridge queues simultaneous provider requests rather than dropping every request after three",()=>{
 const reader=file("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativeIPTVBridge.java");
 assert.match(reader,/new ThreadPoolExecutor\(/);
 assert.match(reader,/new LinkedBlockingQueue<>\(36\)/);
 assert.match(reader,/worker.execute\(/);
 assert.doesNotMatch(reader,/if\(!inFlight\.tryAcquire\(\)\)/);
});
test("browser-only and native platform messages remain universal",()=>{
 assert.doesNotMatch(file("iptv-portal.js"),/HTTP IPTV · iPhone mode/);
 assert.doesNotMatch(iptv,/Needs native iPhone app|Saved in Safari · Native connection required/);
 assert.match(iptv,/NVIDIA Shield/);
 assert.match(iptv,/Android TV/);
 assert.match(iptv,/iPhone/);
});
test("more than 9,000 live channels from a genuine provider feed are retained rather than silently clipped",()=>{
 const h=harness();
 const body="#EXTM3U\n"+Array.from({length:10020},(_,i)=>
  '#EXTINF:-1 tvg-id="ch'+i+'" group-title="Live TV",Live Channel '+i+'\nhttp://media.example/stream/'+i+'.ts').join("\n");
 h.context.fixture=body;
 const rows=h.eval("LumaIPTV.parseM3U(fixture)");
 assert.equal(rows.length,10020);
 assert.equal(rows[10019].epg_id,"ch10019");
 assert.match(iptv,/20,000-channel safety limit/);
});
test("saved HTTP IPTV source reloads when the installed Android native bridge becomes ready",async()=>{
 const saved={"luma.iptv.v1":{browserSources:[{id:"test:demo",type:"m3u",name:"Test IPTV",
  m3u_url:"http://media.example/playlist.m3u",connection_mode:"device-import"}]}};
 const h=harness(saved);
 assert.equal(h.eval("LumaIPTV.awaitingAndroidBridge()"),true);
 assert.equal(h.eval("LumaIPTV.nativeAvailable()"),false);
 assert.equal(typeof h.events["luma-native-iptv-ready"],"function");
 const playlist='#EXTM3U\n#EXTINF:-1 tvg-id="c1" group-title="News",First News\nhttp://media.example/channel1.ts\n'
  +'#EXTINF:-1 tvg-id="c2" group-title="Sports",Second Sports\nhttp://media.example/channel2.ts';
 let reads=0;
 h.window.LumaNativeIPTV={fetchText:async url=>{assert.equal(url,"http://media.example/playlist.m3u");reads++;return playlist}};
 h.events["luma-native-iptv-ready"]();
 for(let i=0;i<20&&h.eval("LumaIPTV.channels().length")===0;i++)
  await new Promise(resolve=>setTimeout(resolve,10));
 const rows=h.eval("LumaIPTV.channels()");
 assert.equal(rows.length,2);
 assert.equal(rows[0].provider,"Test IPTV");
 assert.equal(rows[1].group,"Sports");
 assert.equal(reads,1,"native bootstrap should avoid duplicate source fetches");
});
test("the standalone served app contains exact current IPTV module",()=>{
 assert.ok(html.includes(iptv.trim()));
});
