
"use strict";
const LumaPeople=(()=>{
const profileCache=new Map();
const escape=s=>safe(s);
const min=n=>{if(!Number.isFinite(+n)||+n<=0)return"";let x=Math.round(+n);return x>=60?Math.floor(x/60)+"h "+(x%60?x%60+"m":""):x+"m"};
function current(x){
 const d=state.details||{};let cast=[],crew=[],creators=[],runtime=0,genres=[],studios=[],trailer="";
 if(x.source==="tmdb"){
  cast=(d.credits?.cast||[]).slice(0,25).map(p=>({provider:"tmdb",id:p.id,name:p.name,role:p.character||"",photo:p.profile_path?image(p.profile_path,185):""}));
  crew=(d.credits?.crew||[]).filter(p=>["Director","Writer","Screenplay","Producer","Executive Producer","Creator"].includes(p.job)).slice(0,40).map(p=>({provider:"tmdb",id:p.id,name:p.name,job:p.job}));
  creators=(d.created_by||[]).map(p=>p.name);
  runtime=d.runtime||d.episode_run_time?.[0]||0;
  genres=(d.genres||[]).map(g=>g.name);
  studios=(d.production_companies||[]).slice(0,3).map(p=>p.name);
  const v=(d.videos?.results||[]).find(q=>q.site==="YouTube"&&q.type==="Trailer"&&/^[\w-]{11}$/.test(q.key));
  if(v)trailer="https://www.youtube.com/watch?v="+v.key;
 }else if(x.source==="tvmaze"){
  cast=(d.cast||[]).filter(p=>p?.person).slice(0,25).map(p=>({provider:"tvmaze",id:p.person.id,name:p.person.name,role:p.character?.name||"",photo:p.person.image?.medium||p.person.image?.original||""}));
  crew=(d.crew||[]).filter(p=>p?.person).slice(0,40).map(p=>({provider:"tvmaze",id:p.person.id,name:p.person.name,job:p.type||"Crew"}));
  runtime=x.runtime||0;genres=x.genreNames||[];studios=x.network?[x.network]:[];
 }else{runtime=x.runtime||0;genres=x.genreNames||[]}
 return {cast,crew,creators,runtime,genres,studios,trailer};
}
function personButton(p){return'<button type="button" class="castNameLink" data-person="'+escape(p.provider+":"+p.id)+'">'+escape(p.name)+'</button>'}
function markup(x){
 const d=current(x),directors=d.crew.filter(p=>p.job==="Director").slice(0,5),writers=d.crew.filter(p=>["Writer","Screenplay"].includes(p.job)).slice(0,5);
 const chips=[...d.genres.slice(0,3),min(d.runtime),x.tvStatus||"",x.network||""].filter(Boolean);
 let html='<section class="richDetails">';
 if(chips.length)html+='<div class="titleFacts">'+chips.map(v=>'<span>'+escape(v)+'</span>').join("")+'</div>';
 if(directors.length)html+='<div class="creditLine"><b>Director'+(directors.length>1?"s":"")+'</b><span>'+directors.map(personButton).join(", ")+'</span></div>';
 if(d.creators.length)html+='<div class="creditLine"><b>Created by</b><span>'+d.creators.map(escape).join(", ")+'</span></div>';
 if(writers.length)html+='<div class="creditLine"><b>Writers</b><span>'+writers.map(personButton).join(", ")+'</span></div>';
 if(d.trailer)html+='<button type="button" class="secondary trailerButton" id="lumaTrailer">▶ Watch trailer</button>';
 if(d.cast.length)html+='<div class="peopleSection"><h3>Cast & characters</h3><div class="peopleRail">'+d.cast.map(p=>'<button class="personTile" type="button" data-person="'+escape(p.provider+":"+p.id)+'"><div class="personPortrait">'+(p.photo?'<img loading="lazy" src="'+escape(p.photo)+'" alt="'+escape(p.name)+'" onerror="this.remove()">':'<span>✦</span>')+'</div><b>'+escape(p.name)+'</b><small>'+escape(p.role)+'</small></button>').join("")+'</div></div>';
 if(d.studios.length)html+='<div class="creditLine"><b>Production</b><span>'+d.studios.map(escape).join(" · ")+'</span></div>';
 if(!d.cast.length&&x.source!=="tvmaze"&&x.source!=="tmdb")html+='<p class="micro">Connect TMDB in Settings for cast portraits, directors, biographies and filmographies for this catalog.</p>';
 html+='</section>';return html;
}
function bind(x){
 $$("[data-person]").forEach(el=>el.onclick=()=>open(el.dataset.person));
 const trailer=current(x).trailer;
 if($("#lumaTrailer")&&trailer)$("#lumaTrailer").onclick=()=>window.open(trailer,"_blank","noopener");
}
async function open(key){
 const [provider,id]=String(key).split(":");if(!["tmdb","tvmaze"].includes(provider)||!/^\d+$/.test(id))return;
 const original=state.selected;
 modal('<div class="pad"><h2>Loading person profile…</h2><p>Fetching biography and filmography.</p></div>');
 try{
  let p={},film=[];
  if(profileCache.has(key)){({p,film}=profileCache.get(key))}
  else if(provider==="tmdb"){
   if(!state.tmdbKey)throw Error("TMDB is not connected.");
   const v=await tmdb("person/"+id,{append_to_response:"combined_credits"});
   p={name:v.name,photo:v.profile_path?image(v.profile_path,342):"",bio:v.biography||"",born:v.birthday||"",place:v.place_of_birth||"",department:v.known_for_department||""};
   film=(v.combined_credits?.cast||[]).filter(t=>["movie","tv"].includes(t.media_type)&&t.id).map(t=>({...normalizeTMDB(t),role:t.character||""}));
  }else{
   const [person,credits]=await Promise.all([api("https://api.tvmaze.com/people/"+id),api("https://api.tvmaze.com/people/"+id+"/castcredits?embed=show")]);
   p={name:person.name,photo:person.image?.original||person.image?.medium||"",born:person.birthday||"",place:person.country?.name||"",department:"TV",bio:""};
   film=(Array.isArray(credits)?credits:[]).filter(v=>v._embedded?.show).map(v=>({...normalizeTVMaze(v._embedded.show),role:"Cast"}));
  }
  const seen=new Set;film=film.filter(f=>{if(!f.id||seen.has(f.id))return false;seen.add(f.id);return true}).sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0)||Number(b.popularity||0)-Number(a.popularity||0)).slice(0,100);
  profileCache.set(key,{p,film});
  let markup='<div class="personProfile"><div class="personProfileHead"><div class="personProfileArt">'+(p.photo?'<img src="'+escape(p.photo)+'" alt="'+escape(p.name)+'" loading="lazy">':'<span>✦</span>')+'</div><div><div class="eyebrow">ACTOR PROFILE</div><h2>'+escape(p.name)+'</h2><p class="profileMeta">'+[p.department,p.born,p.place].filter(Boolean).map(escape).join(" · ")+'</p>'+(p.bio?'<p class="personBiography">'+escape(p.bio)+'</p>':'<p class="micro">Biography not supplied by this provider.</p>')+'</div></div><h3>Filmography <small>'+film.length+' titles</small></h3>';
  markup+=film.length?'<div class="filmographyGrid">'+film.map(f=>'<button type="button" class="filmographyCard" data-film="'+escape(f.id)+'"><div class="filmographyPoster">'+(f.poster?'<img loading="lazy" src="'+escape(f.poster)+'" alt="" onerror="this.remove()">':'✦')+'</div><span><b>'+escape(f.title)+'</b><small>'+escape(f.year||"")+' · '+escape(f.type)+'</small>'+(typeof audienceBadge==="function"?audienceBadge(f):"")+(typeof certificateSlot==="function"?certificateSlot(f):"")+languageBadges(f)+(f.role?'<small>'+escape(f.role)+'</small>':"")+'</span></button>').join("")+'</div>':'<p class="micro">No filmography items were returned.</p>';
  markup+='<div class="actions"><button type="button" class="secondary" id="backFromPerson">← Back to movie</button></div></div>';
  modal(markup);
  $("#backFromPerson").onclick=()=>original?showDetails():closeModal();
  $$("[data-film]").forEach(el=>el.onclick=()=>{const title=film.find(f=>f.id===el.dataset.film);if(!title)return;state.items=unique([title,...state.items]);openTitle(title.id)});
 }catch(e){modal('<div class="pad"><h2>Actor profile unavailable</h2><p>'+escape(String(e.message||e).slice(0,150))+'</p><button type="button" class="secondary" id="backFromPerson">Back to movie</button></div>');$("#backFromPerson").onclick=()=>original?showDetails():closeModal()}
}
return{markup,bind,open};
})();
