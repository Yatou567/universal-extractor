importScripts('lib/core.js');
const core = ShiguangCore;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const issues = {
  login: '请在原页面登录小红书，然后点击“重新读取”。',
  verification: '平台要求验证。请打开原页面自行完成验证，再重新读取。',
  unavailable: '作品已删除、设为私密或当前账号无法访问。',
  'no-detail': '请打开具体的图文或视频作品页，再使用“读取作品页面”。',
  unsupported: '目前支持小红书、抖音和微信视频号的作品链接。',
  'wechat-login': '请在安装扩展的同一个 Chrome 配置文件中登录腾讯元宝，再点击“重新读取”。',
  'wechat-resolve': '元宝暂未返回有效的视频预览。请确认同一 Chrome 已登录腾讯元宝，再重新读取。',
  'wechat-network': '腾讯视频号接口暂时无法连接，请稍后重新读取。',
  'wechat-rate': '腾讯接口请求过于频繁，请稍后重新读取。',
  'wechat-no-video': '官方预览未提供完整视频，可能是图文、直播、已失效或当前账号无权查看的内容。',
  'wechat-media': '视频文件校验未通过。地址可能过期，或返回了加密数据，请重新读取。',
  'wechat-share-required': '请从微信视频号复制 weixin.qq.com/sph/ 开头的分享链接后提取。',
  pending: '暂未读到媒体。请打开原页面，等图片加载或视频播放后重新读取；安装插件前已打开的页面可先刷新一次。'
};
const retrying = new Set();
const pendingNames = new Map();
const yuanbaoUrl = 'https://yuanbao.tencent.com/';
const isYuanbao = url => { try { return new URL(url).origin === 'https://yuanbao.tencent.com'; } catch { return false; } };
function isBili(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && (/^(?:www\.|m\.)?bilibili\.com$/.test(u.hostname) && /^\/video\/(?:BV[0-9A-Za-z]{10}|av\d+)\/?$/.test(u.pathname) || u.hostname === 'b23.tv' && /^\/[A-Za-z0-9]+\/?$/.test(u.pathname)); } catch { return false; } }
async function openVideo(url) {
  if (url && !isBili(url)) throw new Error('B 站视频链接无效');
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('video/index.html') + (url ? '#source=' + encodeURIComponent(url) : ''), active: true });
  return { ok: true, tabId: tab.id };
}
function trustedSender(sender) {
  return sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL('app.html'));
}
async function openApp(tab) {
  if (isBili(tab?.url)) return openVideo(tab.url);
  if (tab?.id && core.platform(tab.url)) await chrome.storage.session.set({ sourceTab: tab.id });
  const url = chrome.runtime.getURL('app.html');
  const existing = (await chrome.tabs.query({ url: url + '*' }))[0];
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
}
chrome.action.onClicked.addListener(tab => openApp(tab).catch(console.error));

async function tabsList() {
  return (await chrome.tabs.query({})).filter(t => isBili(t.url) || core.platform(t.url) && core.postId(t.url)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)).map(t => ({ id: t.id, title: t.title || t.url, url: t.url }));
}
async function state() {
  const data = await chrome.storage.session.get(null);
  const downloads = Object.entries(data).filter(([k]) => k.startsWith('download:')).map(([, v]) => v).filter(v => !v.supersededBy).sort((a, b) => b.createdAt - a.createdAt).slice(0, 150);
  // Reconcile after a browser/worker pause, including events received before persistence.
  const current = await Promise.all(downloads.filter(d => d.state === 'in_progress').map(async d => {
    const items = await chrome.downloads.search({ id: d.downloadId });
    if (items[0]) {
      await reconcile(d.downloadId, items[0], false);
      return (await chrome.storage.session.get('download:' + d.downloadId))['download:' + d.downloadId];
    }
    return d;
  }));
  const updated = new Map(current.filter(Boolean).map(x => [x.downloadId, x]));
  return {
    posts: Object.entries(data).filter(([k]) => k.startsWith('post:')).map(([, v]) => v).sort((a, b) => b.parsedAt - a.parsedAt),
    downloads: downloads.map(d => updated.get(d.downloadId) || d), sourceTab: data.sourceTab,
    tabs: await tabsList(), settings: (await chrome.storage.local.get('settings')).settings || { folder: '万能提取', saveAs: false }
  };
}
function cleanPost(post, p, expected) {
  if (!post || post.platform !== p || post.id !== expected || !Array.isArray(post.assets)) return null;
  const assets = post.assets.slice(0, 120).map((a, i) => {
    if (!['image', 'video'].includes(a.kind)) return null;
    const validate = a.kind === 'video' ? core.videoUrl : core.mediaUrl;
    const url = validate(a.url, p);
    if (!url) return null;
    return { ...a, id: `${a.kind}-${i}`, url, alternatives: (a.alternatives || []).map(u => validate(u, p)).filter(Boolean).slice(0, 4), role: ['main', 'live', 'cover'].includes(a.role) ? a.role : 'main', index: Number.isInteger(a.index) && a.index > 0 ? a.index : i + 1, width: Number(a.width) || 0, height: Number(a.height) || 0 };
  }).filter(Boolean);
  if (!assets.length) return null;
  return { key: p + ':' + expected, id: expected, platform: p, title: typeof post.title === 'string' ? post.title.slice(0, 180) : '作品', author: typeof post.author === 'string' ? post.author.slice(0, 120) : '未知作者', description: typeof post.description === 'string' ? post.description.slice(0, 5000) : '', assets, method: post.method === 'dom' ? 'dom' : 'structured', warnings: post.method === 'dom' ? [assets.some(a => a.kind === 'video') ? '当前结果来自已加载的播放器。下载失败时点击“重试”，抖音作品会先重新提取最新地址。' : '当前结果来自页面媒体；如图片数量不完整，请翻完原页面图片后重新读取。'] : [] };
}
async function savePost(post, sourceUrl, pageUrl, tabId) {
  const value = { ...post, sourceUrl, pageUrl, tabId, parsedAt: Date.now() };
  const all = await chrome.storage.session.get(null);
  const old = Object.entries(all).filter(([k]) => k.startsWith('post:')).sort((a, b) => a[1].parsedAt - b[1].parsedAt);
  if (old.length >= 20 && !all['post:' + value.key]) await chrome.storage.session.remove(old.slice(0, old.length - 19).map(([k]) => k));
  await chrome.storage.session.set({ ['post:' + value.key]: value });
  return { ok: true, post: value };
}
async function wechatPage(tab, mode, expected, source) {
  const end = Date.now() + 18000;
  while (Date.now() < end) {
    const live = await chrome.tabs.get(tab.id);
    const matches = mode === 'resolve' ? isYuanbao(live.url) : core.platform(live.url) === 'weixin' && core.postId(live.url) === expected;
    if (matches && live.status === 'complete') {
      // Isolated world prevents page scripts from replacing the parser or fetch wrapper.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', files: ['lib/core.js', 'lib/wechat.js'] });
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'ISOLATED',
        func: async (mode, source, expected) => {
          const core = globalThis.ShiguangCore;
          if (mode === 'read' && core.postId(location.href) !== expected) return { issue: 'wechat-changed' };
          return mode === 'resolve' ? globalThis.ShiguangWechat.resolve(source) : globalThis.ShiguangWechat.read();
        }, args: [mode, source, expected]
      });
      const result = results[0]?.result;
      if (result) return { ...result, pageUrl: live.url };
    }
    await pause(500);
  }
  return { issue: 'wechat-network' };
}
async function probeWechatVideo(url) {
  if (!core.mediaUrl(url, 'weixin')) return false;
  let reader, response;
  try {
    const r = response = await fetch(url, { headers: { Range: 'bytes=0-63' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (![200, 206].includes(r.status) || /text\/|application\/(json|xhtml)/i.test(r.headers.get('content-type') || '')) return false;
    reader = r.body?.getReader();
    if (!reader) return false;
    const bytes = [];
    while (bytes.length < 12) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes.push(...value.slice(0, 64 - bytes.length));
    }
    return core.mp4Header(bytes);
  } catch { return false; }
  finally {
    if (reader) await reader.cancel().catch(() => {});
    else if (response?.body) await response.body.cancel().catch(() => {});
  }
}
async function parseWechat(source, tab) {
  const target = core.wechatTarget(source);
  const failure = (issue, extra = {}) => ({ ok: false, error: issues[issue] || '原页面已切换，请重新打开分享链接。', tabId: tab.id, sourceUrl: source, ...extra });
  if (!target) return failure('wechat-share-required');
  try {
    let mediaTab = tab, result = await wechatPage(tab, 'read', target.id, source);
    if (result.issue === 'unavailable') return failure('unavailable');
    if (!result.post) {
      if (!target.shortUri) return failure(result.issue === 'wechat-preview-required' ? 'wechat-share-required' : result.issue);
      let yuanbao = (await chrome.tabs.query({})).find(t => isYuanbao(t.url));
      if (!yuanbao) yuanbao = await chrome.tabs.create({ url: yuanbaoUrl, active: false });
      const resolved = await wechatPage(yuanbao, 'resolve', '', source);
      if (!resolved.previewUrl) return failure(resolved.issue, { action: ['wechat-login', 'wechat-resolve'].includes(resolved.issue) ? 'wechat-login' : undefined });
      const preview = core.wechatTarget(resolved.previewUrl);
      if (!preview?.exportId || !preview.token) return failure('wechat-resolve');
      mediaTab = (await chrome.tabs.query({})).find(t => t.url === resolved.previewUrl) || await chrome.tabs.create({ url: resolved.previewUrl, active: false });
      result = await wechatPage(mediaTab, 'read', preview.id, source);
      if (!result.post || result.post.id !== preview.id) return failure(result.issue || 'wechat-resolve');
    } else if (result.post.id !== target.id) return failure('wechat-changed');
    // Share short IDs and Tencent export IDs differ. Bind the feed only after matching the requested preview ID.
    const post = cleanPost({ ...result.post, id: target.id }, 'weixin', target.id);
    const video = post?.assets.find(a => a.kind === 'video');
    if (!video) return failure('wechat-no-video');
    const valid = [];
    for (const url of [video.url, ...video.alternatives].slice(0, 3)) if (await probeWechatVideo(url)) valid.push(url);
    if (!valid.length) return failure('wechat-media');
    video.url = valid[0]; video.alternatives = valid.slice(1);
    return await savePost(post, source, result.pageUrl, mediaTab.id);
  } catch (e) {
    return failure(/No tab with id/i.test(e.message) ? 'wechat-share-required' : 'wechat-network');
  }
}
async function parse({ url, tabId }) {
  let tab, source, p;
  if (Number.isInteger(tabId)) {
    tab = await chrome.tabs.get(tabId); source = tab.url; p = core.platform(source);
    if (!p) throw new Error(issues.unsupported);
  } else {
    const all = core.links(url);
    if (all.length !== 1) throw new Error('请输入一个有效的小红书、抖音或微信视频号分享链接。');
    source = all[0]; p = core.platform(source);
    const id = core.postId(source);
    tab = (await chrome.tabs.query({})).find(t => core.platform(t.url) === p && (t.url === source || (id && core.postId(t.url) === id)));
    if (!tab) tab = await chrome.tabs.create({ url: source, active: false });
  }
  if (p === 'weixin') return await parseWechat(source, tab);
  let last = { issue: 'pending' }, stable = '', stableCount = 0, targetId = core.postId(source);
  const started = Date.now(), end = started + 22000;
  while (Date.now() < end) {
    try {
      const live = await chrome.tabs.get(tab.id);
      if (core.platform(live.url) !== p) {
        last = { issue: 'pending' };
        await pause(700); continue;
      }
      const liveId = core.postId(live.url);
      if (targetId && liveId && targetId !== liveId) return { ok: false, error: '原页面切换到了另一条作品，请重新打开目标链接。', tabId: tab.id, sourceUrl: source };
      if (!targetId && liveId) targetId = liveId;
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['lib/core.js', 'extractor.js'] });
      last = results[0]?.result || { issue: 'pending' };
      const post = cleanPost(last.post, p, targetId);
      if (post) {
        const fingerprint = post.assets.map(a => a.url).join('|');
        stableCount = stable === fingerprint ? stableCount + 1 : 0; stable = fingerprint;
        const waitingForData = p === 'douyin' && post.assets.some(a => a.kind === 'video') && (live.status !== 'complete' || Date.now() - started < 8000);
        if (post.method === 'structured' || stableCount >= 2 && !waitingForData) {
          return await savePost(post, source, live.url, tab.id);
        }
      }
      if (['login', 'verification', 'unavailable'].includes(last.issue)) return { ok: false, error: issues[last.issue], tabId: tab.id, sourceUrl: source };
    } catch (e) {
      if (/No tab with id/i.test(e.message)) return { ok: false, error: '作品页面已关闭，请重新打开链接。', sourceUrl: source };
      last = { issue: 'pending' };
    }
    await pause(800);
  }
  return { ok: false, error: issues[last.issue] || issues.pending, tabId: tab.id, sourceUrl: source };
}

const mimeExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const mediaMismatch = (item, record) => {
  const mime = (item.mime || '').split(';')[0].toLowerCase();
  return /^(text\/|application\/(json|xhtml\+xml))/.test(mime) || (record.kind === 'video' && /^(image|audio)\//.test(mime)) || (record.kind === 'image' && /^(audio|video)\//.test(mime));
};
async function downloadOne(post, asset, settings, attempt = 0, previousId = null) {
  const validate = asset.kind === 'video' ? core.videoUrl : core.mediaUrl;
  const urls = [asset.url, ...(asset.alternatives || [])].filter(u => validate(u, post.platform));
  const url = urls[attempt];
  if (!url) throw new Error('可用媒体地址已用完，请重新解析作品。');
  const filename = core.filename(post, { ...asset, url }, settings.folder);
  pendingNames.set(url, filename);
  if (pendingNames.size > 500) pendingNames.delete(pendingNames.keys().next().value);
  const downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: !!settings.saveAs });
  const record = { downloadId, postKey: post.key, assetId: asset.id, title: post.title, kind: asset.kind, filename, relativeFilename: filename, attempt, state: 'in_progress', bytesReceived: 0, totalBytes: 0, createdAt: Date.now(), settings };
  await chrome.storage.session.set({ ['download:' + downloadId]: record });
  if (previousId !== null) {
    const key = 'download:' + previousId, previous = (await chrome.storage.session.get(key))[key];
    if (previous) await chrome.storage.session.set({ [key]: { ...previous, supersededBy: downloadId } });
  }
  const items = await chrome.downloads.search({ id: downloadId });
  if (items[0]) await reconcile(downloadId, items[0], true);
  return downloadId;
}
async function reconcile(id, item, autoRetry) {
  const key = 'download:' + id, record = (await chrome.storage.session.get(key))[key];
  if (!record || record.supersededBy || record.state === 'retrying') return;
  let status = item.state, error = item.error || '';
  if (mediaMismatch(item, record)) { status = 'interrupted'; error = 'NOT_MEDIA'; if (item.state === 'in_progress') await chrome.downloads.cancel(id).catch(() => {}); }
  if (item.state === 'complete' && item.fileSize === 0) { status = 'interrupted'; error = 'EMPTY_FILE'; }
  const next = { ...record, state: status, error, bytesReceived: item.bytesReceived || 0, totalBytes: item.totalBytes > 0 ? item.totalBytes : 0, filename: item.filename || record.filename };
  await chrome.storage.session.set({ [key]: next });
  if (!autoRetry || status !== 'interrupted' || ['USER_CANCELED', 'USER_SHUTDOWN', 'FILE_NO_SPACE', 'FILE_ACCESS_DENIED', 'FILE_BLOCKED', 'FILE_VIRUS_INFECTED', 'FILE_SECURITY_CHECK_FAILED'].includes(error) || retrying.has(id)) return;
  const post = (await chrome.storage.session.get('post:' + record.postKey))['post:' + record.postKey];
  const a = post?.assets.find(x => x.id === record.assetId);
  if (!a || record.attempt >= Math.min(a.alternatives.length, 2) || retrying.has(id)) return;
  retrying.add(id);
  try {
    await chrome.storage.session.set({ [key]: { ...next, state: 'retrying' } });
    await downloadOne(post, a, record.settings, record.attempt + 1, id);
  } catch (e) { await chrome.storage.session.set({ [key]: { ...next, error: e.message } }); }
  finally { retrying.delete(id); }
}
chrome.downloads.onChanged.addListener(delta => {
  if (!delta.state && !delta.error && !delta.bytesReceived) return;
  chrome.downloads.search({ id: delta.id }).then(items => items[0] && reconcile(delta.id, items[0], true)).catch(console.error);
});
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // The browser's MIME type is authoritative; don't disguise WebP as JPEG.
  const ext = mimeExtensions[(item.mime || '').split(';')[0]], owned = item.byExtensionId === chrome.runtime.id;
  const requested = pendingNames.get(item.url);
  if (owned && ext && requested) suggest({ filename: requested.replace(/\.[^.\/\\]+$/, '.' + ext), conflictAction: 'uniquify' });
  else if (owned && ext) {
    chrome.storage.session.get('download:' + item.id).then(data => {
      const relative = data['download:' + item.id]?.relativeFilename;
      if (relative) suggest({ filename: relative.replace(/\.[^.\/\\]+$/, '.' + ext), conflictAction: 'uniquify' });
      else suggest();
    }).catch(() => suggest());
    return true;
  } else suggest();
});

async function handle(message) {
  switch (message.type) {
    case 'open-video': return await openVideo(message.url);
    case 'state': return { ok: true, ...(await state()) };
    case 'parse': return await parse(message);
    case 'wechat-login': {
      const existing = (await chrome.tabs.query({})).find(t => isYuanbao(t.url));
      const tab = existing ? await chrome.tabs.update(existing.id, { active: true }) : await chrome.tabs.create({ url: yuanbaoUrl, active: true });
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true };
    }
    case 'open-source': {
      if (Number.isInteger(message.tabId)) {
        try { const t = await chrome.tabs.get(message.tabId); if (core.platform(t.url)) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); return { ok: true }; } } catch { /* Closed tab; reopen source. */ }
      }
      const url = core.links(message.url)[0]; if (!url) throw new Error('分享链接无效。');
      const tab = await chrome.tabs.create({ url, active: true }); return { ok: true, tabId: tab.id };
    }
    case 'settings': {
      const settings = { folder: core.safeSegment(message.folder, '万能提取', 40), saveAs: !!message.saveAs };
      await chrome.storage.local.set({ settings }); return { ok: true, settings };
    }
    case 'download': {
      const post = (await chrome.storage.session.get('post:' + message.postKey))['post:' + message.postKey];
      if (!post) throw new Error('解析结果已过期，请重新读取作品。');
      const ids = new Set(Array.isArray(message.assetIds) ? message.assetIds.slice(0, 120) : []);
      const assets = post.assets.filter(a => ids.has(a.id)); if (!assets.length) throw new Error('请先勾选要下载的文件。');
      const settings = (await chrome.storage.local.get('settings')).settings || { folder: '万能提取', saveAs: false };
      const downloads = [], errors = [];
      for (const a of assets) {
        try { downloads.push(await downloadOne(post, a, settings)); }
        catch (e) { errors.push({ assetId: a.id, error: e.message }); }
        await pause(70);
      }
      return { ok: true, downloads, errors };
    }
    case 'retry': {
      const key = 'download:' + Number(message.downloadId), d = (await chrome.storage.session.get(key))[key];
      if (!d || d.state !== 'interrupted') throw new Error('只能重试失败的下载。');
      let post = (await chrome.storage.session.get('post:' + d.postKey))['post:' + d.postKey];
      let asset = post?.assets.find(a => a.id === d.assetId);
      if (!asset) throw new Error('请先重新解析原作品，再下载。');
      if (post.platform === 'douyin') {
        // Refresh signed/temporary URLs instead of repeating the failed address.
        const original = asset, expected = post.id;
        const result = await parse({ url: core.postId(post.pageUrl) === expected ? post.pageUrl : post.sourceUrl });
        if (!result.ok) return result;
        if (result.post.id !== expected) throw new Error('原链接已切换作品，请重新提取。');
        post = result.post;
        asset = post.assets.find(a => a.kind === original.kind && a.role === original.role && a.index === original.index);
        if (!asset) throw new Error('重新提取后未找到该文件，请重新选择下载内容。');
      }
      return { ok: true, downloadId: await downloadOne(post, asset, d.settings, 0, d.downloadId) };
    }
    case 'show-downloads': await chrome.downloads.showDefaultFolder(); return { ok: true };
    case 'remove-post': await chrome.storage.session.remove('post:' + message.postKey); return { ok: true };
    case 'clear-results': {
      const data = await chrome.storage.session.get(null);
      await chrome.storage.session.remove(Object.keys(data).filter(k => k.startsWith('post:'))); return { ok: true };
    }
    default: throw new Error('未知操作。');
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!trustedSender(sender)) return false;
  handle(message || {}).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message || '操作失败，请重试。' }));
  return true;
});
