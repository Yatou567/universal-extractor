(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./media.js'):root.UniversalMedia,typeof module==='object'&&module.exports?require('./mp4.js'):root.UniversalMP4);if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalDownload=api;})(typeof globalThis!=='undefined'?globalThis:this,function(media,mp4){
  'use strict';
  function abortCheck(signal){if(signal&&signal.aborted)throw new DOMException('已取消下载','AbortError');}
  function tsHeader(bytes){
    for(let i=0;i<Math.min(188,bytes.length);i++){
      if(bytes[i]!==71||bytes[i+188]!==71||bytes[i+376]!==71||(bytes.length-i)%188)continue;
      let valid=true;for(let p=i;p<bytes.length;p+=188)if(bytes[p]!==71){valid=false;break;}if(valid)return true;
    }return false;
  }
  function mp4Header(bytes){
    if(bytes.length<16||String.fromCharCode(...bytes.slice(4,8))!=='ftyp')return false;
    const brand=String.fromCharCode(...bytes.slice(8,12));return /^(isom|iso[2-9]|mp4[12]|avc1|dash|cmf[cs]|M4[AV] |MSNV)$/.test(brand);
  }
  // 仅保留顶层 box 的几个头字节，检查直链文件有没有在中途截断，不缓存整部视频。
  class FileValidator{
    constructor(){this.header=[];this.remaining=0;this.toEnd=false;this.types=new Set();}
    push(bytes){
      let offset=0;
      while(offset<bytes.length){
        if(this.toEnd)return;
        if(this.remaining){const n=Math.min(this.remaining,bytes.length-offset);this.remaining-=n;offset+=n;continue;}
        const need=this.header.length>=8&&this.header[0]===0&&this.header[1]===0&&this.header[2]===0&&this.header[3]===1?16:8;
        while(this.header.length<need&&offset<bytes.length)this.header.push(bytes[offset++]);
        if(this.header.length<need)return;
        const b=new Uint8Array(this.header),v=new DataView(b.buffer),small=v.getUint32(0);
        if(small===1&&need===8)continue;
        const kind=String.fromCharCode(...b.slice(4,8));let length=small;
        if(small===1)length=v.getUint32(8)*4294967296+v.getUint32(12);
        if(!/^[A-Za-z0-9 ]{4}$/.test(kind)||!Number.isSafeInteger(length)||length!==0&&length<need)throw new Error('MP4 文件结构无效');
        this.types.add(kind);this.header=[];
        if(length===0){if(kind!=='mdat')throw new Error('MP4 文件结构无效');this.toEnd=true;}else this.remaining=length-need;
      }
    }
    finish(){if(this.header.length||this.remaining||!this.types.has('moov')||!this.types.has('mdat'))throw new Error('MP4 文件没有下载完整或缺少音视频数据');}
  }
  async function readBytes(url,range,options){
    options=options||{};const headers={};if(range)headers.Range='bytes='+range.start+'-'+range.end;
    let last;
    for(let attempt=0;attempt<3;attempt++){
      abortCheck(options.signal);
      try{
        const r=await (options.fetcher||fetch)(media.safeUrl(url),{headers,credentials:'omit',signal:options.signal});
        if(!r.ok)throw new Error('视频分段请求失败（'+r.status+'）');
        if(range&&(r.status!==206||r.headers.get('content-range')&&!r.headers.get('content-range').startsWith('bytes '+range.start+'-'+range.end+'/')))throw new Error('服务器未返回所需的分段字节范围');
        if(/text\/|application\/(?:json|xhtml)/i.test(r.headers.get('content-type')||''))throw new Error('视频地址返回了网页或错误信息');
        const declared=Number(r.headers.get('content-length'));if(declared>32*1024*1024)throw new Error('单个分段过大，暂时无法处理');
        if(!r.body)throw new Error('未收到视频数据');
        const reader=r.body.getReader(),chunks=[];let size=0;
        try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32*1024*1024)throw new Error('单个分段过大');chunks.push(value);}}
        finally{await reader.cancel().catch(()=>{});}
        if(!size||range&&size!==range.end-range.start+1)throw new Error('分段下载不完整');
        const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}return data;
      }catch(e){if(e.name==='AbortError')throw e;last=e;}
    }
    throw last;
  }
  async function hls(plan,sink,options){
    options=options||{};
    if(!plan.ended||plan.encrypted||!plan.segments.length||plan.multipleMaps)throw new Error('此播放源暂不支持完整 MP4 导出');
    if(typeof sink.patch!=='function')throw new Error('保存目标不支持 MP4 文件封装');
    const pack=new mp4.Packager(),pending=new Map(),fetchController=new AbortController();
    const fetchOptions=Object.assign({},options,{signal:options.signal?AbortSignal.any([options.signal,fetchController.signal]):fetchController.signal});
    const queue=index=>{if(index>=plan.segments.length)return;const s=plan.segments[index],promise=readBytes(s.url,s.range,fetchOptions);promise.catch(()=>{});pending.set(index,promise);};
    let bytes=0,tx=null,init=null,started=false;
    try{
      if(plan.format==='mp4'){
        const map=plan.segments[0].map;if(!map)throw new Error('MP4 分段缺少初始化信息');
        init=await readBytes(map.url,map.range,options);if(!mp4Header(init))throw new Error('视频初始化文件校验失败');
      }
      for(let i=0;i<Math.min(4,plan.segments.length);i++)queue(i);
      for(let i=0;i<plan.segments.length;i++){
        abortCheck(options.signal);const segment=plan.segments[i],data=await pending.get(i);pending.delete(i);queue(i+4);
        let outputs;
        if(plan.format==='ts'){
          if(!tsHeader(data))throw new Error('第 '+(i+1)+' 段不是有效的 TS 视频数据');
          if(!tx||segment.discontinuity)tx=mp4.transmuxer(pack.end);
          outputs=tx.push(data).map(s=>({init:s.initSegment,data:s.data}));
        }else outputs=[{init,data}];
        for(const output of outputs){
          let fragment;try{fragment=pack.fragment(output.init,output.data,plan.format==='mp4');}catch(e){throw new Error('第 '+(i+1)+' 段：'+e.message);}
          if(!started){const header=pack.header();await sink.write(header);bytes+=header.length;started=true;}
          await sink.write(fragment);bytes+=fragment.length;
        }
        if(options.onProgress)options.onProgress({completed:i+1,total:plan.segments.length,bytes,phase:'download'});
      }
      abortCheck(options.signal);
      if(options.onProgress)options.onProgress({completed:plan.segments.length,total:plan.segments.length,bytes,phase:'finalize'});
      await sink.patch(0,pack.header());abortCheck(options.signal);await sink.close();
      return Object.assign({bytes,segments:plan.segments.length},pack.stats());
    }catch(e){await sink.abort().catch(()=>{});throw e;}finally{fetchController.abort();}
  }
  async function file(url,sink,options){
    options=options||{};let reader,bytes=0;const validator=new FileValidator();
    try{
      const response=await (options.fetcher||fetch)(media.safeUrl(url),{credentials:'omit',signal:options.signal});
      if(!response.ok||!response.body)throw new Error('视频请求失败（'+response.status+'）');
      if(/text\/|application\/(?:json|xhtml)/i.test(response.headers.get('content-type')||''))throw new Error('视频地址返回了网页或错误信息');
      const total=Number(response.headers.get('content-length'))||0;reader=response.body.getReader();
      let checked=false,prefix=[];
      for(;;){abortCheck(options.signal);const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;
        if(!checked){prefix.push(value);if(bytes<16)continue;const head=new Uint8Array(bytes);let offset=0;for(const v of prefix){head.set(v,offset);offset+=v.byteLength;}
          if(!mp4Header(head))throw new Error('此地址不是 MP4 文件。当前网页版不能将 WebM / MOV 等文件转码成 MP4。');
          for(const v of prefix){validator.push(v);await sink.write(v);}prefix=[];checked=true;
        }else{validator.push(value);await sink.write(value);}
        if(options.onProgress)options.onProgress({bytes,totalBytes:total});
      }
      if(!checked||!bytes)throw new Error('视频文件为空或不完整');
      if(total&&bytes!==total)throw new Error('视频文件没有下载完整');
      validator.finish();
      abortCheck(options.signal);await sink.close();return {bytes};
    }catch(e){await sink.abort().catch(()=>{});throw e;}finally{if(reader)await reader.cancel().catch(()=>{});}
  }
  function memorySink(onSave,maxBytes){
    const chunks=[];let size=0,closed=false;const limit=maxBytes||256*1024*1024;
    return {
      async write(bytes){if(closed)throw new Error('下载已结束');size+=bytes.byteLength;if(size>limit)throw new Error('文件超过当前浏览器的内存保存上限，请使用 Chrome / Edge 的“选择保存位置”');chunks.push(bytes.slice());},
      async patch(position,data){if(closed||position<0||position+data.length>size)throw new Error('文件封装位置无效');let offset=0,read=0;for(const chunk of chunks){const start=Math.max(0,position-offset),count=Math.min(chunk.length-start,data.length-read);if(count>0){chunk.set(data.subarray(read,read+count),start);read+=count;position+=count;}offset+=chunk.length;if(read===data.length)break;}},
      async close(){if(closed)throw new Error('下载已结束');closed=true;await onSave(chunks);chunks.length=0;},
      async abort(){closed=true;chunks.length=0;}
    };
  }
  return {hls,file,memorySink,readBytes,tsHeader,mp4Header};
});
