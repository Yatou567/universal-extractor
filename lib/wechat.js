/* Fixed Tencent endpoints, using the page's own session. No Cookie export. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ShiguangWechat = factory(root.ShiguangCore);
})(globalThis, function (core) {
  'use strict';
  async function request(url, body, env) {
    const response = await env.fetch(url, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
    });
    if ([401, 403].includes(response.status)) return { issue: 'wechat-login' };
    if (response.status === 429) return { issue: 'wechat-rate' };
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 4000000) return { issue: 'wechat-network' };
    return { data: await response.json() };
  }
  async function resolve(shareUrl, env = globalThis) {
    const source = core.wechatTarget(shareUrl);
    if (!source?.shortUri || new URL(env.location.href).origin !== 'https://yuanbao.tencent.com') return { issue: 'unsupported' };
    try {
      const r = await request('/api/weixin/get_parse_result', { type: 'video_channel_url', url: 'https://weixin.qq.com/sph/' + source.shortUri, scene: 1 }, env);
      if (r.issue) return r;
      const data = r.data, previewUrl = core.wechatPreview(data);
      if (previewUrl) return { previewUrl };
      const message = String(data?.msg || data?.message || data?.error?.message || '');
      if (/登录|login|auth|session|未授权|身份/i.test(message)) return { issue: 'wechat-login' };
      if (/频繁|限流|次数|quota|rate/i.test(message)) return { issue: 'wechat-rate' };
      if (/删除|私密|不存在|无权|失效/.test(message)) return { issue: 'unavailable' };
      return { issue: 'wechat-resolve' };
    } catch { return { issue: 'wechat-network' }; }
  }
  async function read(env = globalThis) {
    const page = new URL(env.location.href), target = core.wechatTarget(page.href);
    if (page.origin !== 'https://channels.weixin.qq.com' || !target) return { issue: 'unsupported' };
    if (target.exportId && !target.token) return { issue: 'wechat-preview-required' };
    try {
      const api = new URL('/finder-preview/api/feed/get_feed_info', page.origin);
      // The official frontend sends these middleware parameters; _pageUrl excludes credentials.
      api.searchParams.set('_rid', Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 10));
      api.searchParams.set('_pageUrl', page.origin + page.pathname);
      const r = await request(api.href, { baseReq: { generalToken: target.token || '' }, ...(target.shortUri ? { shortUri: target.shortUri } : { exportId: target.exportId }) }, env);
      if (r.issue) return r.issue === 'wechat-login' ? { issue: 'wechat-preview-required' } : r;
      const data = r.data;
      if (data?.errCode !== 0) return { issue: 'wechat-preview-required' };
      const message = String(data.data?.errMsg?.title || '') + String(data.data?.errMsg?.content || '');
      if (/删除|私密|不存在|无权|无法查看/.test(message)) return { issue: 'unavailable' };
      const post = core.wechatPost(data, target.id);
      return post ? { post } : { issue: target.shortUri ? 'wechat-preview-required' : 'wechat-no-video' };
    } catch { return { issue: 'wechat-network' }; }
  }
  return Object.freeze({ resolve, read });
});
