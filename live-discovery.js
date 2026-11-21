"use strict";
const LumaToday=(()=>{
 const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const dayKey=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
 const clock=t=>new Date(t).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
 function context(date){
  const m=date.getMonth()+1,d=date.getDate(),w=date.getDay(),nth=Math.ceil(d/7);
  if(m===11&&w===4&&nth===4)return "Thanksgiving";
  if(m===11&&w===5&&d>=23&&d<=29)return "Thanksgiving weekend";
  if(m===12&&d===24)return "Christmas Eve";
  if(m===12&&d===25)return "Christmas Day";
  if(m===12&&d===31)return "New Year’s Eve";
  if(m===1&&d===1)return "New Year’s Day";
  if(m===7&&d===4)return "Independence Day";
  if(m===10&&d===31)return "Halloween";
  if(m===5&&w===1&&d+7>31)return "Memorial Day";
  if(m===9&&w===1&&nth===1)return "Labor Day";
  if(m===11&&d>=15||m===12)return "Holiday season";
  return ["Winter","Spring","Summer","Fall"][Math.floor((m%12)/3)];
 }
 function classify(row,season){
  const words=[row.title,row.subtitle,row.genre].filter(Boolean).join(" ");
  const holiday=/\b(christmas|thanksgiving|hanukkah|kwanzaa|holiday|santa|yuletide|nutcracker|halloween|new year['’]?s|independence day)\b/i.test(words);
  if(/\b(parade|dog show|kennel club|dog agility|canine championship)\b/i.test(words))return ["Special events","Special event",96];
  if(holiday)return ["Holiday picks",season==="Holiday season"||/Thanksgiving|Christmas/.test(season)?"Holiday spotlight":"Holiday programming",91];
  if(row.sport||/\b(sports?|football|basketball|hockey|soccer|tennis|baseball|racing|ufc|boxing|wrestling|golf|nfl|nhl|nba|mlb)\b/i.test(words))
   return ["Sports",/\b(championship|finals?|playoffs?|cup)\b/i.test(words)?"Championship watch":"Sports",row.liveEvent?90:78];
  if(/\b(awards|premiere|finale|concert|festival)\b/i.test(words))return ["Special events","Entertainment event",87];
  if(row.fresh)return ["Entertainment","New episode",77];
  return ["Entertainment","On TV",48];
 }
 const leagues=["football/nfl","football/college-football","basketball/nba","basketball/wnba","basketball/mens-college-basketball","basketball/womens-college-basketball","hockey/nhl","baseball/mlb","soccer/usa.1","soccer/eng.1","soccer/fifa.world","racing/nascar-premier","golf/pga","mma/ufc"];
 let host=null,guide=[],stations=new Map(),favs=new Set(),day=0,category="Highlights",expanded=false;
 const feeds=new Map(),pending=new Map();
 let lastPaint="",timer=null;
 function dateFor(offset){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+offset);return d}
 function tvRows(rows){return rows.filter(e=>e.airstamp&&e.show?.name).map(e=>({id:"maze-"+e.id,title:e.show.name,subtitle:e.name,start:Date.parse(e.airstamp),end:Date.parse(e.airstamp)+(e.runtime||0)*60000,station:e.show.network?.name||e.show.webChannel?.name||"",genre:[e.show.type,...(e.show.genres||[])].join(" "),image:e.show.image?.medium,weight:e.show.weight||0,source:"TVmaze",fresh:true,url:e.url}))}
 function sportRows(data){return (data.events||[]).filter(e=>!e.status?.type?.completed&&!/postponed|cancel/i.test(e.status?.type?.name||"")).map(e=>({id:"espn-"+e.uid,title:e.name,start:Date.parse(e.date),onAir:e.status?.type?.state==="in",sport:true,liveEvent:true,station:(e.competitions?.[0]?.broadcasts||[]).flatMap(b=>b.names||[]).join(" / "),subtitle:e.competitions?.[0]?.notes?.[0]?.headline||"",source:"ESPN",url:e.links?.[0]?.href}))}
 async function refresh(){
  if(!host?.isConnected||document.hidden)return;
  const key=dayKey(dateFor(day));
  if(pending.has(key))return;
  const prior=feeds.get(key);
  if(prior&&Date.now()-prior.at<10*60000){paint();return}
  pending.set(key,true);
  const urls=[["TVmaze","https://api.tvmaze.com/schedule?country=US&date="+key,tvRows],...leagues.map(l=>[l,"https://site.api.espn.com/apis/site/v2/sports/"+l+"/scoreboard?dates="+key.replaceAll("-",""),sportRows])];
  const groups=new Map(prior?.groups||[]);let failed=0,cursor=0;
  async function worker(){while(cursor<urls.length){
   const [source,url,parse]=urls[cursor++];const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
   try{const r=await fetch(url,{signal:controller.signal,credentials:"omit"});if(!r.ok)throw Error();groups.set(source,parse(await r.json()))}catch{failed++}finally{clearTimeout(timeout)}
  }}
  try{await Promise.all(Array.from({length:4},worker));feeds.set(key,{at:Date.now(),groups,failed});
   for(const k of feeds.keys())if(k<dayKey(dateFor(0)))feeds.delete(k);
  }finally{pending.delete(key);paint()}
 }
 function rows(){
  const start=dateFor(day).getTime(),end=dateFor(day+1).getTime(),now=Date.now(),season=context(new Date(start));
  const result=[],seen=new Set(),feed=feeds.get(dayKey(new Date(start)));
  function add(r){
   if(!r.title||!Number.isFinite(r.start)||r.start>=end||(!r.onAir&&(r.end>r.start?r.end<=Math.max(start,now):r.start<Math.max(start,now))))return;
   const key=[r.title.toLowerCase().trim(),r.start,r.station?.toLowerCase()].join("|");if(seen.has(key))return;seen.add(key);
   const [group,why,weight]=classify(r,season);
   const live=r.onAir||r.start<=now&&r.end>now;
   result.push({...r,group,why,live,score:weight+Math.min(12,(r.weight||0)/8)+(r.favorite?9:0)+(live?6:0)+(r.fresh?4:0)});
  }
  for(const p of guide){const station=stations.get(p.channel_id);if(station)add({id:"guide-"+p.id,guideId:p.id,title:p.title,subtitle:p.subtitle,genre:[p.category,p.categories,station.group].join(" "),station:station.name,start:Number(p.start),end:Number(p.end),favorite:favs.has(station.id),fresh:p.is_new&&!p.rerun,liveEvent:p.is_live_event,source:"Your guide"})}
  for(const values of feed?.groups.values()||[])for(const row of values)add(row);
  return result.sort((a,b)=>b.score-a.score||a.start-b.start||a.title.localeCompare(b.title));
 }
 function reminder(r){
  const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,"").split(".")[0]+"Z";
  const clean=s=>String(s||"").replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/[,;]/g,m=>"\\"+m);
  const data=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Luma//TV Reminders//EN","BEGIN:VEVENT","UID:"+encodeURIComponent(r.id)+"-"+r.start+"@luma","DTSTAMP:"+stamp(Date.now()),"DTSTART:"+stamp(r.start),"SUMMARY:"+clean(r.title),"LOCATION:"+clean(r.station),"BEGIN:VALARM","ACTION:DISPLAY","TRIGGER:-PT15M","DESCRIPTION:"+clean(r.title),"END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n")+"\r\n";
  const url=URL.createObjectURL(new Blob([data],{type:"text/calendar;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="Luma-TV-reminder.ics";a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 function paint(){
  if(!host?.isConnected)return;
  const date=dateFor(day),feed=feeds.get(dayKey(date)),all=rows();
  const eligible=category==="Highlights"?all:all.filter(r=>r.group===category);
  const picks=eligible.slice(0,expanded?80:12);
  if(category==="Highlights"&&!expanded){
   const heads=["Special events","Sports","Holiday picks","Entertainment"].map(g=>eligible.find(r=>r.group===g)).filter(Boolean);
   picks.splice(0,picks.length,...[...new Set([...heads,...eligible])].slice(0,12));
  }
  const buttons=(values,sel,attr)=>values.map(([v,t])=>'<button type="button" data-'+attr+'="'+escape(v)+'" aria-pressed="'+(v===sel)+'">'+escape(t)+'</button>').join("");
  const html='<header><div><span>'+escape(context(date))+' · '+escape(date.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}))+'</span><h2>Today on TV</h2></div></header><div class="todayControls">'+buttons(Array.from({length:7},(_,i)=>[i,i===0?"Today":i===1?"Tomorrow":dateFor(i).toLocaleDateString(undefined,{weekday:"short",day:"numeric"})]),day,"day-offset")+'</div><div class="todayControls">'+buttons(["Highlights","Sports","Entertainment","Holiday picks","Special events"].map(s=>[s,s]),category,"section")+'</div><div class="todayRail">'+picks.map((r,i)=>{
   const img=/^https:\/\//i.test(r.image||"")?'<img loading="lazy" src="'+escape(r.image)+'" alt="">':"";
   const link=/^https:\/\//i.test(r.url||"")?'<a href="'+escape(r.url)+'" target="_blank" rel="noopener noreferrer">'+escape(r.source)+' listing ↗</a>':escape(r.source);
   return '<article>'+img+'<div><small>'+escape(r.why)+(r.live?" · On now":"")+'</small><h3>'+escape(r.title)+'</h3><p>'+escape(clock(r.start))+(r.station?' · '+escape(r.station):' · Channel unconfirmed')+'</p>'+(r.subtitle?'<p>'+escape(r.subtitle)+'</p>':'')+'<footer>'+(r.guideId?'<button data-guide="'+i+'">Programme details</button>':link)+(r.start>Date.now()?'<button data-remind="'+i+'">Calendar reminder</button>':'')+'</footer></div></article>';
  }).join("")+'</div>'+(!picks.length?'<p>'+(feed?"No matching listings for this selection.":"Checking schedules…")+'</p>':"")+(eligible.length>12?'<button data-expand>'+ (expanded?"Show highlights":"Show more")+'</button>':"")+'<p class="todaySource">Your guide · U.S. TVmaze schedule · ESPN schedules'+(feed?' · Checked '+clock(feed.at)+(feed.failed?' · Some feeds unavailable':''):' · Updating')+'</p>';
  if(html===lastPaint)return;
  const rail=host.querySelector(".todayRail"),x=rail?.scrollLeft||0;host.innerHTML=html;lastPaint=html;host.querySelector(".todayRail").scrollLeft=x;
  host.onclick=e=>{const b=e.target.closest("button");if(!b)return;
   if(b.dataset.dayOffset!==undefined){day=Number(b.dataset.dayOffset);expanded=false;paint();refresh()}
   else if(b.dataset.section){category=b.dataset.section;expanded=false;paint()}
   else if(b.hasAttribute("data-expand")){expanded=!expanded;paint()}
   else if(b.dataset.guide!==undefined)LumaIPTV.openProgramme(picks[Number(b.dataset.guide)].guideId);
   else if(b.dataset.remind!==undefined)reminder(picks[Number(b.dataset.remind)]);
  };
 }
 function mount(target,channels,programs,favorites){
  host=document.createElement("section");host.className="todayHub";const hero=target.querySelector(".iptvPortalHero");
  if(hero)hero.after(host);else target.prepend(host);
  stations=new Map(channels.map(c=>[c.id,c]));guide=programs;favs=new Set(favorites);lastPaint="";paint();refresh();
  if(!timer){timer=setInterval(()=>{if(host?.isConnected&&!document.hidden){paint();refresh()}},60000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()})}
 }
 return {mount,context,classify};
})();
