// 微信公众号（mp.weixin.qq.com）图文适配器。
// 公众号不支持网页直传视频，所以走「图文」：把每期视频的标题、摘要、正文（含话题标签）
// 写进后台「图文消息」编辑器，填完即停——群发和最后的「保存并群发」永远由你自己点。
// 登录走扫码（或公众号管理员微信确认），麦田不碰任何密码。
import { evaluate, setValue, focusEnd, typeLines, sleep, waitFor, click, byText } from '../cdp.js';
import { checkTitle } from './common.js';

// 公众号新建图文是 SPA，编辑器在 iframe（ueditor）里。标题/摘要在主文档，正文在 iframe。
const TITLE = `document.querySelector('#title') || document.querySelector('input[placeholder*="标题"]')`;
const AUTHOR = `document.querySelector('#author')`;
const DIGEST = `document.querySelector('#digest') || document.querySelector('textarea[placeholder*="摘要"]')`;
const IFRAME = `document.querySelector('#ueditor_0')`;
const BODY = `document.querySelector('#ueditor_0').contentDocument.body`;

export default {
  id: 'weixin',
  name: '微信公众号',
  // 从后台首页进新建图文：登录后跳 home_page_app.cgi，左侧「图文」入口
  url: 'https://mp.weixin.qq.com/',
  ready: `document.body && /新建|图文|发表/.test(document.body.innerText)`,
  // 登录探测：未登录时是扫码页
  loginHint: '扫码登录后请点左侧「图文」确认能进编辑器',

  async fill(ctx) {
    const { tabId: T, p } = ctx;
    // 公众号图文是纯文字+图片，视频本身传不上去：放一句引导话术，视频链接平台审核也不允许外链
    // 标题、作者、摘要
    if (!await waitFor(T, `!!${TITLE}`, 20000)) throw new Error('没找到图文编辑器的标题框，请确认已进「新建图文」页面');
    await evaluate(T, `${TITLE}.focus()`);
    await evaluate(T, `(()=>{const i=${TITLE}; i.select && i.select(); return 1})()`);
    await setValue(T, TITLE, p.title.slice(0, 64));
    await sleep(300);
    await checkTitle(ctx, `${TITLE}.value`, p.title.slice(0, 64), '标题');
    if (await evaluate(T, `!!${AUTHOR}`)) await setValue(T, AUTHOR, '麦田');
    // 摘要：取正文前 120 字（公众号摘要上限 120）
    const digest = (p.digest || p.body || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (await evaluate(T, `!!${DIGEST}`)) { await focusEnd(T, DIGEST); await typeLines(T, digest); ctx.log(`摘要：${digest.length} 字`); }

    // 正文：ueditor iframe。话题写成 #话题# 形式（公众号没有话题联想，纯文本即可）
    if (await waitFor(T, `!!${IFRAME}`, 10000)) {
      await evaluate(T, `(()=>{const d=${BODY.slice(0, -1)}.contentDocument; d && d.focus && d.body.focus(); return 1})()`.replace('d.body.focus()', 'return 1'));
      const lines = [p.body || ''];
      if (p.topics && p.topics.length) lines.push('', p.topics.map(t => `#${t}#`).join(' '));
      // ueditor 里逐行输入
      await evaluate(T, `(()=>{
        const d = ${IFRAME}.contentDocument;
        d.body.innerHTML = '';
        return 1;
      })()`);
      for (const line of lines) {
        await focusEnd(T, `${IFRAME}.contentDocument.body`);
        await typeLines(T, line);
        await evaluate(T, `${IFRAME}.contentDocument.body.appendChild(document.createElement('p'))`).catch(() => {});
      }
      const blen = await evaluate(T, `${IFRAME}.contentDocument.body.innerText.length`);
      ctx.log(`正文：${blen} 字`);
    } else {
      ctx.fail('没找到正文编辑器（ueditor iframe），请手动粘贴正文');
    }
    // 公众号没有网页定时（定时发表只有 API/第三方可设），如果有 schedule 就提示
    if (ctx.schedule) ctx.note('公众号网页端不支持定时群发，到点后请手动发表');
    ctx.note('封面图请手动上传（首图 2.35:1 或 1:1），确认排版后再群发');
  },

  // 没有上传等待的概念，标成「已填写」直接等人工
  uploadDone: null,

  // 发布后取链接：图文素材列表里找同标题文章
  links: {
    url: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=list&type=77',
    ready: `location.hostname === 'mp.weixin.qq.com'`,
    async collect(T, p) {
      const hit = await evaluate(T, `(()=>{
        const rows=[...document.querySelectorAll('.weui-desktop-media-list__item, .article_item')];
        const c=rows.find(r=>((r.querySelector('.weui-desktop-media-list__title, .title')||{}).innerText||'').trim()===${JSON.stringify(p.title.slice(0, 64))});
        if(!c) return null;
        const a=c.querySelector('a[href*="appmsg"]');
        return { url: a ? a.href : null, text: c.innerText };
      })()`);
      if (!hit || !hit.url) return null;
      return { status: /已群发|已发表/.test(hit.text) ? '已发布' : '草稿', url: hit.url, time: null };
    },
  },
};
