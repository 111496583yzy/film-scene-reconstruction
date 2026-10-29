(function(root){
  'use strict';
  const TABS=['analysis','evidence','lighting','about'];
  const SETUP_COLORS=['#4f8dcc','#c77a48','#8b78c8','#3d9b88','#be668c','#a49841','#6f9bb8','#b76d62','#7c9a54','#9c82a8','#4c9da5','#b28a58'];
  const UNKNOWN_SETUP_COLOR='#6b7280';
  const isColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  function setupColor(setup,allSetups=[]){
    const id=typeof setup==='string'?setup:setup?.id;
    if(typeof id!=='string'||!id.trim())return UNKNOWN_SETUP_COLOR;
    const configured=typeof setup==='object'&&setup!==null?setup.color:(Array.isArray(allSetups)?allSetups:[]).find(s=>s?.id===id)?.color;
    if(isColor(configured))return configured.toLowerCase();
    // Keep the existing blue camera in legacy single-setup/rehearsal documents.
    if(!Array.isArray(allSetups)||allSetups.length<=1)return '#4c8dff';
    // Pass the complete setup list. Its order cannot recolor a multi-setup identity.
    let hash=2166136261;for(let i=0;i<id.length;i++){hash^=id.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return SETUP_COLORS[(hash>>>0)%SETUP_COLORS.length];
  }
  function colorText(hex){
    const color=isColor(hex)?hex:UNKNOWN_SETUP_COLOR;
    const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    const luminance=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];
    return (luminance+.05)/.05>=1.05/(luminance+.05)?'#000000':'#ffffff';
  }
  function eventAtTime(events,time,duration){
    if(!Array.isArray(events)||!events.length||!Number.isFinite(time)||!Number.isFinite(duration)||time<0||time>duration)return null;
    // A playback cursor can rest exactly on the movie end; do not fill a trailing gap.
    const final=events.at(-1);if(time===duration)return final?.end===duration&&final.start<duration?final:null;
    let lo=0,hi=events.length-1;while(lo<=hi){const mid=(lo+hi)>>1,event=events[mid];if(time<event.start)hi=mid-1;else if(time>=event.end)lo=mid+1;else return event;}
    return null;
  }
  function eventsForShot(events,shot){
    if(!Array.isArray(events)||!shot||!Number.isFinite(shot.start)||!Number.isFinite(shot.end)||shot.end<=shot.start)return [];
    return events.filter(event=>Number.isFinite(event?.start)&&Number.isFinite(event?.end)&&event.end>event.start&&event.start<shot.end&&event.end>shot.start);
  }
  function clampTime(value,duration){return Math.max(0,Math.min(Number.isFinite(duration)?duration:0,Number.isFinite(value)?value:0));}
  function shotAtTime(shots,value){
    if(!shots.length)return -1;const t=Number.isFinite(value)?value:0;if(t>=shots.at(-1).end)return shots.length-1;
    let lo=0,hi=shots.length-1;while(lo<=hi){const mid=(lo+hi)>>1,s=shots[mid];if(t<s.start)hi=mid-1;else if(t>=s.end)lo=mid+1;else return mid;}return Math.max(0,Math.min(shots.length-1,lo));
  }
  function timeLabel(value,decimals=2){const factor=10**decimals,t=Math.round(Math.max(0,Number.isFinite(value)?value:0)*factor)/factor,minutes=Math.floor(t/60),seconds=t-minutes*60;return `${minutes}:${seconds.toFixed(decimals).padStart(decimals?3+decimals:2,'0')}`;}
  function validTab(value){return TABS.includes(value)?value:'analysis';}
  function collectEvidence(note,setup,scene,evidence){
    const ids=new Set(),collect=c=>c?.evidenceIds?.forEach(id=>ids.add(id));
    for(const k of ['cameraNote','lens','lightNote','interpretation','reproduction'])collect(note[k]);
    collect(setup?.camera?.claim);collect(setup?.camera?.previewClaim);collect(note.cameraMotion?.claim);
    (scene?.fixtures||[]).forEach(f=>collect(f.claim));(scene?.elements||[]).forEach(f=>collect(f.claim));
    (note.subjects||[]).forEach(p=>{collect(p.claim);collect(p.motion?.claim);});(note.lighting||[]).forEach(f=>collect(f.claim));
    const map=new Map(evidence.map(e=>[e.id,e]));return [...ids].map(id=>map.get(id)).filter(Boolean).sort((a,b)=>(a.shotId===note.shotId?0:1)-(b.shotId===note.shotId?0:1)||(a.at??Infinity)-(b.at??Infinity));
  }
  function shortLabel(shot,setup){return (setup?.label||shot.frame||shot.id).split(/[：:]/)[0];}
  function playbackPresentation({paused=true,ended=false,error=false}={}){const playing=!paused&&!ended&&!error;return {playing,label:error?'选择原片':playing?'暂停':ended?'重播':'播放',ariaLabel:error?'选择本地视频以恢复播放':playing?'暂停原片':ended?'重播原片':'播放原片'};}
  const api={playbackPresentation,TABS,clampTime,shotAtTime,timeLabel,validTab,collectEvidence,shortLabel,setupColor,colorText,eventAtTime,eventsForShot};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FilmReportModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
