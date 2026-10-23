// 橘子树 · 世界书路由 | 原创实现

import { readLinks } from "../modules/drawer/index.js";

export function registerDrawerRoutes(app, { store, linksPath, sdk }) {
  app.get("/drawer", async (c) => {
    try {
      const items = await store.list();
      return c.json({ ok: true, count: items.length, items });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.code || e?.message || e) }, 500);
    }
  });

  app.post("/drawer/link", async (c) => {
    try {
      const b = await c.req.json().catch(() => ({}));
      return c.json(await store.addLink(b.childId, b.parentId, b.note));
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, Number(e?.status) || 500);
    }
  });

  app.post("/drawer/unlink", async (c) => {
    try {
      const b = await c.req.json().catch(() => ({}));
      return c.json(await store.removeLink(b.childId, b.parentId));
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, Number(e?.status) || 500);
    }
  });

  app.get("/drawer/link", async (c) => {
    let id = "";
    try {
      const u = new URL(String(c.req.url || ""), "http://localhost");
      id = String(u.searchParams.get("id") || "");
    } catch { /* 空 */ }
    try {
      const parents = await store.parentsOf(id);
      const children = await store.childrenOf(id);
      return c.json({ ok: true, parents, children });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  app.post("/drawer/set", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const r = await store.upsert(body.id, body);
      return c.json(r);
    } catch (e) {
      const status = e?.status || 500;
      return c.json({ ok: false, err: String(e?.message || e) }, status);
    }
  });

  app.post("/drawer/del", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const r = await store.remove(body.id);
      return c.json(r);
    } catch (e) {
      const status = e?.status || 500;
      return c.json({ ok: false, err: String(e?.message || e) }, status);
    }
  });

  app.post("/drawer/new", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const r = await store.create(body);
      return c.json(r);
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });

  app.get("/links", async (c) => {
    try {
      const r = await readLinks(sdk, linksPath);
      return c.json({ ok: true, count: r.count, idx: r.idx });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });
}
