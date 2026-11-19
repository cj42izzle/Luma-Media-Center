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
  if(programme&&typeof LumaNativeRetry!=="undefined")LumaNativeRetry.sync(true,programme.title);
  return call("schedule",{url:channel.url,title:programme?.title||channel.name,
    channel:channel.name,episode:programme?.episode||"",
    subtitle:programme?.subtitle||"",description:programme?.description||"",
    program_id:programme?.id||"",start,end});
 }
 function jobs(){if(!available())return[];try{return call("list").jobs||[]}catch{return[]}}
 function html(){
  if(!available())return "";
  const records=jobs().slice(-30).reverse();
  const sleep=(()=>{try{return call("status")}catch{return{}}})();
  const exact=!!sleep.exact_alarms,optimized=!!sleep.battery_optimization_exempt,standbyRisk=!!sleep.low_power_standby_risk;
  const sleepHTML='<section class="iptvSleepDvr"><h3>🌙 Record while the TV sleeps</h3>'
   +'<p class="micro">Luma can wake for scheduled recordings and save locally with the display off if Android keeps this device powered and allows network access.</p>'
   +'<div class="iptvSleepStatus"><span>'+(exact?'✓ Precise alarms allowed':'! Precise alarms restricted')+'</span>'
   +'<span>'+(optimized?'✓ Battery allowlist enabled':'! Battery restrictions may delay recording')+'</span>'
   +(standbyRisk?'<span>! Low Power Standby may block streaming</span>':'')+'</div>'
   +'<div class="actions">'+(!exact?'<button class="secondary small" id="iptvAllowAlarm">Enable precise schedules</button>':'')
   +(!optimized?'<button class="secondary small" id="iptvAllowPower">Review power restrictions</button>':'')
   +'</div><p class="micro">Manufacturer deep standby may cut Wi-Fi or stop background recording. Wake locks cannot override a hardware power cut.</p></section>';
  let storage="Local device storage";
  try{storage=call("status").storage||storage}catch{}
  return '<div class="iptvLocalDvr"><b>● This device can record TV</b><span>Scheduled recordings continue in the Android TV app while the screen is off (if the device remains powered). Saved to '+esc(storage)+'. Compatible HTTP(S) MPEG-TS and standard unencrypted HLS streams only.</span>'
   +'<button class="secondary small" id="iptvChooseLocalFolder">Change storage folder</button></div>'
   +sleepHTML+'<h3>On-device recordings</h3>'
   +(records.length?records.map(x=>'<div class="iptvDvrRow"><div><strong>'+esc(x.title)+'</strong><small>'+new Date(x.start).toLocaleString()+' · '+esc(x.status)+(x.processing&&x.status==="complete"?' · '+esc(x.processing):'')+(x.retry_pending?' · Looking across channels for exact episode':'')+(x.retry_job_id?' · Retry scheduled':'')+(x.saved_bytes?' · Saved '+(x.saved_bytes/1048576).toFixed(1)+' MB':'')+(x.error?' · '+esc(x.error):'')+'</small></div><div class="actions">'
    +(x.status==="scheduled"||x.status==="recording"?'<button class="secondary small" data-local-cancel="'+esc(x.id)+'">Cancel</button>':"")
    +(x.file&&["complete","partial"].includes(x.status)?'<button class="secondary small" data-local-open="'+esc(x.id)+'">Play file</button>':"")+'</div></div>').join(""):'<p class="micro">No on-device recordings yet. Select Record on this device from a channel or programme.</p>');
 }
 function bind(){decorateHistory();decorateModal()}

 function ready(){
  if(document.querySelector(".iptvHero")&&typeof LumaIPTV!=="undefined"){
   LumaIPTV.render();
  }
 }
 if(typeof MutationObserver!=="undefined"){
  const modal=document.getElementById("modal");
  if(modal)new MutationObserver(decorateModal).observe(modal,{childList:true,subtree:true});
 }
 window.addEventListener("luma-native-dvr-ready",ready);
 window.addEventListener("luma-native-dvr-storage",ready);
 window.addEventListener("luma-native-dvr-power",()=>{
  const panel=document.querySelector(".iptvNativeHistory .iptvSleepDvr");
  if(!panel||!available())return;
  try {
   const state=call("status"),spans=panel.querySelectorAll(".iptvSleepStatus span");
   if(spans[0])spans[0].textContent=state.exact_alarms?"✓ Precise alarms allowed":"! Precise alarms restricted";
   if(spans[1])spans[1].textContent=state.battery_optimization_exempt?"✓ Battery allowlist enabled":"! Battery restrictions may delay recording";
  }catch{}
 });

 /* Attach local DVR controls to existing Luma channel/programme detail sheets. */
 let pick={channel:"",programme:""};
 document.addEventListener("click",event=>{
  const c=event.target.closest("[data-channel]");
  const p=event.target.closest("[data-program]");
  if(c)pick={channel:c.dataset.channel,programme:""};
  else if(p)pick={channel:"",programme:p.dataset.program};
 },true);
 function selectedChannel(){
  const rows=LumaIPTV.channels();
  if(pick.channel){const found=rows.find(c=>c.id===pick.channel);if(found)return found}
  const title=document.querySelector(".iptvWatch h2")?.textContent||"";
  return rows.find(c=>c.name===title)||null;
 }
 function selectedProgramme(){
  const list=LumaIPTV.programs();
  const p=list.find(x=>x.id===pick.programme);
  if(p)return p;
  const title=document.querySelector(".iptvProgrammeDetail h2")?.textContent||"";
  return list.find(x=>x.title===title)||null;
 }
 function recordOne(){
  try{
   const p=selectedProgramme();if(!p)throw Error("Select the TV programme first");
   const channels=LumaIPTV.channels();
   const alternatives=LumaIPTV.programs().filter(x=>x.title===p.title&&Math.abs(x.start-p.start)<=15*60000)
    .map(x=>({p:x,c:channels.find(c=>c.id===x.channel_id)})).filter(x=>x.c);
   alternatives.sort((a,b)=>(b.c.quality||0)-(a.c.quality||0));
   const best=alternatives[0],channel=best?.c||channels.find(x=>x.id===p.channel_id);
   const response=schedule(channel,best?.p||p);
   toast("Device recording scheduled"+(response.timing==="approximate"?" (start time may vary)":""));
   closeModal();LumaIPTV.render();
  }catch(e){toast(String(e.message||e))}
 }
 function recordNow(){
  try{
   const channel=selectedChannel();if(!channel)throw Error("No channel selected");
   const minutes=Number(document.querySelector("#iptvRecordDuration")?.value)||60;
   const response=schedule(channel,null,minutes);
   toast("Recording to this device"+(response.timing==="approximate"?" (start may be delayed)":""));
   closeModal();LumaIPTV.render();
  }catch(e){toast(String(e.message||e))}
 }
 function recordSeries(){
  try{
   const p=selectedProgramme();if(!p)throw Error("Choose a programme");
   const mode=document.querySelector("#iptvSeriesMode")?.value||"new";
   const channel=LumaIPTV.channels().find(c=>c.id===p.channel_id);
   if(!channel)throw Error("Channel is no longer available");
   const now=Date.now(),known=new Set(),existing=new Set(jobs().map(j=>j.channel+"|"+j.title+"|"+j.start));
   let count=0;
   const programmes=LumaIPTV.programs().filter(x=>x.channel_id===p.channel_id&&x.title.toLowerCase()===p.title.toLowerCase()&&x.end>now).sort((a,b)=>a.start-b.start);
   for(const item of programmes){
    if(count>=40)break;
    if(mode==="new"&&(!item.is_new||item.rerun))continue;
    const signature=item.episode?"ep:"+item.episode:item.subtitle?"subtitle:"+item.subtitle.toLowerCase():
      item.description.length>=35?"desc:"+item.description.toLowerCase().slice(0,160):"";
    if(mode==="unseen"&&(!signature||known.has(signature)))continue;
    if(signature)known.add(signature);
    if(existing.has(channel.name+"|"+item.title+"|"+Math.max(now,item.start)))continue;
    schedule(channel,item);count++;
   }
   if(!count)throw Error("No eligible future broadcasts in the loaded guide");
   toast("Scheduled "+count+" episode(s) on this device. Refresh the guide later for new dates.");
   closeModal();LumaIPTV.render();
  }catch(e){toast(String(e.message||e))}
 }
 function decorateModal(){
  if(!available())return;
  const manual=document.querySelector("#iptvRecordChannelNow");
  if(manual){
   manual.textContent="● Record to DVR server";
   if(!LumaIPTV.isRecorderConnected())manual.hidden=true;
   if(!document.querySelector("#iptvRecordDeviceNow")){
    const button=document.createElement("button");
    button.id="iptvRecordDeviceNow";button.className="primary";button.textContent="● Record on this device";
    button.onclick=recordNow;manual.before(button);
   }
  }
  const once=document.querySelector("#iptvRecordOnce");
  if(once){
   once.textContent="● Record to DVR server";
   if(!LumaIPTV.isRecorderConnected())once.hidden=true;
   if(!document.querySelector("#iptvRecordDevice")){
    const button=document.createElement("button");
    button.id="iptvRecordDevice";button.className="primary";button.textContent="● Record on this device";
    button.onclick=recordOne;once.before(button);
   }
  }
  const series=document.querySelector("#iptvSeriesRecord");
  if(series){
   series.textContent="Save ongoing series rule to DVR server";
   if(!LumaIPTV.isRecorderConnected())series.hidden=true;
   if(!document.querySelector("#iptvSeriesDevice")){
    const button=document.createElement("button");button.id="iptvSeriesDevice";
    button.className="primary";button.textContent="Schedule available episodes on this device";
    button.onclick=recordSeries;series.before(button);
    const hint=document.createElement("p");hint.className="micro";
    hint.textContent="Device-only series recording schedules episodes currently present in your guide. Reopen Luma to extend future dates.";
    button.after(hint);
   }
  }
 }
 function decorateHistory(){
  if(!available())return;
  const section=document.querySelector(".iptvRecordings");
  if(!section||section.querySelector(".iptvNativeHistory"))return;
  const zone=document.createElement("div");zone.className="iptvNativeHistory";zone.innerHTML=html();
  const heading=section.querySelector(".iptvSectionHead");
  if(heading)heading.after(zone);else section.prepend(zone);
  const notice=section.querySelector(".iptvNotice");
  if(notice)notice.textContent="No DVR server is required to record onto this Android TV. Leave the device powered on for scheduled recordings.";
  const alarm=zone.querySelector("#iptvAllowAlarm");
  if(alarm)alarm.onclick=()=>{try{call("alarmSettings");toast("Allow precise alarms for Luma")}catch(e){toast(String(e.message||e))}};
  const power=zone.querySelector("#iptvAllowPower");
  if(power)power.onclick=()=>{try{call("powerSettings");toast("Review Luma battery restrictions")}catch(e){toast(String(e.message||e))}};
  const folder=zone.querySelector("#iptvChooseLocalFolder");
  if(folder)folder.onclick=()=>{try{call("chooseFolder");toast("Choose a recording folder on your TV")}catch(e){toast(String(e.message||e))}};
  for(const button of zone.querySelectorAll("[data-local-cancel]"))button.onclick=()=>{try{call("cancel",button.dataset.localCancel);LumaIPTV.render();toast("Recording cancelled")}catch(e){toast(String(e.message||e))}};
  for(const button of zone.querySelectorAll("[data-local-open]"))button.onclick=()=>{try{call("open",button.dataset.localOpen)}catch(e){toast(String(e.message||e))}};
 }
 return {available,call,schedule,jobs,html,bind};
})();
