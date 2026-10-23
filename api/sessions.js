// 橘子树 · 会话路由 | 原创实现
//
// 主会话不靠 sessions.list 猜——那份列表只有 App 自己建的会话。
// 靠“最近谁在这儿说过话”：每轮注入都记一笔。

export function registerSessionRoutes(app, { sdk, agents, memory }) {
  app.get("/sessions", async (c) => {
    let agent = "";
    try {
      const u = new URL(String(c.req.url || ""), "http://localhost");
      agent = (u.searchParams.get("agent") || "").trim();
    } catch { /* 空 */ }

    if (!agents.includes(agent)) return c.json({ ok: false, err: "未知 agent" }, 400);

    const items = [];

    // 1) 最近说过话的那个
    const rec = memory?.recent(agent);
    if (rec?.path) {
      items.push({
        // 注入时记下 id 与 path 两样，这里一起递出去——面板上填 id，靠它換 path。
        sessionId: rec.sessionId || null,
        path: rec.path,
        title: rec.kind === "bridge" ? "最近说话 · 微信" : "最近说话 · 桌面",
        messageCount: null,
        at: rec.at || null,
        kind: rec.kind || "desktop",
        recent: true,
      });
    }

    // 2) App 自己建的会话（专用信箱等）
    try {
      const r = await sdk.sessions.list({ agentId: agent, scope: "all", lifecycle: "active" });
      const arr = Array.isArray(r) ? r : (r?.sessions || []);
      for (const s of arr) {
        const p = s.path || s.sessionPath || "";
        if (!p || items.some((x) => x.path === p)) continue;
        items.push({
          // sessionId 必须一并递出去：面板上只填 id，靠它反查出 path。
          sessionId: s.sessionId || null,
          path: p,
          title: s.title || s.firstMessage || "专用会话",
          messageCount: s.messageCount ?? null,
          at: null,
          kind: /[\\/]bridge[\\/]/.test(p) ? "bridge" : "app",
          recent: false,
        });
      }
    } catch { /* list 不可用就算了 */ }

    // 3) 搜一遍：未归档的全部会话（search 只给 id，不给路径）
    let searchError = null;
    try {
      const r = await sdk.bus.request("session:search", {
        query: "",
        phase: "title",
        scope: "all",
        agentId: agent,
        limit: 60,
      });
      const arr = r?.results || [];
      for (const s of arr) {
        const sid = s.sessionId;
        if (!sid) continue;
        if (items.some((x) => x.sessionId === sid)) continue;
        items.push({
          sessionId: sid,
          path: "",
          title: s.title || s.snippet || "会话",
          messageCount: null,
          at: s.modified || null,
          kind: "session",
          recent: false,
        });
      }
    } catch (e) {
      searchError = String(e?.message || e);
    }

    return c.json({ ok: true, agent, count: items.length, items, searchError });
  });

  app.get("/sessions/all", (c) => {
    return c.json({ ok: true, sessions: memory?.all() || {} });
  });
}
