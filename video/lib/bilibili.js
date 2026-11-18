(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalBilibili=api;})(typeof globalThis!=='undefined'?globalThis:this,function biliFactory(){
  'use strict';
  function page(value){try{const u=new URL(value);return /^(?:www\.|m\.)?bilibili\.com$/.test(u.hostname)&&/^\/video\/(?:BV[0-9A-Za-z]{10}|av\d+)\/?$/.test(u.pathname);}catch(_){return false;}}
  function range(value){const m=/^(\d+)-(\d+)$/.exec(String(value||''));if(!m)throw new Error('B 站分段索引缺失，请重新采集');const start=Number(m[1]),end=Number(m[2]);if(!Number.isSafeInteger(end)||end<start||end-start>1048576)throw new Error('B 站分段索引无效');return {start,end};}
  function url(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!/(?:^|\.)(?:bilivideo\.com|bilivideo\.cn|akamaized\.net)$/.test(u.hostname))throw new Error('B 站媒体地址无效');return u.href;}
  function track(t){
    if(!t||typeof t!=='object')throw new Error('B 站音视频轨道缺失');
    const b=t.SegmentBase||t.segment_base||{};
    const init=t.initRange||range(b.Initialization||b.initialization),index=t.indexRange||range(b.indexRange||b.index_range);
    const check=r=>{if(!r||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<r.start||r.end-r.start>1048576)throw new Error('B 站分段索引无效');return {start:r.start,end:r.end};};
    const initRange=check(init),indexRange=check(index);if(initRange.start!==0||initRange.end>=indexRange.start)throw new Error('B 站分段索引无效');
    return {url:url(t.url||t.baseUrl||t.base_url),backupUrls:(t.backupUrls||t.backupUrl||t.backup_url||[]).slice(0,3).map(url),initRange,indexRange,codec:String(t.codec||t.codecs||''),bandwidth:Number(t.bandwidth)||0};
  }
  function normalize(m){
    const video=track(m.video),audio=track(m.audio);
    if(!/^avc[13]\./.test(video.codec)||audio.codec!=='mp4a.40.2')throw new Error('当前仅支持 H.264 画面和 AAC 声音');
    return {url:video.url,type:'dash',video,audio,quality:Number(m.quality)||0,label:String(m.label||'B 站视频').slice(0,100),duration:Number(m.duration)||0,foundIn:['B 站播放器 · 音画合并']};
  }
  // JSON 声明只做 JSON.parse，不执行页面脚本。
  function declaration(doc,name){
    for(const script of Array.from(doc.scripts||[]).slice(0,100)){
      if(script.src)continue;const text=(script.textContent||'').slice(0,2000000),match=new RegExp('(?:window\\.)?'+name+'\\s*=\\s*').exec(text);if(!match)continue;
      const start=match.index+match[0].length;if(text[start]!=='{')continue;let depth=0,string=false,escape=false;
      for(let i=start;i<text.length;i++){const c=text[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;}else if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){try{return JSON.parse(text.slice(start,i+1));}catch(_){break;}}}
    }return null;
  }
  function collect(env,sourceUrl){
    if(!page(sourceUrl))return null;const doc=env.document,state=env.__INITIAL_STATE__||declaration(doc,'__INITIAL_STATE__')||{},play=env.__playinfo__||declaration(doc,'__playinfo__')||{},data=play.data||{};
    const v=state.videoData||{},dash=data.dash||{},videos=Array.isArray(dash.video)?dash.video:[],audios=Array.isArray(dash.audio)?dash.audio:[];
    const source=new URL(sourceUrl),requested=source.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/),part=Number(source.searchParams.get('p')||1);
    if(requested&&v.bvid&&requested[1]!==v.bvid||state.p&&Number(state.p)!==part)throw new Error('B 站页面已经切换，请刷新原视频页面后重新分析');
    if(data.is_preview||data.is_drm||data.drm_tech_type)throw new Error('此视频的播放数据包含试看或加密限制，不能导出完整视频');
    const audio=audios.filter(a=>a.codecs==='mp4a.40.2').sort((a,b)=>b.bandwidth-a.bandwidth)[0],qualities=new Set(),media=[];
    for(const video of videos.filter(x=>/^avc[13]\./.test(x.codecs||'')).sort((a,b)=>b.id-a.id||b.bandwidth-a.bandwidth)){
      if(!audio||qualities.has(video.id))continue;try{const labels={16:'360P',32:'480P',64:'720P',74:'720P60',80:'1080P',112:'1080P+',116:'1080P60',120:'4K'};media.push(normalize({video,audio,quality:video.id,label:(labels[video.id]||video.height+'P')+' · MP4 音画合并',duration:Number(data.timelength)/1000||Number(dash.duration)}));qualities.add(video.id);}catch(_){}
    }
    const heading=doc.querySelector('h1');return {format:'universal-extractor/1',sourceUrl,title:String(heading&&heading.textContent.trim()||v.title||doc.title||'B 站视频').slice(0,180),poster:String(v.pic||'').replace(/^http:\/\//,'https://'),capturedAt:Date.now(),media,blockedFrames:[],blobCount:0};
  }
  // 仅向用户点击打开的提取页提供本次捕获的媒体字节，不提供任意 URL 代理。
  function serve(target,appOrigin,data){
    const allowed=new Set();for(const m of data.media)for(const t of [m.video,m.audio])if(t)for(const u of [t.url,...t.backupUrls])allowed.add(u);
    const listener=e=>{
      if(e.source!==target||e.origin!==appOrigin||e.data?.format!=='universal-bili-connect/1'||!e.ports[0])return;
      window.removeEventListener('message',listener);const port=e.ports[0],jobs=new Map();
      port.onmessage=async event=>{
        const m=event.data||{};if(m.cancel){jobs.get(m.id)?.abort();return;}
        if(m.close){for(const c of jobs.values())c.abort();jobs.clear();port.close();return;}
        if(!Number.isSafeInteger(m.id)||jobs.has(m.id)||jobs.size>=4)return;
        if(!allowed.has(m.url)||!m.range||!Number.isSafeInteger(m.range.start)||!Number.isSafeInteger(m.range.end)||m.range.start<0||m.range.end<m.range.start||m.range.end-m.range.start>=32*1024*1024){port.postMessage({id:m.id,error:'采集请求不在本次视频范围内'});return;}
        const controller=new AbortController();jobs.set(m.id,controller);
        try{
          const r=await fetch(m.url,{headers:{Range:'bytes='+m.range.start+'-'+m.range.end},credentials:'omit',referrer:location.href,referrerPolicy:'origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
          const contentRange=r.headers.get('content-range');
          if(r.status!==206||contentRange&&!contentRange.startsWith('bytes '+m.range.start+'-'+m.range.end+'/')||/text\/|application\/json/.test(r.headers.get('content-type')||'')){r.body?.cancel();throw new Error('B 站媒体请求失败（'+r.status+'），请刷新原视频后重新采集');}
          const length=m.range.end-m.range.start+1,chunks=[];let size=0;const reader=r.body.getReader();
          try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>length)throw new Error('B 站返回的字节范围不正确');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
          if(size!==length)throw new Error('B 站音视频分段没有下载完整');const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}port.postMessage({id:m.id,bytes:bytes.buffer},[bytes.buffer]);
        }catch(error){port.postMessage({id:m.id,error:error.message});}finally{jobs.delete(m.id);}
      };port.postMessage({ready:true});
    };window.addEventListener('message',listener);setTimeout(()=>window.removeEventListener('message',listener),120000);
  }
  return {page,range,track,normalize,collect,serve,source:()=>biliFactory.toString()};
});
