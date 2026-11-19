"use strict";
/* Luma same-origin HTTPS relay for an owner's authorized Xtream service.
 * Credentials are kept in a short-lived encrypted HttpOnly session cookie.
 * No arbitrary URL proxy, no provider credentials in media URLs, no DRM bypass.
 */
const crypto=require("node:crypto"),dns=require("node:dns").promises;
const http=require("node:http"),https=require("node:https"),net=require("node:net"),zlib=require("node:zlib");
const MAX_METADATA=25*1024*1024,MAX_MEDIA=24*1024*1024;
const clean=s=>String(s??"").trim();
function key(){const b=Buffer.from(process.env.LUMA_IPTV_RELAY_KEY||"","base64");return b.length===32?b:null}
function encrypt(value){
 const k=key();if(!k)throw Error("Relay not configured");
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",k,iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url");
}
function decrypt(token){
 const k=key(),raw=Buffer.from(String(token||"").slice(0,8192),"base64url");
 if(!k||raw.length<29)throw Error("Invalid session");
 const decipher=crypto.createDecipheriv("aes-256-gcm",k,raw.subarray(0,12));
 decipher.setAuthTag(raw.subarray(12,28));
 const data=JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString("utf8"));
 if(!Number.isFinite(data.exp)||data.exp<Date.now())throw Error("Session expired");
 return data;
}
function publicIPv4(ip){
 if(net.isIP(ip)!==4)return false;
 const a=ip.split(".").map(Number);
 if(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===169&&a[1]===254||
    a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168||
    a[0]===100&&a[1]>=64&&a[1]<=127||a[0]===198&&a[1]>=18&&a[1]<=19||
    a[0]===192&&a[1]===0||a[0]===192&&a[1]===0&&a[2]===2||
    a[0]===198&&a[1]===51&&a[2]===100||a[0]===203&&a[1]===0&&a[2]===113||
    a[0]===255)return false;
 return true;
}
function endpoint(value,{allowQuery=false}={}){
 const input=clean(value);
 if(input.length>600)throw Error("Invalid provider address");
 let u;try{u=new URL(input)}catch{throw Error("Invalid provider address")}
 if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.hash||
    !u.hostname||u.hostname.endsWith(".local")||u.hostname.toLowerCase()==="localhost"||
    net.isIP(u.hostname)===6||(!allowQuery&&u.search))throw Error("Unsupported provider address");
 return u;
}
async function pinnedURL(input){
 const u=endpoint(input,{allowQuery:true}),hosts=await dns.lookup(u.hostname,{family:4,all:true});
 if(!hosts.length||hosts.some(x=>!publicIPv4(x.address)))throw Error("Provider address is not a public internet host");
 return {u,ip:hosts[0].address};
}
function remote(input,{limit=MAX_METADATA,range=""}={}){
 return pinnedURL(input).then(({u,ip})=>new Promise((resolve,reject)=>{
  const transport=u.protocol==="https:"?https:http;
  const headers={"User-Agent":"LumaMediaCenter/1.0","Accept-Encoding":"identity","Accept":"*/*"};
  if(range&&/^bytes=\d*-\d*$/.test(range))headers.Range=range;
  const call=transport.get(u,{headers,timeout:22000,lookup:(_host,_opts,done)=>done(null,ip,4)},response=>{
   const status=response.statusCode||502;
   if(status<200||status>=300){response.resume();reject(Error("IPTV provider returned HTTP "+status));return}
   let size=0;const chunks=[];
   response.on("data",part=>{size+=part.length;if(size>limit){call.destroy(Error("Provider response exceeds safe limit"));return}chunks.push(part)});
   response.on("end",()=>resolve({body:Buffer.concat(chunks),status,headers:response.headers}));
   response.on("error",reject);
  });
  call.on("timeout",()=>call.destroy(Error("IPTV provider timed out")));
  call.on("error",reject);
 }));
}
function send(res,status,data){
 res.statusCode=status;
 res.setHeader("Content-Type","application/json; charset=utf-8");
 res.setHeader("Cache-Control","private, no-store");
 res.end(JSON.stringify(data));
}
function cookie(req){
 const raw=String(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("LumaIPTV="));
 if(!raw)throw Error("Connect the IPTV account");
 return decrypt(raw.slice("LumaIPTV=".length));
}
function verifySession(s){if(!s.server||!s.username||!s.password||!s.sid)throw Error("Session invalid");return s}
function urlFor(s,route,id,ext="m3u8"){
 const val=String(id||"");if(!/^\d{1,12}$/.test(val))throw Error("Invalid stream ID");
 if(!["live","movie","series"].includes(route)||!/^[a-z0-9]{2,6}$/i.test(ext))throw Error("Unsupported media format");
 return s.server.replace(/\/+$/,"")+"/"+route+"/"+encodeURIComponent(s.username)+"/"+encodeURIComponent(s.password)+"/"+val+"."+ext;
}
function actionURL(s,action,id=""){
 const allowed=["get_live_streams","get_live_categories","get_vod_streams","get_series","get_series_info"];
 if(!allowed.includes(action))throw Error("Unknown catalog action");
 const u=new URL(s.server.replace(/\/+$/,"")+"/player_api.php");
 u.searchParams.set("username",s.username);u.searchParams.set("password",s.password);u.searchParams.set("action",action);
 if(action==="get_series_info"){if(!/^\d{1,12}$/.test(String(id)))throw Error("Invalid series");u.searchParams.set("series_id",String(id))}
 return u.href;
}
function mediaLink(url,s){
 const token=encrypt({url:url.href,sid:s.sid,exp:Math.min(s.exp,Date.now()+2*3600*1000)});
 return "/api/iptv?op=media&t="+encodeURIComponent(token);
}
function rewriteHls(body,url,s){
 const value=body.toString("utf8");
 if(!value.trimStart().startsWith("#EXTM3U")||!/#EXT-X-/i.test(value))throw Error("Provider did not supply a usable HLS playlist");
 const absolute=raw=>{
  const target=new URL(raw,url);endpoint(target.href,{allowQuery:true});
  return mediaLink(target,s);
 };
 return value.split(/\r?\n/).map(line=>{
  if(!line.trim())return line;
  if(line.startsWith("#"))return line.replace(/URI="([^"]+)"/g,(_m,part)=>'URI="'+absolute(part)+'"');
  return absolute(line.trim());
 }).join("\n");
}
function isHls(url,headers,body){
 const type=String(headers["content-type"]||"").toLowerCase();
 return url.pathname.toLowerCase().endsWith(".m3u8")||type.includes("mpegurl")||body.subarray(0,8).toString("utf8").includes("#EXTM3U");
}
async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("Referrer-Policy","no-referrer");
 res.setHeader("X-Content-Type-Options","nosniff");
 const host=String(req.headers.host||"").toLowerCase();
 const origin=String(req.headers.origin||"").toLowerCase();
 if(origin&&origin!=="https://"+host)return send(res,403,{error:"Invalid website origin"});
 const op=clean(req.query?.op||"status");
 if(op==="status")return send(res,200,{ready:!!key(),mode:"private-first-party-https-hls"});
 if(!key())return send(res,503,{error:"IPTV relay not configured"});
 if(op==="session"){
  if(req.method!=="POST")return send(res,405,{error:"Use POST"});
  let data=req.body;
  if(typeof data==="string"&&data.length<8000){try{data=JSON.parse(data)}catch{}}
  if(!data||typeof data!=="object")return send(res,400,{error:"Invalid IPTV credentials"});
  const u=endpoint(data.server);
  const username=clean(data.username).slice(0,180),password=clean(data.password).slice(0,180);
  if(!username||!password||u.href.length>600)return send(res,400,{error:"Enter your IPTV server, username and password"});
  const session={server:u.href.replace(/\/+$/,""),username,password,
   sid:crypto.randomBytes(16).toString("hex"),exp:Date.now()+4*3600*1000};
  // Validate the provider before issuing an encrypted viewing session.
  const check=await remote(actionURL(session,"get_live_streams"),{limit:4*1024*1024});
  let dataRows;try{dataRows=JSON.parse(check.body.toString("utf8"))}catch{}
  if(!Array.isArray(dataRows))return send(res,401,{error:"The IPTV provider did not verify this account"});
  res.setHeader("Set-Cookie","LumaIPTV="+encrypt(session)+"; HttpOnly; Secure; SameSite=Strict; Path=/api/iptv; Max-Age=14400");
  return send(res,200,{ok:true,channels:dataRows.length});
 }
 if(op==="signout"){
  if(req.method!=="POST")return send(res,405,{error:"Use POST"});
  res.setHeader("Set-Cookie","LumaIPTV=; HttpOnly; Secure; SameSite=Strict; Path=/api/iptv; Max-Age=0");
  return send(res,200,{ok:true});
 }
 if(req.method!=="GET")return send(res,405,{error:"Method not allowed"});
 const s=verifySession(cookie(req));
 if(op==="channels"){
  const [l,c]=await Promise.allSettled([remote(actionURL(s,"get_live_streams"),{limit:6*1024*1024}),
    remote(actionURL(s,"get_live_categories"),{limit:1*1024*1024})]);
  if(l.status!=="fulfilled")throw l.reason;
  const streams=JSON.parse(l.value.body.toString("utf8"));
  const groups=c.status==="fulfilled"?JSON.parse(c.value.body.toString("utf8")):[];
  const byId=new Map((Array.isArray(groups)?groups:[]).map(x=>[String(x.category_id),String(x.category_name||"")]));
  const channels=(Array.isArray(streams)?streams:[]).slice(0,8000).flatMap(x=>{
   const id=String(x.stream_id||"");if(!/^\d{1,12}$/.test(id))return[];
   return[{id:"relay:"+id,stream_id:id,name:clean(x.name).slice(0,120)||"Channel",
    epg_id:clean(x.epg_channel_id).slice(0,140),
    logo:clean(x.stream_icon).startsWith("https://")?clean(x.stream_icon).slice(0,1200):"",
    group:clean(byId.get(String(x.category_id))||x.category_name||"Live TV").slice(0,80),
    url:"/api/iptv?op=hls&id="+id,quality:/4k|uhd/i.test(x.name)?2:/HD|FHD/i.test(x.name)?1:0}];
  });
  return send(res,200,{channels});
 }
 if(op==="epg"){
  const url=new URL(s.server.replace(/\/+$/,"")+"/xmltv.php");
  url.searchParams.set("username",s.username);url.searchParams.set("password",s.password);
  const result=await remote(url.href,{limit:MAX_METADATA});
  let body=result.body;
  if(body.length>2&&body[0]===31&&body[1]===139)body=zlib.gunzipSync(body,{maxOutputLength:MAX_METADATA});
  res.statusCode=200;res.setHeader("Content-Type","application/xml; charset=utf-8");
  for(let i=0;i<body.length;i+=65536)res.write(body.subarray(i,i+65536));
  return res.end();
 }
 if(op==="catalog"){
  const action=clean(req.query?.action);
  const result=await remote(actionURL(s,action,req.query?.series_id),{limit:MAX_METADATA});
  res.statusCode=200;res.setHeader("Content-Type","application/json; charset=utf-8");
  for(let i=0;i<result.body.length;i+=65536)res.write(result.body.subarray(i,i+65536));
  return res.end();
 }
 if(op==="hls"){
  const url=new URL(urlFor(s,"live",req.query?.id));
  const result=await remote(url.href,{limit:600000});
  const playlist=rewriteHls(result.body,url,s);
  res.statusCode=200;res.setHeader("Content-Type","application/vnd.apple.mpegurl");
  return res.end(playlist);
 }
 if(op==="vod"){
  const kind=req.query?.kind==="movie"?"movie":req.query?.kind==="series"?"series":"";
  if(!kind)return send(res,400,{error:"Invalid VOD type"});
  const ext=clean(req.query?.ext||"mp4");
  const url=urlFor(s,kind,req.query?.id,ext);
  return pipeMedia(url,req,res);
 }
 if(op==="media"){
  const target=decrypt(req.query?.t);
  if(target.sid!==s.sid||typeof target.url!=="string")return send(res,403,{error:"Media token not valid for this session"});
  return pipeMedia(target.url,req,res,s);
 }
 return send(res,404,{error:"Unknown IPTV route"});
}
async function pipeMedia(raw,req,res,s){
 const url=endpoint(raw,{allowQuery:true}),pinned=await pinnedURL(url.href);
 const transport=url.protocol==="https:"?https:http;
 const headers={"Accept-Encoding":"identity","User-Agent":"LumaMediaCenter/1.0"};
 if(/^bytes=\d*-\d*$/.test(req.headers.range||""))headers.Range=req.headers.range;
 return new Promise((resolve,reject)=>{
  const remoteReq=transport.get(url,{headers,lookup:(_h,_o,cb)=>cb(null,pinned.ip,4),timeout:22000},async upstream=>{
   try{
   const status=upstream.statusCode||502;
   if(status<200||status>=300){upstream.resume();reject(Error("Provider media unavailable"));return}
   const type=String(upstream.headers["content-type"]||"");
   if(url.pathname.toLowerCase().endsWith(".m3u8")||/mpegurl/i.test(type)){
    let count=0;const parts=[];
    for await (const part of upstream){count+=part.length;if(count>800000)throw Error("HLS playlist too large");parts.push(part)}
    const playlist=rewriteHls(Buffer.concat(parts),url,s||cookie(req));
    res.statusCode=200;res.setHeader("Content-Type","application/vnd.apple.mpegurl");
    res.end(playlist);resolve();return;
   }
   const length=Number(upstream.headers["content-length"]||0);
   if(length>MAX_MEDIA){upstream.destroy();reject(Error("Media segment too large"));return}
   res.statusCode=status===206?206:200;
   res.setHeader("Content-Type",type||"application/octet-stream");
   for(const header of ["content-range","accept-ranges","content-length"])
    if(upstream.headers[header])res.setHeader(header,upstream.headers[header]);
   let total=0;
   upstream.on("data",part=>{total+=part.length;if(total>MAX_MEDIA){upstream.destroy(Error("Media segment too large"));return}res.write(part)});
   upstream.on("end",()=>{res.end();resolve()});
   upstream.on("error",reject);
   }catch(e){reject(e)}
  });
  remoteReq.on("timeout",()=>remoteReq.destroy(Error("Media provider timeout")));
  remoteReq.on("error",reject);
 });
}
module.exports=async(req,res)=>{
 try{return await handler(req,res)}
 catch(e){
  if(res.headersSent){try{res.end()}catch{}return}
  const msg=clean(e?.message||"IPTV unavailable");
  const known=/session|invalid|expired|not configured|provider|unsupported|invalid|unavailable|HLS|media|safe|timeout|large/i.test(msg);
  return send(res,/session|expired/i.test(msg)?401:502,{error:known?msg.slice(0,160):"IPTV provider unavailable"});
 }
};
module.exports.__test={publicIPv4,endpoint,urlFor,rewriteHls,encrypt,decrypt};
