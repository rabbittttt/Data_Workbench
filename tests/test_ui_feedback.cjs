'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('web/feedback.js','utf8'),css=fs.readFileSync('web/motion.css','utf8');
const tests=[];const test=(name,run)=>tests.push({name,run});
function environment({reduced=false,withMedia=true}={}){
  const listeners=[],media={matches:reduced,addEventListener(type,listener){assert.equal(type,'change');listeners.push(listener);}};
  const c=vm.createContext(withMedia?{matchMedia:query=>{assert.equal(query,'(prefers-reduced-motion: reduce)');return media;}}:{});
  vm.runInContext(source,c);
  return {c,media,change:matches=>{media.matches=matches;listeners.forEach(listener=>listener({matches}));}};
}
function surface(){
  const calls=[],animations=[];
  const element={textContent:'语义状态已经更新',style:{display:'block',transform:'translateX(-50%)'},animate(frames,options){
    calls.push({frames,options});let done,rejected;
    const animation={cancelCount:0,finished:{then(resolve,reject){done=resolve;rejected=reject;}},cancel(){this.cancelCount++;rejected?.(Error('cancelled'));},finish(){done?.();},lateCancel(){rejected?.(Error('late cancellation'));}};
    animations.push(animation);return animation;
  }};
  return {element,calls,animations};
}

test('feedback is a short presentation effect that preserves semantic state and author transforms',()=>{
  const {c}=environment(),{element,calls}=surface();const before=JSON.stringify(element.style);
  assert.ok(c.uiFeedback(element,'toast'));
  assert.equal(element.textContent,'语义状态已经更新');assert.equal(JSON.stringify(element.style),before);
  assert.ok(calls[0].options.duration<=200);assert.equal(calls[0].options.fill,'none');
  assert.equal(calls[0].frames.at(-1).opacity,1);assert.equal(calls[0].frames.at(-1).translate,'0 0');
  assert.ok(calls[0].frames.every(frame=>!('transform'in frame)),'individual translate leaves toast centering intact');
});
test('a rapid replacement cancels the previous animation for that element only',()=>{
  const {c}=environment(),a=surface(),b=surface();
  const first=c.uiFeedback(a.element,'status'),other=c.uiFeedback(b.element,'status'),second=c.uiFeedback(a.element,'toast');
  assert.equal(first.cancelCount,1);assert.equal(second.cancelCount,0);assert.equal(other.cancelCount,0);
  first.lateCancel();c.uiFeedback(a.element,'dialog');assert.equal(second.cancelCount,1,'late cleanup cannot delete the replacement');
});
test('completed effects release their bookkeeping',()=>{
  const {c}=environment(),{element}=surface(),first=c.uiFeedback(element);first.finish();c.uiFeedback(element);
  assert.equal(first.cancelCount,0,'a finished effect should not be cancelled again');
});
test('reduced motion means no new animation and changing the preference cancels active effects',()=>{
  const disabled=environment({reduced:true}),a=surface();assert.equal(disabled.c.uiFeedback(a.element,'dialog'),null);assert.equal(a.calls.length,0);
  const {c,change}=environment(),b=surface(),d=surface();const first=c.uiFeedback(b.element),second=c.uiFeedback(d.element,'toast');
  change(true);assert.equal(first.cancelCount,1);assert.equal(second.cancelCount,1);assert.equal(c.uiFeedback(b.element),null);assert.equal(b.calls.length,1);
  change(false);assert.ok(c.uiFeedback(b.element));assert.equal(b.calls.length,2);
});
test('null, primitive, missing APIs and unsupported animations safely degrade',()=>{
  const {c}=environment();for(const element of [null,undefined,0,'status',{}])assert.equal(c.uiFeedback(element),null);
  const noMedia=environment({withMedia:false}),a=surface();assert.equal(noMedia.c.uiFeedback(a.element),null);assert.equal(a.calls.length,0);
  assert.equal(c.uiFeedback({animate(){throw Error('unsupported')}}),null);
  assert.equal(c.uiFeedback({animate(){return undefined}}),null);
});
test('fallback cancellation remains safe when animation events or cancellation fail',()=>{
  const {c}=environment();let count=0;
  const element={animate(){count++;return {cancel(){throw Error('already detached')}};}};
  const first=c.uiFeedback(element);assert.equal(typeof first.onfinish,'function');assert.equal(typeof first.oncancel,'function');
  assert.doesNotThrow(()=>c.uiFeedback(element));assert.equal(count,2);
  first.onfinish();assert.doesNotThrow(()=>c.uiFeedback(element));assert.equal(count,3);
});
test('only supported feedback kinds animate and chart surfaces are excluded',()=>{
  const {c}=environment(),a=surface();
  for(const kind of ['chart','loading','unknown','__proto__'])assert.equal(c.uiFeedback(a.element,kind),null);
  a.element.matches=selector=>selector.includes('.compare-chart');assert.equal(c.uiFeedback(a.element,'status'),null);assert.equal(a.calls.length,0);
});
test('each feedback preset is bounded and uses only compositor-friendly opacity and translate',()=>{
  const {c}=environment();for(const kind of ['toast','status','dialog']){
    const {element,calls}=surface();c.uiFeedback(element,kind);
    assert.ok(calls[0].options.duration>0&&calls[0].options.duration<=200);
    calls[0].frames.forEach(frame=>assert.ok(Object.keys(frame).every(key=>['opacity','translate'].includes(key))));
  }
});
test('CSS respects reduced motion including pseudo-elements and leaves chart data untouched',()=>{
  const reduced=css.slice(css.indexOf('@media(prefers-reduced-motion:reduce)'));
  assert.match(reduced,/\*,\*::before,\*::after\{animation:none!important;transition:none!important;scroll-behavior:auto!important\}/);
  assert.match(reduced,/\.ui-busy-indicator\{animation:none!important/);
  assert.match(reduced,/button:active:not\(:disabled\)\{translate:none\}/);
  assert.match(css,/\.series-choices label\{/);assert.match(css,/summary::before/);assert.match(css,/\.ui-busy-indicator\[hidden\]\{display:none\}/);
  assert.doesNotMatch(css,/transition:\s*(all|width|height|top|left)/);
  assert.doesNotMatch(css,/(canvas|compare-chart|recommended-chart|mini-chart)\s*\{/);
  assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);
  assert.match(source,/new WeakMap\(/);assert.doesNotMatch(source,/animationend|transitionend|setTimeout|requestAnimationFrame/);
});

let failed=0;for(const {name,run} of tests){try{run();console.log(`PASS ${name}`);}catch(error){failed++;console.error(`FAIL ${name}\n${error.stack}`);}}
console.log(`UI feedback: ${tests.length-failed}/${tests.length} checks passed`);if(failed)process.exitCode=1;
