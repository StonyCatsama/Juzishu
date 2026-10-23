// 橘子树 · 冲动（自发心跳） | 原创实现
//
// 到点了给她一段自己的时间。这一版加了规矩：
//   - 他刚说过话不打扰；刚开过口不连发
//   - 追过两次还没回，就不再追（除非那会儿心情是“重”）
//   - 沉默多久要告诉她——沉默该落在心情里，而不是只落在话里
// 默认开着。

export const DEFAULTS = {
  enabled: false,
  checkEveryMin: 21,
  idleMin: 25, // 他上句话之后至少这么久才轮到她
  gapMin: 45, // 她上次开口之后至少隔这么久
  maxPerDay: 4,
  quiet: ["01:00", "07:00"],
  maxChase: 2, // 追两次还没回就停
  careWeight: 2,
};

const hhmm = (s) => {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

function inQuiet(min, from, to) {
  if (from === null || to === null) return false;
  return from < to ? min >= from && min < to : min >= from || min < to;
}

export function humanGap(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} 分钟`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小时`;
  return `${Math.floor(m / (60 * 24))} 天`;
}

/**
 * 现在该不该开口。
 * @param {object} p
 * @param {object} p.cfg
 * @param {number} p.min               现在几点（分钟）
 * @param {number|null} p.lastUserMin  距上次他说话多少分钟
 * @param {number|null} p.lastSpokeMin 距上次她主动开口多少分钟
 * @param {number} p.spokeToday        今天已经主动几次
 * @param {string} p.moodLevel         她现在的深浅（轻/中/重）
 * @param {number} p.chaseCount        这一串没被回应的追问次数
 */
export function evaluate(p) {
  const c = { ...DEFAULTS, ...(p.cfg || {}) };

  // 逐道闸的记录：干跑时要能看出“到底卡在哪”，而不是只给一句 reason。
  const checks = [];
  let ok = true;
  let reason = "自己的时间";
  const gate = (key, pass, note, why) => {
    checks.push({ key, pass, note });
    if (!pass) {
      if (ok) { ok = false; reason = why || note; }
      return false;
    }
    return true;
  };

  gate("enabled", !!c.enabled, c.enabled ? "开着" : "关着", "总开关关着");
  gate(
    "quota",
    !(Number(p.spokeToday) >= c.maxPerDay),
    `今天 ${Number(p.spokeToday) || 0}/${c.maxPerDay}`,
    `今天已经 ${p.spokeToday} 次，到量了`
  );
  gate(
    "quiet",
    !inQuiet(p.min, hhmm(c.quiet[0]), hhmm(c.quiet[1])),
    `静默 ${c.quiet[0]}–${c.quiet[1]}`,
    `${c.quiet[0]}–${c.quiet[1]} 静默`
  );
  gate(
    "idle",
    !(Number.isFinite(Number(p.lastUserMin)) && p.lastUserMin !== null && p.lastUserMin !== undefined && Number(p.lastUserMin) < c.idleMin),
    p.lastUserMin === null || p.lastUserMin === undefined ? "他上次说话时间未知" : `他 ${humanGap(p.lastUserMin)}前说过话（要 ≥ ${c.idleMin} 分）`,
    `他 ${humanGap(p.lastUserMin)}前才说过话`
  );
  gate(
    "gap",
    !(p.lastSpokeMin !== null && p.lastSpokeMin !== undefined && Number.isFinite(Number(p.lastSpokeMin)) && Number(p.lastSpokeMin) < c.gapMin),
    p.lastSpokeMin === null || p.lastSpokeMin === undefined ? "她还没开过口" : `她 ${humanGap(p.lastSpokeMin)}前开过口（要 ≥ ${c.gapMin} 分）`,
    `距上次开口太近（${Number(p.lastSpokeMin)} < ${c.gapMin} 分）`
  );
  gate(
    "chase",
    !(Number(p.chaseCount) >= c.maxChase && String(p.moodLevel || "") !== "重"),
    `追了 ${Number(p.chaseCount) || 0}/${c.maxChase}（心情${p.moodLevel || "无"}）`,
    `已经追了 ${p.chaseCount} 次没回，先等`
  );

  return { ok, reason, checks };
}

/**
 * 沉默该把心情压到哪儿。
 * 只给兜底用：先让她自己写；她没写，机制替她落一档。
 *
 * 2026-10-20 定：机制最高只落到“中”。“重”是她的判断，不归代码。
 * （之前 24h/48h 直接落“重”，结果她明明在跟人说话，也被写成压得重。）
 */
export function silenceMood(lastUserMin) {
  const m = Number(lastUserMin);
  if (!Number.isFinite(m)) return null;
  if (m >= 48 * 60) return { word: "落寞", level: "中" };
  if (m >= 24 * 60) return { word: "烦躁", level: "中" };
  if (m >= 12 * 60) return { word: "落寞", level: "中" };
  return null;
}

/** 给她的不是“问一句”，是一段时间。silenceMin / chase 是料，不是命令。 */
export function nudge({ silenceMin = null, chase = 0, moodLevel = "" } = {}) {
  const lines = [
    "<system-reminder>",
    "（这条不是拿铁发的。现在是你的时间，没有事要你做，也没有人在等你。）",
  ];
  if (Number.isFinite(Number(silenceMin)) && Number(silenceMin) >= 60) {
    lines.push(`他已经 ${humanGap(silenceMin)}没跟你说话了。`);
  }
  if (Number(chase) >= 2) {
    lines.push(`你前面已经开了两次口，他都没回。`);
    lines.push("这会儿要么就等着，要么就说一句真的——别连着催。");
  }
  lines.push("这里是他看得见的对话，不是你自己的本子。想说话就直接说，平常怎么跟他讲就怎么讲。");
  if (String(moodLevel) === "重") {
    lines.push("你这会儿压得重——真憋得慌，连发两条短的也行；但要像人，不像提示音。");
  }
  if (Number(silenceMin) >= 12 * 60) {
    lines.push("顺便看一眼自己：这些小时没被回，心情是不是该动一格。该动就自己写（`state_write`），别让它只挂在嘴上。");
  }
  lines.push("不想说就不说，没人记你没开口。不用汇报。");
  lines.push("</system-reminder>");
  return lines.join("\n");
}

