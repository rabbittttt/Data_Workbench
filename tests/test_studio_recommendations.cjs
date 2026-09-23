// Exercise real recommendation generation and aggregation with a minimal DOM.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const app=fs.readFileSync('web/app.js','utf8');
const studio=fs.readFileSync('web/studio.js','utf8');
const helpers=app.slice(app.indexOf('const esc='),app.indexOf('const fmt='));
const aggregation=app.slice(app.indexOf('function aggregateRows'),app.indexOf('async function home'));
const recommendations=studio.slice(studio.indexOf('async function refreshStudioRecommendations'),studio.indexOf('const columnLetter'));
const elements=new Map();
const options=[];
const state={charts:[]};
elements.set('#main',{append(panel){elements.set('#'+panel.id,panel);}});
const context=vm.createContext({state,renderToken:1,
  $:selector=>selector.startsWith('#studioRec')&&selector!=='#studioRecommendations'?{id:selector.slice(1)}:elements.get(selector),
  document:{createElement:()=>({remove(){elements.delete('#'+this.id);}})},
  chart:(_element,option)=>options.push(option),
});
vm.runInContext(fs.readFileSync('web/chart-logic.js','utf8')+'\n'+helpers+aggregation+recommendations+';this.recommend=refreshStudioRecommendations;',context);
const table={id:'fixture',table_name:'本表销量',range_ref:'A1:F7'};
const data={rows:[
  {统计类型:'数量',分类:'A','2026-01':100,'2026-02':null,'2026-03':300},
  {统计类型:'数量',分类:'B','2026-01':200,'2026-02':400,'2026-03':600},
  {统计类型:'占比',分类:'A','2026-01':.4,'2026-02':.5,'2026-03':.6},
]};
const base={id:'fixture',wide:true,periods:['2026-03','2026-01','2026-02'],metric:'2026-03',businessMetric:'销量',operation:'求和',vehicleField:'分类',vehicleValue:'A',filterField:'统计类型',filterValue:'数量',label:'数量 A'};
async function run(specs,input=data){options.length=0;await context.recommend(1,specs,table,input);return options;}
const types=()=>options.map(o=>o.series[0].type);

(async()=>{
  await run([base]);
  assert.deepEqual(types(),['line']);
  assert.deepEqual(Array.from(options[0].xAxis.data),['2026-01','2026-02','2026-03']);
  assert.deepEqual(Array.from(options[0].series[0].data),[100,null,300],'recommendations preserve the same null month as the main chart');
  assert.equal(options[0].series[0].connectNulls,false);
  assert.match(elements.get('#studioRecommendations').innerHTML,/本表销量/);

  const ordered={...base,periods:['2026-01','2026-02','2026-03']};
  const ratio={...ordered,businessMetric:'占比',filterValue:'占比',label:'占比 A'};
  await run([ordered,ratio]);
  assert.deepEqual(types(),['line'],'quantity and percentage may not share a latest-period ranking even with the same sum operation');
  assert.doesNotMatch(elements.get('#studioRecommendations').innerHTML,/末期分类排名/);
  await run([ordered,{...ordered,vehicleValue:'B',operation:'平均值'}]);
  assert.deepEqual(types(),['line'],'different aggregation contracts may not share a ranking');

  const other={...ordered,vehicleValue:'B',label:'数量 B'};
  await run([ordered,other]);
  assert.deepEqual(types(),['line','bar','pie']);
  assert.deepEqual(Array.from(options[1].yAxis.data),['A','B']);
  assert.deepEqual(Array.from(options[1].series[0].data),[300,600],'ranking uses only the last selected period, not the sum over months');
  assert.deepEqual(JSON.parse(JSON.stringify(options[2].series[0].data)),[{name:'A',value:300},{name:'B',value:600}]);
  assert.match(elements.get('#studioRecommendations').innerHTML,/所选项数值构成/);

  const columnSeries={...ordered,wide:false,dimension:'分类',metric:'2026-03',vehicleField:'',vehicleValue:'',label:'列指标'};
  await run([ordered,columnSeries]);
  assert.deepEqual(types(),['line'],'mixed row and column mappings cannot produce a misleading latest-period ranking');

  const negative={rows:data.rows.map(r=>r.统计类型==='数量'&&r.分类==='B'?{...r,'2026-03':-10}:r)};
  await run([ordered,other],negative);
  assert.deepEqual(types(),['line','bar'],'negative values never produce a composition pie');
  const missing={rows:data.rows.map(r=>r.统计类型==='数量'&&r.分类==='B'?{...r,'2026-03':null}:r)};
  await run([ordered,other],missing);
  assert.deepEqual(types(),['line','bar'],'a missing contribution is not silently treated as zero');

  const overall={id:'fixture',dimension:'门店',metric:'成交',businessMetric:'转化率',operation:'总体比例',numerator:'成交',denominator:'线索',label:'总体转化率'};
  await run([overall],{rows:[{门店:'A',成交:10,线索:100},{门店:'B',成交:20,线索:50}]});
  assert.deepEqual(types(),['bar','bar'],'overall rates are not additive shares and must not produce a pie');
  assert.equal(options[0].tooltip.valueFormatter(.1),'10%');
  await run([{...overall,operation:'求和',metric:'净增量',businessMetric:'净增量'}],{rows:[{门店:'A',净增量:10},{门店:'B',净增量:-2}]});
  assert.deepEqual(types(),['bar','bar'],'negative long-table metrics also suppress composition');
  await run([{dimension:'项目',metric:'销量',operation:'求和',axisMode:'auto',label:'混合时间'}],{rows:[{项目:'2026-01',销量:10},{项目:'2026Q1',销量:30}]});
  assert.deepEqual(types(),[],'recommendations do not reconnect incompatible time grains already split by the main chart');
  await run([{...base,axisOrder:'source'}]);
  assert.deepEqual(Array.from(options[0].xAxis.data),['2026-03','2026-01','2026-02'],'recommendations honor explicit source order');
  console.log('Studio recommendations: shared aggregation, nulls, compatible ranking and safe composition passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
