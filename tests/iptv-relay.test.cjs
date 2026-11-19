"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const crypto=require("node:crypto");
process.env.LUMA_IPTV_RELAY_KEY=crypto.randomBytes(32).toString("base64");
const gateway=require("../api/iptv.js"),api=gateway.__test;
test("IPTV relay only accepts user provider addresses without embedded passwords or query parameters",()=>{
 assert.equal(api.endpoint("http://tv.example:8080").host,"tv.example:8080");
 assert.throws(()=>api.endpoint("http://username:password@tv.example:8080"),/Unsupported/);
 assert.throws(()=>api.endpoint("file:///etc/passwd"),/Unsupported/);
 assert.throws(()=>api.endpoint("https://tv.example/?username=secret"),/Unsupported/);
 assert.equal(api.endpoint("http://tv.example/live/100.ts?key=token",{allowQuery:true}).searchParams.get("key"),"token");
});
test("relay excludes private, loopback, special-use, test and IPv6 addresses",()=>{
 for(const ip of ["127.0.0.1","10.0.1.3","172.16.0.1","192.168.1.1",
  "169.254.0.1","100.64.0.5","198.18.0.1","192.0.2.1","203.0.113.1","::1","0.0.0.0"])
  assert.equal(api.publicIPv4(ip),false,ip);
 assert.equal(api.publicIPv4("8.8.8.8"),true);
});
test("Xtream media paths remain within the authenticated provider and numeric stream IDs",()=>{
 const account={server:"http://tv.example:8080",username:"user",password:"secret",sid:"sid",exp:Date.now()+60000};
 assert.equal(api.urlFor(account,"live",101),"http://tv.example:8080/live/user/secret/101.m3u8");
 assert.equal(api.urlFor(account,"movie",102,"mp4"),"http://tv.example:8080/movie/user/secret/102.mp4");
 assert.throws(()=>api.urlFor(account,"live","../../internal"),/Invalid stream ID/);
 assert.throws(()=>api.urlFor(account,"any",101),/Unsupported/);
});
test("encrypted viewing tokens are session scoped and contain no plaintext provider password",()=>{
 const account={sid:"this-session",server:"http://tv.example:8080",username:"myuser",
  password:"my-private-password",exp:Date.now()+60000};
 const token=api.encrypt(account),decoded=api.decrypt(token);
 assert.equal(decoded.password,"my-private-password");
 assert.equal(decoded.sid,account.sid);
 assert.ok(!token.includes("my-private-password"));
 assert.throws(()=>api.decrypt(token.slice(0,-1)+"x"));
 assert.throws(()=>api.decrypt(api.encrypt({...account,exp:Date.now()-1})),/expired/);
});
test("HLS playlist variants, segments and encryption keys are rewritten to credential-free same-origin paths",()=>{
 const session={sid:"sid123",exp:Date.now()+60000};
 const source=new URL("http://tv.example:8080/live/u/p/101.m3u8");
 const hls=['#EXTM3U','#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=1000000',
  'variants/720.m3u8?sig=abc',
  '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin?key=abc"',
  '#EXTINF:5,','parts/seg01.ts?access=token'].join("\n");
 const out=api.rewriteHls(Buffer.from(hls),source,session);
 assert.equal((out.match(/\/api\/iptv\?op=media&t=/g)||[]).length,3);
 assert.ok(!out.includes("/live/u/p/"));
 assert.ok(!out.includes("keys/key.bin?"));
 assert.ok(!out.includes("access=token"));
});
test("gateway status identifies whether the HTTPS relay is configured without disclosing secrets",async()=>{
 let payload="",headers={};
 const res={statusCode:200,setHeader(k,v){headers[k]=v},end(v){payload=String(v||"")}};
 await gateway({method:"GET",headers:{host:"luma.example",origin:"https://luma.example"},query:{op:"status"}},res);
 const report=JSON.parse(payload);
 assert.equal(report.ready,true);
 assert.equal(report.mode,"private-first-party-https-hls");
 assert.ok(!payload.includes(process.env.LUMA_IPTV_RELAY_KEY));
});
