'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c=vm.createContext({});
for(const file of ['web/chart-logic.js','web/chart-state.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c,{filename:file});
const plain=value=>JSON.parse(JSON.stringify(value));
const table=(fields,id='mapping')=>({id,table_name:'销量',sheet_name:'数据',fields:fields.map(([name,type])=>({name,type}))});
const tests=[];const test=(name,run)=>tests.push({name,run});
const records=table([['项目','text'],['车型','text'],['销量','number'],['转化率','number']]);
const rows=[{项目:'2026年1月',车型:'M5',销量:10,转化率:.1},{项目:'2026/2',车型:'M5',销量:20,转化率:.2}];
const matrix=table([['车型','text'],['版本','text'],['2026年1月','number'],['2026/2','number']]);
const matrixRows=[{车型:'M5',版本:'Max','2026年1月':10,'2026/2':20},{车型:'M5',版本:'Pro','2026年1月':3,'2026/2':4}];

test('date values under a neutral field name infer a vertical axis',()=>{
  const result=c.inferChartMapping(records,rows);
  assert.equal(result.wide,false);assert.equal(result.dimension,'项目');
  assert.deepEqual(plain(result.metrics),['销量']);assert.equal(result.axisMode,'auto');
  assert.match(result.reason,/单元格包含日期/);
});
test('transposed data infer header axis with both category levels',()=>{
  const result=c.inferChartMapping(matrix,matrixRows);
  assert.equal(result.wide,true);
  assert.deepEqual(plain(result.periods),['2026年1月','2026/2']);
  assert.deepEqual(plain(result.seriesFields),['车型','版本']);
  assert.deepEqual(rows.map(r=>c.chartAxisKey(r.项目)),Array.from(result.periods,p=>c.chartAxisKey(p)));
});
test('vertical dates take precedence when both axes contain date-like labels',()=>{
  const both=table([['项目','text'],['2026年1月','number'],['2026年2月','number']]);
  const result=c.inferChartMapping(both,[{项目:'2025-01','2026年1月':7,'2026年2月':8},{项目:'2025-02','2026年1月':9,'2026年2月':10}]);
  assert.equal(result.wide,false);assert.equal(result.dimension,'项目');
});
test('bare numeric IDs are not inferred as vertical years or Excel dates',()=>{
  for(const values of [[2025,2026],[46001,46002],['20260921','20260922']]){
    const source=table([['门店编码','number'],['车型','text'],['销量','number']]);
    const result=c.inferChartMapping(source,values.map((v,i)=>({门店编码:v,车型:`M${i}`,销量:i+1})));
    assert.equal(result.wide,false);assert.equal(result.dimension,'车型');
    assert.equal(c.chartAxisIsTime({dimension:'门店编码',axisMode:'auto'},values),false);
  }
});
test('explicit year fields support numeric years',()=>{
  const source=table([['年份','number'],['销量','number']]);
  const result=c.inferChartMapping(source,[{年份:2025,销量:10},{年份:2026,销量:20}]);
  assert.equal(result.dimension,'年份');assert.deepEqual(plain(result.metrics),['销量']);
  assert.equal(c.chartAxisIsTime({dimension:'年份',axisMode:'auto'},[2025,2026]),true);
  assert.equal(c.canonicalPeriodLabel('2026年'),'2026');
});
test('numeric month values use field context without guessing neutral IDs',()=>{
  for(const dimension of ['月份','月','month','Month']){
    const source=table([[dimension,'number'],['销量','number']]);
    const result=c.inferChartMapping(source,[{[dimension]:1,销量:10},{[dimension]:12,销量:20}]);
    assert.equal(result.dimension,dimension);assert.match(result.reason,/单元格包含日期/);
    assert.equal(c.chartAxisKey('01',{dimension,axisMode:'auto'}),'1月');
    assert.equal(c.chartAxisKey(12,{dimension,axisMode:'time'}),'12月');
    assert.equal(c.chartAxisIsTime({dimension,axisMode:'auto'},[1,12]),true);
    assert.equal(c.chartAxisKey('01',{dimension,axisMode:'category'}),'01');
    assert.throws(()=>c.chartAxisKey(14,{dimension,axisMode:'time'}),/无法识别/);
  }
  assert.equal(c.chartAxisKey('01',{dimension:'门店编码',axisMode:'auto'}),'01');
  assert.equal(c.chartAxisIsTime({dimension:'门店编码',axisMode:'auto'},[1,12]),false);
});
test('fewer than eighty percent valid numeric months do not override header detection',()=>{
  const source=table([['月份','number'],['2026-01','number'],['2026-02','number']]);
  const sample=values=>values.map(value=>({月份:value,'2026-01':100,'2026-02':110}));
  assert.equal(c.inferChartMapping(source,sample([1,2,3,14,15])).wide,true);
  assert.equal(c.inferChartMapping(source,sample([1,2,3,4,14])).wide,false);
  assert.equal(c.chartAxisKey(14,{dimension:'月份',axisMode:'auto'}),'14');
});
test('yearless month sorting is opt-in so cross-year source sequences stay intact',()=>{
  const groups=[new Map([['11月',1],['12月',2],['1月',3]])];
  assert.deepEqual(plain(c.orderedTemporalKeys(groups)),['11月','12月','1月']);
  assert.deepEqual(plain(c.orderedTemporalKeys(groups,true)),['1月','11月','12月']);
  assert.deepEqual(plain(c.orderedTemporalKeys([new Map([['2月',1],['1月',2],['12月',3]])],true)),['1月','2月','12月']);
  assert.deepEqual(plain(c.orderedTemporalKeys([new Map([['2月',1],['2026-01',2]])],true)),['2月','2026-01']);
});
test('a requested metric is preserved when it is not the time dimension',()=>{
  assert.deepEqual(plain(c.inferChartMapping(records,rows,'转化率').metrics),['转化率']);
});
test('automatic matrix detection separates actual and forecast groups',()=>{
  const source=table([['项目','text'],['2026-01(实际)','number'],['2026-02(实际)','number'],['2026-01(预测)','number'],['2026-02(预测)','number']]);
  const result=c.inferChartMapping(source,[{项目:'销量'}],'2026-01(预测)');
  assert.deepEqual(plain(result.periods),['2026-01(预测)','2026-02(预测)']);
});
test('generic categories are manual choices, not an automatic matrix guess',()=>{
  const source=table([['地区','text'],['线上','number'],['线下','number']]);
  assert.equal(c.inferChartMapping(source,[{地区:'华东',线上:2,线下:3}]).wide,false);
});
test('default row labels retain hierarchies and identifiers, not numeric measures',()=>{
  const source=table([['车型','text'],['版本','text'],['门店编码','number'],['销量','number'],['1月','number'],['2月','number']]);
  assert.deepEqual(plain(c.mappingRowLabelFields(source,['1月','2月'])),['车型','版本','门店编码']);
});
test('numeric and date-like category labels remain exact when explicitly selected',()=>{
  const spec={wide:true,axisMode:'category'};
  for(const label of ['01','2026','26-03','2026年1月(实际)','2026年1月(预测)'])assert.equal(c.chartAxisKey(` ${label} `,spec),label);
  assert.equal(c.chartAxisIsTime(spec,['2026年1月','2026年2月']),false);
  assert.equal(c.chartAxisIsTime({wide:true,axisMode:'auto'},['线上','线下']),false);
});
test('time mode validates unknown labels and empty axes are skipped',()=>{
  assert.throws(()=>c.chartAxisKey('华东',{axisMode:'time'}),/无法识别.*分类横轴/);
  assert.equal(c.chartAxisKey(null,{axisMode:'time'}),null);
  assert.equal(c.chartAxisKey('  ',{axisMode:'category'}),null);
  assert.equal(c.chartAxisKey('26-03',{axisMode:'time'}),'2026-03');
  assert.equal(c.chartAxisIsTime({axisMode:'auto',dimension:'项目'},['2026-01','说明']),true,'mixed temporal/category data must reach facet safety handling');
});
test('multiple metric columns cross product with selected split values',()=>{
  const draft={wide:false,axisMode:'auto',axisOrder:'source',dimension:'项目',metric:'销量',metrics:['销量','转化率'],operation:'求和',autoOperation:true,vehicleField:'车型',selectedValues:['M5','M7'],filters:[{field:'项目',value:'2026年1月'}]};
  const before=plain(draft),specs=c.draftSeriesSpecs(draft,records);
  assert.equal(specs.length,4);
  assert.deepEqual(Array.from(specs,s=>[s.metric,s.vehicleValue,s.operation]),[['销量','M5','求和'],['销量','M7','求和'],['转化率','M5','平均值'],['转化率','M7','平均值']]);
  assert.ok(specs.every(s=>s.axisMode==='auto'&&s.axisOrder==='source'));
  specs[0].filters[0].value='changed';assert.deepEqual(draft,before);assert.equal(specs[1].filters[0].value,'2026年1月');
});
test('overall ratio remains one logical metric per split selection',()=>{
  const source=table([['日期','text'],['门店','text'],['成交','number'],['访客','number']]);
  for(const metrics of [[],['成交','访客']]){
    const specs=c.draftSeriesSpecs({wide:false,axisMode:'auto',dimension:'日期',metrics,operation:'总体比例',autoOperation:true,numerator:'成交',denominator:'访客',vehicleField:'门店',selectedValues:['甲','乙']},source);
    assert.equal(specs.length,2);assert.ok(specs.every(s=>s.metric==='成交'&&s.businessMetric==='成交 / 访客'&&s.operation==='总体比例'));
  }
});
test('manual category matrices allow discontiguous columns and one column',()=>{
  const source=table([['项目','text'],['线上','number'],['线下','number'],['其他','number']]);
  const draft={wide:true,axisMode:'category',dimension:'列标题',periods:['线上','其他'],metric:'线上',operation:'求和',vehicleField:'项目',selectedValues:['销量'],seriesFields:['项目']};
  assert.deepEqual(plain(c.draftSeriesSpecs(draft,source)[0].periods),['线上','其他']);
  assert.equal(c.draftSeriesSpecs({...draft,periods:['线下']},source).length,1);
});
test('legacy matrix minimum is retained, new modes allow one selected column',()=>{
  const draft={wide:true,dimension:'日期',metric:'2026年1月',periods:['2026年1月'],operation:'求和',vehicleField:'车型',selectedValues:['M5']};
  assert.throws(()=>c.draftSeriesSpecs(draft,matrix),/至少 2/);
  assert.equal(c.draftSeriesSpecs({...draft,axisMode:'auto'},matrix).length,1);
});
test('category mode can explicitly keep actual/forecast labels separate',()=>{
  const source=table([['项目','text'],['2026-01(实际)','number'],['2026-01(预测)','number']]);
  const draft={wide:true,axisMode:'auto',metric:'2026-01(实际)',dimension:'日期',periods:['2026-01(实际)','2026-01(预测)'],operation:'求和',vehicleField:'项目',selectedValues:['销量']};
  assert.throws(()=>c.draftSeriesSpecs(draft,source),/口径/);
  assert.equal(c.draftSeriesSpecs({...draft,axisMode:'category'},source).length,1);
});
test('manual hierarchy selection is copied without adding inferred fields',()=>{
  const draft={wide:true,axisMode:'auto',dimension:'日期',metric:'2026年1月',periods:['2026年1月','2026/2'],operation:'求和',vehicleField:'__row_labels__',seriesFields:['版本'],selectedValues:[JSON.stringify(['Max'])]};
  const [spec]=c.draftSeriesSpecs(draft,matrix);
  assert.deepEqual(plain(spec.seriesFields),['版本']);
  assert.equal(c.seriesRowValue(matrixRows[0],spec,0),JSON.stringify(['Max']));
  assert.match(c.seriesValueLabel(spec.vehicleValue,spec),/版本：Max/);
  assert.throws(()=>c.draftSeriesSpecs({...draft,seriesFields:['删除的字段']},matrix),/行标签字段/);
});
test('source row number identifies otherwise identical rows independently',()=>{
  const spec={vehicleField:'__row_index__'};
  assert.equal(c.seriesRowValue(matrixRows[0],spec,0),'1');
  assert.equal(c.seriesRowValue(matrixRows[0],spec,12),'13');
  assert.equal(c.seriesValueLabel('13',spec),'数据第 13 行');
});
test('all 240 selected rows produce independent series without an eight-series cap',()=>{
  const selectedValues=Array.from({length:240},(_,i)=>String(i+1));
  const draft={wide:true,axisMode:'auto',dimension:'日期',metric:'2026年1月',periods:['2026年1月','2026/2'],operation:'求和',vehicleField:'__row_index__',selectedValues};
  const before=plain(draft),specs=c.draftSeriesSpecs(draft,matrix),basket=[{uid:'saved',label:'已有系列'}];
  assert.equal(specs.length,240);assert.equal(c.commitChartSeries(basket,specs,'append').length,241);
  assert.deepEqual(draft,before);assert.deepEqual(basket,[{uid:'saved',label:'已有系列'}]);
});
test('empty or invalid metric choices cannot silently revert to an old Y field',()=>{
  for(const metrics of [[],['不存在']])assert.throws(()=>c.draftSeriesSpecs({wide:false,dimension:'项目',metric:'销量',metrics,operation:'求和'},records),/有效的横轴与数值指标/);
});

let failures=0;
for(const {name,run} of tests){try{run();console.log(`PASS ${name}`);}catch(error){failures++;console.error(`FAIL ${name}\n${error.stack}`);}}
console.log(`Chart mapping: ${tests.length-failures}/${tests.length} checks passed`);
if(failures)process.exitCode=1;
