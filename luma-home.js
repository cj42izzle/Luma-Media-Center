"use strict";
/* Luma's TV-first personal home. Uses real playback, DVR, schedule and news data.
   No synthetic release dates, invented recordings or fabricated news stories. */
const LumaHome=(()=>{
 const LOCATION_KEY="luma.home.newsLocation.v1",NEWS_KEY="luma.home.newsCache.v1",NEWS_TTL=25*60*1000;
 const WEATHER_KEY="luma.home.weather.v1",WEATHER_TTL=35*60*1000;
 let weather=readWeather(),weatherLoading=false,weatherRequest=null,weatherView="today";
 function readWeather(){try{
  const v=JSON.parse(localStorage.getItem(WEATHER_KEY)||"null");
  return v&&typeof v==="object"&&Array.isArray(v.data?.daily?.time)?v:null;
 }catch{return null}}

 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const text=s=>String(s??"").trim();
 const safeURL=value=>{try{const u=new URL(String(value||""));return /^https?:$/.test(u.protocol)?u.href:""}catch{return""}};
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||"null")||fallback}catch{return fallback}};
 const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{}};
 const humanDate=value=>{const time=Date.parse(String(value||""));return Number.isFinite(time)?new Date(time).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"Date unavailable"};
 const timeText=value=>{const t=Number(value),date=Number.isFinite(t)&&t>1e11?new Date(t):new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"Date pending"};
 const lastDate=x=>{const str=String(x?.date||x?.releaseDate||x?.firstAirDate||"");if(!/^\d{4}-\d\d-\d\d$/.test(str))return 0;if(x.source==="cinemeta"&&str.endsWith("-01-01"))return 0;return Date.parse(str+"T12:00:00Z")||0};
 let city=text(read(LOCATION_KEY,"Reno, NV")).slice(0,80)||"Reno, NV";
 let articles=read(NEWS_KEY,{city:"Reno, NV",at:0,local:[],national:[]});
 if(!articles||typeof articles!=="object"||!Array.isArray(articles.local)||!Array.isArray(articles.national))
  articles={city,at:0,local:[],national:[]};
 let busy=false,inflight=null;
 const locationQuery=()=>{const q=city.split(",").map(text).filter(Boolean);return q.length>1?'"'+q[0]+'" "'+q.slice(1).join(" ")+'"': '"'+city+'"';};
 const linkToNews=local=>local?"https://news.google.com/search?q="+encodeURIComponent(city+" news")+"&hl=en-US&gl=US&ceid=US:en":"https://news.google.com/topstories?hl=en-US&gl=US&ceid=US:en";
 function parseArticles(data){
  const seen=new Set(),now=Date.now();
  return (Array.isArray(data?.articles)?data.articles:[]).flatMap(row=>{
   const title=text(row?.title).slice(0,170),url=safeURL(row?.url);
   if(!title||title.length<8||!url||seen.has(url))return [];
   const stamp=String(row?.seendate||"").replace(/\D/g,"");
   let date=0;
   if(stamp.length>=12)date=Date.UTC(Number(stamp.slice(0,4)),Number(stamp.slice(4,6))-1,Number(stamp.slice(6,8)),Number(stamp.slice(8,10)),Number(stamp.slice(10,12)));
   if(!date||date>now+86400000||date<now-7*86400000)return [];
   seen.add(url);
   return [{title,url,source:text(row.domain||row.sourcecountry||"News").slice(0,90),
    date,language:text(row.language).slice(0,25)}];
  }).slice(0,9);
 }
 async function fetchHeadlines(local){
  const query=(local?locationQuery()+' sourcelang:english':'"United States" sourcelang:english');
  const endpoint="https://api.gdeltproject.org/api/v2/doc/doc?"+new URLSearchParams({
   query,mode:"ArtList",format:"json",sort:"DateDesc",maxrecords:"20",timespan:"3d"
  });
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12500);
  try{
   const response=await fetch(endpoint,{signal:ctrl.signal,cache:"no-store"});
   if(!response.ok)throw Error("News feed returned "+response.status);
   const data=await response.json();
   return parseArticles(data);
  }finally{clearTimeout(timer)}
 }
 function prime(force=false){
  void primeWeather(force);
  if(inflight)return inflight;
  if(!force&&articles.city===city&&Date.now()-Number(articles.at||0)<NEWS_TTL)
   return Promise.resolve(articles);
  busy=true;
  inflight=(async()=>{
   const [local,national]=await Promise.allSettled([fetchHeadlines(true),fetchHeadlines(false)]);
   const next={city,at:Date.now(),
    local:local.status==="fulfilled"?local.value:(articles.city===city?articles.local:[]),
    national:national.status==="fulfilled"?national.value:articles.national};
   articles=next;write(NEWS_KEY,next);
   return next;
  })().finally(()=>{
   busy=false;inflight=null;
   refreshWidgets();
  });
  return inflight;
 }
 function cleanCity(value){
  const v=text(value).replace(/\s+/g," ");
  if(v.length<2||v.length>70||!/^[\p{L}0-9 .,'-]+$/u.test(v))throw Error("Enter a city and state, for example Reno, NV");
  return v;
 }
 function changeCity(value){
  const v=cleanCity(value);
  if(v===city)return Promise.resolve(articles);
  city=v;write(LOCATION_KEY,v);
  articles={city,at:0,local:[],national:articles.national};
  weather=null;weatherView="today";refreshWidgets();
  return prime(true);
 }

 // Station matches come from the owner's loaded IPTV channels, not guessed streams.
 // Known Reno callsigns are grounded in licensed local TV affiliates; elsewhere
 // require a city/state/locality label in the user's own playlist or EPG metadata.
 const RENO_STATIONS={KTVN:"CBS",KOLO:"ABC",KRNV:"NBC",KRXI:"FOX",KNPB:"PBS"};
 const NETWORKS=["ABC","CBS","NBC","FOX","PBS"];
 const area=s=>text(s).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
 const word=(hay,needle)=>needle&&(" "+hay+" ").includes(" "+needle+" ");
 function localStations(rows,location=city){
  const [place,stateHint=""]=location.split(",").map(area),reno=place==="RENO"&&(stateHint==="NV"||stateHint==="NEVADA");
  const found=[],seen=new Set();
  for(const channel of Array.isArray(rows)?rows:[]){
   if(!channel?.id||!/^https?:\/\//i.test(String(channel.url||"")))continue;
   const name=area(channel.name),group=area(channel.group),epg=area(channel.epg_id);
   const full=area([channel.name,channel.group,channel.epg_id].join(" "));
   const call=reno?Object.keys(RENO_STATIONS).find(id=>word(name,id)||word(epg,id)):"";
   const network=call?RENO_STATIONS[call]:NETWORKS.find(n=>word(name,n)||word(epg,n));
   if(!network)continue;
   if(!call&&/\b(FOX NEWS|CBS SPORTS|NBC SPORTS|ABC NEWS LIVE|CBS NEWS 24|NBC NEWS NOW|SPORTS NETWORK|NEWSNATION)\b/.test(full))continue;
   const cityMatch=word(full,place);
   const stateMatch=stateHint&&(word(full,stateHint)||stateHint==="NV"&&word(full,"NEVADA"));
   const localLabel=/\b(LOCAL|AFFILIATE|BROADCAST|CITY NEWS|REGIONAL)\b/.test(full);
   if(!call&&!cityMatch&&!(stateMatch&&localLabel))continue;
   const score=(call?9:0)+(cityMatch?5:0)+(stateMatch?2:0)+(localLabel?1:0)+Math.min(2,Number(channel.quality)||0);
   found.push({id:String(channel.id),name:text(channel.name).slice(0,100),network,call,score});
  }
  found.sort((a,b)=>b.score-a.score||a.network.localeCompare(b.network));
  return found.filter(x=>{const key=x.call||x.network;if(seen.has(key))return false;seen.add(key);return true}).slice(0,6);
 }
 function localTVSection(){
  const all=typeof LumaIPTV!=="undefined"&&typeof LumaIPTV.channels==="function"?LumaIPTV.channels():[];
  const stations=localStations(all);
  return '<section id="lumaHomeLocalTV" class="lumaHomePanel lumaHomeStations" aria-label="Local live television">'
   +'<div class="lumaHomeSectionHead"><div><span class="eyebrow">YOUR IPTV LINEUP</span><h2>Local TV stations</h2><p class="lumaHomeSubline">'+esc(city)+' · Matched from your connected channels</p></div><button class="secondary small" type="button" data-go="Guide">Open guide ›</button></div>'
   +(stations.length?'<div class="lumaStationGrid">'+stations.map(x=>
    '<button class="lumaStationCard" type="button" data-home-channel="'+esc(x.id)+'" aria-label="Watch '+esc(x.network+' '+x.name)+'"><span class="lumaStationNetwork">'+esc(x.network)+'</span><strong>'+esc(x.call||x.name)+'</strong><small>'+esc(x.call?x.name:"Your local IPTV channel")+'</small><span class="lumaStationWatch">▶ Watch live</span></button>').join("")+'</div>':
    '<div class="lumaHomeEmptyInner"><p>No verified local ABC, CBS, NBC or other affiliate was found for '+esc(city)+' in the connected IPTV channel names or guide. Add your provider or check its city-labelled channel group.</p><button class="secondary small" type="button" data-go="Live TV">Manage live channels</button></div>')
   +'</section>';
 }
 const n=value=>Number.isFinite(Number(value))?Math.round(Number(value)):null;
 const displayTemp=value=>n(value)===null?"—":String(n(value))+"°";
 const wx=code=>{
  code=Number(code);
  if(code===0)return ["☀","Clear"];
  if(code<=3)return ["⛅",code===3?"Overcast":"Partly cloudy"];
  if(code===45||code===48)return ["🌫","Fog"];
  if([51,53,55,56,57].includes(code))return ["🌦","Drizzle"];
  if([61,63,65,66,67,80,81,82].includes(code))return ["🌧","Rain"];
  if([71,73,75,77,85,86].includes(code))return ["❄","Snow"];
  if([95,96,99].includes(code))return ["⛈","Thunderstorms"];
  return ["☁","Cloudy"];
 };
 const dayLabel=(date,long=false)=>{
  if(!/^\d{4}-\d\d-\d\d$/.test(String(date)))return "Date unavailable";
  return new Date(date+"T12:00:00Z").toLocaleDateString("en-US",{weekday:long?"long":"short",month:"short",day:"numeric",timeZone:"UTC"});
 };
 const hhmm=(value)=>{if(!value||typeof value!=="string")return "—";const part=value.split("T")[1];if(!/^\d\d:\d\d/.test(part||""))return "—";
  const hour=Number(part.slice(0,2));return (hour%12||12)+":"+part.slice(3,5)+(hour<12?" AM":" PM");
 };
 function weatherDays(data){
  const daily=data?.daily||{},dates=Array.isArray(daily.time)?daily.time:[];
  return dates.slice(0,16).map((day,i)=>({
   day,code:daily.weather_code?.[i],high:daily.temperature_2m_max?.[i],low:daily.temperature_2m_min?.[i],
   rain:daily.precipitation_probability_max?.[i],rainIn:daily.precipitation_sum?.[i],
   snow:daily.snowfall_sum?.[i],wind:daily.wind_speed_10m_max?.[i],
   uv:daily.uv_index_max?.[i],sunrise:daily.sunrise?.[i],sunset:daily.sunset?.[i]
  }));
 }
 async function getWeatherJSON(url,controller){
  const r=await fetch(url,{signal:controller.signal,cache:"no-store"});
  if(!r.ok)throw Error("Weather provider unavailable");return r.json();
 }
 async function fetchWeather(location){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
  try{
   const geo="https://geocoding-api.open-meteo.com/v1/search?"+new URLSearchParams({name:location,count:"10",language:"en",format:"json",countryCode:"US"});
   const lookup=await getWeatherJSON(geo,controller);
   const results=Array.isArray(lookup?.results)?lookup.results:[];
   const requested=area(location.split(",")[0]);
   const match=results.find(x=>area(x.name)===requested);
   if(!match||!Number.isFinite(match.latitude)||!Number.isFinite(match.longitude))throw Error("City not found in the weather service");
   const params=new URLSearchParams({
    latitude:String(match.latitude),longitude:String(match.longitude),timezone:"auto",
    temperature_unit:"fahrenheit",wind_speed_unit:"mph",precipitation_unit:"inch",forecast_days:"16",
    current:"temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
    hourly:"temperature_2m,precipitation_probability,weather_code",
    daily:"weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset"
   });
   const forecast=await getWeatherJSON("https://api.open-meteo.com/v1/forecast?"+params,controller);
   if(!Array.isArray(forecast.daily?.time)||!forecast.daily.time.length||!forecast.current)throw Error("No usable forecast returned");
   return {city:location,at:Date.now(),place:match.name+", "+(match.admin1||""),data:forecast};
  }finally{clearTimeout(timer)}
 }
 function primeWeather(force=false){
  if(weatherRequest)return weatherRequest;
  if(!force&&weather?.city===city&&Date.now()-Number(weather.at||0)<WEATHER_TTL)return Promise.resolve(weather);
  weatherLoading=true;
  weatherRequest=fetchWeather(city).then(result=>{weather=result;write(WEATHER_KEY,result);return result})
   .catch(err=>{if(weather?.city!==city)weather=null;return null})
   .finally(()=>{weatherLoading=false;weatherRequest=null;refreshWidgets()});
  return weatherRequest;
 }
 function weatherMarkup(){
  const current=weather?.city===city?weather.data?.current:null;
  const daily=weather?.city===city?weatherDays(weather.data):[];
  const today=daily[0],condition=wx(current?.weather_code),ranges=[["today","Today"],["7","7 days"],["14","14 days"],["30","Month"]];
  const selected=ranges.map(([id,label])=>'<button class="lumaWeatherTab'+(weatherView===id?" active":"")+'" type="button" data-weather-range="'+id+'" aria-pressed="'+(weatherView===id)+'">'+label+'</button>').join("");
  let body='';
  if(!current||!today)body='<div class="lumaHomeEmptyInner"><p>'+(weatherLoading?'Loading a real local forecast…':'Weather forecast is unavailable for this location. Try another city or refresh.')+'</p><button type="button" class="secondary small" data-weather-retry>Retry weather</button></div>';
  else if(weatherView==="today"){
   const hours=weather.data.hourly||{},nowDate=String(current.time||"").slice(0,13);
   const start=Math.max(0,(hours.time||[]).findIndex(x=>String(x).slice(0,13)===nowDate));
   const timeCards=(hours.time||[]).slice(start,start+9).map((time,j)=>{
    const k=start+j,code=wx(hours.weather_code?.[k]);
    return '<div class="lumaWeatherHour"><span>'+esc(hhmm(time))+'</span><b>'+code[0]+'</b><strong>'+displayTemp(hours.temperature_2m?.[k])+'</strong><small>☂ '+(n(hours.precipitation_probability?.[k])??"—")+'%</small></div>';
   }).join("");
   body='<div class="lumaWeatherToday"><div class="lumaWeatherCurrent"><span class="lumaWeatherIcon" aria-hidden="true">'+condition[0]+'</span><div><strong class="lumaWeatherTemp">'+displayTemp(current.temperature_2m)+'</strong><b>'+esc(condition[1])+'</b><small>Feels like '+displayTemp(current.apparent_temperature)+'</small></div></div>'
    +'<div class="lumaWeatherFacts"><div><span>High / Low</span><b>'+displayTemp(today.high)+' / '+displayTemp(today.low)+'</b></div>'
    +'<div><span>Rain chance</span><b>'+(n(today.rain)??"—")+'%</b></div>'
    +'<div><span>Wind</span><b>'+(n(current.wind_speed_10m)??"—")+' mph</b></div>'
    +'<div><span>Humidity</span><b>'+(n(current.relative_humidity_2m)??"—")+'%</b></div>'
    +'<div><span>UV max</span><b>'+(n(today.uv)??"—")+'</b></div>'
    +'<div><span>Sunrise / sunset</span><b>'+hhmm(today.sunrise)+' / '+hhmm(today.sunset)+'</b></div></div></div>'
    +(timeCards?'<div class="lumaWeatherHours" aria-label="Upcoming hourly forecast">'+timeCards+'</div>':"");
  }else if(weatherView==="30"){
   const base=new Date(daily[0].day+"T12:00:00Z");
   body='<p class="lumaWeatherDisclaimer">30-day planning calendar. Detailed forecasts are available only up to 16 days; later dates are intentionally marked unavailable, not predicted.</p><div class="lumaWeatherMonth" aria-label="30-day weather outlook">'
    +Array.from({length:30},(_,i)=>{
     const record=daily[i],day=new Date(base.getTime()+i*86400000).toISOString().slice(0,10);
     return '<div class="lumaWeatherMonthDay'+(record?"":" isPending")+'"><small>'+dayLabel(day)+'</small>'
       +(record?'<b>'+wx(record.code)[0]+' '+displayTemp(record.high)+'</b><span>'+displayTemp(record.low)+' · ☂ '+(n(record.rain)??"—")+'%</span>':
        '<b>Forecast pending</b><span>Beyond 16 days</span>')+'</div>';
    }).join("")+'</div>';
  }else{
   const count=weatherView==="7"?7:14;
   body='<div class="lumaWeatherDays" aria-label="'+count+' day forecast">'+daily.slice(0,count).map(d=>
    '<div class="lumaWeatherDay"><b>'+dayLabel(d.day)+'</b><span class="lumaWeatherDayCondition">'+wx(d.code)[0]+' '+esc(wx(d.code)[1])+'</span>'
    +'<strong>'+displayTemp(d.high)+' <small>/ '+displayTemp(d.low)+'</small></strong><span>☂ '+(n(d.rain)??"—")+'%</span>'
    +'<span>Wind '+(n(d.wind)??"—")+' mph</span></div>').join("")+'</div>';
  }
  return '<section id="lumaHomeWeather" class="lumaHomePanel lumaHomeWeather" aria-label="Local weather forecast">'
   +'<div class="lumaHomeSectionHead"><div><span class="eyebrow">YOUR LOCAL FORECAST</span><h2>Weather in '+esc(city)+'</h2><p class="lumaHomeSubline">'+(weather?.city===city&&weather.at?'Updated '+esc(new Date(weather.at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}))+' · ':'')+'Open-Meteo model forecast</p></div>'
   +'<div class="lumaWeatherTabs" role="group" aria-label="Forecast range">'+selected+'</div></div>'
   +body
   +'<form class="lumaNewsLocation" id="lumaNewsCityForm"><label for="lumaNewsCity">City and state</label>'
   +'<input id="lumaNewsCity" type="text" value="'+esc(city)+'" maxlength="70" placeholder="City, state" autocomplete="address-level2">'
   +'<button type="submit" class="secondary small">Update area</button></form></section>';
 }
 function refreshWidgets(){
  if(typeof document==="undefined"||typeof state==="undefined"||state.tab!=="Home")return;
  const weatherRoot=document.querySelector("#lumaHomeWeather");
  if(weatherRoot){weatherRoot.outerHTML=weatherMarkup();bindWeather();}
  const stations=document.querySelector("#lumaHomeLocalTV");
  if(stations){stations.outerHTML=localTVSection();bindStations();}
  const news=document.querySelector("#lumaHomeNewsGrid");
  if(news){news.innerHTML=newsSection(true)+newsSection(false);}
 }
 function bindWeather(){
  const form=document.querySelector("#lumaNewsCityForm");
  if(form)form.onsubmit=e=>{
   e.preventDefault();
   const value=document.querySelector("#lumaNewsCity")?.value||"";
   try{Promise.resolve(changeCity(value)).catch(err=>{if(typeof toast==="function")toast(String(err.message||err))})}
   catch(err){if(typeof toast==="function")toast(String(err.message||err))}
  };
  for(const b of document.querySelectorAll("[data-weather-range]"))b.onclick=()=>{
   weatherView=b.dataset.weatherRange;refreshWeatherOnly();
  };
  const retry=document.querySelector("[data-weather-retry]");if(retry)retry.onclick=()=>void primeWeather(true);
 }
 function refreshWeatherOnly(){
  const root=document.querySelector("#lumaHomeWeather");
  if(root){root.outerHTML=weatherMarkup();bindWeather();}
 }
 function bindStations(){
  for(const b of document.querySelectorAll("[data-home-channel]"))b.onclick=()=>{
   const id=b.dataset.homeChannel,channel=typeof LumaIPTV!=="undefined"?LumaIPTV.channels().find(c=>String(c.id)===id):null;
   if(!channel||!/^https?:\/\//i.test(String(channel.url||""))){if(typeof toast==="function")toast("Local TV channel is unavailable");return;}
   if(typeof LumaPlayer==="undefined"||!LumaPlayer.open({url:channel.url,title:channel.name,live:true,provider:channel.provider||"IPTV"})){
    if(typeof toast==="function")toast("This channel could not start on this device");
   }
  };
 }

 function newTitles(items,kind,days=145){
  const now=Date.now(),start=now-days*86400000,seen=new Set();
  return (Array.isArray(items)?items:[]).filter(x=>{
   if(kind==="Movie"?x?.type!=="Movie":!(x?.type==="Series"||x?.type==="Anime"))return false;
   const date=lastDate(x);if(!date||date<start||date>now+86400000||seen.has(x.id))return false;
   seen.add(x.id);return true;
  }).sort((a,b)=>lastDate(b)-lastDate(a)).slice(0,24);
 }
 function premiereRows(rows){
  const now=Date.now(),future=now+21*86400000;
  return (Array.isArray(rows)?rows:[]).filter(x=>{
   if(Number(x?.season)!==1||Number(x?.number)!==1)return false;
   const ts=Number(x.airStamp)||Date.parse(String(x.airdate||"")+"T12:00:00Z");
   return Number.isFinite(ts)&&ts>=now-8*3600000&&ts<future;
  }).sort((a,b)=>(Number(a.airStamp)||Date.parse(a.airdate))-(Number(b.airStamp)||Date.parse(b.airdate))).slice(0,10);
 }
 const jump=(tab,label,desc,icon)=>'<button type="button" class="lumaHomeJump" data-go="'+esc(tab)+'"><span class="lumaHomeJumpIcon" aria-hidden="true">'+icon+'</span><strong>'+esc(label)+'</strong><small>'+esc(desc)+'</small></button>';
 function emptySection(name,description,tab,button){
  return '<section class="lumaHomePanel lumaHomeEmpty"><div class="lumaHomeSectionHead"><h2>'+esc(name)+'</h2></div>'
   +'<p>'+esc(description)+'</p><button type="button" class="secondary" data-go="'+esc(tab)+'">'+esc(button)+'</button></section>';
 }
 function dvrSection(online,device){
  const rows=[];
  for(const job of (Array.isArray(online)?online:[]))rows.push({...job,kind:"server"});
  for(const job of (Array.isArray(device)?device:[]))rows.push({...job,kind:"device"});
  rows.sort((a,b)=>(Number(b.start)||0)-(Number(a.start)||0));
  const list=rows.filter(x=>["complete","partial","recording","scheduled"].includes(x.status)).slice(0,8);
  return '<section class="lumaHomePanel lumaHomeDvr" aria-label="Your DVR recordings">'
   +'<div class="lumaHomeSectionHead"><div><span class="eyebrow">SAVED TELEVISION</span><h2>DVR Recordings</h2></div>'
   +'<button class="secondary small" type="button" data-go="Recordings">View DVR ›</button></div>'
   +(list.length?'<div class="lumaHomeDvrRail">'+list.map(job=>{
    const ready=["complete","partial"].includes(job.status)&&job.id;
    const status=job.status==="complete"?"Ready to watch":job.status==="recording"?"Recording now":job.status==="scheduled"?"Scheduled":"Partially saved";
    return '<button type="button" class="lumaHomeDvrItem" '+(ready?'data-home-recording="'+esc(job.id)+'" data-home-rec-source="'+job.kind+'"':'data-go="Recordings"')+'>'
     +'<span class="lumaDvrIcon" aria-hidden="true">'+(ready?"▶":"●")+'</span>'
     +'<strong>'+esc(job.title||"Untitled recording")+'</strong>'
     +'<small>'+esc(status)+(job.start?" · "+esc(timeText(job.start)):"")+'</small></button>';
   }).join("")+'</div>':
    '<div class="lumaHomeEmptyInner"><p>No DVR recordings yet. Your scheduled and completed shows will appear here once a recorder is connected.</p>'
    +'<button class="secondary" type="button" data-go="Recordings">Open DVR</button></div>')
   +'</section>';
 }
 function premiereSection(rows){
  const matches=premiereRows(rows);
  return '<section class="lumaHomePanel lumaHomePremieres" aria-label="Upcoming TV series premieres">'
   +'<div class="lumaHomeSectionHead"><div><span class="eyebrow">FIRST EPISODES</span><h2>New TV Shows Premiering</h2></div>'
   +'<button class="secondary small" type="button" data-go="Calendar">TV Calendar ›</button></div>'
   +(matches.length?'<div class="lumaHomePremiereRail">'+matches.map(x=>
    '<button type="button" class="lumaHomePremiere" data-go="Calendar"><span class="lumaPremiereTag">NEW SERIES</span>'
    +'<strong>'+esc(x.title)+'</strong><small>'+esc(x.episode||"Series premiere")+'</small>'
    +'<span>'+esc(x.timeLabel&&x.timeLabel!=="Time not announced"?x.timeLabel:humanDate(x.airdate))
    +(x.channel?" · "+esc(x.channel):"")+'</span></button>').join("")+'</div>':
    '<div class="lumaHomeEmptyInner"><p>No confirmed series premieres in the currently loaded broadcast schedule. New first episodes will appear when their dates are published.</p>'
    +'<button class="secondary" type="button" data-go="Calendar">Explore airing shows</button></div>')
   +'</section>';
 }
 function newsSection(local){
  const list=Array.isArray(local?articles.local:articles.national)?(local?articles.local:articles.national):[];
  const name=local?"Local News":"News & Headlines",url=linkToNews(local);
  return '<section class="lumaHomePanel lumaHomeNews" aria-label="'+name+'">'
   +'<div class="lumaHomeSectionHead"><div><span class="eyebrow">'+(local?"AROUND YOU":"CURRENT HEADLINES")+'</span><h2>'+esc(name)+'</h2></div>'
   +'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">More news ↗</a></div>'

   +(list.length?'<div class="lumaHomeNewsList">'+list.slice(0,6).map(x=>
    '<a class="lumaHomeNewsStory" href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'
    +'<span class="lumaNewsSource">'+esc(x.source||"News")+' · '+esc(humanDate(new Date(x.date).toISOString()))+'</span>'
    +'<strong>'+esc(x.title)+'</strong><span class="lumaNewsArrow" aria-hidden="true">↗</span></a>').join("")+'</div>':
    '<div class="lumaHomeEmptyInner"><p>'+(busy?"Loading headlines from public news sources…":"Live headlines are temporarily unavailable. Open the source to see verified reporting.")+'</p>'
    +'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Browse '+(local?"local":"national")+' news ↗</a></div>')
   +(local&&/reno/i.test(city)?'<div class="lumaHomeNewsPublishers"><a href="https://www.2news.com/" target="_blank" rel="noopener noreferrer">KTVN</a>'
    +'<a href="https://www.kolotv.com/" target="_blank" rel="noopener noreferrer">KOLO</a>'
    +'<a href="https://www.rgj.com/" target="_blank" rel="noopener noreferrer">RGJ</a>'
    +'<a href="https://mynews4.com/" target="_blank" rel="noopener noreferrer">KRNV</a></div>':"")
   +'</section>';
 }
 function markup(model,shelf){
  const items=Array.isArray(model?.items)?model.items:[],watching=Array.isArray(model?.watching)?model.watching:[];
  const movies=newTitles(items,"Movie",180),shows=newTitles(items,"Series",240);
  const released=typeof LumaReleases!=="undefined"?LumaReleases.inTheaters?.()||[]:[];
  const newMovies=[...released.filter(x=>x?.cinemaVerified),...movies].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
  return '<div class="lumaHomeDashboard">'
   +'<nav class="lumaHomeQuick" aria-label="Quick navigation">'
   +jump("Live TV","Live TV","Watch your channels","▣")
   +jump("Guide","TV Guide","What’s on next","▦")
   +jump("Recordings","Recordings","Your DVR","●")
   +jump("Calendar","TV Premieres","New episodes","◷")
   +jump("Anime","Anime","Discover more","✧")
   +'</nav>'
   +'<div class="lumaHomeEssentials">'+weatherMarkup()+localTVSection()+'</div>'
   +(watching.length?shelf("Resume Watching",watching,"Continue from your last saved position","Continue Watching"):
    emptySection("Resume Watching","Your movies and episodes appear here once you start watching something.","My Library","Explore your library"))
   +dvrSection(model?.dvrJobs,model?.deviceJobs)
   +(newMovies.length?shelf("New Movies",newMovies,"Recent reported releases and verified theatrical listings","Movies"):
     emptySection("New Movies","Recent movie releases appear as metadata is published. Your library never fills this row with old titles labeled new.","Movies","Browse movies"))
   +(shows.length?shelf("New TV Shows",shows,"Recently premiered series","TV Shows"):
     emptySection("New TV Shows","New series are added when reliable first-air dates are available.","TV Shows","Find TV shows"))
   +premiereSection(model?.calendarRows)
   +'<div class="lumaHomeNewsGrid" id="lumaHomeNewsGrid">'+newsSection(true)+newsSection(false)+'</div>'
   +'</div>';
 }
 function bind(){
  bindWeather();bindStations();
  for(const button of document.querySelectorAll("[data-home-recording]"))button.onclick=()=>{
   const id=button.dataset.homeRecording,source=button.dataset.homeRecSource;
   try{
    if(source==="device"&&typeof LumaDeviceDVR!=="undefined"&&LumaDeviceDVR.available())LumaDeviceDVR.call("open",id);
    else if(source==="server"&&typeof LumaIPTV!=="undefined")LumaIPTV.watchRecording(id);
    else throw Error("Recording is not available on this device");
   }catch(e){if(typeof toast==="function")toast(String(e?.message||e))}
  };
 }
 if(typeof window!=="undefined"){
  window.addEventListener("luma-native-dvr-ready",()=>{if(typeof state!=="undefined"&&state.tab==="Home")window.LumaRender?.()});
  window.addEventListener("luma-native-dvr-storage",()=>{if(typeof state!=="undefined"&&state.tab==="Home")window.LumaRender?.()});
 }
 return {markup,bind,prime,primeWeather,changeCity,parseArticles,newTitles,premiereRows,
  localStations,weatherDays,weatherMarkup,getWeather:()=>weather,getLocation:()=>city,getNews:()=>articles};
})();
