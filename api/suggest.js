// 橘子树 · 代办区路由 | 原创实现
//
// 提议的增、查、收下、扔掉。收下才写抽屉——写抽屉走 drawerStore.create。

export function registerSuggestRoutes(app, { store, drawer, agents, notify }) {
  app.get("/suggest", (c) => {
    let status = "pending";
    try {
      const u = new URL(String(c.req.url || ""), "http://localhost");
      status = String(u.searchParams.get("status") || "pending");
    } catch { /* 默认待办 */ }
    return c.json({ ok: true, items: store.list(status) });
  });

  app.post("/suggest/accept", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const id = String(body?.id || "");
      const all = store.list("all");
      const it = all.find((x) => x.id === id);
      if (!it) return c.json({ ok: false, err: "没有这条提议" }, 404);
      if (it.status !== "pending") return c.json({ ok: false, err: "这条已经处理过了" }, 400);

      // 总览：只由人勾选，内容不由人写——补写交给 agent 自己
      const asks = Array.isArray(body?.parents) ? body.parents : (body?.parentId ? [{ id: body.parentId }] : []);
      const PRIORITIES = [100, 75, 50, 25];
      const asked = Number(body?.priority);
      const priority = PRIORITIES.includes(asked) ? asked : (asks.length ? 50 : 75);

      const entries = await drawer.list();
      const resolved = [];
      for (const a of asks) {
        const pid = String(a?.id || a || "");
        const parent = entries.find((x) => x.id === pid);
        if (!parent) return c.json({ ok: false, err: `总览不存在：${pid}` }, 400);
        if (String(parent.agentId || "") !== String(it.agentId || "")) {
          return c.json({ ok: false, err: `「${parent.name}」不是这个 agent 的条目` }, 400);
        }
        resolved.push(parent);
      }

      // 名字可以在面板上改（她提的时候可能估得不对：叫“礼物”的其实是“围巾”）
      const name = String(body?.name || "").trim() || it.name;

      // 同名就不新建——库里已有「氛围」「礼物」这种容器，再 create 会长出第二条同名的。
      // 同名的意思就是“往那条里补”，走 appendBody。
      const entries2 = await drawer.list();
      const same = entries2.find(
        (x) => x.name === name && String(x.agentId || "") === String(it.agentId || "")
      );

      let r;
      if (same) {
        await drawer.appendBody(same.id, it.body);
        r = { ok: true, id: same.id, name: same.name, appended: true };
      } else {
        r = await drawer.create({
          agentId: it.agentId,
          name,
          trigger: it.trigger,
          body: it.body,
          priority,
          policy: "inject",
        });
        for (const parent of resolved) {
          await drawer.addLink(r.id, parent.id, "");
        }
      }

      store.mark(id, "accepted");

      // 关系有了，内容没有——投一条提醒，让她自己补
      let nudged = false;
      if (resolved.length && typeof notify === "function") {
        const names = resolved.map((p) => p.name).join("、");
        const text = [
          `（新条目「${it.name}」已经进抽屉，归到：${names}。）`,
          `${names} 那边各补一句——这次推进了什么，是新的一处，还是更熟了一点。`,
          `工具叫 drawer_patch（在 app__juzishu 下；用 tool_search 查 drawer_patch 拿整串名字）。一句话就行；不想补就不补。`,
        ].join("\n");
        nudged = !!(await notify(it.agentId, text));
      }

      return c.json({ ok: true, id: r?.id || null, name, priority, parents: resolved.map((p) => p.name), nudged, appended: !!r?.appended });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, Number(e?.status) || 500);
    }
  });

  app.post("/suggest/reject", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      store.mark(String(body?.id || ""), "rejected");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, Number(e?.status) || 500);
    }
  });
}
