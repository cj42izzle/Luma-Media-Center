"use strict";
/* Public metadata-only catalogs: CineMeta (Stremio) and AniList (anime). */
const LumaCatalogPlus=(()=>{
 const C="https://v3-cinemeta.strem.io",A="https://graphql.anilist.co",K="https://kitsu.io/api/edge";
 const animeFields="id idMal title{english romaji native} description(asHtml:false) startDate{year month day} coverImage{large extraLarge} bannerImage averageScore genres format episodes relations{edges{relationType node{id}}}";
 const gql="query ($page:Int,$perPage:Int,$search:String){Page(page:$page,perPage:$perPage){pageInfo{hasNextPage} media(type:ANIME,isAdult:false,sort:POPULARITY_DESC,search:$search){"+animeFields+"}}}";
 const familyGql="query($id:Int){Media(id:$id,type:ANIME){"+animeFields+"}}";
 const familyCache=new Map();
 const cursor={movie:100,series:100,anime:3,kitsu:0},moreAvailable={movie:true,series:true,anime:true};
 const txt=x=>String(x??"").trim(),norm=x=>txt(x).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
 const safeURL=s=>{try{const u=new URL(String(s||""));return u.protocol==="https:"?u.href:""}catch{return""}};
 const getYear=s=>String(s||"").match(/\b(?:18|19|20)\d{2}\b/)?.[0]||"";
 async function request(url,opts={}){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14000);
  try{
   const r=await fetch(url,{...opts,signal:ctrl.signal});
   if(!r.ok)throw Error("Catalog provider unavailable (HTTP "+r.status+")");
   return await r.json();
  }finally{clearTimeout(timer)}
 }
 function normalizeCinemeta(v,kind){
  const id=txt(v?.imdb_id||v?.id),title=txt(v?.name||v?.title).slice(0,180);
  if(!/^tt\d{5,12}$/.test(id)||!title)return null;
  const year=getYear(v.releaseInfo||v.year||v.released);
  return {id:"cinemeta:"+id,imdbId:id,title,type:kind==="series"?"Series":"Movie",
   year,poster:safeURL(v.poster),backdrop:safeURL(v.background||v.banner),
   overview:txt(v.description||"").slice(0,1600),rating:Number(v.imdbRating||0)>0?Number(v.imdbRating).toFixed(1):"",
   genreNames:Array.isArray(v.genres)?v.genres.slice(0,8).map(txt):[],
   source:"cinemeta",original_language:"",date:year?year+"-01-01":""};
 }
 function normalizeAnime(v){
  const id=Number(v?.id),title=txt(v?.title?.english||v?.title?.romaji||v?.title?.native).slice(0,180);
  if(!Number.isSafeInteger(id)||id<=0||!title)return null;
  const year=Number(v?.startDate?.year)||0,month=Number(v?.startDate?.month)||0,day=Number(v?.startDate?.day)||0;
  const y=year>=1900&&year<=2100?String(year):"";
  const date=y&&month>0&&month<13&&day>0&&day<=31?y+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0"):"";
  const score=Number(v.averageScore)||0;
  return {id:"anilist:"+id,animeId:id,malId:Number(v.idMal)||null,title,type:"Anime",
   year:y,poster:safeURL(v?.coverImage?.extraLarge||v?.coverImage?.large),backdrop:safeURL(v.bannerImage),
   overview:txt(v.description).replace(/<[^>]*>/g,"").slice(0,1800),
   rating:score>0?(score/10).toFixed(1):"",source:"anilist",
   original_language:"ja",genreNames:Array.isArray(v.genres)?v.genres.slice(0,8).map(txt):[],
   date,episodeCount:Number(v.episodes)||0,animeFormat:txt(v.format),
   prequelIds:(v.relations?.edges||[]).filter(e=>e.relationType==="PREQUEL").map(e=>Number(e.node?.id)).filter(Number.isSafeInteger),
   sequelIds:(v.relations?.edges||[]).filter(e=>e.relationType==="SEQUEL").map(e=>Number(e.node?.id)).filter(Number.isSafeInteger)};
 }
 function unique(rows){
  // Titles and years can collide across distinct anime adaptations, remakes and franchises.
  // Only a provider's stable ID establishes identity; sequel grouping uses verified relations.
  const ids=new Set();
  return rows.filter(v=>{
   if(!v?.id||!v.title||ids.has(v.id))return false;
   ids.add(v.id);return true;
  });
 }
 async function cinemeta(kind,skip=0,search=""){
  if(!["movie","series"].includes(kind)||!Number.isInteger(skip)||skip<0||skip>100000)throw Error("Invalid catalog request");
  const q=txt(search).slice(0,85),suffix=q?"/search="+encodeURIComponent(q):skip?"/skip="+skip:"";
  const data=await request(C+"/catalog/"+kind+"/top"+suffix+".json");
  if(!Array.isArray(data?.metas))throw Error("Cinemeta returned no metadata");
  return unique(data.metas.map(x=>normalizeCinemeta(x,kind)).filter(Boolean));
 }
 async function anime(page=1,search=""){
  if(!Number.isInteger(page)||page<1||page>4000)throw Error("Invalid anime page");
  const data=await request(A,{method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({query:gql,variables:{page,perPage:25,search:txt(search).slice(0,100)||null}})});
  if(data.errors?.length||!Array.isArray(data?.data?.Page?.media))throw Error("AniList returned no anime catalog");
  return {items:unique(data.data.Page.media.map(normalizeAnime).filter(Boolean)),
   hasNext:data.data.Page.pageInfo?.hasNextPage===true};
 }
 function normalizeKitsu(row){
  const a=row?.attributes||{},id=Number(row?.id);
  const title=txt(a.canonicalTitle||a.titles?.en||a.titles?.en_jp||a.titles?.ja_jp).slice(0,180);
  if(!Number.isSafeInteger(id)||id<=0||!title||/^(R18|RX)$/i.test(String(a.ageRating||"")))return null;
  const date=txt(a.startDate).slice(0,10),year=getYear(date);
  const score=Number(a.averageRating)||0;
  return {id:"kitsu:"+id,kitsuId:id,title,type:"Anime",year,
   poster:safeURL(a.posterImage?.large||a.posterImage?.medium||a.posterImage?.original),
   backdrop:safeURL(a.coverImage?.large||a.coverImage?.original),
   overview:txt(a.synopsis||a.description).slice(0,1800),
   rating:score>0?(score/10).toFixed(1):"",source:"kitsu",
   original_language:"ja",genreNames:["Anime"],date,
   episodeCount:Number(a.episodeCount)||0};
 }
 async function kitsu(offset=0,search=""){
  if(!Number.isInteger(offset)||offset<0||offset>80000)throw Error("Invalid anime offset");
  const url=new URL(K+"/anime");
  url.searchParams.set("page[limit]","20");
  url.searchParams.set("page[offset]",String(offset));
  url.searchParams.set("sort","popularityRank");
  const q=txt(search).slice(0,100);if(q)url.searchParams.set("filter[text]",q);
  const data=await request(url.href,{headers:{"Accept":"application/vnd.api+json"}});
  if(!Array.isArray(data?.data))throw Error("Kitsu returned no anime metadata");
  return {items:unique(data.data.map(normalizeKitsu).filter(Boolean)),
   hasNext:!!data.links?.next||data.data.length>=20};
 }
 async function seed(){
  const jobs=await Promise.allSettled([cinemeta("movie"),cinemeta("series"),anime(1),anime(2)]);
  const all=[];
  for(let i=0;i<jobs.length;i++){
   if(jobs[i].status!=="fulfilled")continue;
   const v=jobs[i].value;
   if(i<2)all.push(...v);
   else {all.push(...v.items);if(i===3)moreAvailable.anime=v.hasNext}
  }
  if(all.filter(x=>x.type==="Anime").length<25){
   try{const backup=await kitsu(cursor.kitsu);all.push(...backup.items);cursor.kitsu+=20}
   catch{}
  }
  return unique(all);
 }
 async function loadMore(section){
  if(section==="Anime"){
   if(moreAvailable.anime){
    try{
     const r=await anime(cursor.anime++);
     moreAvailable.anime=r.hasNext;
     if(r.items.length)return r;
    }catch{}
   }
   const backup=await kitsu(cursor.kitsu);cursor.kitsu+=20;
   return backup;
  }
  const kind=section==="Movies"?"movie":section==="TV Shows"?"series":"";
  if(!kind||!moreAvailable[kind])return{items:[],hasNext:false};
  const items=await cinemeta(kind,cursor[kind]);cursor[kind]+=100;
  moreAvailable[kind]=items.length>0&&cursor[kind]<=100000;
  return {items,hasNext:moreAvailable[kind]};
 }
 async function search(section,text){
  const q=txt(text).slice(0,85);if(q.length<3)return[];
  const types=section==="Movies"?["movie"]:section==="TV Shows"?["series"]:section==="Anime"?[]:["movie","series"];
  const promises=types.map(k=>cinemeta(k,0,q));
  if(section==="Anime"||section==="Catalogs")promises.push(anime(1,q));
  const results=await Promise.allSettled(promises);
  const items=unique(results.flatMap(r=>r.status==="fulfilled"?(Array.isArray(r.value)?r.value:r.value.items):[]));
  if(section==="Anime"&&!items.length){
   try{return (await kitsu(0,q)).items}catch{}
  }
  return items;
 }

 /* Only source-confirmed PREQUEL / SEQUEL edges may unite separate anime entries.
    Equal names, subtitles, years or title-number patterns are not proof of identity. */
 function groupCatalogRows(rows){
  const all=Array.isArray(rows)?rows:[];
  const anime=all.filter(x=>x?.animeId),byID=new Map(anime.map(x=>[Number(x.animeId),x]));
  const parent=new Map([...byID.keys()].map(id=>[id,id]));
  const find=id=>{while(parent.get(id)!==id)id=parent.get(id);return id};
  for(const x of anime){
   for(const id of [...(x.prequelIds||[]),...(x.sequelIds||[])]){
    if(!byID.has(id))continue;
    const a=find(Number(x.animeId)),b=find(id);if(a!==b)parent.set(a,b);
   }
  }
  const members=new Map();
  for(const x of anime){const id=find(Number(x.animeId));if(!members.has(id))members.set(id,[]);members.get(id).push(x)}
  const representative=new Map();
  for(const group of members.values()){
   const ids=new Set(group.map(x=>Number(x.animeId)));
   const ranked=[...group].sort((a,b)=>{
    const ap=(a.prequelIds||[]).some(id=>ids.has(id)),bp=(b.prequelIds||[]).some(id=>ids.has(id));
    if(ap!==bp)return ap?1:-1;
    return String(a.date||a.year||"9999").localeCompare(String(b.date||b.year||"9999"))||Number(a.animeId)-Number(b.animeId);
   });
   for(const member of group)representative.set(member.id,ranked[0].id);
  }
  const used=new Set();
  return all.filter(x=>{
   const id=representative.get(x.id)||x.id;
   if(used.has(id))return false;
   used.add(id);return x.id===id;
  });
 }
 async function getAnimeRecord(id){
  if(!Number.isSafeInteger(Number(id))||Number(id)<=0)throw Error("Invalid anime id");
  id=Number(id);
  if(familyCache.has(id))return familyCache.get(id);
  const pending=request(A,{method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({query:familyGql,variables:{id}})})
   .then(data=>{
    if(data.errors?.length||Number(data.data?.Media?.id)!==id)throw Error("Anime relationship metadata unavailable");
    const row=normalizeAnime(data.data.Media);
    if(!row)throw Error("Invalid anime metadata");
    return row;
   }).catch(error=>{familyCache.delete(id);throw error});
  familyCache.set(id,pending);return pending;
 }
 async function animeFamily(item){
  const selected=Number(item?.animeId);
  if(!Number.isSafeInteger(selected)||selected<=0)throw Error("Not an AniList show");
  let current=await getAnimeRecord(selected);
  const ancestors=[current],seen=new Set([selected]);
  for(let depth=0;depth<14;depth++){
   const candidates=(current.prequelIds||[]).filter(id=>!seen.has(id));
   if(candidates.length!==1)break;
   let previous;try{previous=await getAnimeRecord(candidates[0])}catch{break}
   if(!previous||!["TV","TV_SHORT","ONA",""].includes(previous.animeFormat))break;
   seen.add(previous.animeId);ancestors.unshift(previous);current=previous;
  }
  const root=ancestors[0],entries=[...ancestors],visited=new Set(ancestors.map(x=>x.animeId));
  const queue=[...ancestors];
  while(queue.length&&entries.length<24){
   const source=queue.shift();
   const children=(source.sequelIds||[]).filter(id=>!visited.has(id)).slice(0,8);
   for(const id of children){
    let entry;try{entry=await getAnimeRecord(id)}catch{continue}
    if(!entry||!["TV","TV_SHORT","ONA",""].includes(entry.animeFormat)||
       !(entry.prequelIds||[]).includes(source.animeId))continue;
    visited.add(id);entries.push(entry);queue.push(entry);
    if(entries.length>=24)break;
   }
  }
  entries.sort((a,b)=>String(a.date||a.year||"9999").localeCompare(String(b.date||b.year||"9999"))||a.animeId-b.animeId);
  return {root,entries,selectedId:selected};
 }
 function reset(){cursor.movie=cursor.series=100;cursor.anime=3;cursor.kitsu=0;moreAvailable.movie=moreAvailable.series=moreAvailable.anime=true}
 return{seed,loadMore,search,reset,normalizeCinemeta,normalizeAnime,normalizeKitsu,unique,groupCatalogRows,animeFamily,__test:{anime,cinemeta,kitsu,getAnimeRecord}};
})();
