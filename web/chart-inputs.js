'use strict';

// Tokens include the grouping fields: a changed row mapping must not silently
// select a different set of source rows, even when its visible label is equal.
function chartColumnInputKey(field){return 'column:'+JSON.stringify(String(field));}
function chartRowInputKey(rowField,rowFields,rowValue){return 'row:'+JSON.stringify([rowField,[...(rowFields||[])],String(rowValue??'')]);}
function chartInputKeyLabel(key){
  try{
    if(key.startsWith('column:'))return JSON.parse(key.slice(7));
    if(key.startsWith('row:')){const [field,fields,value]=JSON.parse(key.slice(4));return seriesValueLabel(value,{vehicleField:field,seriesFields:fields})||'全部数据行';}
  }catch{}
  return String(key);
}
function chartMetricInputLabel(key){return chartInputKeyLabel(key);}
function chartMetricCatalog(table,rows=[],draft={}){
  const fields=table?.fields||[],names=fields.map(f=>f.name),inferred=inferChartMapping(table,rows,draft.metric||'');
  const dimension=draft.dimension||inferred.dimension;
  const identifiers=name=>/编码|序号|\bID\b/i.test(name);
  const fallbackPeriods=inferred.periods?.length?inferred.periods:fields.filter(f=>f.type==='number'&&f.name!==dimension&&!identifiers(f.name)).map(f=>f.name);
  const rowPeriods=Array.isArray(draft.periods)?[...draft.periods]:[...fallbackPeriods];
  const preserveLegacy=!!draft.wide&&draft.legacyRowSelection===true&&!draft.rowMode&&!draft.labelFieldsTouched;
  const legacyWholeTable=preserveLegacy&&!draft.vehicleField;
  let rowFields;
  if(preserveLegacy&&draft.vehicleField&&draft.vehicleField!=='__row_labels__'&&draft.vehicleField!=='__row_index__')rowFields=[draft.vehicleField];
  else if(Array.isArray(draft.seriesFields)&&(draft.seriesFields.length||draft.labelFieldsTouched||draft.vehicleField==='__row_labels__'))rowFields=[...draft.seriesFields];
  else rowFields=mappingRowLabelFields(table,rowPeriods.length?rowPeriods:fallbackPeriods);
  let rowField;
  if(legacyWholeTable){rowFields=[];rowField='';}
  else if(draft.rowMode==='index'||preserveLegacy&&draft.vehicleField==='__row_index__'||!rowFields.length)rowField='__row_index__';
  else if(preserveLegacy&&draft.vehicleField==='__row_labels__')rowField='__row_labels__';
  else rowField=rowFields.length>1?'__row_labels__':rowFields[0];
  // An empty single-field value cannot be represented by the saved-series
  // scalar filter (where an empty value means "all"); use a tuple in that case.
  if(!preserveLegacy&&rowField!=='__row_index__'&&rowFields.length===1&&rows.some(row=>row[rowFields[0]]==null||String(row[rowFields[0]])===''))rowField='__row_labels__';
  const items=fields.map(field=>({value:chartColumnInputKey(field.name),label:field.name+(field.type==='number'?'':'（默认计数）'),kind:'column',field:field.name,detail:'列指标'}));
  const descriptive=name=>/备注|说明|注释|描述|note|remark|comment|description/i.test(name);
  const businessDimension=name=>/车型|车系|版本|区域|门店|配置|分类|类别|指标|项目|统计类型|渠道|部门|产品|省份|城市|品牌|model|store|region|category|version|channel|product|brand/i.test(name);
  const totalFields=[...new Set([dimension,rowField,...rowFields,...(draft.filters||[]).map(f=>f.field),...fields.filter(f=>f.type==='text').map(f=>f.name),...names.filter(businessDimension)].filter(f=>f&&!descriptive(f)&&!['__row_labels__','__row_index__'].includes(f)))];
  const availableRows=rows.map((row,index)=>({row,index})).filter(({row})=>(draft.filters||[]).every(f=>!f.field||f.value==null||f.value===''||String(row[f.field]??'')===String(f.value))&&(draft.excludeTotals===false||!totalFields.some(field=>isTotalLabel(row[field]))));
  // Keep row identities while an explicit empty axis selection is corrected.
  const includeRows=rowPeriods.length||Array.isArray(draft.periods)||draft.wide||(draft.inputKeys||[]).some(key=>String(key).startsWith('row:'));
  if(includeRows){
    const seen=new Set();
    for(const {row,index} of availableRows){
      const rowValue=rowField?seriesRowValue(row,{vehicleField:rowField,seriesFields:rowFields},index):'';
      const value=chartRowInputKey(rowField,rowFields,rowValue);if(seen.has(value))continue;seen.add(value);
      const label=rowField==='__row_index__'?`数据第 ${index+1} 行`:!rowField?'全部数据行':rowFields.map(field=>row[field]==null||row[field]===''?'（空）':String(row[field])).join(' / ');
      items.push({value,label,kind:'row',rowValue,rowField,seriesFields:[...rowFields],detail:'行指标',sourceRow:index+1});
    }
  }
  const kind=draft.readingMode==='records'?'column':draft.readingMode==='matrix'?'row':'';
  return {items:kind?items.filter(item=>item.kind===kind):items,rowFields,rowField,rowPeriods,dimension,inferred,recommendedKind:inferred.wide?'row':'column',availableRows};
}
function chartMetricSelection(draft,catalog){
  if(Array.isArray(draft.inputKeys))return [...draft.inputKeys];
  if(draft.wide){
    if(catalog.rowField==='')return catalog.items.filter(item=>item.kind==='row').slice(0,1).map(item=>item.value);
    if(Array.isArray(draft.selectedValues)&&(draft.selectedValues.length||draft.selectionTouched)){
      return draft.selectedValues.map(value=>chartRowInputKey(catalog.rowField,catalog.rowFields,value));
    }
    if(draft.vehicleValue!==undefined&&draft.vehicleValue!==null&&draft.vehicleField)return [chartRowInputKey(catalog.rowField,catalog.rowFields,draft.vehicleValue)];
    return catalog.items.filter(item=>item.kind==='row').slice(0,1).map(item=>item.value);
  }
  if(Array.isArray(draft.metrics))return draft.metrics.map(chartColumnInputKey);
  if(draft.readingMode==='matrix'||draft.readingMode!=='records'&&draft.wide!==false&&catalog.inferred.wide)return catalog.items.filter(item=>item.kind==='row').slice(0,1).map(item=>item.value);
  if(draft.metric)return [chartColumnInputKey(draft.metric)];
  return (catalog.inferred.metrics||[]).map(chartColumnInputKey);
}
function unifiedChartSpecs(draft,table,catalog){
  const keys=chartMetricSelection(draft,catalog),byKey=new Map(catalog.items.map(item=>[item.value,item]));
  if(!keys.length)throw Error('请至少选择一个数值指标，可以选择列指标或行指标。');
  const missing=keys.filter(key=>!byKey.has(key));
  if(missing.length)throw Error('已选指标“'+missing.map(chartInputKeyLabel).join('、')+'”在当前数据、读取方式或筛选下不可用，请重新选择；系统未自动替换。');
  const items=[...new Set(keys)].map(key=>byKey.get(key)),rowItems=items.filter(item=>item.kind==='row');
  if(rowItems.length&&draft.operation==='总体比例')throw Error('总体比例仅适用于列指标，请移除行指标或切换统计方式。');
  const common={...draft,autoOperation:draft.autoOperation??!draft.operation,axisMode:draft.axisMode||'auto',dimension:catalog.dimension};
  const specs=[];
  for(const item of items){
    let mapped;
    if(item.kind==='column'){
      if(draft.operation==='总体比例'&&specs.length)continue;
      const splitField=draft.splitField!==undefined?draft.splitField:(!draft.wide?draft.vehicleField:'')||'';
      const splitValues=Array.isArray(draft.splitValues)?draft.splitValues:!draft.wide?(draft.selectedValues||[]):[];
      if(splitField&&table.fields.some(field=>field.name===splitField)&&splitValues.some(value=>!(catalog.availableRows||[]).some(({row})=>String(row[splitField]??'')===String(value))))throw Error('部分已选对比项在当前数据或筛选下不可用，请重新选择；系统未自动替换。');
      mapped={...common,wide:false,metric:item.field,metrics:[item.field],vehicleField:splitField,selectedValues:splitValues,seriesFields:[],periods:[],rangeError:''};
    }else{
      let axisMode=common.axisMode;
      if(axisMode==='time'&&catalog.rowPeriods.some(field=>!isPeriodColumn(field)))throw Error('时间横轴包含无法识别的列标题，请检查横轴列或切换为分类横轴。');
      if(axisMode==='auto'&&catalog.rowPeriods.some(field=>!isPeriodColumn(field)))axisMode='category';
      mapped={...common,wide:true,metric:catalog.rowPeriods[0]||'',metrics:[],vehicleField:catalog.rowField,seriesFields:[...catalog.rowFields],selectedValues:[item.rowValue],periods:[...catalog.rowPeriods],axisMode};
    }
    specs.push(...draftSeriesSpecs(mapped,table));
  }
  for(const spec of specs){
    if(spec.axisMode!=='time'||spec.wide)continue;
    for(const {row,index} of catalog.availableRows||[]){
      if(spec.vehicleField&&spec.vehicleValue!==''&&seriesRowValue(row,spec,index)!==String(spec.vehicleValue))continue;
      chartAxisKey(row[spec.dimension],spec);
    }
  }
  // Running each metric through the shared converter keeps validation/operation
  // rules identical. A custom prefix still needs distinct names for many inputs.
  if(draft.label&&specs.length>1){
    specs.forEach(spec=>{
      if(spec.label!==draft.label)return;
      const base=seriesValueLabel(spec.vehicleValue,spec)||table.sheet_name;
      spec.label=draft.label+' · '+base+' · '+spec.businessMetric;
    });
  }
  return specs;
}
