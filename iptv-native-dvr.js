"use strict";
/* Luma Android TV local DVR. Native recording runs without the Luma website open. */
const LumaDeviceDVR=(()=>{
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const available=()=>typeof window!=="undefined"&&typeof window.LumaNativeDVR==="object"&&typeof window.LumaDvrToken==="string";
 function call(method,argument){
  if(!available())throw Error("Device DVR is available in the Luma Android TV app, not a regular browser");
  const bridge=window.LumaNativeDVR,token=window.LumaDvrToken;
  const reply=argument===undefined?bridge[method](token):bridge[method](token,typeof argument==="string"?argument:JSON.stringify(argument));
  const data=JSON.parse(reply||"{}");
  if(!data.ok)throw Error(data.error||"Device recorder error");
  return data;
 }
 function schedule(channel,programme=null,minutes=60){
  if(!channel||!channel.url)throw Error("The selected channel has no stream URL");
  const now=Date.now(),start=programme?Math.max(now,Number(programme.start)||now):now;
  const end=programme?Number(programme.end)||0:now+Math.max(5,Math.min(240,Number(minutes)||60))*60000;
  return call("schedule",{url:channel.url,title:programme?.title||channel.name,channel:channel.name,episode:programme?.episode||"",start,end});
 }
 function jobs(){if(!available())return[];try{return call("list").jobs||[]}catch{return[]}}
 function html(){
  if(!available())return "";
  const records=jobs().slice(-30).reverse();
  let storage="Local device storage";
  try{storage=call("status").storage||storage}catch{}
  return '<div class="iptvLocalDvr"><b>● This device can record TV</b><span>Scheduled recordings continue in the Android TV app while the screen is off (if the device remains powered). Saved to '+esc(storage)+'. Compatible HTTP(S) MPEG-TS and standard unencrypted HLS streams only.</span>'
   +'<button class="secondary small" id="iptvChooseLocalFolder">Change storage folder</button></div>'
   +'<h3>On-device recordings</h3>'
   +(records.length?records.map(x=>'<div class="iptvDvrRow"><div><strong>'+esc(x.title)+'</strong><small>'+new Date(x.start).toLocaleString()+' · '+esc(x.status)+(x.error?' · '+esc(x.error):'')+'</small></div><div class="actions">'
    +(x.status==="scheduled"||x.status==="recording"?'<button class="secondary small" data-local-cancel="'+esc(x.id)+'">Cancel</button>':"")
    +(x.file&&["complete","partial"].includes(x.status)?'<button class="secondary small" data-local-open="'+esc(x.id)+'">Play file</button>':"")+'</div></div>').join(""):'<p class="micro">No on-device recordings yet. Select Record on this device from a channel or programme.</p>');
 }
 function bind(){
  const choose=document.querySelector("#iptvChooseLocalFolder");
  if(choose)choose.onclick=()=>{try{call("chooseFolder");toast("Select a destination folder on your Android TV")}catch(e){toast(String(e.message||e))}};
  for(const b of document.querySelectorAll("[data-local-cancel]"))b.onclick=()=>{
   try{call("cancel",b.dataset.localCancel);LumaIPTV.render();toast("Device recording cancelled")}
   catch(e){toast(String(e.message||e))}
  };
  for(const b of document.querySelectorAll("[data-local-open]"))b.onclick=()=>{
   try{call("open",b.dataset.localOpen)}catch(e){toast(String(e.message||e))}
  };
 }
 function ready(){
  if(document.querySelector(".iptvHero")&&typeof LumaIPTV!=="undefined"){
   LumaIPTV.render();
  }
 }
 window.addEventListener("luma-native-dvr-ready",ready);
 window.addEventListener("luma-native-dvr-storage",ready);
 return {available,call,schedule,jobs,html,bind};
})();
