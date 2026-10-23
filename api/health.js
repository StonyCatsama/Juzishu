// 橘子树 · 体检路由 | 原创实现
//
// 一眼看清每块活没活：条数、角色数、注入模式、下一档什么时候。

export function registerHealthRoutes(app, ctx) {
  const { drawer, letter, clock, characters, cfg, agents, lettersDir, startedAt } = ctx;

  app.get("/health", async (c) => {
    const modules = {};

    try {
      const items = await drawer.list();
      modules.drawer = { ok: true, note: `${items.length} 条` };
    } catch (e) {
      modules.drawer = { ok: false, err: String(e?.message || e) };
    }

    try {
      const rows = await Promise.all(
        (agents || []).map(async (a) => {
          const dir = lettersDir?.[a];
          if (!dir) return null;
          const hit = await letter.latest(dir, 3);
          return hit ? `${a}:${hit.date}` : `${a}:无`;
        })
      );
      modules.letter = { ok: true, note: rows.filter(Boolean).join(" · ") };
    } catch (e) {
      modules.letter = { ok: false, err: String(e?.message || e) };
    }

    try {
      const list = characters.list();
      modules.characters = { ok: true, note: `${list.length} 张` };
    } catch (e) {
      modules.characters = { ok: false, err: String(e?.message || e) };
    }

    try {
      const chars = ctx.clockChars || [];
      const rows = [];
      for (const ch of chars) {
        const st = await clock.state(ch.id);
        const now = clock.nowFor(0);
        const next = (ch.slots || [])
          .filter((s) => !st.slots?.[s.id]?.done || st.date !== now.date)
          .sort((a, b) => a.at.localeCompare(b.at))[0];
        rows.push(`${ch.id}:${next ? next.at : "今日完"}`);
      }
      modules.clock = { ok: true, note: rows.join(" · ") || "没有排班" };
    } catch (e) {
      modules.clock = { ok: false, err: String(e?.message || e) };
    }

    modules.config = { ok: !!cfg, note: cfg?.source ? "本机" : "发布包默认" };
    modules.inject = { ok: true, note: ctx.injectMode || "off" };

    return c.json({
      ok: Object.values(modules).every((m) => m.ok),
      uptime: Date.now() - (startedAt || Date.now()),
      modules,
    });
  });
}
