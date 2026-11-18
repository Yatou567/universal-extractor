(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalSourceBridge=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  async function connect(opener,sourceUrl){
    if(!opener||opener.closed)throw new Error('请在 B 站原网页点击采集书签，再点“返回下载”；下载期间保持原网页打开。');
    const origin=new URL(sourceUrl).origin;if(!/^https:\/\/(?:www\.|m\.)?bilibili\.com$/.test(origin))throw new Error('采集来源不正确');
    const channel=new MessageChannel(),port=channel.port1,pending=new Map();let sequence=0,closed=false;
    let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const timer=setTimeout(()=>readyReject(new Error('未连接到 B 站页面，请在原网页重新点击采集书签和“返回下载”。')),6000);
    port.onmessage=e=>{const m=e.data||{};if(m.ready){clearTimeout(timer);readyResolve();return;}const p=pending.get(m.id);if(!p)return;pending.delete(m.id);p.clear();if(m.error)p.reject(new Error(m.error));else if(m.bytes instanceof ArrayBuffer)p.resolve(new Uint8Array(m.bytes));else p.reject(new Error('原网页没有返回有效视频数据'));};
    try{opener.postMessage({format:'universal-bili-connect/1'},origin,[channel.port2]);await ready;}catch(e){clearTimeout(timer);port.close();channel.port2.close();throw e;}
    const close=()=>{if(closed)return;closed=true;port.postMessage({close:true});port.close();for(const p of pending.values()){p.clear();p.reject(new Error('B 站页面连接已关闭'));}pending.clear();};
    const read=(url,range,options)=>new Promise((resolve,reject)=>{
      const signal=options&&options.signal;if(closed||opener.closed){reject(new Error('B 站原网页已关闭，请重新采集'));return;}if(signal?.aborted){reject(new DOMException('已取消下载','AbortError'));return;}
      const id=++sequence,stop=()=>{port.postMessage({id,cancel:true});pending.delete(id);clear();reject(new DOMException('已取消下载','AbortError'));},timeout=setTimeout(()=>{port.postMessage({id,cancel:true});pending.delete(id);clear();reject(new Error('B 站页面响应超时，请检查原视频页面是否仍然打开'));},35000);
      function clear(){clearTimeout(timeout);signal?.removeEventListener('abort',stop);}
      pending.set(id,{resolve,reject,clear});signal?.addEventListener('abort',stop,{once:true});port.postMessage({id,url,range});
    });
    window.addEventListener('pagehide',close,{once:true});return {read,close};
  }
  return {connect};
});
