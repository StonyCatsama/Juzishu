// 橘子树 · 配置 | 原创实现
//
// 一个真源。代码里不出现绝对路径、不出现角色名。
// 本机配置放 data/config.json（不进发布包）；发布包只带 config.example.json。

import fs from "node:fs";
import path from "node:path";
import { offsetFromBeijing } from "../worldclock/index.js";

const DEFAULT = {
  schema: "juzishu.config/1",
  characters: [],
  paths: {},
  defaults: {
    timezone: "Asia/Shanghai",
    wake: { checkEveryMin: 21, quiet: ["01:00", "07:00"], maxPerDay: 4 },
    // 心情：七格底面 + 轻/中/重三档；这里只管回落快慢与重复写的护栏
    mood: { halfLifeH: 6, minHoldMin: 40, strongLevel: 2 },
    // 回望：白名单里的人、每轮把上一句自己说的话贴回去
    recall: { agents: [], minChars: 0, clip: 340, tailByAgent: {}, hintByAgent: {}, hintRecallByAgent: {} },
    // 工程会话：这些人在这些目录下干活时，只注工程锚
    work: { agents: [], dirs: [], anchors: {} },
    inject: { maxChars: 4000 },
  },
};

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

export function loadConfig({ appDir, dataDir }) {
  const localPath = path.join(dataDir || appDir, "config.json");
  const examplePath = path.join(appDir, "config.example.json");

  const raw = readJson(localPath) || readJson(examplePath) || {};
  const cfg = {
    ...DEFAULT,
    ...raw,
    characters: Array.isArray(raw.characters) ? raw.characters : [],
    paths: raw.paths && typeof raw.paths === "object" ? raw.paths : {},
    defaults: {
      ...DEFAULT.defaults,
      ...(raw.defaults || {}),
      wake: { ...DEFAULT.defaults.wake, ...((raw.defaults || {}).wake || {}) },
      mood: { ...DEFAULT.defaults.mood, ...((raw.defaults || {}).mood || {}) },
      recall: { ...DEFAULT.defaults.recall, ...((raw.defaults || {}).recall || {}) },
      work: { ...DEFAULT.defaults.work, ...((raw.defaults || {}).work || {}) },
      inject: { ...DEFAULT.defaults.inject, ...((raw.defaults || {}).inject || {}) },
    },
  };

  cfg.source = readJson(localPath) ? localPath : null;
  return cfg;
}

/** 写回本机配置。只动 data/config.json，不碰发布包。 */
export function saveConfig({ dataDir, cfg }) {
  const p = path.join(dataDir, "config.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  fs.renameSync(tmp, p);
  return p;
}

/** 校验：id 必填且唯一，窗口格式合法。 */
export function validateConfig(cfg) {
  const errors = [];
  const chars = Array.isArray(cfg?.characters) ? cfg.characters : [];
  const seen = new Set();

  for (const c of chars) {
    const id = String(c?.id || "").trim();
    if (!id) {
      errors.push("有角色没填 id");
      continue;
    }
    if (seen.has(id)) errors.push(`id 重复：${id}`);
    seen.add(id);

    for (const s of c.slots || []) {
      if (s.at && !/^\d{1,2}:\d{2}$/.test(String(s.at))) errors.push(`${id} 的 ${s.id} 时间格式不对`);
    }
  }
  return errors;
}
/**
 * 从配置派生各模块要用的表。
 *
 * 2026-10-23：信目录与提示词目录补默认值。以前两个字段空着就整条链路静默失败
 * （示例角色开箱没有信、没有位置、三档每档 warn），人得自己猜路径手填。
 * 现在：
 *   lettersDir 空 → <dataDir>/letters/<id>（App 自己的目录，可写）
 *   promptsDir 空 → 依次找 <dataDir>/characters/<id>/letters、<appDir>/characters/<id>/letters
 * 显式配了的一律不动。
 */
export function derive(cfg, opts = {}) {
  const chars = cfg.characters.filter((c) => c && c.id);
  const { appDir = "", dataDir = "" } = opts;

  const exists = (p) => {
    try { return !!p && fs.existsSync(p); } catch { return false; }
  };

  const agents = chars.map((c) => c.id);
  const names = Object.fromEntries(chars.map((c) => [c.id, c.name || c.id]));
  // tz = 相对北京的偏移，从角色的真实时区算出来（时区不合法就回退 +8）
  const tz = Object.fromEntries(
    chars.map((c) => [c.id, Number.isFinite(Number(c.tzOffset)) && !c.timezone ? Number(c.tzOffset) : offsetFromBeijing(c.timezone || "Asia/Shanghai")])
  );
  const lettersDir = {};
  const promptDir = {};
  for (const c of chars) {
    if (c.lettersDir) lettersDir[c.id] = c.lettersDir;
    else if (dataDir) lettersDir[c.id] = path.join(dataDir, "letters", c.id);

    if (c.promptsDir) {
      promptDir[c.id] = c.promptsDir;
    } else {
      const cands = [
        dataDir && path.join(dataDir, "characters", c.id, "letters"),
        appDir && path.join(appDir, "characters", c.id, "letters"),
      ].filter(Boolean);
      const hit = cands.find(exists);
      if (hit) promptDir[c.id] = hit;
    }
  }

  const clockChars = chars
    .filter((c) => Array.isArray(c.slots) && c.slots.length)
    .map((c) => ({
      id: c.id,
      name: c.name || c.id,
      // 四档按用户实际时间（北京）响；她的时区只管“她那边几点”、信、位置
      tz: 0,
      timezone: c.timezone || "Asia/Shanghai",
      mainSession: c.mainSession || "",
      slots: c.slots.map((s) => ({ id: s.id, at: s.at, catchUpMin: s.catchUpMin })),
    }));

  return { chars, agents, names, tz, lettersDir, promptDir, clockChars };
}
