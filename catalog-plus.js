"use strict";
/* Public metadata-only catalogs: CineMeta (Stremio) and AniList (anime). */
const LumaCatalogPlus=(()=>{
 const C="https://v3-cinemeta.strem.io",A="https://graphql.anilist.co";
 const gql="query ($page:Int,$perPage:Int,$search:String){Page(page:$page,perPage:$perPage){pageInfo{hasNextPage} media(type:ANIME,isAdult:false,sort:POPULARITY_DESC,search:$search){id idMal title{english romaji native} description(asHtml:false) startDate{year month day} coverImage{large extraLarge} bannerImage averageScore genres format episodes}}}";
 const cursor={movie:100,series:100,anime:3},moreAvailable={movie:true,series:true,anime:true};
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
   date,episodeCount:Number(v.episodes)||0};
 }
 function unique(rows){
  const ids=new Set(),keys=new Set();
  return rows.filter(v=>{
   if(!v?.id||!v.title||ids.has(v.id))return false;
   const k=v.type+"|"+norm(v.title)+"|"+v.year;
   if(v.year&&keys.has(k))return false;
   ids.add(v.id);if(v.year)keys.add(k);
   return true;
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
 async function seed(){
  const jobs=await Promise.allSettled([cinemeta("movie"),cinemeta("series"),anime(1),anime(2)]);
  const all=[];
  for(let i=0;i<jobs.length;i++){
   if(jobs[i].status!=="fulfilled")continue;
   const v=jobs[i].value;
   if(i<2)all.push(...v);
   else {all.push(...v.items);if(i===3)moreAvailable.anime=v.hasNext}
  }
  return unique(all);
 }
 async function loadMore(section){
  if(section==="Anime"){
   if(!moreAvailable.anime)return{items:[],hasNext:false};
   const r=await anime(cursor.anime++);moreAvailable.anime=r.hasNext;return r;
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
  return unique(results.flatMap(r=>r.status==="fulfilled"?(Array.isArray(r.value)?r.value:r.value.items):[]));
 }
 function reset(){cursor.movie=cursor.series=100;cursor.anime=3;moreAvailable.movie=moreAvailable.series=moreAvailable.anime=true}
 return{seed,loadMore,search,reset,normalizeCinemeta,normalizeAnime,unique,__test:{anime,cinemeta}};
})();
