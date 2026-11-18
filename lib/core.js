/* Shared, dependency-free parser. Page code never receives extension privileges. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShiguangCore = api;
})(globalThis, function () {
  'use strict';
  const siteDomains = { xhs: ['xiaohongshu.com', 'xhslink.com'], douyin: ['douyin.com', 'iesdouyin.com'] };
  const mediaDomains = {
    xhs: ['xhscdn.com', 'xiaohongshu.com'],
    douyin: ['douyinpic.com', 'douyinvod.com', 'douyincdn.com', 'douyinstatic.com', 'byteimg.com', 'ibytedtos.com', 'bytedance.com', 'bytedance.net', 'bytecdn.cn', 'pstatp.com', 'ixigua.com', 'snssdk.com', 'amemv.com', 'iesdouyin.com', 'douyin.com'],
    weixin: ['video.qq.com', 'qpic.cn', 'wxapp.tc.qq.com']
  };
  const belongs = (host, domains) => domains.some(d => host === d || host.endsWith('.' + d));
  function platform(url) {
    try {
      const u = new URL(url);
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return null;
      if (wechatTarget(url)) return 'weixin';
      return Object.keys(siteDomains).find(p => belongs(u.hostname, siteDomains[p])) || null;
    } catch { return null; }
  }
  function shareText(value) {
    // Some share sheets escape the scheme and append HTML-encoded whitespace.
    // Do not decode URL parameters: their original bytes may be signed.
    return String(value || '').replace(/\b(https?)\\?:(?:\\?\/){2}/gi, '$1://')
      .replace(/&amp;/gi, '&').replace(/&(?:nbsp|#0*(?:9|10|13|32|160)|#x0*(?:9|a|d|20|a0));/gi, ' ');
  }
  function links(text) {
    const found = shareText(text).match(/https?:\/\/[^\s<>"'\u3000]+/gi) || [];
    const urls = found.map(s => s.replace(/[\u3002\uff0c\uff1b\uff01\uff1f\uff09\u3011\uff1e\u201d\u2019),.;!?]+$/g, ''))
      .filter(s => platform(s)).map(s => s.replace(/^http:/i, 'https:'));
    return [...new Set(urls)];
  }
  function postId(url) {
    try {
      const u = new URL(url), p = platform(url);
      if (p === 'weixin') return wechatTarget(url).id;
      const match = p === 'xhs' ? u.pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]{24})(?:\/|$)/i)
        : u.pathname.match(/\/(?:share\/)?(?:video|note|slides)\/(\d{10,25})(?:\/|$)/);
      if (match) return match[1];
      const modal = u.searchParams.get('modal_id');
      return p === 'douyin' && /^\d{10,25}$/.test(modal || '') ? modal : '';
    } catch { return ''; }
  }
  const platformName = p => ({ xhs: '小红书', douyin: '抖音', weixin: '微信视频号' })[p] || '作品';
  function wechatTarget(url) {
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
      const short = u.hostname === 'weixin.qq.com' ? u.pathname.match(/^\/sph\/([a-zA-Z0-9_-]{6,128})\/?$/)?.[1]
        : u.hostname === 'channels.weixin.qq.com' && u.pathname === '/finder-preview/pages/sph' ? u.searchParams.get('id') : '';
      if (/^[a-zA-Z0-9_-]{6,128}$/.test(short || '')) return { id: short, shortUri: short };
      if (u.hostname !== 'channels.weixin.qq.com' || u.pathname !== '/finder-preview/pages/feed') return null;
      const exportId = u.searchParams.get('eid') || '';
      if (!/^(?:export\/)?[a-zA-Z0-9_-]{6,512}$/.test(exportId)) return null;
      return { id: exportId, exportId, token: (u.searchParams.get('token') || '').slice(0, 8000) };
    } catch { return null; }
  }
  function wechatPreview(data) {
    if (data?.code !== 0 || typeof data.data?.playable_url !== 'string') return '';
    try {
      const u = new URL(data.data.playable_url), target = wechatTarget(u.href);
      if (u.protocol !== 'https:' || !target?.exportId || !target.token || target.token.length > 6000) return '';
      return u.href;
    } catch { return ''; }
  }
  function wechatPost(response, id) {
    if (!/^(?:export\/)?[a-zA-Z0-9_-]{6,512}$/.test(id || '') || response?.errCode !== 0) return null;
    const data = response.data, feed = data?.feedInfo;
    if (!feed || typeof feed !== 'object') return null;
    // Only official browser preview streams. Raw object_desc.media URLs may be encrypted.
    const encrypted = v => [v.decodeKey, v.decode_key, v.decryptKey].some(k => k && k !== '0') || v.isEncrypted === true;
    const infos = [feed.h264VideoInfo, feed.h265VideoInfo].filter(v => v && !encrypted(v));
    // A feed-level decodeKey can belong to originVideoUrl, not the browser preview streams.
    // The worker checks the actual bytes of each preview before accepting it.
    const video = asset('video', infos.map(v => v.videoUrl), 'weixin', 1, { role: 'main' });
    if (!video) return null;
    const first = infos.find(v => mediaUrl(v.videoUrl, 'weixin') === video.url);
    video.width = Number(first?.width) || 0; video.height = Number(first?.height) || 0;
    const cover = asset('image', [feed.coverUrl], 'weixin', 1, { role: 'cover', label: '视频封面' });
    return { key: 'weixin:' + id, id, platform: 'weixin', title: text(feed.description || '视频号视频', 180), description: text(feed.description), author: text(data.authorInfo?.nickname || '视频号作者', 120), assets: [video, cover].filter(Boolean), expectedImages: 0, method: 'structured', warnings: [] };
  }
  function mp4Header(bytes) {
    if (!bytes || bytes.length < 12) return false;
    const size = bytes[0] * 16777216 + bytes[1] * 65536 + bytes[2] * 256 + bytes[3];
    return size >= 16 && size <= 4096 && String.fromCharCode(...Array.from(bytes).slice(4, 8)) === 'ftyp';
  }
  function mediaUrl(value, p) {
    if (typeof value !== 'string' || value.length > 12000) return '';
    let s = value.trim().replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
    if (s.startsWith('//')) s = 'https:' + s;
    try {
      const u = new URL(s);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || !belongs(u.hostname, mediaDomains[p] || [])) return '';
      if (u.protocol === 'http:') u.protocol = 'https:';
      return u.href;
    } catch { return ''; }
  }
  function videoUrl(value, p) {
    const url = mediaUrl(value, p);
    if (!url) return '';
    const u = new URL(url);
    if (/\.(m4s|m3u8|mpd|mp3|m4a|aac|wav|html?)(?:$|[!~:])/i.test(u.pathname)) return '';
    // Website pages and share redirects are not downloadable video endpoints.
    if (p === 'douyin' && belongs(u.hostname, siteDomains.douyin) && !/^\/aweme\/v\d+\/play(?:wm)?\/?$/i.test(u.pathname)) return '';
    if (postId(url)) return '';
    return url;
  }
  function urls(value, p) {
    const out = [], seen = new WeakSet();
    function walk(v, depth) {
      if (depth > 5 || out.length > 30) return;
      if (typeof v === 'string') { const u = mediaUrl(v, p); if (u) out.push(u); }
      else if (v && typeof v === 'object' && !seen.has(v)) {
        seen.add(v);
        if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
        else ['masterUrl', 'master_url', 'url', 'urlDefault', 'url_default', 'urlList', 'url_list', 'backupUrls', 'backup_urls'].forEach(k => walk(v[k], depth + 1));
      }
    }
    walk(value, 0); return [...new Set(out)];
  }
  function json(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return null; }
  }
  function text(value, max = 5000) { return typeof value === 'string' ? value.slice(0, max) : ''; }
  function asset(kind, values, p, index, extras = {}) {
    const list = [...new Set(values.flatMap(v => urls(v, p)))].filter(u => kind !== 'video' || videoUrl(u, p));
    return list.length ? { id: `${kind}-${extras.role || 'main'}-${index}`, kind, url: list[0], alternatives: list.slice(1, 5), index, ...extras } : null;
  }
  function streams(video, p) {
    const v = json(video) || {}, media = json(v.media) || {}, mediaV2 = json(v.mediaV2) || {};
    const candidates = [];
    for (const stream of [media.stream, v.stream, mediaV2.stream]) {
      for (const [codec, list] of Object.entries(stream || {})) {
        if (!Array.isArray(list)) continue;
        for (const s of list) {
          // Fragmented XHS .m4s streams can be video-only; a rename cannot mux audio.
          const master = s.masterUrl || s.master_url || '';
          if (/\.(m4s|m3u8|mpd)(?:\?|$)/i.test(master) || /fmp4|dash|hls/i.test(s.format || '')) continue;
          candidates.push({ data: s, codec: s.videoCodec || s.video_codec || codec, width: s.width, height: s.height, rate: s.avgBitrate || s.avg_bitrate || s.videoBitrate || s.bitrate || 0 });
        }
      }
    }
    for (const s of v.bit_rate || v.bitRate || []) candidates.push({ data: s.play_addr || s.playAddr, codec: s.is_h265 || s.isH265 ? 'h265' : s.codec_type || 'h264', width: s.play_addr?.width || s.playAddr?.width, height: s.play_addr?.height || s.playAddr?.height, rate: s.bit_rate || s.bitRate || 0 });
    candidates.sort((a, b) => {
      const compatible = c => /h264|avc|264|^EF4$/i.test(c || '') ? 1 : 0;
      return compatible(b.codec) - compatible(a.codec) || ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)) || b.rate - a.rate;
    });
    const output = candidates.map(s => s.data);
    if (p === 'douyin') output.push(v.play_addr_h264, v.playAddrH264, v.play_addr, v.playAddr, v.download_addr, v.downloadAddr);
    else {
      const opaque = json(mediaV2.opaque1) || {};
      output.push(opaque.hd_screencast_stream, opaque.default_screencast_stream, v.url, v.masterUrl);
      const key = v.consumer?.originVideoKey || v.consumer?.origin_video_key || mediaV2.consumer?.originVideoKey;
      if (typeof key === 'string' && /^[a-zA-Z\d_\-/\.]+$/.test(key) && !key.includes('..')) output.push('https://sns-video-bd.xhscdn.com/' + key);
    }
    return output;
  }
  function normalize(note, p) {
    if (!['xhs', 'douyin'].includes(p)) return null;
    if (!note || typeof note !== 'object') return null;
    const id = String(p === 'xhs' ? note.noteId || note.note_id || note.id || '' : note.aweme_id || note.awemeId || '');
    if (!(p === 'xhs' ? /^[a-f\d]{24}$/i : /^\d{10,25}$/).test(id)) return null;
    const images = p === 'xhs' ? note.imageList || note.image_list || [] : note.image_post_info?.images || note.image_post_info?.image_list || note.imagePostInfo?.images || note.imagePostInfo?.imageList || note.images || note.image_list || note.imageList || [];
    const assets = [], mainVideo = streams(note.video, p);
    const videoNote = p === 'xhs' ? note.type === 'video' || mainVideo.some(v => urls(v, p).length) : !images.length;
    if (!videoNote && Array.isArray(images)) images.slice(0, 100).forEach((img, i) => {
      let values;
      if (p === 'xhs') {
        const infos = [...(img.infoList || img.info_list || [])].sort((a, b) => (b.imageScene === 'WB_DFT' ? 1 : 0) - (a.imageScene === 'WB_DFT' ? 1 : 0));
        values = [img.urlDefault, img.url_default, ...infos.map(x => x.url), img.url, img.urlPre];
      } else values = [img.url_list || img.urlList, img.display_image || img.displayImage, img.owner_watermark_image, img.download_url_list];
      const a = asset('image', values, p, i + 1, { width: img.width || 0, height: img.height || 0, role: 'main' });
      if (a) assets.push(a);
      const live = asset('video', streams(img.video || (img.livePhoto || img.live_photo ? { stream: img.stream } : null), p), p, i + 1, { role: 'live', label: '实况视频' });
      if (live) assets.push(live);
    });
    if (videoNote) {
      const first = mainVideo.find(v => urls(v, p).length);
      const v = asset('video', mainVideo, p, 1, { role: 'main', width: first?.width || note.video?.width || 0, height: first?.height || note.video?.height || 0 });
      if (v) assets.push(v);
      const cover = asset('image', [note.video?.origin_cover, note.video?.originCover, note.video?.cover, note.cover, images[0]?.urlDefault, images[0]?.url_default, images[0]?.url], p, 1, { role: 'cover', label: '视频封面' });
      if (cover && v) assets.push(cover);
    }
    if (!assets.length) return null;
    const user = note.user || note.author || {};
    return {
      key: p + ':' + id, id, platform: p,
      title: text(note.title || note.desc || note.description || '未命名作品', 180),
      description: text(note.desc || note.description || note.title),
      author: text(user.nickname || user.nickName || user.name || '未知作者', 120),
      assets, expectedImages: videoNote ? 0 : images.length, method: 'structured', warnings: []
    };
  }
  function extractPosts(root, p) {
    const posts = new Map(), visited = new WeakSet(); let budget = 16000;
    function walk(v, depth, keyHint) {
      if (!v || typeof v !== 'object' || depth > 15 || budget-- <= 0 || visited.has(v)) return;
      // DOM nodes and React owners can contain entire documents or cycles.
      if (typeof v.nodeType === 'number') return;
      visited.add(v);
      try {
        const raw = p === 'xhs' && v.note && typeof v.note === 'object' ? v.note : v;
        const n = p === 'xhs' && !raw.noteId && !raw.note_id && !raw.id && /^[a-f\d]{24}$/i.test(keyHint || '') ? { ...raw, noteId: keyHint } : raw;
        const post = normalize(n, p);
        if (post && (!posts.has(post.id) || posts.get(post.id).assets.length < post.assets.length)) posts.set(post.id, post);
        for (const k of Object.keys(v).slice(0, 300)) {
          if (['__proto__', 'constructor', 'prototype', 'return', '_owner', 'stateNode'].includes(k)) continue;
          const child = v[k];
          if (child && typeof child === 'object') walk(child, depth + 1, k);
        }
      } catch { /* A page object getter must not stop extraction. */ }
    }
    walk(root, 0, ''); return [...posts.values()].slice(0, 20);
  }
  function safeSegment(value, fallback = '作品', limit = 70) {
    let s = String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/\.{2,}/g, '_').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
    s = Array.from(s).slice(0, limit).join('').replace(/[. ]+$/g, '');
    let bytes = 0, bounded = '';
    for (const ch of s) {
      const code = ch.codePointAt(0), count = code > 65535 ? 4 : code > 2047 ? 3 : code > 127 ? 2 : 1;
      if (bytes + count > 180) break;
      bounded += ch; bytes += count;
    }
    s = bounded.replace(/[. ]+$/g, '');
    if (!s || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) return fallback;
    return s;
  }
  function extension(url, kind) {
    try {
      const u = new URL(url), match = u.pathname.match(/\.(webp|jpe?g|png|gif|avif|heic|mp4|mov|webm)(?:[!~:]|$)/i);
      if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
      if (/webp/i.test(u.pathname)) return 'webp';
      if (/png/i.test(u.pathname)) return 'png';
    } catch { /* filename default */ }
    return kind === 'video' ? 'mp4' : 'jpg';
  }
  function filename(post, a, folder) {
    const path = safeSegment(folder, '拾光下载', 40) + '/' + platformName(post.platform) + '/' + safeSegment(post.author + '_' + post.title, '作品', 65) + '_' + safeSegment(post.id, '作品ID', 64);
    const suffix = a.role === 'cover' ? '封面' : a.role === 'live' ? '实况' : a.kind === 'video' ? '视频' : '图片';
    return `${path}/${String(a.index).padStart(2, '0')}_${suffix}.${extension(a.url, a.kind)}`;
  }
  return Object.freeze({ platform, platformName, shareText, links, postId, wechatTarget, wechatPreview, wechatPost, mp4Header, mediaUrl, videoUrl, urls, json, asset, normalize, extractPosts, safeSegment, extension, filename });
});
