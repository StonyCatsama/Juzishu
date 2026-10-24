// 橘子树 · 角色包 | 原创实现
//
// 一张卡进来，她就能跑。
// 内置模板在 App 的 characters/_template；用户自己的卡放 data/characters/<id>。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const REQUIRED = ["name"];
const RECOMMENDED = ["description", "first_mes"];

/** 认卡：ST V2 / ST V3 / 无 spec 的字段。 */
export function detectCard(card) {
  if (!card || typeof card !== "object") return "unknown";
  if (card.spec === "chara_card_v3" && (card.ccv3 || card.data)) return "st-v3";
  if (card.spec === "chara_card_v2" && card.data) return "st-v2";
  if (card.chara && typeof card.chara === "object" && card.chara.name) return "st-v2";
  if (card.name && card.description && card.first_mes) return "native";
  if (card.name) return "native";
  return "unknown";
}

/** 统一成内部字段。 */
export function normalizeCard(card) {
  const kind = detectCard(card);
  if (kind === "st-v3") {
    const c = card.ccv3 || card.data || card;
    return pick(c, "st-v3");
  }
  if (kind === "st-v2") {
    const c = card.chara || card.data || card;
    return pick(c, "st-v2");
  }
  return pick(card, "native");
}

function pick(c, format) {
  return {
    format,
    name: str(c.name),
    description: str(c.description),
    personality: str(c.personality),
    scenario: str(c.scenario),
    first_mes: str(c.first_mes),
    mes_example: str(c.mes_example),
    system_prompt: str(c.system_prompt),
    post_history_instructions: str(c.post_history_instructions),
    creator: str(c.creator),
    creator_notes: str(c.creator_notes),
    character_version: str(c.character_version) || "1.0",
    tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
    alternate_greetings: Array.isArray(c.alternate_greetings) ? c.alternate_greetings.map(String) : [],
    character_book: c.character_book && typeof c.character_book === "object" ? c.character_book : null,
    extensions: c.extensions && typeof c.extensions === "object" ? c.extensions : {},
    raw: c,
  };
}

function str(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** 校验：只有 name 是硬门槛；缺描述只提示。 */
export function validateCard(card) {
  const errors = [];
  for (const f of REQUIRED) if (!str(card?.[f]).trim()) errors.push(`${f} 必填`);
  const warnings = [];
  for (const f of RECOMMENDED) if (!str(card?.[f]).trim()) warnings.push(`缺 ${f}，卡能用但会很干`);
  return { errors, warnings };
}

/** ST 角色书 → 我们的条目。 */
export function bookToEntries(book) {
  const list = Array.isArray(book?.entries) ? book.entries : [];
  return list.map((e, i) => ({
    id: `st-${i + 1}`,
    name: str(e.comment) || str(e.name) || `条目 ${i + 1}`,
    trigger: Array.isArray(e.keys) ? e.keys.map(String) : [],
    match: "substring",
    logic: "any",
    priority: Number(e.insertion_order) || 100,
    enabled: e.enabled !== false,
    body: str(e.content),
  }));
}

export function createCharacters({ appDir, dataDir }) {
  const tplRoot = path.join(appDir, "characters", "_template");
  const userRoot = path.join(dataDir || appDir, "characters");

  function readJson(p, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      return fallback;
    }
  }

  function writeJson(p, obj) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  }

  function safeId(id) {
    const s = String(id || "").trim();
    if (!ID_RE.test(s)) throw Object.assign(new Error("id 只能用英文、数字、_ 或 -"), { status: 400 });
    return s;
  }

  function exists(id) {
    return fs.existsSync(path.join(userRoot, id, "profile.json"));
  }

  /** 内置包目录：appDir/characters 下凡是以 _ 开头的都算（_template / _example / 其他样板）。 */
  function builtinDirs() {
    const root = path.join(appDir, "characters");
    try {
      return fs.readdirSync(root)
        .filter((n) => n.startsWith("_"))
        .map((n) => ({ id: n, dir: path.join(root, n) }))
        .filter((x) => fs.existsSync(path.join(x.dir, "profile.json")));
    } catch {
      return [];
    }
  }

  function list() {
    fs.mkdirSync(userRoot, { recursive: true });
    const out = [];

    const builtins = builtinDirs().sort((a, b) => (a.id === "_template" ? -1 : b.id === "_template" ? 1 : a.id.localeCompare(b.id)));
    for (const b of builtins) {
      const p = readJson(path.join(b.dir, "profile.json"), {}) || {};
      out.push({
        id: b.id,
        name: b.id === "_template" ? "模板" : (p.name || b.id),
        source: "builtin",
        timezone: p.timezone || "",
        slots: p.letters?.slots?.length || 0,
        guide: !!p.guide,
      });
    }

    for (const name of fs.readdirSync(userRoot)) {
      if (name.startsWith(".")) continue;
      const p = readJson(path.join(userRoot, name, "profile.json"), null);
      if (!p) continue;
      out.push({
        id: name,
        name: p.name || name,
        source: "user",
        timezone: p.timezone || "",
        slots: p.letters?.slots?.length || 0,
      });
    }
    return out;
  }

  function load(id) {
    // 内置包（_template / _example / _kim …）在 App 目录里，用户角色在 app-data 里
    const dir = String(id || "").startsWith("_")
      ? path.join(appDir, "characters", String(id))
      : path.join(userRoot, safeId(id));
    const profile = readJson(path.join(dir, "profile.json"), null);
    if (!profile) throw Object.assign(new Error("角色不存在"), { status: 404 });

    const readMaybe = (rel) => {
      try {
        return fs.readFileSync(path.join(dir, rel), "utf8");
      } catch {
        return null;
      }
    };

    const prompts = profile.prompts || {};
    return {
      id,
      dir,
      profile,
      identity: readMaybe(prompts.identity || "identity.md"),
      agents: readMaybe(prompts.agents || "AGENTS.md"),
      publicAgents: readMaybe(prompts.publicAgents || "public-agents.md"),
      persona: readMaybe(profile.persona || "persona.md"),
      worldbook: readJson(path.join(dir, profile.worldbook || "worldbook.json"), { schema: "juzishu.worldbook/1", entries: [] }),
    };
  }

  function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      const s = path.join(src, name);
      const d = path.join(dst, name);
      if (fs.statSync(s).isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }

  function saveAvatar(id, dataUrl) {
    const cid = safeId(id);
    const dir = path.join(userRoot, cid);
    if (!fs.existsSync(dir)) throw Object.assign(new Error("角色不存在"), { status: 404 });
    const m = String(dataUrl || "").match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!m) throw Object.assign(new Error("只收 png / jpg / webp"), { status: 400 });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 4 * 1024 * 1024) throw Object.assign(new Error("图太大了（超过 4MB）"), { status: 413 });
    fs.writeFileSync(path.join(dir, "avatar.png"), buf);
    return { ok: true, size: buf.length };
  }

  function remove(id) {
    const cid = safeId(id);
    if (cid === "_template") throw Object.assign(new Error("内置模板不能删"), { status: 403 });
    const dir = path.join(userRoot, cid);
    if (!fs.existsSync(dir)) throw Object.assign(new Error("角色不存在"), { status: 404 });
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, id: cid };
  }

  /** 模板来源：只用 _template 那副空骨架。
   *  （以前还能套 _kim 那个向导，发布包不带角色之后没这个需要了）*/
  function templateDir(from) {
    const key = String(from || "").trim();
    if (!key || key === "_template") return tplRoot;
    if (key.startsWith("_")) throw Object.assign(new Error("模板不存在：" + key), { status: 404 });
    const mine = path.join(userRoot, safeId(key));
    if (fs.existsSync(path.join(mine, "profile.json"))) return mine;
    throw Object.assign(new Error("没有可套用的模板：" + key), { status: 404 });
  }

  function create({ id, name, from, aliases, timezone, want, need, who, avatar }) {
    const cid = safeId(id);
    if (exists(cid)) throw Object.assign(new Error("这个 id 已经有了"), { status: 409 });

    const dst = path.join(userRoot, cid);
    // from 可以是一个现成角色：人格、世界书、三封信、头像一起搬过来，改个 id 就能用
    const src = templateDir(from);
    copyDir(src, dst);

    const profile = readJson(path.join(dst, "profile.json"), {});
    profile.schema = "juzishu.character/1";
    profile.id = cid;
    profile.name = String(name || cid);
    delete profile.example;

    const al = Array.isArray(aliases) ? aliases.map((x) => String(x).trim()).filter(Boolean) : [];
    if (al.length) profile.aliases = al;
    // 套用现成角色时，旧别名跟旧名字绑在一起，不清会留着上一个角色的称呼
    else if (from && from !== "_template" && from !== "_example") delete profile.aliases;
    if (timezone) profile.timezone = String(timezone);
    writeJson(path.join(dst, "profile.json"), profile);

    // 开卡时填的那几格，写成 persona.md 的开头；没填就留着空壳模板
    const parts = [];
    const whoT = String(who || "").trim();
    const wantT = String(want || "").trim();
    const needT = String(need || "").trim();
    if (whoT) parts.push("## 是谁\n\n" + whoT);
    if (wantT || needT) {
      const lines = [];
      if (wantT) lines.push("- 最想要的：" + wantT);
      if (needT) lines.push("- 最怕的：" + needT);
      parts.push("## 矛盾\n\n" + lines.join("\n"));
    }
    if (parts.length) {
      fs.writeFileSync(path.join(dst, "persona.md"), "# " + profile.name + "\n\n" + parts.join("\n\n") + "\n", "utf8");
    }

    // 头像：data URL 直接落盘
    if (avatar) {
      try { saveAvatar(cid, String(avatar)); } catch { /* 图不行就先不忙 */ }
    }

    return { ok: true, id: cid, dir: dst };
  }

  /** 改已有的角色包：名字、别称、时区、persona 那三段、头像。
   *  接入只抄三件套，剩下的得靠这里补回来。 */
  function update(id, patch = {}) {
    const cid = String(id || "").trim();
    if (!cid || cid.startsWith("_")) throw Object.assign(new Error("内置包不能改"), { status: 403 });
    const dir = path.join(userRoot, safeId(cid));
    const profile = readJson(path.join(dir, "profile.json"), null);
    if (!profile) throw Object.assign(new Error("角色不存在"), { status: 404 });

    if (patch.name != null) profile.name = String(patch.name).trim() || profile.name;
    if (Array.isArray(patch.aliases)) profile.aliases = patch.aliases.map((x) => String(x).trim()).filter(Boolean);
    if (patch.timezone) profile.timezone = String(patch.timezone);
    if (patch.letters && typeof patch.letters === "object") profile.letters = patch.letters;

    const parts = [];
    const whoT = String(patch.who ?? "").trim();
    const wantT = String(patch.want ?? "").trim();
    const needT = String(patch.need ?? "").trim();
    if (whoT) parts.push("## 是谁\n\n" + whoT);
    if (wantT || needT) {
      const lines = [];
      if (wantT) lines.push("- 最想要的：" + wantT);
      if (needT) lines.push("- 最怕的：" + needT);
      parts.push("## 矛盾\n\n" + lines.join("\n"));
    }
    if (parts.length) {
      fs.writeFileSync(path.join(dir, "persona.md"), "# " + profile.name + "\n\n" + parts.join("\n\n") + "\n", "utf8");
    }

    writeJson(path.join(dir, "profile.json"), profile);
    if (patch.avatar) {
      try { saveAvatar(cid, String(patch.avatar)); } catch { /* 图不行就先不忙 */ }
    }
    return { ok: true, id: cid, profile };
  }

  function importST(card, { id } = {}) {
    const c = normalizeCard(card);
    const v = validateCard(c);
    if (v.errors.length) throw Object.assign(new Error(v.errors.join("；")), { status: 400 });

    const cid = safeId(id || `char-${Date.now().toString(36)}`);
    if (exists(cid)) throw Object.assign(new Error("这个 id 已经有了"), { status: 409 });

    const dst = path.join(userRoot, cid);
    copyDir(tplRoot, dst);

    const profile = readJson(path.join(dst, "profile.json"), {});
    profile.schema = "juzishu.character/1";
    profile.id = cid;
    profile.name = c.name;
    profile.aliases = c.tags.slice(0, 8);
    profile.st = { spec: c.format, raw: null };

    // 人格：拆成身份速写 + 主文件两份
    const firstLine =
      String(c.description || "")
        .split(/\n/)
        .map((x) => x.trim())
        .find(Boolean) || "";

    const identity = [`# ${c.name}`, "", firstLine ? `- ${firstLine}` : "- （补一句身份速写）", ""].join("\n");

    const agents = [
      "# 人格定义",
      c.description && `\n## 描述\n\n${c.description}`,
      c.personality && `\n## 性格\n\n${c.personality}`,
      c.scenario && `\n## 场景\n\n${c.scenario}`,
      c.first_mes && `\n## 开场\n\n${c.first_mes}`,
      c.system_prompt && `\n## 系统提示\n\n${c.system_prompt}`,
    ]
      .filter(Boolean)
      .join("\n");

    fs.writeFileSync(path.join(dst, "identity.md"), identity, "utf8");
    fs.writeFileSync(path.join(dst, "AGENTS.md"), agents, "utf8");

    // 旧的合并版也写一份，给还没适配的读法用
    fs.writeFileSync(path.join(dst, "persona.md"), identity + "\n\n" + agents, "utf8");

    // 角色书 → 条目
    const entries = bookToEntries(c.character_book);
    writeJson(path.join(dst, "worldbook.json"), {
      schema: "juzishu.worldbook/1",
      entries,
    });

    // 原卡留档，导出时能还原
    writeJson(path.join(dst, "st", "card.json"), c.raw);

    writeJson(path.join(dst, "profile.json"), profile);

    return {
      ok: true,
      id: cid,
      name: c.name,
      entries: entries.length,
      warnings: v.warnings,
    };
  }

  function exportST(id) {
    const { profile, identity, agents, persona, worldbook } = load(id);
    const full = [identity, agents].filter(Boolean).join("\n\n") || persona || "";
    const entries = (worldbook?.entries || []).map((e, i) => ({
      keys: e.trigger || [],
      content: e.body || "",
      enabled: e.enabled !== false,
      insertion_order: Number(e.priority) || 100,
      comment: e.name || `条目 ${i + 1}`,
    }));

    return {
      spec: "chara_card_v2",
      spec_version: "2",
      data: {
        name: profile.name || id,
        description: full,
        personality: "",
        scenario: "",
        first_mes: "",
        mes_example: "",
        system_prompt: "",
        post_history_instructions: "",
        creator: "juzishu",
        creator_notes: "由橘子树导出",
        character_version: "1.0",
        tags: profile.aliases || [],
        alternate_greetings: [],
        character_book: entries.length ? { entries } : null,
        extensions: { juzishu: { schema: profile.schema, timezone: profile.timezone } },
      },
    };
  }

  return { list, load, create, update, remove, saveAvatar, importST, exportST, userRoot, tplRoot };
}
