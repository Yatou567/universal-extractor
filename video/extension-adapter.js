(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./lib/bilibili.js'):root.UniversalBilibili);if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalExtension=api;})(globalThis,function(B){
  'use strict';
  function source(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!(B.page(u.href)||u.hostname==='b23.tv'&&/^\/[A-Za-z0-9]+\/?$/.test(u.pathname)))throw new Error('请输入有效的 B 站视频链接');return u.href;}
  function key(value){const u=new URL(value);return u.pathname.replace(/\/$/,'')+'?p='+(u.searchParams.get('p')||'1');}
  async function extract(value){
    const url=source(value),api=globalThis.chrome;if(!api?.runtime?.id)throw new Error('请在 Chrome 中加载扩展后使用 B 站下载');
    const tabs=await api.tabs.query({}),expected=B.page(url)?key(url):'',token=crypto.randomUUID();
    let tab=tabs.find(t=>{try{return B.page(t.url)&&expected&&key(t.url)===expected;}catch(_){return false;}});
    if(!tab)tab=await api.tabs.create({url,active:false});let data,lastError='',live,ready=false;
    const end=Date.now()+25000;
    while(Date.now()<end){
      live=await api.tabs.get(tab.id);
      if(B.page(live.url)&&live.status==='complete'){
        if(expected&&key(live.url)!==expected&&!/^\/video\/av/.test(new URL(url).pathname))throw new Error('原页面已切换到其他视频，请重新打开目标链接');
        await api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',files:['video/lib/bilibili.js']});
        const results=await api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:capture,args:[token]});
        const result=results[0]?.result;
        if(result?.error)lastError=result.error;
        if(result?.data?.media?.length){data=result.data;ready=true;break;}
      }
      await new Promise(resolve=>setTimeout(resolve,700));
    }
    if(!ready)throw new Error(lastError||'未读到 B 站完整音视频，请在原页面播放视频、完成登录或验证后重新分析');
    const active=new Set();let closed=false,sequence=0;
    const cancel=id=>api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:cancelRead,args:[token,id]}).catch(()=>{});
    const read=(url,range,options)=>new Promise((resolve,reject)=>{
      const signal=options?.signal;if(closed||signal?.aborted){reject(new DOMException('已取消下载','AbortError'));return;}
      const id=++sequence;active.add(id);
      const abort=()=>{cancel(id);reject(new DOMException('已取消下载','AbortError'));};signal?.addEventListener('abort',abort,{once:true});
      api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:readRange,args:[{token,id,url,range}]}).then(results=>{
        if(closed||signal?.aborted)throw new DOMException('已取消下载','AbortError');const result=results[0]?.result;
        if(!result?.ok)throw new Error(result?.error||'B 站原页面已关闭或重新加载，请重新分析');
        const binary=atob(result.base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);if(bytes.length!==range.end-range.start+1)throw new Error('B 站分段数据不完整');resolve(bytes);
      }).catch(reject).finally(()=>{active.delete(id);signal?.removeEventListener('abort',abort);});
    });
    const close=()=>{if(closed)return;closed=true;for(const id of active)cancel(id);};return {data,bridge:{read,close},tabId:tab.id};
  }
  // 以下函数在 B 站的隔离脚本环境运行；页面脚本不能替换本地解析器与 fetch。
  function capture(token){
    try{
      const old=globalThis.__universalBiliCapture;if(old)for(const c of old.jobs.values())c.abort();
      const data=globalThis.UniversalBilibili.collect({document,location},location.href),allowed=new Set();
      for(const m of data.media)for(const t of [m.video,m.audio])for(const u of [t.url,...t.backupUrls])allowed.add(u);
      globalThis.__universalBiliCapture={token,data,allowed,jobs:new Map(),cancelled:new Set()};return {data};
    }catch(e){return {error:e.message};}
  }
  function cancelRead(token,id){const s=globalThis.__universalBiliCapture;if(s?.token===token){s.cancelled.add(id);s.jobs.get(id)?.abort();}}
  async function readRange(m){
    const s=globalThis.__universalBiliCapture;let reader,controller;
    try{
      const live=new URL(location.href),original=new URL(s?.data?.sourceUrl||'https://invalid.test/');
      if(!s||s.token!==m.token||live.origin!==original.origin||live.pathname!==original.pathname||(live.searchParams.get('p')||'1')!==(original.searchParams.get('p')||'1'))throw new Error('B 站原页面已切换，请重新分析');
      if(!s.allowed.has(m.url)||!Number.isSafeInteger(m.id)||!m.range||!Number.isSafeInteger(m.range.start)||!Number.isSafeInteger(m.range.end)||m.range.start<0||m.range.end<m.range.start||m.range.end-m.range.start>=32*1024*1024)throw new Error('请求不在本次 B 站视频范围内');
      if(s.cancelled.has(m.id))throw new DOMException('已取消下载','AbortError');if(s.jobs.size>=4||s.jobs.has(m.id))throw new Error('B 站下载请求过多');
      controller=new AbortController();s.jobs.set(m.id,controller);
      const r=await fetch(m.url,{headers:{Range:'bytes='+m.range.start+'-'+m.range.end},credentials:'omit',referrer:location.href,referrerPolicy:'origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
      const range=r.headers.get('content-range');if(r.status!==206||range&&!range.startsWith('bytes '+m.range.start+'-'+m.range.end+'/')||/text\/|application\/json/.test(r.headers.get('content-type')||'')){r.body?.cancel();throw new Error('B 站媒体请求失败（'+r.status+'），请重新分析');}
      reader=r.body.getReader();const chunks=[];let length=0;const expected=m.range.end-m.range.start+1;
      for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>expected)throw new Error('B 站返回了错误的字节范围');chunks.push(value);}
      if(length!==expected)throw new Error('B 站分段下载不完整');const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      let binary='';for(let p=0;p<bytes.length;p+=32768)binary+=String.fromCharCode(...bytes.subarray(p,p+32768));return {ok:true,base64:btoa(binary)};
    }catch(e){return {ok:false,error:e.message};}finally{if(reader)await reader.cancel().catch(()=>{});if(controller){s.jobs.delete(m.id);s.cancelled.delete(m.id);}}
  }
  return {extract,source,key,capture,readRange,cancelRead};
});
