(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./mp4.js'):root.UniversalMP4,typeof module==='object'&&module.exports?require('./bilibili.js'):root.UniversalBilibili);if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalDash=api;})(typeof globalThis!=='undefined'?globalThis:this,function(M,B){
  'use strict';
  const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength),join=parts=>{const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let p=0;for(const b of parts){out.set(b,p);p+=b.length;}return out;};
  function box(type,bytes){const out=new Uint8Array(8+bytes.length);view(out).setUint32(0,out.length);for(let i=0;i<4;i++)out[i+4]=type.charCodeAt(i);out.set(bytes,8);return out;}
  const children=(bytes,b)=>M.boxes(bytes,b.start+8,b.end);
  const find=(bytes,b,name)=>{const c=children(bytes,b).find(x=>x.type===name);if(!c)throw new Error('DASH 缺少 '+name);return c;};
  function index(bytes,range){
    const s=M.boxes(bytes).find(b=>b.type==='sidx');if(!s)throw new Error('B 站视频缺少分段索引');const v=view(bytes),version=bytes[s.start+8];if(version>1)throw new Error('不支持的 DASH 索引版本');
    const scale=v.getUint32(s.start+16);if(!scale)throw new Error('DASH 时间单位无效');let p=s.start+20;
    const uint64=()=>{const n=v.getUint32(p)*4294967296+v.getUint32(p+4);p+=8;if(!Number.isSafeInteger(n))throw new Error('DASH 索引超出范围');return n;};
    let time,offset;if(version){time=uint64();offset=uint64();}else{time=v.getUint32(p);offset=v.getUint32(p+4);p+=8;}p+=2;const count=v.getUint16(p);p+=2;
    if(!count||count>20000||p+count*12!==s.end)throw new Error('DASH 分段索引不完整');let start=range.start+s.end+offset;const segments=[];
    for(let i=0;i<count;i++){const size=v.getUint32(p),duration=v.getUint32(p+4);p+=12;if(size>>>31||!size||size>32*1024*1024||!duration)throw new Error('此 DASH 分段暂不支持');const end=start+size-1;if(!Number.isSafeInteger(end))throw new Error('DASH 分段偏移无效');segments.push({range:{start,end},time:time/scale,duration:duration/scale});start=end+1;time+=duration;}
    return segments;
  }
  function initTrack(bytes,id){
    const moov=M.boxes(bytes).find(b=>b.type==='moov');if(!moov)throw new Error('DASH 初始化文件缺少 moov');const traks=children(bytes,moov).filter(b=>b.type==='trak');if(traks.length!==1)throw new Error('DASH 轨道数量无效');
    const trak=bytes.slice(traks[0].start,traks[0].end),root={start:0,end:trak.length},tkhd=find(trak,root,'tkhd'),oldId=view(trak).getUint32(tkhd.start+(trak[tkhd.start+8]?28:20));view(trak).setUint32(tkhd.start+(trak[tkhd.start+8]?28:20),id);
    const mvex=find(bytes,moov,'mvex'),trex=find(bytes,mvex,'trex'),defaults=bytes.slice(trex.start,trex.end);view(defaults).setUint32(12,id);
    const mvhd=find(bytes,moov,'mvhd');return {trak,defaults,oldId,movie:bytes.slice(mvhd.start,mvhd.end),scale:view(bytes).getUint32(mvhd.start+(bytes[mvhd.start+8]?28:20))};
  }
  function combine(video,audio){
    video=new Uint8Array(video);audio=new Uint8Array(audio);
    const v=initTrack(video,1),a=initTrack(audio,2);if(v.scale!==a.scale)throw new Error('音视频的电影时间单位不同，暂不能合并');view(v.movie).setUint32(v.movie.length-4,3);
    const ftyp=M.boxes(video).find(b=>b.type==='ftyp');if(!ftyp)throw new Error('DASH 初始化文件缺少 ftyp');
    const init=join([video.slice(ftyp.start,ftyp.end),box('moov',join([v.movie,v.trak,a.trak,box('mvex',join([v.defaults,a.defaults]))]))]);
    const tracks=M.tracks(init);if(tracks.length!==2||tracks[0].codec!=='avc1'&&tracks[0].codec!=='avc3'||tracks[1].codec!=='mp4a')throw new Error('DASH 音视频编码不兼容');return {init,oldIds:[v.oldId,a.oldId]};
  }
  function fragment(bytes,oldId,newId){
    const out=new Uint8Array(bytes),v=view(out),top=M.boxes(out),moofs=top.filter(b=>b.type==='moof');if(!moofs.length||!top.some(b=>b.type==='mdat'))throw new Error('DASH 分段没有音视频数据');
    for(const moof of moofs){const trafs=children(out,moof).filter(b=>b.type==='traf');if(trafs.length!==1)throw new Error('DASH 分段轨道无效');const tfhd=find(out,trafs[0],'tfhd'),flags=v.getUint32(tfhd.start+8)&0xffffff;if(flags&1||!(flags&0x020000))throw new Error('DASH 分段使用了不支持的文件偏移');if(v.getUint32(tfhd.start+12)!==oldId)throw new Error('DASH 分段轨道不匹配');v.setUint32(tfhd.start+12,newId);}return out;
  }
  async function download(item,sink,options){
    options=options||{};const media=B.normalize(item),read=options.read;if(typeof read!=='function')throw new Error('请在 B 站原网页重新采集后下载');if(typeof sink.patch!=='function')throw new Error('保存位置不支持 MP4 封装');
    const check=()=>{if(options.signal?.aborted)throw new DOMException('已取消下载','AbortError');},controller=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
    const get=async(t,r)=>{let error;for(const url of [t.url,...t.backupUrls]){check();try{return await read(url,r,{signal});}catch(e){if(signal.aborted)throw e;error=e;}}throw error;};
    const tracks=[media.video,media.audio],pack=new M.Packager(),pending=new Map();let bytes=0;
    try{
      const parts=await Promise.all(tracks.map(async t=>({init:await get(t,t.initRange),index:await get(t,t.indexRange)}))),merged=combine(parts[0].init,parts[1].init);
      const segments=parts.flatMap((p,i)=>index(p.index,tracks[i].indexRange).map(s=>({...s,track:i}))).sort((a,b)=>a.time-b.time||a.track-b.track);
      const queue=i=>{if(i>=segments.length)return;const s=segments[i],p=get(tracks[s.track],s.range);p.catch(()=>{});pending.set(i,p);};for(let i=0;i<Math.min(4,segments.length);i++)queue(i);
      for(let i=0;i<segments.length;i++){
        check();const s=segments[i],data=await pending.get(i);pending.delete(i);queue(i+4);const part=pack.fragment(merged.init,fragment(data,merged.oldIds[s.track],s.track+1),false);
        if(!bytes){const header=pack.header();await sink.write(header);bytes+=header.length;}await sink.write(part);bytes+=part.length;options.onProgress?.({completed:i+1,total:segments.length,bytes,phase:'download'});
      }
      const stats=pack.stats();if(stats.tracks.length!==2||stats.tracks.some(t=>!t.samples)||media.duration&&stats.tracks.some(t=>Math.abs(t.duration-media.duration)>Math.max(2,media.duration*.01)))throw new Error('音视频时长不完整，请重新采集');
      check();options.onProgress?.({completed:segments.length,total:segments.length,bytes,phase:'finalize'});await sink.patch(0,pack.header());check();await sink.close();return {...stats,bytes,segments:segments.length};
    }catch(e){await sink.abort().catch(()=>{});throw e;}finally{controller.abort();}
  }
  return {index,combine,fragment,download};
});
