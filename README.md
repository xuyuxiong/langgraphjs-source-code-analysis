# LangGraphJS 源码深度解析

> 📚 深入理解 LangGraph 状态图、Pregel 引擎、多 Agent 协作等核心机制

[![LangGraph Version](https://img.shields.io/badge/langgraph-latest-green)](https://github.com/langchain-ai/langgraphjs)
[![VitePress](https://img.shields.io/badge/docs-vitepress-blue)](https://vitepress.dev/)

---

## 📖 在线阅读

**👉 [https://xuyuxiong.github.io/langgraphjs-source-code-analysis/](https://xuyuxiong.github.io/langgraphjs-source-code-analysis/)**

---

## 🎯 项目介绍

本项目是对 LangGraphJS 最新版本的源码深度解析文档，所有内容基于本地源码`/Users/xilin/Documents/sources/langgraphjs/`编写。

LangGraphJS 是 LangChain 团队开发的用于构建 AI Agent 应用的图/状态机框架。通过分析源码，你将深入理解：

- 🏗️ **Pregel 引擎** - Actor 模型、图执行循环、批处理
- 📊 **状态图** - StateGraph 构建器、节点与边定义
- 🔌 **通道机制** - Channel 类型、消息传递、状态管理
- 🔄 **Checkpoint 系统** - 状态持久化、时间旅行、断点恢复
- 🤖 **预构建 Agent** - createReactAgent、ToolNode 执行
- 🌐 **多 Agent 协作** - Swarm 模式、Agent 编排
- 📡 **远程执行** - RemoteGraph、云端调用

---

## 📁 项目结构

```
langgraphjs-source-code-analysis/
├── docs/                      # 文档目录
│   ├── .vitepress/           # VitePress 配置
│   │   └── config.ts         # 配置文件
│   ├── guide/                # 指南篇 (4 篇)
│   ├── architecture/         # 架构篇 (5 篇)
│   ├── core/                 # 核心篇 (15 篇)
│   ├── advanced/             # 进阶篇 (5 篇)
│   ├── public/               # 静态资源 (Logo 等)
│   └── index.md              # 首页
├── ACCURACY_REPORT.md        # 准确性验证报告 (100% 准确率)
├── package.json              # 项目配置
└── README.md                 # 项目说明
```

---

## 📚 文档目录

### 指南篇 (4 篇)
- [概览](docs/guide/overview.md) - LangGraphJS 是什么、核心特性
- [快速开始](docs/guide/quick-start.md) - 源码克隆、安装依赖、构建
- [源码结构](docs/guide/structure.md) - Monorepo 架构、包间依赖
- [调试指南](docs/guide/debugging.md) - VSCode 调试配置、断点技巧

### 架构篇 (5 篇)
- [整体架构](docs/architecture/overview.md) - 分层架构、图执行流程
- [Pregel 系统](docs/architecture/pregel.md) - Actor 模型、执行引擎
- [通道机制](docs/architecture/channel.md) - Channel 类型、状态管理
- [状态管理](docs/architecture/state.md) - 状态机、中断、恢复
- [Checkpoint 机制](docs/architecture/checkpoint.md) - 持久化、时间旅行

### 核心篇 (15 篇)
| 文档 | 核心内容 |
|------|----------|
| [Pregel 引擎](docs/core/pregel-engine.md) | Pregel 执行循环、批处理 |
| [StateGraph](docs/core/state-graph.md) | 状态图构建器、节点/边定义 |
| [Channel 类型](docs/core/channel-types.md) | BinaryOperator、LastValue、Topic |
| [图编译](docs/core/graph-compile.md) | compile() 方法、编译流程 |
| [React Agent](docs/core/react-agent.md) | createReactAgent() 实现 |
| [ToolNode](docs/core/tool-node.md) | 工具调用、错误处理 |
| [END 节点](docs/core/end-node.md) | 结束节点定义与使用 |
| [中断机制](docs/core/interrupt.md) | interrupt()、断点恢复 |
| [流式输出](docs/core/stream.md) | stream()、事件流处理 |
| [RemoteGraph](docs/core/remote-graph.md) | 远程调用、云端执行 |
| [Checkpoint 系统](docs/core/checkpoint-system.md) | 检查点保存与恢复 |
| [Postgres 存储](docs/core/postgres-checkpoint.md) | PgSaver 实现 |
| [Redis 存储](docs/core/redis-checkpoint.md) | RedisSaver 实现 |
| [SQLite 存储](docs/core/sqlite-checkpoint.md) | SqliteSaver 实现 |
| [错误处理](docs/core/error-handling.md) | 异常类型、错误传播 |

### 进阶篇 (5 篇)
- [自定义 Agent](docs/advanced/custom-agent.md) - 创建自定义 Agent 节点
- [Swarm 多 Agent](docs/advanced/swarm.md) - 多 Agent 协作模式
- [时间旅行](docs/advanced/time-travel.md) - 调试与状态恢复
- [性能优化](docs/advanced/performance.md) - 并发执行、缓存策略
- [最佳实践](docs/advanced/best-practices.md) - 最佳实践与 FAQ

---

## 🚀 本地开发

```bash
# 克隆项目
git clone https://github.com/xuyuxiong/langgraphjs-source-code-analysis.git
cd langgraphjs-source-code-analysis

# 安装依赖
pnpm install

# 开发模式（本地预览）
pnpm docs:dev

# 构建静态站点
pnpm docs:build

# 预览构建结果
pnpm docs:preview
```

---

## 📊 项目统计

| 指标 | 数量 |
|------|------|
| **文档总数** | 30 篇 |
| **指南篇** | 4 篇 |
| **架构篇** | 5 篇 |
| **核心篇** | 15 篇 |
| **进阶篇** | 5 篇 |
| **准确性验证** | 100% ✅ |
| **质量评级** | 优秀 (A+) |

---

## 📦 核心源码包

基于 `/Users/xilin/Documents/sources/langgraphjs/` 源码编写，覆盖以下核心包：

| 包名 | 内容 |
|------|------|
| @langchain/langgraph | StateGraph、Pregel、Channel、预构建 Agent |
| @langchain/langgraph-core | 通道类型、状态管理、中断机制 |
| @langchain/langgraph-checkpoint | Checkpoint 系统、持久化 |
| @langchain/langgraph-checkpoint-postgres | Postgres 存储 |
| @langchain/langgraph-checkpoint-redis | Redis 存储 |
| @langchain/langgraph-checkpoint-sqlite | SQLite 存储 |
| @langchain/langgraph-swarm | Swarm 多 Agent 协作 |
| @langchain/sdk | 远程调用 |

---

## 🔗 相关项目

### 源码解析系列

- [Vue 源码深度解析](https://github.com/xuyuxiong/vue-source-code-analysis) - 233 篇
- [LangChainJS 源码深度解析](https://github.com/xuyuxiong/langchainjs-source-code-analysis) - 175 篇
- [Ant Design X 源码深度解析](https://github.com/xuyuxiong/ant-design-x-source-code-analysis) - 169 篇
- [qiankun 源码深度解析](https://github.com/xuyuxiong/qiankun-source-code-analysis) - 164 篇
- [lowcode-engine 源码深度解析](https://github.com/xuyuxiong/lowcode-engine-source-code-analysis) - 164 篇
- [NestJS 源码深度解析](https://github.com/xuyuxiong/nest-source-code-analysis) - 166 篇
- [UmiJS 源码深度解析](https://github.com/xuyuxiong/umi-source-code-analysis) - 29 篇
- **LangGraphJS 源码深度解析** (本项目) - 30 篇

### 官方资源

- [LangGraph 官方文档](https://langchain-ai.github.io/langgraphjs/)
- [LangGraphJS GitHub](https://github.com/langchain-ai/langgraphjs)
- [LangChain 官方文档](https://js.langchain.com/)

---

## 📄 许可证

MIT License

---

<div align="center">

**🌟 如果本项目对你有帮助，欢迎 Star 支持！**

</div>