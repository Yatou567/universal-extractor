(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./media.js'):root.UniversalMedia);if(typeof module==='object'&&module.exports)module.exports=api;else root.UniversalPlayerShare=api;})(typeof globalThis!=='undefined'?globalThis:this,function(M){
  'use strict';
  function normalize(value){
    if(!value||value.format!=='universal-player/1'||!['hls','file'].includes(value.type))throw new Error('播放链接无效，请重新生成分享链接。');
    return {format:'universal-player/1',url:M.safeUrl(value.url),type:value.type,title:String(value.title||'视频播放').slice(0,180)};
  }
  function read(hash,fallback){
    if(!hash)return normalize(fallback);
    if(hash.length>18000||!hash.startsWith('#v='))throw new Error('播放链接无效，请重新生成分享链接。');
    try{return normalize(JSON.parse(decodeURIComponent(hash.slice(3))));}catch(_){throw new Error('播放链接无效，请重新生成分享链接。');}
  }
  function link(base,data){
    const u=new URL(M.safeUrl(base));u.hash='v='+encodeURIComponent(JSON.stringify(normalize(data)));return u.href;
  }
  function preview(base,data){const u=new URL('watch.html',base);u.hash='v='+encodeURIComponent(JSON.stringify(normalize(data)));return u.href;}
  function local(value){const host=new URL(value).hostname;return host==='localhost'||host==='[::1]'||/^127\./.test(host)||/^192\.168\./.test(host)||/^10\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||host.endsWith('.local');}
  return {normalize,read,link,preview,local};
});
