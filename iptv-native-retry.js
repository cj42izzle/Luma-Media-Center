"use strict";
/* Device-native background retry catalogue and HEVC settings. Keeps full
 * channel/provider coverage; nothing is uploaded outside the local TV.
 */
const LumaNativeRetry=(()=>{
 let lastKey="",lastAt=0;
 const enabled=()=>typeof LumaDeviceDVR!=="undefined"&&LumaDeviceDVR.available();
 const norm=s=>String(s||"").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
 const identity=p=>{
  const title=norm(p.title),ep=norm(p.episode),sub=norm(p.subtitle),desc=norm(p.description);
  if(!title)return "";
  if(ep.length>=4)return title+"|number:"+ep;
  if(sub.length>=8)return title+"|subtitle:"+sub;
  if(desc.length>=36)return title+"|description:"+desc;
  return "";
 };
 function sync(force=false,priorityTitle=""){
  if(!enabled()||typeof LumaIPTV==="undefined"||!LumaIPTV.programs)return;
  const guide=LumaIPTV.programs(),channels=LumaIPTV.channels();
  if(!guide.length||!channels.length)return;
  const stamp=guide.length+"|"+guide[0].id+"|"+guide[guide.length-1].id;
  if(!force&&stamp===lastKey&&Date.now()-lastAt<5*60000)return;
  const chan=new Map(channels.map(c=>[c.id,c]));
  const now=Date.now(),needed=new Set(LumaDeviceDVR.jobs().filter(j=>
   ["partial","failed","missed","interrupted"].includes(j.status)||j.retry_pending).map(j=>norm(j.title)));
  if(priorityTitle)needed.add(norm(priorityTitle));
  const rows=guide.filter(p=>p.start>now+4000&&p.start<now+14*86400000&&p.end>p.start
      &&identity(p)&&chan.has(p.channel_id))
   .map(p=>{
    const c=chan.get(p.channel_id);
    return {id:p.id,title:p.title,episode:p.episode||"",subtitle:p.subtitle||"",
      description:p.description||"",channel_id:p.channel_id,channel:c.name,
      quality:c.quality||0,url:c.url,start:p.start,end:p.end};
   });
  // Failed-episode titles get priority; remaining bandwidth covers all channels.
  rows.sort((a,b)=>(Number(needed.has(norm(b.title)))-Number(needed.has(norm(a.title))))
      ||a.start-b.start||b.quality-a.quality);
  let budget=2;
  const selected=[];
  for(const row of rows){
   if(selected.length>=5500)break;
   const bytes=JSON.stringify(row).length+1;
   if(budget+bytes>2900000)break;
   budget+=bytes;selected.push(row);
  }
  try{
   LumaDeviceDVR.call("syncGuide",selected);
   lastAt=Date.now();lastKey=stamp;
  }catch(err){/* Retain previous successful guide snapshot on failure. */}
 }
 function bind(){
  if(!enabled())return;
  sync();
  const local=document.querySelector(".iptvNativeHistory");
  if(!local||local.querySelector(".iptvRetrySettings"))return;
  const state=(()=>{try{return LumaDeviceDVR.call("status")}catch{return{}}})();
  const container=document.createElement("div");
  container.className="iptvRetrySettings";
  container.innerHTML='<div class="iptvDvrOptions"><h3>HEVC recording & automatic recovery</h3>'
   +'<p class="micro">Capture the entire programme first, then reduce file size with H.265 if supported. Keep the original unless the new file passes verification and is smaller.</p>'
   +'<p class="micro">'+(state.hevc_supported?'✓ Hardware HEVC encoder available':'! This TV has no compatible HEVC encoder; original recordings are kept')+'</p>'
   +'<button class="secondary small" id="iptvHevcToggle">'+(state.hevc_preferred?'✓ H.265 compression ON':'H.265 compression OFF')+'</button>'
   +'<p class="micro">Failed episodes automatically search all connected IPTV channels and providers for the exact episode, including later the same day. '+Number(state.retry_airings||0)+' future EPG airings are cached on this device. The guide cache is refreshed whenever Luma loads new EPG data.</p></div>';
  const title=local.querySelector(".iptvLocalDvr");
  if(title)title.after(container);else local.prepend(container);
  const control=container.querySelector("#iptvHevcToggle");
  if(control)control.onclick=()=>{
   try{
    const current=LumaDeviceDVR.call("status"),next=!current.hevc_preferred;
    LumaDeviceDVR.call("setHevc",String(next));
    LumaIPTV.render();
    toast(next?"H.265 conversion enabled for future recordings":"Keep-original setting enabled");
   }catch(e){toast(String(e.message||e))}
  };
 }
 return {sync,bind,identity};
})();
