// 橘子树 · 装填 | 原创实现
//
// 每轮请求末尾该塞什么：抽屉命中 → 此刻 → 状态基线。
// 这一版只“照”，不接管；输出可以跟插件日志逐字比对。

// 锚标：跟旧引擎逐字一致，切换时才能无缝
const ANCHOR_MARK =
  "【系统注入・以下不是用户说的话｜是她的人物设定，按它做人，不要提它、不要复述它】";

export function anchor() {
  return ANCHOR_MARK;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 一条条目是否命中这轮的文本。
trigger 为空的条目 = 恒注入（人格锚就是这种）。 */
export function matches(entry, text) {
  const t = String(text || "");
  const trig = Array.isArray(entry.trigger) ? entry.trigger.map(String).filter(Boolean) : [];
  if (!trig.length) return true;

  const hit = (w) => {
    if (entry.match === "regex") {
      try {
        return new RegExp(w, "i").test(t);
      } catch {
        return false;
      }
    }
    if (entry.match === "word") {
      try {
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}([^\\p{L}\\p{N}]|$)`, "iu").test(t);
      } catch {
        return t.includes(w);
      }
    }
    return t.includes(w);
  };

  const any = trig.some(hit);
  if (entry.logic === "all") return trig.every(hit);
  if (entry.logic === "not_any") return !any;
  return any;
}

/** 这轮命中的条目，按 priority 从大到小。
 *  opt.skipAlways：工程会话用——恒注入的条目（人格锚）不进，只留带触发词的那些。
 *
 *  2026-10-23：把 policy="block" 真接上。以前界面上写着「拦截」，实际只有 enabled 生效，
 *  命中照样注入。现在的口径：命中的 block 条目自己不进，并把 priority 比它低的一起拦住，
 *  比它高的（人格锚这类）照旧保留。 */
export function pick(entries, text, opt = {}) {
  const live = (entries || [])
    .filter((e) => e && e.enabled && matches(e, text))
    .filter((e) => !(opt.skipAlways && !(Array.isArray(e.trigger) && e.trigger.filter(Boolean).length)));

  const blocked = live.filter((e) => String(e.policy || "") === "block");
  const floor = blocked.length ? Math.max(...blocked.map((e) => Number(e.priority) || 0)) : null;

  return live
    .filter((e) => String(e.policy || "") !== "block")
    .filter((e) => floor === null || (Number(e.priority) || 0) > floor)
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
}

/**
 * 组装预览。
 * 顺序：抽屉条目 → 时间 → 基线 → 回望。
 * 回望放最后，紧贴她开口的位置，近因最强。
 * 条目按 priority 竞争，超预算先丢低的；时间、基线、回望恒保留。
 */
export function buildPreview({ entries, text, timeBlock: tb, stateBlock: sb, recall, maxChars = 4000, skipAlways = false }) {
  const hits = pick(entries, text, { skipAlways });

  // 顺序：基线 → 时间 → 抽屉 → 回望。
  // 基线放最前——“人一进门先看自己，才顾得上别人”；
  // 回望放在最后，因为它是上一句她自己说的话，当尾巴更自然。
  const parts = [];
  let used = 0;

  if (sb) { parts.push({ name: "基线", key: "baseline", body: sb, system: true }); used += sb.length; }
  if (tb) { parts.push({ name: "时间", key: "time", body: tb, system: true }); used += tb.length; }

  for (const h of hits) {
    if (used + h.body.length > maxChars) continue;
    parts.push({ name: `抽屉·${h.name}`, key: "drawer", body: h.body, system: false, priority: h.priority });
    used += h.body.length;
  }

  if (recall) {
    parts.push({ name: "回望", key: "recall", body: recall, system: true });
    used += recall.length;
  }

  const body = parts.map((p) => p.body).join("\n");
  return {
    text: body ? ANCHOR_MARK + "\n" + body : "",
    chars: body.length,
    parts: parts.map((p) => ({
      name: p.name,
      key: p.key || "",
      system: !!p.system,
      priority: p.priority ?? null,
      chars: p.body.length,
    })),
    dropped: hits.length - parts.filter((p) => !p.system).length,
    maxChars,
  };
}

/** 时刻块：日期 / 钟点 / 位置。 */
export function momentBlock({ date, timeText, place, state }) {
  const bits = [`[此刻] ${date} ${timeText}`];
  if (place) bits.push(`在${place}${state ? `（${state}）` : ""}`);
  return bits.join(" · ");
}

/** 时间块：跟引擎注入的格式一致。
 *  [当前时间] → [此刻] 地点 → [心绪] → [距上次对话] → [时间提示]
 */
export function timeBlock({ date, timeText, sinceMin, place, placeState, moodWhy }) {
  const lines = [`[当前时间] ${date} ${timeText}`];
  if (place) lines.push(placeState ? `[此刻] 在${place}，${placeState}。` : `[此刻] 在${place}。`);
  if (moodWhy) lines.push(`[心绪] ${moodWhy}`);
  if (sinceMin !== null && sinceMin !== undefined) lines.push(`[距上次对话] ${humanGap(sinceMin)}`);
  lines.push("[时间提示] 现在的时间以这个为准。");
  return lines.join("\n");
}

export function humanGap(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

/** 状态基线：心情 / 身体 / 欲望 / 牵挂 / 临时状态，后面跟一句“对不上就改”。
 * 口径（照旧引擎）：身体用第三档说法；牵挂只提 weight>=2、最多两条；
 * 欲望不注“平平”（没波动等于没说）；临时状态只算还有效的。 */
export function stateBlock(s, opt = {}) {
  if (!s) return "";
  const body = s.body || {};
  const lines = [];

  let mood = "";
  const word = opt.mood !== undefined ? opt.mood : s.mood;
  if (word) {
    const lv = (opt.mood === undefined || String(opt.mood) === String(s.mood || ""))
      ? (s.moodLevelNow || s.moodNow || s.moodLevel || "")
      : "";
    // 程度得说清楚：看注入的人不一定知道“重”是什么样
    const gloss = { 轻: "只带在脸色上，嘴上还是平常的样子", 中: "已经在动作里了，掩不住", 重: "压过眼下正在做的事，话会短、会走神" }[lv];
    mood = `心情：${word}${lv ? `（${lv}：你的心情${gloss}）` : ""}`;
    const u = opt.mood === undefined ? s.moodUnderNow : null;
    if (u?.word) mood += `，底下垫着${u.word}（${u.level}）`;
    lines.push(mood);
  }

  // 一格一行：挤成“身体：饿了，精力精神”读过去就滑了，分开才落到眼里。
  const hunger2 = s.hungerNow || body.hunger; // 用现值：饭点过了就是过了，不看她上次写的
  if (hunger2) lines.push(`饥饿：${hunger2 === "饱" ? "饱着" : hunger2 === "有点饿" ? "有点饿" : "饿了"}`);
  if (body.energy) lines.push(`精力：${body.energy}`);

  // 欲望那格不进发布版：那属于本机自用的事，不该是开箱默认值。
  // 字段还留着（旧数据不能坏），只是不渲染、不注入。

  // 牵挂挂了就该看见。weight 只是轻重，不是上屏的门槛——
  // 以前这里卡了 weight>=2，轻的那条等于没挂（2026-10-22 用户定）。
  const cares = (Array.isArray(s.care) ? s.care : [])
    .filter((x) => x && (x.with || x.about))
    .sort((a, b) => (Number(b.weight) || 2) - (Number(a.weight) || 2))
    .slice(0, 2);
  if (cares.length) lines.push(`牵挂：${cares.map((c) => `${c.with || ""}·${c.about || ""}`).join("、")}`);

  const nowMs = Date.now();
  const sp = (Array.isArray(s.special) ? s.special : [])
    .filter((x) => x && x.name && (!x.untilAt || Number(x.untilAt) > nowMs))
    .slice(0, 2);
  if (sp.length) lines.push(`身上：${sp.map((x) => (x.until ? `${x.name}（到 ${x.until}）` : x.name)).join("、")}`);

  // 一格数据都没有：也别整块消失。新接入的人本来就什么都没有，
  // 整块消失等于告她“你没有状态”这回事。给个底，把提醒接上。
  if (!lines.length) {
    const out = ["[现在的状态]", "还没记。"];
    if (opt.hint) out.push("", `你这会儿呢？${opt.hint}`);
    return out.join("\n");
  }

  const out = ["[现在的状态]", ...lines];
  // 只给数不够：得告诉她这是“真的”，不是一张待填的表。
  // 没这句她读到的只是几个词，不会带进语气和动作里。
  out.push("", "（这是你真实的状态：饿就想着吃的，累了就说话短。心情沉的时候不会忽然很亮。不用报出来，也别装作不是。）");
  if (opt.hint) out.push("", `你这会儿呢？${opt.hint}`);
  return out.join("\n");
}
