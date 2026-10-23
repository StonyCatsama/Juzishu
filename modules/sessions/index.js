// 橘子树 · 会话记忆 | 原创实现
//
// 每轮注入都会经过这里，顺手记下“谁在哪个会话说过话”。
// 不依赖 sessions.list（它只给 App 自己建的会话，看不到主对话和微信桥接）。
//
// 2026-10-20 改：从一张 sessions.json 拆成 sessions/<agent>.json。
// 原来三家共用一个文件、读-改-写，两个 agent 同时请求时后写的会把先写的覆盖掉
// （某个角色的记录就是这么被冲掉的，心跳据此以为他很久没说话）。

import fs from "node:fs";
import path from "node:path";

export function createSessionMemory({ dataDir }) {
  const root = path.join(dataDir || ".", "sessions");
  const legacy = path.join(dataDir || ".", "sessions.json");

  const fileOf = (agentId) => path.join(root, `${agentId}.json`);

  function readJson(p) {
    try {
      const t = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
      return t ? JSON.parse(t) : null;
    } catch {
      return null;
    }
  }

  /** 先写临时文件再改名——别的 agent 永远读不到半截。 */
  function writeJson(p, obj) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
      fs.renameSync(tmp, p);
      return true;
    } catch {
      return false;
    }
  }

  /** 一次性：老的单表搬到每人一个文件，搬完把老表改名留着。 */
  function migrateLegacy() {
    const old = readJson(legacy);
    if (!old || typeof old !== "object") return;
    let moved = 0;
    for (const [id, rec] of Object.entries(old)) {
      if (!id || !rec?.path) continue;
      if (fs.existsSync(fileOf(id))) continue;
      const ok = writeJson(fileOf(id), {
        path: String(rec.path),
        at: Number(rec.at) || 0,
        kind: String(rec.kind || "desktop"),
      });
      if (ok) moved++;
    }
    if (moved) {
      try { fs.renameSync(legacy, `${legacy}.migrated`); } catch { /* 留着也无妨 */ }
    }
  }
  migrateLegacy();

  /** 记一笔。同一路径一分钟内不重复写。
   *  sessionId 一并记下：面板上只填 id，靠这笔把它换成文件路径。 */
  function remember(agentId, sessionPath, sessionId) {
    if (!agentId || !sessionPath) return;
    const prev = readJson(fileOf(agentId));
    const samePath = prev?.path === String(sessionPath);
    const sameId = String(prev?.sessionId || "") === String(sessionId || "");
    if (samePath && sameId && Date.now() - (Number(prev?.at) || 0) < 60_000) return;
    writeJson(fileOf(agentId), {
      path: String(sessionPath),
      sessionId: sessionId ? String(sessionId) : "",
      at: Date.now(),
      kind: /[\\/]bridge[\\/]/.test(sessionPath) ? "bridge" : "desktop",
    });
  }

  function recent(agentId) {
    return readJson(fileOf(agentId));
  }

  /** 全部：{ agentId: {path, at, kind} } */
  function all() {
    const out = {};
    try {
      for (const n of fs.readdirSync(root)) {
        if (!n.endsWith(".json")) continue;
        const id = n.slice(0, -5);
        const rec = readJson(path.join(root, n));
        if (rec) out[id] = rec;
      }
    } catch {
      /* 还没有目录 */
    }
    return out;
  }

  /** 兼容旧调用点：现在每次 remember 都自己落盘，这里什么都不用做。 */
  function save() {}

  return { remember, recent, all, save, dir: root };
}
