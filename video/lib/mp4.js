(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../scripts/mux-node.cjs'):root.muxjs);if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalMP4=api;})(typeof globalThis!=='undefined'?globalThis:this,function(mux){
  'use strict';
  const HEADER_SIZE=262144,containers=new Set(['moov','trak','mdia','minf','stbl']);
  const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
  const type=(b,p)=>String.fromCharCode(...b.subarray(p+4,p+8));
  function boxes(bytes,start,end){
    start=start||0;end=end===undefined?bytes.length:end;const out=[],v=view(bytes);
    while(start<end){if(end-start<8)throw new Error('MP4 数据不完整');const size=v.getUint32(start);if(size<8||start+size>end)throw new Error('MP4 数据结构无效');out.push({start,end:start+size,size,type:type(bytes,start)});start+=size;}return out;
  }
  function children(bytes,box){return boxes(bytes,box.start+8,box.end);}
  function child(bytes,box,name){const found=children(bytes,box).find(b=>b.type===name);if(!found)throw new Error('MP4 缺少 '+name);return found;}
  function path(bytes,box,names){for(const name of names)box=child(bytes,box,name);return box;}
  function join(parts){const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length;}return b;}
  function box(name,payload){const b=new Uint8Array(payload.length+8);view(b).setUint32(0,b.length);for(let i=0;i<4;i++)b[4+i]=name.charCodeAt(i);b.set(payload,8);return b;}
  function uint64(v,offset){const n=v.getUint32(offset)*4294967296+v.getUint32(offset+4);if(!Number.isSafeInteger(n))throw new Error('MP4 时间戳超出支持范围');return n;}
  function set64(v,offset,n){v.setUint32(offset,Math.floor(n/4294967296));v.setUint32(offset+4,n%4294967296);}
  function duration(bytes,box,value){const v=view(bytes),p=box.start,version=bytes[p+8];const o=box.type==='tkhd'?(version?36:28):(version?32:24);value=Math.ceil(value);if(version)set64(v,p+o,value);else{if(value>4294967295)throw new Error('视频时长超出当前封装范围');v.setUint32(p+o,value);}}
  function scale(bytes,box){return view(bytes).getUint32(box.start+(bytes[box.start+8]?28:20));}
  function equal(a,b){return a.length===b.length&&a.every((x,i)=>x===b[i]);}
  function tracks(init){
    const moov=boxes(init).find(b=>b.type==='moov');if(!moov)throw new Error('视频初始化信息缺少 moov');const v=view(init),mvex=children(init,moov).find(b=>b.type==='mvex'),defaults=new Map(mvex?children(init,mvex).filter(b=>b.type==='trex').map(b=>[v.getUint32(b.start+12),v.getUint32(b.start+20)]):[]);
    return children(init,moov).filter(b=>b.type==='trak').map(trak=>{
      const tkhd=child(init,trak,'tkhd'),mdhd=path(init,trak,['mdia','mdhd']),stsd=path(init,trak,['mdia','minf','stbl','stsd']);
      const id=v.getUint32(tkhd.start+(init[tkhd.start+8]?28:20)),entries=boxes(init,stsd.start+16,stsd.end).map(b=>init.slice(b.start,b.end));
      if(entries.length!==1)throw new Error('初始化文件需要单一编码配置');const entry=entries[0],codec=type(entry,0);
      return {id,timescale:scale(init,mdhd),entry,codec,defaultDuration:defaults.get(id)||0,width:codec==='avc1'||codec==='avc3'?view(entry).getUint16(32):0,height:codec==='avc1'||codec==='avc3'?view(entry).getUint16(34):0};
    });
  }
  class Packager{
    constructor(){this.template=null;this.trackMap=new Map();this.sequence=0;this.fragments=0;this.offset=null;}
    register(init){
      const list=tracks(init),indices=new Map(),existing=!!this.template;if(!this.template)this.template=init.slice();
      if(this.trackMap.size&&list.length!==this.trackMap.size)throw new Error('分段的音视频轨道发生变化，无法完整封装');
      for(const item of list){
        let t=this.trackMap.get(item.id);if(existing&&!t)throw new Error('分段的音视频轨道标识发生变化');
        if(!t){t={id:item.id,timescale:item.timescale,codec:item.codec,entries:[],end:0,decodeEnd:0,samples:0,width:0,height:0};this.trackMap.set(item.id,t);}
        if(t.timescale!==item.timescale||t.codec!==item.codec)throw new Error('分段的编码或采样率发生变化，无法完整封装');t.defaultDuration=item.defaultDuration;
        let index=t.entries.findIndex(e=>equal(e,item.entry));if(index<0){if(t.entries.length>=32)throw new Error('视频编码配置变化过多');t.entries.push(item.entry);index=t.entries.length-1;}
        t.width=Math.max(t.width,item.width);t.height=Math.max(t.height,item.height);indices.set(item.id,index+1);
      }
      return indices;
    }
    header(){
      if(!this.template)throw new Error('没有可封装的视频');const init=this.template,top=boxes(init),moov=top.find(b=>b.type==='moov'),mvhd=child(init,moov,'mvhd'),movieScale=scale(init,mvhd),total=this.end;
      const rebuild=(b,track)=>{
        if(b.type==='trak'){const t=child(init,b,'tkhd');track=this.trackMap.get(view(init).getUint32(t.start+(init[t.start+8]?28:20)));}
        if(b.type==='stsd'){
          const prefix=init.slice(b.start+8,b.start+16);view(prefix).setUint32(4,track.entries.length);return box('stsd',join([prefix,...track.entries]));
        }
        if(containers.has(b.type))return box(b.type,join(children(init,b).map(c=>rebuild(c,track))));
        const copy=init.slice(b.start,b.end),local={start:0,type:b.type};
        if(b.type==='mvhd')duration(copy,local,total*movieScale);
        if(b.type==='mdhd')duration(copy,local,track.end);
        if(b.type==='tkhd'){
          duration(copy,local,track.end/track.timescale*movieScale);
          if(track.width){view(copy).setUint32(copy.length-8,track.width*65536);view(copy).setUint32(copy.length-4,track.height*65536);}
        }
        return copy;
      };
      const ftyp=top.find(b=>b.type==='ftyp');if(!ftyp)throw new Error('初始化文件缺少 ftyp');const prefix=join([init.slice(ftyp.start,ftyp.end),rebuild(moov)]),padding=HEADER_SIZE-prefix.length;
      if(padding<8)throw new Error('视频初始化信息过大');return join([prefix,box('free',new Uint8Array(padding-8))]);
    }
    fragment(init,input,normalize){
      const indices=this.register(init),data=input.slice(),v=view(data),moofs=boxes(data).filter(b=>b.type==='moof');let samples=0;
      if(!moofs.length)throw new Error('视频分段没有可封装的画面或声音');
      // 普通 fMP4 的原始时间线可能从较大的时间戳开始；所有轨道减去相同的秒数。
      if(normalize&&this.offset===null){let minimum=Infinity;for(const moof of moofs)for(const traf of children(data,moof).filter(b=>b.type==='traf')){const tfhd=child(data,traf,'tfhd'),tfdt=child(data,traf,'tfdt'),t=this.trackMap.get(v.getUint32(tfhd.start+12));const base=data[tfdt.start+8]?uint64(v,tfdt.start+12):v.getUint32(tfdt.start+12);minimum=Math.min(minimum,base/t.timescale);}this.offset=minimum;}
      for(const moof of moofs){
        v.setUint32(child(data,moof,'mfhd').start+12,++this.sequence);
        for(const traf of children(data,moof).filter(b=>b.type==='traf')){
          const tfhd=child(data,traf,'tfhd'),tfdt=child(data,traf,'tfdt'),flags=v.getUint32(tfhd.start+8)&0xffffff,id=v.getUint32(tfhd.start+12),t=this.trackMap.get(id);if(!t)throw new Error('分段包含未知音视频轨道');
          let o=tfhd.start+16;if(flags&1)throw new Error('暂不支持带绝对文件偏移的 MP4 分段');
          if(flags&2){v.setUint32(o,indices.get(id));o+=4;}else if(indices.get(id)!==1)throw new Error('分段无法标记变化后的编码配置');
          let defaultDuration=t.defaultDuration;if(flags&8){defaultDuration=v.getUint32(o);o+=4;}
          const baseOffset=tfdt.start+12;let base=data[tfdt.start+8]?uint64(v,baseOffset):v.getUint32(baseOffset);
          if(normalize){base-=Math.round(this.offset*t.timescale);if(base<0)throw new Error('MP4 轨道时间线无效');}
          // AAC 的 90kHz → 采样时钟换算会产生不足 1ms 的取整偏差；只对齐这个误差范围。
          const tolerance=Math.max(2,Math.ceil(t.timescale/1000));
          if(t.samples&&Math.abs(base-t.decodeEnd)<=tolerance)base=t.decodeEnd;
          if(data[tfdt.start+8])set64(v,baseOffset,base);else v.setUint32(baseOffset,base);
          if(t.samples&&base<t.decodeEnd-tolerance)throw new Error('分段时间线重叠（轨道 '+id+'，'+base+' < '+t.decodeEnd+'），无法生成完整 MP4');
          let dts=base,end=base;
          for(const trun of children(data,traf).filter(b=>b.type==='trun')){
            const f=v.getUint32(trun.start+8)&0xffffff,n=v.getUint32(trun.start+12);let p=trun.start+16;if(f&1)p+=4;if(f&4)p+=4;
            for(let i=0;i<n;i++){
              const dt=f&256?v.getUint32(p):defaultDuration;if(f&256)p+=4;if(f&512)p+=4;if(f&1024)p+=4;let cto=0;if(f&2048){cto=data[trun.start+8]?v.getInt32(p):v.getUint32(p);p+=4;}
              if(!dt||p>trun.end)throw new Error('分段的音视频采样信息不完整');end=Math.max(end,dts+cto+dt);dts+=dt;
            }
            samples+=n;t.samples+=n;
          }
          t.decodeEnd=dts;t.end=Math.max(t.end,end,dts);
        }
      }
      if(!samples)throw new Error('此分段没有音视频采样');this.fragments+=moofs.length;return data;
    }
    get end(){return Math.max(0,...Array.from(this.trackMap.values(),t=>t.end/t.timescale));}
    get decodeEnd(){return Math.max(0,...Array.from(this.trackMap.values(),t=>t.decodeEnd/t.timescale));}
    stats(){return {duration:this.end,fragments:this.fragments,tracks:Array.from(this.trackMap.values(),t=>({id:t.id,codec:t.codec,samples:t.samples,descriptions:t.entries.length,duration:t.end/t.timescale}))};}
  }
  function transmuxer(base){
    if(!mux||!mux.mp4)throw new Error('MP4 封装组件未加载');const tx=new mux.mp4.Transmuxer({remux:true,keepOriginalTimestamps:false,baseMediaDecodeTime:Math.round(base*90000)});let output=[],failure;
    tx.on('data',s=>output.push(s));tx.on('error',e=>{failure=e;});
    return {push(bytes){output=[];failure=null;tx.push(bytes);tx.flush();if(failure)throw new Error('视频转封装失败：'+failure);if(!output.length)throw new Error('分段未产生音视频数据，无法完整导出');return output;}};
  }
  return {Packager,transmuxer,HEADER_SIZE,boxes,tracks};
});
