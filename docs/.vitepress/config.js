import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'LangGraphJS 源码深度解析',
  description: '从图执行引擎到 AI Agent 架构',

  // GitHub Pages 部署配置
  base: '/langgraphjs-source-code-analysis/',

  ignoreDeadLinks: true,

  head: [
    [
      'link',
      { rel: 'icon', href: '/langgraphjs-source-code-analysis/logo.svg' },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/langgraphjs-source-code-analysis/logo.svg',
      },
    ],
  ],

  themeConfig: {
    logo: '/langgraphjs-source-code-analysis/logo.svg',
    siteTitle: 'LangGraphJS 源码深度解析',

    nav: [
      { text: '指南', link: '/guide/overview' },
      { text: '架构', link: '/architecture/overview' },
      { text: '核心', link: '/core/tool-node' },
      { text: '进阶', link: '/advanced/custom-agent' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南篇',
          items: [
            { text: '概览', link: '/guide/overview' },
            { text: '快速开始', link: '/guide/quick-start' },
            { text: '源码结构', link: '/guide/structure' },
            { text: '调试指南', link: '/guide/debugging' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '架构篇',
          items: [
            { text: '整体架构', link: '/architecture/overview' },
            { text: 'Pregel 系统', link: '/architecture/pregel' },
            { text: '通道机制', link: '/architecture/channel' },
            { text: '状态管理', link: '/architecture/state' },
            { text: 'Checkpoint 机制', link: '/architecture/checkpoint' },
          ],
        },
      ],
      '/core/': [
        {
          text: '核心篇',
          items: [
            { text: '⭐ ToolNode', link: '/core/tool-node' },
            { text: '⭐ END 节点', link: '/core/end-node' },
            { text: '⭐ 中断机制', link: '/core/interrupt' },
            { text: '⭐ 流式输出', link: '/core/stream' },
            { text: '⭐ 远程执行', link: '/core/remote-graph' },
            { text: 'Pregel 引擎', link: '/core/pregel-engine' },
            { text: 'StateGraph', link: '/core/state-graph' },
            { text: '图编译', link: '/core/graph-compile' },
            { text: '通道类型', link: '/core/channel-types' },
            { text: 'Checkpoint 系统', link: '/core/checkpoint-system' },
            { text: 'Postgres 存储', link: '/core/postgres-checkpoint' },
            { text: 'Redis 存储', link: '/core/redis-checkpoint' },
            { text: 'SQLite 存储', link: '/core/sqlite-checkpoint' },
            { text: '错误处理', link: '/core/error-handling' },
            { text: 'React Agent', link: '/core/react-agent' },
          ],
        },
      ],
      '/advanced/': [
        {
          text: '进阶篇',
          items: [
            { text: '⭐ 自定义 Agent', link: '/advanced/custom-agent' },
            { text: '⭐ Swarm 协作', link: '/advanced/swarm' },
            { text: '⭐ 时间旅行', link: '/advanced/time-travel' },
            { text: '⭐ 性能优化', link: '/advanced/performance' },
            { text: '⭐ 最佳实践', link: '/advanced/best-practices' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/langchain-ai/langgraphjs' },
    ],

    footer: {
      message: '基于 MIT 许可证发布',
      copyright: 'Copyright © 2026 LangGraphJS 源码解析项目',
    },
  },
});
