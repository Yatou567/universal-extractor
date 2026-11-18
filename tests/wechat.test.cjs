const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core.js');
const wechat = require('../lib/wechat.js');
const share = 'https://weixin.qq.com/sph/A4MfAMbMob';
const preview = 'https://channels.weixin.qq.com/finder-preview/pages/feed?token=opaque%2Btoken%3D&eid=export%2Fpreview123';
const feed = () => ({ errCode: 0, data: { feedInfo: { description: '情侣游戏之大胆轮盘挑战🔥', coverUrl: 'https://finder.video.qq.com/cover?token=x&picformat=200', h264VideoInfo: { videoUrl: 'https://finder.video.qq.com/play?encfilekey=a&token=b', width: 1080, height: 1920 }, h265VideoInfo: { videoUrl: 'https://finder.video.qq.com/hevc?token=c' } }, authorInfo: { nickname: '情侣记丨小程序同名可玩' } } });
function env(href, payload, status = 200) {
  const calls = [];
  return { location: { href }, calls, async fetch(url, options) { calls.push({ url, options }); return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); } };
}
test('WeChat recognizes only share and official preview paths, retaining exact case and signed queries', () => {
  assert.equal(core.platform(share), 'weixin'); assert.equal(core.postId(share), 'A4MfAMbMob');
  assert.equal(core.postId('https://channels.weixin.qq.com/finder-preview/pages/sph?id=A4MfAMbMob'), 'A4MfAMbMob');
  assert.equal(core.postId(preview), 'export/preview123');
  assert.deepEqual(core.links(`微信视频：${share}。）\n${preview}`), [share, preview]);
  for (const bad of ['https://weixin.qq.com/sph/', 'https://weixin.qq.com/s/abc', 'https://mp.weixin.qq.com/s/abc123', 'https://weixin.qq.com.evil.test/sph/A4MfAMbMob', 'https://channels.weixin.qq.com/platform', 'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=../../etc/passwd']) assert.equal(core.platform(bad), null);
});
test('WeChat parser rejects forged preview destinations and missing session tokens', () => {
  assert.equal(core.wechatPreview({ code: 0, data: { playable_url: preview } }), preview);
  for (const bad of [preview.replace('channels.weixin.qq.com', 'evil.test'), preview.replace('https:', 'http:'), preview.replace('pages/feed', 'pages/other'), preview.replace('token=opaque%2Btoken%3D&', '')]) assert.equal(core.wechatPreview({ code: 0, data: { playable_url: bad } }), '');
});
test('WeChat maps official H264/H265 preview streams and cover, preserving signatures and separate roles', () => {
  const p = core.wechatPost(feed(), 'A4MfAMbMob');
  assert.equal(p.title, '情侣游戏之大胆轮盘挑战🔥'); assert.equal(p.author, '情侣记丨小程序同名可玩');
  assert.deepEqual(p.assets.map(a => a.kind + ':' + a.role), ['video:main', 'image:cover']);
  assert.match(p.assets[0].url, /encfilekey=a&token=b$/); assert.equal(p.assets[0].width, 1080);
  assert.equal(p.assets[0].alternatives.length, 1); assert.equal(p.expectedImages, 0);
  assert.match(core.filename(p, p.assets[0], '拾光下载'), /微信视频号/);
  const long = { ...p, id: 'export/' + 'a'.repeat(500), title: '中文标题'.repeat(80), author: '😀'.repeat(30) };
  assert.ok(core.filename(long, p.assets[0], '下载').split('/').every(part => Buffer.byteLength(part) <= 255));
});
test('WeChat cover-only, raw encrypted media and split streams are never treated as downloadable videos', () => {
  const f = feed(); delete f.data.feedInfo.h264VideoInfo; delete f.data.feedInfo.h265VideoInfo;
  assert.equal(core.wechatPost(f, 'A4MfAMbMob'), null);
  f.data.feedInfo.videoUrl = 'https://finder.video.qq.com/encrypted';
  f.data.feedInfo.object_desc = { media: [{ url: 'https://finder.video.qq.com/raw', decode_key: 12345 }] };
  assert.equal(core.wechatPost(f, 'A4MfAMbMob'), null);
  const encrypted = feed(); encrypted.data.feedInfo.h264VideoInfo.decode_key = '12345'; delete encrypted.data.feedInfo.h265VideoInfo; assert.equal(core.wechatPost(encrypted, 'A4MfAMbMob'), null);
  const mixed = feed(); mixed.data.feedInfo.decodeKey = '12345'; mixed.data.feedInfo.originVideoUrl = 'https://finder.video.qq.com/raw-encrypted';
  assert.ok(core.wechatPost(mixed, 'A4MfAMbMob')); // Raw encrypted original is never selected.
  for (const suffix of ['m4s', 'mpd', 'm3u8', 'mp3']) {
    const split = feed(); split.data.feedInfo.h264VideoInfo.videoUrl = 'https://finder.video.qq.com/stream.' + suffix; delete split.data.feedInfo.h265VideoInfo;
    assert.equal(core.wechatPost(split, 'A4MfAMbMob'), null);
  }
  assert.equal(core.mediaUrl('https://finder.video.qq.com.evil.test/video.mp4', 'weixin'), '');
});
test('WeChat official resolver sends only the requested share to a fixed endpoint with existing browser credentials', async () => {
  const e = env('https://yuanbao.tencent.com/chat/example', { code: 0, data: { playable_url: preview } });
  const r = await wechat.resolve(share, e); assert.equal(r.previewUrl, preview);
  assert.equal(e.calls[0].url, '/api/weixin/get_parse_result'); assert.equal(e.calls[0].options.credentials, 'include');
  assert.deepEqual(JSON.parse(e.calls[0].options.body), { type: 'video_channel_url', url: share, scene: 1 });
  assert.ok(!Object.keys(e.calls[0].options.headers).some(k => /cookie/i.test(k)));
  const wrong = env('https://evil.test/', {}); assert.equal((await wechat.resolve(share, wrong)).issue, 'unsupported'); assert.equal(wrong.calls.length, 0);
});
test('WeChat feed request binds the page export ID and token; credentials never appear in metadata or _pageUrl', async () => {
  const e = env(preview, feed()), r = await wechat.read(e);
  assert.equal(r.post.id, 'export/preview123');
  const u = new URL(e.calls[0].url); assert.equal(u.origin, 'https://channels.weixin.qq.com');
  assert.equal(u.pathname, '/finder-preview/api/feed/get_feed_info'); assert.ok(u.searchParams.get('_rid'));
  assert.equal(u.searchParams.get('_pageUrl'), 'https://channels.weixin.qq.com/finder-preview/pages/feed');
  assert.deepEqual(JSON.parse(e.calls[0].options.body), { baseReq: { generalToken: 'opaque+token=' }, exportId: 'export/preview123' });
  assert.ok(!JSON.stringify(r.post).includes('opaque+token='));
});
test('WeChat metadata-only shares require official preview; login, rate limits, expired video and network errors stay actionable', async () => {
  const metadata = feed(); delete metadata.data.feedInfo.h264VideoInfo; delete metadata.data.feedInfo.h265VideoInfo;
  const short = env('https://channels.weixin.qq.com/finder-preview/pages/sph?id=A4MfAMbMob', metadata);
  assert.equal((await wechat.read(short)).issue, 'wechat-preview-required');
  assert.deepEqual(JSON.parse(short.calls[0].options.body), { baseReq: { generalToken: '' }, shortUri: 'A4MfAMbMob' });
  assert.equal((await wechat.resolve(share, env('https://yuanbao.tencent.com/', {}, 401))).issue, 'wechat-login');
  assert.equal((await wechat.resolve(share, env('https://yuanbao.tencent.com/', { code: 1, msg: '请登录' }))).issue, 'wechat-login');
  assert.equal((await wechat.resolve(share, env('https://yuanbao.tencent.com/', {}, 429))).issue, 'wechat-rate');
  assert.equal((await wechat.read(env(preview, metadata))).issue, 'wechat-no-video');
  const deleted = feed(); deleted.data.errMsg = { title: '作品已删除' };
  assert.equal((await wechat.read(env(preview, deleted))).issue, 'unavailable');
  assert.equal((await wechat.read({ location: { href: preview }, fetch: async () => { throw new Error('offline'); } })).issue, 'wechat-network');
});
test('MP4 prefix check rejects encrypted bytes, JSON, images and empty responses', () => {
  assert.equal(core.mp4Header(Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')), true);
  for (const bytes of [Buffer.alloc(64, 193), Buffer.from('{"code":401,"message":"login"}'), Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(0)]) assert.equal(core.mp4Header(bytes), false);
});
