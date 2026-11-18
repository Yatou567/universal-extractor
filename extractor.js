/* The last expression is returned by chrome.scripting.executeScript in MAIN. */
(() => {
  const core = window.ShiguangCore, p = core.platform(location.href), id = core.postId(location.href);
  if (!p) return { issue: 'unsupported' };
  if (!id) return { issue: /\/login/.test(location.pathname) ? 'login' : 'no-detail', pageUrl: location.href };
  const roots = [];
  for (const key of ['__INITIAL_STATE__', '_ROUTER_DATA', '_SSR_DATA', '__INIT_PROPS__', '__NEXT_DATA__', '__UNIVERSAL_DATA_FOR_REHYDRATION__']) {
    try { if (window[key]) roots.push(window[key]); } catch { /* Accessor */ }
  }
  for (const node of document.querySelectorAll('script[type="application/json"],script#RENDER_DATA,script#__UNIVERSAL_DATA_FOR_REHYDRATION__')) {
    const value = node.textContent || '';
    if (value.length > 4000000) continue;
    try { roots.push(JSON.parse(value.startsWith('%') ? decodeURIComponent(value) : value)); } catch { /* Non-JSON */ }
  }
  const posts = roots.flatMap(root => core.extractPosts(root, p));
  const cached = window.__SHIGUANG_MEDIA_V1__?.posts || [];
  const matches = [...cached, ...posts].filter(post => post.id === id && post.platform === p);
  matches.sort((a, b) => b.assets.length - a.assets.length);
  if (matches.length) return { post: { ...matches[0], sourceUrl: location.href }, pageUrl: location.href };
  const visible = e => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const selectors = p === 'xhs' ? ['.note-detail-mask .note-container', '#noteContainer', '.note-container'] : ['[data-e2e="note-detail"]', '[data-e2e="video-detail"]', '[data-e2e="feed-active-video"]'];
  const container = selectors.flatMap(s => [...document.querySelectorAll(s)]).find(visible);
  const player = (container && (container.matches('.basePlayerContainer') ? container : container.querySelector('.basePlayerContainer'))) || (p === 'douyin' ? [...document.querySelectorAll('.basePlayerContainer')].find(visible) : null);
  // React player props are a fallback for already-open tabs that predate installation.
  for (const node of [container, player].filter(Boolean)) {
    for (const key of Object.keys(node).filter(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'))) {
      try {
        const value = node[key], data = key.startsWith('__reactFiber$') ? value.memoizedProps : value;
        const post = core.extractPosts(data, p).find(x => x.id === id);
        if (post) return { post: { ...post, sourceUrl: location.href }, pageUrl: location.href };
      } catch { /* Site component changes */ }
    }
  }
  const scope = player || container, assets = [], seen = new Set();
  const add = (kind, url, extras = {}) => {
    const normalized = core.mediaUrl(url, p);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    const a = core.asset(kind, [normalized], p, assets.filter(x => x.kind === kind).length + 1, { role: 'main', ...extras });
    if (a) assets.push(a);
  };
  if (scope) {
    // Specific slide containers exclude avatars, suggestions, icons and blur copies.
    const imgs = p === 'xhs' ? scope.querySelectorAll('.media-container img, .swiper-slide img, .img-container img') : scope.querySelectorAll('.dySwiperSlide img');
    for (const img of imgs) add('image', img.currentSrc || img.src || img.getAttribute('data-src'), { width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    if (!assets.length) for (const video of scope.querySelectorAll('video')) {
      // A src can exist before playback has loaded, or point to an error page.
      if (video.error || video.readyState < 1 || !(video.videoWidth > 0 && video.videoHeight > 0)) continue;
      const src = video.currentSrc || video.src || video.querySelector('source')?.src;
      // Douyin photo galleries use <video> for MP3 music. It is not a video asset.
      if (!/\.(mp3|m4a|aac|wav)(?:\?|$)/i.test(src || '')) add('video', src, { width: video.videoWidth || 0, height: video.videoHeight || 0 });
    }
  }
  if (assets.length) {
    const titleNode = document.querySelector(p === 'xhs' ? '#detail-title, .note-content .title' : '[data-e2e="video-desc"], [data-e2e="note-desc"], [data-e2e="video-detail"] h1');
    const title = (titleNode?.textContent || document.querySelector('meta[property="og:title"]')?.content || document.title || '作品').trim().slice(0, 180);
    const authorNode = document.querySelector(p === 'xhs' ? '.author-container .username' : '[data-e2e="video-author-name"]');
    return { pageUrl: location.href, post: { key: p + ':' + id, id, platform: p, title, description: title, author: authorNode?.textContent?.trim().slice(0, 120) || '未知作者', assets, method: 'dom', sourceUrl: location.href, warnings: ['当前结果来自页面媒体。图文可能受懒加载影响；如数量不完整，请在原页面翻完图片后重新读取。'] } };
  }
  const content = document.body?.innerText?.slice(0, 15000) || '';
  const issue = /已删除|作品不存在|笔记不存在|私密作品|暂时无法查看|无法展示/.test(content) ? 'unavailable' : /验证码|安全验证|完成验证|拖动滑块/.test(content) ? 'verification' : 'pending';
  return { issue, pageUrl: location.href, hasBlob: !!scope?.querySelector('video[src^="blob:"]') };
})();
