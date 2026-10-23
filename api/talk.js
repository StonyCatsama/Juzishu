// 橘子树 · 跨角色消息路由 | 原创实现
//
// 待转达列表 + 放行/丢弃 + 「要不要先问我」这个开关。

export function registerTalkRoutes(app, { store, deliver, settings }) {
  app.get("/talk", (c) => {
    let status = "pending";
    try {
      const u = new URL(String(c.req.url || ""), "http://localhost");
      status = String(u.searchParams.get("status") || "pending");
    } catch { /* 默认待办 */ }
    let requireConfirm = true;
    try { requireConfirm = settings?.requireConfirm?.() !== false; } catch { /* 默认要问 */ }
    return c.json({ ok: true, requireConfirm, items: store.list(status) });
  });

  app.post("/talk/approve", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body?.id || "");
    const box = store.list("all");
    const it = box.find((x) => x.id === id);
    if (!it) return c.json({ ok: false, err: "没有这条" }, 404);
    if (it.status !== "pending") return c.json({ ok: false, err: "这条已经处理过了" }, 400);
    try {
      const r = await deliver?.(it.from, it.to, it.text);
      if (r && r.ok === false) {
        store.mark(id, "pending", r.err || "没投出去");
        return c.json({ ok: false, err: r.err || "没投出去" });
      }
      store.mark(id, "sent", String(r?.outcome || "sent"));
      return c.json({ ok: true });
    } catch (e) {
      store.mark(id, "pending", String(e?.message || e));
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  app.post("/talk/reject", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      store.mark(String(body?.id || ""), "dropped");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, Number(e?.status) || 500);
    }
  });

  // 「要不要先问我」：默认 true。关掉就直接投（仍加「某人带话」的标记）
  app.post("/talk/setting", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const next = settings?.set?.({ requireConfirm: body?.requireConfirm !== false });
      return c.json({ ok: true, ...(next || {}) });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });
}
