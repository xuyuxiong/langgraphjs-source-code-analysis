import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'LangGraphJS 源码深度解析',
  description: 'LangGraphJS 源码深度解析 - 从图执行引擎到 AI Agent 架构',
  base: '/langgraphjs-source-code-analysis/',
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#10B981' }],
  ],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
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
          text: '核心篇 - 引擎',
          items: [
            { text: 'Pregel 引擎', link: '/core/pregel-engine' },
            { text: 'StateGraph', link: '/core/state-graph' },
            { text: '图编译', link: '/core/graph-compile' },
          ],
        },
        {
          text: '核心篇 - 通道',
          items: [
            { text: 'Channel 通道', link: '/core/channel' },
            { text: '消息通道', link: '/core/message-channel' },
            { text: '二元通道', link: '/core/binary-channel' },
          ],
        },
        {
          text: '核心篇 - 执行与节点',
          items: [
            { text: 'ToolNode 工具节点', link: '/core/tool-node' },
            { text: 'END 结束节点', link: '/core/end-node' },
            { text: '中断机制', link: '/core/interrupt' },
            { text: '流式输出', link: '/core/stream' },
          ],
        },
        {
          text: '核心篇 - 系统与存储',
          items: [
            { text: '远程执行', link: '/core/remote-graph' },
            { text: 'Checkpoint 系统', link: '/core/checkpoint-system' },
            { text: 'Postgres 存储', link: '/core/postgres-checkpoint' },
            { text: 'Redis 存储', link: '/core/redis-checkpoint' },
            { text: 'SQLite 存储', link: '/core/sqlite-checkpoint' },
            { text: '错误处理', link: '/core/error-handling' },
          ],
        },
      ],
      '/advanced/': [
        {
          text: '进阶篇',
          items: [
            { text: '自定义 Agent', link: '/advanced/custom-agent' },
            { text: 'Swarm 多 Agent 协作', link: '/advanced/swarm' },
            { text: '时间旅行', link: '/advanced/time-travel' },
            { text: '性能优化', link: '/advanced/performance' },
            { text: '最佳实践与 FAQ', link: '/advanced/best-practices' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/langchain-ai/langgraphjs' },
    ],

    outline: {
      label: '本页目录',
      level: [2, 3],
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    // 搜索配置
    search: {
      provider: 'local',
      options: {
        detailedView: true,
        hotKeys: [
          { key: 'k', meta: true },
          { key: 's', meta: true, ctrlKey: true },
        ],
        locales: {
          root: {
            translations: {
              button: {
                buttonText: '搜索文档',
                buttonAriaLabel: '搜索文档',
              },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: {
                  selectText: '进入',
                  selectKeyAriaLabel: '回车键',
                  navigateText: '切换',
                  navigateUpKeyAriaLabel: '上箭头',
                  navigateDownKeyAriaLabel: '下箭头',
                  closeText: '关闭',
                  closeKeyAriaLabel: 'ESC 键',
                },
              },
            },
          },
        },
      },
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present',
    },
  },
  
  markdown: {
    theme: {
      light: 'vitesse-light',
      dark: 'vitesse-dark',
    },
  },
})