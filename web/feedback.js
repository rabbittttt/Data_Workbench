'use strict';

// Optional presentation only: callers update text, visibility and ARIA state first.
// Chart values, selections and business actions never wait for an animation.
(() => {
  const running=new WeakMap(),active=new Set();
  let preference=null;
  try{if(typeof globalThis.matchMedia==='function')preference=globalThis.matchMedia('(prefers-reduced-motion: reduce)');}catch{}
  const presets={
    toast:{duration:180,frames:[{opacity:.72,translate:'0 6px'},{opacity:1,translate:'0 0'}]},
    status:{duration:120,frames:[{opacity:.72},{opacity:1}]},
    dialog:{duration:180,frames:[{opacity:.8,translate:'0 4px'},{opacity:1,translate:'0 0'}]},
  };
  const forget=entry=>{if(running.get(entry.element)===entry)running.delete(entry.element);active.delete(entry);};
  const stop=element=>{
    const entry=running.get(element);if(!entry)return;
    forget(entry);
    try{entry.animation.cancel();}catch{}
  };
  const motionPreferenceChanged=()=>{if(preference?.matches)for(const entry of [...active])stop(entry.element);};
  if(typeof preference?.addEventListener==='function')preference.addEventListener('change',motionPreferenceChanged);
  else if(typeof preference?.addListener==='function')preference.addListener(motionPreferenceChanged);

  globalThis.uiFeedback=function uiFeedback(element,kind='status'){
    if(!element||(typeof element!=='object'&&typeof element!=='function'))return null;
    stop(element);
    const preset=Object.prototype.hasOwnProperty.call(presets,kind)?presets[kind]:null;
    if(!preset||!preference||preference.matches||typeof element.animate!=='function')return null;
    // Defend against accidental wiring to a chart surface. Only feedback moves.
    if(element.matches?.('canvas,svg,.compare-chart,.mini-chart,.recommended-chart'))return null;
    let animation;
    try{animation=element.animate(preset.frames,{duration:preset.duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'none'});}catch{return null;}
    if(!animation||typeof animation.cancel!=='function')return null;
    const entry={element,animation};running.set(element,entry);active.add(entry);
    const cleanup=()=>forget(entry);
    // Both completion and cancellation only release presentation bookkeeping.
    if(typeof animation.finished?.then==='function')animation.finished.then(cleanup,cleanup);
    else {animation.onfinish=cleanup;animation.oncancel=cleanup;}
    return animation;
  };
})();
