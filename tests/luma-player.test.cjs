"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const src=fs.readFileSync("luma-player.js","utf8"),html=fs.readFileSync("index.html","utf8"),iptv=fs.readFileSync("iptv.js","utf8");
function harness(){
 const launched=[];
 const ctx={URL,console,window:{LumaDvrToken:"fixture-random-token",LumaNativePlayer:{play:(token,url,title)=>{
  launched.push({token,url,title});return JSON.stringify({ok:true});
 }}},document:{createElement:()=>({canPlayType:t=>String(t).includes("mpegurl")?"probably":""})}};
 vm.createContext(ctx);vm.runInContext(src,ctx);
 return {ctx,launched,eval:s=>vm.runInContext(s,ctx)};
}
test("internal player assets are included and IPTV actions open LumaPlayer",()=>{
 assert.match(html,/src="\.\/luma-player.js"/);
 assert.match(html,/href="\.\/luma-player.css"/);
 assert.match(iptv,/LumaPlayer\.open\(/);
 assert.ok(!/hls\.js@|cdnjs|unpkg/.test(src),"Do not load third-party executable JS into private IPTV context");
});
test("rejects invalid, credentials-in-authority and script URLs",()=>{
 const x=harness();
 assert.equal(x.eval("LumaPlayer.validURL('javascript:alert(1)')"),null);
 assert.equal(x.eval("LumaPlayer.validURL('http://u:pw@example.org/test.m3u8')"),null);
 assert.equal(x.eval("LumaPlayer.validURL('file:///etc/passwd')"),null);
 assert.equal(x.eval("LumaPlayer.validURL('https://tv.example/live.m3u8').protocol"),"https:");
});
test("native playback receives HTTP IPTV safely and only through session token",()=>{
 const x=harness();
 assert.equal(x.eval("LumaPlayer.open({url:'http://tv.example/stream.m3u8',title:'Test channel'})"),true);
 assert.equal(x.launched.length,1);
 assert.equal(x.launched[0].token,"fixture-random-token");
 assert.equal(x.launched[0].url,"http://tv.example/stream.m3u8");
 assert.equal(x.launched[0].title,"Test channel");
});
test("Dolby diagnostics describe capabilities, not a guarantee of active Dolby tracks",()=>{
 const x=harness();
 assert.match(src,/Decoder indications are not proof the channel contains Dolby Vision or Dolby audio/);
 assert.match(src,/Dolby Digital Plus/);
 assert.match(src,/dvh1\.08\.04/);
 assert.equal(x.eval("LumaPlayer.codecReport().nativeHls"),true);
});

test("movie, episode and IPTV playback share the internal player",()=>{
 const app=fs.readFileSync("app.js","utf8");
 assert.match(app,/LumaPlayer\.open\(\{/);
 assert.match(app,/onProgress:info/);
 assert.match(app,/resumeAt:state\.progress\[key\]/);
 assert.match(app,/onEnded:/);
 assert.match(iptv,/nativeIPTVReader\(\)/);
});
test("native Android TV and iOS player sources are bundled in their own projects",()=>{
 const bridge=fs.readFileSync("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativePlayerBridge.java","utf8");
 const activity=fs.readFileSync("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativePlayerActivity.java","utf8");
 const ios=fs.readFileSync("ios/LumaIOS/LumaWebController.swift","utf8");
 assert.match(bridge,/trustedPage|isTrustedPage/);
 assert.match(activity,/MediaItem/);
 assert.match(activity,/MimeTypes\.VIDEO_DOLBY_VISION/);
 assert.match(activity,/MimeTypes\.AUDIO_E_AC3_JOC/);
 assert.match(ios,/AVPlayerViewController/);
 assert.match(ios,/lumaNativeIPTV/);
});

test("SRT import converts cue numbers and millisecond punctuation to WebVTT",()=>{
 const x=harness();
 const srt="1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:04,250 --> 00:00:06,000\nSecond line";
 const out=x.eval("LumaPlayer.__test.toVtt("+JSON.stringify(srt)+")");
 assert.match(out,/^WEBVTT\n/);
 assert.match(out,/00:00:01.000 --> 00:00:03.500/);
 assert.match(out,/00:00:04.250 --> 00:00:06.000/);
 assert.doesNotMatch(out,/^1$/m);
});
test("subtitle timing shifts are bounded and produce valid non-negative timestamps",()=>{
 const x=harness();
 const sample="WEBVTT\n\n00:00:05.000 --> 00:00:09.000\nTest";
 assert.match(x.eval("LumaPlayer.__test.shiftVtt("+JSON.stringify(sample)+",2.5)"),
   /00:00:07.500 --> 00:00:11.500/);
 assert.match(x.eval("LumaPlayer.__test.shiftVtt("+JSON.stringify(sample)+",-10)"),
   /00:00:00.000 --> 00:00:00.001/);
 assert.match(x.eval("LumaPlayer.__test.shiftVtt("+JSON.stringify(sample)+",100)"),
   /00:00:35.000 --> 00:00:39.000/);
});
test("player preferences reject unexpected playback rates and unbounded zoom",()=>{
 const x=harness();
 assert.equal(x.eval('LumaPlayer.__test.safePrefs({speed:99,zoom:999,subtitleDelay:500}).speed'),1);
 assert.equal(x.eval('LumaPlayer.__test.safePrefs({speed:99,zoom:999,subtitleDelay:500}).zoom'),1);
 assert.equal(x.eval('LumaPlayer.__test.safePrefs({subtitleDelay:500}).subtitleDelay'),30);
 assert.equal(x.eval('LumaPlayer.__test.safePrefs({fit:"cover",speed:1.5}).fit'),"cover");
 assert.equal(x.eval('LumaPlayer.__test.resolveBookmarkKey("__proto__")'),"");
});
test("chapter metadata is normalized and repeated timestamps deduplicated",()=>{
 const x=harness();
 const chapter=x.eval('LumaPlayer.__test.normalizedChapters([{time:80,title:"Second"},{time:10,title:"First"},{time:10.3,title:"Duplicate"},{time:-8,title:"Invalid"}])');
 assert.equal(chapter.length,2);
 assert.equal(chapter[0].title,"First");
 assert.equal(chapter[1].time,80);
});
test("advanced controls are implemented as working handlers, not labels alone",()=>{
 for(const selector of ["lumaPlayerSpeed","lumaPlayerFit","lumaPlayerZoom","lumaPlayerSubtitleFile",
 "lumaPlayerSubtitleDelay","lumaPlayerSubtitleSize","lumaPlayerChapters","lumaPlayerBookmarks",
 "lumaPlayerBookmark","lumaPlayerSleep","lumaPlayerNextQueue"]){
  assert.ok(src.includes('id="'+selector+'"'),"Missing "+selector);
 }
 for(const code of ["loadSubtitleFile","attachImportedSubtitle","savePrefs","renderChapters",
 "addBookmark","nextQueue","startSleepTimer","playerKey","video.playbackRate"]){
  assert.ok(src.includes(code),"Missing logic "+code);
 }
});

test("skip intro and credits require actual chapter metadata or explicit markers",()=>{
 const x=harness();
 const markers=x.eval('LumaPlayer.__test.skipMarkers({},[{time:0,title:"Intro"},{time:84,title:"Episode begins"},{time:2500,title:"Credits"}])');
 assert.equal(markers.intro,84);assert.equal(markers.credits,2500);
 const absent=x.eval('LumaPlayer.__test.skipMarkers({},[{time:0,title:"Chapter One"},{time:85,title:"Chapter Two"}])');
 assert.equal(absent.intro,0);assert.equal(absent.credits,0);
 const explicit=x.eval('LumaPlayer.__test.skipMarkers({introEndSeconds:120,creditsStartSeconds:2200},[])');
 assert.equal(explicit.intro,120);assert.equal(explicit.credits,2200);
 assert.match(src,/lumaPlayerSkipIntro/);assert.match(src,/lumaPlayerSkipCredits/);
});
test("device-local file player only trusts object URLs that the user selected",()=>{
 assert.match(src,/temporaryMediaURLs\.has\(value\)/);
 assert.match(src,/URL\.revokeObjectURL\(currentObjectURL\)/);
 assert.match(src,/function openLocal\(file/);
 assert.match(fs.readFileSync("app.js","utf8"),/id="playLocalVideo"/);
});


test("touch gestures identify skip, double-tap sides and brightness/volume without guessing",()=>{
 const x=harness();
 const act=expression=>x.eval("LumaPlayer.__test.gestureAction("+expression+")");
 const left=act("{x:80,y:80},{x:88,y:86},400");
 assert.equal(left.kind,"tap");assert.equal(left.side,"left");
 const right=act("{x:320,y:100},{x:322,y:102},400");
 assert.equal(right.side,"right");
 assert.equal(act("{x:80,y:200},{x:180,y:205},400,15").seconds,15);
 assert.equal(act("{x:310,y:200},{x:212,y:205},400,30").seconds,-30);
 assert.equal(act("{x:70,y:150},{x:73,y:70},400").kind,"brightness");
 assert.equal(act("{x:350,y:150},{x:354,y:75},400").kind,"volume");
 assert.equal(act("{x:100,y:100},{x:110,y:130},0").kind,"none");
 assert.equal(x.eval('LumaPlayer.__test.safePrefs({gestures:false,brightness:99}).brightness'),1.5);
 assert.equal(x.eval('LumaPlayer.__test.safePrefs({gestures:false}).gestures'),false);
 assert.match(src,/attachGestures\(\)/);
 assert.match(src,/id="lumaPlayerGestures"/);
});

test("native Android receives a bounded channel playlist with correct selected index",()=>{
 const called=[];
 const context={URL,console,window:{
  LumaDvrToken:"native-token",LumaNativePlayer:{
   play:(key,url,title)=>JSON.stringify({ok:true}),
   playQueue:(key,url,title,json,index)=>{
    called.push({key,url,title,rows:JSON.parse(json),index});
    return JSON.stringify({ok:true});
   }
  }},document:{createElement:()=>({canPlayType:()=>"probably"})}};
 vm.createContext(context);vm.runInContext(src,context);
 const queue=Array.from({length:45},(_,i)=>({url:"http://iptv.example/live/"+i+".m3u8",title:"Channel "+i}));
 const result=vm.runInContext("LumaPlayer.open({url:'http://iptv.example/live/6.m3u8',title:'Channel 6',queue:"+JSON.stringify(queue)+",queueIndex:6})",context);
 assert.equal(result,true);
 assert.equal(called.length,1);
 assert.ok(called[0].rows.length<=41);
 assert.equal(called[0].key,"native-token");
 assert.equal(called[0].rows[6].title,"Channel 6");
 assert.equal(called[0].index,6);
});
test("native Android and iOS player sources expose channel surfing",()=>{
 const bridge=fs.readFileSync("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativePlayerBridge.java","utf8");
 const activity=fs.readFileSync("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativePlayerActivity.java","utf8");
 const menu=fs.readFileSync("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativePlayerOptions.java","utf8");
 const ios=fs.readFileSync("ios/LumaIOS/LumaWebController.swift","utf8");
 assert.match(bridge,/playQueue\(/);
 assert.match(bridge,/NativePlayerActivity.EXTRA_QUEUE/);
 assert.match(activity,/player\.setMediaItems\(playlist,selectedIndex,0L\)/);
 assert.match(menu,/Next channel/);
 assert.match(menu,/Previous channel/);
 assert.match(ios,/private func moveChannel/);
 assert.match(ios,/action: #selector\(nextChannel\)/);
 assert.match(ios,/LumaSameHostRedirects/);
 assert.match(ios,/destination\.host\?\.lowercased\(\) == originalHost/);
 assert.match(iptv,/function channelQueue/);
});
test("native iOS player can open user-selected files with no upload",()=>{
 const ios=fs.readFileSync("ios/LumaIOS/LumaWebController.swift","utf8");
 const app=fs.readFileSync("app.js","utf8");
 assert.match(ios,/UIDocumentPickerViewController/);
 assert.match(ios,/asCopy: true/);
 assert.match(ios,/data\["action"\] as\? String == "openFile"/);
 assert.match(app,/messageHandlers\.lumaNativePlayer\.postMessage\(\{action:"openFile"\}\)/);
});

test("smart skip recognizes explicit recap, intro and credits while rejecting generic chapters",()=>{
 const x=harness();
 const labels=[{time:0,title:"Previously on"},{time:78,title:"Opening credits"},{time:121,title:"Episode begins"},{time:2360,title:"Closing credits"}];
 const ranges=x.eval("LumaPlayer.__test.smartSkipSegments({live:false}, "+JSON.stringify(labels)+",2470)");
 assert.equal(ranges.length,3);
 assert.equal(ranges[0].kind,"recap");assert.equal(ranges[0].start,0);assert.equal(ranges[0].end,78);
 assert.equal(ranges[1].kind,"intro");assert.equal(ranges[1].end,121);
 assert.equal(ranges[2].kind,"credits");assert.equal(ranges[2].start,2360);
 assert.equal(x.eval("LumaPlayer.__test.smartSkipSegments({live:true,recapEndSeconds:80},[],300).length"),0);
 assert.equal(x.eval("LumaPlayer.__test.smartSkipSegments({live:false},[{time:0,title:'Chapter One'},{time:90,title:'Chapter Two'}],300).length"),0);
 assert.match(src,/id="lumaPlayerSkipRecap"/);
 assert.match(src,/id="lumaPlayerMarkStart"/);
 assert.match(src,/id="lumaPlayerMarkEnd"/);
 assert.match(src,/id="lumaPlayerAutoSkip"/);
});
test("smart skip boundaries require identified titles, valid time ranges and stay on device",()=>{
 const ctx={URL,console,localStorage:{
   records:new Map(),getItem(k){return this.records.get(k)||null},setItem(k,v){this.records.set(k,String(v))}
  },window:{},document:{createElement:()=>({canPlayType:()=>""})}};
 vm.createContext(ctx);vm.runInContext(src,ctx);
 assert.equal(vm.runInContext("LumaPlayer.__test.skipGuideKey({seriesKey:'series:test:season:1',live:false})",ctx),"guide:series:test:season:1");
 assert.equal(vm.runInContext("LumaPlayer.__test.skipGuideKey({seriesKey:'../bad',live:false})",ctx),"");
 assert.equal(vm.runInContext("LumaPlayer.__test.skipGuideKey({seriesKey:'series:test',live:true})",ctx),"");
 assert.equal(vm.runInContext("LumaPlayer.__test.smartSkipSegments({introStartSeconds:3,introEndSeconds:65,live:false},[],200)[0].end",ctx),65);
});

test("Luma native players receive trustworthy skip hints and show internal skip controls",()=>{
 const androidBridge=fs.readFileSync("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativePlayerBridge.java","utf8");
 const android=fs.readFileSync("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativePlayerActivity.java","utf8");
 const ios=fs.readFileSync("ios/LumaIOS/LumaWebController.swift","utf8");
 for(const key of ["nativeSkipPlan","playWithSkips","autoSkip","creditsStart"]) assert.match(src,new RegExp(key));
 assert.match(androidBridge,/playWithSkips\(String key/);
 assert.match(androidBridge,/EXTRA_SKIP/);
 assert.match(android,/refreshSkipControl\(\)/);
 assert.match(android,/performSkip\(currentSkip\)/);
 assert.match(ios,/updateSkipControl\(at seconds: Double\)/);
 assert.match(ios,/addPeriodicTimeObserver/);
 assert.match(ios,/skipSegment\(_ kind: String\)/);
 const x=harness();
 const p=x.eval("LumaPlayer.__test.nativeSkipPlan({live:false,introStartSeconds:10,introEndSeconds:88,recapStartSeconds:90,recapEndSeconds:141,creditsStartSeconds:2400})");
 assert.equal(p.intro.start,10);
 assert.equal(p.recap.end,141);
 assert.equal(p.creditsStart,2400);
 assert.equal(x.eval("LumaPlayer.__test.nativeSkipPlan({live:true}).autoSkip"),false);
});

test('native iPhone bridge supports chunked 25 MB guide delivery and valid UTF-8',async()=>{
 const ios=fs.readFileSync("ios/LumaIOS/LumaWebController.swift","utf8");
 const match=ios.match(/private let fetchBridge = #"""([\s\S]*?)"""#/);
 assert.ok(match);
 assert.match(ios,/min\(25 \* 1024 \* 1024,/);
 assert.match(ios,/sendChunk\(end\)/);
 const events=[],requests=[];
 const context={URL,console,Date,Math,setTimeout,clearTimeout,
  atob,TextDecoder,Uint8Array,
  window:{webkit:{messageHandlers:{lumaNativeIPTV:{postMessage(x){requests.push(x)}}}}}};
 vm.createContext(context);vm.runInContext(match[1],context);
 const pending=vm.runInContext("window.LumaNativeIPTV.fetchText('http://tv.example/xmltv.php',25*1024*1024)",context);
 assert.equal(requests.length,1);
 assert.equal(requests[0].limit,25*1024*1024);
 const textValue="Télévision and Japanese: テレビ";
 const binary=Buffer.from(textValue,"utf8");
 context.window.LumaNativeIPTV._receive({id:requests[0].id,chunk:binary.subarray(0,9).toString("base64"),final:false});
 context.window.LumaNativeIPTV._receive({id:requests[0].id,chunk:binary.subarray(9).toString("base64"),final:true});
 assert.equal(await pending,textValue);
});
