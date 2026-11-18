(function(){
  'use strict';
  const video=document.querySelector('#video'),overlay=document.querySelector('#overlay'),message=document.querySelector('#message'),button=document.querySelector('#play');let config,hls=null,recovered=false,starting=false,failed=false,autoplayTried=false;
  function show(text,label){message.textContent=text;overlay.hidden=false;button.hidden=!label;if(label){button.textContent=label;button.setAttribute('aria-label',label==='▶'?'播放视频':label);}}
  function fail(text){failed=true;show(text,'重试');}
  function release(){if(hls){hls.destroy();hls=null;}video.pause();video.removeAttribute('src');video.load();}
  function attempt(){
    if(starting||failed)return;starting=true;
    video.play().catch(e=>{if(e.name==='NotAllowedError')show('','▶');else if(e.name!=='AbortError')fail('视频暂时无法播放，请重试。');}).finally(()=>{starting=false;});
  }
  function load(){
    release();failed=false;recovered=false;autoplayTried=false;show('正在准备视频…');
    if(config.type==='hls'){
      if(video.canPlayType('application/vnd.apple.mpegurl')&&'ManagedMediaSource' in window)video.src=config.url;
      else if(window.Hls&&Hls.isSupported()){
        hls=new Hls({enableWorker:true,backBufferLength:20,maxBufferLength:20,maxMaxBufferLength:40,maxBufferSize:30*1024*1024});
        hls.on(Hls.Events.ERROR,(_,data)=>{
          if(!data.fatal)return;
          if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&!recovered){recovered=true;hls.recoverMediaError();return;}
          fail(data.type===Hls.ErrorTypes.NETWORK_ERROR?'视频源暂时无法访问。来源地址可能失效或限制了访问。':'当前浏览器暂时无法播放这个视频。');
          hls.destroy();hls=null;
        });
        hls.attachMedia(video);hls.loadSource(config.url);
      }else if(video.canPlayType('application/vnd.apple.mpegurl'))video.src=config.url;
      else fail('当前浏览器不支持此视频，请使用 Safari、Chrome 或 Edge。');
    }else video.src=config.url;
  }
  button.onclick=()=>{if(failed){load();return;}attempt();};
  video.addEventListener('canplay',()=>{if(!autoplayTried){autoplayTried=true;attempt();}});
  video.addEventListener('playing',()=>{overlay.hidden=true;message.textContent='';});
  video.addEventListener('error',()=>{if(!hls&&video.currentSrc&&!failed)fail('视频暂时无法播放。来源地址可能失效或限制了访问。');});
  function configure(){
    try{config=UniversalPlayerShare.read(location.hash,window.UNIVERSAL_PLAYER_DEFAULT);document.title=config.title;video.hidden=false;load();}
    catch(e){release();show(e.message);video.hidden=true;}
  }
  window.addEventListener('pagehide',release);
  window.addEventListener('hashchange',configure);
  window.addEventListener('pageshow',e=>{if(e.persisted)configure();});
  configure();
})();
