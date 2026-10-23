// 橘子树 · 时钟路由 | 原创实现
//
// 看今天每一档打算几点做、做没做。

export function registerClockRoutes(app, { clock, characters }) {
  app.get("/clock", async (c) => {
    const out = { now: new Date().toISOString(), characters: {} };

    for (const ch of characters) {
      const st = await clock.state(ch.id);
      const { date, min } = clock.nowFor(ch.tz || 0);
      out.characters[ch.id] = {
        name: ch.name,
        date,
        nowMin: min,
        nowText: `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`,
        slots: ch.slots.map((s) => {
          const rec = st.date === date ? st.slots[s.id] : null;
          return {
            id: s.id,
            window: s.window,
            at: rec?.atText || null,
            action: rec?.action || (rec ? "planned" : "waiting"),
            skip: rec?.skip ?? null,
            done: rec?.done ?? false,
          };
        }),
      };
    }

    return c.json(out);
  });
}
