// 橘子树 · 信路由 | 原创实现

export function registerLetterRoutes(app, { store, dirs, agents, names }) {
  app.get("/letter", async (c) => {
    let want = "";
    try {
      const u = new URL(String(c.req.url || ""), "http://localhost");
      want = (u.searchParams.get("date") || "").trim();
    } catch {
      want = "";
    }

    const valid = /^\d{4}-\d{2}-\d{2}$/.test(want);
    const out = { _date: valid ? want : store.todayYMD() };

    for (const a of agents) {
      const dir = dirs[a];
      if (!dir) {
        out[a] = { name: names[a], missing: true };
        continue;
      }
      const hit = valid ? await store.readDay(dir, want) : await store.latest(dir);
      out[a] = hit
        ? { name: names[a], date: hit.date, text: hit.text }
        : { name: names[a], missing: true };
    }

    return c.json(out);
  });

  app.post("/letter/write", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const agent = String(body.agentId || "").trim();
    const dir = dirs[agent];
    if (!dir) return c.json({ ok: false, err: "这个角色没有信的目录" }, 400);

    const date = String(body.date || store.todayYMD());
    try {
      const r = await store.appendSection(dir, date, body.section, String(body.text || ""), { mood: body.mood });
      await store.event("letter-write", { agent, date, section: body.section, chars: String(body.text || "").length });
      await store.bumpLedger(agent, "letters");
      return c.json(r);
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });

  app.post("/letter/event", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await store.event(body.kind || "event", body.detail || {});
    return c.json({ ok: r.ok });
  });

  app.get("/letter/ledger", async (c) => {
    let agent = "";
    try {
      const u = new URL(String(c.req.url || ""), "http://localhost");
      agent = (u.searchParams.get("agent") || "").trim();
    } catch { /* 空 */ }
    if (!agent) return c.json({ ok: false, err: "给个 agent" }, 400);
    return c.json({ ok: true, ledger: await store.ledger(agent) });
  });
}
