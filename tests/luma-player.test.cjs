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
