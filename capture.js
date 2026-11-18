/* Read only the media responses the site itself requests. No cookies are read. */
(() => {
  const name = '__SHIGUANG_MEDIA_V1__';
  if (window[name]) return;
  const core = window.ShiguangCore, p = core.platform(location.href);
  const cache = { posts: [], installedAt: Date.now() };
  Object.defineProperty(window, name, { value: cache, configurable: false });
  const relevant = url => {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin && (p === 'xhs' ? /\/api\/sns\/web\/v\d+\/feed(?:\?|$)/.test(u.pathname) : /\/aweme\/v\d+\/web\/(aweme\/detail|feed|tab\/feed)/.test(u.pathname));
    } catch { return false; }
  };
  const receive = data => {
    const posts = core.extractPosts(data, p);
    for (const post of posts) {
      cache.posts = cache.posts.filter(x => x.id !== post.id);
      cache.posts.push(post);
    }
    cache.posts = cache.posts.slice(-8);
  };
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = Reflect.apply(nativeFetch, this, args);
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    if (relevant(url)) promise.then(response => {
      if (response.ok && Number(response.headers.get('content-length') || 0) < 4000000) response.clone().json().then(receive).catch(() => {});
    }).catch(() => {});
    return promise;
  };
  const nativeOpen = XMLHttpRequest.prototype.open, tracked = new WeakSet();
  XMLHttpRequest.prototype.open = function (...args) {
    if (relevant(args[1]) && !tracked.has(this)) {
      tracked.add(this);
      this.addEventListener('load', () => {
        try {
          if (!relevant(this.responseURL) || this.status < 200 || this.status >= 300) return;
          if (this.responseType === 'json') receive(this.response);
          else if (!this.responseType || this.responseType === 'text') {
            if (this.responseText.length < 4000000) receive(JSON.parse(this.responseText));
          }
        } catch { /* Ignore non-JSON responses. */ }
      });
    }
    return Reflect.apply(nativeOpen, this, args);
  };
})();
