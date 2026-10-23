// 橘子树 · 配置路由 | 原创实现
//
// 只读展示 + 整体写回。写回前校验 id 与时间格式。
//
// 2026-10-21：面板上主会话只填 id。id 是给心跳投递用的，读档（三档、代办）
// 要的是文件路径。两者以前要人各填一遍，现在 id 一填，这里去会话列表把
// 路径换出来写进 mainSessionPath——三个用途指着同一个地方。

import { loadConfig, saveConfig, validateConfig } from "../modules/config/index.js";

/** 一个 id，换出会话文件路径。
 *  返回 {path, why}：why 区分卡在哪一步，面板就靠它告诉人卡在哪。
 */
async function resolveMainPath(sdk, agentId, ref, dataDir) {
  const v = String(ref || "").trim();
  if (!v) return { path: "", why: "empty" };
  // 手填的本来就是路径
  if (/[\\/]/.test(v) && /\.jsonl$/i.test(v)) return { path: v, why: "path" };

  // ① 直接问这个 id 是哪个文件。session:get 返回的就是完整条目（含 path）。
  try {
    const one = await sdk.sessions.get({ sessionId: v, scope: "all" });
    const s = one?.session || one;
    const p = String(s?.path || s?.sessionPath || "");
    if (p) return { path: p, why: "get" };
  } catch { /* 没这个口子或没这个 id，往下试 */ }

  // ② 再翻一遍列表
  try {
    const r = await sdk.sessions.list({ agentId, scope: "all", lifecycle: "active" });
    const arr = Array.isArray(r) ? r : (r?.sessions || []);
    const hit = arr.find((s) => String(s.sessionId || "") === v);
    if (hit) return { path: String(hit.path || hit.sessionPath || ""), why: "list" };
  } catch { /* 继续 */ }

  // ③ 注入时自己记的那笔（App 自己的目录，一定有权限）
  try {
    const fs = await import("node:fs");
    const pathMod = await import("node:path");
    const f = pathMod.join(dataDir, "sessions", `${agentId}.json`);
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    if (rec?.path && String(rec.sessionId || "") === v) return { path: String(rec.path), why: "memory" };
  } catch { /* 没有那笔 */ }

  return { path: "", why: "nomatch" };
}

/** 把每个角色的 mainSessionPath 跟 mainSession 对齐。返回一行行账单，给人看。 */
async function fillSessionPaths(sdk, cfg, dataDir) {
  const chars = Array.isArray(cfg?.characters) ? cfg.characters : [];
  const notes = [];
  for (const c of chars) {
    if (!c) continue;
    const ref = String(c.mainSession || "").trim();
    if (!ref) {
      delete c.mainSessionPath;
      continue;
    }
    const r = await resolveMainPath(sdk, String(c.id || ""), ref, dataDir);
    if (r.path) {
      c.mainSessionPath = r.path;
      notes.push(`${c.id}：路径已钉`);
    } else {
      // 没钉到不写空串——空字段和“没这个字段”不是一回事。
      // 三档读档本来就有兜底：注入时记下的那一笔（sessions/<agent>.json）。
      if (!c.mainSessionPath) delete c.mainSessionPath;
      notes.push(`${c.id}：按注入记的那笔走`);
    }
  }
  return notes;
}

export function registerConfigRoutes(app, { sdk, appDir, dataDir }) {
  app.get("/config", (c) => {
    const cfg = loadConfig({ appDir, dataDir });
    return c.json({ ok: true, config: cfg, source: cfg.source });
  });

  app.post("/config", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const cfg = body.config || body;

    let pinned = [];
    if (sdk) pinned = await fillSessionPaths(sdk, cfg, dataDir);

    const errors = validateConfig(cfg);
    if (errors.length) return c.json({ ok: false, err: errors.join("；") }, 400);

    try {
      const p = saveConfig({ dataDir, cfg });
      return c.json({ ok: true, path: p, mainSession: pinned });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });
}
