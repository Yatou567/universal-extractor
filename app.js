(() => {
  'use strict';
  const $ = id => document.getElementById(id), core = ShiguangCore;
  const installed = !!globalThis.chrome?.runtime?.id;
  const selections = new Map();
  function biliLinks(text) {
    return [...new Set((core.shareText(text).match(/https?:\/\/[^\s<>"']+/g) || []).map(s => s.replace(/[。！？，；）】),.;!?]+$/g, '').replace(/^http:/, 'https:')).filter(s => { try { return UniversalBilibili.page(s) || new URL(s).hostname === 'b23.tv'; } catch { return false; } }))];
  }
  let posts = [], downloads = [], busy = false, fingerprint = '', lastSource = null;
  const node = (tag, className, value) => { const e = document.createElement(tag); if (className) e.className = className; if (value !== undefined) e.textContent = value; return e; };
  const button = (label, className, action) => { const b = node('button', className, label); b.type = 'button'; b.addEventListener('click', action); return b; };
  async function send(message) {
    if (!installed) throw new Error('这是界面预览。请在 Chrome 扩展管理页加载插件后使用提取和下载。');
    const response = await chrome.runtime.sendMessage(message);
    if (!response) throw new Error('插件暂时没有响应，请刷新工作台后重试。');
    if (!response.ok) {
      const e = new Error(response.error || '操作失败'); Object.assign(e, response); throw e;
    }
    return response;
  }
  function status(message, type = '') { $('status').textContent = message; $('status').className = 'status ' + type; $('status').hidden = !message; }
  function setBusy(value) {
    busy = value;
    for (const id of ['parseButton', 'readTabButton', 'clearResults']) $(id).disabled = value || !installed;
    $('parseButton').textContent = value ? '正在提取…' : '提取媒体 ↗';
  }
  function selection(post) {
    if (!selections.has(post.key)) selections.set(post.key, new Set(post.assets.filter(a => a.role !== 'cover').map(a => a.id)));
    return selections.get(post.key);
  }
  function showPreview(post, a) {
    $('previewTitle').textContent = a.label || (a.kind === 'video' ? '视频预览' : `图片 ${a.index}`);
    $('previewBody').replaceChildren();
    const media = node(a.kind === 'video' ? 'video' : 'img');
    media.src = a.url;
    if (a.kind === 'video') { media.controls = true; media.preload = 'metadata'; }
    else { media.alt = post.title; media.referrerPolicy = 'no-referrer'; }
    media.addEventListener('error', () => { $('previewBody').append(node('p', '', '预览暂不可用。媒体地址可能已过期，请重新读取原作品。')); }, { once: true });
    $('previewBody').append(media);
    if (!post.demo) $('previewBody').append(node('p', '', '预览按需加载，下载时保存平台提供的媒体文件。'));
    $('preview').showModal();
  }
  async function openSource(post) {
    try { await send({ type: 'open-source', tabId: post.tabId, url: post.sourceUrl }); }
    catch (e) { status(e.message, 'error'); }
  }
  function renderPosts() {
    $('results').replaceChildren(); $('emptyState').hidden = posts.length > 0;
    $('resultCount').textContent = posts.length; $('clearResults').disabled = !posts.length || busy || !installed;
    for (const post of posts) {
      const selected = selection(post), section = node('article', 'post');
      const header = node('div', 'post-header');
      header.append(node('span', 'platform-icon ' + ({ xhs: 'xhs', douyin: 'dy', weixin: 'wx' }[post.platform] || ''), core.platformName(post.platform)));
      const info = node('div', 'post-info'); info.append(node('h3', '', post.title));
      const images = post.assets.filter(a => a.kind === 'image' && a.role !== 'cover').length, videos = post.assets.filter(a => a.kind === 'video').length;
      info.append(node('p', '', [post.author, images ? `${images} 张图片` : '', videos ? `${videos} 个视频` : '', post.demo ? '演示素材' : post.method === 'dom' ? '页面媒体' : '作品数据'].filter(Boolean).join(' · ')));
      header.append(info);
      const actions = node('div', 'post-actions');
      const original = button('打开原页面 ↗', 'text-button', () => openSource(post)); original.disabled = !!post.demo; actions.append(original);
      const remove = button('移除', 'text-button', async () => {
        if (!post.demo) try { await send({ type: 'remove-post', postKey: post.key }); } catch (e) { status(e.message, 'error'); return; }
        posts = posts.filter(x => x.key !== post.key); selections.delete(post.key); fingerprint = ''; renderPosts();
      }); actions.append(remove); header.append(actions); section.append(header);
      for (const warning of post.warnings || []) section.append(node('p', 'warning', warning));
      const gallery = node('div', 'gallery'), cards = new Map();
      for (const a of post.assets) {
        const card = node('div', 'media-card' + (selected.has(a.id) ? ' selected' : '')); cards.set(a.id, card);
        const label = node('label', 'media-select'), check = node('input'); check.type = 'checkbox'; check.checked = selected.has(a.id); check.setAttribute('aria-label', `选择${a.label || (a.kind === 'video' ? '视频' : '图片')} ${a.index}`);
        check.addEventListener('change', () => { check.checked ? selected.add(a.id) : selected.delete(a.id); updateSelection(); }); label.append(check); card.append(label);
        const thumb = button('', 'media-thumb', () => showPreview(post, a)); thumb.setAttribute('aria-label', `预览${a.label || (a.kind === 'video' ? '视频' : '图片')} ${a.index}`);
        const cover = post.assets.find(x => x.role === 'cover');
        const previewUrl = a.kind === 'image' ? a.url : cover?.url;
        if (previewUrl) {
          const img = node('img'); img.src = previewUrl; img.alt = a.kind === 'image' ? `图片 ${a.index}` : '视频封面'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
          img.addEventListener('error', () => { img.remove(); thumb.prepend(node('span', 'video-placeholder', a.kind === 'video' ? 'VIDEO' : '预览暂不可用')); }, { once: true }); thumb.append(img);
        } else thumb.append(node('span', 'video-placeholder', 'VIDEO'));
        if (a.kind === 'video') thumb.append(node('span', 'play-mark', '▶'));
        card.append(thumb);
        const caption = node('div', 'media-caption');
        caption.append(node('span', '', a.label || `${a.kind === 'video' ? '视频' : '图片'} ${String(a.index).padStart(2, '0')}`));
        caption.append(node('small', '', a.width && a.height ? `${a.width}×${a.height}` : core.extension(a.url, a.kind).toUpperCase())); card.append(caption); gallery.append(card);
      }
      section.append(gallery);
      const footer = node('div', 'post-footer'), controls = node('div', 'selection-actions');
      controls.append(button('全选', 'text-button', () => { post.assets.forEach(a => selected.add(a.id)); updateSelection(); }), button('取消全选', 'text-button', () => { selected.clear(); updateSelection(); }));
      const count = node('span', 'selection-count'); controls.append(count); footer.append(controls);
      const download = button('下载所选', 'primary', async () => {
        download.disabled = true;
        try {
          const result = await send({ type: 'download', postKey: post.key, assetIds: [...selected] });
          status(`${result.downloads.length} 个文件已加入下载${result.errors.length ? `，${result.errors.length} 个未能开始：${result.errors[0].error}` : '。可在下方查看进度。'}`, result.errors.length ? 'error' : '');
          await refresh();
        } catch (e) { status(e.message, 'error'); }
        finally { updateSelection(); }
      });
      download.disabled = !installed || !!post.demo; footer.append(download); section.append(footer);
      function updateSelection() {
        count.textContent = `已选 ${selected.size} 个`;
        download.textContent = `下载所选 (${selected.size}) ↙`; download.disabled = !selected.size || !installed || !!post.demo;
        for (const [id, card] of cards) { card.classList.toggle('selected', selected.has(id)); card.querySelector('input').checked = selected.has(id); }
      }
      updateSelection(); $('results').append(section);
    }
  }
  const size = n => n > 0 ? (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB') : '';
  const errors = { NOT_MEDIA: '平台返回的内容不是媒体，请重新读取作品。', EMPTY_FILE: '下载文件为空', SERVER_FORBIDDEN: '媒体地址过期或访问被拒绝，请重新读取。', SERVER_UNAUTHORIZED: '需要登录原平台', NETWORK_FAILED: '网络连接失败', NETWORK_TIMEOUT: '网络超时', USER_CANCELED: '已取消', FILE_NO_SPACE: '磁盘空间不足', FILE_BLOCKED: 'Chrome 阻止了此下载' };
  function renderDownloads() {
    $('downloads').replaceChildren(); $('historyCount').textContent = downloads.length;
    if (!downloads.length) { $('downloads').append(node('p', 'history-empty', '下载开始后，进度会出现在这里。')); return; }
    for (const d of downloads) {
      const row = node('div', 'download-row'), icon = node('span', 'download-icon', d.kind === 'video' ? '▷' : '▧'); row.append(icon);
      const info = node('div'); const title = node('p', 'download-title', d.title); title.title = d.title; info.append(title);
      const path = node('p', 'download-path', d.filename); path.title = d.filename; info.append(path);
      if (d.state === 'in_progress') { const progress = node('div', 'progress'), bar = node('span'); bar.style.width = d.totalBytes > 0 ? Math.min(100, d.bytesReceived / d.totalBytes * 100) + '%' : '15%'; progress.append(bar); info.append(progress); }
      row.append(info);
      const state = node('div', 'download-state' + (d.state === 'interrupted' ? ' failed' : ''));
      const label = d.state === 'complete' ? '已完成 ✓' : d.state === 'interrupted' ? (d.error === 'USER_CANCELED' ? '已取消' : '下载失败') : d.state === 'retrying' ? '切换备用地址' : '下载中';
      state.append(node('p', '', label)); if (d.state === 'in_progress') state.append(node('small', '', size(d.bytesReceived) + (d.totalBytes ? ' / ' + size(d.totalBytes) : '')));
      if (d.state === 'interrupted') {
        const reason = errors[d.error] || d.error || '请重新解析后下载';
        state.title = reason; info.append(node('p', 'download-error', reason));
      }
      row.append(state);
      const action = node('div', 'download-action');
      if (d.state === 'interrupted') action.append(button('重试', 'secondary', async event => {
        const retry = event.currentTarget; retry.disabled = true; retry.textContent = '处理中…';
        try { await send({ type: 'retry', downloadId: d.downloadId }); await refresh(); }
        catch (e) { status(e.message, 'error'); }
        finally { retry.disabled = false; retry.textContent = '重试'; }
      })); row.append(action); $('downloads').append(row);
    }
  }
  function renderTabs(tabs, sourceId) {
    const current = $('sourceTab').value;
    $('sourceTab').replaceChildren(new Option(tabs.length ? '选择已打开的作品页面' : '还没有已打开的作品页面', ''));
    for (const t of tabs) { const option = new Option((biliLinks(t.url).length ? 'B站' : core.platformName(core.platform(t.url))) + ' · ' + t.title.slice(0, 70), String(t.id)); option.dataset.url = t.url; $('sourceTab').add(option); }
    if (sourceId !== lastSource && tabs.some(t => t.id === sourceId)) $('sourceTab').value = String(sourceId);
    else if (tabs.some(t => String(t.id) === current)) $('sourceTab').value = current;
    else if (tabs.length) $('sourceTab').value = String(tabs[0].id);
    lastSource = sourceId;
  }
  async function refresh() {
    if (!installed) return;
    try {
      const result = await send({ type: 'state' });
      const nextFingerprint = result.posts.map(p => p.key + ':' + p.parsedAt).join('|');
      if (nextFingerprint !== fingerprint) {
        for (const p of result.posts) {
          const old = posts.find(x => x.key === p.key);
          if (old && old.parsedAt !== p.parsedAt) selections.delete(p.key);
        }
        posts = result.posts; fingerprint = nextFingerprint; renderPosts();
      }
      downloads = result.downloads; renderDownloads(); renderTabs(result.tabs, result.sourceTab);
      if (document.activeElement !== $('folder')) $('folder').value = result.settings.folder;
      $('folderHint').textContent = result.settings.folder; $('saveAs').checked = result.settings.saveAs;
    } catch (e) { if (!busy) status(e.message, 'error'); }
  }
  function addFailure(error, original) {
    const item = node('div', 'failure'), info = node('div'); info.append(node('p', '', error.message));
    const url = error.sourceUrl || original.url;
    if (url) { const link = node('small', '', url); link.title = url; info.append(link); }
    const actions = node('div');
    if (error.action === 'wechat-login') actions.append(button('登录腾讯元宝', 'secondary', loginWechat));
    if (error.tabId || url) actions.append(button('打开原页面', 'secondary', () => openSource({ tabId: error.tabId, sourceUrl: url })));
    actions.append(button('重新读取', 'secondary', async () => { item.remove(); await runParse([{ tabId: error.tabId || original.tabId, url }]); }));
    actions.append(button('×', 'icon-button', () => item.remove())); item.append(info, actions); $('failures').append(item);
  }
  async function runParse(inputs) {
    if (busy) return; setBusy(true); let success = 0;
    for (let i = 0; i < inputs.length; i++) {
      status(`正在提取第 ${i + 1} / ${inputs.length} 个作品，请稍候…`, 'busy');
      try { await send({ type: 'parse', ...inputs[i] }); success++; await refresh(); }
      catch (e) { addFailure(e, inputs[i]); }
    }
    setBusy(false); status(`提取完成：${success} 个成功${inputs.length > success ? `，${inputs.length - success} 个需要处理，可在上方打开原页面后重新读取。` : '。勾选文件即可下载。'}`, success < inputs.length ? 'error' : '');
    await refresh();
  }
  $('shareInput').addEventListener('input', () => { const n = core.links($('shareInput').value).length + biliLinks($('shareInput').value).length; $('linkCount').textContent = n ? `已识别 ${n} 个分享链接` : '自动识别文案中的链接'; });
  $('clearInput').addEventListener('click', () => { $('shareInput').value = ''; $('linkCount').textContent = '自动识别文案中的链接'; });
  $('parseButton').addEventListener('click', async () => {
    const urls = core.links($('shareInput').value);
    const bili = biliLinks($('shareInput').value);
    if (bili.length) {
      if (bili.length > 1 || urls.length) { status('B 站请一次输入一个视频链接，或使用左侧“B站与网页视频”。', 'error'); return; }
      try { await send({ type: 'open-video', url: bili[0] }); status('已打开 B 站下载页面，分析后可选择清晰度并导出完整 MP4。'); } catch (e) { status(e.message, 'error'); } return;
    }
    if (!urls.length) { status('请粘贴小红书、抖音或微信视频号的分享链接，也可以粘贴完整分享文案。', 'error'); return; }
    if (urls.length > 10) { status('一次最多提取 10 个链接，请分批添加。', 'error'); return; }
    await runParse(urls.map(url => ({ url })));
  });
  $('readTabButton').addEventListener('click', async () => {
    const id = Number($('sourceTab').value);
    if (!id) { status('请先在 Chrome 中打开具体作品页面，再刷新页面列表。', 'error'); return; }
    const url = $('sourceTab').selectedOptions[0]?.dataset.url;
    if (biliLinks(url).length) { try { await send({ type: 'open-video', url }); } catch (e) { status(e.message, 'error'); } return; }
    await runParse([{ tabId: id }]);
  });
  $('refreshTabs').addEventListener('click', refresh);
  async function loginWechat() {
    try { await send({ type: 'wechat-login' }); status('在腾讯元宝完成登录后，回到工作台点击“提取媒体”或“重新读取”。'); }
    catch (e) { status(e.message, 'error'); }
  }
  $('wechatLogin').addEventListener('click', loginWechat);
  $('clearResults').addEventListener('click', async () => { try { await send({ type: 'clear-results' }); selections.clear(); await refresh(); } catch (e) { status(e.message, 'error'); } });
  $('openFolder').addEventListener('click', async () => { try { await send({ type: 'show-downloads' }); } catch (e) { status(e.message, 'error'); } });
  async function saveSettings() { try { const r = await send({ type: 'settings', folder: $('folder').value, saveAs: $('saveAs').checked }); $('folder').value = r.settings.folder; $('folderHint').textContent = r.settings.folder; } catch (e) { status(e.message, 'error'); } }
  $('folder').addEventListener('change', saveSettings); $('saveAs').addEventListener('change', saveSettings);
  $('closePreview').addEventListener('click', () => $('preview').close());
  $('preview').addEventListener('close', () => { $('previewBody').replaceChildren(); });
  $('preview').addEventListener('click', e => { if (e.target === $('preview')) { const r = $('preview').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('preview').close(); } });
  if (!installed) {
    $('modeBadge').textContent = '○ 界面预览 · 未连接扩展';
    $('demoButton').hidden = false; $('refreshTabs').disabled = true; $('openFolder').disabled = true; $('folder').disabled = true; $('saveAs').disabled = true; $('wechatLogin').disabled = true;
    status('这是界面预览。实际提取与下载，请先在 Chrome 中加载扩展。');
    $('demoButton').addEventListener('click', () => {
      posts = [{ key: 'demo:gallery', platform: 'xhs', title: '把生活里小小的喜欢，存成一份灵感', author: '拾光 · 界面演示', demo: true, warnings: [], assets: [1, 2, 3, 4].map((i) => ({ id: 'image-' + i, kind: 'image', index: i, role: 'main', url: 'demo/' + i + '.svg', width: 600, height: 800 })) }]; renderPosts();
    });
  }
  setBusy(false); renderPosts(); refresh();
  setInterval(() => { if (installed && !document.hidden) refresh(); }, 2500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
