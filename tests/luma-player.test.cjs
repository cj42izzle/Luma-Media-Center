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
