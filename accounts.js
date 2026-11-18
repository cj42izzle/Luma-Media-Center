
"use strict";
/* Luma accounts. Public OAuth clients only: never require client secrets in GitHub Pages. */
const LumaAccounts=(()=>{
const VERSION="26",KEY="luma.accounts.v1",PENDING="luma.oauth.pending";
// Site-owner configuration: PUBLIC client IDs are safe to publish; never use client secrets.
// Once configured here, visitors can sign in without dealing with developer setup.
const PUBLIC_APP_IDS={trakt:"",simkl:"",simklDevice:""};
const redirect=location.origin+location.pathname;
function read(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch{return{}}}
const previous=read();
const data={source:["device","trakt","simkl"].includes(previous.source)?previous.source:"device",
 ids:{trakt:"",simkl:"",simklDevice:"",...(previous.ids||{})},tokens:{trakt:null,simkl:null,...(previous.tokens||{})},
 lists:{trakt:[],simkl:[],...(previous.lists||{})},fetched:{trakt:0,simkl:0,...(previous.fetched||{})},
 lastError:previous.lastError||"",simklActivity:previous.simklActivity||null};
for(const provider of ["trakt","simkl"]){if(!Array.isArray(data.lists[provider]))data.lists[provider]=[]}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(data))}catch{toast("Cannot save preferences in this browser")}}
function escapeText(x){return safe(String(x??""))}
function sources(){return ["device","trakt","simkl"]}
function choose(source){if(!sources().includes(source))return;data.source=source;persist();if(state.tab==="Watchlist")render()}
function getSource(){return data.source}
function online(service){return !!(data.tokens[service]?.access_token)}
function randomBase64url(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("")}
async function shaChallenge(verifier){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function exactRedirect(){return location.origin+location.pathname}
function updateID(provider,val){const id=String(val||"").trim();if(!/^[A-Za-z0-9_-]{8,150}$/.test(id)){toast("Enter a valid public client ID, never a client secret.");return false}data.ids[provider]=id;persist();toast("Public "+provider+" client ID saved.");return true}
function normalizeTraktRow(row){
const obj=row.movie||row.show||row.episode?.show;
if(!obj)return null;
const type=row.movie?"Movie":"Series",ids=obj.ids||{},id=ids.imdb?"imdb:"+ids.imdb:ids.tmdb?"tmdb:"+ids.tmdb:"trakt:"+ids.trakt;
if(!ids.imdb&&!ids.tmdb&&!ids.trakt)return null;
return{id:"trakt:"+id,title:obj.title||"Untitled",type,year:obj.year||"",imdbId:ids.imdb||"",tmdbId:ids.tmdb||null,traktId:ids.trakt||null,source:"trakt",overview:"",poster:"",backdrop:"",added:row.listed_at||"",userStatus:"watchlist"};
}
function normalizeSimklRow(row,category){
const obj=row.movie||row.show||row.anime;
if(!obj)return null;
const ids=obj.ids||{},type=category==="movies"?"Movie":category==="anime"?"Anime":"Series";
const id=ids.imdb?"imdb:"+ids.imdb:ids.tmdb?"tmdb:"+ids.tmdb:"simkl:"+ids.simkl;
if(!ids.imdb&&!ids.tmdb&&!ids.simkl)return null;
return{id:"simkl:"+id,title:obj.title||"Untitled",type,year:obj.year||"",imdbId:ids.imdb||"",tmdbId:ids.tmdb||null,simklId:ids.simkl||null,source:"simkl",overview:"",poster:obj.poster&&/^https:\/\//.test(obj.poster)?obj.poster:"",backdrop:"",userStatus:row.status||"unknown"};
}
function decodeList(provider,payload){
if(provider==="trakt")return (Array.isArray(payload)?payload:[]).map(normalizeTraktRow).filter(Boolean);
return ["shows","anime","movies"].flatMap(t=>(payload?.[t]||[]).map(row=>normalizeSimklRow(row,t)).filter(Boolean)).filter(row=>["plantowatch","watching","hold","completed","dropped"].includes(row.userStatus));
}
async function oauthStart(provider){
 if(!["trakt","simkl"].includes(provider))return;
 const id=currentClientID(provider);if(!id){showSetupRequired(provider);return}
 if(!crypto?.subtle){toast("Secure browser is required for account connection.");return}
 const verifier=randomBase64url(),challenge=await shaChallenge(verifier),csrf=randomBase64url();
 sessionStorage.setItem(PENDING,JSON.stringify({provider,csrf,verifier,redirect:exactRedirect(),started:Date.now()}));
 const base=provider==="trakt"?"https://auth.trakt.tv/oauth/authorize":"https://simkl.com/oauth2/authorize";
 const args=new URLSearchParams({client_id:id,redirect_uri:exactRedirect(),response_type:"code",state:csrf,code_challenge:challenge,code_challenge_method:"S256"});
 if(provider==="simkl")args.set("scope","media:read");
 window.location.assign(base+"?"+args.toString());
}
async function exchangeCallback(){
 const u=new URL(location.href),code=u.searchParams.get("code"),error=u.searchParams.get("error"),st=u.searchParams.get("state");
 if(!code&&!error)return;
 const clean=()=>history.replaceState({},document.title,location.origin+location.pathname);
 let pending=null;try{pending=JSON.parse(sessionStorage.getItem(PENDING)||"null")}catch{}
 if(!pending||pending.csrf!==st||Date.now()-pending.started>12*60*1000){clean();toast("Account authorization expired or failed validation. Please reconnect.");return}
 sessionStorage.removeItem(PENDING);
 const provider=pending.provider;
 if(provider==="simkl"&&u.searchParams.get("iss")!=="https://simkl.com"){clean();toast("Simkl authorization issuer did not match.");return}
 if(error){clean();toast("Account authorization cancelled.");return}
 if(!code||pending.redirect!==exactRedirect()){clean();toast("OAuth callback did not match the registered URL.");return}
 const endpoint=provider==="trakt"?"https://api.trakt.tv/oauth/token":"https://api.simkl.com/oauth2/token";
 const body=new URLSearchParams({grant_type:"authorization_code",client_id:currentClientID(provider),code,redirect_uri:pending.redirect,code_verifier:pending.verifier});
 try{
   const headers=provider==="trakt"?{"Content-Type":"application/json"}:{"Content-Type":"application/x-www-form-urlencoded"};
   const response=await fetch(endpoint,{method:"POST",headers,body:provider==="trakt"?JSON.stringify(Object.fromEntries(body)):body});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.access_token)throw Error(result.error_description||result.message||"OAuth token exchange failed ("+response.status+").");
   data.tokens[provider]={access_token:result.access_token,refresh_token:result.refresh_token||"",scope:result.scope||"",client_id:currentClientID(provider),expires_at:Date.now()+Math.max(60,Number(result.expires_in)||604800)*1000};
   data.lastError="";persist();clean();toast(provider==="trakt"?"Trakt connected.":"Simkl connected.");data.source=provider;persist();await sync(provider,true);
 }catch(e){clean();data.lastError=provider+": "+String(e.message||e);persist();toast(data.lastError.slice(0,175))}
}
async function refreshToken(provider){
 const tok=data.tokens[provider];
 if(!tok?.refresh_token){throw Error(provider+" needs to be reconnected.")}
 const endpoint=provider==="trakt"?"https://api.trakt.tv/oauth/token":"https://api.simkl.com/oauth2/token";
 const fields=new URLSearchParams({grant_type:"refresh_token",refresh_token:tok.refresh_token,client_id:issuedClientID(provider)});
 const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":provider==="trakt"?"application/json":"application/x-www-form-urlencoded"},body:provider==="trakt"?JSON.stringify(Object.fromEntries(fields)):fields});
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result.access_token)throw Error("Could not refresh "+provider+"; reconnect the account.");
 data.tokens[provider]={access_token:result.access_token,refresh_token:result.refresh_token||tok.refresh_token,scope:result.scope||tok.scope,client_id:issuedClientID(provider),expires_at:Date.now()+(Number(result.expires_in)||604800)*1000};persist();
}
async function token(provider){
 if(!online(provider))throw Error("Connect "+provider+" before syncing.");
 if(Date.now()>data.tokens[provider].expires_at-120000)await refreshToken(provider);
 return data.tokens[provider].access_token;
}
async function request(provider,endpoint){
 const access=await token(provider);let uri,headers;
 if(provider==="trakt"){uri="https://api.trakt.tv"+endpoint;headers={"Content-Type":"application/json","trakt-api-key":issuedClientID("trakt"),"trakt-api-version":"2","Authorization":"Bearer "+access}}
 else{uri="https://api.simkl.com"+endpoint;let u=new URL(uri);u.searchParams.set("client_id",issuedClientID("simkl"));u.searchParams.set("app-name","luma-media-center");u.searchParams.set("app-version",VERSION);uri=u.href;headers={"Authorization":"Bearer "+access,"Accept":"application/json"}}
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
 try{const response=await fetch(uri,{headers,signal:controller.signal});if(!response.ok)throw Error(provider+" API returned "+response.status+".");return await response.json()}catch(e){if(e.name==="TypeError")throw Error(provider+" browser requests were blocked by CORS or network rules. Check the registered origin.");throw e}finally{clearTimeout(timeout)}
}
let syncing=false;
async function sync(provider,force=false){
 if(!online(provider)){toast(provider+" is not connected.");return false}
 if(syncing)return false;
 if(!force&&Date.now()-data.fetched[provider]<120000){toast("Recently synced. No need to reload yet.");return true}
 syncing=true;data.lastError="";if(state.tab==="Watchlist")render();
 try{
   let list=[];
   if(provider==="trakt"){
     for(let page=1;page<=15;page++){
       const items=await request("trakt","/sync/watchlist?limit=100&page="+page);
       if(!Array.isArray(items))throw Error("Unexpected Trakt response.");
       list.push(...decodeList("trakt",items));if(items.length<100)break;
     }
   }else{
     // Simkl's mandatory activities-first sync. Never repeatedly pull full lists unchanged.
     const activities=await request("simkl","/sync/activities");
     const oldActivity=data.simklActivity||null;
     if(oldActivity&&activities?.all&&oldActivity?.all===activities.all){
       data.fetched.simkl=Date.now();persist();toast("Simkl watchlist is up to date.");if(state.tab==="Watchlist")render();return true;
     }
     if(oldActivity?.all){
       const delta=await request("simkl","/sync/all-items?date_from="+encodeURIComponent(oldActivity.all));
       const changed=["shows","anime","movies"].flatMap(t=>(delta?.[t]||[]).map(row=>normalizeSimklRow(row,t)).filter(Boolean));
       const changedIDs=new Set(changed.map(x=>x.id));
       list=[...providerItems("simkl").filter(x=>!changedIDs.has(x.id)),...changed.filter(x=>["plantowatch","watching","hold","completed","dropped"].includes(x.userStatus))];
     }else{
       const payload=await request("simkl","/sync/all-items");
       list=decodeList("simkl",payload);
     }
     data.simklActivity=activities;
   }
   const ids=new Set;data.lists[provider]=list.filter(x=>{if(ids.has(x.id))return false;ids.add(x.id);return true});
   data.fetched[provider]=Date.now();persist();toast("Loaded "+data.lists[provider].length+" titles from "+provider+".");
   if(state.tab==="Watchlist")render();
   return true
 }catch(e){data.lastError=String(e.message||e);toast(data.lastError.slice(0,180));if(state.tab==="Watchlist")render();return false}
 finally{syncing=false}
}
function disconnect(provider){
 if(!confirm("Disconnect "+provider+" from Luma? Your account data on "+provider+" will not be deleted."))return;
 data.tokens[provider]=null;data.lists[provider]=[];data.fetched[provider]=0;if(provider==="simkl")data.simklActivity=null;if(data.source===provider)data.source="device";persist();render()
}
function providerItems(provider){return Array.isArray(data.lists[provider])?data.lists[provider]:[]}
function deviceItems(){const snapshots=(()=>{try{return JSON.parse(localStorage.getItem("luma.device.titles.v1")||"{}")}catch{return{}}})();return (Array.isArray(state.watch)?state.watch:[]).map(id=>state.items.find(x=>x.id===id)||snapshots[id]||{id,title:"Saved title",type:"Movie",source:"local",year:""}).filter(Boolean)}
function chosenItems(){
 if(data.source==="device")return deviceItems();
 return providerItems(data.source);
}
const watchView={combined:false,query:"",type:"all",status:"all",sort:"saved",page:0};
let watchSearchTimer=0;
function watchlistMedia(){
 if(watchView.combined)return [...deviceItems().map(x=>({...x,source:"device"})),...providerItems("trakt"),...providerItems("simkl")];
 return data.source==="device"?deviceItems().map(x=>({...x,source:"device"})):providerItems(data.source);
}
function watchlistPoster(item){
 if(item.poster&&/^https:\/\//i.test(item.poster))return item.poster;
 const cached=state.items.find(x=>item.imdbId&&x.imdbId===item.imdbId
  ||item.tmdbId&&x.tmdbId&&String(x.tmdbId)===String(item.tmdbId)
  ||x.title?.toLowerCase()===String(item.title||"").toLowerCase()&&String(x.year||"")===String(item.year||"")&&x.type===item.type);
 return cached?.poster&&/^https:\/\//i.test(cached.poster)?cached.poster:"";
}
function watchlistMarkup(){
 const counts={device:deviceItems().length,trakt:providerItems("trakt").length,simkl:providerItems("simkl").length};
 const labels={device:"On Device",trakt:"Trakt",simkl:"Simkl"};
 const all=watchlistMedia(),query=watchView.query.trim().toLowerCase();
 const statuses=[...new Set(all.map(x=>x.userStatus||"").filter(Boolean))].sort();
 if(watchView.status!=="all"&&!statuses.includes(watchView.status))watchView.status="all";
 let items=all.filter(x=>(watchView.type==="all"||x.type===watchView.type)
    &&(watchView.status==="all"||x.userStatus===watchView.status)
    &&(!query||[x.title,x.year,x.userStatus].some(v=>String(v||"").toLowerCase().includes(query))));
 if(watchView.sort==="title")items.sort((a,b)=>a.title.localeCompare(b.title));
 if(watchView.sort==="year")items.sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0));
 if(watchView.sort==="status")items.sort((a,b)=>String(a.userStatus||"").localeCompare(String(b.userStatus||""))||a.title.localeCompare(b.title));
 if(watchView.sort==="recent")items.sort((a,b)=>String(b.added||"").localeCompare(String(a.added||"")));
 const size=24,pages=Math.max(1,Math.ceil(items.length/size));
 watchView.page=Math.min(Math.max(0,watchView.page),pages-1);
 const page=items.slice(watchView.page*size,(watchView.page+1)*size);
 let html='<section class="collectionIntro"><div class="eyebrow">YOUR LIBRARIES</div><h2>Choose a library or browse them together</h2><p>Each provider stays independent. Browsing together never transfers, deletes, or edits titles between accounts.</p>'
  +'<div class="watchlistModes">'+sources().map(k=>'<button class="watchlistMode '+(!watchView.combined&&data.source===k?"selected":"")+'" data-list-source="'+k+'"><b>'+labels[k]+'</b><span>'+counts[k]+' titles'+(k!=="device"&&online(k)?" · Connected":"")+'</span></button>').join("")+'</div>'
  +'<div class="actions"><button class="secondary '+(watchView.combined?"selected":"")+'" id="watchCombined">'+(watchView.combined?"✓ Browsing together":"Browse all libraries together")+'</button>'
  +(watchView.combined?'<button class="secondary" id="watchSeparate">Show selected library</button>':'')+'</div></section>';
 if(!watchView.combined&&data.source!=="device"&&!online(data.source))html+='<div class="notice">Connect '+labels[data.source]+' in Settings to refresh this library. Previously synced titles are preserved.</div>';
 if(data.lastError)html+='<div class="notice">'+escapeText(data.lastError)+'</div>';
 if(!watchView.combined&&data.source!=="device"&&online(data.source))html+='<div class="toolbar"><button class="secondary" id="syncSelected" '+(syncing?"disabled":"")+'>↻ '+(syncing?"Syncing…":"Refresh "+labels[data.source])+'</button><small>Last fetched: '+(data.fetched[data.source]?new Date(data.fetched[data.source]).toLocaleString():"Not yet")+'</small></div>';
 html+='<div class="collectionControls"><label>Search library<input type="search" id="watchSearch" value="'+escapeText(watchView.query)+'" placeholder="Title, year or status"></label>'
   +'<label>Type<select id="watchType"><option value="all">All types</option>'+["Movie","Series","Anime"].map(t=>'<option value="'+t+'"'+(watchView.type===t?' selected':'')+'>'+t+'</option>').join("")+'</select></label>'
   +'<label>Status<select id="watchStatus"><option value="all">All statuses</option>'+statuses.map(t=>'<option value="'+escapeText(t)+'"'+(watchView.status===t?' selected':'')+'>'+escapeText(t)+'</option>').join("")+'</select></label>'
   +'<label>Sort<select id="watchSort">'+[["saved","Original order"],["title","Title A–Z"],["year","Newest year"],["status","Status"],["recent","Recently added"]].map(([id,label])=>'<option value="'+id+'"'+(watchView.sort===id?' selected':'')+'>'+label+'</option>').join("")+'</select></label></div>';
 html+='<div class="collectionHeading"><h2>'+(watchView.combined?"All libraries":labels[data.source])+'</h2><span>'+items.length+' matching titles</span></div>';
 if(items.length)html+='<div class="tiles collectionGrid">'+page.map(x=>{const poster=watchlistPoster(x);
   return '<button class="media" data-account-title="'+escapeText(x.id)+'" data-account-source="'+escapeText(x.source||"device")+'"><div class="art" style="--c1:#53334f"><div class="posterText">'+escapeText(x.title)+'</div>'
   +(poster?'<img loading="lazy" src="'+escapeText(poster)+'" alt="" onerror="this.remove()">':"")+'</div><div class="iteminfo"><b>'+escapeText(x.title)+'</b><small>'+escapeText(x.year||"")+' · '+escapeText(x.type)+'</small><small>'+escapeText(labels[x.source]||x.source||"On Device")+(x.userStatus?' · '+escapeText(x.userStatus):"")+'</small></div></button>'}).join("")+'</div>';
 else html+='<div class="empty">No titles match these filters. Try changing the library, search or status.</div>';
 if(pages>1)html+='<nav class="collectionPager" aria-label="Watchlist pages"><button class="secondary" id="watchPrev" '+(watchView.page===0?"disabled":"")+'>← Previous</button><span>Page '+(watchView.page+1)+' of '+pages+'</span><button class="secondary" id="watchNext" '+(watchView.page===pages-1?"disabled":"")+'>Next →</button></nav>';
 return html;
}
function watchlistBind(){
 $$("[data-list-source]").forEach(b=>b.onclick=()=>{watchView.combined=false;watchView.page=0;choose(b.dataset.listSource)});
 if($("#watchCombined"))$("#watchCombined").onclick=()=>{watchView.combined=true;watchView.page=0;render()};
 if($("#watchSeparate"))$("#watchSeparate").onclick=()=>{watchView.combined=false;watchView.page=0;render()};
 if($("#syncSelected"))$("#syncSelected").onclick=()=>sync(data.source,true);
 if($("#watchSearch"))$("#watchSearch").oninput=e=>{const value=e.target.value;clearTimeout(watchSearchTimer);watchSearchTimer=setTimeout(()=>{watchView.query=value;watchView.page=0;render();const field=$("#watchSearch");field?.focus();try{field?.setSelectionRange(value.length,value.length)}catch{}},200)};
 for(const [field,key] of [["#watchType","type"],["#watchStatus","status"],["#watchSort","sort"]])if($(field))$(field).onchange=e=>{watchView[key]=e.target.value;watchView.page=0;render()};
 if($("#watchPrev"))$("#watchPrev").onclick=()=>{watchView.page--;render()};
 if($("#watchNext"))$("#watchNext").onclick=()=>{watchView.page++;render()};
 $$("[data-account-title]").forEach(b=>b.onclick=()=>{const source=b.dataset.accountSource,id=b.dataset.accountTitle;
  const entry=watchlistMedia().find(x=>x.id===id&&(x.source||"device")===source);
  if(!entry)return;
  const title={...entry,poster:watchlistPoster(entry)};
  state.items=unique([title,...state.items]);openTitle(title.id);
 });
}

/* Short-code sign-in for Trakt and Simkl. A single registered public app ID is still required per provider. */
let activeDeviceFlow=null;
const deviceConfig={
 trakt:{codeEndpoint:"https://api.trakt.tv/oauth/device/code",tokenEndpoint:"https://api.trakt.tv/oauth/device/token",verification:"https://trakt.tv/activate"},
 simkl:{codeEndpoint:"https://api.simkl.com/oauth2/device",tokenEndpoint:"https://api.simkl.com/oauth2/token",verification:"https://simkl.com/pin"}
};
function currentClientID(provider){return data.ids[provider]||PUBLIC_APP_IDS[provider]||""}
function deviceClientID(provider){return provider==="simkl"?currentClientID("simklDevice"):currentClientID(provider)}
function issuedClientID(provider){return data.tokens[provider]?.client_id||currentClientID(provider)}
function stopDeviceFlow(closePanel=false){
 if(activeDeviceFlow?.timer)clearTimeout(activeDeviceFlow.timer);
 activeDeviceFlow=null;
 if(closePanel){const root=$("#deviceCodePanel");if(root)root.hidden=true}
}
function showDeviceStatus(value,problem=false){
 const root=$("#deviceCodeStatus");if(!root)return;
 root.textContent=String(value||"");root.classList.toggle("deviceError",!!problem)
}
function showActivation(flow){
 const root=$("#deviceCodePanel");if(!root)return;
 root.hidden=false;
 const label=$("#deviceCodeProvider");if(label)label.textContent=flow.provider.toUpperCase();
 const code=$("#deviceUserCode");if(code)code.textContent=flow.user_code;
 const link=$("#deviceVerification");if(link){link.textContent=flow.verification;link.href=flow.verification;link.target="_blank";link.rel="noopener noreferrer"}
 const full=$("#deviceVerificationComplete");
 if(full){const complete=flow.verification_complete||flow.verification;full.href=complete;full.hidden=false;full.target="_blank";full.rel="noopener noreferrer"}
 const expiry=$("#deviceExpires");if(expiry)expiry.textContent="Code expires in "+Math.max(1,Math.ceil((flow.deadline-Date.now())/60000))+" minutes";
 showDeviceStatus("Open the approval page, enter the code and allow Luma. This screen checks automatically.");
 const copy=$("#deviceCopyCode");if(copy)copy.onclick=()=>navigator.clipboard?.writeText(flow.user_code).then(()=>toast("Activation code copied")).catch(()=>toast("Copy unavailable"));
 const check=$("#deviceCheckNow");if(check)check.onclick=()=>pollDeviceFlow(flow);
 const cancel=$("#deviceCancel");if(cancel)cancel.onclick=()=>stopDeviceFlow(true);
}
async function devicePost(url,fields,json=false){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),14000);
 try{
 const response=await fetch(url,{method:"POST",headers:{"Content-Type":json?"application/json":"application/x-www-form-urlencoded"},body:json?JSON.stringify(fields):new URLSearchParams(fields),signal:controller.signal,cache:"no-store"});
 const result=await response.json().catch(()=>({}));
 return {status:response.status,ok:response.ok,result};
 }catch(e){throw Error(e.name==="AbortError"?"Authorization service timed out.":"Authorization service unreachable; check your connection or CORS configuration.")}
 finally{clearTimeout(timeout)}
}
async function connectWithCode(provider){
 if(!deviceConfig[provider])return;
 let id=deviceClientID(provider),field=$("#"+(provider==="simkl"?"simklDevice":provider)+"ClientId");
 if(!id&&field?.value)id=field.value.trim();
 if(!id){showSetupRequired(provider,"device");return}
 if(!deviceClientID(provider)&&!updateID(provider==="simkl"?"simklDevice":provider,id))return;
 stopDeviceFlow();
 const root=$("#deviceCodePanel");if(root)root.hidden=false;
 showDeviceStatus("Requesting an activation code…");
 try{
  let response;
  let deviceVerifier="";
  if(provider==="trakt")response=await devicePost(deviceConfig.trakt.codeEndpoint,{client_id:id},true);
  else{
    if(!crypto?.subtle)throw Error("Secure browser is required for Simkl code sign-in.");
    deviceVerifier=randomBase64url();
    const challenge=await shaChallenge(deviceVerifier);
    response=await devicePost(deviceConfig.simkl.codeEndpoint,{client_id:id,scope:"media:read",code_challenge:challenge,code_challenge_method:"S256"});
  }
  const v=response.result;
  if(!response.ok||!v.device_code||!v.user_code)throw Error(v.error_description||v.message||"Could not create activation code ("+response.status+").");
  const seconds=Math.max(60,Math.min(Number(v.expires_in)||600,1800)),interval=Math.max(5,Math.min(Number(v.interval)||5,60))*1000;
  const verification=String(v.verification_uri||v.verification_url||deviceConfig[provider].verification);
  if(!verification.startsWith("https://"))throw Error("Invalid activation URL returned.");
  const candidate={provider,device_code:v.device_code,user_code:v.user_code,deadline:Date.now()+seconds*1000,interval,verification,verification_complete:typeof v.verification_uri_complete==="string"&&v.verification_uri_complete.startsWith("https://")?v.verification_uri_complete:null,client_id:id,verifier:deviceVerifier,lastPoll:0,timer:null,busy:false};
  activeDeviceFlow=candidate;showActivation(candidate);candidate.timer=setTimeout(()=>pollDeviceFlow(candidate),candidate.interval);
 }catch(e){stopDeviceFlow();showDeviceStatus(e.message||"Activation failed.",true)}
}
async function pollDeviceFlow(flow){
 if(activeDeviceFlow!==flow||flow.busy)return;
 if(Date.now()>=flow.deadline){stopDeviceFlow();showDeviceStatus("The code expired. Select Connect with Code to start again.",true);return}
 const since=Date.now()-flow.lastPoll;
 if(flow.lastPoll&&since<flow.interval){showDeviceStatus("Checking at the service's required interval; keep this page open.");return}
 flow.busy=true;flow.lastPoll=Date.now();
 if(flow.timer)clearTimeout(flow.timer);flow.timer=null;
 try{
  let response;
  if(flow.provider==="trakt")response=await devicePost(deviceConfig.trakt.tokenEndpoint,{code:flow.device_code,client_id:flow.client_id},true);
  else response=await devicePost(deviceConfig.simkl.tokenEndpoint,{grant_type:"urn:ietf:params:oauth:grant-type:device_code",client_id:flow.client_id,device_code:flow.device_code,code_verifier:flow.verifier});
  if(activeDeviceFlow!==flow)return;
  const token=response.result||{};
  if(response.ok&&token.access_token){
   const provider=flow.provider;stopDeviceFlow();
   data.tokens[provider]={access_token:token.access_token,refresh_token:token.refresh_token||"",scope:token.scope||"",client_id:flow.client_id,expires_at:Date.now()+Math.max(60,Number(token.expires_in)||604800)*1000};
   data.lastError="";data.source=provider;persist();
   showDeviceStatus(provider.toUpperCase()+" connected successfully.");
   toast(provider.toUpperCase()+" account connected.");
   await sync(provider,true);
   if(state.tab==="Settings")render();
   return;
  }
  const code=String(token.error||token.result||"").toLowerCase();
  if(code==="authorization_pending"||token.message==="Authorization pending"||code==="ko"){
    showDeviceStatus("Waiting for your approval… Check the activation page and keep this tab open.");
  }else if(code==="slow_down"||String(token.message||"").toLowerCase().includes("slow down")){
    flow.interval+=5000;showDeviceStatus("The provider asked Luma to check less often. Waiting "+Math.ceil(flow.interval/1000)+" seconds.");
  }else if(["expired_token","access_denied","invalid_client","invalid_grant"].includes(code)||response.status===401){
    stopDeviceFlow();showDeviceStatus(token.error_description||token.message||"Authentication was rejected; check the public app ID or restart.",true);return;
  }else{
    showDeviceStatus(token.error_description||token.message||"Waiting for authorization…");
  }
 }catch(e){showDeviceStatus(e.message||"Could not check connection.",true)}
 finally{
  flow.busy=false;
  if(activeDeviceFlow===flow&&Date.now()<flow.deadline)flow.timer=setTimeout(()=>pollDeviceFlow(flow),flow.interval);
 }
}

function showSetupRequired(provider,method="browser"){
 const advanced=$("#accountAdvanced");if(advanced)advanced.open=true;
 const field=$("#"+(provider==="simkl"&&method==="device"?"simklDevice":provider)+"ClientId");field?.focus();
 toast(provider==="simkl"&&method==="device"
  ?"Simkl code activation requires its own separate public device-app ID."
  :"Luma needs its one-time "+provider.toUpperCase()+" app registration before account sign-in can work.");
}
function settingsMarkup(){
 const callback=exactRedirect();
 const providers=["trakt","simkl"];
 const cards=providers.map(k=>{
   const connected=online(k),configured=!!currentClientID(k);
   return '<div class="quickProvider"><div class="quickProviderTitle"><b>'+k.toUpperCase()+'</b><span class="trackerStatus">'+(connected?'Connected':configured?'Ready to sign in':'Setup needed')+'</span></div>'
     +'<p>'+(connected?'Your account is connected. Its library stays separate from your On Device list.':configured?'Sign in on '+(k==="trakt"?'Trakt':'Simkl')+' and approve Luma.':'The Luma site owner must register a free public app ID once before sign-in is available.')+'</p>'
     +'<div class="actions"><button type="button" class="primary" data-browser-connect="'+k+'">'+(connected?'Reconnect '+k.toUpperCase():'Connect '+k.toUpperCase())+'</button>'
     +(k!=="simkl"||!!deviceClientID("simkl")?'<button type="button" class="secondary" data-device-connect="'+k+'">Use activation code</button>':"")
     +(connected?'<button class="secondary" type="button" data-client-disconnect="'+k+'">Disconnect</button>':'')+'</div></div>';
 }).join("");
 return '<section class="settingCard trackerCard"><h2>Connect your watchlists</h2><p>Choose a service and sign in on its official website. Your On Device list is never replaced. Trakt also supports a short activation code. Simkl offers that option only when a separate device-app ID is configured.</p>'
  +'<div class="quickConnect">'+cards+'</div>'
  +'<div class="deviceCodePanel" id="deviceCodePanel" hidden><div class="eyebrow"><span id="deviceCodeProvider">ACCOUNT</span> ACTIVATION</div><p>Enter this code on the service’s official activation page:</p><strong class="deviceUserCode" id="deviceUserCode">—</strong><div class="deviceCodeActions"><button class="secondary" id="deviceCopyCode">Copy Code</button><a id="deviceVerificationComplete" class="deviceOpen" href="#" target="_blank" rel="noopener noreferrer">Open approval page ↗</a></div><p class="micro">Or go to <a id="deviceVerification" href="#" target="_blank" rel="noopener noreferrer">activation site</a> and enter the code.</p><p id="deviceExpires" class="micro"></p><p id="deviceCodeStatus" role="status" class="deviceStatus"></p><div class="actions"><button class="secondary" id="deviceCheckNow">Check Connection</button><button class="secondary" id="deviceCancel">Cancel</button></div></div>'
  +'<details id="accountAdvanced" class="accountAdvanced"><summary>One-time app setup (site owner only)</summary><p class="micro">To enable login, Luma’s owner must register a public app with each provider. This is not your Trakt/Simkl password. Choose a browser/public application with no client secret. The public ID can be configured in Luma or saved in this browser. An app registration is required; GitHub Pages cannot bypass it.</p>'
  +'<div class="callbackLine"><span>'+escapeText(callback)+'</span><button class="secondary small" id="copyCallback">Copy Callback</button></div>'
  +providers.map(k=>'<label>'+k.toUpperCase()+' public application ID<input type="text" id="'+k+'ClientId" value="'+escapeText(data.ids[k]||PUBLIC_APP_IDS[k]||'')+'" autocomplete="off" placeholder="Public app ID (not a secret)"></label><div class="actions"><button class="secondary" data-client-save="'+k+'">Save '+k.toUpperCase()+' ID in this browser</button></div>').join("")
  +'<p class="micro">Optional: Simkl uses a different public application registration for device/PIN sign-in than for browser login. This is only needed if you want the activation-code option.</p>'
  +'<label>Simkl device-app public ID<input type="text" id="simklDeviceClientId" value="'+escapeText(currentClientID("simklDevice"))+'" autocomplete="off" placeholder="Separate Simkl device app ID"></label><div class="actions"><button class="secondary" data-client-save="simklDevice">Save Simkl device ID</button></div>'
  +'<p class="micro"><a target="_blank" rel="noopener noreferrer" href="https://app.trakt.tv/oauth/applications/new">Register Trakt application</a> · <a target="_blank" rel="noopener noreferrer" href="https://simkl.com/settings/developer/">Register Simkl AUTH V2 application</a></p></details>'
  +'<p class="micro">Account authorization is separate for each service. Provider access needs a real approved app ID, browser network access, and your consent. Connected lists are read separately; Luma does not overwrite cloud lists or On Device titles.</p></section>';
}
function bindSettings(){
 if($("#copyCallback"))$("#copyCallback").onclick=()=>navigator.clipboard.writeText(exactRedirect()).then(()=>toast("Callback copied.")).catch(()=>toast("Copy unavailable."));
 $$("[data-browser-connect]").forEach(b=>b.onclick=()=>oauthStart(b.dataset.browserConnect));
 $$("[data-device-connect]").forEach(b=>b.onclick=()=>connectWithCode(b.dataset.deviceConnect));
 $$("[data-client-save]").forEach(b=>b.onclick=()=>{if(updateID(b.dataset.clientSave,$("#"+b.dataset.clientSave+"ClientId").value))render()});
 $$("[data-client-disconnect]").forEach(b=>b.onclick=()=>{stopDeviceFlow(true);disconnect(b.dataset.clientDisconnect)});
 if(activeDeviceFlow)showActivation(activeDeviceFlow);
}
function init(){exchangeCallback().catch(e=>{toast("Connection failed: "+String(e.message||e).slice(0,100))})}
return {getSource,choose,online,sync,init,chosenItems,deviceItems,watchlistMarkup,watchlistBind,settingsMarkup,bindSettings,providerItems,normalizeTraktRow,normalizeSimklRow,decodeList};
})();
