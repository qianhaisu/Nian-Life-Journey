// 栏目可见性集中开关（代码常量，不读环境变量）。
// 下线期间保留全部页面源码、组件、数据库与文件存储，统一由此处控制导航入口、307 重定向与接口状态。
export const SECTIONS = {
  growth: false,
  people: false,
  health: false,
} as const;

export const hasMemoryReadingModeSwitch: boolean = SECTIONS.growth || SECTIONS.people;
