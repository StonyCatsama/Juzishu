// 橘子树 · 接入已有助手 | 原创实现
//
// 宿主里已经有 agent 的人（手建的、以前留下的），不该再走"从零建卡"。
// 扫 ~/.hanako/agents，把没接入的列出来；点一下就把人格文件抄进角色包、
// 写配置、铺信、灌世界书——之后她和 App 里建的角色一样跑。

import path from "node:path";

export function registerAgentAdoptRoutes(app, { sdk, home, characterStore, onCreated }) {
  const agentsRoot = path.join(home, "agents");

  async function readDir() {
    try {
      const r = await sdk.resources.list({ kind: "local-file", path: agentsRoot });
      const arr = Array.isArray(r) ? r : (r?.entries || r?.items || []);
      return arr
        .map((x) => String(x?.name || x?.basename || path.basename(String(x?.path || ""))))
        .filter((n) => n && !n.startsWith(".") && !n.endsWith(".json"));
    } catch {
      return [];
    }
  }

  async function readText(p) {
    try {
      const r = await sdk.resources.read({ kind: "local-file", path: p });
      const t = typeof r === "string" ? r : (r?.content ?? r?.text ?? "");
      return t ? String(t).replace(/^\uFEFF/, "") : null;
    } catch {
      return null;
    }
  }

  async function nameOf(id) {
    const ident = await readText(path.join(agentsRoot, id, "identity.md"));
    const cfg = await readText(path.join(agentsRoot, id, "config.yaml"));
    const mCfg = String(cfg || "").match(/^\s*name:\s*(.+)$/m);
    const mId = String(ident || "").match(/^#\s*(.+)$/m);
    const nm = (mCfg && mCfg[1].trim()) || (mId && mId[1].trim()) || id;
    return nm.replace(/^["']|["']$/g, "");
  }

  app.get("/agents/scan", async (c) => {
    try {
      const dirs = await readDir();
      const items = [];
      for (const id of dirs) {
        const adopted = !!characterStore.list().find((x) => x.id === id && x.source === "user");
        items.push({ id, name: await nameOf(id), adopted });
      }
      return c.json({ ok: true, items });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  app.post("/agents/adopt", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) return c.json({ ok: false, err: "id 不合法" }, 400);
    try {
      const list = characterStore.list();
      if (list.some((x) => x.id === id && x.source === "user")) {
        return c.json({ ok: true, already: true, id });
      }
      const name = await nameOf(id);
      // 先按模板建包（带 profile / 世界书 / 三封信的骨架）
      const created = characterStore.create({ id, name, from: "_template" });
      // 再把宿主里的人格抄过来覆盖
      const files = [
        ["identity.md", "identity.md"],
        ["AGENTS.md", "AGENTS.md"],
        ["AGENTS.public.md", "public-agents.md"],
      ];
      const copied = [];
      for (const [src, dst] of files) {
        const t = await readText(path.join(agentsRoot, id, src));
        if (t == null) continue;
        try {
          await sdk.resources.write({ kind: "local-file", path: path.join(created.dir, dst) }, t);
          copied.push(dst);
        } catch { /* 写不进去就留着模板 */ }
      }
      // 宿主里没有 identity.md 的（只写了 AGENTS），不要从 AGENTS 截——
      // 那里面是人家的全部设定，搬过来等于把人家的私事当成身份。只写一句最普通的。
      if (!copied.includes("identity.md")) {
        const brief = [`# ${name}`, "", `- 你是 ${name}。`].join("\n");
        try {
          await sdk.resources.write({ kind: "local-file", path: path.join(created.dir, "identity.md") }, brief);
          copied.push("identity.md");
        } catch { /* 写不进去就留着模板 */ }
      }
      try { await onCreated?.(id); } catch { /* 写配置失败不拦接入 */ }
      return c.json({ ok: true, id, name, dir: created.dir, copied });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });
}
