'use strict';

// A dedicated dialog lets catalog refreshes update the page without discarding
// per-file results. Existing chart draft protection still applies in app.js.
(() => {
  const dialog=document.querySelector('#importDialog');
  const entry=document.querySelector('#importButton');
  const input=document.querySelector('#importFiles');
  const start=document.querySelector('#importStart');
  const done=document.querySelector('#importDone');
  const status=document.querySelector('#importStatus');
  const list=document.querySelector('#importList');
  const progress=document.querySelector('#importProgress');
  let folder='',jobs=[],busy=false,opening=false;
  const limit=256*1024*1024;
  const sizeLabel=size=>size<1024*1024?`${Math.ceil(size/1024)} KB`:`${(size/1024/1024).toFixed(1)} MB`;

  function renderJobs(){
    list.innerHTML=jobs.map(job=>`<li data-result="${job.result}"><strong>${esc(job.file.name)}</strong><small>${sizeLabel(job.file.size)}</small><span class="import-file-status">${esc(job.message)}</span></li>`).join('');
  }
  function updateJob(index,result,message){
    const job=jobs[index];job.result=result;job.message=message;
    const row=list.children[index];
    row.dataset.result=result;row.querySelector('.import-file-status').textContent=message;
  }

  entry.addEventListener('click',async()=>{
    if(!dialog.open)dialog.showModal();
    if(busy||opening)return;
    opening=true;input.disabled=true;start.disabled=true;
    const previousFolder=folder;
    if(!jobs.length){
      input.value='';start.hidden=false;progress.hidden=true;done.textContent='关闭';
      status.textContent='正在读取当前数据源…';
      document.querySelector('#importFolder').textContent='正在读取…';
    }
    try{
      const catalog=await api('catalog');folder=catalog.config.folder;
      document.querySelector('#importFolder').textContent=folder;
      if(!jobs.length)status.textContent='选择文件后开始导入。';
      else if(previousFolder&&previousFolder!==folder)status.textContent=`数据源已变更。上批结果保留，之前的文件保存在 ${previousFolder}；接下来选择的文件将导入上方新目录。`;
      input.disabled=false;start.disabled=!jobs.some(job=>job.result==='pending');
    }catch(error){folder='';status.textContent=`无法读取数据源：${error.message}。请关闭后重试。`;}
    finally{opening=false;}
  });

  input.addEventListener('change',()=>{
    jobs=Array.from(input.files).map(file=>{
      const error=!/\.(xlsx|xlsm)$/i.test(file.name)?'格式不支持；请另存为 .xlsx 或 .xlsm':
        !file.size?'文件为空，请检查原文件':file.size>limit?'超过 256 MB，请拆分文件后导入':'';
      return {file,result:error?'error':'pending',message:error||'等待导入'};
    });
    renderJobs();progress.hidden=true;start.hidden=false;
    const pending=jobs.filter(job=>job.result==='pending').length;
    start.disabled=!pending||!folder;
    status.textContent=jobs.length?`已选择 ${jobs.length} 个文件，${pending} 个可导入。`:'选择文件后开始导入。';
    done.textContent='关闭';
  });

  function upload(file,index){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('POST','/api/import?'+new URLSearchParams({filename:file.name,folder}));
      xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.timeout=180000;
      xhr.upload.onprogress=event=>{
        if(!event.lengthComputable)return;
        const ratio=event.loaded/event.total;
        progress.value=index+ratio;
        updateJob(index,'uploading',ratio===1?'上传完成，正在校验与保存…':`正在上传 ${Math.round(ratio*100)}%`);
      };
      xhr.onload=()=>{
        let response;
        try{response=JSON.parse(xhr.responseText);}catch{return reject(Error('服务返回异常，请检查数据管理中的文件后再重试'));}
        if(xhr.status>=200&&xhr.status<300&&response.saved)resolve(response);
        else reject(Error(response.error||`导入失败（${xhr.status}），请重试`));
      };
      xhr.onerror=()=>reject(Error('连接中断，请先到数据管理确认文件是否已保存，再重试'));
      xhr.ontimeout=()=>reject(Error('等待超时，请先到数据管理确认文件是否已保存，再重试'));
      xhr.send(file);
    });
  }

  start.addEventListener('click',async()=>{
    if(busy||!folder||!jobs.some(job=>job.result==='pending'))return;
    busy=true;input.disabled=true;start.disabled=true;progress.hidden=false;progress.max=jobs.length;progress.value=0;
    entry.textContent='导入中';done.textContent='后台继续';
    try{
      for(let index=0;index<jobs.length;index++){
        if(jobs[index].result!=='pending'){progress.value=index+1;continue;}
        status.textContent=`正在导入 ${index+1} / ${jobs.length}；关闭此窗口可继续使用页面。`;
        updateJob(index,'uploading','正在上传…');
        try{
          const result=await upload(jobs[index].file,index);
          updateJob(index,'saved',result.renamed?`已保存为 ${result.name}（保留原同名文件）`:'已保存');
        }catch(error){updateJob(index,'error',error.message);}
        progress.value=index+1;
      }
      const saved=jobs.filter(job=>job.result==='saved').length;
      const summary=`已保存 ${saved} 个文件${jobs.length>saved?`，${jobs.length-saved} 个未导入，请查看逐项提示`:''}。`;
      status.textContent=summary;
      if(saved){
        try{
          await api('sync',{});trackRequestedSync();
          status.textContent=summary+'已开始同步，页面会自动更新；正在编辑的图表会保留草稿。';
        }catch(error){status.textContent=summary+`启动同步失败：${error.message}。请点击页面“同步数据”，无需重新上传。`;}
      }
      if(!dialog.open)toast(status.textContent);
    }finally{
      busy=false;input.disabled=false;input.value='';start.hidden=true;done.textContent='完成';
      entry.innerHTML='导入<span class="action-detail">文件</span>';
    }
  });
  window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
})();
