(function(){
  'use strict';
  const M=UniversalMedia,D=UniversalDownload,C=UniversalCollector,S=UniversalPlayerShare,B=UniversalBilibili,$=s=>document.querySelector(s);
  const KEY='universal-extractor-web-v1';let records=[],current=null,items=[],busy=false,controller=null,sourceBridge=null,bridgeSource='';
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'[]');records=Array.isArray(saved)?saved.slice(0,20).map(M.normalize):[];}catch(_){}
  function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
  function status(text,error){$('#status').textContent=text;$('#status').className='status'+(error?' error':'');$('#status').hidden=!text;}
  function size(bytes){return bytes>=1024*1024?(bytes/1024/1024).toFixed(1)+' MB':(bytes/1024).toFixed(0)+' KB';}
  function freeze(value){busy=value;for(const node of document.querySelectorAll('#analyze,#paste,#input,#importFile,#clearResult,#clearHistory,#saveAs,.card-actions button,.qualities,.history-row button'))node.disabled=value;$('#analyze').textContent=value?'处理中…':'开始分析 ↗';}
  function remember(){if(!current||!current.media.length)return;records=[current].concat(records.filter(r=>r.sourceUrl!==current.sourceUrl)).slice(0,20);try{while(records.length>1&&JSON.stringify(records).length>300000)records.pop();localStorage.setItem(KEY,JSON.stringify(records));}catch(_){status('结果已提取，但浏览器暂时无法保存历史记录。',true);}renderHistory();}
  function image(url,cls){const img=el('img',cls);img.src=url;img.referrerPolicy='no-referrer';img.alt='视频封面';img.loading='lazy';img.onerror=()=>img.replaceWith(el('div',cls+' cover-placeholder','▷'));return img;}
  function copy(text){return navigator.clipboard.writeText(text).then(()=>status('链接已复制')).catch(()=>{status('浏览器未允许复制，请从下方链接行手动选择复制。',true);});}
  function action(label,cls,fn,disabled){const b=el('button',cls,label);b.type='button';b.onclick=fn;b.disabled=!!disabled;return b;}
  function renderHistory(){
    const list=$('#historyList');list.replaceChildren();const shown=records.filter(r=>!current||r.sourceUrl!==current.sourceUrl);$('#empty').hidden=shown.length>0;$('#clearHistory').hidden=!records.length;
    for(const record of shown){const row=el('div','history-row');row.append(record.poster?image(record.poster,'history-cover'):el('div','history-cover','▷'));const info=el('div','history-info');info.append(el('strong','',record.title),el('small','',new URL(record.sourceUrl).hostname+' · '+record.media.length+' 个地址'));row.append(info,action('查看并下载','secondary',()=>{if(!busy){$('#input').value=JSON.stringify(record);analyze();}}),action('×','remove',()=>{records=records.filter(r=>r.sourceUrl!==record.sourceUrl);try{localStorage.setItem(KEY,JSON.stringify(records));}catch(_){}renderHistory();}));list.append(row);}
  }
  function render(){
    $('#results').replaceChildren();$('#resultsSection').hidden=!items.length;$('#resultCount').textContent=items.length;
    items.forEach((item,index)=>{
      const card=el('article','result-card'),main=el('div','card-main');main.append(current.poster?image(current.poster,'cover'):el('div','cover cover-placeholder','▷'));
      const body=el('div','card-body'),top=el('div','card-top');top.append(el('span','pill',item.type==='dash'?'B 站视频 · 含声音':item.type==='hls'?'HLS 分段视频':'视频文件'),el('span','domain',new URL(item.url).hostname));body.append(top,el('h3','card-title',current.title+(items.length>1?' · '+(index+1):'')));
      const plan=item.plan,meta=item.error?'暂时无法下载':item.type==='dash'?M.formatTime(item.duration)+' · '+item.label:plan?M.formatTime(plan.duration)+' · '+plan.segments.length+' 个分段 · '+'导出 MP4':'MP4 视频文件';body.append(el('div','card-meta',meta));
      if(item.type==='dash'&&item.choices?.length>1){const select=el('select','qualities');select.setAttribute('aria-label','选择视频清晰度');for(const v of item.choices){const option=el('option','',v.label);option.value=v.url;option.selected=v.url===item.url;select.append(option);}select.onchange=()=>{items[index]=Object.assign({},item.choices.find(v=>v.url===select.value),{choices:item.choices});render();};body.append(select);}
      if(plan&&plan.choices.length>1){const select=el('select','qualities');select.setAttribute('aria-label','选择视频清晰度');for(const v of plan.choices){const option=el('option','',v.resolution||Math.round(v.bandwidth/1000)+' kbps');option.value=v.url;option.selected=v.url===plan.url;select.append(option);}select.onchange=async()=>{freeze(true);try{item.plan=await M.resolvePlaylist(item.url,{variant:select.value});render();}catch(e){status(e.message,true);}finally{freeze(false);}};body.append(select);}
      if(item.error)body.append(el('p','resource-error',item.error));
      const actions=el('div','card-actions');actions.append(action('导出完整 MP4','primary',()=>download(item),item.type==='hls'&&!plan));
      if(current.poster)actions.append(action('保存封面','secondary',saveCover));
      if(item.type!=='dash')actions.append(action('纯净播放','neutral',()=>preview(item)),action('分享播放页','neutral',()=>share(item)));
      actions.append(action(item.type==='dash'&&!sourceBridge?'打开原网页 ↗':'原网页 ↗','neutral',()=>{showCapture(current.sourceUrl);window.open(current.sourceUrl,'_blank','noopener,noreferrer');}));body.append(actions);
      if(item.type==='dash')body.append(el('div','format-note',sourceBridge?'已连接 B 站页面。下载时请保持原页面打开，音视频将在浏览器内合并。':'请重新分析链接以连接 B 站原页面。'));
      if(plan)body.append(el('div','format-note','全部分段下载后封装为一个 MP4，保留原始音画。'));
      body.append(el('div','format-note found-in','来源：'+(item.foundIn||[]).join('、')));main.append(body);card.append(main);
      const link=el('div','link-row');link.append(el('span','','视频链接'),el('code','',item.url),action('复制','',()=>copy(item.url)));card.append(link);$('#results').append(card);
      if(item.type==='dash'){const audio=el('div','link-row');audio.append(el('span','','声音链接'),el('code','',item.audio.url),action('复制','',()=>copy(item.audio.url)));card.append(audio);}
    });renderHistory();
  }
  function showCapture(url){$('#captureHelp').hidden=false;const a=$('#sourcePage');try{a.href=M.safeUrl(url);a.hidden=false;}catch(_){a.hidden=true;}}
  async function analyze(){
    if(busy)return;const input=$('#input').value.trim();if(!input){status('请粘贴网页链接或页面采集结果',true);return;}
    freeze(true);status('正在分析页面与视频地址…');$('#job').hidden=true;items=[];current=null;render();
    try{
      let data;
      if(input.startsWith('{')){if(input.length>524288)throw new Error('采集结果过大');data=M.normalize(JSON.parse(input));}
      else{
        const matches=input.match(/https?:\/\/[^\s<>"']+/g)||[];if(matches.length!==1)throw new Error('请一次输入一个有效链接');
        const url=M.safeUrl(matches[0]),type=M.detect(url);
        if(B.page(url)||new URL(url).hostname==='b23.tv'){showCapture(url);const captured=await UniversalExtension.extract(url);$('#captureHelp').hidden=true;data=M.normalize(captured.data);sourceBridge?.close();sourceBridge=captured.bridge;bridgeSource=data.sourceUrl;}
        else if(type!=='page')data=M.normalize({format:'universal-extractor/1',sourceUrl:url,title:'网页视频',media:[{url,type,foundIn:['输入的视频地址']}]});
        else{
          showCapture(url);
          let response;try{response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(20000)});}catch(_){throw new Error('此网站不允许其他网页直接读取。请打开原网页播放视频，点击“采集当前页”书签，再把采集结果导入这里。');}
          if(!response.ok)throw new Error('页面请求失败，请在原网页采集后导入');
          if(Number(response.headers.get('content-length'))>5000000)throw new Error('页面过大，请使用采集书签');
          const text=await response.text();if(text.length>5000000)throw new Error('页面过大，请使用采集书签');
          const doc=new DOMParser().parseFromString(text,'text/html');data=M.normalize(C.collectPage({document:doc},response.url||url));
        }
      }
      if(!data.media.length){current=null;showCapture(data.sourceUrl);throw new Error(data.blockedFrames.length?'视频在跨域播放器中，请单独打开播放器页面后采集。':'没有找到公开的视频地址。请先在原网页播放或切换线路，再重新采集。');}
      current=data;const resolved=new Set();
      if(B.page(data.sourceUrl)&&data.media.some(m=>m.type==='dash')){
        if(!sourceBridge||bridgeSource!==data.sourceUrl){sourceBridge?.close();sourceBridge=null;bridgeSource='';try{status('正在连接 B 站原视频页面…');const fresh=await UniversalExtension.extract(data.sourceUrl);data=M.normalize(fresh.data);current=data;sourceBridge=fresh.bridge;bridgeSource=data.sourceUrl;}catch(e){status(e.message,true);}}
      }else{sourceBridge?.close();sourceBridge=null;bridgeSource='';}
      for(const candidate of data.media){
        const item=Object.assign({},candidate);
        if(item.type==='hls'){try{item.plan=await M.resolvePlaylist(item.url,{signal:AbortSignal.timeout(25000)});if(resolved.has(item.plan.url))continue;resolved.add(item.plan.url);}catch(e){item.error=e.message||'此播放源暂时无法读取';}}
        items.push(item);
      }
      current.media=items.map(({plan,error,choices,...item})=>item);
      if(items.length&&items.every(i=>i.type==='dash')){const choices=items.slice();items=[Object.assign({},choices[0],{choices})];}
      remember();render();if(B.page(data.sourceUrl)&&!sourceBridge)status('B 站页面未连接，请重新分析链接并保持原视频页面打开。',true);else status('已分析 '+items.length+' 个视频'+(items.every(i=>i.error)?'，当前播放源暂时不能直接下载。':'，选择需要保存的内容。'),items.every(i=>i.error));
    }catch(e){status(e instanceof SyntaxError?'采集内容格式不正确，请重新复制完整结果。':e.message||'分析失败，请重试',true);}
    finally{freeze(false);}
  }
  function saveBlob(chunks,name,type){
    const url=URL.createObjectURL(new Blob(chunks,{type:type||'application/octet-stream'})),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function createSink(name,ext){
    if($('#saveAs').checked&&window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'视频文件',accept:{'application/octet-stream':['.'+ext]}}]});const writer=await handle.createWritable();return {sink:{write:data=>writer.write(data),patch:(position,data)=>writer.write({type:'write',position,data}),close:()=>writer.close(),abort:()=>writer.abort()},disk:true};}
    return {sink:D.memorySink(chunks=>saveBlob(chunks,name,'video/mp4')),disk:false};
  }
  async function download(item){
    if(busy)return;let target;
    if(item.type==='dash'&&!sourceBridge){showCapture(current.sourceUrl);status('请重新分析 B 站链接。下载期间保持原视频页面打开。',true);return;}
    freeze(true);
    // 选择文件必须发生在本次点击的用户手势内，先选文件再开始网络操作。
    try{target=await createSink(M.filename(current.title,'mp4'),'mp4');}catch(e){if(e.name!=='AbortError')status('无法打开保存位置：'+e.message,true);freeze(false);return;}
    freeze(true);controller=new AbortController();$('#job').hidden=false;$('#cancel').hidden=false;$('#jobTitle').textContent='正在下载 '+current.title;$('#jobDetail').textContent='正在连接视频源…';$('#jobPercent').textContent='';$('#progress').value=0;$('#progress').removeAttribute('value');$('#job').scrollIntoView({behavior:'smooth',block:'nearest'});
    const report=r=>{
      const percent=r.total?r.completed/r.total*99:r.totalBytes?r.bytes/r.totalBytes*99:null;
      if(percent!==null){$('#progress').value=percent;$('#jobPercent').textContent=Math.floor(percent)+'%';}
      $('#jobDetail').textContent=r.phase==='finalize'?'全部分段已获取，正在完成 MP4 封装…':(r.total?r.completed+' / '+r.total+' 段 · ':'')+size(r.bytes);
    };
    try{
      let result;
      if(item.type==='dash')result=await UniversalDash.download(item,target.sink,{signal:controller.signal,onProgress:report,read:sourceBridge.read});
      else if(item.type==='hls'){
        // 保存前重新读取播放列表，避免历史记录中的短期地址或旧分段快照失效。
        const fresh=await M.resolvePlaylist(item.url,{variant:item.plan&&item.plan.url,signal:controller.signal});
        if(fresh.format!==item.plan.format)throw new Error('播放源格式已变化，请重新分析');
        result=await D.hls(fresh,target.sink,{signal:controller.signal,onProgress:report});
      }else result=await D.file(item.url,target.sink,{signal:controller.signal,onProgress:report});
      $('#jobDetail').textContent='MP4 已完成 · '+(result.segments?result.segments+' / '+result.segments+' 段 · ':'')+size(result.bytes);
      $('#progress').value=100;$('#jobPercent').textContent='100%';$('#jobTitle').textContent=target.disk?'已保存到所选位置':'视频已交给浏览器保存';status(target.disk?'完整 MP4 已保存到所选位置。':'完整 MP4 已封装，请在浏览器下载列表确认保存结果。');
    }catch(e){await target.sink.abort().catch(()=>{});$('#jobTitle').textContent=e.name==='AbortError'?'已取消下载':'下载未完成';status(e.name==='AbortError'?'下载已取消，未将部分文件标为成功。':e.message||'下载失败；此地址可能限制跨域访问，请重新采集或更换线路。',e.name!=='AbortError');}
    finally{controller=null;freeze(false);$('#cancel').hidden=true;}
  }
  async function saveCover(){
    if(busy||!current||!current.poster)return;freeze(true);
    try{const r=await fetch(current.poster,{credentials:'omit',signal:AbortSignal.timeout(20000)});if(!r.ok||!/^image\//.test(r.headers.get('content-type')||''))throw new Error('封面暂时无法直接保存');if(Number(r.headers.get('content-length'))>20000000)throw new Error('封面过大');const blob=await r.blob();if(blob.size>20000000)throw new Error('封面过大');const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[blob.type]||'bin';saveBlob([blob],current.title+' 封面.'+ext,blob.type);status('封面已交给浏览器保存。');}
    catch(e){status(e.message==='Failed to fetch'?'此封面不允许跨域读取，请在原网页保存。':e.message,true);}finally{freeze(false);}
  }
  function playerData(item){return {format:'universal-player/1',url:item.url,type:item.type,title:current.title};}
  function preview(item){try{window.open(S.preview(location.href,playerData(item)),'_blank','noopener,noreferrer');}catch(e){status(e.message,true);}}
  function share(item){
    const base=window.UNIVERSAL_PLAYER_SITE;
    if(!base||S.local(base)){status('纯净播放页还没有公网地址，当前只能在本机预览。',true);return;}
    try{const url=S.link(base,playerData(item));$('#shareUrl').value=url;$('#openShare').href=url;$('#shareStatus').textContent='';$('#shareDialog').showModal();$('#shareUrl').focus();$('#shareUrl').select();}catch(e){status(e.message,true);}
  }
  $('#copyShare').onclick=async()=>{try{await navigator.clipboard.writeText($('#shareUrl').value);$('#shareStatus').textContent='分享链接已复制。';}catch(_){$('#shareUrl').focus();$('#shareUrl').select();$('#shareStatus').textContent='请使用复制快捷键复制选中的链接。';}};
  $('#analyze').onclick=analyze;
  $('#paste').onclick=async()=>{try{$('#input').value=await navigator.clipboard.readText();status('');}catch(_){status('浏览器未允许读取剪贴板，请长按或使用粘贴快捷键。',true);}};
  $('#input').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')analyze();};
  $('#helpToggle').onclick=()=>{$('#captureHelp').hidden=!$('#captureHelp').hidden;};
  $('#bookmark').href=C.makeBookmarklet(location.href.split('#')[0]);$('#bookmark').onclick=e=>{e.preventDefault();$('#captureHelp').hidden=false;status('请把“采集当前页”拖到书签栏，在目标视频网页中点击书签。');};
  $('#importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>524288){status('采集文件过大',true);return;}$('#input').value=await file.text();e.target.value='';analyze();};
  $('#clearResult').onclick=()=>{if(busy)return;items=[];current=null;render();status('');};
  $('#clearHistory').onclick=()=>{if(busy||!confirm('清空本机历史记录？清空后无法恢复。'))return;records=[];try{localStorage.removeItem(KEY);}catch(_){}renderHistory();};
  $('#cancel').onclick=()=>controller&&controller.abort();$('#saveAs').checked=!!window.showSaveFilePicker;$('#saveAs').disabled=!window.showSaveFilePicker;
  window.addEventListener('beforeunload',e=>{if(controller){e.preventDefault();e.returnValue='';}});
  renderHistory();
  if(location.hash.startsWith('#source=')){try{const source=M.safeUrl(decodeURIComponent(location.hash.slice(8)));history.replaceState(null,'',location.pathname);$('#input').value=source;analyze();}catch(e){status(e.message,true);}}
  if(location.hash.startsWith('#import=')){try{const payload=decodeURIComponent(location.hash.slice(8));if(payload.length>524288)throw new Error('采集结果过大');M.normalize(JSON.parse(payload));$('#input').value=payload;try{history.replaceState(null,'',location.pathname+location.search);}catch(_){}analyze();}catch(e){status('导入失败：'+e.message,true);}}
})();
