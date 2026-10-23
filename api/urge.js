// 橘子树 · 冲动路由 | 原创实现
//
// 只评估，不开口。默认关着。

import { evaluate, nudge, DEFAULTS } from "../modules/urge/index.js";

export function registerUrgeRoutes(app, { clock, seal, cfg, agents, names, fire }) {
  app.post("/urge/fire", async (c) => {
    if (typeof fire !== "function") return c.json({ ok: false, err: "没有触发口" }, 500);
    const results = await fire();
    return c.json({ ok: true, results });
  });

  // 干跑：只算闸，不发消息、不改状态。验管道用，零成本。
  app.post("/urge/dry", async (c) => {
    if (typeof fire !== "function") return c.json({ ok: false, err: "没有触发口" }, 500);
    const results = await fire({ dry: true });
    return c.json({ ok: true, dry: true, results });
  });

  app.get("/urge/status", async (c) => {
    let agent = "";
    let lastUserMin = 60;
    try {
      const u = new URL(String(c.req.url || ""), "http://localhost");
      agent = (u.searchParams.get("agent") || "").trim();
      const v = u.searchParams.get("lastUserMin");
      if (v !== null) lastUserMin = Number(v);
    } catch { /* 用默认 */ }

    if (!agents.includes(agent)) return c.json({ ok: false, err: "未知 agent" }, 400);

    const now = clock.nowFor(0);
    const st = await clock.state(agent);
    const urge = st.urge || {};

    const lastSpokeMin = urge.lastSpokeAt
      ? Math.round((Date.now() - new Date(urge.lastSpokeAt).getTime()) / 60000)
      : null;
    const spokeToday = urge.date === now.date ? Number(urge.count) || 0 : 0;

    const s = await seal.read(agent);
    const r = evaluate({
      cfg: cfg?.defaults?.wake || DEFAULTS,
      min: now.min,
      lastUserMin,
      lastSpokeMin,
      spokeToday,
      care: s?.care || [],
      moodChanged: false,
    });

    return c.json({
      ok: true,
      agent,
      name: names[agent] || agent,
      verdict: r,
      inputs: { lastUserMin, lastSpokeMin, spokeToday, min: now.min, care: (s?.care || []).length },
      nudge: r.ok ? nudge() : null,
    });
  });
}
