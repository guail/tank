// 每个分类记住"最近一次保存用的优先级", 新建/编辑任务时按分类自动预填优先级。
// 纯前端实现: 数据存 localStorage, 与窗口/会话无关、无需后端。
//
// 语义: 一旦某分类的任务被存过优先级 (高/中/低), 该分类就记一个默认优先级;
// 之后同类任务打开或输入分类时, 若用户还没手动改过优先级, 自动预填该默认值。
// 留空 / "无" 不会覆盖已有默认 (避免一次没填就清掉默认)。

const STORAGE_KEY = 'tank.categoryPriorityDefaults';

type PriorityMap = Record<string, string>;

function readMap(): PriorityMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PriorityMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: PriorityMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 隐私模式 / 配额满等场景忽略写入失败
  }
}

/** 取某分类记住的默认优先级 (无则返回 '')。分类名不区分大小写。 */
export function getDefaultPriority(category: string): string {
  if (!category) return '';
  return readMap()[category.toLowerCase()] ?? '';
}

/** 记录某分类的默认优先级。category 为空或 priority 无效时忽略。 */
export function setDefaultPriority(category: string, priority: string): void {
  if (!category) return;
  const p = priority?.toLowerCase();
  if (p !== 'high' && p !== 'medium' && p !== 'low') return;
  const map = readMap();
  map[category.toLowerCase()] = p;
  writeMap(map);
}
