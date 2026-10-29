(function(root){
  'use strict';
  const TABS=['analysis','evidence','lighting','about'];
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
  const api={playbackPresentation,TABS,clampTime,shotAtTime,timeLabel,validTab,collectEvidence,shortLabel};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FilmReportModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
