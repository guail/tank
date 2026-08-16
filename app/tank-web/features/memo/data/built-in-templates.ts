/**
 * 内置笔记模板（写死在前端）。
 *
 * 模板中心首次打开时，会把这里还不存在的内置模板通过 `save_memo_template`
 * 种进用户目录 `~/.flowix/template/*.md`，之后就是普通模板，用户可删可改。
 * 已删除的内置模板用 localStorage 记录，不会在下次打开时复活。
 *
 * 注意：`content` 是纯 Markdown 正文（不含 frontmatter），与后端
 * `extract_body_content` 的写入约定一致。
 */
export interface BuiltInTemplate {
  /** 稳定标识，用作 localStorage 去重 key；不是磁盘文件名（后端按 title 命名）。 */
  slug: string;
  /** 模板标题，同时作为磁盘文件名基底（save_memo_template 按此命名）。 */
  name: string;
  /** 卡片图标（emoji）。 */
  emoji: string;
  /** 卡片下方的一行简介。 */
  description: string;
  /** Markdown 正文。 */
  content: string;
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    slug: 'year-canvas-2026',
    name: '2026 年度画布',
    emoji: '🎨',
    description: '年度复盘与主题规划，一页看清今年的方向',
    content: `# 2026 年度画布

## 🎯 年度主题
> 用一句话定义今年的主旋律：

## 📊 年终复盘（2025）
- 最满意的 3 件事：
  - 
  - 
  - 
- 最遗憾的 2 件事：
  - 
  - 

## 🌟 今年的四个象限
### 健康
- [ ] 
### 成长
- [ ] 
### 关系
- [ ] 
### 财富
- [ ] 

## 🗓️ 季度节奏
- Q1：
- Q2：
- Q3：
- Q4：
`,
  },
  {
    slug: 'life-wishlist',
    name: '人生愿望清单',
    emoji: '🌈',
    description: '把想做的事分门别类，一条条去实现',
    content: `# 🌈 人生愿望清单

## 📚 学习
- [ ] 
- [ ] 

## ✈️ 旅行
- [ ] 
- [ ] 

## 💼 职业
- [ ] 
- [ ] 

## 💞 关系
- [ ] 
- [ ] 

## ➕ 补充
- [ ] 
`,
  },
  {
    slug: 'gtd-todo',
    name: 'GTD 待办清单',
    emoji: '✅',
    description: '收集 / 下一步 / 项目 / 等待 / 也许',
    content: `# ✅ GTD 待办清单

## 📥 Inbox（收集箱）
- [ ] 
- [ ] 

## ⚡ Next Actions（下一步）
- [ ] 
- [ ] 

## 🚀 Projects（项目）
- [ ] 
- [ ] 

## ⏳ Waiting For（等待中）
- [ ] 
- [ ] 

## 💡 Someday（也许）
- [ ] 
`,
  },
  {
    slug: 'project-50',
    name: 'Project 50',
    emoji: '🔥',
    description: '50 天自律挑战 · 每日打卡清单',
    content: `# 🔥 Project 50 · 50 天自律挑战

> 目标：连续 50 天，重塑习惯。

## 每日打卡
- [ ] 早起（__:__ 前）
- [ ] 运动 30 分钟
- [ ] 读书 / 学习 1 小时
- [ ] 健康饮食（戒糖 / 少外卖）
- [ ] 不熬夜（__:__ 前睡）
- [ ] 复盘当天

## 禁止清单
- [ ] 不烂醉
- [ ] 不无意义刷手机
- [ ] 不逾期任务

## 第 __ 天记录
**今日感悟：**
`,
  },
  {
    slug: 'study-log',
    name: '学习记录',
    emoji: '📖',
    description: '计划 / 总结 / 反思，沉淀每一次学习',
    content: `# 📖 学习记录

## 📝 学习计划
- 目标：
- 资料：
- 时间安排：

## 📒 学习总结
### 今日所学
- 
### 关键概念
- 

## 🪞 反思
- 哪里没懂：
- 下次改进：
`,
  },
  {
    slug: 'goal-list',
    name: '目标清单',
    emoji: '🎯',
    description: '健康 / 感情 / 金钱 / 工作 / 学习 / 爱好',
    content: `# 🎯 目标清单

## 💪 健康
- [ ] 
## 💞 感情
- [ ] 
## 💰 金钱
- [ ] 
## 💼 工作
- [ ] 
## 📚 学习
- [ ] 
## 🎨 爱好
- [ ] 
`,
  },
  {
    slug: 'three-layer-notes',
    name: '三层笔记法',
    emoji: '🧱',
    description: '构思 / 行动 / 封存，让笔记真正用起来',
    content: `# 🧱 三层笔记法

## 💡 第一层 · 构思（Idea）
> 捕捉灵感，不评判：

- 

## 🛠️ 第二层 · 行动（Action）
> 拆成可执行步骤：
- [ ] 
- [ ] 

## 📦 第三层 · 封存（Archive）
> 沉淀为可复用知识：
- 结论：
- 经验：
`,
  },
  {
    slug: 'quick-todo',
    name: '待办',
    emoji: '☑️',
    description: '一条待办速记：打开即可输入任务，自动进入待办视图',
    content: '- [ ] ',
  },
];

/** slug -> 模板，方便按内置模板反查正文做预览。 */
export const BUILT_IN_BY_NAME: Map<string, BuiltInTemplate> = new Map(
  BUILT_IN_TEMPLATES.map((t) => [t.name, t]),
);

/** slug -> 模板，用于「新增待办」等按 slug 直接定位内置模板。 */
export const BUILT_IN_BY_SLUG: Map<string, BuiltInTemplate> = new Map(
  BUILT_IN_TEMPLATES.map((t) => [t.slug, t]),
);

/** 内置「待办」速记模板的 slug，供「新增待办」按钮定位。 */
export const QUICK_TODO_SLUG = 'quick-todo';

/** 记录「已初始化过」的内置模板 slug，避免用户删除后被反复复活。 */
const SEED_KEY = 'tank.seededBuiltInTemplates';

export function getSeededSlugs(): Set<string> {
  try {
    const raw = localStorage.getItem(SEED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function markSeeded(slugs: string[]): void {
  try {
    const next = new Set([...getSeededSlugs(), ...slugs]);
    localStorage.setItem(SEED_KEY, JSON.stringify([...next]));
  } catch {
    /* localStorage 不可用时忽略，下次打开会重新尝试种入 */
  }
}
