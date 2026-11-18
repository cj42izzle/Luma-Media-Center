
"use strict";
/* Luma accounts. Public OAuth clients only: never require client secrets in GitHub Pages. */
const LumaAccounts=(()=>{
const VERSION="25",KEY="luma.accounts.v1",PENDING="luma.oauth.pending";
const redirect=location.origin+location.pathname;
function read(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch{return{}}}
const data={source:"device",ids:{trakt:"",simkl:""},tokens:{trakt:null,simkl:null},lists:{trakt:[],simkl:[]},fetched:{trakt:0,simkl:0},lastError:"",...read()};
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
return ["shows","anime","movies"].flatMap(t=>(payload?.[t]||[]).map(row=>normalizeSimklRow(row,t)).filter(Boolean)).filter(row=>row.userStatus==="plantowatch"||row.userStatus==="watching"||row.userStatus==="hold");
}
async function oauthStart(provider){
 if(!["trakt","simkl"].includes(provider))return;
 const id=data.ids[provider];if(!id){toast("Add your public "+provider+" app client ID in Settings first.");return}
 if(!crypto?.subtle){toast("Secure browser is required for account connection.");return}
 const verifier=randomBase64url(),challenge=await shaChallenge(verifier),csrf=randomBase64url();
 sessionStorage.setItem(PENDING,JSON.stringify({provider,csrf,verifier,redirect:exactRedirect(),started:Date.now()}));
 const base=provider==="trakt"?"https://auth.trakt.tv/oauth/authorize":"https://simkl.com/oauth2/authorize";
 const args=new URLSearchParams({client_id:id,redirect_uri:exactRedirect(),response_type:"code",state:csrf,code_challenge:challenge,code_challenge_method:"S256"});
 if(provider==="simkl")args.set("scope","media:read media:write");
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
 const body=new URLSearchParams({grant_type:"authorization_code",client_id:data.ids[provider],code,redirect_uri:pending.redirect,code_verifier:pending.verifier});
 try{
   const headers=provider==="trakt"?{"Content-Type":"application/json"}:{"Content-Type":"application/x-www-form-urlencoded"};
   const response=await fetch(endpoint,{method:"POST",headers,body:provider==="trakt"?JSON.stringify(Object.fromEntries(body)):body});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.access_token)throw Error(result.error_description||result.message||"OAuth token exchange failed ("+response.status+").");
   data.tokens[provider]={access_token:result.access_token,refresh_token:result.refresh_token||"",scope:result.scope||"",expires_at:Date.now()+Math.max(60,Number(result.expires_in)||604800)*1000};
   data.lastError="";persist();clean();toast(provider==="trakt"?"Trakt connected.":"Simkl connected.");data.source=provider;persist();await sync(provider,true);
 }catch(e){clean();data.lastError=provider+": "+String(e.message||e);persist();toast(data.lastError.slice(0,175))}
}
async function refreshToken(provider){
 const tok=data.tokens[provider];
 if(!tok?.refresh_token){throw Error(provider+" needs to be reconnected.")}
 const endpoint=provider==="trakt"?"https://api.trakt.tv/oauth/token":"https://api.simkl.com/oauth2/token";
 const fields=new URLSearchParams({grant_type:"refresh_token",refresh_token:tok.refresh_token,client_id:data.ids[provider]});
 const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":provider==="trakt"?"application/json":"application/x-www-form-urlencoded"},body:provider==="trakt"?JSON.stringify(Object.fromEntries(fields)):fields});
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result.access_token)throw Error("Could not refresh "+provider+"; reconnect the account.");
 data.tokens[provider]={access_token:result.access_token,refresh_token:result.refresh_token||tok.refresh_token,scope:result.scope||tok.scope,expires_at:Date.now()+(Number(result.expires_in)||604800)*1000};persist();
}
async function token(provider){
 if(!online(provider))throw Error("Connect "+provider+" before syncing.");
 if(Date.now()>data.tokens[provider].expires_at-120000)await refreshToken(provider);
 return data.tokens[provider].access_token;
}
async function request(provider,endpoint){
 const access=await token(provider);let uri,headers;
 if(provider==="trakt"){uri="https://api.trakt.tv"+endpoint;headers={"Content-Type":"application/json","trakt-api-key":data.ids.trakt,"trakt-api-version":"2","Authorization":"Bearer "+access}}
 else{uri="https://api.simkl.com"+endpoint;let u=new URL(uri);u.searchParams.set("client_id",data.ids.simkl);u.searchParams.set("app-name","luma-media-center");u.searchParams.set("app-version",VERSION);uri=u.href;headers={"Authorization":"Bearer "+access,"Accept":"application/json"}}
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
       const items=await request("trakt","/sync/watchlist?type=movies,shows&limit=100&page="+page);
       if(!Array.isArray(items))throw Error("Unexpected Trakt response.");
       list.push(...decodeList("trakt",items));if(items.length<100)break;
     }
   }else{
     // One initial explicit pull or manual refresh. Never poll Simkl all-items automatically.
     const payload=await request("simkl","/sync/all-items");
     list=decodeList("simkl",payload);
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
 data.tokens[provider]=null;data.lists[provider]=[];data.fetched[provider]=0;if(data.source===provider)data.source="device";persist();render()
}
function providerItems(provider){return Array.isArray(data.lists[provider])?data.lists[provider]:[]}
function chosenItems(){
 if(data.source==="device")return state.items.filter(x=>state.watch.includes(x.id));
 return providerItems(data.source);
}
function watchlistMarkup(){
 const counts={device:state.watch.length,trakt:data.lists.trakt.length,simkl:data.lists.simkl.length};
 const labels={device:"On Device",trakt:"Trakt",simkl:"Simkl"};
 let html='<div class="watchlistPicker"><div class="eyebrow">YOUR WATCHLIST SOURCE</div><h2>Choose which library Luma displays</h2><div class="watchlistModes">'+sources().map(k=>'<button class="watchlistMode '+(data.source===k?"selected":"")+'" data-list-source="'+k+'"><b>'+labels[k]+'</b><span>'+counts[k]+' titles'+(k!=="device"&&online(k)?" · Connected":"")+'</span></button>').join("")+'</div><p class="micro">On Device stores changes in this browser. Trakt and Simkl lists are fetched from the connected account and displayed separately; switching sources never overwrites another list.</p></div>';
 if(data.source!=="device"&&!online(data.source))html+='<div class="notice">Connect '+labels[data.source]+' in Settings before loading its watchlist.</div>';
 if(data.lastError)html+='<div class="notice">'+escapeText(data.lastError)+'</div>';
 if(data.source!=="device"&&online(data.source))html+='<div class="toolbar"><button class="secondary" id="syncSelected" '+(syncing?"disabled":"")+'>↻ '+(syncing?"Syncing…":"Refresh "+labels[data.source])+'</button><small>Last fetched: '+(data.fetched[data.source]?new Date(data.fetched[data.source]).toLocaleString():"Not yet")+'</small></div>';
 const items=chosenItems();
 if(items.length)html+='<section class="shelf"><div class="shelfhead"><h2>'+labels[data.source]+' watchlist</h2><span>'+items.length+' titles</span></div><div class="tiles">'+items.map(x=>'<button class="media" data-account-title="'+escapeText(x.id)+'"><div class="art" style="--c1:#53334f"><div class="posterText">'+escapeText(x.title)+'</div>'+(x.poster?'<img loading="lazy" src="'+escapeText(x.poster)+'" alt="" onerror="this.remove()">':"")+'</div><div class="iteminfo"><b>'+escapeText(x.title)+'</b><small>'+escapeText(x.year||"")+' · '+escapeText(x.type)+'</small></div></button>').join("")+'</div></section>';
 else html+='<div class="empty">'+(data.source==="device"?"No saved titles yet. Use the ♡ button on movies or shows to add them.":"No titles loaded for this list.")+'</div>';
 return html;
}
function watchlistBind(){
 $$("[data-list-source]").forEach(b=>b.onclick=()=>choose(b.dataset.listSource));
 if($("#syncSelected"))$("#syncSelected").onclick=()=>sync(data.source,true);
 $$("[data-account-title]").forEach(b=>b.onclick=()=>{const title=chosenItems().find(x=>x.id===b.dataset.accountTitle);if(!title)return;state.items=unique([title,...state.items]);openTitle(title.id)});
}
function settingsMarkup(){
 const callback=exactRedirect();
 return'<section class="settingCard trackerCard"><h2>Watchlist & cloud accounts</h2><p>Keep three independent watchlists: this device, Trakt, or Simkl. Connect each service with OAuth 2.0 + PKCE, without sharing an app secret.</p><p class="micro">Register the callback URL below exactly with your Trakt and Simkl developer applications, and register the GitHub Pages origin for Trakt CORS.</p><div class="callbackLine"><span>'+escapeText(callback)+'</span><button class="secondary small" id="copyCallback">Copy</button></div>'+["trakt","simkl"].map(k=>'<div class="trackerProvider"><div><strong>'+k.toUpperCase()+'</strong><span class="trackerStatus">'+(online(k)?"Connected":"Not connected")+'</span></div><label>Public client ID<input type="text" id="'+k+'ClientId" value="'+escapeText(data.ids[k]||"")+'" placeholder="Paste public client ID, never a secret"></label><div class="actions"><button class="secondary" data-client-save="'+k+'">Save ID</button><button class="primary" data-client-connect="'+k+'">'+(online(k)?"Reconnect":"Connect "+k)+'</button>'+(online(k)?'<button class="secondary" data-client-disconnect="'+k+'">Disconnect</button>':"")+'</div></div>').join("")+'<p class="micro"><a target="_blank" rel="noopener" href="https://app.trakt.tv/oauth/applications/new">Create Trakt API app</a> · <a target="_blank" rel="noopener" href="https://simkl.com/settings/developer/">Create Simkl AUTH V2 app</a>. Use a browser/public client and do not enter secret keys.</p><p class="micro">True iCloud/CloudKit requires an Apple developer CloudKit container; it is not connected in this static GitHub Pages build. Export your device backup from Settings in the meantime. External players cannot automatically upload playback progress to this website.</p></section>'
}
function bindSettings(){
 if($("#copyCallback"))$("#copyCallback").onclick=()=>navigator.clipboard.writeText(exactRedirect()).then(()=>toast("Callback address copied.")).catch(()=>toast("Copy is unavailable in this browser."));
 $$("[data-client-save]").forEach(b=>b.onclick=()=>updateID(b.dataset.clientSave,$("#"+b.dataset.clientSave+"ClientId").value));
 $$("[data-client-connect]").forEach(b=>b.onclick=async()=>{let k=b.dataset.clientConnect;const val=$("#"+k+"ClientId").value;if(!updateID(k,val))return;await oauthStart(k)});
 $$("[data-client-disconnect]").forEach(b=>b.onclick=()=>disconnect(b.dataset.clientDisconnect));
}
function init(){exchangeCallback().catch(e=>{toast("Connection failed: "+String(e.message||e).slice(0,100))})}
return {getSource,choose,online,sync,init,watchlistMarkup,watchlistBind,settingsMarkup,bindSettings,providerItems,normalizeTraktRow,normalizeSimklRow,decodeList};
})();
