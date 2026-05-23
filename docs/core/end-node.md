---
outline: deep
---

# END 结束节点

## 概述

`END` 是 LangGraphJS 中用于表示图执行结束的特殊常量。在状态机或图结构中，`END` 节点标志着执行流程的终止点。当图的执行到达`END` 节点时，当前执行路径终止，不再继续遍历后续的节点。

`END` 是 LangGraphJS 图执行模型中的三大基础元素之一，与 `START`（开始节点）和 `Send`（边消息）共同构成了图执行的基本语义。

## END 的概念与语义

### 什么是 END 节点

`END` 是一个特殊的 "节点"，它：

1. **不执行任何操作**：只是一个标记，表示执行流程的终点
2. **不返回任何值**：到达 END 时，当前执行路径结束
3. **不触发任何副作用**：纯粹的流程控制标记

### END 的使用场景

`END` 通常在以下几种场景中出现：

**1. 条件边的目标节点**

```typescript
workflow.addConditionalEdges("agent", routeDecision, {
  "continue": "tools",
  "end": END,  // 满足条件时结束执行
});
```

**2. 工具执行后的返回路径**

```typescript
workflow
  .addNode("tools", toolNode)
  .addEdge("tools", "agent")  // 工具执行后返回 agent
  // 或者
  .addConditionalEdges("tools", shouldContinue, {
    "continue": "agent",
    "finish": END,  // 某些工具执行后直接结束
  });
```

**3. 预期外的终止条件**

```typescript
function validateInput(state) {
  if (!state.input) {
    return END;  // 输入无效，直接结束
  }
  return "process";
}
```

## 源码分析

### END 常量的定义

在 LangGraphJS 源码中，`END` 的定义非常简单：

```typescript
// libs/langgraph-core/src/constants.ts
export const END = "__end__";
```

这是一个字符串常量，值为 `"__end__"`。选择这个特殊字符串是为了：

1. **避免命名冲突**：使用双下划线前缀，不太可能与用户定义的节点名冲突
2. **语义清晰**：在调试和日志中容易识别
3. **类型安全**：TypeScript 中可以定义专门的类型

### 相关常量定义

```typescript
// libs/langgraph-core/src/constants.ts

/**
 * The end of a graph execution.
 * Used to indicate that a path should terminate.
 */
export const END = "__end__";

/**
 * The start of a graph execution.
 * Used to indicate the entry point of a graph.
 */
export const START = "__start__";

/**
 * Special key for sending messages to specific nodes.
 */
export const SEND = "__send__";
```

### END 在编译后的图中的处理

在图编译过程中，`END` 被特殊处理：

```typescript
// libs/langgraph-core/src/pregel/index.ts

async function _execute(
  // ... 参数
): AsyncGenerator<Record<string, any> | string> {
  // 检查是否到达 END
  if (nextNode === END) {
    // 终止当前路径
    return;
  }
  
  // 正常的节点执行逻辑
  const node = this.nodes.get(nextNode);
  // ...
}
```

## END 在 StateGraph 中的使用

### 基础用法

```typescript
import { StateGraph, END, START } from "@langchain/langgraph";

const workflow = new StateGraph(StateAnnotation)
  .addNode("process", processNode)
  .addEdge(START, "process")  // 从 START 开始
  .addConditionalEdges(
    "process",
    shouldContinue,
    {
      "continue": "process",  // 继续处理
      "done": END,            // 完成，结束执行
    }
  )
  .compile();

function shouldContinue(state) {
  if (state.counter < 10) {
    return "continue";
  }
  return "done";
}
```

### 多个结束条件

一个图可以有多个通往 `END` 的路径：

```typescript
const workflow = new StateGraph(StateAnnotation)
  .addNode("validate", validateNode)
  .addNode("process", processNode)
  .addNode("error", errorNode)
  .addEdge(START, "validate")
  .addConditionalEdges("validate", validateRoute, {
    "valid": "process",
    "invalid": "error",
  })
  .addConditionalEdges("process", processRoute, {
    "success": END,      // 正常完成
    "retry": "validate", // 重试
  })
  .addEdge("error", END) // 错误处理结束
  .compile();

function validateRoute(state) {
  return state.isValid ? "valid" : "invalid";
}

function processRoute(state) {
  return state.success ? "success" : "retry";
}
```

## END 在 createReactAgent 中的应用

在 ReAct Agent 中，`END` 用于表示 Agent 对话的结束：

```typescript
import { END } from "@langchain/langgraph";

// createReactAgent 内部实现
workflow.addConditionalEdges(
  "agent",
  (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    
    // 如果没有工具调用，结束
    if (!isAIMessage(lastMessage) || !lastMessage.tool_calls?.length) {
      return END;  // Agent 不需要更多工具调用
    }
    
    // 有工具调用，继续执行
    return "tools";
  },
  {
    "tools": "tools",
    [END]: END,
  }
);
```

### ToolNode 版本中的 END 使用

根据 `version` 参数的不同，ToolNode 结束后的路由也不同：

**v1 版本**（默认）：

```typescript
.addConditionalEdges(
  "agent",
  (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    
    if (!lastMessage.tool_calls?.length) {
      if (responseFormat != null) {
        return "generate_structured_response";
      }
      return END;  // 没有工具调用，结束
    }
    
    return "tools";  // 有工具调用，执行工具
  },
  conditionalMap({
    tools: "tools",
    generate_structured_response: responseFormat != null ? "generate_structured_response" : null,
    [END]: responseFormat != null ? null : END,
  })
);
```

**v2 版本**：

```typescript
.addConditionalEdges(
  "agent",
  (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    
    if (!lastMessage.tool_calls?.length) {
      if (responseFormat != null) {
        return "generate_structured_response";
      }
      return END;
    }
    
    // v2 模式：每个工具调用单独发送
    return lastMessage.tool_calls.map(
      (toolCall) => new Send("tools", { ...state, lg_tool_call: toolCall })
    );
  },
  // ...
);
```

## END 的类型定义

在 TypeScript 中，`END` 有专门的类型定义：

```typescript
// libs/langgraph-core/src/types.ts

/**
 * 特殊的目标节点类型
 * - END: 表示执行结束
 * - string: 普通节点名称
 */
export type SingleTaskPath = END | string;

/**
 * 条件边的返回类型
 * 可以是字符串、END 或 Send 对象
 */
export type SingleTaskPathResult = SingleTaskPath | Send | (SingleTaskPath | Send)[];
```

### 类型安全使用

```typescript
import { END } from "@langchain/langgraph";

// ✅ 正确的使用
function routeSimple(state): typeof END | "next" {
  return state.done ? END : "next";
}

// ✅ 也可以这样
function routeSimple2(state): SingleTaskPath {
  return state.done ? END : "next";
}

// ❌ 类型错误
function routeWrong(state): string {
  return state.done ? END : "next";  // 编译错误
}
```

## 高级用法

### END 与 Send API 结合

`Send` API 允许动态地将消息发送到特定节点，包括 `END`：

```typescript
import { END, Send } from "@langchain/langgraph";

const workflow = new StateGraph(StateAnnotation)
  .addNode("process", processNode)
  .addNode("cleanup", cleanupNode)
  .addEdge(START, "process")
  .addConditionalEdges("process", dynamicRoute)
  .compile();

function dynamicRoute(state) {
  // 根据条件决定
  if (state.error) {
    return END;  // 错误时直接结束
  }
  
  if (state.needsCleanup) {
    return new Send("cleanup");  // 发送清理节点
  }
  
  return END;  // 正常结束
}
```

### 多条件路径中的 END

```typescript
const workflow = new StateGraph(StateAnnotation)
  .addNode("check", checkNode)
  .addNode("process", processNode)
  .addNode("notify", notifyNode)
  .addConditionalEdges("check", multiConditionRoute, {
    "invalid": END,         // 条件 1：无效输入，直接结束
    "urgent": "process",    // 条件 2：紧急，处理
    "notify": "notify",     // 条件 3：需要通知
    "complete": "notify",   // 条件 4：完成后通知
  })
  .addEdge("process", END)
  .addEdge("notify", END)
  .compile();

function multiConditionRoute(state) {
  if (!state.valid) return "invalid";
  if (state.urgent) return "urgent";
  if (state.complete) return "complete";
  return "notify";
}
```

### 动态 END 判断

在某些场景下，是否结束执行取决于运行时状态：

```typescript
const workflow = new StateGraph(StateAnnotation)
  .addNode("llm", llmNode)
  .addNode("evaluate", evaluateNode)
  .addConditionalEdges("evaluate", shouldEndEarly)
  .compile();

function shouldEndEarly(state) {
  // 检查是否达到最大迭代次数
  if (state.iterationCount >= state.maxIterations) {
    console.log("达到最大迭代次数，结束");
    return END;
  }
  
  // 检查是否达到满意的结果
  if (state.result && state.result.score > state.threshold) {
    console.log("结果满意，结束");
    return END;
  }
  
  // 检查是否发生不可恢复的错误
  if (state.criticalError) {
    console.log("发生错误，结束");
    return END;
  }
  
  // 继续迭代
  return "llm";
}
```

## 中断与 END 的关系

### interrupt() 与 END 的区别

虽然 `interrupt()` 和 `END` 都会暂停执行，但它们的语义不同：

| 区别点 | interrupt() | END |
|--------|-------------|-----|
| 目的 | 暂停执行，等待用户输入 | 正常结束执行流程 |
| 可恢复 | ✅ 可以通过 `resume` 恢复 | ❌ 执行完全结束 |
| 用法 | `const value = interrupt(data);` | `return END;` |
| Checkpoint | 保存状态以便恢复 | 不保存恢复点 |

### 结合使用示例

```typescript
function agentNode(state) {
  // 检查是否需要人工审核
  if (state.requiresHumanReview) {
    // 中断，等待人工确认
    const review = interrupt({
      type: "human_review",
      data: state.currentResult,
    });
    
    if (!review.approved) {
      return END;  // 拒绝，结束
    }
    
    // 继续执行
    return { messages: [/* ... */] };
  }
  
  // 正常结束条件
  if (state.done) {
    return END;
  }
  
  return { messages: [/* ... */] };
}
```

## 实践示例

### 示例 1：简单的问答流程

```typescript
import { StateGraph, END, START } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  answered: Annotation<boolean>({
    reducer: (_, update) => update ?? false,
    default: () => false,
  }),
});

// 问题生成节点
async function generateQuestion(state) {
  return {
    messages: [{ role: "assistant", content: "What is your question?" }]
  };
}

// 回答节点
async function answerQuestion(state) {
  // 简单的回答逻辑
  return {
    messages: [{ role: "assistant", content: "Thanks for your question!" }],
    answered: true,
  };
}

// 决定是否结束
function shouldEnd(state) {
  if (state.answered) {
    return END;  // 已回答，结束
  }
  return "answer";
}

const workflow = new StateGraph(StateAnnotation)
  .addNode("generate", generateQuestion)
  .addNode("answer", answerQuestion)
  .addEdge(START, "generate")
  .addConditionalEdges("generate", shouldEnd, {
    [END]: END,
    "answer": "answer",
  })
  .addEdge("answer", END)
  .compile();
```

### 示例 2：带有超时控制的搜索流程

```typescript
const SearchAnnotation = Annotation.Root({
  query: Annotation<string>(),
  results: Annotation<any[]>({
    reducer: (_, update) => update ?? [],
    default: () => [],
  }),
  attempts: Annotation<number>({
    reducer: (_, update) => update ?? 0,
    default: () => 0,
  }),
  maxAttempts: Annotation<number>({ default: () => 3 }),
});

// 搜索节点
async function searchNode(state) {
  const { query, attempts } = state;
  
  // 执行搜索（简化）
  const results = await performSearch(query, attempts);
  
  return {
    results: [...state.results, ...results],
    attempts: attempts + 1,
  };
}

// 路由决策
function searchRoute(state) {
  // 达到最大尝试次数
  if (state.attempts >= state.maxAttempts) {
    console.log("达到最大尝试次数，结束搜索");
    return END;
  }
  
  // 找到足够结果
  if (state.results.length >= 10) {
    console.log("找到足够结果，结束搜索");
    return END;
  }
  
  // 继续搜索
  return "search";
}

const searchWorkflow = new StateGraph(SearchAnnotation)
  .addNode("search", searchNode)
  .addEdge(START, "search")
  .addConditionalEdges("search", searchRoute, {
    [END]: END,
    "search": "search",
  })
  .compile();

const result = await searchWorkflow.invoke({
  query: "LangGraph documentation",
  maxAttempts: 5,
});
```

### 示例 3：多 Agent 协作中的 END

```typescript
const SupervisorAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  currentAgent: Annotation<string>({ default: () => "researcher" }),
  finalAnswer: Annotation<string>({ default: () => "" }),
});

// 监督者节点
async function supervisor(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  // 检查是否有最终答案
  if (state.finalAnswer) {
    return END;  // 已有答案，结束
  }
  
  // 根据任务分配给不同的 Agent
  if (lastMessage.content.includes("research")) {
    return new Send("researcher");
  } else if (lastMessage.content.includes("code")) {
    return new Send("coder");
  }
  
  // 收集答案
  if (lastMessage.content.includes("final answer")) {
    return { finalAnswer: lastMessage.content };
  }
  
  return new Send(state.currentAgent ?? "researcher");
}

const supervisorWorkflow = new StateGraph(SupervisorAnnotation)
  .addNode("supervisor", supervisor)
  .addNode("researcher", researcherNode)
  .addNode("coder", coderNode)
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", supervisor, {
    [END]: END,
    "researcher": "researcher",
    "coder": "coder",
  })
  .addEdge("researcher", "supervisor")
  .addEdge("coder", "supervisor")
  .compile();
```

## END 的设计哲学

### 显式终止 vs 隐式终止

LangGraphJS 采用显式终止设计：

**显式终止（LangGraphJS）**：
```typescript
.addConditionalEdges("node", route, {
  "done": END,      // 明确表示结束
  "continue": "next",
});
```

**隐式终止（其他框架可能）**：
```typescript
// 没有明确的 END，到达终点就结束
// 可能导致流程不清晰
```

### 为什么使用 END

1. **清晰性**：代码阅读者一眼就能看出执行流程在哪里结束
2. **一致性**：与 `START` 对应，都是特殊标记节点
3. **灵活性**：可以在多处使用 END，形成多个结束路径
4. **类型安全**：TypeScript 类型系统可以验证 END 的使用

## 调试技巧

### 可视化 END 路径

使用 LangGraph 的可视化工具查看 END 路径：

```typescript
const graph = workflow.compile();

// 获取图的可视化
const graphImage = await graph.getGraph().drawMermaid();
console.log(graphImage);
// 输出中可以看到指向 END 的边
```

### 日志记录 END 触发

```typescript
function addEndLogging(route) {
  return (state) => {
    const result = route(state);
    if (result === END) {
      console.log("🏁 Execution ending at:", JSON.stringify(state, null, 2));
    }
    return result;
  };
}

// 使用
.addConditionalEdges(
  "process",
  addEndLogging(shouldEnd)
)
```

## 常见问题 FAQ

### Q1: END 和 return null 有什么区别？

**A**: `END` 是显式的结束标记，而 `return null` 可能会被解释为返回空值，而不是结束。使用`END` 可以让意图更加明确。

### Q2: 可以有多个 END 节点吗？

**A**: `END` 是一个全局常量，但可以有多个指向 `END` 的路径。图中所有指向 `END` 的边都会导致执行结束。

### Q3: 如何调试提前结束的问题？

**A**: 在返回 `END` 的地方添加日志：

```typescript
function route(state) {
  if (shouldEnd(state)) {
    console.log("Ending execution:", { state, reason: "condition met" });
    return END;
  }
  return "continue";
}
```

### Q4: END 会影响 Checkpoint 吗？

**A**: `END` 本身不会创建 Checkpoint。但到达 `END` 之前的状态会被保存。如果需要在 `END` 前保存状态，应该在前一个节点中确保 Checkpointer 已配置。

### Q5: 如何在测试中验证 END 路径？

**A**: 运行图并检查结果：

```typescript
const result = await graph.invoke(initialState);

// 验证是否到达 END（没有进一步的输出）
expect(result).toBeDefined();
// 或者使用 stream 模式
for await (const chunk of graph.stream(initialState)) {
  // 验证最后一个 chunk
}
```

## 总结

`END` 节点是 LangGraphJS 图执行模型的基础组成部分：

- ✅ **清晰**：明确表示执行流程的终止
- ✅ **灵活**：可以在多个地方使用，形成多条结束路径
- ✅ **类型安全**：TypeScript 提供类型检查
- ✅ **一致**：与 `START` 形成对称的语义

理解 `END` 的正确使用对于构建清晰、可维护的图流程至关重要。始终使用显式的 `END` 来表示结束条件，可以让你的代码更加易读和易于调试。

## 参考资料

- [LangGraphJS 源码 - Constants](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/constants.ts)
- [LangGraphJS 源码 - Pregel 执行](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/index.ts)
- [LangGraph 状态图 API 文档](https://langchain-ai.github.io/langgraphjs/reference/class/StateGraph/)