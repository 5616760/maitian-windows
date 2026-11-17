// 适配器共用的小工具
import { evaluate, insertText, sleep, click, waitFor } from '../cdp.js';
import { statSync } from 'node:fs';

// 富文本编辑器里输入「#话题」，从联想列表里点「完全同名」的那一项；没有同名就保留成普通文字并记一条提示。
// itemsExpr：返回联想项元素数组的表达式
export async function pickTopics(ctx, topics, itemsExpr, { realClick = false } = {}) {
  const picked = [], plain = [];
  for (const t of topics) {
    await insertText(ctx.tabId, '#' + t);
    // 联想列表会滞后刷新：一直等到出现同名项，最多 4 秒
    // realClick：抖音的联想项只认真实鼠标点击（2026-11-12 起 .click() 不再生成话题）
    let hit = 'none';
    const find = `${itemsExpr}.filter(e=>e.getClientRects().length).find(e=>e.innerText.split('\\n')[0].trim()==='#'+${JSON.stringify(t)})`;
    for (let i = 0; i < 8 && hit !== 'picked'; i++) {
      await sleep(500);
      hit = await evaluate(ctx.tabId, `(()=>{const it=${itemsExpr}.filter(e=>e.getClientRects().length);
        const h=it.find(e=>e.innerText.split('\\n')[0].trim()==='#'+${JSON.stringify(t)}); if(h){${realClick ? "return 'found'" : "h.click(); return 'picked'"}}
        return it.length ? 'nomatch' : 'none'})()`);
      if (hit === 'found') hit = (await click(ctx.tabId, find)) ? 'picked' : 'none';
    }
    if (hit === 'picked') picked.push(t);
    else { plain.push(t); await insertText(ctx.tabId, ' '); }
    await sleep(400);
  }
  if (plain.length) ctx.note(`没有同名话题，保留为普通文字：${plain.join('、')}`);
  return picked;
}

// 读回标题，和期望不一致就报异常
export async function checkTitle(ctx, expr, expected, label = '标题') {
  const got = await evaluate(ctx.tabId, expr);
  if ((got || '').trim() !== expected.trim()) ctx.fail(`${label}异常：期望「${expected}」，页面上是「${got || '空'}」`);
  else ctx.log(`${label}：${expected}`);
}

// 定时发布时间（ISO，带时区）→ 北京时间的各个字段
export function bjTime(iso) {
  const d = new Date(Date.parse(iso) + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate(), hh = d.getUTCHours(), mm = d.getUTCMinutes();
  return { y, m, d: day, hh, mm, ymd: `${y}-${p(m)}-${p(day)}`, hm: `${p(hh)}:${p(mm)}`, text: `${y}-${p(m)}-${p(day)} ${p(hh)}:${p(mm)}` };
}

// 上传等待时长：按视频体积估算，别用固定值。
// 固定 30 秒在几百兆的成片上必然误判。2026-11-17 实测（78MB / 1080x1920）：
//   单独上传 ≈ 95 秒；四个平台并行时每个都变慢，2 分钟不够。
// 按 1MB/s 保守估算，再乘 4 倍余量（并发 + 平台转码排队），最少 3 分钟、最多 60 分钟。
export function uploadTimeoutMs(videoPath) {
  let mb = 0;
  try { mb = statSync(videoPath).size / 1048576; } catch { return 15 * 60e3; }
  return Math.min(60 * 60e3, Math.max(3 * 60e3, (mb / 1) * 4 * 1000));
}

// 等上传出表单，期间定期报进度，避免长时间没有任何输出
export async function waitUploaded(ctx, expr, what, videoPath) {
  const total = uploadTimeoutMs(videoPath);
  const started = Date.now();
  const mb = (() => { try { return (statSync(videoPath).size / 1048576).toFixed(0); } catch { return '?'; } })();
  ctx.log(`${what}：等表单出现（视频 ${mb}MB，最多等 ${Math.round(total / 60000)} 分钟）`);
  const ok = await waitFor(ctx.tabId, expr, total, 1000);
  if (!ok) throw new Error(`上传后没有出现${what}（等了 ${Math.round((Date.now() - started) / 60000)} 分钟）`);
  ctx.log(`${what}：已出现，用时 ${Math.round((Date.now() - started) / 1000)} 秒`);
}
