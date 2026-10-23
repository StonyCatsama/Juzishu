// 橘子树 · 世界书核心 | 原创实现
//
// 唯一写口。条目存在库文件里，注入从 pick() 取。
// 当前库位置沿用既有路径，不动库、只换读写代码。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const safeArr = (s) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function createWorldbookStore({ sdk, home, dataDir }) {
  const root = dataDir || ".";
  const dbPath = path.join(root, "worldbook.db");
  // 旧插件库：仅当新库不存在时拿来做一次性搬家，之后不再碰它
  const legacyDb = path.join(home || root, "plugin-data", "wutong-worldbook", "data.db");
  let ensured = false;

  async function ensureDb() {
    if (ensured) return;
    ensured = true;
    try {
      if (fs.existsSync(dbPath)) return;
      const candidates = [];
      try {
        const r = await sdk.resources.read({ kind: "local-file", path: legacyDb });
        const content = r?.content;
        if (Buffer.isBuffer(content)) candidates.push(content);
        else if (typeof content === "string") candidates.push(Buffer.from(content, "base64"));
        else if (typeof r === "string") candidates.push(Buffer.from(r, "base64"));
      } catch { /* 读不到旧库就算了 */ }
      try {
        if (!candidates.length && fs.existsSync(legacyDb)) candidates.push(fs.readFileSync(legacyDb));
      } catch { /* 同上 */ }
      const buf = candidates.find((b) => b && b.slice(0, 15).toString("latin1") === "SQLite format 3");
      if (!buf) return;
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, buf);
    } catch { /* 搬不动就让下面的 open 报错 */ }
  }

  async function open() {
    await ensureDb();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    // 关系表：细节挂到总览，note 是总览视角的那句补充
    try {
      db.exec(
        "CREATE TABLE IF NOT EXISTS worldbook_links (" +
          "child_id TEXT NOT NULL, parent_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', " +
          "created_at TEXT NOT NULL, PRIMARY KEY (child_id, parent_id))"
      );
    } catch { /* 库不可写就跳过 */ }
    return db;
  }

  async function mutate(fn) {
    const db = await open();
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  function mapRow(e) {
    return {
      id: e.id,
      agentId: e.agent_id || "",
      name: e.name,
      dir: e.dir,
      policy: e.policy,
      trigger: safeArr(e.trigger),
      regex: !!e.regex,
      priority: e.priority,
      match: e.match,
      logic: e.logic,
      conditions: safeArr(e.conditions),
      body: e.body,
      enabled: !!e.enabled,
      updatedAt: e.updated_at || "",
    };
  }

  async function list() {
    const db = await open();
    try {
      const rows = db
        .prepare("SELECT * FROM worldbook_entries ORDER BY agent_id, priority DESC, name")
        .all();
      return rows.map(mapRow);
    } finally {
      db.close();
    }
  }

  /**
   * 改一条。只写传进来的字段，其余不动。
   * 失败抛错：status 400 = 参数问题，404 = 条目不存在。
   */
  async function upsert(id, patch) {
    const key = String(id || "").trim();
    if (!key) throw Object.assign(new Error("缺少 id"), { status: 400 });

    return mutate((db) => {
      const sets = [];
      const args = [];
      if (patch.name !== undefined) { sets.push("name = ?"); args.push(String(patch.name)); }
      if (patch.body !== undefined) { sets.push("body = ?"); args.push(String(patch.body)); }
      if (patch.trigger !== undefined) {
        sets.push("trigger = ?");
        args.push(JSON.stringify(Array.isArray(patch.trigger) ? patch.trigger : []));
      }
      if (patch.priority !== undefined) { sets.push("priority = ?"); args.push(Number(patch.priority) || 50); }
      if (patch.enabled !== undefined) { sets.push("enabled = ?"); args.push(patch.enabled ? 1 : 0); }
      if (patch.match !== undefined) { sets.push("match = ?"); args.push(String(patch.match || "substring")); }
      if (patch.logic !== undefined) { sets.push("logic = ?"); args.push(String(patch.logic || "any")); }
      if (patch.policy !== undefined) { sets.push("policy = ?"); args.push(String(patch.policy || "inject")); }
      if (patch.agentId !== undefined) { sets.push("agent_id = ?"); args.push(String(patch.agentId || "")); }
      if (!sets.length) throw Object.assign(new Error("没有要改的字段"), { status: 400 });

      sets.push("updated_at = ?");
      args.push(new Date().toISOString());
      args.push(key);
      db.prepare(`UPDATE worldbook_entries SET ${sets.join(", ")} WHERE id = ?`).run(...args);
      return { ok: true };
    });
  }

  async function remove(id) {
    const key = String(id || "").trim();
    if (!key) throw Object.assign(new Error("缺少 id"), { status: 400 });

    return mutate((db) => {
      const info = db.prepare("DELETE FROM worldbook_entries WHERE id = ?").run(key);
      if (!info.changes) throw Object.assign(new Error("条目不存在"), { status: 404 });
      // 删条目时把关系一起清掉——不然父条下面会挂着一个查不到名字的 id（看着像乱码）
      db.prepare("DELETE FROM worldbook_links WHERE child_id = ? OR parent_id = ?").run(key, key);
      return { ok: true, removed: info.changes };
    });
  }

  async function create(entry = {}) {
    return mutate((db) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO worldbook_entries (id, agent_id, name, dir, policy, trigger, regex, replace, \"limit\", allow, priority, match, logic, conditions, body, enabled, fingerprint, source, created_at, updated_at) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).run(
        id,
        String(entry.agentId || ""),
        String(entry.name || "新条目"),
        "entries",
        String(entry.policy || "inject"),
        JSON.stringify(Array.isArray(entry.trigger) ? entry.trigger : []),
        0,
        "",
        0,
        "[]",
        Number(entry.priority ?? 50),
        String(entry.match || "substring"),
        String(entry.logic || "any"),
        "[]",
        String(entry.body || ""),
        1,
        "",
        "native",
        now,
        now
      );
      return { ok: true, id };
    });
  }

  // ── 父子关系（worldbook_links）──
  function addLink(childId, parentId, note = "") {
    const c = String(childId || "");
    const p = String(parentId || "");
    if (!c || !p || c === p) throw Object.assign(new Error("细节与总览不能为空或相同"), { status: 400 });
    return mutate((db) => {
      db.prepare(
        "INSERT INTO worldbook_links (child_id, parent_id, note, created_at) VALUES (?,?,?,?) " +
          "ON CONFLICT(child_id, parent_id) DO UPDATE SET note = excluded.note"
      ).run(c, p, String(note || ""), new Date().toISOString());
      return { ok: true };
    });
  }

  function removeLink(childId, parentId) {
    return mutate((db) => {
      const r = db.prepare("DELETE FROM worldbook_links WHERE child_id = ? AND parent_id = ?").run(String(childId), String(parentId));
      return { ok: true, removed: r.changes };
    });
  }

  /** 一条细节挂到哪些总览；带上总览名，供界面直接显示 */
  function parentsOf(childId) {
    return mutate((db) =>
      db.prepare(
        "SELECT l.parent_id AS parentId, l.note, e.name AS parentName, e.agent_id AS agentId " +
          "FROM worldbook_links l LEFT JOIN worldbook_entries e ON e.id = l.parent_id WHERE l.child_id = ?"
      ).all(String(childId))
    );
  }

  /** 一个总览底下挂了哪些细节 */
  function childrenOf(parentId) {
    return mutate((db) =>
      db.prepare(
        "SELECT l.child_id AS childId, l.note, e.name AS childName " +
          "FROM worldbook_links l LEFT JOIN worldbook_entries e ON e.id = l.child_id WHERE l.parent_id = ?"
      ).all(String(parentId))
    );
  }

  /** 往一条的正文后面接一段（补写用） */
  async function appendBody(id, text) {
    const add = String(text || "").trim();
    if (!add) return { ok: false, err: "没东西可补" };
    const rows = await list();
    const cur = rows.find((x) => x.id === String(id));
    if (!cur) throw Object.assign(new Error("条目不存在"), { status: 404 });
    const body = String(cur.body || "").replace(/\s+$/, "");
    await upsert(id, { body: body ? `${body}\n\n${add}` : add });
    return { ok: true };
  }

  /** 整段换成新的：改人称、把写歪的句子改正用它。不动 trigger 和优先级。 */
  async function setBody(id, text) {
    const body = String(text || "").trim();
    if (!body) return { ok: false, err: "正文是空的" };
    const rows = await list();
    const cur = rows.find((x) => x.id === String(id));
    if (!cur) throw Object.assign(new Error("条目不存在"), { status: 404 });
    await upsert(id, { body });
    return { ok: true, before: String(cur.body || "").length, after: body.length };
  }

  /** 往一条里插一段：给了 anchor 就插在那行后面，没给就接在末尾。 */
  async function insertAfter(id, text, anchor = "") {
    const add = String(text || "").trim();
    if (!add) return { ok: false, err: "没东西可补" };
    const rows = await list();
    const cur = rows.find((x) => x.id === String(id));
    if (!cur) throw Object.assign(new Error("条目不存在"), { status: 404 });

    const body = String(cur.body || "");
    const key = String(anchor || "").trim();

    if (!key) {
      const next = body.replace(/\s+$/, "");
      await upsert(id, { body: next ? `${next}\n\n${add}` : add });
      return { ok: true, mode: "append" };
    }

    const lines = body.split("\n");
    const idx = lines.findIndex((l) => l.includes(key));
    if (idx < 0) {
      // 找不到就退回末尾，不能默默不写
      const next = body.replace(/\s+$/, "");
      await upsert(id, { body: next ? `${next}\n\n${add}` : add });
      return { ok: true, mode: "append-fallback", note: `没找到“${key}”，接在末尾了` };
    }

    lines.splice(idx + 1, 0, add);
    await upsert(id, { body: lines.join("\n") });
    return { ok: true, mode: "after", anchor: key };
  }

  return { list, upsert, remove, create, addLink, removeLink, parentsOf, childrenOf, appendBody, insertAfter, setBody, dbPath };
}

/** 从属映射：静态 JSON → id 索引。读不到就返回空，不影响主流程。 */
export async function readLinks(sdk, filePath) {
  const r = await sdk.resources.read({ kind: "local-file", path: filePath });
  const text = typeof r === "string" ? r : (r?.content ?? r?.text ?? "");
  if (!text) throw new Error("映射文件读不到");
  const j = JSON.parse(String(text));

  const idx = {};
  const at = (id) => (idx[id] = idx[id] || { parents: [], children: [], peer: [], theme: [] });

  for (const h of j.hierarchy || []) {
    const pid = h.parent.id;
    at(pid);
    for (const ch of h.children || []) {
      at(ch.id).parents.push({ id: pid, name: h.parent.name, evidence: ch.evidence || "" });
      at(pid).children.push({ id: ch.id, name: ch.name, evidence: ch.evidence || "" });
    }
  }

  for (const cp of (j.counterpart || [])[0]?.pairs || []) {
    at(cp.a.id).peer.push({ id: cp.b.id, name: cp.b.name, agent: cp.b.agent, topic: cp.topic });
    at(cp.b.id).peer.push({ id: cp.a.id, name: cp.a.name, agent: cp.a.agent, topic: cp.topic });
  }

  for (const grp of (j.view || [])[0]?.groups || []) {
    const items = (grp.items || []).filter((x) => !x.id_note);
    for (const it of items) {
      for (const o of items) {
        if (o.id === it.id) continue;
        at(it.id).theme.push({ id: o.id, name: o.name, agent: o.agent, theme: grp.theme });
      }
    }
  }

  return { count: j._meta?.count || 0, idx };
}

