// 橘子树 · 角色包路由 | 原创实现
//
// 具体路径先注册，再挂 :id，避免 create/import 被当成 id。

export function registerCharacterRoutes(app, { store, sdk, onCreated, onRemoved }) {
  app.get("/characters", (c) => {
    try {
      return c.json({ ok: true, items: store.list() });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  app.post("/characters/create", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const r = store.create(body);
      // 建完包就把这项写进配置：不写的话注入/时钟/信都不认她（以前要人去邮箱页手填）
      try { await onCreated?.(r.id); } catch { /* 写配置失败不拦建包 */ }
      return c.json(r);
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });

  // 建完包，接着把 agent 也建出来——不然卡只是个文件夹
  app.post("/characters/:id/agent", async (c) => {
    const id = String(c.req.param("id") || "");
    const body = await c.req.json().catch(() => ({}));
    try {
      const d = store.load(id);
      if (!d) return c.json({ ok: false, err: "没有这个人" }, 404);
      // 先走主 Agent 通道（agent:create）——这才是 Hana 里真能用的 agent；
      // environments.createAgent 建的是隔离环境里的副本，界面上看不到，等于白建。
      let r = null;
      let via = "bus";
      try {
        r = await sdk.bus.request("agent:create", {
          name: d.profile?.name || id,
          id,
          yuan: String(body.yuan || "hanako"),
          initialFiles: { identity: d.identity || "", agents: d.agents || d.persona || "" },
        });
      } catch (e1) {
        // 已经建过就直接算成功：重复点不该报错
        if (/已存在|already exists/i.test(String(e1?.message || e1))) {
          return c.json({ ok: true, via: "bus", existed: true, agent: { id, name: d.profile?.name || id } });
        }
        // 回退：走环境（旧路），失败就把两个错误都带回去
        via = "env";
        let envs = [];
        try { envs = await sdk.environments.list(); } catch { envs = []; }
        let env = (Array.isArray(envs) ? envs : []).find((e) => e && e.state === "running") || (Array.isArray(envs) ? envs[0] : null);
        if (!env) env = await sdk.environments.create();
        let snap = env;
        try {
          const fresh = await sdk.environments.get({ environmentId: env.environmentId });
          if (fresh && fresh.environmentId) snap = fresh;
        } catch { /* 用旧的 */ }
        r = await sdk.environments.createAgent({
          environmentId: snap.environmentId,
          revision: snap.revision,
          id,
          name: d.profile?.name || id,
          yuan: String(body.yuan || "hanako"),
          identity: d.identity || "",
          agentsMd: d.agents || d.persona || "",
        }).catch((e2) => { throw Object.assign(new Error(`bus:${e1?.message || e1} / env:${e2?.message || e2}`), { status: 500 }); });
      }
      // 回退到环境建出来的人，界面上看不到——不能报得跟正路一样
      return c.json({
        ok: true,
        via,
        agent: r.agent,
        ...(via === "env"
          ? { warning: "建是建了，但只建在环境副本里，界面上看不到这个人。多半是缺 app/agents.manage 授权" }
          : {}),
      });
    } catch (e) {
      await sdk.logger?.warn?.(`[agent] 建 ${id} 失败：${e?.message || e}`);
      return c.json({ ok: false, err: String(e?.message || e) }, 500);
    }
  });

  app.post("/characters/delete", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const r = store.remove(body.id);
      // 配置里那项也得跟着走，不然时钟继续给一个不存在的角色派信
      try { await onRemoved?.(r.id); } catch { /* 同上 */ }
      return c.json(r);
    } catch (e) {
      await sdk.logger?.warn?.(`[agent] 删 ${body.id} 失败：${e?.message || e}`);
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });

  app.post("/characters/import", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const card = body.card ?? body;
    try {
      const r = store.importST(card, { id: body.id });
      try { await onCreated?.(r.id); } catch { /* 同上 */ }
      return c.json(r);
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });

  app.post("/characters/:id/avatar", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(store.saveAvatar(c.req.param("id"), body.data));
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });

  app.get("/characters/:id/export", (c) => {
    try {
      const id = String(c.req.param("id") || "");
      return c.json({ ok: true, card: store.exportST(id) });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });

  app.get("/characters/:id", (c) => {
    try {
      const id = String(c.req.param("id") || "");
      const d = store.load(id);
      return c.json({
        ok: true,
        id: d.id,
        profile: d.profile,
        identity: d.identity,
        agents: d.agents,
        publicAgents: d.publicAgents,
        persona: d.persona,
        worldbook: d.worldbook,
      });
    } catch (e) {
      return c.json({ ok: false, err: String(e?.message || e) }, e?.status || 500);
    }
  });
}
