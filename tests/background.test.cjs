const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../lib/core.js');
const id = '6acc9819000000001a02137f', url = `https://www.xiaohongshu.com/explore/${id}?xsec_token=token=`;
const post = () => core.normalize({ noteId: id, type: 'normal', title: '真实作品', user: { nickname: '作者' }, imageList: [{ urlDefault: 'https://sns-webpic-qc.xhscdn.com/primary.webp', infoList: [{ url: 'https://sns-bak-v1.xhscdn.com/backup.webp' }] }] }, 'xhs');
function harness(options = {}) {
  const storage = {}, local = {}, tabs = options.tabs || [{ id: 7, windowId: 1, url, title: '真实作品', status: 'complete' }], created = [], calls = [], suggestions = [], items = new Map(), scripts = [];
  let time = 1791946800000, nextId = 30;
  const events = {};
  const event = name => ({ addListener(fn) { events[name] = fn; } });
  const store = data => ({
    async get(key) { return key === null ? { ...data } : typeof key === 'string' ? { [key]: data[key] } : Object.fromEntries(key.map(k => [k, data[k]])); },
    async set(values) { Object.assign(data, values); }, async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }
  });
  const chrome = {
    runtime: { id: 'test-extension', getURL: p => 'chrome-extension://test-extension/' + p, onMessage: event('message') },
    action: { onClicked: event('action') }, storage: { session: store(storage), local: store(local) },
    tabs: {
      async query() { return tabs; }, async get(tabId) { const t = tabs.find(t => t.id === tabId); if (!t) throw new Error('No tab with id'); return t; },
      async create(o) { const t = { id: 100 + created.length, windowId: 1, status: 'complete', url: options.redirect || o.url, title: '' }; tabs.push(t); created.push(o); return t; },
      async update(tabId, o) { return { ...(await this.get(tabId)), ...o }; }
    }, windows: { async update() {} },
    scripting: { async executeScript(config) { scripts.push(config); return options.script ? options.script(config, tabs) : [{ result: options.extract || { post: post(), pageUrl: url } }]; } },
    downloads: {
      onChanged: event('changed'), onDeterminingFilename: event('filename'),
      async download(o) {
        calls.push(o); const downloadId = nextId++;
        const result = options.responses?.[calls.length - 1] || { state: 'in_progress', mime: 'image/webp', bytesReceived: 100, totalBytes: 1000 };
        const item = { id: downloadId, url: o.url, filename: '/Downloads/' + o.filename, byExtensionId: 'test-extension', fileSize: 1000, ...result }; items.set(downloadId, item);
        events.filename(item, value => { suggestions.push(value); }); return downloadId;
      }, async search({ id }) { return items.has(id) ? [items.get(id)] : []; },
      async cancel(id) { items.get(id).state = 'interrupted'; }, async showDefaultFolder() {}
    }
  };
  class ClockDate extends Date { static now() { return time; } }
  function boot() {
    const context = vm.createContext({ chrome, console, URL, AbortSignal, fetch: options.fetch || (async () => { throw new Error('Unexpected fetch'); }), Date: ClockDate, setTimeout: (fn, ms) => { time += ms; return setImmediate(fn); }, clearTimeout, importScripts: () => vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/core.js'), 'utf8'), context) });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  }
  boot();
  const request = (message, sender = { id: 'test-extension', url: 'chrome-extension://test-extension/app.html' }) => new Promise(resolve => { const pending = events.message(message, sender, resolve); if (!pending) resolve(null); });
  return { request, storage, local, tabs, created, calls, suggestions, items, events, scripts, restart: boot };
}
test('parse reuses a loaded detail page, preserves share tokens, normalizes assets for later downloads', async () => {
  const h = harness(), result = await h.request({ type: 'parse', url });
  assert.equal(result.ok, true); assert.equal(result.post.sourceUrl, url); assert.equal(result.post.assets[0].id, 'image-0');
  assert.equal(h.created.length, 0); assert.ok(h.storage['post:xhs:' + id]);
});
test('B站作品页点击扩展图标时直接打开 MP4 工作台', async () => {
  const source = 'https://www.bilibili.com/video/BV1AC411x7np/';
  const h = harness({ tabs: [{ id: 7, url: source, status: 'complete' }] });
  await h.events.action({ id: 7, url: source });
  assert.equal(h.created.length, 1); assert.equal(h.created[0].active, true);
  assert.equal(h.created[0].url, 'chrome-extension://test-extension/video/index.html#source=' + encodeURIComponent(source));
  assert.equal((await h.request({ type: 'state' })).tabs[0].url, source);
});
test('B站入口只允许可信工作台打开指定平台页面', async () => {
  const h = harness();
  assert.equal((await h.request({ type: 'open-video', url: 'https://evil.test/' })).ok, false);
  assert.equal(await h.request({ type: 'open-video' }, { id: 'test-extension', url }), null);
  assert.equal(h.created.length, 0);
  assert.equal((await h.request({ type: 'open-video', url: 'https://b23.tv/abc123' })).ok, true);
  assert.match(h.created[0].url, /video\/index\.html#source=/);
});
test('short links use an inactive normal browser tab and resolve to exact redirected post', async () => {
  const h = harness({ redirect: url });
  const result = await h.request({ type: 'parse', url: 'https://xhslink.com/a/abc' });
  assert.equal(result.ok, true); assert.equal(h.created[0].active, false);
  assert.equal(result.post.id, id); assert.equal(result.post.sourceUrl, 'https://xhslink.com/a/abc');
});
const dyId = '7696130424288400827', dyUrl = `https://www.douyin.com/video/${dyId}`;
const dyPost = (name = 'fresh') => core.normalize({ aweme_id: dyId, desc: '当我带老爸上了出国的游轮', author: { nickname: '枫子大叔' }, video: { play_addr: { url_list: [`https://v3-web.douyinvod.com/${name}.mp4`], width: 1080, height: 1920 } } }, 'douyin');
test('slow Douyin page waits for structured data instead of accepting an early DOM address', async () => {
  let reads = 0;
  const early = { ...dyPost('temporary'), method: 'dom' };
  const h = harness({ tabs: [{ id: 7, url: dyUrl, status: 'complete' }], script() { reads++; return [{ result: { post: reads < 6 ? early : dyPost() } }]; } });
  const result = await h.request({ type: 'parse', url: String.raw`复制打开抖音 https\://www.douyin.com/video/7696130424288400827&#x20;` });
  assert.equal(result.ok, true); assert.equal(reads, 6); assert.equal(result.post.method, 'structured');
  assert.match(result.post.assets[0].url, /fresh\.mp4$/);
});
test('loaded Douyin DOM video remains available after the structured-data grace period', async () => {
  let reads = 0;
  const h = harness({ tabs: [{ id: 7, url: dyUrl, status: 'complete' }], script() { reads++; return [{ result: { post: { ...dyPost(), method: 'dom' } } }]; } });
  const result = await h.request({ type: 'parse', url: dyUrl });
  assert.equal(result.ok, true); assert.equal(result.post.method, 'dom'); assert.ok(reads >= 11);
});
test('Douyin document URL from an invalid DOM result never becomes a downloadable video', async () => {
  const invalid = dyPost(); invalid.assets[0].url = dyUrl;
  const h = harness({ tabs: [{ id: 7, url: dyUrl, status: 'complete' }], extract: { post: invalid } });
  assert.equal((await h.request({ type: 'parse', url: dyUrl })).ok, false);
  assert.equal(h.calls.length, 0); assert.ok(!h.storage['post:douyin:' + dyId]);
});
test('Douyin retry re-extracts the same work and downloads a fresh address', async () => {
  let reads = 0;
  const h = harness({ tabs: [{ id: 7, url: dyUrl, status: 'complete' }], script() { return [{ result: { post: dyPost(reads++ ? 'fresh' : 'expired') } }]; }, responses: [{ state: 'complete', mime: 'text/html' }, { state: 'complete', mime: 'video/mp4' }] });
  const result = await h.request({ type: 'parse', url: dyUrl });
  await h.request({ type: 'download', postKey: result.post.key, assetIds: [result.post.assets[0].id] });
  assert.equal(h.storage['download:30'].error, 'NOT_MEDIA');
  assert.equal((await h.request({ type: 'retry', downloadId: 30 })).ok, true);
  assert.match(h.calls[0].url, /expired\.mp4$/); assert.match(h.calls[1].url, /fresh\.mp4$/);
  assert.equal(h.storage['download:30'].supersededBy, 31); assert.equal(h.storage['download:31'].state, 'complete');
});
test('Douyin retry stops when refreshed work requires verification', async () => {
  let reads = 0;
  const h = harness({ tabs: [{ id: 7, url: dyUrl, status: 'complete' }], script() { return [{ result: reads++ ? { issue: 'verification' } : { post: dyPost() } }]; }, responses: [{ state: 'interrupted', mime: 'video/mp4', error: 'NETWORK_FAILED' }] });
  const r = await h.request({ type: 'parse', url: dyUrl });
  await h.request({ type: 'download', postKey: r.post.key, assetIds: [r.post.assets[0].id] });
  assert.equal((await h.request({ type: 'retry', downloadId: 30 })).ok, false);
  assert.equal(h.calls.length, 1);
});
test('login and missing detail report an actionable source tab; wrong post is never accepted', async () => {
  const h = harness({ extract: { issue: 'login' } });
  const result = await h.request({ type: 'parse', url }); assert.equal(result.ok, false); assert.equal(result.tabId, 7); assert.match(result.error, /登录/);
  const wrong = { ...post(), id: '6acb8300000000000a023432' };
  const mismatch = await harness({ extract: { post: wrong } }).request({ type: 'parse', url });
  assert.equal(mismatch.ok, false);
});
test('webpages cannot send privileged download requests; arbitrary URLs and asset IDs are rejected', async () => {
  const h = harness(); assert.equal(await h.request({ type: 'download' }, { id: 'test-extension', url }), null);
  const invalid = await h.request({ type: 'parse', url: 'https://evil.example/file' }); assert.equal(invalid.ok, false);
  await h.request({ type: 'parse', url });
  const result = await h.request({ type: 'download', postKey: 'xhs:' + id, assetIds: ['not-present'], url: 'https://evil.test/file' });
  assert.equal(result.ok, false); assert.equal(h.calls.length, 0);
});
test('download goes to a safe relative folder, MIME filename correction preserves the full directory', async () => {
  const h = harness({ responses: [{ state: 'complete', mime: 'image/jpeg', fileSize: 1000 }] });
  await h.request({ type: 'parse', url }); await h.request({ type: 'settings', folder: '../保存', saveAs: false });
  const result = await h.request({ type: 'download', postKey: 'xhs:' + id, assetIds: ['image-0'] });
  assert.equal(result.downloads.length, 1); assert.ok(!h.calls[0].filename.includes('..'));
  assert.match(h.suggestions[0].filename, /\/01_图片\.jpg$/); assert.ok(!h.suggestions[0].filename.startsWith('/'));
  assert.equal(h.storage['download:30'].state, 'complete');
});
test('failed CDN automatically tries a supplied backup; history hides superseded attempt', async () => {
  const h = harness({ responses: [{ state: 'interrupted', error: 'NETWORK_FAILED', mime: 'image/webp' }, { state: 'complete', mime: 'image/webp' }] });
  await h.request({ type: 'parse', url }); await h.request({ type: 'download', postKey: 'xhs:' + id, assetIds: ['image-0'] });
  assert.equal(h.calls.length, 2); assert.match(h.calls[1].url, /backup\.webp$/);
  const state = await h.request({ type: 'state' }); assert.equal(state.downloads.length, 1); assert.equal(state.downloads[0].state, 'complete');
});
test('user cancellation does not trigger automatic retry', async () => {
  const h = harness({ responses: [{ state: 'interrupted', error: 'USER_CANCELED', mime: 'image/webp' }] });
  await h.request({ type: 'parse', url }); await h.request({ type: 'download', postKey: 'xhs:' + id, assetIds: ['image-0'] });
  assert.equal(h.calls.length, 1); assert.equal(h.storage['download:30'].error, 'USER_CANCELED');
});
test('HTML login response and empty files cannot be reported as successful downloads', async () => {
  for (const response of [{ state: 'complete', mime: 'text/html' }, { state: 'complete', mime: 'image/webp', fileSize: 0 }]) {
    const note = post(); note.assets[0].alternatives = [];
    const h = harness({ extract: { post: note }, responses: [response] });
    await h.request({ type: 'parse', url }); await h.request({ type: 'download', postKey: 'xhs:' + id, assetIds: ['image-0'] });
    assert.equal(h.storage['download:30'].state, 'interrupted');
    assert.ok(['NOT_MEDIA', 'EMPTY_FILE'].includes(h.storage['download:30'].error));
  }
});
test('completion event after worker restart is reconciled from storage, independent of the UI', async () => {
  const h = harness(); await h.request({ type: 'parse', url }); await h.request({ type: 'download', postKey: 'xhs:' + id, assetIds: ['image-0'] });
  h.restart();
  h.items.get(30).state = 'complete'; h.items.get(30).bytesReceived = 1000;
  h.events.changed({ id: 30, state: { current: 'complete' } });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(h.storage['download:30'].state, 'complete');
  await h.request({ type: 'clear-results' }); assert.equal((await h.request({ type: 'state' })).downloads.length, 1);
});

const wxSource = 'https://weixin.qq.com/sph/A4MfAMbMob';
const wxPreview = 'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=export%2Fpreview123&token=session-token';
const wxFeed = { errCode: 0, data: { feedInfo: { description: '视频号作品', h264VideoInfo: { videoUrl: 'https://finder.video.qq.com/avc.mp4?sign=opaque' }, h265VideoInfo: { videoUrl: 'https://finder.video.qq.com/hevc.mp4' }, coverUrl: 'https://finder.video.qq.com/cover.jpg' }, authorInfo: { nickname: '作者' } } };
const wxPost = id => core.wechatPost(wxFeed, id);
function wxHarness({ issue, wrongId, encrypted, direct = false } = {}) {
  const probes = [];
  const h = harness({
    tabs: [{ id: 7, windowId: 1, url: direct ? wxPreview : wxSource, status: 'complete' }, { id: 8, windowId: 1, url: 'https://yuanbao.tencent.com/chat/example', status: 'complete' }],
    script(config) {
      if (config.files) return [];
      const [mode, , expected] = config.args;
      const result = mode === 'resolve' ? issue ? { issue } : { previewUrl: wxPreview }
        : expected === 'A4MfAMbMob' ? { issue: 'wechat-preview-required' } : { post: wxPost(wrongId ? 'export/another123' : expected) };
      return [{ result }];
    },
    fetch: async (url, options) => {
      probes.push({ url, options });
      const bytes = encrypted ? Buffer.alloc(64, 193) : Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');
      return new Response(bytes, { status: 206, headers: { 'Content-Type': 'video/mp4' } });
    },
    responses: [{ state: 'complete', mime: 'video/mp4', fileSize: 2048 }]
  });
  return { ...h, probes };
}
test('WeChat share resolves with the official session, binds export ID to share ID and downloads validated MP4', async () => {
  const h = wxHarness(), r = await h.request({ type: 'parse', url: wxSource });
  assert.equal(r.ok, true); assert.equal(r.post.id, 'A4MfAMbMob'); assert.equal(r.post.platform, 'weixin');
  assert.equal(r.post.sourceUrl, wxSource); assert.equal(h.created[0].url, wxPreview); assert.equal(h.created[0].active, false);
  assert.ok(h.scripts.every(s => s.world === 'ISOLATED')); assert.equal(h.probes.length, 2);
  assert.equal(h.probes[0].options.credentials, 'omit'); assert.equal(h.probes[0].options.headers.Range, 'bytes=0-63');
  await h.request({ type: 'download', postKey: r.post.key, assetIds: [r.post.assets[0].id] });
  assert.match(h.calls[0].filename, /微信视频号\/.+A4MfAMbMob\/01_视频\.mp4$/);
  assert.equal(h.storage['download:30'].state, 'complete');
});
test('WeChat official preview page can be read directly without resolving via Yuanbao again', async () => {
  const h = wxHarness({ direct: true }), r = await h.request({ type: 'parse', tabId: 7 });
  assert.equal(r.ok, true); assert.equal(r.post.id, 'export/preview123');
  assert.equal(h.created.length, 0); assert.ok(!h.scripts.some(s => s.args?.[0] === 'resolve'));
  assert.ok(!core.filename(r.post, r.post.assets[0], '下载').includes('export/'));
});
test('WeChat missing session presents a fixed official login action and retains the source for retry', async () => {
  const h = wxHarness({ issue: 'wechat-login' }), r = await h.request({ type: 'parse', url: wxSource });
  assert.equal(r.ok, false); assert.equal(r.action, 'wechat-login'); assert.equal(r.sourceUrl, wxSource);
  assert.match(r.error, /同一个 Chrome/); assert.equal(h.probes.length, 0);
  assert.equal((await h.request({ type: 'wechat-login', url: 'https://evil.example' })).ok, true);
  assert.equal(h.created.length, 0); assert.ok(!Object.keys(h.storage).some(k => k.startsWith('post:')));
});
test('WeChat mismatched feed IDs and encrypted bytes cannot become successful results', async () => {
  for (const options of [{ wrongId: true }, { encrypted: true }]) {
    const h = wxHarness(options), r = await h.request({ type: 'parse', url: wxSource });
    assert.equal(r.ok, false); assert.ok(!Object.keys(h.storage).some(k => k.startsWith('post:')));
    assert.equal(h.calls.length, 0);
  }
});
