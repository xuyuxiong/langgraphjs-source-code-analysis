# LangGraphJS 源码深度解析

> 从图执行引擎到 AI Agent 架构

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Vue](https://img.shields.io/badge/Vue-3.4-blue)](https://vuejs.org/)
[![VitePress](https://img.shields.io/badge/VitePress-1.x-green)](https://vitepress.dev/)

LangGraphJS 是 LangChain 团队开发的用于构建 AI Agent 应用的图/状态机框架。本项目深入解析 LangGraphJS 的核心原理与实现细节。

## 📖 文档导航

- [首页](https://xuyuxiong.github.io/langgraphjs-source-code-analysis/)
- [指南篇](/docs/guide/overview.md) - 快速入门
- [架构篇](/docs/architecture/overview.md) - 整体架构
- [核心篇](/docs/core/pregel-engine.md) - 源码详解
- [进阶篇](/docs/advanced/custom-agent.md) - 高级用法

## 🚀 快速开始

### 安装依赖

```bash
pnpm install
```

### 本地开发

```bash
pnpm docs:dev
```

访问 http://localhost:5173 查看文档。

### 构建

```bash
pnpm docs:build
```

构建产物输出到 `docs/.vitepress/dist` 目录。

### 预览

```bash
pnpm docs:preview
```

## 📚 文档结构

```
docs/
├── .vitepress/              # VitePress 配置
│   └── config.ts           # 主配置文件
├── index.md                # 首页
├── guide/                  # 指南篇
│   ├── overview.md         # 概览
│   ├── quick-start.md      # 快速开始
│   ├── structure.md        # 源码结构
│   └── debugging.md        # 调试指南
├── architecture/           # 架构篇
│   ├── overview.md         # 整体架构
│   ├── pregel.md           # Pregel 系统
│   ├── channel.md          # 通道机制
│   ├── state.md            # 状态管理
│   └── checkpoint.md       # Checkpoint 机制
├── core/                   # 核心篇
│   ├── pregel-engine.md    # Pregel 引擎
│   └── ...                 # 更多核心模块文档
└── advanced/               # 进阶篇
    └── ...                 # 进阶内容
```

## 📊 覆盖模块

### 指南篇 (4 篇)
- ✅ 概览 - LangGraphJS 是什么、设计哲学
- ✅ 快速开始 - 源码克隆、安装依赖、构建
- ✅ 源码结构 - Monorepo 结构、包间依赖
- ✅ 调试指南 - VSCode 调试配置、断点技巧

### 架构篇 (5 篇)
- ✅ 整体架构 - 分层架构、图执行流程
- ✅ Pregel 系统 - Actor 模型、图执行引擎
- ✅ 通道机制 - Channel 类型、状态管理
- ✅ 状态管理 - 状态机、中断、恢复
- ✅ Checkpoint 机制 - 持久化、时间旅行

### 核心篇 (15+ 篇)
- ✅ Pregel 引擎 - pregel.ts、图执行、批处理
- 🔄 StateGraph - 状态图构建器
- 🔄 Channel 通道 - 通道类型、消息通道
- 🔄 图编译 - graph.compile()、编译流程
- 🔄 预构建 Agent - createReactAgent、ToolNode
- 🔄 ToolNode - 工具执行节点
- 🔄 END 节点 - 结束节点
- 🔄 中断机制 - interrupt()、断点恢复
- 🔄 流式输出 - stream()、事件流
- 🔄 远程执行 - RemoteGraph、远程调用
- 🔄 Checkpoint 系统 - 检查点保存与恢复
- 🔄 Postgres 存储 - PgSaver 实现
- 🔄 Redis 存储 - RedisSaver 实现
- 🔄 SQLite 存储 - SqliteSaver 实现
- 🔄 错误处理 - 异常类型、错误传播

### 进阶篇 (5 篇)
- 🔄 自定义 Agent - 创建自定义 Agent 节点
- 🔄 多 Agent 协作 - Swarm 模式
- 🔄 时间旅行 - 调试与恢复
- 🔄 性能优化 - 并发执行、缓存
- 🔄 最佳实践 - 开发经验总结

## 🛠️ 技术栈

- **VitePress 1.x** - 静态站点生成器
- **Vue 3.4** - 前端框架
- **TypeScript** - 类型安全
- **本地搜索** - 快捷文档搜索
- **GitHub Actions** - 自动部署

## 📦 源码参考

- **LangGraphJS 官方仓库**: https://github.com/langchain-ai/langgraphjs
- **源码路径**: `/Users/xilin/Documents/sources/langgraphjs/`

## 🔍 核心包结构

| 包名 | 功能描述 |
|------|----------|
| @langchain/langgraph | 主库：图、通道、Pregel、预构建 Agent |
| @langchain/langgraph-core | 核心包：通道、状态、错误、工具函数 |
| @langchain/langgraph-checkpoint | Checkpoint：状态持久化 |
| @langchain/langgraph-checkpoint-postgres | Postgres 存储实现 |
| @langchain/langgraph-checkpoint-redis | Redis 存储实现 |
| @langchain/langgraph-checkpoint-sqlite | SQLite 存储实现 |
| @langchain/langgraph-swarm | LangGraph Swarm 多 Agent 协作 |
| @langchain/sdk | SDK：客户端 |
| @langchain/langgraph-ui | LangGraph UI 界面 |

## 📝 写作规范

- 每篇文档至少 6000 字，核心篇至少 8000 字
- 所有文档内容必须对照源码，确保准确性
- 使用 TypeScript 代码示例
- 包含流程图和架构图
- 提供实际应用场景

## 🤝 贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 👤 作者

徐誉雄 (林傒) - 数字马力 - 国际事业部 - 资金平台体验技术

## 🔗 相关链接

- [LangChain 中文社区](https://link.notion.so/langchain-china)
- [LangChain 官方文档](https://python.langchain.com/)
- [LangGraphJS 官方文档](https://langchain-ai.github.io/langgraphjs/)