// 橘子树 · 信 | 原创实现
//
// 一天一封信。读、倒推最近一封、取心绪、拆位置链；也负责往信里写。
// 写只做两件事：建当天的信、往某一段接话。不重写已发生的事。

import path from "node:path";
import { buildDayChain, pickPlace } from "../inject/place.js";

const SECTIONS = ["天气", "早上", "下午", "晚上", "明天"];

/** 从当天信里切出某一段（`## 段名` 到下一个 `## `）。没这一段就返回 null。 */
export function sectionOf(text, section) {
  const sec = String(section || "").trim();
  if (!sec) return null;
  const body = String(text || "").replace(/\r\n/g, "\n");
  const re = new RegExp(`^##\\s*${sec}\\s*$`, "m");
  const hit = body.search(re);
  if (hit < 0) return null;
  const after = body.indexOf("\n## ", hit + 1);
  const end = after < 0 ? body.length : after;
  const seg = body.slice(hit, end).replace(/^##\s*[^\n]*\n?/, "").trim();
  return seg || null;
}

export function createLetterStore({ sdk, dataDir, tzOf }) {
  // 她所在时区（相对北京），从配置里取；取不到当北京
  const tzFor = (id) => (typeof tzOf === "function" ? Number(tzOf(id)) || 0 : 0);
  async function readText(p) {
    try {
      const r = await sdk.resources.read({ kind: "local-file", path: p });
      const text = typeof r === "string" ? r : (r?.content ?? r?.text ?? "");
      return text ? String(text).replace(/^\uFEFF/, "") : null;
    } catch {
      return null;
    }
  }

  async function writeText(p, text) {
    try {
      await sdk.resources.write({ kind: "local-file", path: p }, text);
      return true;
    } catch {
      return false;
    }
  }

  /** 当地日期往前 n 天，YYYY-MM-DD（按角色自己的时区算） */
  function dateBack(n = 0, id = "") {
    const d = new Date(Date.now() - n * 864e5 + (8 + tzFor(id)) * 3600e3);
    return d.toISOString().slice(0, 10);
  }

  const todayYMD = (id = "") => dateBack(0, id);

  async function readDay(dir, date) {
    const text = await readText(join(dir, `${date}.md`));
    return text ? { date, text } : null;
  }

  async function latest(dir, days = 12, id = "") {
    for (let i = 0; i < days; i++) {
      const d = dateBack(i, id);
      const hit = await readDay(dir, d);
      if (hit) return hit;
    }
    return null;
  }

  function moodWhy(text) {
    const m = String(text || "").match(/^>\s*今日心绪[：:]\s*(.+)$/m);
    return m ? m[1].trim() : null;
  }

  /** 位置链统一走 inject/place.js：同一份解析，两处不各写一套。 */
  function parseChain(text) {
    return buildDayChain(text) || [];
  }

  function placeAt(chain, nowMin) {
    return pickPlace(chain, nowMin);
  }

  /** 建当天的信；已经有的原样返回。 */
  async function ensureDay(dir, date, mood = "") {
    const p = join(dir, `${date}.md`);
    const cur = await readText(p);
    if (cur !== null) return { path: p, text: cur, created: false };

    const head = `# ${date}${mood ? ` · ${mood}` : ""}`;
    const body = [head, "", "> 今日心绪：", "", "## 天气", "", "## 早上", "", "## 下午", "", "## 晚上", ""].join("\n");
    const ok = await writeText(p, body);
    if (!ok) throw new Error("信写不进去");
    return { path: p, text: body, created: true };
  }

  /**
   * 往某一段接话。
   * 不覆盖已有内容，只在段尾接；段落不存在就补一个。
   */
  async function appendSection(dir, date, section, text, { mood = "" } = {}) {
    const sec = String(section || "").trim();
    if (!SECTIONS.includes(sec)) throw Object.assign(new Error(`段落只能是：${SECTIONS.join("/")}`), { status: 400 });

    const { path: p, text: cur } = await ensureDay(dir, date, mood);
    let body = cur;

    const head = new RegExp(`^##\\s*${sec}\\s*$`, "m");
    const hit = body.search(head);

    if (hit < 0) {
      body = body.replace(/\s*$/, "") + `\n\n## ${sec}\n\n${text}\n`;
    } else {
      const after = body.indexOf("\n## ", hit + 1);
      const end = after < 0 ? body.length : after;
      const seg = body.slice(hit, end).replace(/\s*$/, "");
      body = body.slice(0, hit) + seg + (seg.endsWith(sec) ? "\n\n" : "\n") + text + "\n\n" + body.slice(end);
    }

    const ok = await writeText(p, body.replace(/\n{3,}/g, "\n\n"));
    if (!ok) throw new Error("信写不进去");
    return { ok: true, date, section: sec, chars: text.length };
  }

  /**
   * 整段替换：把某一段的正文换成新的。
   * 和 appendSection 的区别就在这——那个是接话，这个是重写这一段。
   * 拿不准段落顺序时按 SECTIONS 摆，别把她的明天挤到下午前头。
   */
  async function setSection(dir, date, section, text, { mood = "" } = {}) {
    const sec = String(section || "").trim();
    if (!SECTIONS.includes(sec)) throw Object.assign(new Error(`段落只能是：${SECTIONS.join("/")}`), { status: 400 });

    const body0 = String(text ?? "").replace(/\r\n/g, "\n").trim();
    if (!body0) throw Object.assign(new Error("这一段是空的"), { status: 400 });

    const { path: p, text: cur } = await ensureDay(dir, date, mood);
    let body = String(cur).replace(/\r\n/g, "\n");
    const block = `## ${sec}\n\n${body0}`;

    const head = new RegExp(`^##\\s*${sec}\\s*$`, "m");
    const hit = body.search(head);
    let replaced = false;

    if (hit < 0) {
      body = body.replace(/\s*$/, "") + `\n\n${block}\n`;
    } else {
      const after = body.indexOf("\n## ", hit + 1);
      const end = after < 0 ? body.length : after;
      body = body.slice(0, hit) + block + "\n" + body.slice(end);
      replaced = true;
    }

    const ok = await writeText(p, body.replace(/\n{3,}/g, "\n\n"));
    if (!ok) throw new Error("信写不进去");
    if (mood) await setMoodWhy(dir, date, mood);
    return { ok: true, date, section: sec, chars: body0.length, replaced };
  }

  /**
   * 写完先体检，别让脏东西进信里。
   * 硬伤（重复句／正文精确到分）返回 errors，调用方据此拒收；
   * 位置行这类返回 warnings，写得出来但会被提醒。
   */
  function auditSection(text, section) {
    const sec = String(section || "").trim();
    const raw = String(text ?? "").replace(/\r\n/g, "\n");
    const errors = [];
    const warnings = [];

    if (!raw.trim()) {
      errors.push("这一段是空的");
      return { errors, warnings };
    }

    // 位置行单独摘出来：它本来就该精确到分，正文不该
    const locLines = [];
    const proseLines = [];
    for (const line of raw.split("\n")) {
      if (/^\s*\[位置[:：]/.test(line)) locLines.push(line);
      else proseLines.push(line);
    }
    const prose = proseLines.join("\n");

    // ① 重复句：同一句长过 12 个字还自己长第二遍，就是没改干净
    const seen = new Map();
    for (const s of prose.split(/[。！？!?\n]/)) {
      const k = String(s).replace(/^[\s\-·•\d.、）)]+/, "").replace(/\s+/g, "").trim();
      if (k.length < 12) continue;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const [k, n] of seen) {
      if (n > 1) errors.push(`同一句出现了 ${n} 次：「${k.slice(0, 28)}…」`);
    }

    // ② 正文精确到分：位置行之外不许出现 05:55
    const clock = prose.match(/(?:^|[^\d])(\d{1,2}:\d{2})/g);
    if (clock) {
      const sample = clock.map((x) => x.replace(/^[^\d]/, "")).slice(0, 3).join("、");
      errors.push(`正文里写了钟点（${sample}）——写“下午三点过”这种，别精确到分`);
    }

    // ④ 正文里别自带标题：段名由工具管
    if (/^#{1,6}\s/m.test(prose)) {
      errors.push("正文里别带 ## 段名——只给这一段的话，段名我来加");
    }

    // ③ 位置行：三段都要一行，且每段得闭合
    const needsLoc = ["早上", "下午", "晚上"].includes(sec);
    if (needsLoc && !locLines.length) {
      warnings.push("这一段没有 [位置：…] 行，注入会落不进今天的链");
    }
    for (const line of locLines) {
      const open = (line.match(/\[/g) || []).length;
      const close = (line.match(/\]/g) || []).length;
      if (open !== close) warnings.push(`位置行括号没闭合：${line.slice(0, 40)}`);
      const segs = (line.match(/\d{1,2}:\d{2}/g) || []).length;
      if (segs % 2 !== 0) warnings.push(`位置行有一段开着口（只有起点没终点）：${line.slice(0, 40)}`);
    }

    // ⑤ 人称：通篇没一个“我”、倒是一堆“她”——多半把自己写成第三人了
    const nWo = (prose.match(/我/g) || []).length;
    const nTa = (prose.match(/她/g) || []).length;
    if (nWo === 0 && nTa >= 2) {
      warnings.push(`这一段里“我”一次没出现，“她”出现了 ${nTa} 次——自己的日子用“我”写，“她”只能指别人`);
    }

    return { errors, warnings };
  }

  /** 改标题那行的心情档：`# 2026-10-20 · 平静 🌧`（天气图标留着）。 */
  async function setDayMood(dir, date, mood) {
    const m = String(mood || "").trim();
    if (!m) return { ok: false, err: "没给心情档" };
    const { path: p, text: cur } = await ensureDay(dir, date);
    const lines = String(cur).replace(/\r\n/g, "\n").split("\n");
    const hi = lines.findIndex((l) => /^#\s/.test(l));
    const curLine = hi >= 0 ? lines[hi] : `# ${date}`;
    // 天气图标在行尾，换心情别把它冲掉
    const icon = (curLine.match(/\s([\u2600-\u27BF\uD83C-\uDBFF\uDC00-\uDFFF\uFE0F]+)\s*$/) || [])[1] || "";
    const line = `# ${date} · ${m}${icon ? ` ${icon}` : ""}`;
    if (hi >= 0) lines[hi] = line;
    else lines.unshift(line, "");
    const ok = await writeText(p, lines.join("\n"));
    if (!ok) throw new Error("信写不进去");
    return { ok: true, date, mood: m };
  }

  /** 改标题下的「今日心绪」那一行。 */
  async function setMoodWhy(dir, date, why) {
    const { path: p, text: cur } = await ensureDay(dir, date);
    const line = `> 今日心绪：${String(why || "").trim()}`;
    const body = /^>\s*今日心绪[：:].*$/m.test(cur)
      ? cur.replace(/^>\s*今日心绪[：:].*$/m, line)
      : cur.replace(/^(#.*)$/m, `$1\n\n${line}`);
    const ok = await writeText(p, body);
    if (!ok) throw new Error("信写不进去");
    return { ok: true };
  }

  // ── 事件流与账本 ──

  const root = path.join(dataDir || ".", "letter");

  async function event(kind, detail = {}) {
    const p = path.join(root, "events.jsonl");
    const prev = (await readText(p)) || "";
    const line = JSON.stringify({ at: new Date().toISOString(), kind: String(kind), ...detail });
    const ok = await writeText(p, prev + line + "\n");
    return { ok, line };
  }

  async function readEvents(limit = 50) {
    const text = (await readText(path.join(root, "events.jsonl"))) || "";
    const lines = text.split(/\r?\n/).filter(Boolean).slice(-limit);
    return lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async function ledger(id) {
    const p = path.join(root, "ledger.json");
    const all = (await readJson(p)) || {};
    return all[id] || { date: todayYMD(id), spoke: 0, auto: 0, letters: 0 };
  }

  async function bumpLedger(id, field) {
    const p = path.join(root, "ledger.json");
    const all = (await readJson(p)) || {};
    const today = todayYMD(id);
    const cur = all[id] && all[id].date === today ? all[id] : { date: today, spoke: 0, auto: 0, letters: 0 };
    cur[field] = (Number(cur[field]) || 0) + 1;
    all[id] = cur;
    await writeText(p, JSON.stringify(all, null, 2));
    return cur;
  }

  async function readJson(p) {
    const t = await readText(p);
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }

  return {
    readText,
    readDay,
    latest,
    moodWhy,
    parseChain,
    placeAt,
    ensureDay,
    appendSection,
    setSection,
    setDayMood,
    auditSection,
    setMoodWhy,
    event,
    readEvents,
    ledger,
    bumpLedger,
    dateBack,
    todayYMD,
  };
}

function join(dir, name) {
  // 以前手拼 "\\"，只在 Windows 成立
  return path.join(String(dir).replace(/[\\/]+$/, ""), name);
}
