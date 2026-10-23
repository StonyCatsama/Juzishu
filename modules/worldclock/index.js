// 橘子树 · 世界钟（真实时区这一档）| 原创实现
//
// 只做一件事：把"某个时区的此刻"算清楚。
// 不读盘、不依赖配置——上层传进来什么就按什么算，方便单独测。
//
// 约定：橘子树原来用 tz 表示"相对 +8 的偏移"（0 = 北京）。
// offsetFromBeijing() 就是把这个约定和真实 IANA 时区接起来的那一层。

const FALLBACK = "Asia/Shanghai";

export function isValidTz(name) {
  const s = String(name || "").trim();
  if (!s) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s });
    return true;
  } catch {
    return false;
  }
}

/** 给定时刻的 UTC 偏移（小时，东正西负）。时区不合法就按上海算。 */
export function offsetHours(tzName, atMs = Date.now()) {
  const tz = isValidTz(tzName) ? String(tzName).trim() : FALLBACK;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(atMs)).map((x) => [x.type, x.value]));
  const hh = Number(p.hour) === 24 ? 0 : Number(p.hour);
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hh, Number(p.minute), Number(p.second));
  return Math.round(((asUTC - atMs) / 36e5) * 100) / 100;
}

/** 橘子树既有口径：tz = 相对北京(+8)的偏移。北京 0，东京 +1，纽约 -13/-12。 */
export function offsetFromBeijing(tzName, atMs = Date.now()) {
  return offsetHours(tzName, atMs) - 8;
}

/** 拆出年月日时分、当天第几分钟、星期。 */
export function partsFor(tzName, atMs = Date.now()) {
  const tz = isValidTz(tzName) ? String(tzName).trim() : FALLBACK;
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(atMs)).map((x) => [x.type, x.value]));
  const hh = Number(p.hour) === 24 ? 0 : Number(p.hour);
  const mm = Number(p.minute);
  return {
    tz,
    date: `${p.year}-${p.month}-${p.day}`,
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hh, mm,
    minutes: hh * 60 + mm,
    weekday: p.weekday,
  };
}

/** 当天已过多少比例（0~1）。三档信的落点以后按这个算，换日长也不用改。 */
export function dayProgress(tzName, atMs = Date.now()) {
  return partsFor(tzName, atMs).minutes / 1440;
}

/** "07:00" + tz → 今天这个钟点对应的 UTC 毫秒（用于验证档位会不会在该响的时候响）。 */
export function slotInstantUTC(tzName, dateStr, hhmm, nowMs = Date.now()) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return null;
  const off = offsetHours(tzName, nowMs);
  const local = Date.UTC(
    Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)),
    Number(m[1]), Number(m[2])
  );
  return local - off * 36e5;
}
