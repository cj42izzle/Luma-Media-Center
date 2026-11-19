"use strict";
const LumaVOD=(()=>{
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
 const cfg=()=>{try{return JSON.parse(localStorage.getItem("luma.iptv.v1")||"{}")}catch{return{}}};
 let cache={url:"",time:0,rows:[]};let sessionRows=[];
 function parse(rows){return(rows||[]).map(v=>{
  const group=String(v.group||"").toLowerCase(),path=(()=>{try{return new URL(v.url).pathname.toLowerCase()}catch{return""}})();
  const type=/\b(series|tv series|tv shows)\b/.test(group)||path.includes("/series/")?"series":/\b(vod|movies?|films?|cinema)\b/.test(group)||/\/movies?\//.test(path)?"movie":"";
  if(!type)return null;
  const raw=String(v.name||""),ep=raw.match(/\bS(\d{1,3})[._ -]*E(\d{1,3})\b/i),year=raw.match(/\b(?:19|20)\d{2}\b/);
  const title=raw.replace(/\bS\d{1,3}[._ -]*E\d{1,3}\b.*$/i,"").replace(/\s*\((?:19|20)\d{2}\)\s*/g," ").replace(/\s+(?:4K|1080P|720P|FHD|HD)\s*$/i,"").trim();
  return { ...v,type,title,key:norm(title),year:year?year[0]:"",season:ep?Number(ep[1]):0,number:ep?Number(ep[2]):0 };
 }).filter(x=>x&&x.key)}
 function setRows(entries){sessionRows=parse(entries)}
 function matches(rows,x,ep){
  const kind=x.type==="Movie"?"movie":"series",year=String(x.year||"");
  return(rows||[]).filter(v=>v.type===kind&&v.key===norm(x.title)&&(!year||!v.year||year===v.year)
    &&(kind==="movie"||ep&&v.season===Number(ep.season_number||ep.season)&&v.number===Number(ep.episode_number||ep.episode)))
    .sort((a,b)=>(b.quality||0)-(a.quality||0)).slice(0,25);
 }
 async function find(x,ep){
  const c=cfg();
  if(c.host&&c.token){
   const u=new URL(c.host);if(u.protocol!=="https:")throw Error("DVR companion requires HTTPS");
   const q=new URLSearchParams({title:x.title,type:x.type==="Movie"?"movie":"series",year:String(x.year||"")});
   if(ep){q.set("season",String(ep.season_number||ep.season||0));q.set("episode",String(ep.episode_number||ep.episode||0))}
   const r=await fetch(c.host.replace(/\/+$/,"")+"/vod/search?"+q,{headers:{Authorization:"Bearer "+c.token},cache:"no-store"});
   const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(json.error||"DVR VOD search unavailable");
   return (json.matches||[]).map(v=>({ ...v,provider:v.provider||c.name||"IPTV" }));
  }
  if(!c.m3u)return matches(sessionRows,x,ep);
  if(!c.m3u.startsWith("https://"))throw Error("Browser playlists must use HTTPS; use DVR for HTTP/LAN sources");
  if(cache.url!==c.m3u||Date.now()-cache.time>15*60000){
   const r=await fetch(c.m3u,{cache:"no-store"});if(!r.ok)throw Error("IPTV playlist HTTP "+r.status);
   const txt=await r.text();if(txt.length>5*1024*1024)throw Error("IPTV playlist too large");
   cache={url:c.m3u,time:Date.now(),rows:parse(LumaIPTV.parseM3U(txt))};
  }
  return matches(cache.rows,x,ep).map(v=>({...v,provider:c.name||"IPTV"}));
 }
 async function choose(x,ep,manifest){
  const c=cfg();if(!c.m3u&&!sessionRows.length&&!(c.host&&c.token)){manifest();return}
  modal('<div class="pad"><h2>Checking IPTV sources…</h2></div>');
  let rows=[],error="";
  try{rows=await find(x,ep)}catch(e){error=String(e.message||e)}
  const installed=typeof LumaAddons!=="undefined"&&LumaAddons.installed()>0;
  let html='<div class="pad"><div class="eyebrow">CHOOSE YOUR SOURCE</div><h2>'+esc(x.title)+'</h2><p class="micro">Use your IPTV provider or installed manifest.json add-ons.</p><section class="settingCard"><h3>📡 IPTV movies & episodes</h3>'
   +(rows.length?rows.map((v,i)=>'<div class="actions" style="margin:10px 0"><b>'+esc(v.provider||"IPTV")+' · '+esc(v.name||v.title)+'</b><button class="primary small" data-iptv-play="'+i+'">▶ Play</button><button class="secondary small" data-iptv-out="'+i+'">External</button></div>').join(""):'<p>No exact IPTV movie/episode match was found.</p>')
   +(error?'<p class="micro">'+esc(error)+'</p>':"")
   +'</section><section class="settingCard" style="margin-top:12px"><h3>✦ Manifest add-ons</h3>'
   +(installed?'<button class="secondary" id="manifestChoice">Find manifest streams</button>':'<p>No installed manifest add-ons.</p><button class="secondary" id="manageManifest">Manage Add-ons</button>')
   +'</section><button class="secondary" style="margin-top:14px" id="vodBack">Back to details</button></div>';
  modal(html);
  for(const btn of document.querySelectorAll("[data-iptv-play]"))btn.onclick=()=>{
    const v=rows[Number(btn.dataset.iptvPlay)];if(v&&/^https?:\/\//.test(v.url))play(x,ep,v.url);
  };
  for(const btn of document.querySelectorAll("[data-iptv-out]"))btn.onclick=()=>{
    const v=rows[Number(btn.dataset.iptvOut)];if(v&&/^https?:\/\//.test(v.url))window.open(v.url,"_blank","noopener");
  };
  const m=document.querySelector("#manifestChoice");if(m)m.onclick=manifest;
  const a=document.querySelector("#manageManifest");if(a)a.onclick=()=>{closeModal();state.tab="Add-ons";render()};
  document.querySelector("#vodBack").onclick=()=>showDetails();
 }
 return {choose,parse,matches,setRows};
})();