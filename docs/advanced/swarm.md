# Swarm 多 Agent 协作

## 概述

Swarm 是多 Agent 协作的高级模式，多个专门的 Agent 协同工作完成复杂任务。每个 Agent 有自己的角色、能力和职责，通过协调机制共同完成任务。

LangGraph 提供了 `@langchain/langgraph-swarm` 包来简化多 Agent 协作的实现。

## Swarm 核心概念

### 组件

```
┌─────────────────────────────────────────────────────────────────┐
│                        Swarm 系统                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   Agent 1   │     │   Agent 2   │     │   Agent 3   │       │
│  │  Researcher │     │   Writer    │     │  Reviewer   │       │
│  │             │     │             │     │             │       │
│  │  - 研究能力  │     │  - 写作能力  │     │  - 审核能力  │       │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘       │
│         │                   │                   │              │
│         ├───────────────────┼───────────────────┤              │
│         │         Supervisor / Coordinator        │              │
│         │           协调者/监督者                  │              │
│         └───────────────────┼───────────────────┘              │
│                             ↓                                  │
│                      ┌─────────────┐                           │
│                      │   Output    │                           │
│                      └─────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### 协作模式

| 模式 | 描述 | 适用场景 |
|------|------|---------|
| **监督者** | 一个中心 Agent 协调其他 Agent | 项目管理、复杂任务分解 |
| **接力式** | 任务依次传递给下一个 Agent | 流水线处理 |
| **委员会式** | 多个 Agent 并行处理，投票决策 | 多视角分析、投票决策 |
| **自主协作** | Agent 间直接通信协作 | 复杂问题解决 |

## LangGraph Swarm 实现

### 基础架构

```typescript
import { createSwarm } from "@langchain/langgraph-swarm";
import { ChatOpenAI } from "@langchain/openai";

// 创建监督者 LLM
const supervisor = new ChatOpenAI({ model: "gpt-4o" });

// 创建专家 Agent
const researcher = new ChatOpenAI({ model: "gpt-4o" })
  .withSystemPrompt("你是研究专家。深入研究主题并提供详细事实。");

const writer = new ChatOpenAI({ model: "gpt-4o" })
  .withSystemPrompt("你是写作专家。基于研究结果撰写清晰内容。");

const reviewer = new ChatOpenAI({ model: "gpt-4o" })
  .withSystemPrompt("你是审核专家。评估内容质量并提供反馈。");

// 创建 Swarm 系统
const swarm = createSwarm({
  supervisor,
  agents: {
    researcher,
    writer,
    reviewer,
  },
  // 监督者决策逻辑
  supervisorPrompt: `决定下一步应该执行哪个任务。

可用任务：
- researcher: 研究主题，收集信息
- writer: 基于研究撰写内容
- reviewer: 审核内容质量

当前状态：{state}

请返回：
1. should_continue: boolean - 是否继续
2. next_agent: "researcher" | "writer" | "reviewer" | null - 下一个执行的 Agent
3. reason: string - 决策原因`,
});

// 编译 Swarm 图
const graph = swarm.compile();
```

## 自定义 Swarm 模式

### 模式 1：监督者模式

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

const SwarmState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  task: Annotation<string>(),
  researchResults: Annotation<string[]>({ default: () => [] }),
  draftContent: Annotation<string>({ default: () => "" }),
  feedback: Annotation<string>({ default: () => "" }),
  currentAgent: Annotation<string>({ default: () => "planner" }),
  iterations: Annotation<number>({ default: () => 0 }),
});

// 规划 Agent
async function planner(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const plan = await llm.invoke([
    { role: "system", content: "制定详细的任务计划，分解为研究、写作、审核阶段。" },
    { role: "user", content: state.task },
  ]);
  
  return {
    messages: [{ role: "assistant", content: plan.content }],
    currentAgent: "researcher",
  };
}

// 研究 Agent
async function researcher(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  // 提取研究的主题
  const topics = await extractResearchTopics(state.task);
  
  // 并行研究多个主题
  const results = await Promise.all(
    topics.map(topic => 
      llm.invoke([
        { role: "system", content: "深入研究这个主题，提供详细的事实和信息。" },
        { role: "user", content: topic },
      ])
    )
  );
  
  return {
    messages: [{ role: "assistant", content: results.map(r => r.content).join("\n") }],
    researchResults: results.map(r => r.content),
    currentAgent: "writer",
  };
}

// 写作 Agent
async function writer(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const draft = await llm.invoke([
    { role: "system", content: "基于研究结果撰写连贯、清晰的内容。" },
    { role: "user", content: `研究结果：\n${state.researchResults.join("\n")}` },
  ]);
  
  return {
    messages: [{ role: "assistant", content: draft.content }],
    draftContent: draft.content,
    currentAgent: "reviewer",
  };
}

// 审核 Agent
async function reviewer(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const feedback = await llm.invoke([
    { role: "system", content: "评估内容质量，指出需要改进的地方。如果足够好，返回'APPROVED'。" },
    { role: "user", content: state.draftContent },
  ]);
  
  const approved = feedback.content.includes("APPROVED");
  
  return {
    messages: [{ role: "assistant", content: feedback.content }],
    feedback: feedback.content,
    currentAgent: approved ? END : "writer",
    iterations: state.iterations + (approved ? 0 : 1),
  };
}

// 监督者决策
function supervisor(state) {
  // 判断是否应该结束
  if (state.currentAgent === END) {
    return END;
  }
  
  // 判断是否迭代过多
  if (state.iterations >= 3) {
    return END;
  }
  
  // 返回下一个 Agent
  return state.currentAgent;
}

// 构建 Swarm 图
const swarm = new StateGraph(SwarmState)
  .addNode("planner", planner)
  .addNode("researcher", researcher)
  .addNode("writer", writer)
  .addNode("reviewer", reviewer)
  .addEdge(START, "planner")
  .addConditionalEdges("planner", supervisor, {
    "researcher": "researcher",
    "writer": "writer",
    "reviewer": "reviewer",
    [END]: END,
  })
  .addConditionalEdges("researcher", supervisor)
  .addConditionalEdges("writer", supervisor)
  .addConditionalEdges("reviewer", supervisor)
  .compile();
```

### 模式 2：委员会投票

```typescript
const CommitteeState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  question: Annotation<string>(),
  opinions: Annotation<Record<string, string>>({ default: () => ({}) }),
  votes: Annotation<Record<string, boolean>>({ default: () => ({}) }),
  decision: Annotation<string>({ default: () => "" }),
});

// 不同视角的分析 Agent
async function logicalAgent(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const opinion = await llm.invoke([
    { role: "system", content: "从逻辑和理性角度分析问题。" },
    { role: "user", content: state.question },
  ]);
  
  return {
    messages: [{ role: "assistant", content: opinion.content }],
    opinions: { ...state.opinions, logical: opinion.content },
  };
}

async function creativeAgent(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const opinion = await llm.invoke([
    { role: "system", content: "从创新和非传统角度分析问题。" },
    { role: "user", content: state.question },
  ]);
  
  return {
    opinions: { ...state.opinions, creative: opinion.content },
  };
}

async function practicalAgent(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const opinion = await llm.invoke([
    { role: "system", content: "从实际可行性和成本效益角度分析问题。" },
    { role: "user", content: state.question },
  ]);
  
  return {
    opinions: { ...state.opinions, practical: opinion.content },
  };
}

// 投票汇总
function voteRouter(state) {
  // 检查是否所有 Agent 都完成了
  if (Object.keys(state.opinions).length >= 3) {
    return "voter";
  }
  return "continue";
}

// 投票 Agent
async function voter(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const decision = await llm.invoke([
    { role: "system", content: "综合所有观点，做出最终决策。" },
    { role: "user", content: `
逻辑观点：${state.opinions.logical}
创新观点：${state.opinions.creative}
实践观点：${state.opinions.practical}

请给出最终决策。
    `},
  ]);
  
  return {
    decision: decision.content,
  };
}

const committeeSwarm = new StateGraph(CommitteeState)
  .addNode("logical", logicalAgent)
  .addNode("creative", creativeAgent)
  .addNode("practical", practicalAgent)
  .addNode("voter", voter)
  .addEdge(START, "logical")
  .addEdge("logical", "creative")
  .addEdge("creative", "practical")
  .addConditionalEdges("practical", voteRouter, {
    "continue": "logical",
    "voter": "voter",
  })
  .addEdge("voter", END)
  .compile();
```

### 模式 3：并行+汇总

```typescript
import { Send } from "@langchain/langgraph";

const ParallelSwarmState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  task: Annotation<string>(),
  parallelResults: Annotation<Record<string, string>>({ default: () => ({}) }),
  finalResult: Annotation<string>({ default: () => "" }),
});

// 并行工作节点
async function worker(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  // 每个 worker 处理不同的子任务
  const result = await llm.invoke([
    { role: "system", content: `执行子任务：${state.subTask}` },
  ]);
  
  return {
    parallelResults: { [state.workerName]: result.content },
  };
}

// 并行分发
function parallelExpand(state) {
  const subTasks = ["research", "analysis", "synthesis"];
  
  return subTasks.map(task =>
    new Send("worker", { subTask: task, workerName: task })
  );
}

// 结果汇总
async function aggregator(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  // 等待所有并行结果
  const allResults = Object.entries(state.parallelResults);
  
  const final = await llm.invoke([
    { role: "system", content: "汇总所有结果，生成最终答案。" },
    { role: "user", content: allResults.map(([k, v]) => `${k}: ${v}`).join("\n") },
  ]);
  
  return { finalResult: final.content };
}

const parallelSwarm = new StateGraph(ParallelSwarmState)
  .addNode("expand", parallelExpand)
  .addNode("worker", worker)
  .addNode("aggregate", aggregator)
  .addEdge(START, "expand")
  .addEdge("worker", "aggregate")
  .addEdge("aggregate", END)
  .compile();
```

## 产品文档生成 Agent

```typescript
const DocGenState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  codeRepo: Annotation<string>(),
  features: Annotation<Feature[]>({ default: () => [] }),
  userGuide: Annotation<string>({ default: () => "" }),
  apiDoc: Annotation<string>({ default: () => "" }),
  examples: Annotation<string[]>({ default: () => [] }),
  status: Annotation<string>({ default: () => "analyze" }),
});

// 代码分析 Agent
async function codeAnalyzer(state) {
  // 分析代码库，提取功能特性
  const features = await analyzeCodeBase(state.codeRepo);
  return { features, status: "user_guide" };
}

// 用户指南编写 Agent
async function userGuideWriter(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const guide = await llm.invoke([
    { role: "system", content: "为用户编写清晰的指南文档。" },
    { role: "user", content: `功能列表：\n${state.features.map(f => f.name).join("\n")}` },
  ]);
  
  return { userGuide: guide.content, status: "api_doc" };
}

// API 文档编写 Agent
async function apiDocWriter(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const apiDoc = await llm.invoke([
    { role: "system", content: "编写详细的 API 参考文档。" },
    { role: "user", content: `基于代码库：${state.codeRepo}` },
  ]);
  
  return { apiDoc: apiDoc.content, status: "examples" };
}

// 示例生成 Agent
async function exampleGenerator(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const examples = await Promise.all(
    state.features.map(async feature => {
      const ex = await llm.invoke([
        { role: "system", content: "为这个功能编写使用示例。" },
        { role: "user", content: feature.description },
      ]);
      return ex.content;
    })
  );
  
  return { examples, status: "complete" };
}

function docGenRouter(state) {
  return state.status === "complete" ? END : state.status;
}

const docGenSwarm = new StateGraph(DocGenState)
  .addNode("analyze", codeAnalyzer)
  .addNode("user_guide", userGuideWriter)
  .addNode("api_doc", apiDocWriter)
  .addNode("examples", exampleGenerator)
  .addEdge(START, "analyze")
  .addConditionalEdges("analyze", docGenRouter)
  .addConditionalEdges("user_guide", docGenRouter)
  .addConditionalEdges("api_doc", docGenRouter)
  .addConditionalEdges("examples", docGenRouter)
  .compile();
```

## 最佳实践

### 1. 清晰的 Agent 职责

```typescript
// ✅ 每个 Agent 专注一件事
const specialistAgent = llm.withSystemPrompt(
  // ✅ 专业化职责
  "你是数据库查询专家。只处理 SQL 相关问题。"
);

// ❌ 职责不明确
const generalAgent = llm.withSystemPrompt(
  // ❌ 什么都做
  "你是 AI 助手。可以帮助用户做任何事情。"
);
```

### 2. 高效的通信机制

```typescript
// 使用共享状态进行通信
const SwarmState = Annotation.Root({
  // 只共享必要的信息
  context: Annotation<string>({ default: () => "" }),
  // 避免共享大量冗余数据
});

// 或者使用消息传递
function coordinator(state) {
  return new Send("worker", { task: state.pendingTask });
}
```

## 总结

Swarm 多 Agent 模式适用于：

- ✅ **复杂任务分解**：将大任务分解给专门 Agent
- ✅ **多视角分析**：不同 Agent 提供不同视角
- ✅ **并行化处理**：多个 Agent 并行执行
- ✅ **质量保证**：审核 Agent 确保结果质量

根据任务复杂度选择合适的协作模式。

## 参考资料

- [LangGraph Swarm 文档](https://langchain-ai.github.io/langgraphjs/concepts/multi_agent/)
- [Swarm 包源码](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph-swarm)