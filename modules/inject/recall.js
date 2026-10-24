// 橘子树 · 回望 | 原创实现
//
// 下一轮把「上一句她自己说的」捞出来贴回去：剥掉 pulse、剥掉动作，
// 只留她真说的语言，让她自己照判据过一遍。不调模型、零延迟。
//
// 文案按角色分开配：谁说的话像不像谁，只有各人那一句才对得上。
// 默认给通用句，具体措辞从 config 的 defaults.recall 里读。

export const RECALL_DEFAULTS = {
  agents: [], // 白名单：留空 = 所有人都回望；填了 = 只给名单里的人
  minChars: 0, // 上一句短到这个数以下就不贴；0 = 只要不是空话都贴
  clip: 340, // 正文超过就夹头尾
  forceWords: [
    "怕", "不敢", "怂", "累", "没劲", "颓", "难过", "伤心",
    "挫败", "没用", "撑不住", "想哭", "哭",
  ],
  // 通用尾巴（判据），单角色可覆盖
  tail: "——这是你会说的话吗？不是，下一句记得改。",
  hint: "该改成什么就改成什么（`state_write`）——吃了就改成饱，累了就往下压；没变不动。",
  hintRecall: "（顺带：饿、累——跟现在的样子对得上吗？不对就改一格（`state_write`）。）",
  // 按角色分开写：谁说的话像不像谁，只有各人那一句才对得上
  tailByAgent: {},
  hintByAgent: {},
  hintRecallByAgent: {},
};

// <pulse> / <mood> 都是写给自己看的思考块，不是对外说的话：只剥块，不整条丢。
const PULSE_RE = /<(pulse|mood)>[\s\S]*?<\/\1>/gi;
export function stripPulse(s) {
  return String(s || "").replace(PULSE_RE, "").trim();
}

/** 取她真说的语言：剥思考、剥括号动作、剥方括号；过长夹头尾。 */
export function clipRecallText(prevAssistant, clip = RECALL_DEFAULTS.clip) {
  let s = stripPulse(prevAssistant) || String(prevAssistant || "");
  s = s
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!s) return "";
  if (s.length > clip) s = s.slice(0, Math.round(clip * 0.65)) + "……" + s.slice(-Math.round(clip * 0.35));
  return s;
}

/** 嗯、好、知道了这种没内容可审的，不贴，省位置。 */
export function isNoContent(body) {
  const s = String(body || "").trim();
  if (!s) return true;
  if (s.length <= 6 && !/[\u4e00-\u9fa5]{3,}/.test(s)) return true;
  const stripped = s.replace(/[嗯哦呃啊好的知道了行成收到喔唉哟嗨哈嘿嘛吧呢了？?！!，。、~～…—\s]/g, "");
  return stripped.length <= 2;
}

/** 上一句值不值得回看。 */
export function shouldRecall(prevAssistant, prevUser, cfg = RECALL_DEFAULTS) {
  if (!prevAssistant) return false;
  const body = stripPulse(prevAssistant);
  if (!body || isNoContent(body)) return false;
  const force = Array.isArray(cfg.forceWords) ? cfg.forceWords : RECALL_DEFAULTS.forceWords;
  if (force.some((w) => String(prevUser || "").includes(w))) return true;
  return body.length >= (Number(cfg.minChars) || 0);
}

/** 回望该不该轮到这个人。
 *  名单空着 = 谁都可以（刚接入的人不该被卡在外面）；
 *  名单写了人 = 只给名单里的，用来单点关掉某些 agent。 */
export function recallFor(agentId, cfg = RECALL_DEFAULTS) {
  const list = Array.isArray(cfg.agents) ? cfg.agents.filter(Boolean).map(String) : [];
  if (!list.length) return true;
  return list.includes(String(agentId || ""));
}

/** 取这个角色的三句文案（尾巴 / 状态提示 / 回望短提示）。 */
export function recallTextFor(agentId, cfg = RECALL_DEFAULTS) {
  const get = (map, fallback) => (map && map[agentId]) || cfg[fallback] || RECALL_DEFAULTS[fallback];
  return {
    tail: get(cfg.tailByAgent, "tail"),
    hint: get(cfg.hintByAgent, "hint"),
    hintRecall: get(cfg.hintRecallByAgent, "hintRecall"),
  };
}

/** 组装回望块：她上一句原文 + 判据（+ 状态短提示）。 */
export function buildRecall(prevAssistant, cfg = RECALL_DEFAULTS, opts = {}) {
  const s = clipRecallText(prevAssistant, Number(cfg.clip) || RECALL_DEFAULTS.clip);
  if (!s) return "";
  const tail = String(opts.tail || cfg.tail || RECALL_DEFAULTS.tail);
  const lines = ["（上一句你自己说的：）", `"${s}"`, tail];
  if (opts.withHint) lines.push(String(opts.hintRecall || cfg.hintRecall || RECALL_DEFAULTS.hintRecall));
  return lines.join("\n");
}
