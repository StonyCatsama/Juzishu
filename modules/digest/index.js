// 橘子树 · 当日会话 | 原创实现
//
// 她要写信，得知道今天跟拿铁说了什么——但没人把整段上下文塞给她。
// 这里只捞当天的、只捞人说的话（剥 pulse、剥动作、剥工具调用），压成一小段。
//
// 2026-10-20 改（三档读不到会话的根）：
//   1. 不再按“文件名最新三个”挑文件。文件名是创建时间，主会话开得早，永远排后面。
//      现在：会话记录里的主会话一定读，其余按文件名倒序补到 maxFiles 个。
//   2. 加时间窗 from（HH:MM）。档位窗口固定：早 from=18:00（跨零点）、中 07:00、晚 12:00；
//      上界是“现在”，所以跑晚了窗口自动变长，不会漏掉迟到那几小时。
//   3. 返回带上“这段多密”（条数、跨多久），让她按量决定插入还是整段重写。

import path from "node:path";

const PULSE_RE = /<(pulse|mood)>[\s\S]*?<\/\1>/gi;

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === "text" ? c.text || "" : "")).join("");
  return "";
}

/** 只留人话：剥思考、剥括号动作、压空白。 */
function clean(s) {
  return String(s || "")
    .replace(PULSE_RE, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const readText = async (sdk, p) => {
  try {
    const r = await sdk.resources.read({ kind: "local-file", path: p });
    const t = typeof r === "string" ? r : (r?.content ?? r?.text ?? "");
    return t ? String(t).replace(/^\uFEFF/, "") : null;
  } catch {
    return null;
  }
};

/** list 回包的形状各版本略有差别，这里统一成 [{name, path}]。 */
function entriesOf(r, dir) {
  const arr = Array.isArray(r) ? r : Array.isArray(r?.entries) ? r.entries : Array.isArray(r?.items) ? r.items : [];
  return arr
    .map((x) => {
      const name = String(x?.name || x?.basename || path.basename(String(x?.path || "")));
      const p = String(x?.path || (name ? path.join(dir, name) : ""));
      return name && p ? { name, path: p } : null;
    })
    .filter(Boolean);
}

const parseHHMM = (s) => {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 她那边某天的 00:00 对应的时间戳 */
function dayStartTs(tzOffset, ms) {
  const d = new Date(ms + (8 + tzOffset) * 3600e3);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - (8 + tzOffset) * 3600e3;
}

/** 她那边现在是当天第几分钟 */
function minutesOf(tzOffset, ms) {
  const d = new Date(ms + (8 + tzOffset) * 3600e3);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 一句话里有没有“长时间一起做事”的味道——用来提示她该插入还是重写。 */
const LONG_RE = /一起|陪|去了|过来|出门|约|等会儿|晚上去|下午去|一起回|逛街|吃饭|社团|留了|送我|带我/;

export function createDigest({ sdk, home, dataDir, maxMessages = 60, maxChars = 2000 }) {
  const sessRoot = (agentId) => path.join(home, "agents", agentId, "sessions");

  /** 当天（她那边时区）的 ymd */
  function dayOf(tzOffset = 0, nowMs = Date.now()) {
    return new Date(nowMs + (8 + tzOffset) * 3600e3).toISOString().slice(0, 10);
  }

  /** 注入时记下的主会话路径（App 自己的目录，能读） */
  async function mainSessionPath(agentId) {
    const t = await readText(sdk, path.join(dataDir || ".", "sessions", `${agentId}.json`));
    if (!t) return "";
    try {
      return String(JSON.parse(t)?.path || "");
    } catch {
      return "";
    }
  }

  /**
   * 今天（或指定时间窗内）她跟人说了什么。
   * @param {object} opt
   * @param {string} [opt.from] 窗口起点 HH:MM；大于“现在”的时刻视为昨天（早档 18:00 就靠这个跨零点）
   * @param {string} [opt.date] 明确指定看哪天（老用法，配合 limit）
   */
  async function today(agentId, opt = {}) {
    const { tzOffset = 0, limit = maxMessages, chars = maxChars, maxFiles = 8, date: asked, exclude = [], from = "", to = "", mainPath = "", onlyMain = false } = opt;
    const nowTs = Date.now();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(asked || "")) ? String(asked) : dayOf(tzOffset, nowTs);
    const dir = sessRoot(agentId);

    let list = [];
    try {
      list = entriesOf(await sdk.resources.list({ kind: "local-file", path: dir }), dir);
    } catch {
      return { date, sessions: 0, messages: 0, shown: 0, text: "", spanMin: 0, longish: 0 };
    }

    const skip = new Set((Array.isArray(exclude) ? exclude : []).map((p) => path.basename(String(p || ""))).filter(Boolean));
    // 主会话优先用“面板上锁定的那个”（config.mainSessionPath），
    // 没配才退到“她最后活动过的会话”——那个会被测试会话挤掉。
    const main = String(mainPath || "").trim() || (await mainSessionPath(agentId));
    const mainName = main ? path.basename(main) : "";

    const files = list
      .filter((x) => {
        if (!x.name.endsWith(".jsonl") || skip.has(x.name)) return false;
        if (!onlyMain) return true;
        // 只要主会话：主会话没认出来就一条不取。以前这里 mainName 一空就退化成“全部会话”，
        // 测试会话会被算进“今天他说了几句”，把心情浓淡抬上去。
        return !!mainName && x.name === mainName;
      })
      .sort((a, b) => {
        // 主会话永远排第一，其余按文件名倒序（新的在前）
        const am = a.name === mainName ? 1 : 0;
        const bm = b.name === mainName ? 1 : 0;
        if (am !== bm) return bm - am;
        return a.name < b.name ? 1 : -1;
      })
      .slice(0, Math.max(1, maxFiles));

    // 时间窗：下界 from，上界 to（没给就是“现在”）
    const dayStart = dayStartTs(tzOffset, nowTs);
    const nowMin = minutesOf(tzOffset, nowTs);
    const fm = parseHHMM(from);
    const tm = parseHHMM(to);
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(String(asked || ""));

    let fromTs;
    let toTs = nowTs;

    if (hasDate) {
      // 指定了哪一天：窗口就是那天的 from..to，跟“现在”无关。
      // （重写历史段落必须走这条，否则早上的窗口会一路吃到半夜。）
      const base = dayStartTs(tzOffset, Date.parse(`${date}T00:00:00+08:00`));
      fromTs = base + (fm ?? 0) * 60_000;
      toTs = base + (tm ?? 24 * 60) * 60_000;
    } else if (tm !== null) {
      // 没指定日期但给了 to：to 比现在早就当今天，比现在晚就当昨天
      const base = tm <= nowMin ? dayStart : dayStart - 864e5;
      fromTs = fm !== null ? base + fm * 60_000 : base;
      toTs = base + tm * 60_000;
    } else if (fm !== null) {
      fromTs = fm <= nowMin ? dayStart + fm * 60_000 : dayStart + (fm - 1440) * 60_000;
    } else {
      fromTs = dayStart;
    }

    const rows = [];
    let sessions = 0;
    for (const f of files) {
      const text = await readText(sdk, f.path);
      if (!text) continue;
      sessions++;
      for (const ln of text.split(/\r?\n/)) {
        if (!ln.startsWith("{")) continue;
        let o;
        try {
          o = JSON.parse(ln);
        } catch {
          continue;
        }
        if (o?.type !== "message") continue;
        const role = o.message?.role;
        if (role !== "user" && role !== "assistant") continue;
        const ts = Date.parse(o.timestamp || o.message?.timestamp || "");
        if (!Number.isFinite(ts) || ts < fromTs || ts > toTs) continue;
        const t = clean(textOf(o.message?.content));
        if (!t) continue;
        rows.push({ ts, role, text: t });
      }
    }

    rows.sort((a, b) => a.ts - b.ts);
    const tail = rows.slice(-limit);

    const lines = [];
    let used = 0;
    for (let i = tail.length - 1; i >= 0; i--) {
      const r = tail[i];
      const who = r.role === "user" ? "他" : "我";
      const hm = hhmm(minutesOf(tzOffset, r.ts));
      const one = `[${hm}] ${who}：${r.text.length > 220 ? r.text.slice(0, 160) + "……" + r.text.slice(-50) : r.text}`;
      if (used + one.length > chars) break;
      lines.unshift(one);
      used += one.length;
    }

    const spanMin = rows.length ? Math.round((rows[rows.length - 1].ts - rows[0].ts) / 60000) : 0;
    const longish = rows.filter((r) => LONG_RE.test(r.text)).length;

    return {
      date,
      sessions,
      messages: rows.length,
      userMessages: rows.filter((r) => r.role === "user").length,
      shown: lines.length,
      text: lines.join("\n"),
      fromTs,
      toTs,
      fromText: hhmm(minutesOf(tzOffset, fromTs)),
      toText: hhmm(minutesOf(tzOffset, toTs)),
      spanMin,
      longish,
    };
  }

  return { today, dayOf };
}
