
"use strict";
/* First-run episode calendar. TVmaze schedule airstamp has timezone; when missing, show date only. */
const LumaCalendar=(()=>{
 const DAY=86400000,CACHE_TTL=15*60*1000;
 let selected=new Date(),loaded=new Map(),inflight=new Map(),viewMode="month",scope="auto",country="US",busy=false,status="",lastBatch=0;
 const storageKey="luma.epcalendar.v1";
 const today=()=>new Date();
 const pad=n=>String(n).padStart(2,"0");
 const isoLocal=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
 const noon=(year,month,day)=>new Date(year,month,day,12);
 const shifted=(d,offset)=>noon(d.getFullYear(),d.getMonth(),d.getDate()+offset);
 const weekStart=d=>shifted(d,-(d.getDay()+6)%7);
 const esc=s=>safe(s);
 const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"Device time";
 const fmtDate=d=>new Intl.DateTimeFormat(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(d);
 const fmtTime=ms=>new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",timeZone:tz}).format(new Date(ms));
 const typeKey=show=>String(show?.id||"");
 function scheduleKey(date){return country+"|"+date}
 function episodeKey(e){return "tvmaze:"+e.showId}
 function follows(){const titles=state.items.filter(x=>x.type==="Series"||x.type==="Anime"),saved=state.watch.filter(id=>titles.some(x=>x.id===id&&x.type==="Series"||x.id===id&&x.type==="Anime"));return saved}
 function hasFollowing(){return follows().length>0}
 function scopeMode(){return scope==="auto"?(hasFollowing()?"following":"all"):scope}
 function readCache(){try{const raw=JSON.parse(localStorage.getItem(storageKey)||"{}");if(!raw||typeof raw!=="object")return;for(const [k,v] of Object.entries(raw)){if(v&&Array.isArray(v.rows)&&Date.now()-v.at<CACHE_TTL)loaded.set(k,v)}}catch{}}
 function storeCache(){try{let list=[...loaded.entries()].sort((a,b)=>b[1].at-a[1].at).slice(0,56);localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(list)))}catch{}}
 function normalize(e,feed,sourceDate){
   if(!e||!e.show||!e.show.id||!e.id||!e.airdate)return null;
   // Schedule may contain repeats: only accept the announced original date on this schedule.
   if(e.airdate!==sourceDate)return null;
   if(e.number===null||Number(e.number)<1||!Number(e.season))return null;
   const stamp=typeof e.airstamp==="string"?Date.parse(e.airstamp):NaN;
   const timeKnown=Number.isFinite(stamp)&&!!e.airtime;
   let show=e.show;
   return {id:"tvmaze-episode:"+e.id,showId:show.id,title:show.name||"TV series",episode:e.name||"New episode",season:e.season,number:e.number,airdate:e.airdate,airStamp:timeKnown?stamp:null,timeLabel:timeKnown?fmtTime(stamp):"Time not announced",channel:show.network?.name||show.webChannel?.name||"",image:e.image?.medium||show.image?.medium||"",showPoster:show.image?.medium||"",showStatus:show.status||"",source:feed,originalId:e.id};
 }
 async function fetchDay(date,force=false){
   const key=scheduleKey(date),hit=loaded.get(key);
   if(!force&&hit&&Date.now()-hit.at<CACHE_TTL)return hit.rows;
   if(inflight.has(key))return inflight.get(key);
   const run=(async()=>{
     let outputs=await Promise.allSettled([api("https://api.tvmaze.com/schedule?country="+encodeURIComponent(country)+"&date="+date),api("https://api.tvmaze.com/schedule/web?date="+date)]);
     let good=outputs.filter(x=>x.status==="fulfilled"),rows=[];
     if(!good.length)throw Error("TV schedule service could not be reached");
     for(let i=0;i<outputs.length;i++)if(outputs[i].status==="fulfilled")rows.push(...(Array.isArray(outputs[i].value)?outputs[i].value:[]).map(e=>normalize(e,i===0?"broadcast":"streaming",date)).filter(Boolean));
     const ids=new Set;rows=rows.filter(e=>{if(ids.has(e.id))return false;ids.add(e.id);return true});
     loaded.set(key,{at:Date.now(),rows});storeCache();return rows
   })().finally(()=>inflight.delete(key));
   inflight.set(key,run);return run
 }
 function linkedId(x){
   if(x?.mazeId)return Number(x.mazeId);
   if(x?.calendarMazeId)return Number(x.calendarMazeId);
   return null;
 }
 let resolved=new Map(),resolvePending=new Set();
 function isFollowed(e){
   if(!hasFollowing())return false;
   const candidates=state.items.filter(x=>state.watch.includes(x.id)&&(x.type==="Series"||x.type==="Anime"));
   return candidates.some(x=>linkedId(x)===e.showId||resolved.get(x.id)===e.showId||String(x.title).trim().toLowerCase()===e.title.trim().toLowerCase()&&String(x.year||"").slice(0,4)===String(e.airdate||"").slice(0,4)&&false);
 }
 async function resolveFollowing(){
   const titles=state.items.filter(x=>state.watch.includes(x.id)&&(x.type==="Series"||x.type==="Anime"));
   const pending=titles.filter(x=>!linkedId(x)&&!resolved.has(x.id)&&!resolvePending.has(x.id)).slice(0,12);
   if(!pending.length)return;
   await Promise.allSettled(pending.map(async x=>{
     resolvePending.add(x.id);
     try{
       const matches=await api("https://api.tvmaze.com/search/shows?q="+encodeURIComponent(x.title));
       const clean=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
       const candidates=(Array.isArray(matches)?matches:[]).map(y=>y.show).filter(y=>y?.id&&clean(y.name)===clean(x.title));
       const byYear=candidates.filter(y=>!x.year||(y.premiered||"").slice(0,4)===String(x.year));
       if(byYear.length===1)resolved.set(x.id,Number(byYear[0].id));
     }catch{}finally{resolvePending.delete(x.id)}
   }));
 }
 function relevant(rows){return scopeMode()==="following"?rows.filter(isFollowed):rows}
 function allRows(){const rows=[...loaded.entries()].filter(([key])=>key.startsWith(country+"|")).flatMap(([_,v])=>v.rows);const seen=new Set;return rows.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true})}
 function atLocalDay(e){
   // use the canonical airstamp when available to prevent timezone boundary errors.
   return e.airStamp?isoLocal(new Date(e.airStamp)):e.airdate
 }
 function dateRows(d){return relevant(allRows()).filter(e=>atLocalDay(e)===isoLocal(d)).sort((a,b)=>(a.airStamp??Infinity)-(b.airStamp??Infinity)||a.title.localeCompare(b.title))}
 function showFrom(e){return{id:"tvmaze:"+e.showId,mazeId:e.showId,title:e.title,type:"Series",source:"tvmaze",poster:e.showPoster||e.image,backdrop:e.showPoster||e.image,year:"",overview:"",tvStatus:e.showStatus,genreNames:[],date:e.airdate}}
 function openEpisode(e){
   const x=showFrom(e);
   state.items=unique([x,...state.items]);
   openTitle(x.id);
 }
 function episodeCard(e){const starred=isFollowed(e),key="tvmaze:"+e.showId;const time=e.timeLabel,series=e.title,ep="S"+pad(e.season)+" · E"+pad(e.number);
   const pill=e.airStamp&&e.airStamp>Date.now()?"Upcoming":e.airStamp?"Aired":"Date announced";
   return'<article class="calEvent"><button class="calPoster" data-epid="'+esc(e.id)+'" aria-label="Open '+esc(series)+'">'+(e.image?'<img loading="lazy" src="'+esc(e.image)+'" alt="" onerror="this.remove()">':'<span>▶</span>')+'</button><div class="calEventMain"><div class="calEventTop"><b>'+esc(series)+'</b><span class="calAiringState">'+pill+'</span></div><div class="calEpisodeName">'+esc(e.episode)+'</div><div class="calEventMeta"><span>'+esc(ep)+'</span><span>'+esc(time)+'</span>'+(e.channel?'<span>'+esc(e.channel)+'</span>':'')+'</div></div><div class="calEventActions"><button class="secondary small" data-epid="'+esc(e.id)+'">Details</button><button class="secondary small calFollow '+(starred?"is-following":"")+'" data-followep="'+esc(e.id)+'" aria-label="'+(starred?"Remove from watchlist":"Follow show")+'">'+(starred?"♥ Following":"♡ Follow")+'</button></div></article>'}
 function renderDays(){
   const month=selected.getMonth(),start=weekStart(noon(selected.getFullYear(),month,1));
   let headers=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(x=>'<span>'+x+'</span>').join("");
   let grid=Array.from({length:42},(_,i)=>{let d=shifted(start,i),key=isoLocal(d),localRows=dateRows(d),isPicked=isoLocal(d)===isoLocal(selected),isToday=isoLocal(d)===isoLocal(today()),loadedDay=loaded.has(scheduleKey(key));return'<button type="button" class="calDay '+(d.getMonth()!==month?"outside ":"")+(isPicked?"picked ":"")+(isToday?"today":"")+'" data-day="'+key+'" aria-label="'+fmtDate(d)+'"><span>'+d.getDate()+'</span>'+(localRows.length?'<i>'+Math.min(9,localRows.length)+'</i>':loadedDay?'<i class="calDotEmpty"></i>':'')+'</button>'}).join("");
   return'<div class="calWeekdays">'+headers+'</div><div class="calGrid">'+grid+'</div>'
 }
 function listDays(){
   const monday=weekStart(selected);
   return'<div class="calWeekStrip">'+Array.from({length:7},(_,i)=>{let d=shifted(monday,i),current=isoLocal(d)===isoLocal(selected);return'<button class="calStripDay '+(current?"picked":"")+'" data-day="'+isoLocal(d)+'"><b>'+new Intl.DateTimeFormat(undefined,{weekday:"short"}).format(d)+'</b><span>'+d.getDate()+'</span></button>'}).join("")+'</div>'
 }
 function header(){
   const dateTitle=viewMode==="month"?new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(selected):fmtDate(selected);
   const followsCount=follows().length;
   return'<header class="calHeader"><div><div class="eyebrow">LUMA EPISODE CALENDAR</div><h2>New episodes, right on time</h2><p>Fresh first-airing episodes · times displayed in '+esc(tz)+'</p></div><button id="calJumpToday" class="secondary">Today</button></header><div class="calControlBar"><div class="calNav"><button id="calPrev" class="calArrow" aria-label="Previous">‹</button><b>'+esc(dateTitle)+'</b><button id="calNext" class="calArrow" aria-label="Next">›</button></div><div class="calSettings"><label>View<select id="calView"><option value="month">Month</option><option value="week">Week</option></select></label><label>Shows<select id="calScope"><option value="auto">Smart default</option><option value="all">All new episodes</option><option value="following">Following only</option></select></label></div></div><div class="calModeHint">'+(scopeMode()==="following"?"Showing episodes from "+followsCount+" followed series. Switch to All to browse other releases.":"Showing all new scheduled episodes until you follow shows.")+'</div>'
 }
 function render(){
   const el=$("#content");if(!el)return;const key=isoLocal(selected);
   const isLoaded=loaded.has(scheduleKey(key));
   const events=dateRows(selected);
   let html=header()+(viewMode==="week"?listDays():renderDays())+'<div class="calSelected"><div class="calSelectedTop"><h3>'+fmtDate(selected)+'</h3><span>'+events.length+' new episode'+(events.length===1?"":"s")+'</span></div>';
   if(status)html+='<div class="notice">'+esc(status)+'</div>';
   if(busy&&!isLoaded)html+='<div class="loading">Loading schedules…</div>';
   if(events.length)html+='<div class="calEventList">'+events.map(episodeCard).join("")+'</div>';
   else if(!busy)html+='<div class="calEmpty">'+(scopeMode()==="following"?"No new episodes from followed shows on this date.":"No confirmed new episodes for this date in the loaded schedules.")+'</div>';
   html+='</div><p class="micro calNote">TV data by TVmaze. Times are localized from official episode timestamps. Global streaming releases may provide a date without an exact hour. Schedule information can change; reruns are excluded where original-airdate data permits.</p>';
   el.innerHTML=html;bind()
 }
 function bind(){
   $("#calPrev").onclick=()=>move(viewMode==="month"?-30:-7);
   $("#calNext").onclick=()=>move(viewMode==="month"?30:7);
   $("#calJumpToday").onclick=()=>{selected=today();refreshSelection()};
   $("#calView").value=viewMode;$("#calView").onchange=e=>{viewMode=e.target.value;render()};
   $("#calScope").value=scope;$("#calScope").onchange=e=>{scope=e.target.value;refreshSelection()};
   $$("[data-day]").forEach(b=>b.onclick=()=>{const [y,m,d]=b.dataset.day.split("-").map(Number);selected=noon(y,m-1,d);refreshSelection()});
   const events=allRows();
   $$("[data-epid]").forEach(b=>b.onclick=()=>{let e=events.find(x=>x.id===b.dataset.epid);if(e)openEpisode(e)});
   $$("[data-followep]").forEach(b=>b.onclick=()=>{let e=events.find(x=>x.id===b.dataset.followep);if(!e)return;const x=showFrom(e);state.items=unique([x,...state.items]);state.watch=state.watch.includes(x.id)?state.watch.filter(id=>id!==x.id):[...state.watch,x.id];save("watch",state.watch);render()});
 }
 function move(n){if(viewMode==="month"){selected=noon(selected.getFullYear(),selected.getMonth()+(n>0?1:-1),Math.min(selected.getDate(),28))}else selected=shifted(selected,n);refreshSelection()}
 let activeRender=0;
 async function refreshSelection(){
   const version=++activeRender,key=isoLocal(selected);busy=true;status="";render();
   try{
     await Promise.allSettled([fetchDay(key),resolveFollowing()]);
     if(version!==activeRender)return;
     // Preload only nearby days, not the entire web catalogue. Every arbitrary day remains navigable.
     const days=Array.from({length:7},(_,i)=>isoLocal(shifted(selected,i-3))).filter(d=>d!==key);
     Promise.allSettled(days.map((d,i)=>new Promise(resolve=>setTimeout(resolve,Math.floor(i/3)*900)).then(()=>fetchDay(d)))).then(()=>{if(version===activeRender)render()});
   }catch(err){status="Schedule unavailable: "+String(err.message||err).slice(0,100)}
   finally{if(version===activeRender){busy=false;render()}}
 }
 async function upcoming(){
   let start=today();const dates=Array.from({length:4},(_,i)=>isoLocal(shifted(start,i)));
   await Promise.allSettled(dates.map(fetchDay));return allRows().filter(e=>e.airStamp===null||e.airStamp>=Date.now()-3600000).filter(e=>e.airdate>=isoLocal(shifted(start,-1))).sort((a,b)=>(a.airStamp||Infinity)-(b.airStamp||Infinity)).slice(0,18)
 }
 function homeMarkup(){
   const upcomingRows=allRows().filter(e=>e.airStamp?e.airStamp>=Date.now()-3600000:e.airdate>=isoLocal(today())).sort((a,b)=>(a.airStamp??Infinity)-(b.airStamp??Infinity));
   const results=upcomingRows.filter(e=>!hasFollowing()||isFollowed(e)).slice(0,12);
   if(!results.length)return'<section class="shelf calHome"><div class="shelfhead"><h2>📺 New episodes airing</h2><button class="secondary small" id="openCal">Full calendar</button></div><p class="micro">Live schedules load when you open the calendar.</p></section>';
   return'<section class="shelf calHome"><div class="shelfhead"><h2>📺 New episodes airing</h2><button class="secondary small" id="openCal">View calendar</button></div><div class="calHomeRail">'+results.map(e=>'<button class="calHomeCard" data-epid="'+esc(e.id)+'"><strong>'+esc(e.title)+'</strong><span>'+esc("S"+e.season+"E"+e.number+" · "+e.episode)+'</span><span>'+esc(e.timeLabel)+' · '+esc(e.channel||"Streaming / TV")+'</span></button>').join("")+'</div></section>'
 }
 function bindHome(){if($("#openCal"))$("#openCal").onclick=()=>{state.tab="Calendar";renderMain()};const byId=new Map(allRows().map(e=>[e.id,e]));$$(".calHome [data-epid]").forEach(b=>b.onclick=()=>{const e=byId.get(b.dataset.epid);if(e)openEpisode(e)})}
 function renderMain(){render()}
 function start(){readCache();refreshSelection()}
 return {start,render,homeMarkup,bindHome,upcoming,refreshSelection,scopeMode,getRows:()=>allRows(),__test:{normalize,isoLocal,shifted,showFrom,fmtTime}};
})();
