import { TranslationProvider, TranslationRequest } from './provider';

const WORD_MAP: Record<string, string> = {
  user: '用户',
  users: '用户',
  account: '账户',
  profile: '资料',
  list: '列表',
  item: '项',
  items: '项',
  data: '数据',
  info: '信息',
  detail: '详情',
  details: '详情',
  value: '值',
  values: '值',
  key: '键',
  name: '名称',
  id: '编号',
  type: '类型',
  count: '计数',
  counter: '计数器',
  total: '总数',
  sum: '总和',
  index: '索引',
  result: '结果',
  error: '错误',
  message: '消息',
  response: '响应',
  request: '请求',
  token: '令牌',
  status: '状态',
  code: '代码',
  config: '配置',
  setting: '设置',
  cache: '缓存',
  map: '映射',
  store: '存储',
  service: '服务',
  manager: '管理器',
  handler: '处理器',
  helper: '助手',
  parser: '解析器',
  format: '格式',
  formatter: '格式化器',
  reader: '读取器',
  writer: '写入器',
  converter: '转换器',
  provider: '提供器',
  client: '客户端',
  server: '服务端',
  method: '方法',
  func: '函数',
  function: '函数',
  get: '获取',
  set: '设置',
  create: '创建',
  update: '更新',
  delete: '删除',
  remove: '移除',
  save: '保存',
  load: '加载',
  fetch: '拉取',
  build: '构建',
  parse: '解析',
  validate: '校验',
  check: '检查',
  open: '打开',
  close: '关闭',
  start: '开始',
  stop: '停止',
  run: '运行',
  sync: '同步',
  async: '异步',
  visible: '可见',
  selected: '已选中',
  current: '当前',
  previous: '上一个',
  next: '下一个',
  first: '首个',
  last: '最后',
  enabled: '启用',
  disabled: '禁用',
  temp: '临时',
  path: '路径',
  file: '文件',
  folder: '目录',
  line: '行',
  column: '列',
  text: '文本',
};

function translateNormalizedTerm(term: string): string {
  const words = term.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return term;
  }

  const translatedWords = words.map((word) => WORD_MAP[word] ?? word);
  const changed = translatedWords.some((word, idx) => word !== words[idx]);
  return changed ? translatedWords.join('') : term;
}

export class DemoProvider implements TranslationProvider {
  public readonly name = 'demo';

  public async translateBatch(
    request: TranslationRequest,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const term of request.terms) {
      result.set(term, translateNormalizedTerm(term));
    }
    return result;
  }
}
