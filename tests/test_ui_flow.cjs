'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('web/app.js','utf8'),studio=fs.readFileSync('web/studio.js','utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const tests=[];const test=(name,run)=>tests.push({name,run});
const snippet=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end));
function nodes(){
  const map=new Map();
  return selector=>{if(!map.has(selector))map.set(selector,{textContent:'',innerHTML:'',disabled:false,open:false,focusCount:0,attributes:{},querySelectorAll:()=>[],setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},focus(){this.focusCount++;}});return map.get(selector);};
}
function catalogContext(){
  const $=nodes(),calls=[];
  const initial={tables:[{id:'A',scanned_at:'v1',archived:false}],status:{busy:false,errors:[],last_sync:'2026-09-22 12:00'},config:{folder:'current'}};
  let current=initial;
  const c=vm.createContext({structuredClone,console,$,state:{tables:[],cache:new Map(),page:'compare',basket:[]},draft:{previewActive:false},lastStamp:'',activeTables:()=>c.state.tables.filter(t=>!t.archived),api:async()=>current,renderCatalogUpdateNotice:()=>calls.push('notice'),toast:message=>calls.push(message),go:async(page,options)=>calls.push({page,options})});
  vm.runInContext(snippet('function catalogStamp(', 'function go('),c);
  return {c,$,calls,initial,setResult:result=>current=result,next:version=>({...initial,tables:[{id:'A',scanned_at:version,archived:false}]})};
}

test('catalog changes during a modal keep live data until explicit acceptance',async()=>{
  const {c,$,calls,setResult,next}=catalogContext();
  assert.equal(await c.refreshCatalog(),true);c.state.cache.set('A',{rows:[{销量:10}]});const stamp=c.lastStamp;
  $('#dialog').open=true;setResult(next('v2'));
  assert.equal(await c.refreshCatalog(),false);assert.equal(c.state.catalogPending,true);
  assert.equal(c.state.cache.get('A').rows[0].销量,10);assert.equal(c.state.tables[0].scanned_at,'v1');assert.equal(c.lastStamp,stamp);
  assert.equal(await c.applyPendingCatalog(),false,'cannot reload under a modal');
  $('#dialog').open=false;
  assert.equal(await c.refreshCatalog(),false,'closing modal does not silently consume pending changes');
  assert.equal(await c.applyPendingCatalog(),true);assert.equal(c.state.tables[0].scanned_at,'v2');assert.equal(c.state.cache.size,0);assert.equal(c.state.catalogPending,false);
  assert.deepEqual(plain(calls.find(item=>item&&item.page)),{page:'compare',options:{background:true}});
});
test('active chart draft defers changes and keeps the most recent pending version',async()=>{
  const {c,setResult,next}=catalogContext();await c.refreshCatalog();c.state.cache.set('A',{rows:[{销量:10}]});
  c.draft={id:'A',previewActive:true,selectedValues:['M9'],filters:[{field:'区域',value:'华东'}]};const before=plain(c.draft);
  setResult(next('v2'));assert.equal(await c.refreshCatalog(),false);
  setResult(next('v3'));assert.equal(await c.refreshCatalog(),false);assert.equal(c.state.pendingCatalog.tables[0].scanned_at,'v3');
  assert.equal(c.state.tables[0].scanned_at,'v1');assert.deepEqual(c.draft,before);
  await c.applyPendingCatalog();assert.equal(c.state.tables[0].scanned_at,'v3');assert.deepEqual(c.draft,before,'refresh preserves fields for visible stale-selection validation');
});
test('unchanged polling never clears cached rows and explicit correction can force install',async()=>{
  const {c,setResult,next}=catalogContext();await c.refreshCatalog();c.state.cache.set('A',{rows:[]});
  assert.equal(await c.refreshCatalog(),false);assert.equal(c.state.cache.size,1);
  c.draft.previewActive=true;setResult(next('v2'));
  assert.equal(await c.refreshCatalog({force:true}),true);assert.equal(c.state.catalogPending,false);assert.equal(c.state.tables[0].scanned_at,'v2');
});
test('late responses from an old catalog cannot poison the new cache',async()=>{
  let resolveOld,count=0;
  const c=vm.createContext({state:{cache:new Map(),catalogVersion:1},api:async()=>++count===1?new Promise(resolve=>resolveOld=resolve):{rows:[{value:'new'}]}});
  vm.runInContext(snippet('async function tableData(', 'function tableById('),c);
  const response=c.tableData('A');c.state.catalogVersion=2;resolveOld({rows:[{value:'old'}]});
  assert.equal((await response).rows[0].value,'new');assert.equal(c.state.cache.get('A').rows[0].value,'new');assert.equal(count,2);
});
test('saved analysis resets its source, parameters and inactive preview through the shared helper',()=>{
  const $=nodes(),open={dataset:{openview:'0'}},loaded=[],saved=[{name:'B',type:'line',limit:'全部',basket:[{id:'B',uid:'B1',metric:'销量',dimension:'日期',label:'B'}]}];
  const c=vm.createContext({structuredClone,$,state:{basket:[{id:'A'}],chartPreview:[{id:'A'}],chartUndo:[{id:'unrelated'}]},draft:{id:'A',sourceId:'A',previewActive:true,editUid:'A1'},views:()=>saved,header:()=>'',empty:()=>'',esc:String,normalizeSeriesIds:basket=>basket,document:{querySelectorAll:selector=>selector==='[data-openview]'?[open]:[]},persistBasket:()=>{},go:()=>{}});
  vm.runInContext(studio.slice(studio.indexOf('function resetChartDraft('),studio.indexOf('function renderCatalogUpdateNotice(')),c);
  const load=c.loadChartDraftFromSeries;c.loadChartDraftFromSeries=first=>{loaded.push(first);load(first);};
  vm.runInContext(snippet('function saved(){','async function search('),c);c.saved();open.onclick();
  assert.equal(loaded.length,1);assert.equal(c.state.basket[0].id,'B');assert.equal(c.draft.id,'B');assert.equal(c.draft.sourceId,'B');assert.equal(c.state.chartPreview,null);assert.equal(c.draft.previewActive,false);assert.equal(c.draft.editUid,undefined);
  assert.equal(c.state.chartUndo,null,'the previous analysis undo history must not leak into this saved analysis');
  assert.equal(c.state.builderOpen,false,'opening saved analysis should put its chart first');
  assert.equal(c.state.seriesManagerOpen,false,'long series labels should not push a saved chart below the fold');
  c.state.basket[0].label='changed';assert.equal(saved[0].basket[0].label,'B','loading cannot mutate the saved view');
});
test('preview and commit have identical append/replace/update content without allocating preview IDs',()=>{
  const c=vm.createContext({});vm.runInContext(fs.readFileSync('web/chart-logic.js','utf8')+'\n'+fs.readFileSync('web/chart-state.js','utf8'),c);
  const basket=[{id:'A',uid:'one',label:'A',filters:[{field:'区域',value:'华东'}]},{id:'B',uid:'two',label:'B'}],incoming=[{id:'C',label:'C',filters:[{field:'车型',value:'M9'}]},{id:'D',label:'D'}],before=plain({basket,incoming});
  const strip=items=>plain(items).map(({uid,...rest})=>rest);
  for(const mode of ['replace','append','update']){
    const preview=c.previewChartSeries(basket,incoming,mode,'two'),commit=c.commitChartSeries(basket,incoming,mode,'two');
    assert.deepEqual(strip(preview),strip(commit),mode);if(mode==='update')assert.equal(preview[1].uid,'two');
  }
  vm.runInContext("chartUid=()=>{throw Error('preview must not allocate IDs')}",c);
  const preview=c.previewChartSeries(basket,incoming,'append');preview[0].filters[0].value='changed';preview[2].filters[0].value='changed';
  assert.deepEqual({basket,incoming},before);
  assert.throws(()=>c.previewChartSeries(basket,incoming,'update','deleted'),/已被移除/);
});
test('a deleted filter field remains an error instead of silently broadening the chart',()=>{
  const c=vm.createContext({});vm.runInContext(fs.readFileSync('web/chart-logic.js','utf8')+'\n'+fs.readFileSync('web/chart-state.js','utf8'),c);
  const draft={wide:false,dimension:'日期',metrics:['销量'],operation:'求和',filters:[{field:'区域',value:'华东'}]},before=plain(draft);
  assert.throws(()=>c.draftSeriesSpecs(draft,{id:'A',fields:[{name:'日期',type:'text'},{name:'销量',type:'number'}]}),/筛选字段.*已不存在/);
  assert.deepEqual(draft,before);
});
test('table-only mode reveals the numeric panel and does not collapse it on other types',()=>{
  const $=nodes(),c=vm.createContext({$,state:{chartType:'table'}});
  vm.runInContext(snippet('function syncComparisonTableVisibility(', 'async function render('),c);
  c.syncComparisonTableVisibility();assert.equal($('.numeric-details').open,true);
  c.state.chartType='line';c.syncComparisonTableVisibility();assert.equal($('.numeric-details').open,true);
});
test('navigation exposes active page and focuses changed routes, never background refresh',async()=>{
  const $=nodes(),buttons=['home','compare'].map(page=>({dataset:{page},classList:{toggle(){}},attributes:{},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];}}));
  $('#nav').querySelectorAll=()=>buttons;
  const c=vm.createContext({$,state:{page:'home'},location:{},renderToken:0,render:async()=>{c.renderToken++;},toast:()=>{},esc:String,empty:()=>''});
  vm.runInContext(snippet('function go(', 'function syncComparisonTableVisibility('),c);
  await c.go('compare');assert.equal(buttons[1].attributes['aria-current'],'page');assert.equal(buttons[0].attributes['aria-current'],undefined);assert.equal($('#main').focusCount,1);
  await c.go('compare',{background:true});assert.equal($('#main').focusCount,1);
  await c.go('home',{background:true});assert.equal($('#main').focusCount,1);
});
test('live search and clearing the query keep focus in the search input',async()=>{
  const $=nodes();let scheduled;
  const c=vm.createContext({$,state:{page:'home',query:''},location:{},renderToken:0,searchTimer:null,render:async()=>{c.renderToken++;},clearTimeout:()=>{},setTimeout:callback=>{scheduled=callback;return 1;},toast:()=>{},esc:String,empty:()=>''});
  vm.runInContext(snippet('function go(', 'function syncComparisonTableVisibility('),c);
  const start=app.indexOf("$('#search').oninput=");
  vm.runInContext(app.slice(start,app.indexOf(';document.addEventListener',start))+';',c);
  for(const [query,page] of [['SKU','search'],['','home']]){
    $('#search').oninput({target:{value:query}});scheduled();await Promise.resolve();await Promise.resolve();
    assert.equal(c.state.page,page);assert.equal($('#main').focusCount,0,'search updates must not invoke route focus');
  }
});
test('truncated search results disclose the shown count and a way to narrow results',async()=>{
  const $=nodes(),headings=[];let count=77;
  const c=vm.createContext({$,state:{query:'SKU'},renderToken:1,header:(_eyebrow,_title,subtitle)=>{headings.push(subtitle);return subtitle;},api:async()=>({hits:Array.from({length:count},(_,id)=>({table:{id,table_name:'SKU',relative_path:'source.xlsx',sheet_name:'Sheet1',range_ref:'A1:B3',fields:[]},rows:[]}))}),esc:String,fmt:String,empty:()=>'',bindTableActions:()=>{}});
  vm.runInContext(snippet('async function search(', 'function sourceDialog('),c);
  await c.search(1);assert.match(headings.at(-1),/77.*当前显示前 60.*缩小关键词/);assert.equal(($('#main').innerHTML.match(/<article /g)||[]).length,60);
  count=2;await c.search(1);assert.doesNotMatch(headings.at(-1),/前 60/);assert.equal(($('#main').innerHTML.match(/<article /g)||[]).length,2);
});
test('compact page heading retains an accessible route name without visible introductory copy',()=>{
  const c=vm.createContext({esc:String});vm.runInContext(snippet('function header(', 'function options('),c);
  const rendered=c.header('CHART STUDIO / 图表展示','','选表、选参数');
  assert.match(rendered,/<h1 class="visually-hidden">图表展示<\/h1>/);
  assert.doesNotMatch(rendered,/CHART STUDIO|选表、选参数/);
  assert.match(c.header('OVERVIEW / 工作台','从分散的表格，到清晰的比较'),/<h1 class="visually-hidden">工作台<\/h1>/);
});
test('missing selected options remain visible instead of appearing to choose the first valid field',()=>{
  const c=vm.createContext({esc:String});vm.runInContext(snippet('function options(', 'function empty('),c);
  assert.match(c.options(['日期','车型'],'旧字段'),/<option value="旧字段" selected>\[已失效\] 旧字段<\/option>/);
  assert.doesNotMatch(c.options(['求和','平均值'],''),/已失效/);
  assert.match(c.options(['日期','车型'],'车型'),/<option value="车型" selected>车型<\/option>/);
});

(async()=>{let failures=0;for(const {name,run} of tests){try{await run();console.log(`PASS ${name}`);}catch(error){failures++;console.error(`FAIL ${name}\n${error.stack}`);}}console.log(`UI flow: ${tests.length-failures}/${tests.length} checks passed`);if(failures)process.exitCode=1;})();
