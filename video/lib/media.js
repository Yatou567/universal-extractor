(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./bilibili.js'):root.UniversalBilibili);if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalMedia=api;})(typeof globalThis!=='undefined'?globalThis:this,function(B){
  'use strict';
  function safeUrl(value,base){
    if(typeof value!=='string'||value.length>12000)throw new Error('链接无效或过长');
    const u=new URL(value,base);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('仅支持 HTTP / HTTPS 链接');return u.href;
  }
  function detect(url){return /\.m3u8(?:$|[?#])/i.test(url)?'hls':/\.(mp4|webm|mov)(?:$|[?#])/i.test(url)?'file':'page';}
  function normalize(data){
    if(!data||data.format!=='universal-extractor/1'||!Array.isArray(data.media))throw new Error('这不是有效的页面采集结果');
    const sourceUrl=safeUrl(data.sourceUrl),seen=new Set();
    const media=data.media.slice(0,50).map((m,i)=>{
      if(m.type==='dash'){try{if(!B.page(sourceUrl))return null;const item=B.normalize(m);if(seen.has(item.url))return null;seen.add(item.url);return Object.assign({id:'media-'+i},item);}catch(_){return null;}}
      try{const url=safeUrl(m.url,sourceUrl),detected=detect(url),type=detected==='page'&&['file','hls'].includes(m.type)?m.type:detected;if(type==='page'||seen.has(url))return null;seen.add(url);return {id:'media-'+i,url,type,label:String(m.label||'视频').slice(0,100),foundIn:Array.isArray(m.foundIn)?m.foundIn.slice(0,5).map(x=>String(x).slice(0,40)):[]};}catch(_){return null;}
    }).filter(Boolean);
    let poster='';try{if(data.poster)poster=safeUrl(data.poster,sourceUrl);}catch(_){}
    return {format:'universal-extractor/1',title:String(data.title||'网页视频').slice(0,180),sourceUrl,poster,capturedAt:Date.now(),media,blobCount:Number(data.blobCount)||0,blockedFrames:(Array.isArray(data.blockedFrames)?data.blockedFrames:[]).slice(0,10).map(u=>{try{return safeUrl(u,sourceUrl);}catch(_){return '';}}).filter(Boolean)};
  }
  function attributes(text){
    const out={};const re=/([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;let m;
    while((m=re.exec(text)))out[m[1]]=m[2].startsWith('"')?m[2].slice(1,-1):m[2];return out;
  }
  function byteRange(text,previous,url){
    const m=/^(\d+)(?:@(\d+))?$/.exec(text||'');if(!m||Number(m[1])<=0)throw new Error('不支持的分段字节范围');
    if(m[2]===undefined&&(!previous||previous.url!==url))throw new Error('分段字节偏移缺失');
    const start=m[2]===undefined?previous.end+1:Number(m[2]),end=start+Number(m[1])-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end))throw new Error('分段字节范围过大');return {start,end,url};
  }
  function parsePlaylist(text,url){
    if(typeof text!=='string'||text.length>3000000||!text.trimStart().startsWith('#EXTM3U'))throw new Error('地址没有返回有效的 M3U8 播放列表');
    const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const variants=[],renditions=[],segments=[];let pendingVariant=null,duration=0,partDuration=null,range='',previousRange=null,map=null,currentKey='NONE',discontinuity=false,hasDiscontinuity=false;
    for(const line of lines){
      if(line.startsWith('#EXT-X-STREAM-INF:')){pendingVariant=attributes(line.slice(18));continue;}
      if(line.startsWith('#EXT-X-MEDIA:')){renditions.push(attributes(line.slice(13)));continue;}
      if(line.startsWith('#EXT-X-KEY:')){currentKey=attributes(line.slice(11)).METHOD||'UNKNOWN';continue;}
      if(line.startsWith('#EXT-X-MAP:')){const a=attributes(line.slice(11));const u=safeUrl(a.URI,url);map={url:u,range:a.BYTERANGE?byteRange(a.BYTERANGE,null,u):null};continue;}
      if(line.startsWith('#EXT-X-BYTERANGE:')){range=line.slice(17);continue;}
      if(line==='#EXT-X-DISCONTINUITY'){discontinuity=true;if(segments.length)hasDiscontinuity=true;continue;}
      if(line.startsWith('#EXTINF:')){partDuration=Number(line.slice(8).split(',')[0]);if(!Number.isFinite(partDuration)||partDuration<0)throw new Error('播放列表时长无效');continue;}
      if(line.startsWith('#'))continue;
      const uri=safeUrl(line,url);
      if(pendingVariant){variants.push({url:uri,bandwidth:Number(pendingVariant.BANDWIDTH)||0,resolution:pendingVariant.RESOLUTION||'',codecs:pendingVariant.CODECS||'',audioGroup:pendingVariant.AUDIO||''});pendingVariant=null;continue;}
      if(partDuration!==null){
        const r=range?byteRange(range,previousRange,uri):null;
        segments.push({url:uri,duration:partDuration,range:r,map,key:currentKey,discontinuity});duration+=partDuration;previousRange=r;partDuration=null;range='';discontinuity=false;
      }
    }
    if(pendingVariant||partDuration!==null)throw new Error('播放列表内容不完整');
    if(segments.length>20000||variants.length>100)throw new Error('播放列表过大');
    const encrypted=segments.some(s=>s.key!=='NONE');
    const mapIds=new Set(segments.map(s=>s.map?JSON.stringify(s.map):''));
    return {url,variants,renditions,segments,duration,encrypted,ended:lines.includes('#EXT-X-ENDLIST'),hasDiscontinuity,multipleMaps:mapIds.size>1,format:map?'mp4':'ts'};
  }
  async function fetchText(url,signal,fetcher){
    const response=await (fetcher||fetch)(safeUrl(url),{credentials:'omit',signal});if(!response.ok)throw new Error('播放列表请求失败（'+response.status+'）');
    if(Number(response.headers.get('content-length'))>3000000)throw new Error('播放列表过大');
    return {text:await response.text(),url:response.url||url};
  }
  async function resolvePlaylist(url,options){
    options=options||{};let target=safeUrl(url);const visited=new Set(),choices=[];
    for(let i=0;i<5;i++){
      if(visited.has(target))throw new Error('播放列表循环跳转');visited.add(target);
      const data=await fetchText(target,options.signal,options.fetcher),plan=parsePlaylist(data.text,data.url);
      if(plan.variants.length){
        const list=plan.variants.slice().sort((a,b)=>b.bandwidth-a.bandwidth);choices.push(...list);
        const selected=list.find(v=>v.url===options.variant)||list[0];
        if(selected.audioGroup&&plan.renditions.some(r=>r.TYPE==='AUDIO'&&r['GROUP-ID']===selected.audioGroup&&r.URI))throw new Error('此视频使用独立音轨，当前网页版暂不支持完整合并');
        target=selected.url;continue;
      }
      if(!plan.segments.length)throw new Error('播放列表没有视频分段');
      if(!plan.ended)throw new Error('此播放源为直播或尚未结束，暂不支持完整保存');
      if(plan.encrypted)throw new Error('此播放源为加密流，当前网页版暂不支持');
      if(plan.multipleMaps||(plan.format==='mp4'&&plan.hasDiscontinuity))throw new Error('此分段流的初始化信息发生变化，暂不支持直接合并');
      return Object.assign(plan,{choices});
    }
    throw new Error('播放列表嵌套过深');
  }
  function filename(title,ext){return String(title||'视频').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,100).trim()+' 网页视频.'+ext;}
  function formatTime(seconds){const s=Math.round(seconds||0);return (s>=3600?Math.floor(s/3600)+':':'')+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
  return {safeUrl,detect,normalize,attributes,parsePlaylist,resolvePlaylist,filename,formatTime};
});
