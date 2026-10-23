// 橘子树 · 规则库路由 | 原创实现
//
// 规则库是各 agent 目录下的「规则库」文件夹，纯文本文件直接改。
// 这里只做读写，不做校验以外的加工。
//
// 2026-10-23：文件名不再写死一张表。以前列的是某个人的实际文件名，
// 别人装上看到一串陌生条目、自己的规则却读不到。现在扫目录，.md/.txt 都认。

const RULE_EXT = /\.(md|txt)$/i;

export function registerRuleRoutes(app, { sdk, readText, agents, home, pathMod }) {
  async function filesOf(agent) {
    const dir = pathMod.join(home, "agents", agent, "规则库");
    try {
      const r = await sdk.resources.list({ kind: "local-file", path: dir });
      const arr = Array.isArray(r) ? r : (r?.entries || r?.items || []);
      return arr
        .map((x) => String(x?.name || x?.basename || pathMod.basename(String(x?.path || ""))))
        .filter((n) => n && RULE_EXT.test(n))
        .sort();
    } catch {
      return [];
    }
  }

  app.get("/rules", async (c) => {
    const out = {};
    for (const a of agents) {
      const list = [];
      for (const f of await filesOf(a)) {
        const t = await readText(pathMod.join(home, "agents", a, "规则库", f));
        if (t != null) list.push({ file: f, text: t });
      }
      out[a] = list;
    }
    return c.json({ ok: true, rules: out });
  });

  app.post("/rules/set", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const a = String(body.agentId || "").trim();
    const f = String(body.file || "").trim();
    if (!agents.includes(a) || !f || !RULE_EXT.test(f) || f.includes("..") || f.includes("/") || f.includes("\\")) {
      return c.json({ ok: false, err: "参数不合法" }, 400);
    }
    try {
      const p = pathMod.join(home, "agents", a, "规则库", f);
      await sdk.resources.write({ kind: "local-file", path: p }, String(body.text ?? ""));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.code || e?.message || e) }, 500);
    }
  });

  return { filesOf };
}
