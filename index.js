// index.js — 橘子树 · v2 App 入口（0.1.0，前端沿用既有看板）
//
// 只做装配：拿 SDK → 挂路由 → 返回清理。
// 数据源：只读现有的 state-desire / worldbook / ODAY 文件，不动它们。
// 前端：ui/viewer.html（卡片），按 App 约定由宿主静态服务。
import path from "node:path";
import { defineApp } from "./sdk/app-contract/server-client.js";
import { fileURLToPath } from "node:url";
import { createSealStore } from "./modules/seal/index.js";
import { registerSealRoutes } from "./api/seal.js";
import { createWorldbookStore } from "./modules/drawer/index.js";
import { registerDrawerRoutes } from "./api/drawer.js";
import { createLetterStore, sectionOf } from "./modules/letter/index.js";
import { registerLetterRoutes } from "./api/letter.js";
import { registerPostmarkRoutes } from "./api/postmark.js";
import { createClock } from "./modules/clock/index.js";
import { registerClockRoutes } from "./api/clock.js";
import { createCharacters } from "./modules/characters/index.js";
import { registerCharacterRoutes } from "./api/characters.js";
import { registerInjectRoutes } from "./api/inject.js";
import { buildPreview, timeBlock, stateBlock, anchor } from "./modules/inject/index.js";
import { RECALL_DEFAULTS, recallFor, recallTextFor, shouldRecall, buildRecall } from "./modules/inject/recall.js";
import { buildDayChain, pickPlaceStrict } from "./modules/inject/place.js";
import { nowFor } from "./modules/clock/index.js";
import { loadConfig, derive, saveConfig } from "./modules/config/index.js";
import { registerConfigRoutes } from "./api/config.js";
import { registerHealthRoutes } from "./api/health.js";
import { registerUrgeRoutes } from "./api/urge.js";
import { evaluate as evaluateUrge, nudge as urgeNudge, silenceMood, DEFAULTS as URGE_DEFAULTS } from "./modules/urge/index.js";
import { registerSessionRoutes } from "./api/sessions.js";
import { createSessionMemory } from "./modules/sessions/index.js";
import { createDigest } from "./modules/digest/index.js";
import { createSuggestionStore } from "./modules/suggest/index.js";
import { registerSuggestRoutes } from "./api/suggest.js";
import { createTalkStore } from "./modules/talk/index.js";
import { registerTalkRoutes } from "./api/talk.js";
import { registerAgentAdoptRoutes } from "./api/agents.js";
import { registerRuleRoutes } from "./api/rules.js";
import { registerAvatarRoutes } from "./api/avatars.js";
import { registerPlaceRoutes } from "./api/place.js";
const __APP_DIR = path.dirname(fileURLToPath(import.meta.url));

export default defineApp(async (sdk) => {
  const dataDir = sdk.dataDir || null;
  const startedAt = Date.now();
  try {
    await sdk.logger?.info?.(`[juzishu] loaded, dataDir=${dataDir}`);
  } catch { /* 日志失败不影响启动 */ }

  // 宿主提供的能力探测（先摸清有什么可用的）
  const caps = {
    dataDir: !!dataDir,
    sessions: !!sdk.sessions,
    agents: !!sdk.agents,
    bus: !!sdk.bus,
    storage: !!sdk.storage,
  };

  const os = await import("node:os");
  const pathMod = await import("node:path");
  const HANA = pathMod.join(os.homedir(), ".hanako");
  let cfg = loadConfig({ appDir: __APP_DIR, dataDir });
  const sealStore = createSealStore({ sdk, home: HANA, dataDir, mood: cfg.defaults?.mood, tzOf: (id) => tzLookup(id), talkCount: (id) => talkLookup(id) });
  const drawerStore = createWorldbookStore({ sdk, home: HANA, dataDir });

  // 从属映射：搬进 app-data（一次性），之后只读这一份，不再依赖桌面目录
  const linksLocal = dataDir ? pathMod.join(dataDir, "links.json") : "";
  const linksSrc = cfg.paths?.links || "";
  let linksPath = linksSrc;
  try {
    const fsMod = await import("node:fs");
    if (linksLocal && linksSrc) {
      if (!fsMod.existsSync(linksLocal) && fsMod.existsSync(linksSrc)) {
        fsMod.mkdirSync(pathMod.dirname(linksLocal), { recursive: true });
        fsMod.copyFileSync(linksSrc, linksLocal);
        await sdk.logger?.info?.(`[drawer] 从属映射搬入 ${linksLocal}`);
      }
      if (fsMod.existsSync(linksLocal)) linksPath = linksLocal;
    }
  } catch { /* 搬不动就退回原路径读 */ }
  // 时区查表：在 derive 之后才拿到真值，先挂一个空函数，后面覆盖
  let tzLookup = () => 0;
  // “今天他说了几句”：seal 读的时候用；digest 在下面才建，所以同样先挂空
  let talkLookup = async () => null;
  const letterStore = createLetterStore({ sdk, dataDir, tzOf: (id) => tzLookup(id) });
  const characterStore = createCharacters({ appDir: __APP_DIR, dataDir });
  const sessionMemory = createSessionMemory({ dataDir });
  const digest = createDigest({ sdk, home: HANA, dataDir });
  // 今天他说了几句：给封签算心情浓淡用（缓存 60 秒，不必每次刷都重读会话）
  const talkCache = new Map();
  talkLookup = async (id) => {
    const hit = talkCache.get(id);
    if (hit && Date.now() - hit.at < 60000) return hit.n;
    try {
      const d = await digest.today(id, { tzOffset: tzLookup(id) || 0, limit: 1, chars: 1, onlyMain: true });
      const n = Number.isFinite(Number(d?.userMessages)) ? Number(d.userMessages) : null;
      talkCache.set(id, { at: Date.now(), n });
      return n;
    } catch {
      talkCache.set(id, { at: Date.now(), n: null });
      return null;
    }
  };
  const suggestionStore = createSuggestionStore({ dataDir });
  const talkStore = createTalkStore({ dataDir });

  // 首次启动不自动铺角色：人由 Hana 建，橘子树只接（见 api/agents.js）

  // 数据目录里有角色包、但配置里没有的：自动补一条（以前手动放进去的角色信页/时钟都不认）。
  try {
    const fsAdd = await import("node:fs");
    const cdir = dataDir ? pathMod.join(dataDir, "characters") : "";
    if (cdir && fsAdd.existsSync(cdir)) {
      let added = 0;
      for (const name of fsAdd.readdirSync(cdir)) {
        if (name.startsWith(".")) continue;
        if ((cfg.characters || []).some((c) => c && c.id === name)) continue;
        const profPath = pathMod.join(cdir, name, "profile.json");
        if (!fsAdd.existsSync(profPath)) continue;
        let prof = {};
        try { prof = JSON.parse(fsAdd.readFileSync(profPath, "utf8")); } catch { continue; }
        const slots = (Array.isArray(prof.letters?.slots) ? prof.letters.slots : [])
          .map((s) => ({ id: String(s.id || ""), at: String(s.at || "") }))
          .filter((s) => s.id && /^\d{1,2}:\d{2}$/.test(s.at));
        cfg.characters = [
          ...(Array.isArray(cfg.characters) ? cfg.characters : []),
          {
            id: name,
            name: prof.name || name,
            timezone: prof.timezone || "Asia/Shanghai",
            lettersDir: pathMod.join(dataDir, "letters", name),
            promptsDir: pathMod.join(cdir, name, "letters"),
            slots: slots.length ? slots : [{ id: "morning", at: "07:00" }, { id: "noon", at: "12:00" }, { id: "evening", at: "18:00" }],
            mainSession: "",
          },
        ];
        added++;
      }
      if (added) {
        saveConfig({ dataDir, cfg });
        await sdk.logger?.info?.(`[config] 自动补进配置的角色：${added} 个`);
      }
    }
  } catch { /* 补不进去也不拦启动 */ }
  const {
    agents: AGENTS,
    names: NAMES,
    tz: ODAY_TZ,
    lettersDir: ODAY_DIRS,
    promptDir: LETTER_DIRS,
    clockChars: CLOCK_CHARS,
  } = derive(cfg, { appDir: __APP_DIR, dataDir });
  tzLookup = (id) => ODAY_TZ[id] || 0;

  // 投递开关
  const DISPATCH_ENABLED = true;

  const SLOT_NAME = { morning: "早档", noon: "中档", evening: "晚档", night: "收尾档" };

  // 工具叫法只写在这一处，所有工具描述末尾拼它。
  // 之前每个工具各写一段，其中两处把 server 写成了 app__juzishu，
  // 结果她照着填三次都被拒——错在我们的说明，不在她。
  // 她扫一眼工具列表就下判断：看不到就说“没这工具”，然后改口说。所以这句
  // 必须摆在每个描述的**最前面**，藏在第二段等于没写。
  const HOW_TO_CALL_HEAD =
    "**这工具要先 tool_search 查名字，别猜、别跳过；一次没查到就再查一次。**\n";

  const HOW_TO_CALL =
    "**怎么调**：先 tool_search 查到整串，形如 `app__juzishu__<工具名>_<哈希>（juzishu）`——" +
    "**括号里那个 `juzishu` 填 server，前面整串填 tool**。别自己拼前缀，也别把 server 写成 app__juzishu。";

  // 同一间房同时被 tick 和 redraft 要，会各建一间（23:43 就这么建重了两间）。
  // 用一个 pending 表把并发擋在门外。
  const sessionPending = new Map();

  async function ensureSession(ch, kind = "juzishu-letter") {
    const st = await clock.state(ch.id);
    const key = kind === "juzishu-urge" ? "urgeSessionPath"
      : kind === "juzishu-patch" ? "patchSessionPath"
      : "sessionPath";
    if (st[key]) return st[key];

    const lockKey = `${ch.id}:${kind}`;
    if (sessionPending.has(lockKey)) return sessionPending.get(lockKey);

    const job = (async () => {
      try {
        // 私有房间里用 operate：这间房是 App 自己建的干活地方，里面只有“读档、写档、过代办”三样，
        // 而 Auto 模式的审查器只认 role=user 的消息作意图证据——私有房间里一条都没有，
        // 所以不指定的话每一次工具调用都会被判“没有授权来源”而拒掉。
        const r = await sdk.sessions?.create?.({ agentId: ch.id, kind, permissionMode: "operate" });
        const p = r?.sessionPath || r?.path || r?.session?.sessionPath;
        if (p) {
          const latest = await clock.state(ch.id);
          latest[key] = p;
          await clock.save(ch.id, latest);
          await sdk.logger?.info?.(`[clock] session created ${ch.id}(${kind}) -> ${p}`);
        } else {
          await sdk.logger?.warn?.(`[clock] session create returned no path: ${JSON.stringify(r)?.slice(0, 200)}`);
        }
        return p || null;
      } catch (e) {
        await sdk.logger?.warn?.(`[clock] session create failed ${ch.id}: ${e?.message}`);
        return null;
      }
    })();

    sessionPending.set(lockKey, job);
    try {
      return await job;
    } finally {
      sessionPending.delete(lockKey);
    }
  }

  async function dispatchLetter(ch, slot, rec) {
    const dir = LETTER_DIRS[ch.id];
    if (!dir) {
      await sdk.logger?.warn?.(`[clock] no letters dir for ${ch.id}`);
      return;
    }
    const tpl = await readText(pathMod.join(dir, `${slot.id}.md`));
    if (!tpl) {
      await sdk.logger?.warn?.(`[clock] no prompt file ${ch.id}/${slot.id}`);
      return;
    }

    // rec.note：用户点名重写时给的附加要求。和提示词冲突时以它为准。
    const note = String(rec?.note || "").trim();
    const isNight = slot.id === "night";
    const head =
      (note ? `${note}\n（这一段和下面那份常规要求冲突时，以这一段为准。）\n\n` : "") +
      (isNight
        ? `【时钟】今天的收尾时间到了（定的 ${slot.at}，这一次 ${rec?.atText || ""}）。` +
          `这一档不写日子，只过一遍今天的话。按下面这份要求做，不用先跟我说话。\n\n`
        : `【时钟】现在是你今天的${SLOT_NAME[slot.id] || slot.id}（定的 ${slot.at}，这一次 ${rec?.atText || ""}）。` +
          `按下面这份要求写，不用先跟我说话。\n\n`);

    const sessionPath = await ensureSession(ch);
    if (!sessionPath) {
      await sdk.logger?.warn?.(`[clock] no session for ${ch.id}/${slot.id}`);
      return { ok: false, err: "no session" };
    }

    try {
      // 不等完整回执：发出去就算投递，回执慢不拖住整拍
      const sendPromise = sdk.sessions.sendCustom({
        sessionPath,
        content: head + tpl,
        customType: "juzishu.letter",
        display: false,
        triggerTurn: true,
      });
      sendPromise.catch(() => {});

      const ack = await Promise.race([
        sendPromise.then(() => "sent").catch((e) => "error:" + (e?.message || e)),
        new Promise((r) => setTimeout(() => r("dispatched"), 2500)),
      ]);

      if (ack === "sent") await sdk.logger?.info?.(`[clock] sent ${ch.id}/${slot.id} -> ${sessionPath}`);
      else if (ack === "dispatched") await sdk.logger?.info?.(`[clock] dispatched ${ch.id}/${slot.id} (no ack in 2.5s) -> ${sessionPath}`);
      else await sdk.logger?.warn?.(`[clock] send failed ${ch.id}/${slot.id}: ${ack}`);
      return { ok: true, outcome: ack, sessionPath };
    } catch (e) {
      await sdk.logger?.warn?.(`[clock] send failed ${ch.id}/${slot.id}: ${e?.message}`);
      return { ok: false, err: String(e?.message || e) };
    }
  }

  /**
   * 开机派信队列：app-data/juzishu/redraft.json
   * [{"agentId":"<角色 id>","slot":"morning","note":"把 10-20 的早上重写一遍"}]
   * 派完清空。用户点名重写某一档就走这里，不用碰定时器。
   */
  async function runRedraft() {
    const p = pathMod.join(dataDir, "redraft.json");
    const t = await readText(p);
    if (!t) return;
    let list = [];
    try {
      list = JSON.parse(t);
    } catch {
      return;
    }
    if (!Array.isArray(list) || !list.length) return;

    for (const item of list) {
      const ch = CLOCK_CHARS.find((x) => x.id === String(item?.agentId || ""));
      if (!ch) continue;
      const slot = ch.slots.find((s) => s.id === String(item?.slot || "")) || ch.slots[0];
      if (!slot) continue;
      await dispatchLetter(ch, slot, { atText: "手动重发", note: item?.note || "" });
    }
    try {
      await sdk.resources.write({ kind: "local-file", path: p }, JSON.stringify([], null, 2));
    } catch { /* 清不掉就下次再跑一次，不拦启动 */ }
  }

  const clock = createClock({
    sdk,
    dataDir,
    characters: CLOCK_CHARS,
    onWake: (ch, slot, rec) => {
      if (!DISPATCH_ENABLED) {
        sdk.logger?.info?.(`[clock] due ${ch.id}/${slot.id} @${rec.atText}（投递未开）`);
        return undefined;
      }
      return dispatchLetter(ch, slot, rec);
    },
    onSkip: (ch, slot) => sdk.logger?.info?.(`[clock] skip ${ch.id}/${slot.id}`),
    onMiss: (ch, slot) => sdk.logger?.info?.(`[clock] missed ${ch.id}/${slot.id}`),
  });

  const timer = setInterval(() => {
    clock.tick().catch(() => {});
  }, 60_000);
  // 等装配完再跑第一拍：readText 这类工具在后面才定义，提早跑会静默失败
  setTimeout(() => {
    clock.tick().catch(() => {});
    // 用户点名重写的那些档，开机就派出去（派完清空队列）
    runRedraft().catch(() => {});
  }, 5_000);

  /** 从一段 jsonl 文本里找最后一条“他说的”的时间（ms） */
  function scanLastUserTs(text) {
    const lines = String(text || "").split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i].trim();
      if (!ln.startsWith("{")) continue;
      let o;
      try { o = JSON.parse(ln); } catch { continue; }
      if (o?.message?.role !== "user") continue;
      const t = Date.parse(o.timestamp || o.message?.timestamp || "");
      if (Number.isFinite(t)) return t;
    }
    return 0;
  }

  /** 单个会话文件里最后一条“他说的”的时间（ms）。
   *
   * 快路用 node:fs 只读尾部一块；但 App 进程只被放行自己的目录，
   * 读会话目录会抛——那时退回 sdk.resources 走宿主授权读全文。
   * （之前只有快路，读不到就静默返回 0，心跳就卡在这儿。） */
  async function lastUserTsInFile(fs, file) {
    let opened = false;
    try {
      const st = fs.statSync(file);
      const CHUNK = 128 * 1024;
      const start = Math.max(0, st.size - CHUNK);
      const fd = fs.openSync(file, "r");
      opened = true;
      const buf = Buffer.alloc(st.size - start);
      try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
      const t = scanLastUserTs(buf.toString("utf8"));
      if (t) return t;
    } catch { /* 读不了就走下面 */ }
    if (opened) return 0; // 能读且确实没有 user 消息，不用再读一遍

    const text = await readText(file);
    return text ? scanLastUserTs(text) : 0;
  }

  /** “他上次说话”的时间（ms）。心跳拿它当料。
   *
   * target 是 jsonl 路径就直接读它。
   * 否则不能取“文件名最新”的那个——文件名是会话创建时间，主会话开得早，永远排在后面；
   * 而写信室/心跳室这种干活房间又没有 user 消息，取它只会得 0。
   * 改成：按文件最后写入时间倒序看几个，取最后一条 user 消息最晚的那个。 */
  async function lastUserTsOf(agentId, target) {
    try {
      const fs = await import("node:fs");
      const p = String(target || "");
      if (p.endsWith(".jsonl")) return lastUserTsInFile(fs, p);

      const dir = pathMod.join(HANA, "agents", agentId, "sessions");
      let names = [];
      try {
        const r = await sdk.resources.list({ kind: "local-file", path: dir });
        const arr = Array.isArray(r) ? r : (r?.entries || r?.items || []);
        names = arr.map((x) => String(x?.name || "")).filter((n) => n.endsWith(".jsonl"));
      } catch { return 0; }
      if (!names.length) return 0;

      // mtime 比文件名可靠：文件名是创建时间，mtime 是最后说话时间。
      // 但 App 进程 stat 不了会话目录，那时 m 全是 0——那就全读，別靠排序猜。
      const cands = names.map((n) => {
        const full = pathMod.join(dir, n);
        let m = 0;
        try { m = fs.statSync(full).mtimeMs; } catch { /* 没权限就保持 0 */ }
        return { full, m };
      });
      const statOk = cands.some((c) => c.m > 0);
      const picked = statOk ? cands.sort((a, b) => b.m - a.m).slice(0, 6) : cands;

      let best = 0;
      for (const c of picked) {
        const t = await lastUserTsInFile(fs, c.full);
        if (t > best) best = t;
      }
      // 抽检过的没命中，再把剩下的也读一遍（宁可多读几个文件，不要静默返回 0）
      if (!best && statOk) {
        for (const c of cands) {
          const t = await lastUserTsInFile(fs, c.full);
          if (t > best) best = t;
        }
      }
      return best;
    } catch { return 0; }
  }

  /** 一次性：把旧映射 JSON 里的父子关系搬进库（幂等，按 id 对； id 对不上就按同 agent 同名找）。 */
  async function importLegacyLinks(pathStr) {
    try {
      const r = await sdk.resources.read({ kind: "local-file", path: pathStr });
      const txt = typeof r === "string" ? r : (r?.content ?? r?.text ?? "");
      if (!txt) return 0;
      const j = JSON.parse(String(txt));
      const all = await drawerStore.list();
      const byId = new Map(all.map((e) => [e.id, e]));
      const byName = (agent, name) => all.find((e) => e.name === name && String(e.agentId || "") === String(agent || ""));

      let added = 0;
      const put = async (agent, parentRef, childRef, why) => {
        const p = byId.get(parentRef?.id) || byName(agent, parentRef?.name);
        const c = byId.get(childRef?.id) || byName(agent, childRef?.name);
        if (!p || !c || p.id === c.id) return;
        await drawerStore.addLink(c.id, p.id, String(why || ""));
        added++;
      };

      for (const h of j.hierarchy || []) {
        for (const ch of h.children || []) await put(h.agent, h.parent, ch, ch.evidence || "");
      }
      for (const m of j.multi_parent || []) {
        for (const p of m.parents || []) await put(m.agent, p, { id: m.id, name: m.name }, p.why || "");
      }
      return added;
    } catch {
      return 0;
    }
  }

  /** 把一条跨角色消息投进对方主会话：带「某人带话」标记，display:false，不冒充用户说话。 */
  async function deliverTalk(from, to, text) {
    const ch = (cfg.characters || []).find((c) => c.id === to);
    const addr = String(ch?.mainSession || "").trim();
    if (!addr) return { ok: false, err: `${to} 没配主会话，发不过去` };
    const name = NAMES[from] || from;
    try {
      const p = sdk.sessions.sendCustom({
        ...(addr.startsWith("sess_") ? { sessionId: addr } : { sessionPath: addr }),
        scope: "all",
        content: `（${name} 带话：${text}）`,
        customType: "juzishu.talk",
        display: false,
        triggerTurn: true,
      });
      const ack = await Promise.race([
        p.then(() => "sent").catch((e) => "error:" + (e?.message || e)),
        new Promise((r) => setTimeout(() => r("dispatched"), 2500)),
      ]);
      await sdk.logger?.info?.(`[talk] ${from} -> ${to}: ${ack}`);
      if (String(ack).startsWith("error")) return { ok: false, err: String(ack), outcome: ack };
      return { ok: true, outcome: ack };
    } catch (e) {
      return { ok: false, err: String(e?.message || e) };
    }
  }
  async function runUrge(opts = {}) {
    const dry = !!opts.dry;
    const results = [];
    try {
      for (const ch of CLOCK_CHARS) {
        // 四档与静默都按用户实际时间走；她的时区只用于“她那边几点”
        const now = clock.nowFor(ch.tz || 0);
        const addr = ch.mainSession;
        if (!addr) {
          await sdk.logger?.warn?.(`[urge] ${ch.id} 没配 mainSession，跳过`);
          results.push({ id: ch.id, name: ch.name, ok: false, gate: "mainSession", reason: "没配 mainSession" });
          continue;
        }

        // “他上次说话”取两个来源里更新的那个：
        // sessions.json 里的记录（注入时顺手写的）和会话文件里最后一条 user 消息。
        // 单靠前者会拿旧值（表曾经写不回去），单靠后者在文件很多时容易挑错。
        const meta = sessionMemory.recent(ch.id);
        let lastUserAt = Number(meta?.at) || 0;
        let source = lastUserAt ? "sessions.json" : "";
        const fileTs = await lastUserTsOf(ch.id, addr);
        if (fileTs > lastUserAt) {
          lastUserAt = fileTs;
          source = "会话文件";
        }
        if (!lastUserAt) {
          await sdk.logger?.warn?.(`[urge] ${ch.id} 取不到他上次说话时间，跳过`);
          results.push({ id: ch.id, name: ch.name, ok: false, gate: "lastUserAt", reason: "取不到他上次说话时间" });
          continue;
        }

        const st = await clock.state(ch.id);
        const urge = st.urge || {};
        const lastSpokeMin = urge.lastSpokeAt ? Math.round((Date.now() - urge.lastSpokeAt) / 60000) : null;
        const spokeToday = urge.date === now.date ? Number(urge.count) || 0 : 0;
        const s = await sealStore.read(ch.id);
        const lastUserMin = Math.round((Date.now() - lastUserAt) / 60000);

        // 兜底：上次已问过她（她没改心情），而沉默已经很久 → 机制替她落一档
        const askedAt = urge.askedAt ? Date.parse(urge.askedAt) : 0;
        const moodAtMs = Date.parse(s?.moodAt || "") || 0;
        let st2 = s;
        if (!dry && askedAt && moodAtMs < askedAt) {
          const fallback = silenceMood(lastUserMin);
          if (fallback) {
            await sealStore.write(ch.id, { mood: fallback.word, moodLevel: fallback.level }, "silence");
            st2 = await sealStore.read(ch.id);
            await sdk.logger?.info?.(`[urge] ${ch.id} 沉默 ${Math.round(lastUserMin / 60)} 小时，代写心情=${fallback.word}（${fallback.level}）`);
          }
        }
        // 他最近说过话 → 追问那串清零。
        // 用“他最后说话”和“她上次开口”比先后，比拿 60 分钟估准；而且算出来就落盘——
        // 以前只在放行成功时才写，跳过时不写，盘上那个数就永远挂着（2026-10-22 卡了一整天）。
        const heReplied = Number(lastUserAt) > Number(urge.lastSpokeAt || 0);
        const chase = heReplied ? 0 : Number(urge.chase) || 0;
        if (!dry && (Number(urge.chase) || 0) !== chase) {
          urge.chase = chase;
          st.urge = urge;
          await clock.save(ch.id, st);
        }
        const moodLevel = st2?.moodNow || st2?.moodLevel || "";

        const r = evaluateUrge({
          cfg: cfg.defaults?.wake || URGE_DEFAULTS,
          min: now.min,
          lastUserMin,
          lastSpokeMin,
          spokeToday,
          moodLevel,
          chaseCount: chase,
        });

        if (!r.ok) {
          await sdk.logger?.info?.(`[urge] skip ${ch.id}: ${r.reason}`);
          results.push({ id: ch.id, name: ch.name, ok: false, reason: r.reason, checks: r.checks });
          continue;
        }

        // 干跑：只算闸，不发消息、不改状态。零成本验管道用。
        if (dry) {
          results.push({
            id: ch.id,
            name: ch.name,
            ok: true,
            reason: r.reason,
            checks: r.checks,
            inputs: {
              lastUserMin,
              lastUserSource: source,
              lastUserAtLocal: new Date(lastUserAt + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " "),
              lastSpokeMin,
              spokeToday,
              mood: st2?.mood || "",
              moodLevel,
              chase,
              nowMin: now.min,
            },
            wouldSendTo: addr,
          });
          continue;
        }

        // 投到她的主会话：提示藏起来，她的话显出来。
        // 主会话是用户自己的，要 scope:"all" + app/sessions.manage 才写得进去。
        const target = String(ch.mainSession || "").trim();
        const settle = (pr) => {
          pr.catch(() => {});
          return Promise.race([
            pr.then(() => "sent").catch((e) => "error:" + (e?.message || e)),
            new Promise((res) => setTimeout(() => res("dispatched"), 2500)),
          ]);
        };
        const sendHidden = (addr) =>
          sdk.sessions.sendCustom({
            ...(addr.startsWith("sess_") ? { sessionId: addr } : { sessionPath: addr }),
            scope: "all",
            content: urgeNudge({ silenceMin: lastUserMin, chase, moodLevel }),
            customType: "juzishu.urge",
            display: false,
            triggerTurn: true,
          });

        let used = target;
        let outcome = null;

        if (target) {
          outcome = await settle(sendHidden(target));
          if (String(outcome).startsWith("error")) used = "";
        }

        // 主会话写不进去（没授权 / 归属不对 / 没配），退回自己的会话，至少别哑火。
        if (!used) {
          const fallback = await ensureSession(ch, "juzishu-urge");
          if (fallback) {
            used = fallback;
            outcome = await settle(sendHidden(fallback));
            await sdk.logger?.warn?.(`[urge] 退回自带会话（${outcome}）`);
          }
        }

        if (!used) {
          results.push({ id: ch.id, ok: false, reason: "建会话失败" });
          continue;
        }

        urge.lastSpokeAt = Date.now();
        urge.date = now.date;
        urge.count = spokeToday + 1;
        urge.chase = chase + 1;
        urge.askedAt = new Date().toISOString();
        st.urge = urge;
        await clock.save(ch.id, st);

        await sdk.logger?.info?.(`[urge] ${ch.id} ${outcome}（${r.reason}）-> ${used}`);
        results.push({ id: ch.id, ok: true, reason: r.reason, outcome, target: used });
      }
    } catch (e) {
      await sdk.logger?.warn?.(`[urge] ${e?.message}`);
      results.push({ ok: false, reason: String(e?.message || e) });
    }
    return results;
  }

  // 间隔可调：默认 90–180 分钟；调成 1 就是一分钟一跳（自己验的时候用）
  const urgeGap = () => {
    const w = cfg.defaults?.wake || {};
    const lo = Math.max(1, Number(w.afterMin) || 90);
    const hi = Math.max(lo, Number(w.afterMaxMin) || 180);
    return (lo + Math.floor(Math.random() * (hi - lo + 1))) * 60_000;
  };
  let nextUrgeAt = Date.now() + urgeGap();

  const urgeTimer = setInterval(() => {
    if (Date.now() < nextUrgeAt) return;
    nextUrgeAt = Date.now() + urgeGap();
    runUrge().catch(() => {});
  }, 60_000);

  // 注入：off / observe / takeover
  // takeover 前必须先停旧插件，否则同一轮会注两遍。
  const INJECT_MODE = "takeover";

  // ── 注入时要用到的几件杂事 ──
  const textOf = (content) =>
    typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c?.text || "").join("") : "";

  /** 会话头里记着 cwd，工程会话靠它判。 */
  async function readSessionCwd(sessionPath) {
    if (!sessionPath) return null;
    try {
      const fs = await import("node:fs");
      const fd = fs.openSync(sessionPath, "r");
      const buf = Buffer.alloc(4096);
      try { fs.readSync(fd, buf, 0, 4096, 0); } finally { fs.closeSync(fd); }
      const first = buf.toString("utf8").split(/\r?\n/)[0] || "";
      const head = JSON.parse(first.replace(/^\uFEFF/, ""));
      return head?.cwd || head?.workspace || null;
    } catch { return null; }
  }

  /** 会话文件里“上一次对话”的时间（ms）。
   *  跳过 20 秒内的行——注入时当前这条用户消息已经入库，它不算“上次”。 */
  async function readLastTurnTs(sessionPath) {
    if (!sessionPath) return null;
    try {
      const fs = await import("node:fs");
      const st = fs.statSync(sessionPath);
      if (!st.isFile() || st.size === 0) return null;
      const CHUNK = 64 * 1024;
      const start = Math.max(0, st.size - CHUNK);
      const len = st.size - start;
      const fd = fs.openSync(sessionPath, "r");
      const buf = Buffer.alloc(len);
      try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
      const lines = buf.toString("utf8").split(/\r?\n/);
      const now = Date.now();
      const SKIP_RECENT_MS = 20_000;
      for (let i = lines.length - 1; i >= 0; i--) {
        const ln = String(lines[i] || "").trim();
        if (!ln.startsWith("{")) continue;
        try {
          const o = JSON.parse(ln);
          const t = o?.timestamp || o?.message?.timestamp;
          const ms = typeof t === "number" ? t : Date.parse(String(t || ""));
          if (!Number.isFinite(ms)) continue;
          if (now - ms < SKIP_RECENT_MS) continue; // 当前这轮，不算“上次对话”
          return ms;
        } catch { /* 半行，跳过 */ }
      }
      return null;
    } catch { return null; }
  }

  const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  /** 星期几跟着她那边的日期走——时区不同的人可能跨零点，不能一律拿北京算。 */
  const weekdayOf = (ymd) => {
    const [y, m, d] = String(ymd || "").split("-").map(Number);
    if (!y || !m || !d) return "";
    return WEEK_CN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || "";
  };

  /** 先看今天的位置链；凌晨落不进去，就看昨天最后一段（人还在那儿）。 */
  async function placeAtDay(dir, date, min) {
    const today = buildDayChain(await readText(pathMod.join(dir, `${date}.md`)));
    const hit = pickPlaceStrict(today, min);
    if (hit) return hit;
    if (Number(min) > 5 * 60) return null;
    const prev = new Date(Date.parse(`${date}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
    const y = buildDayChain(await readText(pathMod.join(dir, `${prev}.md`)));
    return y && y.length ? y[y.length - 1] : null;
  }

  function isWorkSession(agentId, cwd) {
    const w = cfg.defaults?.work || {};
    const agents = Array.isArray(w.agents) ? w.agents : [];
    const dirs = Array.isArray(w.dirs) ? w.dirs : [];
    if (!agents.includes(agentId) || !cwd) return false;
    const s = String(cwd).toLowerCase().replace(/\//g, "\\");
    return dirs.some((d) => d && s.includes(String(d).toLowerCase().replace(/\//g, "\\")));
  }

  function recallCfg() {
    return { ...RECALL_DEFAULTS, ...(cfg.defaults?.recall || {}) };
  }

  async function onProviderRequest(inv) {
    try {
      const payload = inv?.payload;
      const arr = payload?.messages;
      if (!Array.isArray(arr) || !arr.length) return undefined;

      let idx = -1;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i]?.role === "user") { idx = i; break; }
      }
      if (idx < 0) return undefined;

      const msg = arr[idx];
      const text = textOf(msg?.content);

      // 已经注过就不重复
      if (text.includes(anchor())) return undefined;

      const sessionPath = String(inv?.session?.sessionPath || "");
      const sessionId = String(inv?.session?.sessionId || "");
      const m = sessionPath.match(/[\\/]agents[\\/]([^\\/]+)[\\/]/);
      const agentId = m ? m[1] : null;
      if (!agentId) return undefined;

      // 只注自己名册里的人。同一个宿主装了两个橘子树、或者别的 App 也想注入时，
      // 谁的人谁注——抢了就会把别人的状态和人格锢挡在门外。
      const roster = Array.isArray(cfg.characters) ? cfg.characters : [];
      if (roster.length && !roster.some((c) => c && c.id === agentId)) return undefined;

      // 上一句她自己说的 / 再上一句他说的（回望用）
      let prevAssistant = null;
      let prevUser = "";
      for (let i = idx - 1; i >= 0; i--) {
        if (arr[i]?.role === "assistant") { prevAssistant = textOf(arr[i].content); break; }
      }
      if (prevAssistant !== null) {
        for (let i = idx - 1; i >= 0; i--) {
          if (arr[i]?.role === "user" && !textOf(arr[i].content).includes(anchor())) {
            prevUser = textOf(arr[i].content); break;
          }
        }
      }

      const cwd = await readSessionCwd(sessionPath);
      const isWork = isWorkSession(agentId, cwd);

      const lastTs = await readLastTurnTs(sessionPath);
      const gapMin = lastTs ? Math.round((Date.now() - lastTs) / 60000) : null;

      // 只记真会话：三个私有房间（写信室/心跳室/补账室）是她干活的地方，
      // 一记就会把主会话的路径挤掉——而 today_talk 恰好又把这三个房间排除在外，
      // 结果是“主会话被忘了、写信室被排了”，两边都读不到（2026-10-21 坏的一次）。
      try {
        const cs = await clock.state(agentId);
        const privates = [cs.sessionPath, cs.urgeSessionPath, cs.patchSessionPath]
          .filter(Boolean)
          .map((p) => pathMod.basename(String(p)));
        if (!privates.includes(pathMod.basename(String(sessionPath)))) {
          sessionMemory.remember(agentId, sessionPath, sessionId);
        }
      } catch {
        sessionMemory.remember(agentId, sessionPath, sessionId);
      }

      const all = await drawerStore.list();
      const entries = all.filter((e) => !e.agentId || e.agentId === agentId);

      const { date, min } = nowFor(ODAY_TZ[agentId] || 0);
      const timeText = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
      const weekday = weekdayOf(date);

      const rc = recallCfg();
      const rcText = recallTextFor(agentId, rc);

      // 心情：封签里有就用封签的；空着就用信（当天档）标题里那一个
      // 工程会话：只留一句工程锚（如果配了），人格锚/时间/基线/回望全不注
      if (isWork) {
        const anchorText = String(cfg.defaults?.work?.anchors?.[agentId] || "").trim();
        if (!anchorText) return undefined;
        const block = { type: "text", text: "\n\n" + anchor() + "\n" + anchorText };
        if (Array.isArray(msg.content)) msg.content = [...msg.content, block];
        else if (typeof msg.content === "string") msg.content = [{ type: "text", text: msg.content }, block];
        else msg.content = [block];
        await sdk.logger?.info?.(`[inject] mode=${INJECT_MODE} agent=${agentId} work=1 parts=工程锚`);
        return { payload };
      }

      const st = await sealStore.read(agentId);
      // 心情保底：封签空着就用信（当天档）标题里那一个
      let moodWord = st.mood;
      if (!moodWord) {
        try { moodWord = (await readDayMood(agentId, date)) || ""; } catch { moodWord = ""; }
      }
      // 地点：四小时内的实况优先；没有就落回 ODAY 当天那行 [位置：…] 链
      let place = null;
      let placeState = null;
      if (st?.place?.name) {
        const ms = Date.parse(String(st.place.since || ""));
        const ageH = Number.isFinite(ms) ? (Date.now() - ms) / 36e5 : null;
        if (ageH === null || ageH <= 4) place = st.place.name;
      }
      if (!place) {
        const dir = ODAY_DIRS[agentId];
        if (dir) {
          const seg = await placeAtDay(dir, date, min);
          if (seg) { place = seg.place; placeState = seg.state; }
        }
      }
      let moodWhy = null;
      try { moodWhy = await readMoodWhy(agentId, date); } catch { /* 没心绪就不注 */ }

      const tBlock = timeBlock({
        date: `${date} ${weekday}`,
        timeText,
        sinceMin: gapMin !== null && gapMin >= 1 ? gapMin : null,
        place,
        placeState,
        moodWhy,
      });
      const sBlock = stateBlock(st, { hint: rcText.hint, mood: moodWord });

      const recall = recallFor(agentId, rc) && shouldRecall(prevAssistant, prevUser, rc)
        ? buildRecall(prevAssistant, rc, { tail: rcText.tail, withHint: true, hintRecall: rcText.hintRecall })
        : "";

      const p = buildPreview({
        entries,
        text,
        timeBlock: tBlock,
        stateBlock: sBlock,
        recall,
        maxChars: Number(cfg.defaults?.inject?.maxChars) || 4000,
      });
      if (!p.text) return undefined;

      await sdk.logger?.info?.(
        `[inject] mode=${INJECT_MODE} agent=${agentId} chars=${p.chars} parts=${p.parts.map((x) => x.name).join(",")}`
      );

      if (INJECT_MODE !== "takeover") return undefined;

      const block = { type: "text", text: "\n\n" + p.text };
      if (Array.isArray(msg.content)) msg.content = [...msg.content, block];
      else if (typeof msg.content === "string") msg.content = [{ type: "text", text: msg.content }, block];
      else msg.content = [block];

      return { payload };
    } catch (e) {
      await sdk.logger?.warn?.(`[inject] ${e?.message}`);
      return undefined;
    }
  }

  try {
    await sdk.hooks?.onDecision?.("provider/before-request", onProviderRequest);
  } catch (e) {
    await sdk.logger?.warn?.(`[inject] 钩子挂不上：${e?.message}`);
  }

  for (const a of AGENTS) {
    try { await sealStore.migrateLegacy(a); } catch { /* 迁不动不拦启动 */ }
  }

  const readText = async (p) => {
    try {
      const r = await sdk.resources.read({ kind: "local-file", path: p });
      const text = typeof r === "string" ? r : (r?.content ?? r?.text ?? "");
      return text ? String(text).replace(/^\uFEFF/, "") : null;
    } catch { return null; }
  };
  const readJson = async (p) => {
    const t = await readText(p);
    if (!t) return null;
    try { return JSON.parse(t); } catch { return null; }
  };
  const safeJsonArr = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
  // 当地日期 YYYY-MM-DD（按给定时区偏移，不是 UTC）
  // 当地日期 YYYY-MM-DD（按北京时区求，不用本地 getter——避免双重加时区）
  const beijingDate = (n = 0) => {
    const d = new Date(Date.now());
    d.setUTCDate(d.getUTCDate() - n);
    // 用北京时区格式化
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return parts; // en-CA 输出 YYYY-MM-DD
  };
  const localDate = (offsetH = 0) => beijingDate(0);
  // 基准日期（北京）往前 n 天，YYYY-MM-DD（真日期运算，跨月/跨年不会错）
  const dateBack = (n) => beijingDate(n);
  // 从 ODAY 当天档取「今日心绪」那行
  const readMoodWhy = async (agentId, date) => {
    const dir = ODAY_DIRS[agentId];
    if (!dir) return null;
    const t = await readText(pathMod.join(dir, `${date}.md`));
    if (!t) return null;
    const m = t.match(/^>\s*今日心绪[：:]\s*(.+)$/m);
    return m ? m[1].trim() : null;
  };

  // 从 ODAY 当天档取「天气」那段：取第二句（第一句是“周四”这种，没有天气）
  const readWeather = async (agentId, date) => {
    const dir = ODAY_DIRS[agentId];
    if (!dir) return null;
    const t = await readText(pathMod.join(dir, `${date}.md`));
    if (!t) return null;
    const m = t.match(/^##\s*天气\s*\n+([^\n#]+)/m);
    if (!m) return null;
    const parts = m[1].split(/[。！？]/).map((x) => x.trim()).filter((x) => x.length >= 4);
    return parts[0] || m[1].trim();
  };

  /** 信（ODAY 当天档）标题里的心情：`# 2026-10-19 · 平静 🌥` → 平静。
   *  封签里的心情空着时用它，信是心情的保底。 */
  const readDayMood = async (agentId, date) => {
    const dir = ODAY_DIRS[agentId];
    if (!dir) return null;
    const t = await readText(pathMod.join(dir, `${date}.md`));
    if (!t) return null;
    const m = t.match(/^#\s*\d{4}-\d{2}-\d{2}\s*[·.\u3001]\s*([^\s\u2600-\u27BF]+)/m);
    return m ? m[1].trim() : null;
  };

  // 工具：接管 agent 自写状态的入口。与旧插件同名，切换时必须先停旧插件。
  if (sdk.tools?.register) {
    sdk.tools.register({
      name: "state_write",
      description:
        HOW_TO_CALL_HEAD +
        "写自己的状态读数（心情/牵挂/身体/位置/钱）。她自己在动作里写真值；只传要改的格。\n" +
        HOW_TO_CALL,
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "目标 agent id（一般就是自己）" },
          mood: { type: "string", description: "底面：满足/开心/平静/烦躁/委屈/低落/落寞（七格之一）" },
          moodLevel: { type: "string", description: "深浅：轻（只带在脸色上）/中（已经在动作里）/重（压过眼下的事）" },
          moodUnder: { type: "string", description: "暗格（最多一条）：垫在最沉那格底下的另一个味道，七格之一；不用就不传，传空串清掉" },
          moodUnderLevel: { type: "string", description: "暗格的深浅：轻/中/重；不传默认轻" },
          bodyHunger: { type: "string", description: "饿：饱/有点饿/饿" },
          bodyEnergy: { type: "string", description: "精力：精神/有点乏/累" },
          careAdd: { type: "object", description: "起一个牵挂结 {with, about, weight(1-3)}；上限 3 条。心里真的挂着谁、什么事没落下来就起一格；weight 只是轻重，不是上屏的门槛" },
          careResolve: { type: "string", description: "解一个牵挂结（给关键词）" },
          place: { type: "string", description: "此刻在哪：填地点名" },
          placeClear: { type: "boolean", description: "清掉实况位置（回到信里的预排）" },
          specialAdd: { type: "object", description: "加特殊状态 {name, effect, until}" },
          specialClear: { type: "string", description: "解除特殊状态（给 name）" },
          money: { type: "string", description: "钱（余额）" },
        },
        required: ["agentId"],
      },
      async execute(input, exec) {
        const id = String(input?.agentId || "");
        const before = await sealStore.read(id);
        const r = await sealStore.write(id, input || {}, "tool");

        // （发布版不带收尾提醒：属于本机自用）

        return {
          content: [
            { type: "text", text: r.ok ? `已写入。（${r.status.tsLocal}）${r.notes.join("；")}` : `ERR: ${r.err}` },
          ],
          details: r.ok ? { status: r.status } : undefined,
        };
      },
    });

    sdk.tools.register({
      name: "state_read",
      description:
        HOW_TO_CALL_HEAD +
        "读自己的状态读数（心情/牵挂/身体/特殊状态/位置）。\n" +
        HOW_TO_CALL,
      parameters: {
        type: "object",
        properties: { agentId: { type: "string", description: "目标 agent id" } },
        required: ["agentId"],
      },
      async execute(input) {
        const s = await sealStore.read(input?.agentId);
        return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }], details: { status: s } };
      },
    });
    // 选项卡片已停用，代码已移除（2026-10-20 用户定）。

    // 写信前看这段说了什么：只捞时间窗内的人话，并把要审的那段原文一并递回去
    sdk.tools.register({
      name: "today_talk",
      description:
        HOW_TO_CALL_HEAD +
        "写档前看这一段跟用户说了什么：只捞时间窗内的人话（剥动作、剥工具、剥内心）。\n" +
        "**from 填档位起点**：早档 `18:00`（跨零点，含昨晚）、中档 `07:00`、晚档 `12:00`；上界自动是现在。\n" +
        "**section 填你要动的那一段**（早上/下午/晚上/天气/明天），会把那一段现在的原文一并递回来——那是拿来 **审** 的，不是拿来抄的。\n" +
        HOW_TO_CALL,
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "谁的今天" },
          from: { type: "string", description: "窗口起点 HH:MM（早档填 18:00、中档 07:00、晚档 12:00）" },
          to: { type: "string", description: "窗口终点 HH:MM。重写某一段历史内容时必须填（早上到 12:00、下午到 18:00、晚上到 24:00），否则会一路取到“现在”" },
          section: { type: "string", description: "要审的那一段：早上/下午/晚上/天气/明天" },
          date: { type: "string", description: "看哪天，YYYY-MM-DD；不传就是今天" },
          limit: { type: "number", description: "最多几条，默认 60" },
          chars: { type: "number", description: "字数上限，默认 6000（太小会把前面的挤掉）" },
        },
        required: ["agentId"],
      },
      async execute(input) {
        const id = String(input?.agentId || "");
        // 活室、写信室、心跳室都是她干活的地方，不算“今天跟用户说了什么”
        let exclude = [];
        try {
          const st = await clock.state(id);
          exclude = [st.sessionPath, st.urgeSessionPath, st.patchSessionPath].filter(Boolean);
        } catch { /* 没有就不过滤 */ }

        const d = await digest.today(id, {
          // 和档位钟点、信件文件名用同一个时区（北京）——三处不能各算各的，
          // 否则凌晨那段会出现“信记在 20 号、会话窗口在 21 号”。
          tzOffset: 0,
          limit: Number(input?.limit) || 60,
          chars: Number(input?.chars) || 6000,
          date: input?.date,
          exclude,
          from: String(input?.from || ""),
          to: String(input?.to || ""),
          // 面板上锁定的主会话文件（config.mainSessionPath）
          mainPath: String(((cfg.characters || []).find((x) => x.id === id) || {}).mainSessionPath || ""),
        });

        const span = d.spanMin >= 60
          ? `${Math.floor(d.spanMin / 60)} 小时${d.spanMin % 60 ? ` ${d.spanMin % 60} 分` : ""}`
          : `${d.spanMin} 分`;
        const head = d.messages === 0
          ? `【这段 ${d.fromText}–${d.toText}｜没说过话】`
          : `【这段 ${d.fromText}–${d.toText}｜${d.messages} 条｜跨 ${span}${d.longish ? `｜其中 ${d.longish} 条提到要一起做什么` : ""}】`;

        const parts = [head];
        if (d.messages === 0) {
          parts.push("这一段他没跟你说过话。按你原本的日子写就行，不用为了有内容硬编。");
        } else {
          parts.push(d.text);
        }

        // 把要审的那一段原文递回去
        const sec = String(input?.section || "").trim();
        const dir = ODAY_DIRS[id];
        if (sec && dir) {
          try {
            const day = await letterStore.readDay(dir, d.date);
            const seg = day ? sectionOf(day.text, sec) : null;
            if (seg) {
              parts.push(`\n【这一段现在写的是（审它，不是照着它的口吻写）】\n${seg}`);
            } else {
              parts.push(`\n【这一段现在还是空的】`);
            }
          } catch { /* 读不到就不带 */ }
        }

        parts.push(
          "\n【怎么处理】1-5 条、都是日常（吃了什么、路上、一句玩笑）→ 补进对应那一节，别动原有的；" +
          "6 条以上、或跨了一小时、或有一起出门／陪你去这类长时间的 → 先审再整段重写那节。"
        );

        return { content: [{ type: "text", text: parts.join("\n") }], details: d };
      },
    });

    // 写档：整段替换。她习惯“在后面接”，所以写档的口子不能是文件工具，只能是这个
    await sdk.logger?.info?.("[tools] 准备注册 letter_write");
    sdk.tools.register({
      name: "letter_write",
      description:
        HOW_TO_CALL_HEAD +
        "写档：把今天信里的某一段整段换成你新写的。**不是往后接，是整段替换**。\n" +
        "一天五段：天气／早上／下午／晚上／明天。一次写一段，写下一段就再调一次。\n" +
        "text 里只放这一段的话，**不要带 ## 段名**；[位置：…] 放正文第一行，正文里别写钟点。\n" +
        HOW_TO_CALL,
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "谁的档（一般就是自己）" },
          section: { type: "string", enum: ["天气", "早上", "下午", "晚上", "明天"], description: "写哪一段" },
          text: { type: "string", description: "这一段的全部正文（整段覆盖现有内容）" },
          date: { type: "string", description: "哪一天 YYYY-MM-DD；不传就是今天" },
          mood: { type: "string", description: "顺手改「今日心绪」那一行；不传就不动" },
          dayMood: { type: "string", description: "今天的主心情档（满足/开心/平静/烦躁/委屈/低落/落寞），写进标题；不传就不动" },
        },
        required: ["agentId", "section", "text"],
      },
      async execute(input) {
        const id = String(input?.agentId || "");
        const dir = ODAY_DIRS[id];
        if (!dir) return { content: [{ type: "text", text: `ERR: 没有 ${id} 的 ODAY 目录` }] };

        const date = String(input?.date || "").trim() || dateBack(0);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return { content: [{ type: "text", text: "ERR: date 要 YYYY-MM-DD" }] };
        }

        const audit = letterStore.auditSection(input?.text, input?.section);
        if (audit.errors.length) {
          return {
            content: [
              {
                type: "text",
                text: `没收。有这几处得改：\n${audit.errors.map((x) => `- ${x}`).join("\n")}\n改完把这一段整个重发一次。`,
              },
            ],
          };
        }

        try {
          const r = await letterStore.setSection(dir, date, input?.section, input?.text);
          if (input?.dayMood) await letterStore.setDayMood(dir, date, input.dayMood);
          if (input?.mood) await letterStore.setMoodWhy(dir, date, input.mood);
          const warn = audit.warnings.length ? `\n提醒：${audit.warnings.join("；")}` : "";
          return {
            content: [
              {
                type: "text",
                text: `写好「${r.section}」（${date}，${r.chars} 字，${r.replaced ? "整段换过" : "新补的"}）。${warn}`,
              },
            ],
            details: { ...r, warnings: audit.warnings },
          };
        } catch (e) {
          return { content: [{ type: "text", text: `ERR: ${e?.message || e}` }] };
        }
      },
    });

    await sdk.logger?.info?.("[tools] letter_write 已注册（到这一步没报错就说明注册函数走完了）");

    // 补写/改写抽屉里某一条：一个口子三件事，省得工具多了又拿不到。
    sdk.tools.register({
      name: "drawer_patch",
      description:
        HOW_TO_CALL_HEAD +
        "往抽屉里某一条写东西。**三种用法**：\n" +
        "1. **只读**：只给 agentId 和 name，不传 text —— 它会把那条现在的正文递回来。\n" +
        "2. **插一段**：给 text，再给 `after`（填正文里现成的一行，比如最后一条的日期或名字）——新内容就插在那行后面。\n" +
        "   **别总往末尾接**：清单类条目（礼物、做过的）按日期顺序插到该在的位置。不传 after 才追加到末尾。\n" +
        "3. **整段换**：给 text 同时传 `full: true` —— 用 text 把整段正文换掉（改人称、改正写歪的句子用这个）。\n" +
        HOW_TO_CALL,
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "哪个人身上的条目" },
          name: { type: "string", description: "条目名（总览名，如 礼物 / 约定 / 常去的地方）" },
          text: { type: "string", description: "要写进去的内容；不传就是只读" },
          after: { type: "string", description: "插在这行后面（给正文里现成的一小段就行）；不传就追加到末尾" },
          full: { type: "boolean", description: "true = 用 text 把整段正文换掉" },
        },
        required: ["agentId", "name"],
      },
      async execute(input) {
        const all = await drawerStore.list();
        const hit = all.find((e) => e.name === String(input?.name || "") && String(e.agentId || "") === String(input?.agentId || ""));
        if (!hit) return { content: [{ type: "text", text: `没有「${input?.name}」这条（${input?.agentId}）` }] };

        const text = input?.text;
        if (text === undefined || String(text).trim() === "") {
          return {
            content: [
              {
                type: "text",
                text: `【「${hit.name}」现在是这样（${String(hit.body || "").length} 字）】\n${hit.body || "（空）"}\n\n要改就带上 text 再调一次；只想插一段，加个 after 指位置。`,
              },
            ],
            details: { id: hit.id, name: hit.name },
          };
        }

        try {
          if (input?.full) {
            const r = await drawerStore.setBody(hit.id, text);
            return {
              content: [{ type: "text", text: r.ok ? `「${hit.name}」整段换过了（${r.before} → ${r.after} 字）。` : `ERR: ${r.err}` }],
              details: r,
            };
          }
          const r = await drawerStore.insertAfter(hit.id, text, input?.after);
          const msg = r.mode === "after"
            ? `插在「${r.anchor}」后面了。`
            : r.mode === "append-fallback"
              ? `没找到「${input?.after}」，接在末尾了。`
              : `接在「${hit.name}」末尾了。`;
          return { content: [{ type: "text", text: msg }], details: r };
        } catch (e) {
          return { content: [{ type: "text", text: `ERR: ${e?.message || e}` }] };
        }
      },
    });

    // 改一条的正文：改人称、改正写歪的句子。只改 body，不动触发词和父子关系。
    sdk.tools.register({
      name: "drawer_rewrite",
      description:
        HOW_TO_CALL_HEAD +
        "改写抽屉里某一条的正文——把写歪的句子改正、把第三人称改成第一人称。\n" +
        "**只改这一条的正文**：不动触发词、不动优先级、不动父子关系。\n" +
        "**不传 body 就是只读**：先拿到现在的正文，改完再把整段新正文传进来（不是只传改的那一句）。\n" +
        "第一人称的尺度：自己的事写「我」，对方写「他」或「她」；不写自己的名字。\n" +
        HOW_TO_CALL,
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "哪个人身上的条目" },
          name: { type: "string", description: "条目名（要改的那一条）" },
          body: { type: "string", description: "整段新正文。**不传就只读出现在的正文**，方便先看再改" },
        },
        required: ["agentId", "name"],
      },
      async execute(input) {
        const all = await drawerStore.list();
        const hit = all.find(
          (e) => e.name === String(input?.name || "") && String(e.agentId || "") === String(input?.agentId || "")
        );
        if (!hit) return { content: [{ type: "text", text: `没有「${input?.name}」这条（${input?.agentId}）` }] };

        // 不传 body：只读，把现在的正文递回去
        const next = input?.body;
        if (next === undefined || String(next).trim() === "") {
          return {
            content: [
              {
                type: "text",
                text: `【「${hit.name}」现在是这样（${String(hit.body || "").length} 字）】\n${hit.body || "（空）"}\n\n改好之后把**整段新正文**放进 body 再调一次。`,
              },
            ],
            details: { id: hit.id, name: hit.name },
          };
        }

        try {
          const r = await drawerStore.setBody(hit.id, next);
          return {
            content: [
              { type: "text", text: r.ok ? `「${hit.name}」改好了（${r.before} → ${r.after} 字）。` : `ERR: ${r.err}` },
            ],
            details: r,
          };
        } catch (e) {
          return { content: [{ type: "text", text: `ERR: ${e?.message || e}` }] };
        }
      },
    });

    // 给另一个 agent 发消息：直接送到对方主会话。
    // 内置的 session send 遇到跨 agent 会生成草稿卡等人确认——她不知道这事，
    // 以为发了，实际挂在一边。这里走 App 自己的投递通道，一次调完。
    sdk.tools.register({
      name: "talk_to",
      description:
        HOW_TO_CALL_HEAD +
        "给另一个 agent 发一条话（直接送到对方那里，不用等人点确认）。\n" +
        "只说内容，不要把“请转达”这种话也写进去——它就是一条当面说的话。\n" +
        "`to` 填对方在配置里的 id（拿不准就读 `/config` 里的 characters[].id，别猜）。\n" +
        HOW_TO_CALL,
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "发信人（自己）" },
          to: { type: "string", description: "收信人：配置里的角色 id" },
          text: { type: "string", description: "要说的那句话" },
        },
        required: ["agentId", "to", "text"],
      },
      async execute(input) {
        const from = String(input?.agentId || "");
        const to = String(input?.to || "").trim();
        const text = String(input?.text || "").trim();
        if (!text) return { content: [{ type: "text", text: "ERR: 没写内容" }] };
        if (to === from) return { content: [{ type: "text", text: "ERR: 别发给自己" }] };

        // 默认先落待转达，等人点过才送；真实模式开着就直投、不提醒。
        const needConfirm = cfg.defaults?.realMode !== true;
        if (needConfirm) {
          try {
            talkStore.add({ from, to, text });
            const n = talkStore.list("pending").length;
            return {
              content: [{ type: "text", text: `先在待转达里排着了（共 ${n} 条）。用户点过才会送到${NAMES[to] || to}那里。` }],
              details: { queued: true, pending: n },
            };
          } catch (e) {
            return { content: [{ type: "text", text: `ERR: ${e?.message || e}` }] };
          }
        }
        const ch = (cfg.characters || []).find((c) => c.id === to);
        const addr = String(ch?.mainSession || "").trim();
        if (!addr) return { content: [{ type: "text", text: `ERR: ${to} 没配主会话，发不过去` }] };

        try {
          const p = sdk.sessions.sendCustom({
            ...(addr.startsWith("sess_") ? { sessionId: addr } : { sessionPath: addr }),
            scope: "all",
            content: `（${NAMES[from] || from} 带话：${text}）`,
            display: false,
            customType: "juzishu.talk",
            triggerTurn: true,
          });
          const ack = await Promise.race([
            p.then(() => "sent").catch((e) => "error:" + (e?.message || e)),
            new Promise((r) => setTimeout(() => r("dispatched"), 2500)),
          ]);
          await sdk.logger?.info?.(`[talk_to] ${from} -> ${to}: ${ack}`);
          if (String(ack).startsWith("error")) {
            return { content: [{ type: "text", text: `没发出去：${ack}` }] };
          }
          return { content: [{ type: "text", text: `递给${NAMES[to] || to}了。` }] };
        } catch (e) {
          return { content: [{ type: "text", text: `ERR: ${e?.message || e}` }] };
        }
      },
    });

    // 想到值得进抽屉的设定：先提议，等用户点确认
    sdk.tools.register({
      name: "drawer_suggest",
      description:
        HOW_TO_CALL_HEAD +
        "提议一条该收进抽屉（世界书）的设定。不会直接写进去——落到代办区等用户确认。\n\n" +
        "**提之前先用 `today_talk` 把当天会话过一遍**——别凭印象想今天发生了什么。\n\n" +
        "**三条判据，中一条才能提**：\n" +
        "① 越界／确认：关系比上次更近了（认了件事、应下了什么）；\n" +
        "② 首现／定名：新场景、新地点、新东西、新名字第一次出现（那座桥、那本书、一把伞）；\n" +
        "③ 复用符号：以后会反复引的物件、暗号、约定。\n" +
        "特别：两个人第一次一起做的事，每次都值得留。\n\n" +
        "**不要提**：一次性的经过（谁几点做了啥）、过程与纠正、当天当时的小事。\n\n" +
        "写法：\n" +
        "- name 用名词（容器名或那场那物）；\n" +
        "- trigger 只写名词、宁窄勿宽（写“面馆”，不写“从心的说”）；\n" +
        "- **body 一律第一人称**：写「我」写「他」，不写自己的名字——\"他递过来一个纸袋，里头是那本书，我伸手接了\"，不是\"<角色名>收到了他的书\"；\n" +
        "- body 自足、直白、写实，不写“见细节X”、不写解释；\n" +
        "- why 一句话说清中了哪条判据。\n\n" +
        "完整规则在 App 目录下的 `rules\\世界书筛选与写入.md`，拿不准就读它。",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "给谁用" },
          name: { type: "string", description: "条目名（名词，短）" },
          trigger: { type: "array", items: { type: "string" }, description: "触发词，只写名词；空数组 = 常驻" },
          body: { type: "string", description: "正文：自足、直白、写实，不写解释、不写“见细节”" },
          why: { type: "string", description: "为什值得收：中了哪条判据（越界/首现/复用），一句" },
        },
        required: ["agentId", "name", "body", "why"],
      },
      async execute(input) {
        const r = suggestionStore.add({
          agentId: input?.agentId,
          name: input?.name,
          trigger: input?.trigger,
          body: input?.body,
          why: input?.why,
        });
        return {
          content: [
            {
              type: "text",
              text: r.duplicate ? "这条已经提过了，还在代办区等着。" : "已放进代办区，等用户点头。",
            },
          ],
          details: r,
        };
      },
    });
  }

  await sdk.routes.register((app0) => {
    // 真实模式：面板写入一律关掉（读不受影响）。开关和跨角色消息放行。
    const WRITE_ALLOW = new Set(["/real-mode", "/wake", "/talk/approve", "/talk/reject", "/talk/setting"]);
    const realOn = () => cfg.defaults?.realMode === true;
    const app = {
      get: (p, h) => app0.get(p, h),
      post: (p, h) => app0.post(p, async (c) => {
        if (realOn() && !WRITE_ALLOW.has(String(p))) {
          return c.json({ ok: false, err: "真实模式：只读。要改先把它关掉。" }, 403);
        }
        return h(c);
      }),
    };
    registerSealRoutes(app, {
      store: sealStore,
      agents: () => {
        const extra = characterStore.list().filter((x) => x.source === "user").map((x) => x.id);
        return [...new Set([...AGENTS, ...extra])];
      },
      names: NAMES,
      moodWhy: readMoodWhy,
      weather: readWeather,
      // 朝向写入：主一条 + 备用一条，存 config.characters[].moodOrientation
      saveOrientation: (id, value) => {
        const ch = cfg.characters.find((c) => c.id === id);
        if (!ch) return { ok: false, err: "没有这个角色" };
        if (value === null) delete ch.moodOrientation;
        else ch.moodOrientation = value;
        try {
          saveConfig({ dataDir, cfg });
        } catch (e) {
          return { ok: false, err: String(e?.message || e) };
        }
        return { ok: true };
      },
      // 朝向：主一条 + 备用一条，备用可选、最多两条；只是写法，不进数值
      orientationOf: (id) => {
        const raw = (cfg.characters.find((c) => c.id === id) || {}).moodOrientation;
        if (!raw || typeof raw !== "object") return null;
        const clean = (x) => (x && typeof x === "object" && String(x.line || "").trim()
          ? { line: String(x.line).trim(), how: String(x.how || "").trim() }
          : null);
        const main = clean(raw.main);
        const backup = clean(raw.backup);
        if (!main && !backup) return null;
        return {
          ...(main ? { main } : {}),
          ...(backup ? { backup: { ...backup, slot: String(raw.backup?.slot || "") } } : {}),
        };
      },
      metaOf: (id) => {
        const c = characterStore.list().find((x) => x.id === id);
        return c ? { name: c.name, source: c.source } : null;
      },
    });
    registerDrawerRoutes(app, {
      store: drawerStore,
      sdk,
      linksPath,
    });
    // 旧映射里的父子关系搬进库（跑一次；重复跑只会刷新 note）
    if (linksPath) {
      importLegacyLinks(linksPath)
        .then((n) => { if (n) sdk.logger?.info?.(`[drawer] 父子关系导入 ${n} 条`); })
        .catch(() => {});
    }
    registerLetterRoutes(app, { store: letterStore, dirs: ODAY_DIRS, agents: AGENTS, names: NAMES });
    registerClockRoutes(app, { clock, characters: CLOCK_CHARS });
    // 建/删/接入都写回配置：配置才是注入、时钟、信的派头。
    const onCharacterCreated = async (id) => {
      try {
        const d = characterStore.load(id);
        const prof = d.profile || {};
        const slots = (Array.isArray(prof.letters?.slots) ? prof.letters.slots : [])
          .map((s) => ({ id: String(s.id || ""), at: String(s.at || "") }))
          .filter((s) => s.id && /^\d{1,2}:\d{2}$/.test(s.at));
        const entry = {
          id,
          name: prof.name || id,
          timezone: prof.timezone || "Asia/Shanghai",
          ...(dataDir
            ? {
                lettersDir: pathMod.join(dataDir, "letters", id),
                promptsDir: pathMod.join(dataDir, "characters", id, "letters"),
              }
            : {}),
          slots: slots.length
            ? slots
            : [{ id: "morning", at: "07:00" }, { id: "noon", at: "12:00" }, { id: "evening", at: "18:00" }],
          mainSession: "",
        };
        const list = Array.isArray(cfg.characters) ? cfg.characters : [];
        const i = list.findIndex((x) => x && x.id === id);
        if (i >= 0) list[i] = { ...list[i], ...entry };
        else list.push(entry);
        cfg.characters = list;
        saveConfig({ dataDir, cfg });
        try {
          if (dataDir) await letterStore.ensureDay(pathMod.join(dataDir, "letters", id), letterStore.todayYMD(id), "");
        } catch { /* 铺不出来下次写信时会补 */ }
        try {
          const fsWB = await import("node:fs");
          const wbp = pathMod.join(dataDir, "characters", id, "worldbook.json");
          if (fsWB.existsSync(wbp)) {
            const wb = JSON.parse(fsWB.readFileSync(wbp, "utf8"));
            for (const e of (Array.isArray(wb?.entries) ? wb.entries : [])) {
              if (!e || !e.name) continue;
              await drawerStore.create({
                agentId: id,
                name: String(e.name),
                trigger: Array.isArray(e.trigger) ? e.trigger : [],
                body: String(e.body || ""),
                priority: Number(e.priority) || 50,
                match: String(e.match || "substring"),
                logic: String(e.logic || "any"),
              });
            }
          }
        } catch { /* 灌不进去不影响建卡 */ }

        // ── 接入之后给她一套能用的底子 ──
        // 刚接进来的人：抽屉是空的、state 里也没有这个人。
        // 于是注入里只剩时间和回望——没有“你是谁”，也没有规则。这里一次性补上。
        try {
          const fsMod = await import("node:fs");
          // 1) 状态空壳：给她一个能写的地方（七格留空，不替她编）
          if (dataDir) {
            const sp = pathMod.join(dataDir, "state", `${id}.json`);
            if (!fsMod.existsSync(sp)) {
              fsMod.mkdirSync(pathMod.dirname(sp), { recursive: true });
              fsMod.writeFileSync(
                sp,
                JSON.stringify(
                  {
                    mood: "", moodLevel: "", moodUnder: null, care: [],
                    body: { hunger: "", energy: "" }, special: [],
                    money: "", place: null,
                    updatedAt: new Date().toISOString(),
                  },
                  null, 2
                ),
                "utf8"
              );
            }
          }
          // 2) 抽屉里补一条人格锚（恒注入）。
          //    只放“你是谁”这一句，不搬人格正文——那是给人自己改的。
          const existing = (await drawerStore.list()) || [];
          const mine = existing.filter((x) => x && x.agentId === id);
          const hasAnchor = mine.some(
            (x) => x.name === "人格锚" || (Array.isArray(x.trigger) && x.trigger.length === 0 && x.enabled !== false)
          );
          const nm = String(d.profile?.name || id);
          const isTpl = (t) => {
            const s = String(t || "").trim();
            return !s || s.includes("{{userName}}") || /^#\s*角色名\s*$/m.test(s);
          };
          // identity 真实就用它；是模板/空的话，只给一句最普通的身份
          const body = isTpl(d.identity) ? [`# ${nm}`, "", `- 你是 ${nm}。`].join("\n") : String(d.identity).trim().slice(0, 2000);
          if (!hasAnchor) {
            await drawerStore.create({
              agentId: id,
              name: "人格锚",
              trigger: [],
              body,
              priority: 100,
              match: "substring",
              logic: "any",
            });
          } else {
            // 已经有了但内容是模板/空话，换成这一句
            const row = mine.find((x) => x.name === "人格锚");
            if (row && isTpl(row.body)) {
              try { await drawerStore.upsert(row.id, { body }); } catch { /* 改不了不拦 */ }
            }
          }
          // 状态提醒不进抽屉：它跟着 stateBlock 在末端注入里出（配置里的 hint）。
          // 抽屉只放人格锚——两种东西别混在一起。
          // 3) 回望绑定：名单空着就是全部（不用管）；名单写了人，就把她加进去
          const rc = cfg.defaults?.recall;
          if (rc && Array.isArray(rc.agents) && rc.agents.length && !rc.agents.includes(id)) {
            rc.agents.push(id);
            saveConfig({ dataDir, cfg });
          }
        } catch { /* 补不齐也不拦建卡 */ }
      } catch { /* 写不回配置不拦建卡 */ }
    };
    const onCharacterRemoved = async (id) => {
      try {
        cfg.characters = (Array.isArray(cfg.characters) ? cfg.characters : []).filter((x) => x && x.id !== id);
        saveConfig({ dataDir, cfg });
      } catch { /* 同上 */ }
    };

    registerAgentAdoptRoutes(app, { sdk, home: HANA, characterStore, onCreated: onCharacterCreated });
    registerCharacterRoutes(app, { store: characterStore, sdk, onCreated: onCharacterCreated, onRemoved: onCharacterRemoved });
    registerConfigRoutes(app, { sdk, appDir: __APP_DIR, dataDir });
    registerUrgeRoutes(app, {
      clock,
      seal: sealStore,
      cfg,
      agents: AGENTS,
      names: NAMES,
      fire: runUrge,
    });

    registerSessionRoutes(app, { sdk, agents: AGENTS, memory: sessionMemory });

    // 选项卡片：存、取、点了回传

    // 代办区：抽屉提议的列表与决定
    registerSuggestRoutes(app, {
      store: suggestionStore,
      drawer: drawerStore,
      agents: AGENTS,
      // 补写提醒：隐一条消息回**她自己的活室**（不是主会话）——主会话不露这种内部活
      notify: async (agentId, text) => {
        const ch = CLOCK_CHARS.find((x) => x.id === agentId);
        if (!ch) return false;
        const target = await ensureSession(ch, "juzishu-patch");
        if (!target) return false;
        sdk.sessions.sendCustom({
          sessionPath: target,
          content: text,
          customType: "juzishu.patch",
          display: false,
          triggerTurn: true,
        }).catch(() => {});
        return true;
      },
    });

    // 位置与地图：标点、底图、她现在在哪
    // 真实模式：开了以后状态只能她自己改（面板那条路关上），即时生效
    app.get("/real-mode", (c) => c.json({ ok: true, on: cfg.defaults?.realMode === true }));
    app.post("/real-mode", async (c) => {
      const body = await c.req.json().catch(() => ({}));
      cfg.defaults = { ...(cfg.defaults || {}), realMode: body?.on === true };
      try {
        saveConfig({ dataDir, cfg });
        await sdk.logger?.info?.(`[seal] 真实模式 ${cfg.defaults.realMode ? "开" : "关"}`);
      } catch (e) {
        return c.json({ ok: false, err: String(e?.message || e) }, 500);
      }
      return c.json({ ok: true, on: cfg.defaults.realMode });
    });

    // 心跳总开关：邮箱页一个勾，即改即生效
    app.get("/wake", (c) => c.json({ ok: true, on: cfg.defaults?.wake?.enabled === true }));
    app.post("/wake", async (c) => {
      const body = await c.req.json().catch(() => ({}));
      cfg.defaults = { ...(cfg.defaults || {}) };
      cfg.defaults.wake = { ...(cfg.defaults.wake || {}), enabled: body?.on === true };
      try {
        saveConfig({ dataDir, cfg });
        await sdk.logger?.info?.(`[wake] 心跳 ${cfg.defaults.wake.enabled ? "开" : "关"}`);
      } catch (e) {
        return c.json({ ok: false, err: String(e?.message || e) }, 500);
      }
      return c.json({ ok: true, on: cfg.defaults.wake.enabled === true });
    });

    // 跨角色消息：待转达队列 + 放行/丢弃
    registerTalkRoutes(app, {
      store: talkStore,
      deliver: deliverTalk,
      settings: {
        requireConfirm: () => cfg.defaults?.realMode !== true,
        set: (patch) => {
          cfg.defaults = { ...(cfg.defaults || {}) };
          if (patch && patch.requireConfirm === false) cfg.defaults.realMode = true;
          if (patch && patch.requireConfirm === true) cfg.defaults.realMode = false;
          saveConfig({ dataDir, cfg });
          return { requireConfirm: cfg.defaults.realMode !== true, realMode: cfg.defaults.realMode === true };
        },
      },
    });
    registerPlaceRoutes(app, {
      appDir: __APP_DIR,
      dataDir,
      characters: AGENTS,
      lettersDir: ODAY_DIRS,
      tzOf: (id) => ODAY_TZ[id] || 0,
      seal: sealStore,
      resolvePlace: (dir, date, min) => placeAtDay(dir, date, min),
      nowFor,
    });

    registerHealthRoutes(app, {
      drawer: drawerStore,
      letter: letterStore,
      clock,
      characters: characterStore,
      cfg,
      agents: AGENTS,
      lettersDir: ODAY_DIRS,
      clockChars: CLOCK_CHARS,
      injectMode: INJECT_MODE,
      startedAt,
    });
    registerInjectRoutes(app, {
      drawer: drawerStore,
      letter: letterStore,
      seal: sealStore,
      dirs: ODAY_DIRS,
      tz: ODAY_TZ,
      agents: AGENTS,
      names: NAMES,
    });
    registerPostmarkRoutes(app, {
      store: letterStore,
      dirs: ODAY_DIRS,
      tz: ODAY_TZ,
      agents: AGENTS,
      names: NAMES,
      stateOf: (a) => sealStore.read(a),
    });

    // 规则库、头像、健康检查：各自归位
    registerRuleRoutes(app, { sdk, readText, agents: AGENTS, home: HANA, pathMod });
    registerAvatarRoutes(app, { home: HANA, characterStore, sdk });
    // 地图与位置：api/place.js（下次不要在这里再挂一份）
    app.get("/ping", (c) => c.json({ ok: true, app: "juzishu", caps, at: Date.now() }));

  });

  return () => {
    clearInterval(timer);
    clearInterval(urgeTimer);
  };
});
