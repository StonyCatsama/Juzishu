// 橘子树 · 位置 | 原创实现
//
// 一天的位置写在 ODAY 当天的档里，一行一段链：
//   [位置：18:40-19:40 家·玄关／饭桌 → 19:40-20:40 家·客厅（琴） → ...]
// 早/午/晚各一行，合起来才是一整天的链，所以补终点要三行一起补。
// 括号里是那个时段的状态（等雨、琴），只在标注里取，不从正文猜。

/** 一行 [位置：…] → [{ from, to, place, state }]；from/to 是分钟数 */
export function parseLocChain(line) {
  const m = String(line || "").match(/\[位置[:：]\s*([^\]]+)\]/);
  if (!m) return null;
  const segs = m[1].split(/→/).map((s) => s.trim()).filter(Boolean);
  const toMin = (t) => {
    const mm = String(t).match(/(\d{1,2}):(\d{2})/);
    return mm ? parseInt(mm[1], 10) * 60 + parseInt(mm[2], 10) : null;
  };
  const out = [];
  for (const s of segs) {
    const mm = s.match(/^(\d{1,2}:\d{2})\s*(?:[–\-~～]\s*(\d{1,2}:\d{2})?)?\s*([^（(]+?)\s*(?:[（(]([^）)]*)[）)])?$/);
    if (!mm) continue;
    out.push({ from: toMin(mm[1]), to: mm[2] ? toMin(mm[2]) : null, place: mm[3].trim(), state: (mm[4] || "").trim() || null });
  }
  return out.length ? out : null;
}

/** 整天档 → 一条完整的链，缺终点的段接下一段的起点，最后一段撑到 24:00。 */
export function buildDayChain(text) {
  const chain = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const seg = parseLocChain(line);
    if (seg) chain.push(...seg);
  }
  if (!chain.length) return null;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].to !== null) continue;
    const next = chain[i + 1];
    if (next && Number.isFinite(next.from) && next.from > chain[i].from) chain[i].to = next.from;
    // 没下一段，或者下一段起点不大于本段（她写了个“18:00-”开着口的）——先按一小时算，不把链断掉
    else chain[i].to = Math.min(24 * 60, chain[i].from + 60);
  }
  // 跨零点（23:40-05:00）：终点加上一天，否则这一段永远落不进去
  for (const s of chain) {
    if (s.to !== null && s.to <= s.from) s.to += 24 * 60;
  }
  return chain;
}

/** 当前钟点落在哪一段；落不进去返回 null。 */
export function pickPlaceStrict(chain, nowMin) {
  if (!Array.isArray(chain) || !chain.length) return null;
  const m = Number(nowMin);
  if (!Number.isFinite(m)) return null;
  for (const s of chain) {
    const to = s.to === null || s.to === undefined ? 24 * 60 : s.to;
    if (m >= s.from && m < to) return s;
    // 跨零点那段：凌晨也算在里头
    if (to > 24 * 60 && m + 24 * 60 < to) return s;
  }
  return null;
}

/** 当前钟点落在哪一段，落不进去就退回第一段（旧行为）。 */
export function pickPlace(chain, nowMin) {
  if (!Array.isArray(chain) || !chain.length) return null;
  return pickPlaceStrict(chain, nowMin) || chain[0];
}

/** 拼一行 [此刻]。state 可缺。 */
export function placeLine(seg) {
  if (!seg || !seg.place) return "";
  return seg.state ? `[此刻] 在${seg.place}，${seg.state}。` : `[此刻] 在${seg.place}。`;
}
