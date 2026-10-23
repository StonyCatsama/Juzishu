// 橘子树 · 装填预览路由 | 原创实现
//
// 只读：把这轮“会塞什么”吐出来，不真的注入。

import { buildPreview, timeBlock, stateBlock } from "../modules/inject/index.js";

export function registerInjectRoutes(app, { drawer, letter, seal, dirs, tz, agents, names }) {
  app.get("/inject/preview", async (c) => {
    let agent = "";
    let text = "";
    try {
      const u = new URL(String(c.req.url || ""), "http://localhost");
      agent = (u.searchParams.get("agent") || "").trim();
      text = u.searchParams.get("text") || "";
    } catch {
      /* 用空值 */
    }

    if (!agents.includes(agent)) return c.json({ ok: false, err: "未知 agent" }, 400);

    const all = await drawer.list();
    const entries = all.filter((e) => !e.agentId || e.agentId === agent);

    const dir = dirs[agent];
    const hit = dir ? await letter.latest(dir) : null;
    const minutes = new Date(Date.now() + ((tz[agent] || 0) + 8) * 3600 * 1000);
    const nowMin = minutes.getUTCHours() * 60 + minutes.getUTCMinutes();
    const timeText = `${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`;

    const st = await seal.read(agent);
    const chain = hit ? letter.parseChain(hit.text) : [];
    const here = st?.place?.name
      ? { place: st.place.name, state: "" }
      : letter.placeAt(chain, nowMin);

    const mBlock = timeBlock({
      date: `${hit?.date || ""} ${weekdayCN()}`.trim(),
      timeText,
      sinceMin: null,
    });
    const sBlock = stateBlock(st);

    const preview = buildPreview({ entries, text, timeBlock: mBlock, stateBlock: sBlock });

    return c.json({
      ok: true,
      agent,
      name: names[agent] || agent,
      input: text,
      entriesTotal: entries.length,
      place: here?.place || null,
      ...preview,
    });
  });
}

function weekdayCN() {
  const w = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date());
  return w;
}
