const fs=require('node:fs');
const assert=require('node:assert/strict');
const css=fs.readFileSync('web/ux.css','utf8');
const app=fs.readFileSync('web/app.js','utf8');

function luminance(hex){
  const [r,g,b]=hex.replace('#','').match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return r*0.2126+g*0.7152+b*0.0722;
}
function contrast(a,b='#ffffff'){
  const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);
  return (values[0]+0.05)/(values[1]+0.05);
}
const token=name=>css.match(new RegExp('--'+name+':(#[0-9a-f]{6})'))?.[1];
assert.ok(contrast(token('focus'))>=3,'keyboard focus meets non-text contrast');
assert.ok(contrast(token('control-border'))>=3,'form boundaries remain visible against white');
assert.ok(contrast(token('text-secondary'))>=4.5,'secondary body text remains readable');
const chartPalette=app.match(/const colors=\[([^\]]+)\]/)[1].match(/#[0-9a-f]{6}/g);
assert.equal(chartPalette.length,6,'the established six-color chart identity remains intact');
chartPalette.forEach(color=>assert.ok(contrast(color)>=3,`chart stroke ${color} meets non-text contrast on white`));
assert.match(css,/button:focus-visible,a:focus-visible,summary:focus-visible,input:focus,select:focus/);
assert.match(css,/\.studio-builder>summary:focus-visible[^}]*outline:3px solid var\(--focus\)/);
assert.match(css,/\.pagehead\.pagehead-compact\{height:0;min-height:0;margin:0;padding:0;border:0\}/,'page heading no longer occupies visible space');
assert.match(css,/\.visually-hidden\{[^}]*clip:rect\(0,0,0,0\)/,'route heading remains available to assistive technology');
assert.match(css,/\.series-toolbar\{[^}]*flex-wrap:wrap/,'new-series action has a wrapping toolbar outside the manager');
assert.match(css,/\.applied-series-manager \.series-ribbon\{[^}]*overflow-y:auto/,'applied series have an explicit local scroll region');
assert.match(css,/\.series-ribbon \.series-remove\{position:static/,'delete action no longer overlays the edit target');
assert.match(css,/\.series-ribbon \.series-edit\{[^}]*overflow-wrap:anywhere/,'long source labels wrap rather than escape their chips');
assert.match(css,/\.tablewrap\{[^}]*max-width:100%/,'table overflow stays inside its container');
assert.match(css,/\.studio-builder>summary[^}]*justify-content:flex-start/,'disclosure indicator and label stay grouped');

const mobile=css.slice(css.indexOf('@media(max-width:760px)'));
assert.match(mobile,/#nav\{[^}]*position:fixed[^}]*bottom:0[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,'mobile primary navigation uses four fixed bottom tabs');
assert.match(mobile,/#nav button\{[^}]*min-height:52px/);
assert.match(mobile,/main\{padding:16px 12px calc\(104px \+ env\(safe-area-inset-bottom\)\)/,'content clears bottom tabs and device safe area');
assert.match(mobile,/padding:7px max\(8px,env\(safe-area-inset-right\)\) calc\(7px \+ env\(safe-area-inset-bottom\)\)/);
assert.match(mobile,/\.series-ribbon \.series-remove\{width:44px;height:44px;min-height:44px/,'mobile delete target is fully touch-sized');
assert.match(mobile,/\.series-choices label,\.mapping-picker \.series-choices label\{min-height:44px/);
assert.match(mobile,/input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),select[^}]*font-size:16px/,'mobile fields avoid small text and focus zoom');
assert.match(mobile,/\.search:focus-within\{outline:3px solid var\(--focus\)/,'search wrapper supplies visible focus when its inner input outline is suppressed');
assert.match(mobile,/\.series-toolbar>div\{[^}]*justify-content:flex-end/,'mobile chart actions remain together on one row when room permits');
assert.match(mobile,/\.series-toolbar>\.series-ribbon-label\{width:auto;flex:0 1 auto/,'applied-series count no longer forces a whole toolbar row');
assert.match(mobile,/#studioNew\{order:-1\}/,'new-series action remains first even when undo is available');
assert.match(mobile,/\.charttools\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/,'mobile chart tools fit selectors and actions into two rows');
assert.match(mobile,/\.charttools label\{grid-column:span 3/,'each chart selector occupies half the available width');
assert.match(mobile,/\.charttools>button\{grid-column:span 2;min-height:44px[^}]*overflow-wrap:anywhere/,'three actions retain touch targets and wrap without clipping');
assert.match(mobile,/#png\{grid-column:span 2\}/,'export no longer forces an additional mobile toolbar row');
assert.match(css,/\.builder-loading\{display:flex;align-items:center;gap:8px[^}]*background:#f3f8f3/,'loading feedback aligns text and spinner on a quiet surface');
assert.match(css,/\.builder-loading \.ui-busy-indicator\{flex-shrink:0\}/,'loading spinner retains its dimensions beside wrapped text');
assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length,'all CSS blocks close');
assert.doesNotMatch(css,/overflow-x\s*:\s*hidden/,'responsive layout does not conceal horizontal overflow globally');

// The visual layer does not silently change chart data or limit series counts.
assert.match(app,/CSV 包含全部系列/);
console.log('UI styles: contrast, focus, compact hierarchy, long labels, local overflow and mobile target/navigation checks passed');
