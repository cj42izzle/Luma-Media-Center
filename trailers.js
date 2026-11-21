"use strict";
const LumaTrailers=(()=>{
 const known=new Map();
 const youtube=id=>typeof id==="string"&&/^[\w-]{11}$/.test(id)?{kind:"youtube",id}:null;
 async function resolve(x){
  const kind=x.type==="Movie"?"movie":"series";
  if(x.tmdbId && state.tmdbKey){
   try{
    const data=await tmdb("/"+(kind==="movie"?"movie":"tv")+"/"+Number(x.tmdbId)+"/videos");
    const trailers=(data.results||[]).filter(v=>v.site==="YouTube"&&v.type==="Trailer").sort((a,b)=>Number(b.official)-Number(a.official));
    for(const v of trailers){const result=youtube(v.key);if(result)return result}
   }catch{}
  }
  let imdb=[x.imdbId,x.stremioID,String(x.id).split(":").pop()].find(v=>/^tt\d{5,12}$/.test(v||""));
  if(!imdb && Number(x.mazeId)>0){
   try{imdb=(await api("https://api.tvmaze.com/shows/"+Number(x.mazeId))).externals?.imdb}catch{}
  }
  if(/^tt\d{5,12}$/.test(imdb||"")){
   const meta=(await api("https://v3-cinemeta.strem.io/meta/"+kind+"/"+imdb+".json")).meta;
   for(const t of meta?.trailers||[]){const video=t.type?.toLowerCase()==="trailer"&&youtube(t.source);if(video)return video}
   for(const t of meta?.trailerStreams||[]){const video=youtube(t.ytId);if(video)return video}
  }
  if(Number(x.animeId)>0){
   const data=await api("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"query($id:Int!){Media(id:$id,type:ANIME){trailer{id site}}}",variables:{id:Number(x.animeId)}})});
   const t=data.data?.Media?.trailer;if(t?.site==="youtube")return youtube(t.id);
  }
  if(Number(x.itunesId)>0){
   const data=await api("https://itunes.apple.com/lookup?id="+Number(x.itunesId));
   const row=data.results?.find(v=>String(v.trackId)===String(x.itunesId)&&v.kind==="feature-movie");
   if(row?.previewUrl){const url=new URL(row.previewUrl);if(url.protocol==="https:")return {kind:"preview",url:url.href}}
  }
  return null;
 }
 async function open(x){
  if(document.querySelector(".lumaTrailerDialog"))return;
  const panel=document.createElement("dialog");panel.className="lumaTrailerDialog";panel.setAttribute("aria-label","Trailer for "+x.title);
  panel.innerHTML='<header><h2></h2><button type="button" aria-label="Close trailer">Close</button></header><p role="status">Finding trailer…</p><div class="trailerMedia"></div><footer></footer>';
  const status=panel.querySelector("p"),media=panel.querySelector(".trailerMedia"),footer=panel.querySelector("footer");
  panel.querySelector("h2").textContent=x.title;
  const close=panel.querySelector("button");close.onclick=()=>panel.close();
  panel.onclose=()=>{panel.remove();document.querySelector("#watchTrailer")?.focus({preventScroll:true})};
  document.body.appendChild(panel);panel.showModal();
  try{
   const video=known.get(x.id)||await resolve(x);if(!panel.open)return;
   if(!video){status.textContent="No trailer is listed for this title.";return}
   known.set(x.id,video);status.hidden=true;
   if(video.kind==="youtube"){
    const frame=document.createElement("iframe");frame.title=x.title+" trailer";frame.allowFullscreen=true;
    frame.allow="autoplay; encrypted-media; picture-in-picture";frame.referrerPolicy="strict-origin-when-cross-origin";
    frame.src="https://www.youtube-nocookie.com/embed/"+video.id+"?playsinline=1";media.appendChild(frame);
    const link=document.createElement("a");link.href="https://www.youtube.com/watch?v="+video.id;link.target="_blank";link.rel="noopener noreferrer";link.textContent="Watch on YouTube";footer.appendChild(link);
   }else{
    const player=document.createElement("video");player.controls=true;player.playsInline=true;player.src=video.url;media.appendChild(player);
   }
  }catch{if(panel.open)status.textContent="Trailer lookup is unavailable. Close and try again."}
 }
 return {open};
})();
