// 橘子树 · 状态路由 | 原创实现
//
// 只做 HTTP 适配。校验、写盘、since 全在 modules/seal。

export function registerSealRoutes(app, { store, agents, names, moodWhy, weather, metaOf, orientationOf, saveOrientation }) {
  const listAgents = () => (typeof agents === "function" ? agents() : agents);

  app.get("/seal", async (c) => {
    const out = {};
    const date = todayYMD();
    for (const a of listAgents()) {
      const s = await store.read(a);
      const why = moodWhy ? await moodWhy(a, date) : null;
      const wet = weather ? await weather(a, date) : null;
      const meta = metaOf ? metaOf(a) : null;
      const nm = names[a] || meta?.name || a;
      const orientation = orientationOf ? orientationOf(a) : null;
      out[a] = s
        ? { name: nm, source: meta?.source || "builtin", date, weather: wet, ...s, moodWhy: why, orientation }
        : { name: nm, source: meta?.source || "builtin", date, weather: wet, missing: true, moodWhy: why, orientation };
    }
    return c.json(out);
  });

  app.post("/orientation/set", async (c) => {
    if (typeof saveOrientation !== "function") return c.json({ ok: false, err: "没有写入通道" }, 500);
    try {
      const body = await c.req.json().catch(() => ({}));
      const agentId = String(body?.agentId || "").trim();
      if (!listAgents().includes(agentId)) return c.json({ ok: false, err: "未知 agent" }, 400);
      const clean = (x) => {
        const line = String(x?.line || "").trim();
        if (!line) return null;
        return { line, how: String(x?.how || "").trim() };
      };
      const main = clean(body?.main);
      const backupRaw = clean(body?.backup);
      const backup = backupRaw ? { ...backupRaw, slot: String(body?.backup?.slot || "").trim() } : null;
      const r = saveOrientation(agentId, main || backup ? { ...(main ? { main } : {}), ...(backup ? { backup } : {}) } : null);
      return c.json(r);
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  app.post("/seal/set", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const agentId = String(body.agentId || "").trim();
    if (!listAgents().includes(agentId)) return c.json({ ok: false, err: "未知 agent" }, 400);
    const r = await store.write(agentId, body, "panel");
    if (!r.ok) return c.json({ ok: false, err: r.err, notes: r.notes }, 500);
    return c.json({ ok: true, notes: r.notes, status: r.status });
  });
}

function todayYMD() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
