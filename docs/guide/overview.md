# LangGraphJS 概览

## 什么是 LangGraphJS？

LangGraphJS 是一个用于构建 AI Agent 应用的**图/状态机框架**，基于经典的 **Pregel** 模型实现。它由 LangChain 团队开发，是 LangChain 生态系统中的重要组成部分，专注于解决 AI Agent 应用中的状态管理、流程控制和执行编排问题。

### 设计哲学

LangGraphJS 的设计围绕三个核心概念展开：

#### 1. 图（Graph）

图是 LangGraphJS 的基本组织形式。在 LangGraphJS 中，应用程序被建模为有向图：

- **节点（Node）**：代表计算单元或状态转换步骤，如调用 LLM、执行工具、处理数据等
- **边（Edge）**：代表节点之间的控制流和数据流，定义了执行的顺序和条件
- **状态（State）**：在节点之间传递的数据结构，记录了应用的当前状态

这种图结构使得复杂的 AI 工作流变得清晰可视化，便于理解和调试。

```typescript
import { StateGraph, END } from "@langchain/langgraph";

// 定义一个简单的图
const workflow = new StateGraph<State>()
  .addNode("agent", agentNode)      // 添加节点
  .addNode("tools", toolNode)        // 添加工具节点
  .addEdge("__start__", "agent")     // 定义边：起始 -> agent
  .addEdge("agent", "tools")         // 定义边：agent -> tools
  .addEdge("tools", END);            // 定义边：tools -> 结束

const app = workflow.compile();
```

#### 2. 状态（State）

状态是 LangGraphJS 中数据流转的核心载体。每个图都有一个全局状态对象，在节点执行过程中不断更新：

- **强类型定义**：使用 TypeScript 类型或 Zod Schema 定义状态结构
- **可组合通道**：通过 Channel 组合不同类型的状态更新策略
- **不可变性**：每次更新生成新的状态副本，支持时间旅行调试

```typescript
interface AgentState {
  messages: BaseMessage[];  // 消息历史
  currentStep: string;       // 当前步骤
  retries: number;           // 重试次数
  result?: unknown;          // 最终结果
}

// 定义状态的通道（reducer 函数定义如何合并更新）
const stateSchema = {
  messages: {
    reducer: (x, y) => x.concat(y),  // 消息追加
    default: () => []
  },
  retries: {
    reducer: (x, y) => y,  // 直接替换
    default: () => 0
  }
};
```

#### 3. Agent（智能体）

Agent 是 LangGraphJS 的高层抽象，封装了常见的 AI 工作流模式：

- **ReAct Agent**：推理 - 行动循环，支持工具调用
- **Plan-and-Execute**：先规划再执行的多步任务
- **自定义 Agent**：基于 StateGraph 构建专属 Agent
- **Swarm**：多 Agent 协作模式

### Pregel 模型

LangGraphJS 的核心执行引擎基于 Google 的 **Pregel** 模型，这是一个大规模图处理框架。在 LangGraphJS 中，Pregel 被适配用于 AI Agent 的执行：

#### Pregel 超级步骤（Superstep）

```
┌─────────────┐
│   Step 1    │
│  ________   │
│ |        |  │
│ | Node A |──┼──► 输出到通道
│ |________|  │
│      │      │
│      ▼      │
│  ┌───────┐  │
│  │Node B │  │
│  └───────┘  │
└─────────────┘
       │
       ▼
┌─────────────┐
│   Step 2    │  读取通道值
│  ________   │  执行节点
│ |        |  │  写入通道
│ | Node C |  │
│ |________|  │
└─────────────┘
```

每个超级步骤包括：
1. **读取阶段**：节点从订阅的通道读取数据
2. **计算阶段**：节点执行计算逻辑
3. **写入阶段**：节点将输出写入指定通道
4. **同步屏障**：等待所有节点完成，进入下一步

#### Actor 模型集成

LangGraphJS 将 Pregel 与 Actor 模型结合：

- 每个节点像一个 Actor，独立处理消息
- 通道作为 Actor 之间的消息队列
- 支持异步并发执行，提升性能

### 为什么选择 LangGraphJS？

#### 1. 状态管理的挑战

在构建 AI Agent 应用时，开发者面临诸多状态管理挑战：

| 挑战 | 传统方案 | LangGraphJS 方案 |
|------|----------|------------------|
| 长会话状态 | 手动维护上下文 | 自动状态管理 + Checkpoint |
| 多步骤工作流 | 回调地狱 | 图结构清晰定义流程 |
| 中断与恢复 | 复杂的序列化逻辑 | 内置中断机制 |
| 并发控制 | 锁、竞态条件 | Pregel 同步屏障 |
| 可观察性 | 分散的日志 | 统一事件流 |

#### 2. 与传统工作流引擎的对比

```
传统工作流引擎（如 Airflow、Prefect）:
- 面向批处理任务
- DAG 静态定义
- 重调度轻状态
- 分钟级执行粒度

LangGraphJS:
- 面向 AI Agent 交互
- 图可动态修改
- 状态是第一公民
- 毫秒级响应
```

#### 3. 与 LangChain 的关系

```
┌─────────────────────────────────────────────────┐
│              LangChain 生态系统                  │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────┐    ┌─────────────────────────┐ │
│  │ LangChain   │───►│     LangGraphJS         │ │
│  │ (基础组件)  │    │   (图/状态机框架)        │ │
│  └─────────────┘    └─────────────────────────┘ │
│         │                        │              │
│         ▼                        ▼              │
│  ┌─────────────┐    ┌─────────────────────────┐ │
│  │  Chains     │    │       Agents            │ │
│  │ (线性流程)  │    │  (ReAct/PlanExecute 等)  │ │
│  └─────────────┘    └─────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
```

- **LangChain**：提供 LLM 调用、Prompt 模板、工具等基础组件
- **LangGraphJS**：在 LangChain 之上提供图/状态机框架，用于构建复杂 Agent

### 核心特性

#### 1. 持久化（Checkpoint）

LangGraphJS 的 Checkpoint 系统支持：

- **时间旅行**：回溯到任意历史状态
- **断点续跑**：从断点处继续执行
- **人类介入**：在关键节点等待人工确认
- **多存储后端**：Postgres、Redis、SQLite、MongoDB

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const checkpointer = PostgresSaver.fromConnString(
  "postgresql://user:pass@localhost:5432/db"
);

const app = workflow.compile({ checkpointer });

// 运行时可以获取/设置状态
const state = await app.getState({ configurable: { thread_id: "123" } });
```

#### 2. 流式输出

支持多种流式模式：

```typescript
// 值流：实时获取状态更新
for await (const chunk of app.stream(input)) {
  console.log(chunk);
}

// 事件流：获取详细生命周期事件
for await (const event of app.streamEvents(input, {
  version: "v2"
})) {
  console.log(event);
  // on_chain_start, on_chain_stream, on_chain_end, ...
}

// 消息流：专门处理消息增量
for await (const chunk of app.stream(input, {
  streamMode: "messages"
})) {
  console.log(chunk);
}
```

#### 3. 中断与恢复

```typescript
import { interrupt } from "@langchain/langgraph";

function humanApproval() {
  const decision = interrupt({ approve: false });
  // 此处会中断执行，等待外部 Resume
  if (decision.approve) {
    return { approved: true };
  }
  return { approved: false };
}

// 恢复执行
await app.invoke(new Command({ resume: { approve: true } }));
```

#### 4. 工具调用

内置 ToolNode 支持 LLM 工具调用：

```typescript
import { ToolNode, createReactAgent } from "@langchain/langgraph";

const tools = [searchTool, calculatorTool];
const agent = createReactAgent({
  llm,
  tools,
  // 自动配置 ToolNode 和工具执行逻辑
});
```

### 应用场景

LangGraphJS 适用于以下场景：

#### 1. 多轮对话 Agent

```
用户 ──► Agent ──► 理解意图
              │
              ├──► 查询知识库
              ├──► 调用 API
              └──► 生成回复
                    │
                    ▼
                 用户
```

#### 2. 复杂决策流程

```
开始
  │
  ▼
收集信息 ──► 评估条件
                │
        ┌───────┴───────┐
        ▼               ▼
    分支 A           分支 B
        │               │
        ▼               ▼
   执行动作 A      执行动作 B
        │               │
        └───────┬───────┘
                ▼
              结束
```

#### 3. 多 Agent 协作（Swarm）

```
┌──────────────┐
│  协调 Agent   │
└──────┬───────┘
       │
  ┌────┴────┬────────────┐
  ▼         ▼            ▼
Agent A  Agent B     Agent C
  │         │            │
  └────┬────┴────────────┘
       ▼
   结果聚合
```

#### 4. 研究辅助 Agent

```
研究问题
   │
   ▼
检索文献 ──► 总结摘要 ──► 对比分析
   │                           │
   │                           ▼
   │                      生成报告
   │                           │
   └───────────────────────────┘
```

### 生态系统组件

```
┌──────────────────────────────────────────────────────────┐
│                  LangGraphJS 生态系统                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  @langchain/langgraph (主库)                             │
│    ├── StateGraph ──► 状态图构建器                       │
│    ├── Pregel ──────► 图执行引擎                         │
│    └── Prebuilt ────► 预构建 Agent                        │
│                                                          │
│  @langchain/langgraph-checkpoint (持久化)                │
│    ├── MemorySaver ──► 内存存储（开发测试）               │
│    ├── PostgresSaver ──► 生产环境推荐                     │
│    ├── RedisSaver ─────► 高性能缓存场景                   │
│    └── SqliteSaver ────► 本地单机场景                     │
│                                                          │
│  @langchain/langgraph-sdk (客户端)                       │
│    ├── React SDK ──► 前端集成                            │
│    └── REST API ───► 远程调用                            │
│                                                          │
│  @langchain/langgraph-ui (界面)                          │
│    └── LangGraph Studio ──► 可视化调试工具                │
│                                                          │
│  @langchain/langgraph-swarm (多 Agent)                   │
│    └── Swarm ──► 多 Agent 协作框架                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 版本与兼容性

| 组件 | 最低 Node.js 版本 | 包管理器 |
|------|------------------|----------|
| LangGraphJS | 18+ | pnpm / yarn / npm |
| LangChain | 18+ | pnpm / yarn / npm |
| TypeScript | 4.9+ | - |

```json
{
  "engines": {
    "node": ">=18"
  },
  "packageManager": "pnpm@10.27.0"
}
```

### 学习路线

```
入门（1-2 周）
  │
  ├── 安装配置开发环境
  ├── 理解 StateGraph 基础
  ├── 编写第一个 Agent
  │
  ▼
进阶（2-4 周）
  │
  ├── 深入 Pregel 引擎原理
  ├── 学习 Channel 机制
  ├── 掌握 Checkpoint 系统
  │
  ▼
高级（4-8 周）
  │
  ├── 自定义 Agent 架构
  ├── 多 Agent 协作（Swarm）
  ├── 性能优化与调优
  │
  ▼
精通
  │
  ├── 阅读源码理解实现
  ├── 贡献开源项目
  └── 构建生产级应用
```

### 社区与资源

- **GitHub**: https://github.com/langchain-ai/langgraphjs
- **官方文档**: https://langchain-ai.github.io/langgraphjs/
- **LangChain 中文社区**: https://link.notion.so/langchain-china
- **Discord**: LangChain 官方 Discord 社区

## 小结

LangGraphJS 是一个强大的 AI Agent 框架，它将图论、状态机和 Actor 模型有机结合，为构建复杂的 AI 工作流提供了优雅的解决方案。通过本系列文档，你将深入理解 LangGraphJS 的内部实现，从源码层面掌握这一框架的核心原理。

接下来我们将进入 [快速开始](/guide/quick-start)，教你如何搭建开发环境并开始源码分析之旅。

## 下一章

- [快速开始](/guide/quick-start) - 源码克隆、安装依赖、构建、调试方法
- [源码结构](/guide/structure) - Monorepo 结构、包间依赖关系
- [调试指南](/guide/debugging) - VSCode 调试配置、断点技巧