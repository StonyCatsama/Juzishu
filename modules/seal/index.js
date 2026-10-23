// 橘子树 · 状态核心 | 原创实现
//
// 唯一写口。面板、工具、时钟都从这里写，谁都不许直接改状态文件。
// 心情按两层存：底面（七格固定枚举）+ 深浅（轻/中/重三档）。
// 朝向不进枚举——它是各人对谁表达出来的事，存字段、不存词表。

import path from "node:path";

export const ENUMS = {
  // 底面七格：随时都会有几格同时压着，这里只记最沉的那个
  mood: ["满足", "开心", "平静", "烦躁", "委屈", "低落", "落寞"],
  // 深浅三档：轻 = 带在脸色上；中 = 已经在动作里；重 = 压过眼下正在做的事
  moodLevel: ["轻", "中", "重"],
  hunger: ["饱", "有点饿", "饿"],
  energy: ["精神", "有点乏", "累"],
  desire: ["不想", "一般", "想", "主动"],
};

/** 三档的强度，只用来算回落，不往描写里塞数字。 */
export const MOOD_LEVEL_VALUE = { 轻: 1, 中: 2, 重: 3 };
export const MOOD_LEVEL_BY_VALUE = { 1: "轻", 2: "中", 3: "重" };

/** 旧词 → 新七格（拿铁 2026-10-19 定）。原词留一笔，不丢。 */
export const MOOD_LEGACY = {
  懒散: "落寞",
  想他: "满足",
  傲娇: "委屈",
};

/** 心情的旋钮；config 里传进来的覆盖它们。 */
export const MOOD_DEFAULTS = {
  halfLifeH: 6, // 回落：每这么多小时轻一档
  minHoldMin: 40, // 刚换过词就不再抢词
  strongLevel: 2, // 档位差这么多，防抖让路
};

const EMPTY = {
  mood: "",
  moodLevel: "",
  moodUnder: null,
  care: [],
  body: { hunger: "", energy: "" },
  special: [],
  desire: "",
  place: null,
  updatedAt: null,
  tsLocal: null,
};

/** 本地时间串：2026-10-19 周一 12:50 */
export function nowLocal() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("weekday")} ${g("hour")}:${g("minute")}`;
}

/** 北京日期：2026-10-19 */
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * 值域校验。空串允许（清空是合法操作），非法值不写。
 * 容错：包含关系也算命中，避免“很饱”这类写法被顶成首项。
 */
export function norm(value, allowed) {
  const s = String(value ?? "").trim();
  if (!s) return { ok: true, v: "" };
  if (allowed.includes(s)) return { ok: true, v: s };
  const hit = allowed.find((a) => s.includes(a) || a.includes(s));
  if (hit) return { ok: true, v: hit, note: `「${s}」不在值域，归一到「${hit}」` };
  return { ok: false, v: s, note: `「${s}」不在值域（${allowed.join("/")}），未写入` };
}

export function createSealStore({ sdk, home, dataDir, mood, tzOf, talkCount, realMode }) {
  // 真实模式开着时，面板那条路彻底关上（by === "panel" 直接拒），只能她自己 state_write
  const isRealMode = () => {
    try { return typeof realMode === "function" ? !!realMode() : false; } catch { return false; }
  };
  // 她那边几点：时区表由上层传进来，取不到就按北京
  const tzFor = (id) => (typeof tzOf === "function" ? Number(tzOf(id)) || 0 : 0);
  const nowLocalFor = (id) => {
    const d = new Date(Date.now() + (8 + tzFor(id)) * 3600e3);
    const p = d.toISOString();
    const wd = "日一二三四五六"[new Date(p.slice(0, 10) + "T00:00:00Z").getUTCDay()];
    return `${p.slice(0, 10)} 周${wd} ${p.slice(11, 16)}`;
  };
  const todayFor = (id) => new Date(Date.now() + (8 + tzFor(id)) * 3600e3).toISOString().slice(0, 10);
  const MC = { ...MOOD_DEFAULTS, ...(mood || {}) };
  const root = dataDir || home;
  const stateDir = path.join(root, "state");
  const fileOf = (id) => path.join(stateDir, `${id}.json`);
  // 旧位置只用于搬家，读完就再也不写它
  const legacySealOf = (id) => path.join(home, "state-desire", id, "seal.json");
  const legacyStatusOf = (id) => path.join(home, "state-desire", id, "status.json");

  async function readOne(p) {
    try {
      const r = await sdk.resources.read({ kind: "local-file", path: p });
      const text = typeof r === "string" ? r : (r?.content ?? r?.text ?? "");
      if (!text) return null;
      return JSON.parse(String(text).replace(/^\uFEFF/, ""));
    } catch {
      return null;
    }
  }

  /** 旧形状落成新形状：旧词换七格，缺程度补一档。没东西可改就返回 null。 */
  function fixLegacyWord(raw) {
    if (!raw) return null;
    const s = { ...raw };
    let changed = false;
    const before = String(s.mood || "").trim();
    if (before && !ENUMS.mood.includes(before)) {
      s.mood = MOOD_LEGACY[before] || "";
      s.moodLegacy = before;
      changed = true;
    }
    if (!ENUMS.moodLevel.includes(s.moodLevel)) {
      const lv = s.mood ? "中" : "";
      if (lv !== s.moodLevel) { s.moodLevel = lv; changed = true; }
    }
    return changed ? s : null;
  }

  async function readRaw(id) {
    const mine = await readOne(fileOf(id));
    if (mine) {
      // 迁移期写回一次：把旧词落成新七格，以后每次读都拿的是新词
      const fixed = fixLegacyWord(mine);
      if (!fixed) return mine;
      try {
        await sdk.resources.write({ kind: "local-file", path: fileOf(id) }, JSON.stringify(fixed, null, 2));
      } catch { /* 写不回去也照样用 */ }
      return fixed;
    }
    // 新位置还没有：从旧位置取新的一份，并搬过来
    const [a, b] = await Promise.all([readOne(legacySealOf(id)), readOne(legacyStatusOf(id))]);
    const pickOne = () => {
      if (a && b) return (Date.parse(b.updatedAt || "") || 0) > (Date.parse(a.updatedAt || "") || 0) ? b : a;
      return a || b;
    };
    const old = fixLegacyWord(pickOne());
    if (!old) return null;
    try {
      await sdk.resources.write({ kind: "local-file", path: fileOf(id) }, JSON.stringify(old, null, 2));
    } catch { /* 搬不过来也能用这一轮 */ }
    return old;
  }

  /** 旧位置还有东西就搬进新家（一次就好，搬完旧位置只当底稿）。已经搬过返回 false。 */
  async function migrateLegacy(id) {
    if (await readOne(fileOf(id))) return false;
    const [a, b] = await Promise.all([readOne(legacySealOf(id)), readOne(legacyStatusOf(id))]);
    const raw = (a && b)
      ? ((Date.parse(b.updatedAt || "") || 0) > (Date.parse(a.updatedAt || "") || 0) ? b : a)
      : (a || b);
    if (!raw) return false;
    const old = fixLegacyWord(raw) || raw;
    await sdk.resources.write({ kind: "local-file", path: fileOf(id) }, JSON.stringify(old, null, 2));
    return true;
  }

  /**
   * 补字段、补 since。
   * 老文件没有 since 的，用 updatedAt 顶——会失真（比如“开心”可能从昨晚就开始了），
   * 但比没有强；等数值化时再用第一次判定的时间覆盖。
   */
  function normalize(cur) {
    const s = { ...EMPTY, ...(cur || {}) };
    if (!Array.isArray(s.care)) s.care = [];
    if (!Array.isArray(s.special)) s.special = [];
    if (!s.body || typeof s.body !== "object") s.body = { hunger: "", energy: "" };
    const base = s.updatedAt || null;

    // 旧词迁到新七格：懒散→落寞、想他→满足、傲娇→委屈（原词留一笔，不丢）
    const rawMood = String(s.mood || "").trim();
    if (rawMood && !ENUMS.mood.includes(rawMood)) {
      const mapped = MOOD_LEGACY[rawMood];
      if (mapped) {
        s.moodLegacy = rawMood;
        s.mood = mapped;
      } else {
        s.mood = "";
        s.moodLegacy = rawMood;
      }
    }

    if (!ENUMS.moodLevel.includes(s.moodLevel)) s.moodLevel = s.mood ? "中" : "";
    if (s.moodSince === undefined) s.moodSince = s.mood ? base : null;
    if (s.moodAt === undefined) s.moodAt = s.moodSince || base || null;
    if (s.hungerSince === undefined) s.hungerSince = s.body.hunger ? base : null;
    if (s.energySince === undefined) s.energySince = s.body.energy ? base : null;
    if (s.desireSince === undefined) s.desireSince = s.desire ? base : null;
    // money 字段已下线（2026-10-23）。盘上还残着空串的，读的时候当不存在。
    if ("money" in s) delete s.money;
    return s;
  }

  /** 回落：每过一个半衰期，浅一档；浅到“轻”就不再降，也不自动抹掉词。 */
  function levelNow(level, atMs, cfg) {
    const v = MOOD_LEVEL_VALUE[level];
    if (!Number.isFinite(v) || !atMs) return level;
    const half = Math.max(0.5, Number(cfg?.halfLifeH) || MOOD_DEFAULTS.halfLifeH) * 3600e3;
    const steps = Math.floor(Math.max(0, Date.now() - atMs) / half);
    return MOOD_LEVEL_BY_VALUE[Math.max(1, v - steps)] || level;
  }

  /** 暗格回落：垫着的东西不需要她手动清——浅到零就自己散掉。 */
  function underNow(u, cfg) {
    if (!u || !u.word) return null;
    const v = MOOD_LEVEL_VALUE[u.level];
    if (!Number.isFinite(v)) return null;
    const half = Math.max(0.5, Number(cfg?.halfLifeH) || MOOD_DEFAULTS.halfLifeH) * 3600e3;
    const at = Date.parse(String(u.at || ""));
    const steps = Number.isFinite(at) ? Math.floor(Math.max(0, Date.now() - at) / half) : 0;
    const left = v - steps;
    if (left < 1) return null;
    return { word: u.word, level: MOOD_LEVEL_BY_VALUE[left] };
  }

  /** 饭点：每过一个，饱食度降一格（惰性，只在读的时候算） */
  const MEALS = [8, 12, 18];
  const MEAL_GUARD_MS = 90 * 60e3; // 刚写完“饱”的前 90 分钟不掉，免得刚吃完就变饿
  const HUNGER_IDX = { "饱": 0, "有点饿": 1, "饿": 2 };
  const HUNGER_BY_IDX = ["饱", "有点饿", "饿"];

  function mealSteps(fromMs, nowMs) {
    if (!Number.isFinite(fromMs) || nowMs <= fromMs) return 0;
    const from = fromMs + MEAL_GUARD_MS; // 保护期内的饭点不算
    if (nowMs <= from) return 0;
    const dayMs = 864e5;
    const shift = 8 * 3600e3; // 按北京时间的日子分割
    const d0 = Math.floor((from + shift) / dayMs);
    const d1 = Math.floor((nowMs + shift) / dayMs);
    let n = 0;
    for (let d = d0; d <= d1; d++) {
      for (const h of MEALS) {
        const t = d * dayMs - shift + h * 3600e3;
        if (t > from && t <= nowMs) n++;
      }
    }
    return n;
  }

  async function read(id) {
    const s = normalize(await readRaw(id));
    // 回落只在读的时候算一份现值，不写盘：盘上永远是她最后一次写下的那格
    s.moodNow = s.mood ? levelNow(s.moodLevel, s.moodAt ? Date.parse(s.moodAt) : null, MC) : null;
    s.moodUnderNow = underNow(s.moodUnder, MC);
    // 心情浓淡也跟着他：今天他说了多少句 → 淡/中/浓（7 句为中点）
    // 心情浓淡：跟他说话的句数算一份，沉默保底/回落算一份，取较强的那份
    let n = null;
    try { n = typeof talkCount === "function" ? await talkCount(id) : null; } catch { n = null; }
    s.talkToday = Number.isFinite(Number(n)) ? Number(n) : null;
    if (s.mood) {
      const byTalk = s.talkToday === null ? null : (s.talkToday >= 8 ? "重" : s.talkToday >= 5 ? "中" : "轻");
      const a = MOOD_LEVEL_VALUE[byTalk] || 0;
      const b = MOOD_LEVEL_VALUE[s.moodNow] || 0;
      s.moodLevelNow = MOOD_LEVEL_BY_VALUE[Math.max(a, b)] || s.moodNow || s.moodLevel;
    } else {
      s.moodLevelNow = s.moodNow;
    }
    // 饱食度：从上次写下的时间起，每过一个饭点降一格，最低到“饿”
    const base = HUNGER_IDX[s.body?.hunger];
    if (Number.isFinite(base) && s.hungerSince) {
      const steps = mealSteps(Date.parse(s.hungerSince), Date.now());
      s.hungerNow = HUNGER_BY_IDX[Math.min(2, base + steps)] || s.body.hunger;
    } else {
      s.hungerNow = s.body?.hunger || "";
    }
    return s;
  }

  /**
   * 写一格或几格。patch 与面板、工具的参数同形。
   * @returns {{ ok: boolean, notes: string[], status?: object, err?: string }}
   */
  async function write(id, patch = {}, by = "panel") {
    if (by === "panel" && isRealMode()) {
      return { ok: false, err: "真实模式：状态只能她自己改（关掉抽屉里的「真实模式」才能从面板写）", notes: [] };
    }
    const cur = await read(id);
    delete cur.moodNow; // 现值只在读的时候存在，不跟回盘里
    // read() 还会合出下面这几个派生值；以前只删了 moodNow，剩下四个跟着 write 一起躺进了 state 文件
    // （盘上能看到 talkToday/moodLevelNow/hungerNow）。moodValue 是旧版遗留键，一并清。
    for (const k of ["moodUnderNow", "moodLevelNow", "hungerNow", "talkToday", "moodValue"]) delete cur[k];
    const notes = [];
    const now = new Date().toISOString();

    if (patch.mood !== undefined) {
      const n = norm(patch.mood, ENUMS.mood);
      if (n.note) notes.push(n.note);
      if (n.ok) {
        const nowMs = Date.now();
        const nextLevel = ENUMS.moodLevel.includes(patch.moodLevel) ? patch.moodLevel : (cur.moodLevel || "中");
        const minHold = (Number(MC.minHoldMin) || 0) * 60_000;
        const held = cur.moodAt ? nowMs - Date.parse(cur.moodAt) : Infinity;

        if (!n.v) {
          cur.mood = "";
          cur.moodLevel = "";
          cur.moodSince = null;
          cur.moodAt = now;
          notes.push("心情清空");
        } else if (n.v === cur.mood) {
          // 同一个词重复写：不重置钟点，否则一直刷就把回落钉死了
          if (patch.moodLevel !== undefined && nextLevel !== cur.moodLevel) {
            cur.moodLevel = nextLevel;
            cur.moodAt = now;
            notes.push(`心情深浅=${cur.moodLevel}`);
          } else if (held < minHold) {
            notes.push(`心情没动（还是「${cur.mood}」，刚写过）`);
          } else {
            cur.moodAt = now;
          }
        } else {
          // 换词一律认：词是她说的，不由代码拦
          cur.mood = n.v;
          cur.moodLevel = nextLevel;
          cur.moodSince = now;
          cur.moodAt = now;
          notes.push(`心情=${cur.mood}（${cur.moodLevel}）`);
          if (cur.moodUnder?.word) {
            const uv = MOOD_LEVEL_VALUE[cur.moodUnder.level] || 0;
            const mv = MOOD_LEVEL_VALUE[cur.moodLevel] || 0;
            if (uv >= mv) notes.push(`暗格「${cur.moodUnder.word}」比主格还沉，要不要换过来？`);
          }
        }
      }
    }

    // 暗格（最多一条）：垫在最沉那格底下的那个味道
    if (patch.moodUnder !== undefined) {
      const raw = patch.moodUnder;
      if (raw === null || String(raw).trim() === "") {
        cur.moodUnder = null;
        notes.push("暗格清掉");
      } else {
        const n = norm(raw, ENUMS.mood);
        if (n.note) notes.push(n.note);
        if (n.ok && n.v) {
          const lv = ENUMS.moodLevel.includes(patch.moodUnderLevel) ? patch.moodUnderLevel : "轻";
          if (!cur.mood) {
            // 没主格就先把暗格提上来，否则垫着的东西永远看不见
            cur.mood = n.v;
            cur.moodLevel = lv;
            cur.moodSince = now;
            cur.moodAt = now;
            cur.moodUnder = null;
            notes.push(`没有主格，暗格提为主格：${cur.mood}（${cur.moodLevel}）`);
          } else if (n.v === cur.mood) {
            notes.push("暗格和主格是同一个词，忽略");
          } else {
            cur.moodUnder = { word: n.v, level: lv, at: now };
            notes.push(`暗格=${cur.moodUnder.word}（${cur.moodUnder.level}）`);
            const uv = MOOD_LEVEL_VALUE[lv] || 0;
            const mv = MOOD_LEVEL_VALUE[cur.moodNow || cur.moodLevel] || 0;
            if (uv >= mv) notes.push(`暗格比主格还沉，要不要换过来？`);
          }
        }
      }
    }

    if (patch.bodyHunger !== undefined) {
      const n = norm(patch.bodyHunger, ENUMS.hunger);
      if (n.note) notes.push(n.note);
      if (n.ok) {
        if (n.v !== cur.body.hunger) cur.hungerSince = now;
        cur.body.hunger = n.v;
        notes.push(`饿=${cur.body.hunger}`);
      }
    }

    if (patch.bodyEnergy !== undefined) {
      const n = norm(patch.bodyEnergy, ENUMS.energy);
      if (n.note) notes.push(n.note);
      if (n.ok) {
        if (n.v !== cur.body.energy) cur.energySince = now;
        cur.body.energy = n.v;
        notes.push(`精力=${cur.body.energy}`);
      }
    }

    if (patch.desire !== undefined) {
      const n = norm(patch.desire, ENUMS.desire);
      if (n.note) notes.push(n.note);
      if (n.ok) {
        if (n.v !== cur.desire) cur.desireSince = now;
        cur.desire = n.v;
        notes.push(`欲望=${cur.desire}`);
      }
    }

    if (patch.careAdd) {
      const { with: w = "", about = "", weight = 2 } = patch.careAdd;
      if (cur.care.length >= 3) {
        notes.push("牵挂已满 3 条（先解一个）");
      } else {
        cur.care.push({
          with: String(w),
          about: String(about),
          weight: Math.min(3, Math.max(1, Number(weight) || 2)),
          since: todayFor(id),
        });
        notes.push(`起结：${w}·${about}`);
      }
    }

    if (patch.careResolve !== undefined) {
      const kw = String(patch.careResolve).trim();
      if (!kw) {
        notes.push("解结关键词为空，已忽略");
      } else {
        const before = cur.care.length;
        cur.care = cur.care.filter(
          (x) => !(String(x.with).includes(kw) || String(x.about).includes(kw))
        );
        notes.push(before === cur.care.length ? `没有匹配「${kw}」的结` : `解结：${kw}`);
      }
    }

    if (patch.place !== undefined) {
      if (patch.place === null || patch.place === "") {
        cur.place = null;
        notes.push("清掉实况位置");
      } else {
        cur.place = { name: String(patch.place), since: now };
        notes.push(`位置→${cur.place.name}`);
      }
    }

    if (patch.placeClear) {
      cur.place = null;
      notes.push("清掉实况位置");
    }

    if (patch.specialAdd) {
      const { name: sn = "", effect = "", until = "" } = patch.specialAdd;
      cur.special.push({
        name: String(sn),
        effect: String(effect),
        until: String(until),
        untilAt: resolveUntil(until, Date.now()),
      });
      notes.push(`上状态：${sn}（到 ${until}）`);
    }

    if (patch.specialClear !== undefined) {
      const kw = String(patch.specialClear).trim();
      if (!kw) {
        notes.push("解状态关键词为空，已忽略");
      } else {
        const before = cur.special.length;
        cur.special = cur.special.filter((s) => !String(s.name).includes(kw));
        notes.push(before === cur.special.length ? `没有「${kw}」这个状态` : `解状态：${kw}`);
      }
    }

    cur.updatedAt = now;
    cur.tsLocal = nowLocalFor(id);

    try {
      const json = JSON.stringify(cur, null, 2);
      await sdk.resources.write({ kind: "local-file", path: fileOf(id) }, json);
    } catch (e) {
      return { ok: false, err: String(e?.code || e?.message || e), notes };
    }

    return { ok: true, notes, status: cur };
  }

  return { read, write, migrateLegacy, fileOf, enums: ENUMS, mood: MC };
}

/** "+3时"/"+30分"/"+2天"/"HH:MM" → 绝对时间戳；看不懂返回 null */
export function resolveUntil(until, nowMs) {
  const u = String(until || "").trim();
  if (!u) return null;
  const rel = u.match(/^\+(\d+)(天|时|小时|分)/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const ms = unit === "天" ? n * 864e5 : unit === "分" ? n * 6e4 : n * 36e5;
    return nowMs + ms;
  }
  const abs = u.match(/^(\d{1,2}):(\d{2})$/);
  if (abs) {
    const d = new Date(nowMs + 8 * 3600 * 1000);
    d.setUTCHours(parseInt(abs[1], 10), parseInt(abs[2], 10), 0, 0);
    let t = d.getTime() - 8 * 3600 * 1000;
    if (t <= nowMs) t += 864e5;
    return t;
  }
  return null;
}
