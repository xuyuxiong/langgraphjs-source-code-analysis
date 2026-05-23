---
layout: home
hero:
  name: LangGraphJS 源码深度解析
  text: 从图执行引擎到 AI Agent 架构
  tagline: 深入理解 LangGraphJS 的核心原理与实现细节
  image:
    src: /logo.svg
    alt: LangGraphJS Logo
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: 核心篇
      link: /core/tool-node
    - theme: alt
      text: 进阶篇
      link: /advanced/custom-agent

features:
  - icon: 🕸️
    title: 图执行引擎
    details: 深入解析 Pregel 引擎、Actor 模型、图执行流程，理解 LangGraphJS 的核心执行机制
  - icon: 🔄
    title: 状态管理
    details: 探索通道机制、状态机、中断与恢复，掌握 AI Agent 的状态流转原理
  - icon: 💾
    title: Checkpoint 系统
    details: 学习状态持久化机制，支持 Postgres、Redis、SQLite 多种存储后端
  - icon: 🤖
    title: Agent 架构
    details: 了解预构建 Agent、ToolNode、多 Agent 协作（Swarm）的实现方式
  - icon: 🌊
    title: 流式处理
    details: 深入理解流式输出、事件流、生命周期管理，构建实时响应应用
  - icon: 🎯
    title: 最佳实践
    details: 总结源码分析经验，提供实际开发中的最佳实践与常见问题解答
---

## 📖 什么是 LangGraphJS？

LangGraphJS 是一个用于构建 AI Agent 应用的图/状态机框架，基于 **Pregel** 模型实现。它提供了：

- **图结构的状态管理**：通过 StateGraph 定义状态流转
- **可中断的执行流**：支持断点续跑和时间旅行调试
- **多存储后端**：Checkpoint 支持 Postgres、Redis、SQLite 等
- **流式输出**：实时事件流和增量结果
- **预构建 Agent**：快速创建 ReAct 等模式的 AI Agent

## 📚 文档目录

### 指南篇
适合初次接触 LangGraphJS 的开发者，快速了解项目结构和开发环境搭建。

| 文档 | 描述 |
|------|------|
| [概览](/guide/overview) | LangGraphJS 是什么、设计哲学 |
| [快速开始](/guide/quick-start) | 源码克隆、安装依赖、构建 |
| [源码结构](/guide/structure) | Monorepo 结构、包间依赖关系 |
| [调试指南](/guide/debugging) | VSCode 调试配置、断点技巧 |

### 架构篇
从宏观角度理解 LangGraphJS 的整体架构设计。

| 文档 | 描述 |
|------|------|
| [整体架构](/architecture/overview) | 分层架构、图执行流程 |
| [Pregel 系统](/architecture/pregel) | Actor 模型、图执行引擎 |
| [通道机制](/architecture/channel) | Channel、通道类型、状态管理 |
| [状态管理](/architecture/state) | 状态机、中断、恢复 |
| [Checkpoint 机制](/architecture/checkpoint) | 持久化、时间旅行 |

### 核心篇
深入源码细节，逐模块解析 LangGraphJS 的核心实现。

#### 引擎模块
| 文档 | 描述 |
|------|------|
| [Pregel 引擎](/core/pregel-engine) | pregel.ts、图执行、批处理 |
| [StateGraph](/core/state-graph) | 状态图构建器 |
| [图编译](/core/graph-compile) | graph.compile()、编译流程 |

#### 通道模块
| 文档 | 描述 |
|------|------|
| [Channel 通道](/core/channel) | 通道类型、消息通道 |
| [消息通道](/core/message-channel) | 消息通道详解 |
| [二元通道](/core/binary-channel) | 二元操作通道 |

#### 执行与节点模块
| 文档 | 描述 |
|------|------|
| [⭐ ToolNode](/core/tool-node) | 工具执行节点详解 |
| [⭐ END 节点](/core/end-node) | 结束节点与流程终止 |
| [⭐ 中断机制](/core/interrupt) | interrupt() 函数与人工审核 |
| [⭐ 流式输出](/core/stream) | 流式输出与事件流 |

#### 系统与存储模块
| 文档 | 描述 |
|------|------|
| [⭐ 远程执行](/core/remote-graph) | RemoteGraph 与分布式部署 |
| [⭐ Checkpoint 系统](/core/checkpoint-system) | 检查点系统详解 |
| [⭐ Postgres 存储](/core/postgres-checkpoint) | Postgres 持久化实现 |
| [⭐ Redis 存储](/core/redis-checkpoint) | Redis 高性能缓存 |
| [⭐ SQLite 存储](/core/sqlite-checkpoint) | SQLite 本地存储 |
| [⭐ 错误处理](/core/error-handling) | 错误类型与恢复策略 |

### 进阶篇
探索高级用法和性能优化技巧。

| 文档 | 描述 |
|------|------|
| [⭐ 自定义 Agent](/advanced/custom-agent) | 构建自定义 Agent 架构 |
| [⭐ Swarm 协作](/advanced/swarm) | 多 Agent 协作模式 |
| [⭐ 时间旅行](/advanced/time-travel) | 调试与状态恢复 |
| [⭐ 性能优化](/advanced/performance) | 并发、缓存、内存优化 |
| [⭐ 最佳实践](/advanced/best-practices) | 开发经验与 FAQ |

## 🚀 快速开始

```bash
# 克隆源码
git clone https://github.com/langchain-ai/langgraphjs.git
cd langgraphjs

# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行测试
pnpm test
```

## 📊 核心包结构

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

## 🔍 源码特点

- **Monorepo 管理**：使用 pnpm + Turborepo 进行多包管理
- **TypeScript 编写**：完整的类型定义和类型安全
- **模块化设计**：各包职责清晰，依赖关系明确
- **测试覆盖**：完善的单元测试和集成测试
- **文档丰富**：详细的 API 文档和使用示例

## 📝 学习建议

1. **先了解基础概念**：图、状态机、Pregel 模型
2. **从指南篇开始**：熟悉项目结构和开发流程
3. **深入核心篇**：逐个模块理解源码实现
4. **实践进阶篇**：学习高级用法和优化技巧
5. **参考官方文档**：结合源码和官方文档学习

## 📖 文档更新记录

### 新增核心篇文档
- ✅ ToolNode 工具执行节点
- ✅ END 结束节点
- ✅ 中断机制详解
- ✅ 流式输出详解
- ✅ 远程执行 (RemoteGraph)
- ✅ Checkpoint 系统深度解析
- ✅ Postgres 存储实现
- ✅ Redis 存储实现
- ✅ SQLite 存储实现
- ✅ 错误处理最佳实践

### 新增进阶篇文档
- ✅ 自定义 Agent 架构设计
- ✅ Swarm 多 Agent 协作
- ✅ 时间旅行与调试
- ✅ 性能优化策略
- ✅ 最佳实践与 FAQ

---

<Banner />