'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('iptv.js','utf8'),html=fs.readFileSync('index.html','utf8');
function setup(){
 const saved=new Map();
 const context={URL,Math,JSON,Date,console,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(script,context);
 return {context,eval:code=>vm.runInContext(code,context)};
}
test('the Live TV UI and main navigation are part of the served standalone site',()=>{
 assert.ok(html.includes(script.trim()),'Standalone HTML must include the current IPTV module');
 assert.match(html,/\["Live TV","▣"\]/);
 assert.match(html,/LumaIPTV\.render\(\)/);
 assert.match(html,/iptvGuidePager/);
 assert.match(html,/iptvRecordChannelNow/);
 assert.match(html,/iptvSeriesMode/);
});
test('M3U parser reads multiple channels with group and guide ID',()=>{
 const x=setup();
 const r=x.eval("LumaIPTV.parseM3U('#EXTM3U\\n#EXTINF:-1 tvg-id=\"ch1\" group-title=\"News\",Channel HD\\nhttps://media.example/ch1.m3u8\\n#EXTINF:-1 tvg-id=\"ch2\" group-title=\"Sports\",Channel 4K\\nhttps://media.example/ch2.m3u8')");
 assert.equal(r.length,2);
 assert.equal(r[0].epg_id,'ch1');
 assert.equal(r[0].group,'News');
 assert.equal(r[1].quality,2);
});
test('XMLTV timestamps convert timezone offsets and ignore malformed strings',()=>{
 const x=setup();
 assert.equal(x.eval("LumaIPTV.xmlTime('20261118160000 -0800')"),Date.UTC(2026,10,19,0,0,0));
 assert.equal(x.eval("LumaIPTV.xmlTime('20261118160000 +0200')"),Date.UTC(2026,10,18,14,0,0));
 assert.equal(x.eval("LumaIPTV.xmlTime('nonsense')"),0);
});
test('unsupported URLs do not become playable playlist entries',()=>{
 const x=setup();
 const r=x.eval("LumaIPTV.parseM3U('#EXTM3U\\n#EXTINF:-1 tvg-id=\"ch1\",Dangerous Channel\\njavascript:alert(1)\\n#EXTINF:-1,Valid Channel\\nhttps://media.example/valid.m3u8')");
 assert.equal(r.length,1);
 assert.equal(r[0].name,'Valid Channel');
});

test('Android local DVR has native record, series, folder and history controls',()=>{
 assert.match(html,/iptv-native-dvr\.js/);
 const native=fs.readFileSync('iptv-native-dvr.js','utf8');
 for(const name of ['iptvRecordDeviceNow','iptvRecordDevice','iptvSeriesDevice','iptvChooseLocalFolder','decorateHistory','schedule'])assert.ok(native.includes(name));
});
