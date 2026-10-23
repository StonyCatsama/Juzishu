// 橘子树 · 邮戳路由 | 原创实现

export function registerPostmarkRoutes(app, { store, dirs, tz, agents, names, stateOf }) {
  app.get("/postmark", async (c) => {
    const out = {};

    for (const a of agents) {
      const dir = dirs[a];
      if (!dir) {
        out[a] = { name: names[a], missing: true };
        continue;
      }

      const now = new Date(Date.now() + (tz[a] || 0) * 3600 * 1000);
      const nowMin = now.getHours() * 60 + now.getMinutes();

      const hit = await store.latest(dir);
      if (!hit) {
        out[a] = { name: names[a], missing: true };
        continue;
      }

      const chain = store.parseChain(hit.text);

      // 实况优先：她自己说的“我在哪”压过信里的预排
      const st = stateOf ? await stateOf(a) : null;
      const lp = st?.place?.name ? st.place : null;

      let here = null;
      if (lp) {
        here = { place: lp.name, state: null };
      } else {
        here = store.placeAt(chain, nowMin);
      }

      out[a] = {
        name: names[a],
        date: hit.date,
        tz: tz[a] || 0,
        nowMin,
        nowText: `${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`,
        here,
        livePlace: lp,
        chain,
      };
    }

    return c.json(out);
  });
}
