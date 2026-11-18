(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./bilibili.js'):root.UniversalBilibili);if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalCollector=api;})(typeof globalThis!=='undefined'?globalThis:this,function(B){
  // 此函数完全自包含，可作为书签在用户主动选择的播放页运行。
  function collectPage(env,forcedBase,bili){
    env=env||window;
    const firstDoc=env.document||env,sourceUrl=forcedBase||(env.location&&env.location.href)||firstDoc.URL;
    bili=bili||(typeof UniversalBilibili!=='undefined'?UniversalBilibili:null);if(bili&&bili.page(sourceUrl))return bili.collect(env,sourceUrl);
    const found=new Map(),blockedFrames=[],seen=new Set();let blobCount=0;
    function safe(value,base){
      if(typeof value!=='string'||value.length>12000)return '';
      let s=value.trim().replace(/\\u002f/gi,'/').replace(/\\\//g,'/').replace(/&amp;/g,'&');
      if(/^https?%3a/i.test(s)){try{s=decodeURIComponent(s);}catch(_){return '';}}
      try{const u=new URL(s,base);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}
    }
    function add(value,where,label,base,declaredFile){
      if(typeof value==='string'&&value.startsWith('blob:')){blobCount++;return;}
      const url=safe(value,base||sourceUrl);if(!url)return;
      const type=/\.m3u8(?:$|[?#])/i.test(url)?'hls':/\.(mp4|webm|mov)(?:$|[?#])/i.test(url)||declaredFile?'file':'';
      if(!type)return;
      if(!found.has(url)&&found.size<50)found.set(url,{url,type,label:label||'视频',foundIn:[]});
      const item=found.get(url);if(item&&!item.foundIn.includes(where))item.foundIn.push(where);
    }
    function walk(value,where,depth,base){
      if(depth>7||!value)return;
      if(typeof value==='string'){add(value,where,'',base);return;}
      if(typeof value!=='object'||seen.has(value)||value.nodeType)return;
      seen.add(value);
      if(Array.isArray(value)){value.slice(0,100).forEach(v=>walk(v,where,depth+1,base));return;}
      for(const key of Object.keys(value).slice(0,200)){
        if(['__proto__','constructor','prototype','_owner','return'].includes(key))continue;
        try{walk(value[key],where,depth+1,base);}catch(_){}
      }
    }
    const documents=[{doc:firstDoc,win:env,base:sourceUrl}];
    for(let i=0;i<documents.length&&i<10;i++){
      const entry=documents[i],doc=entry.doc,win=entry.win,base=entry.base;
      for(const v of doc.querySelectorAll('video,audio')){
        add(v.currentSrc||v.getAttribute('src'),'播放器元素','当前播放',base,true);
        for(const source of v.querySelectorAll('source'))add(source.getAttribute('src'),'SOURCE 元素','',base,true);
      }
      for(const meta of doc.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]'))add(meta.content,'页面媒体声明','',base,true);
      for(const node of doc.querySelectorAll('a[href],video[data-src],[data-video-src],[data-m3u8]'))add(node.getAttribute('href')||node.getAttribute('data-src')||node.getAttribute('data-video-src')||node.getAttribute('data-m3u8'),'页面链接','',base);
      for(const name of ['s_video_plays','player_aaaa','player_data','__INITIAL_STATE__','_ROUTER_DATA','__NEXT_DATA__']){try{walk(win[name],'播放器数据',0,base);}catch(_){}}
      try{for(const r of win.performance.getEntriesByType('resource').slice(-2000))add(r.name,'已加载资源','',base);}catch(_){}
      for(const script of [...doc.scripts].slice(0,100)){
        if(script.src)continue;
        const text=(script.textContent||'').slice(0,1000000).replace(/\\u002f/gi,'/').replace(/\\\//g,'/');
        for(const value of text.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4|webm|mov)(?:\?[^\s"'<>\\]*)?/gi)||[])add(value,'页面脚本声明','',base);
      }
      for(const frame of doc.querySelectorAll('iframe')){
        try{const child=frame.contentDocument;if(child&&child.documentElement)documents.push({doc:child,win:frame.contentWindow,base:frame.contentWindow.location.href});else{const u=safe(frame.getAttribute('src'),base);if(u)blockedFrames.push(u);}}
        catch(_){const u=safe(frame.getAttribute('src'),base);if(u)blockedFrames.push(u);}
      }
    }
    const heading=firstDoc.querySelector('h1'),poster=firstDoc.querySelector('video[poster],meta[property="og:image"],img.detail-img,img[itemprop="image"]');
    return {format:'universal-extractor/1',sourceUrl,title:(heading&&heading.textContent.trim()||firstDoc.title||'网页视频').replace(/\s+/g,' ').slice(0,180),poster:poster?safe(poster.getAttribute('poster')||poster.getAttribute('content')||poster.getAttribute('src'),sourceUrl):'',capturedAt:Date.now(),media:[...found.values()],blockedFrames:[...new Set(blockedFrames)].slice(0,10),blobCount};
  }
  function makeBookmarklet(appUrl){
    const code='('+function(scan,app,bili){
      let data;try{data=scan(window,undefined,bili);}catch(e){alert(e.message);return;}const text=JSON.stringify(data),isBili=bili.page(location.href);
      const old=document.getElementById('universal-extractor-capture');if(old)old.remove();
      const panel=document.createElement('div');panel.id='universal-extractor-capture';
      panel.style.cssText='position:fixed;inset:20px 20px auto auto;width:min(430px,calc(100vw - 40px));padding:22px;background:white;color:#17221c;border:1px solid #dbe6df;box-shadow:0 10px 60px #0004;border-radius:18px;z-index:2147483647;font:14px/1.7 system-ui;text-align:left';
      const title=document.createElement('strong');title.textContent='万能提取 · 找到 '+data.media.length+' 个视频地址';title.style.fontSize='18px';panel.append(title);
      const desc=document.createElement('p');desc.textContent=data.media.length?(isBili?'点击“返回下载”，在万能提取中选择清晰度并导出带声音的 MP4。下载时请保持本页面打开。':'点击“返回下载”导入结果，或复制后粘贴到万能提取。'):'请先播放视频；B 站请等待播放器加载完成后重新采集。跨域播放器请在播放器页面单独采集。';panel.append(desc);
      const textarea=document.createElement('textarea');textarea.value=text;textarea.readOnly=true;textarea.style.cssText='box-sizing:border-box;width:100%;height:90px;border:1px solid #dbe6df;border-radius:8px;padding:8px;font:12px monospace';panel.append(textarea);
      function button(label,action){const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:12px 10px 0 0;background:#07a956;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;font:14px system-ui';b.onclick=action;panel.append(b);}
      button('复制结果',async()=>{try{await navigator.clipboard.writeText(text);desc.textContent='已复制，回到万能提取粘贴即可。';}catch(_){textarea.focus();textarea.select();desc.textContent='内容已选中，请使用复制快捷键。';}});
      if(/^https?:/i.test(app))button('返回下载',()=>{const target=window.open(app.split('#')[0]+'#import='+encodeURIComponent(text),'_blank',isBili?'':'noopener');if(isBili&&target)bili.serve(target,new URL(app).origin,data);if(isBili&&!target)desc.textContent='浏览器阻止了新窗口，请允许本次打开下载页后重试。';});
      button('关闭',()=>panel.remove());document.documentElement.append(panel);
    }.toString()+')('+collectPage.toString()+','+JSON.stringify(appUrl)+',('+B.source()+')());';
    return 'javascript:'+encodeURIComponent(code);
  }
  return {collectPage,makeBookmarklet};
});
