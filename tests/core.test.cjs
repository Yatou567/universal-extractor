const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../lib/core.js');
const xhsId = '6acc9819000000001a02137f', dyId = '7696072509029046961';
const image = n => ({ urlDefault: `http://sns-webpic-qc.xhscdn.com/token/picture${n}!nd_dft_wlteh_webp_3`, width: 1206, height: 2100 });
const xhsGallery = () => ({ noteId: xhsId, type: 'normal', title: '这也太真实了', user: { nickname: '作者' }, imageList: [1, 2, 3, 4].map(image) });
const mp4 = { format: 'mp4', videoCodec: 'EF4', masterUrl: 'http://sns-video-v2.xhscdn.com/stream/full.mp4?sign=123&t=456', backupUrls: ['http://sns-bak-v1.xhscdn.com/stream/full.mp4'], width: 720, height: 1280, audioBitrate: 64002 };

test('pasted share text preserves signed parameters, handles both platforms and deduplicates', () => {
  const xhs = `https://www.xiaohongshu.com/discovery/item/${xhsId}?xsec_token=a_B-c=&xsec_source=pc_share`;
  const dy = 'https://v.douyin.com/4Nw5Mi4nNhY/';
  assert.deepEqual(core.links(`87 【示例】 😆 ${xhs}\n3.58 P@k:/ ${dy} 复制此链接！\n${dy}`), [xhs, dy]);
  assert.deepEqual(core.links(`${dy}。） https://evil.example/path http://xhslink.com/a/ABC`), [dy, 'https://xhslink.com/a/ABC']);
});
test('escaped Douyin share schemes and encoded spaces preserve the exact link and signed parameters', () => {
  const share = String.raw`1.05 复制打开抖音，看看【枫子大叔的作品】当我带老爸上了出国的游轮 https\://v.douyin.com/JDL-NcYe5pk/ 07/01 :9pm Y@M.wF Oxf:/&#x20;`;
  assert.deepEqual(core.links(share), ['https://v.douyin.com/JDL-NcYe5pk/']);
  assert.deepEqual(core.links(String.raw`https:\/\/v.douyin.com/JDL-NcYe5pk/&#x20;复制打开`), ['https://v.douyin.com/JDL-NcYe5pk/']);
  const signed = `https://www.xiaohongshu.com/explore/${xhsId}?xsec_token=Ab%2B_%3D&amp;xsec_source=pc_share`;
  assert.deepEqual(core.links(signed + '&#32;复制'), [signed.replace('&amp;', '&')]);
  assert.deepEqual(core.links('https://v.douyin.com/JDL-NcYe5pk/&nbsp;复制'), ['https://v.douyin.com/JDL-NcYe5pk/']);
});
test('video assets reject website pages but retain official playback endpoints and opaque CDN URLs', () => {
  for (const url of [`https://www.douyin.com/video/${dyId}`, 'https://v.douyin.com/JDL-NcYe5pk/', 'https://www.douyin.com/', 'https://v3-web.douyinvod.com/error.html', 'https://v3-web.douyinvod.com/audio.mp3', 'https://v3-web.douyinvod.com/silent.m4s']) {
    assert.equal(core.asset('video', [url], 'douyin', 1), null, url);
  }
  for (const url of ['https://www.douyin.com/aweme/v1/play/?video_id=abc&ratio=1080p', 'https://www.iesdouyin.com/aweme/v1/playwm/?video_id=abc', 'https://v3-web.douyinvod.com/opaque/token/video/tos?sign=Ab%2Bc']) {
    assert.equal(core.asset('video', [url], 'douyin', 1).url, url);
  }
});
test('platform and media validation reject lookalikes, credentials, ports and local URLs', () => {
  for (const url of ['https://xiaohongshu.com.evil.test/a', 'https://evilxiaohongshu.com/a', 'https://user:pass@www.douyin.com/video/123', 'https://www.douyin.com:444/a', 'javascript:alert(1)']) assert.equal(core.platform(url), null);
  for (const url of ['blob:https://www.douyin.com/123', 'https://127.0.0.1/file.mp4', 'https://evil.test/file.mp4', 'https://xhscdn.com.evil.test/a.jpg']) assert.equal(core.mediaUrl(url, 'xhs'), '');
  assert.equal(core.mediaUrl('http://sns-webpic-qc.xhscdn.com/a?sign=abc%2Bdef', 'xhs'), 'https://sns-webpic-qc.xhscdn.com/a?sign=abc%2Bdef');
});
test('extract IDs from detail URLs and feed modals without accepting other sections', () => {
  assert.equal(core.postId(`https://www.xiaohongshu.com/explore/${xhsId}?xsec_token=foo`), xhsId);
  assert.equal(core.postId(`https://www.douyin.com/note/${dyId}`), dyId);
  assert.equal(core.postId(`https://www.douyin.com/?modal_id=${dyId}`), dyId);
  assert.equal(core.postId('https://www.douyin.com/user/12345678901234'), '');
});
test('XHS complete gallery extracts all four images and preserves source order', () => {
  const result = core.normalize(xhsGallery(), 'xhs');
  assert.equal(result.assets.length, 4);
  assert.equal(result.assets[3].index, 4);
  assert.equal(result.assets[0].url, 'https://sns-webpic-qc.xhscdn.com/token/picture1!nd_dft_wlteh_webp_3');
  assert.equal(result.assets[0].height, 2100);
});
test('XHS video imageList is a cover; chooses complete MP4 over silent 4K fragmented stream', () => {
  const note = { noteId: '6acb8300000000000a023432', type: 'video', title: '视频', imageList: [image(1)], video: { media: { stream: { EF4: [mp4], EF5: [{ format: 'fmp4', width: 2160, height: 3840, audioBitrate: 0, masterUrl: 'https://sns-video-v2.xhscdn.com/silent.m4s' }] } } } };
  const result = core.normalize(note, 'xhs');
  assert.deepEqual(result.assets.map(a => a.kind + ':' + a.role), ['video:main', 'image:cover']);
  assert.equal(result.assets[0].width, 720);
  assert.match(result.assets[0].url, /full\.mp4\?sign=123&t=456$/);
  assert.equal(result.expectedImages, 0);
  assert.ok(!JSON.stringify(result.assets).includes('.m4s'));
});
test('XHS mediaV2 snake_case MP4 works, split-only video is not returned as cover download', () => {
  const result = core.normalize({ noteId: xhsId, type: 'video', imageList: [image(1)], video: { mediaV2: JSON.stringify({ stream: { h264: [{ master_url: 'https://sns-video-v2.xhscdn.com/media.mp4', backup_urls: ['https://sns-bak-v1.xhscdn.com/media.mp4'], width: 1080, height: 1920, format: 'mp4' }] } }) } }, 'xhs');
  assert.equal(result.assets[0].width, 1080);
  assert.equal(result.assets[0].alternatives.length, 1);
  assert.equal(core.normalize({ noteId: xhsId, type: 'video', imageList: [image(1)], video: { stream: { h265: [{ masterUrl: 'https://sns-video-v2.xhscdn.com/media.m4s', format: 'fmp4' }] } } }, 'xhs'), null);
});
test('Douyin image posts remain galleries even if an accompanying video exists', () => {
  const images = Array.from({ length: 14 }, (_, i) => ({ url_list: [`https://p3-pc-sign.douyinpic.com/image-${i}.webp?x-signature=a%2Bb`] }));
  const result = core.normalize({ aweme_id: dyId, desc: '图文', images, video: { play_addr: { url_list: ['https://v3.douyinvod.com/music.mp4'] } } }, 'douyin');
  assert.equal(result.assets.length, 14); assert.ok(result.assets.every(a => a.kind === 'image'));
});
test('Douyin highest H264 stream wins over H265 and gallery LivePhoto stays paired', () => {
  const result = core.normalize({ awemeId: '7443012035891301642', desc: '视频', video: { bitRate: [
    { isH265: true, bitRate: 5000000, playAddr: { urlList: ['https://v3.douyinvod.com/hevc.mp4'], width: 2160, height: 3840 } },
    { bitRate: 2000000, playAddr: { urlList: ['https://v3.douyinvod.com/avc.mp4'], width: 1080, height: 1920 } }
  ] } }, 'douyin');
  assert.match(result.assets[0].url, /avc\.mp4$/);
  const gallery = core.normalize({ aweme_id: dyId, image_post_info: { images: [{ url_list: ['https://p3.douyinpic.com/a.webp'], video: { play_addr: { url_list: ['https://v3.douyinvod.com/live.mp4'] } } }] } }, 'douyin');
  assert.deepEqual(gallery.assets.map(a => a.role), ['main', 'live']);
});
test('nested state traversal extracts detail map and tolerates cyclic page objects', () => {
  const note = xhsGallery(); delete note.noteId;
  const data = { note: { noteDetailMap: { [xhsId]: { note } } } }; data.circular = data;
  assert.equal(core.extractPosts(data, 'xhs')[0].id, xhsId);
});
test('safe filenames retain Chinese and neutralize traversal and OS reserved names', () => {
  assert.ok(!/[.\/\\?]/.test(core.safeSegment('../CON\\/illegal?')));
  assert.equal(core.safeSegment('CON'), '作品');
  const note = core.normalize(xhsGallery(), 'xhs'); note.author = '作者/../../恶意';
  const file = core.filename(note, note.assets[0], '../下载');
  assert.ok(!file.includes('..')); assert.ok(!file.startsWith('/')); assert.match(file, /01_图片\.webp$/);
  const emoji = core.safeSegment('😀'.repeat(90)); assert.ok(Buffer.byteLength(emoji, 'utf8') <= 180);
});

function extract(href, globals = {}, dom = {}) {
  const empty = { querySelectorAll: () => [], querySelector: () => null };
  const context = vm.createContext({ ...globals, window: null, ShiguangCore: core, URL, decodeURIComponent, location: new URL(href), document: { ...empty, title: '目标作品', body: { innerText: '' }, ...dom } });
  context.window = context;
  return vm.runInContext(fs.readFileSync(path.join(__dirname, '../extractor.js'), 'utf8'), context);
}
test('extractor selects exact current ID, never a recommendation or cached previous item', () => {
  const current = xhsGallery(), previous = { ...xhsGallery(), noteId: '6acb8300000000000a023432', title: '其他作品' };
  const result = extract(`https://www.xiaohongshu.com/explore/${xhsId}`, { __INITIAL_STATE__: { first: previous, detail: current }, __SHIGUANG_MEDIA_V1__: { posts: [core.normalize(previous, 'xhs')] } });
  assert.equal(result.post.id, xhsId); assert.equal(result.post.title, current.title);
});
test('extractor parses URL-encoded RENDER_DATA and labels gallery DOM fallback', () => {
  const render = { textContent: encodeURIComponent(JSON.stringify({ detail: { aweme_id: dyId, images: [{ url_list: ['https://p3.douyinpic.com/a.webp'] }] } })) };
  const result = extract(`https://www.douyin.com/note/${dyId}`, {}, { querySelectorAll: selector => selector.includes('script') ? [render] : [] });
  assert.equal(result.post.assets.length, 1);
  const img = { currentSrc: 'https://p3.douyinpic.com/image.webp', naturalWidth: 1206, naturalHeight: 2100 };
  const player = { getBoundingClientRect: () => ({ width: 500, height: 700 }), querySelectorAll: s => s === '.dySwiperSlide img' ? [img, img] : [], querySelector: () => null, matches: () => true };
  const fallback = extract(`https://www.douyin.com/note/${dyId}`, {}, { querySelectorAll: s => s === '[data-e2e="note-detail"]' || s === '.basePlayerContainer' ? [player] : [] });
  assert.equal(fallback.post.assets.length, 1); assert.equal(fallback.post.method, 'dom'); assert.equal(fallback.post.warnings.length, 1);
});
test('extractor rejects non-detail pages and recognizes verification and unavailable works', () => {
  assert.equal(extract('https://www.xiaohongshu.com/login').issue, 'login');
  assert.equal(extract(`https://www.douyin.com/video/${dyId}`, {}, { body: { innerText: '拖动滑块完成验证' } }).issue, 'verification');
  assert.equal(extract(`https://www.douyin.com/video/${dyId}`, {}, { body: { innerText: '作品已删除' } }).issue, 'unavailable');
});
test('DOM videos wait for playable metadata and reject document URLs and playback errors', () => {
  const video = { currentSrc: 'https://v3-web.douyinvod.com/playable.mp4', readyState: 0, videoWidth: 0, videoHeight: 0, error: null };
  const player = { getBoundingClientRect: () => ({ width: 500, height: 700 }), querySelectorAll: s => s === 'video' ? [video] : [], querySelector: () => null, matches: () => true };
  const read = () => extract(`https://www.douyin.com/video/${dyId}`, {}, { querySelectorAll: s => s === '[data-e2e="video-detail"]' ? [player] : [] });
  assert.equal(read().issue, 'pending');
  Object.assign(video, { readyState: 1, videoWidth: 1080, videoHeight: 1920 });
  assert.equal(read().post.assets[0].url, video.currentSrc);
  video.error = { code: 4 }; assert.equal(read().issue, 'pending');
  video.error = null; video.currentSrc = `https://www.douyin.com/video/${dyId}`;
  assert.equal(read().issue, 'pending');
});

test('network capture listens to site media endpoints and passes the original fetch response through', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../capture.js'), 'utf8');
  const note = xhsGallery(); let payload = { data: { items: [{ note_card: note }] } }, count = 0;
  const response = { ok: true, headers: { get: () => '100' }, clone: () => ({ json: async () => { count++; return payload; } }) };
  function XHR() {} XHR.prototype.open = function () {};
  const context = vm.createContext({ ShiguangCore: core, location: new URL('https://www.xiaohongshu.com/explore/' + xhsId), URL, XMLHttpRequest: XHR, fetch: async () => response, window: null }); context.window = context;
  vm.runInContext(source, context);
  assert.equal(await context.fetch('/api/sns/web/v1/feed'), response); await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.__SHIGUANG_MEDIA_V1__.posts[0].assets.length, 4);
  await context.fetch('/api/sns/web/v1/comments'); await context.fetch('https://evil.example/api/sns/web/v1/feed'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 1);
});
