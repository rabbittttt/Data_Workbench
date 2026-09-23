const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c=vm.createContext({});vm.runInContext(fs.readFileSync('web/chart-logic.js','utf8'),c);
const plain=value=>JSON.parse(JSON.stringify(value));
const table={fields:['项目','2026-01(实际)','2026-01（预测）','2026-02（实际）','2026-02(预测)','2026Q1','2026Q2'].map(name=>({name,type:'number'}))};
assert.deepEqual(plain(c.periodColumnGroups(table)),[
  {id:'month|实际',grain:'month',qualifier:'实际',columns:['2026-01(实际)','2026-02（实际）'],index:1},
  {id:'month|预测',grain:'month',qualifier:'预测',columns:['2026-01（预测）','2026-02(预测)'],index:2},
  {id:'quarter',grain:'quarter',qualifier:'',columns:['2026Q1','2026Q2'],index:5}
]);
assert.equal(c.periodSelectionError(['2026-01(实际)','2026-02（实际）']),'');
assert.match(c.periodSelectionError(['2026-01(实际)','2026-01（预测）']),/同一时间/);
assert.match(c.periodSelectionError(['2026-01(实际)','2026-02（预测）']),/业务口径/);
assert.match(c.periodSelectionError(['2026-01','2026Q1']),/粒度/);
assert.match(c.periodSelectionError(['1月','2026-02']),/年份/);
assert.match(c.periodSelectionError(['2026-01']),/至少 2/);
assert.equal(c.periodSelectionError(['2026-01'],{minPeriods:1}),'');
assert.equal(c.periodSelectionError(['试销阶段','上市阶段','稳定阶段']),'');
assert.match(c.periodSelectionError(['第12周','W12']),/同一时间/);
for(const value of ['第12周','W12','WK12','wk12'])assert.equal(c.canonicalPeriodLabel(value),'WK12');
for(const value of ['2026年第12周','2026-W12','2026WK12','26WK12','2026-WK12']){
  assert.equal(c.isPeriodColumn(value),true,value);
  assert.equal(c.canonicalPeriodLabel(value),'2026-WK12',value);
}
assert.equal(c.canonicalPeriodLabel('8月5日'),'08-05');
assert.equal(c.canonicalPeriodLabel('08/05'),'08-05');
assert.equal(c.canonicalPeriodLabel('第001天'),'D1');
assert.equal(c.canonicalPeriodLabel('2026（实际）'),'2026');
assert.equal(c.canonicalPeriodLabel('试销阶段（预估）'),'试销阶段（预估）');
const sorted=values=>Array.from(c.orderedTemporalKeys([new Map(values.map(v=>[v,1]))]));
assert.deepEqual(sorted(['W12','第2周','WK1']),['WK1','第2周','W12']);
assert.deepEqual(sorted(['2026WK1','2025年第53周','26WK12']),['2025年第53周','2026WK1','26WK12']);
assert.deepEqual(sorted(['8月15日','08/05','9月1日']),['08/05','8月15日','9月1日']);
assert.deepEqual(sorted(['D10','第2天','D1']),['D1','第2天','D10']);
assert.deepEqual(sorted(['11月','12月','1月']),['11月','12月','1月']); // Missing years do not justify inferring a year rollover.
assert.equal(c.temporalAxisSignature(['第12周','WK13']),c.temporalAxisSignature(['W1','W2']));
assert.notEqual(c.temporalAxisSignature(['W12']),c.temporalAxisSignature(['2026WK12']));
assert.notEqual(c.temporalAxisSignature(['2026-01']),c.temporalAxisSignature(['2026Q1']));
assert.notEqual(c.temporalAxisSignature(['8月5日']),c.temporalAxisSignature(['D1']));
assert.equal(c.temporalAxisSignature(['2026/1','26-02']),'time:month:absolute');
assert.match(c.temporalAxisSignature(['2026-01','2026Q1']),/^mixed:/);
assert.equal(c.temporalAxisSignature(['华东','华南']),'category');
assert.equal(c.percentageSeries({operation:'总体比例',metric:'订单'}),true);
console.log('Time semantics: grouping, canonical axes, compatible grains and selection validation passed');
