/** zh base dictionary for the common namespace: cross-feature standard words. */
export const zh = {
  'ok': '确定',
  'cancel': '取消',
  'close': '关闭',
  'copy': '复制',
  'copied': '复制成功',
  'retry': '重试',
  'loading': '加载中…',
  'load.failed': '加载失败',
  'submit': '提交',
  'submitting': '正在提交…',
  'next': '下一步',
  'previous': '上一步',
  'skip': '跳过',
  'delete': '删除',
  'edit': '编辑',
  'save': '保存',
  'search': '搜索',
  'more': '更多',
  'collapse': '收起',
  'expand': '展开',
  'back': '返回',
  'unknown': '未知',
  'none': '无',
  'truncated': '已截断',
} satisfies Record<string, string>

/** The common vocabulary key union (zh is the key-set source of truth). */
export type CommonKey = keyof typeof zh
