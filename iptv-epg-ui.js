"use strict";
/* Luma independent XMLTV guide administration. LumaIPTV owns the storage and APIs. */
const LumaEPGUI=(()=>{
 const presets=[
  {name:"Global · Lite EPG",url:"https://epg.pw/xmltv/epg_lite.xml"},
  {name:"United States",url:"https://epg.pw/xmltv/epg_US.xml"},
  {name:"Canada",url:"https://epg.pw/xmltv/epg_CA.xml"},
  {name:"United Kingdom",url:"https://epg.pw/xmltv/epg_GB.xml"},
  {name:"Australia",url:"https://epg.pw/xmltv/epg_AU.xml"},
  {name:"US · IPTV-EPG.org (large)",url:"https://iptv-epg.org/files/epg-us.xml"}
 ];
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function managerHTML(){
  const feeds=LumaIPTV.guideSources(),maps=LumaIPTV.guideMappings();
  return '<details class="iptvEpgManager"><summary><span>✦ EPG sources & channel mapping</span><small>'+feeds.length+' custom feeds · '+Object.keys(maps).length+' assigned channels</small></summary>'
   +'<p class="micro">Add XMLTV sources, then press EPG beside any channel to select a guide and match its programme listings. Your actual stream remains unchanged.</p>'
   +'<div class="iptvEPGPresetPanel"><b>✦ Built-in EPG discovery</b><p class="micro">Curated public XMLTV sources can help fill missing listings and NEW/LIVE indicators. Your provider remains the main guide. Large feeds may need the DVR companion.</p>'
   +'<div class="iptvEPGPresets">'+presets.map((p,i)=>'<button type="button" class="secondary small" data-epg-preset="'+i+'">'+esc(p.name)+'</button>').join("")+'</div></div>'
   +'<form id="iptvAddEPG" class="iptvAddEPG"><label>Guide name<input id="iptvEpgName" maxlength="80" placeholder="Regional listings" required></label>'
   +'<label>XMLTV URL<input id="iptvEpgUrl" type="url" placeholder="https://epg.example/guide.xml" required></label>'
   +'<label class="iptvEPGAuto"><input type="checkbox" id="iptvEpgAutoFill" checked>Use to fill missing listings and strengthen guide metadata</label>'
   +'<button type="submit" class="primary">+ Add EPG</button></form>'
   +'<div class="iptvEpgSourceList">'+(feeds.length?feeds.map(e=>'<div class="iptvEpgSource"><div><b>'+esc(e.name)+'</b><small>'+Object.values(maps).filter(m=>m.source_id===e.id).length+' mapped channels</small></div>'
   +'<button type="button" class="secondary small" data-epg-remove="'+esc(e.id)+'">Remove</button></div>').join(""):'<p class="micro">No extra EPG feeds. Your provider guide can still match channels automatically.</p>')+'</div></details>';
 }
 async function mapChannel(cid){
  const channel=LumaIPTV.channels().find(x=>x.id===cid),feeds=LumaIPTV.guideSources(),mapping=LumaIPTV.guideMappings()[cid];
  if(!channel)return;
  if(!feeds.length){toast("Add an XMLTV feed under EPG sources first");const manager=document.querySelector(".iptvEpgManager");if(manager){manager.open=true;manager.scrollIntoView({block:"start"})}return}
  modal('<div class="iptvMapModal"><div class="eyebrow">MATCH PROGRAMME GUIDE</div><h2>'+esc(channel.name)+'</h2>'
   +'<p>Select the guide service with the correct schedule for this station. Its actual stream stays unchanged.</p>'
   +'<label>EPG source<select id="iptvEpgSelect">'+feeds.map(s=>'<option value="'+esc(s.id)+'"'+(mapping?.source_id===s.id?' selected':'')+'>'+esc(s.name)+'</option>').join("")+'</select></label>'
   +'<label>Search this guide<input id="iptvEpgSearch" type="search" placeholder="Station name or XMLTV ID"></label>'
   +'<div class="iptvEpgChoices" id="iptvEpgChoices" role="group" aria-label="Guide station matches"></div>'
   +'<label>Selected XMLTV channel ID<input id="iptvEpgChannelId" value="'+esc(mapping?.epg_channel_id||"")+'" placeholder="Select a guide channel above"></label>'
   +'<div class="actions"><button class="primary" id="iptvEpgSave">Save mapping</button>'
   +(mapping?'<button class="secondary" id="iptvEpgReset">Use automatic guide</button>':"")
   +'<button class="secondary" id="iptvEpgCancel">Cancel</button></div></div>');
  const select=document.querySelector("#iptvEpgSelect"),search=document.querySelector("#iptvEpgSearch"),
   choices=document.querySelector("#iptvEpgChoices"),selected=document.querySelector("#iptvEpgChannelId");
  let catalog=[],generation=0;
  function draw(){
   const term=search.value.trim().toLowerCase();
   const matches=catalog.filter(c=>!term||c.name.toLowerCase().includes(term)||c.id.toLowerCase().includes(term)).slice(0,70);
   choices.innerHTML=matches.map(c=>'<button type="button" class="iptvEpgChoice '+(c.id===selected.value?'selected':'')+'" data-epg-channel="'+esc(c.id)+'"><b>'+esc(c.name)+'</b><small>'+esc(c.id)+'</small></button>').join("")
    ||'<p class="micro">No matching stations. Try a different search or EPG feed.</p>';
   for(const b of choices.querySelectorAll("[data-epg-channel]"))b.onclick=()=>{selected.value=b.dataset.epgChannel;draw()};
  }
  async function load(){
   const token=++generation;choices.innerHTML='<p class="micro">Reading channel IDs from this guide…</p>';
   try{const rows=await LumaIPTV.guideCatalog(select.value);if(token!==generation)return;catalog=rows;draw()}
   catch(e){if(token!==generation)return;catalog=[];choices.innerHTML='<p class="micro">'+esc(String(e.message||e))+'</p>'}
  }
  select.onchange=()=>{selected.value="";search.value="";load()};
  search.oninput=draw;selected.oninput=draw;
  document.querySelector("#iptvEpgCancel").onclick=()=>closeModal();
  document.querySelector("#iptvEpgSave").onclick=async()=>{
   try{await LumaIPTV.guideSet(cid,select.value,selected.value.trim());closeModal();toast("Guide matched for "+channel.name)}
   catch(e){toast(String(e.message||e))}
  };
  const reset=document.querySelector("#iptvEpgReset");
  if(reset)reset.onclick=async()=>{try{await LumaIPTV.guideReset(cid);closeModal();toast("Automatic guide restored")}catch(e){toast(String(e.message||e))}};
  await load();
 }
 function bind(){
  const form=document.querySelector("#iptvAddEPG");
  if(form)form.onsubmit=async(e)=>{
   e.preventDefault();
   try{await LumaIPTV.guideAdd(document.querySelector("#iptvEpgName").value,document.querySelector("#iptvEpgUrl").value,!!document.querySelector("#iptvEpgAutoFill")?.checked);toast("Guide source added")}
   catch(err){toast("EPG source: "+String(err.message||err))}
  };
  for(const b of document.querySelectorAll("[data-epg-preset]"))b.onclick=()=>{
   const p=presets[Number(b.dataset.epgPreset)];
   if(!p)return;
   document.querySelector("#iptvEpgName").value=p.name;
   document.querySelector("#iptvEpgUrl").value=p.url;
   document.querySelector("#iptvEpgAutoFill").checked=true;
   toast("EPG selected. Review the source and click Add EPG.");
  };
  for(const b of document.querySelectorAll("[data-epg-remove]"))b.onclick=async()=>{
   try{await LumaIPTV.guideRemove(b.dataset.epgRemove);toast("Guide source removed")}
   catch(err){toast(String(err.message||err))}
  };
  for(const b of document.querySelectorAll("[data-iptv-map]"))b.onclick=()=>mapChannel(b.dataset.iptvMap);
  for(const b of document.querySelectorAll("[data-iptv-fav]"))b.onclick=()=>LumaIPTV.favoriteToggle(b.dataset.iptvFav);
 }
 return {managerHTML,mapChannel,bind};
})();
