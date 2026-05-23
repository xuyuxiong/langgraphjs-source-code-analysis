---
outline: deep
---

# 中断机制 interrupt()

## 概述

中断机制（Interrupt）是 LangGraphJS 中最强大的特性之一，它允许在图执行过程中**暂停执行**、**等待外部输入**或**进行人工审核**，然后从暂停点恢复执行。这一机制是实现**人机协作（Human-in-the-loop）**、**断点调试**和**条件等待**的核心。

`interrupt()` 函数是 LangGraphJS 提供的核心 API，用于在节点执行过程中主动中断当前流程。当中断被触发时，图的执行被暂停，状态被保存到 Checkpoint，等待通过 `Command` 或流式响应提供 `resume` 值来恢复执行。

## 为什么需要中断机制

### 传统执行模式的问题

在传统的图执行模型中，一旦执行开始就会一直运行到结束：

```
START → Node1 → Node2 → Node3 → END
```

这种模式无法处理以下场景：

1. **需要人工审核**：敏感操作需要人类确认
2. **需要外部输入**：等待用户提供额外信息
3. **调试需求**：在特定点暂停检查状态
4. **异步等待**：等待外部事件完成

### 中断机制的优势

中断机制通过引入暂停点解决了上述问题：

```
START → Node1 → [interrupt] ← pause → Node2 → Node3 → END
                                 ↓
                            等待 resume
```

## 中断的工作原理

### 中断的执行流程

当 `interrupt()` 被调用时，发生以下步骤：

```
┌─────────────────────────────────────────────────────────────┐
│ 1. interrupt() 被调用                                        │
│    - 检查是否已有 resume 值                                   │
│    - 如果没有，抛出 GraphInterrupt 异常                       │
│    - 如果有，返回 resume 值并继续执行                          │
├─────────────────────────────────────────────────────────────┤
│ 2. GraphInterrupt 被 Pregel 引擎捕获                           │
│    - 保存当前状态到 Checkpoint                               │
│    - 记录中断信息（interrupts 数组）                         │
│    - 停止当前节点的执行                                       │
├─────────────────────────────────────────────────────────────┤
│ 3. 图执行暂停，等待外部输入                                     │
│    - 用户可以通过 API 查看中断状态                             │
│    - 可以提供 resume 值                                      │
├─────────────────────────────────────────────────────────────┤
│ 4. 用户调用 graph.invoke(Command({ resume: value }))          │
│    - Checkpoint 加载之前的状态                               │
│    - resume 值被传递给 interrupt()                           │
│    - 从中断点继续执行                                         │
└─────────────────────────────────────────────────────────────┘
```

### 源码分析

#### interrupt() 函数定义

```typescript
// libs/langgraph-core/src/interrupt.ts

import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { GraphInterrupt, GraphValueError } from "./errors.js";
import {
  CONFIG_KEY_CHECKPOINT_NS,
  CONFIG_KEY_SCRATCHPAD,
  CONFIG_KEY_SEND,
  CONFIG_KEY_CHECKPOINTER,
  CHECKPOINT_NAMESPACE_SEPARATOR,
  RESUME,
} from "./constants.js";
import { PregelScratchpad } from "./pregel/types.js";
import { XXH3 } from "./hash.js";

/**
 * Interrupts the execution of a graph node.
 * This function can be used to pause execution of a node, and return the value of the `resume`
 * input when the graph is re-invoked using `Command`.
 * Multiple interrupts can be called within a single node, and each will be handled sequentially.
 *
 * When an interrupt is called:
 * 1. If there's a `resume` value available (from a previous `Command`), it returns that value.
 * 2. Otherwise, it throws a `GraphInterrupt` with the provided value
 * 3. The graph can be resumed by passing a `Command` with a `resume` value
 *
 * Because the `interrupt` function propagates by throwing a special `GraphInterrupt` error,
 * you should avoid using `try/catch` blocks around the `interrupt` function,
 * or if you do, ensure that the `GraphInterrupt` error is thrown again within your `catch` block.
 *
 * @param value - The value to include in the interrupt. This will be available in task.interrupts[].value
 * @returns The `resume` value provided when the graph is re-invoked with a Command
 *
 * @example
 * ```typescript
 * // Define a node that uses multiple interrupts
 * const nodeWithInterrupts = () => {
 *   // First interrupt - will pause execution and include {value: 1} in task values
 *   const answer1 = interrupt({ value: 1 });
 *
 *   // Second interrupt - only called after first interrupt is resumed
 *   const answer2 = interrupt({ value: 2 });
 *
 *   // Use the resume values
 *   return { myKey: answer1 + " " + answer2 };
 * };
 *
 * // Resume the graph after first interrupt
 * await graph.stream(new Command({ resume: "answer 1" }));
 *
 * // Resume the graph after second interrupt
 * await graph.stream(new Command({ resume: "answer 2" }));
 * // Final result: { myKey: "answer 1 answer 2" }
 * ```
 *
 * @throws {Error} If called outside the context of a graph
 * @throws {GraphInterrupt} When no resume value is available
 */
export function interrupt<I = unknown, R = any>(value: I): R {
  // 获取当前的 RunnableConfig
  const config: RunnableConfig | undefined =
    AsyncLocalStorageProviderSingleton.getRunnableConfig();
  if (!config) {
    throw new Error("Called interrupt() outside the context of a graph.");
  }

  const conf = config.configurable;
  if (!conf) {
    throw new Error("No configurable found in config");
  }

  // 检查是否配置了 Checkpointer
  const checkpointer: BaseCheckpointSaver = conf[CONFIG_KEY_CHECKPOINTER];
  if (!checkpointer) {
    throw new GraphValueError("No checkpointer set", {
      lc_error_code: "MISSING_CHECKPOINTER",
    });
  }

  // 追踪中断索引（支持同一节点内多次中断）
  const scratchpad: PregelScratchpad = conf[CONFIG_KEY_SCRATCHPAD];
  scratchpad.interruptCounter += 1;
  const idx = scratchpad.interruptCounter;

  // 查找之前的 resume 值
  if (scratchpad.resume.length > 0 && idx < scratchpad.resume.length) {
    conf[CONFIG_KEY_SEND]?.([[RESUME, scratchpad.resume] as PendingWrite]);
    return scratchpad.resume[idx] as R;
  }

  // 查找当前 resume 值
  if (scratchpad.nullResume !== undefined) {
    if (scratchpad.resume.length !== idx) {
      throw new Error(
        `Resume length mismatch: ${scratchpad.resume.length} !== ${idx}`
      );
    }
    const v = scratchpad.consumeNullResume();
    scratchpad.resume.push(v);
    conf[CONFIG_KEY_SEND]?.([[RESUME, scratchpad.resume] as PendingWrite]);
    return v as R;
  }

  // 没有找到 resume 值，抛出中断
  const ns: string[] | undefined = conf[CONFIG_KEY_CHECKPOINT_NS]?.split(
    CHECKPOINT_NAMESPACE_SEPARATOR
  );

  const id = ns ? XXH3(ns.join(CHECKPOINT_NAMESPACE_SEPARATOR)) : undefined;
  throw new GraphInterrupt([{ id, value }]);
}
```

#### 关键变量说明

```typescript
// PregelScratchpad 用于追踪中断状态
interface PregelScratchpad {
  // 中断计数器 - 同一节点内多次中断的索引
  interruptCounter: number;
  
  // 已提供的 resume 值数组
  resume: any[];
  
  // 空的 resume 值占位符（用于处理单个 resume 值的情况）
  nullResume: any | undefined;
  
  // 消耗空 resume 值的方法
  consumeNullResume: () => any;
}
```

#### GraphInterrupt 错误

```typescript
// libs/langgraph-core/src/errors.ts

export class GraphInterrupt extends Error {
  constructor(
    public readonly interrupts: Array<{ id?: string; value: unknown }>
  ) {
    super("Graph execution interrupted");
  }
}
```

## 中断的基本用法

### 基础示例：简单中断

```typescript
import { StateGraph, interrupt, Annotation } from "@langchain/langgraph";

// 定义状态
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

// 带中断的节点
async function reviewNode(state) {
  console.log("当前状态:", state);
  
  // 中断，等待人工审核
  const approval = interrupt({
    type: "human_review",
    message: "请审核以下输出:",
    data: state.messages[state.messages.length - 1],
  });
  
  // 继续执行
  console.log("审核结果:", approval);
  
  return {
    messages: [{
      role: "system",
      content: `Human review result: ${JSON.stringify(approval)}`
    }]
  };
}

// 创建图
const workflow = new StateGraph(StateAnnotation)
  .addNode("review", reviewNode)
  .compile({ checkpointer: true });  // 必须配置 checkpointer

// 第一次调用 - 会中断
const threadConfig = { configurable: { thread_id: "1" } };
const result1 = await workflow.invoke(
  { messages: [{ role: "user", content: "Hello" }] },
  threadConfig
);

// result1 包含中断信息
console.log(result1);
// {
//   messages: [...],
//   __interrupt: [{ value: { type: "human_review", ... } }]
// }

// 第二次调用 - 提供 resume 值
import { Command } from "@langchain/langgraph";

const result2 = await workflow.invoke(
  new Command({
    resume: { approved: true, comments: "Looks good!" }
  }),
  threadConfig
);

// 执行继续，result2 包含最终结果
```

### 多个中断点

一个节点内可以有多个 `interrupt()` 调用：

```typescript
async function multiInterruptNode(state) {
  // 第一个中断 - 获取审核结果
  const review = interrupt({
    type: "initial_review",
    data: state.data,
  });
  
  console.log("第一次审核结果:", review);
  
  // 根据第一次审核结果进行处理
  const processed = process(review);
  
  // 第二个中断 - 确认处理结果
  const confirmation = interrupt({
    type: "confirmation",
    processedData: processed,
  });
  
  console.log("确认结果:", confirmation);
  
  return { result: processed };
}

// 使用需要三次调用
const threadConfig = { configurable: { thread_id: "multi" } };

// 第一次：触发第一个中断
await graph.invoke({ data: "initial" }, threadConfig);

// 第二次：resume 第一个中断，触发第二个中断
await graph.invoke(
  new Command({ resume: { approved: true } }),
  threadConfig
);

// 第三次：resume 第二个中断
const finalResult = await graph.invoke(
  new Command({ resume: { confirmed: true } }),
  threadConfig
);
```

## interrupt() 的类型系统

### 类型定义

```typescript
export function interrupt<I = unknown, R = any>(value: I): R;
```

- `I`：中断时携带的值类型（interrupt value）
- `R`：恢复时返回的值类型（resume value）

### 类型推断辅助函数

```typescript
// 推断 interrupt 的输入类型
export type InferInterruptInputType<T> = 
  T extends typeof interrupt<infer I, unknown> ? I :
  T extends { [key: string]: typeof interrupt<any, any> }
    ? { [K in keyof T]: InferInterruptInputType<T[K]> }[keyof T]
    : unknown;

// 推断 interrupt 的返回类型
export type InferInterruptResumeType<T, TInner = false> = 
  T extends typeof interrupt<never, infer R>
    ? TInner extends true ? FilterAny<R> : R
    : T extends { [key: string]: typeof interrupt<any, any> }
      ? { [K in keyof T]: InferInterruptResumeType<T[K], true> }[keyof T]
      : unknown;
```

### 类型安全使用示例

```typescript
// 定义中断值的类型
interface ReviewInterrupt {
  type: "human_review";
  data: any;
  timestamp: number;
}

// 定义 resume 值的类型
interface ReviewResume {
  approved: boolean;
  comments?: string;
}

// 类型安全的中断函数
function reviewInterrupt(): ReviewResume {
  return interrupt<ReviewInterrupt, ReviewResume>({
    type: "human_review",
    data: {},
    timestamp: Date.now(),
  });
}
```

## 中断与 Checkpoint 的配合

### 为什么需要 Checkpointer

`interrupt()` 需要 Checkpointer 来保存中断时的状态：

```typescript
// 没有 checkpointer 会抛出错误
const workflow = new StateGraph(StateAnnotation)
  .addNode("review", reviewNode)
  .compile();  // ❌ 没有 checkpointer

await workflow.invoke(state);  
// 抛出：GraphValueError: No checkpointer set

// 正确的配置
const workflow = new StateGraph(StateAnnotation)
  .addNode("review", reviewNode)
  .compile({ checkpointer: true });  // ✅ 启用检查点
```

### 中断状态的保存

当中断发生时，以下信息被保存到 Checkpoint：

```typescript
interface StoredInterruptState {
  // 当前节点的状态
  channelValues: Record<string, any>;
  
  // 中断信息
  interrupts: Array<{
    id?: string;
    value: any;  // interrupt() 传入的值
  }>;
  
  // 中断位置信息
  checkpointNs: string;  // 命名空间
  taskId: string;        // 任务 ID
  
  // Scratchpad 状态（用于追踪多次中断）
  scratchpad: {
    interruptCounter: number;
    resume: any[];
  };
}
```

## 高级用法

### 动态中断条件

```typescript
async function conditionalInterruptNode(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  // 高风险操作需要审核
  const highRiskKeywords = ["delete", "remove", "permanent"];
  const isHighRisk = highRiskKeywords.some(
    kw => lastMessage.content.toLowerCase().includes(kw)
  );
  
  if (isHighRisk) {
    const approval = interrupt({
      type: "high_risk_review",
      action: lastMessage.content,
      riskLevel: "high",
    });
    
    if (!approval.approved) {
      return {
        messages: [{
          role: "system",
          content: "❌ Operation rejected by human reviewer"
        }]
      };
    }
  }
  
  // 正常处理
  return await processNormal(state);
}
```

### 中断超时处理

```typescript
async function timeoutInterruptNode(state) {
  const interruptValue = {
    type: "await_approval",
    data: state.request,
    timeout: 3600000,  // 1 小时超时
    createdAt: Date.now(),
  };
  
  const approval = interrupt(interruptValue);
  
  // 检查是否超时
  if (approval.timedOut) {
    return {
      status: "timeout",
      message: "Approval request timed out",
    };
  }
  
  // 正常处理
  return await handleApproval(approval);
}

// 超时检查逻辑可以在外部处理
// 通过分析 interrupt 中的 createdAt 字段
const interruptInfo = result.__interrupt?.[0]?.value;
if (interruptInfo && Date.now() - interruptInfo.createdAt > interruptInfo.timeout) {
  // 超时处理
  await workflow.invoke(
    new Command({ resume: { timedOut: true } }),
    config
  );
}
```

### 中断链：多级审核

```typescript
async function multiLevelReview(state) {
  // Level 1: 自动审核
  const autoReviewResult = await autoReview(state.data);
  
  if (autoReviewResult.flagged) {
    // Level 2: 业务主管审核
    const managerApproval = interrupt({
      level: "manager",
      data: autoReviewResult,
      reason: autoReviewResult.flagReason,
    });
    
    if (!managerApproval.approved) {
      return { status: "rejected_by_manager" };
    }
    
    // Level 3: 对于特别高风险的，需要高管审核
    if (autoReviewResult.riskLevel === "critical") {
      const executiveApproval = interrupt({
        level: "executive",
        decision: managerApproval,
      });
      
      if (!executiveApproval.approved) {
        return { status: "rejected_by_executive" };
      }
    }
  }
  
  return { status: "approved", data: state.data };
}
```

### 中断与 Send API 结合

```typescript
import { Send } from "@langchain/langgraph";

async function distributeForReview(state) {
  // 将审核请求分发给不同的审核者
  const reviewers = ["reviewer_a", "reviewer_b", "reviewer_c"];
  
  return reviewers.map(
    (reviewer) => 
      new Send("reviewer_node", {
        reviewer,
        item: state.item,
      })
  );
}

async function reviewerNode(state) {
  const review = interrupt({
    reviewer: state.reviewer,
    item: state.item,
  });
  
  return {
    reviewResults: [{
      reviewer: state.reviewer,
      decision: review.approved,
      comments: review.comments,
    }]
  };
}
```

## interrupt() 与 interruptBefore/interruptAfter

### interrupt 函数 vs interruptBefore

| 特性 | interrupt() | interruptBefore |
|------|-------------|-----------------|
| 位置 | 节点内部 | 图编译时配置 |
| 灵活性 | 高（可以动态决定） | 低（固定节点） |
| 携带信息 | 可以传递任意值 | 无携带信息 |
| 恢复值 | 可以接收 resume 值 | 不接收 resume 值 |

### 结合使用示例

```typescript
// 编译时配置 interruptBefore
const workflow = new StateGraph(StateAnnotation)
  .addNode("generate", generateNode)
  .addNode("review", reviewNode)
  .addEdge(START, "generate")
  .addEdge("generate", "review")
  .compile({
    checkpointer: true,
    interruptBefore: ["review"],  // 在 review 节点前中断
  });

async function reviewNode(state) {
  // 这里可以同时使用 interrupt() 进行额外控制
  const customReview = interrupt({
    customField: "some_data",
  });
  
  return { reviewed: true };
}
```

## 实践示例

### 示例 1：内容审核工作流

```typescript
import { StateGraph, interrupt, Annotation, Command } from "@langchain/langgraph";

const ContentState = Annotation.Root({
  content: Annotation<string>(),
  status: Annotation<string>({ default: () => "pending" }),
  reviews: Annotation<any[]>({ default: () => [] }),
});

// 自动内容检查
async function autoCheck(state) {
  const flagged = await detectViolations(state.content);
  return {
    status: flagged ? "flagged" : "approved",
    reviews: [{ type: "auto", passed: !flagged }],
  };
}

// 人工审核
async function humanReview(state) {
  const review = interrupt({
    type: "content_review",
    content: state.content,
    autoCheckResult: state.reviews[0],
  });
  
  return {
    status: review.approved ? "approved" : "rejected",
    reviews: [...state.reviews, { type: "human", ...review }],
  };
}

// 决策路由
function reviewRoute(state) {
  if (state.status === "approved") return END;
  if (state.status === "flagged") return "human_review";
  return END;
}

const contentWorkflow = new StateGraph(ContentState)
  .addNode("auto_check", autoCheck)
  .addNode("human_review", humanReview)
  .addEdge(START, "auto_check")
  .addConditionalEdges("auto_check", reviewRoute, {
    [END]: END,
    "human_review": "human_review",
  })
  .addEdge("human_review", END)
  .compile({ checkpointer: true });

// 使用示例
const config = { configurable: { thread_id: "content-1" } };

// 提交内容
await contentWorkflow.invoke({
  content: "User submitted content..."
}, config);

// 查看中断状态
const state = await contentWorkflow.getState(config);
console.log(state.interrupts);

// 人工审核通过
await contentWorkflow.invoke(
  new Command({
    resume: { approved: true, reviewer: "admin" }
  }),
  config
);
```

### 示例 2：多步骤表单收集

```typescript
const FormState = Annotation.Root({
  formData: Annotation<Record<string, any>>({ default: () => ({}) }),
  currentStep: Annotation<number>({ default: () => 0 }),
});

async function formNode(state) {
  const steps = ["personal", "contact", "preferences"];
  const currentStep = steps[state.currentStep];
  
  if (!currentStep) {
    return { status: "completed" };
  }
  
  // 中断，等待用户输入
  const inputData = interrupt({
    step: currentStep,
    stepNumber: state.currentStep,
    message: `Please fill in ${currentStep} information`,
  });
  
  return {
    formData: { ...state.formData, [currentStep]: inputData },
    currentStep: state.currentStep + 1,
  };
}

function formRoute(state) {
  const steps = ["personal", "contact", "preferences"];
  return state.currentStep < steps.length ? "form" : END;
}

const formWorkflow = new StateGraph(FormState)
  .addNode("form", formNode)
  .addEdge(START, "form")
  .addConditionalEdges("form", formRoute, {
    [END]: END,
    "form": "form",
  })
  .compile({ checkpointer: true });

// 使用示例
const config = { configurable: { thread_id: "form-1" } };

// 逐步填写表单
await formWorkflow.invoke({}, config);  // Step 1: personal
await formWorkflow.invoke(
  new Command({ resume: { name: "John", age: 30 } }),
  config
);  // Step 2: contact

await formWorkflow.invoke(
  new Command({ resume: { email: "john@example.com" } }),
  config
);  // Step 3: preferences

await formWorkflow.invoke(
  new Command({ resume: { theme: "dark" } }),
  config
);  // Completed
```

### 示例 3：发布审批流程

```typescript
const DeploymentState = Annotation.Root({
  environment: Annotation<string>(),
  version: Annotation<string>(),
  approvalStage: Annotation<string>({ default: () => "dev" }),
  approvals: Annotation<string[]>({ default: () => [] }),
});

async function approvalNode(state) {
  const stage = state.approvalStage;
  
  const review = interrupt({
    type: "deployment_approval",
    environment: state.environment,
    version: state.version,
    stage: stage,
    requiredApprovers: getRequiredApprovers(stage),
  });
  
  if (!review.approved) {
    return { status: "rejected", reason: review.reason };
  }
  
  const nextStage = getNextStage(stage);
  return {
    approvalStage: nextStage,
    approvals: [...state.approvals, stage],
  };
}

function deploymentRoute(state) {
  if (state.status === "rejected") return END;
  if (state.approvalStage === "production") return "deploy";
  return "approval";
}

async function deployNode(state) {
  await performDeployment(state);
  return { status: "deployed" };
}

const deploymentWorkflow = new StateGraph(DeploymentState)
  .addNode("approval", approvalNode)
  .addNode("deploy", deployNode)
  .addEdge(START, "approval")
  .addConditionalEdges("approval", deploymentRoute, {
    [END]: END,
    "approval": "approval",
    "deploy": "deploy",
  })
  .addEdge("deploy", END)
  .compile({ checkpointer: true });
```

## 调试中断

### 查看中断状态

```typescript
// 获取当前状态（包含中断信息）
const state = await graph.getState(config);
console.log("Interrupts:", state.interrupts);
console.log("Values:", state.values);
console.log("Checkpoint:", state.checkpoint);

// 遍历历史 checkpoints
for await (const checkpoint of graph.checkpointer.list(config)) {
  console.log("Checkpoint:", checkpoint);
}
```

### 使用 LangSmith 追踪

```typescript
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

const config = {
  configurable: { thread_id: "1" },
  callbacks: [
    new LangChainTracer({ projectName: "interrupt-debug" })
  ],
};

// 在 LangSmith 中可以看到完整的中断和恢复过程
```

## 常见问题 FAQ

### Q1: interrupt() 必须在异步函数中使用吗？

**A**: 不一定。`interrupt()` 可以在同步或异步函数中使用，因为它只是抛出一个异常。但包含 `interrupt()` 的节点通常是异步的。

```typescript
// 同步节点中使用
function syncNode(state) {
  const value = interrupt({ type: "sync" });
  return { value };
}

// 异步节点中使用
async function asyncNode(state) {
  const value = await fetchData();
  const approved = interrupt({ data: value });
  return { approved };
}
```

### Q2: 可以中断多少次？

**A**: 理论上没有限制。你可以在一个节点内调用多次 `interrupt()`，也可以在多个节点中使用。但要注意：

- 每次中断都会创建一个 Checkpoint
- 过多的中断会使恢复流程复杂
- 建议合理设计审核流程

### Q3: interrupt() 和 interruptBefore 有什么区别？

**A**: 
- `interruptBefore` 是在节点**执行前**暂停，用于人工确认是否执行该节点
- `interrupt()` 是在节点**执行过程中**暂停，可以传递自定义数据并接收 resume 值

### Q4: 如何在 Web 应用中处理中断？

**A**: 典型模式：

```typescript
// 1. API 端点触发工作流
app.post('/api/start', async (req, res) => {
  const threadId = generateThreadId();
  const result = await graph.invoke(input, {
    configurable: { thread_id: threadId }
  });
  
  // 检查是否有中断
  if (result.__interrupt) {
    res.json({ status: "awaiting_review", interrupt: result.__interrupt });
  }
});

// 2. API 端点处理审核
app.post('/api/review', async (req, res) => {
  const { threadId, decision } = req.body;
  
  const result = await graph.invoke(
    new Command({ resume: decision }),
    { configurable: { thread_id: threadId } }
  );
  
  res.json(result);
});
```

### Q5: 中断后如何取消？

**A**: 可以通过删除 Checkpoint 或设置特殊状态来"取消"：

```typescript
// 取消方式 1：删除线程
await graph.checkpointer.deleteThread(threadId);

// 取消方式 2：发送取消信号
await graph.invoke(
  new Command({ resume: { cancelled: true } }),
  config
);
```

## 最佳实践

### 1. 明确中断的目的

每个 `interrupt()` 调用都应该有明确的目的：

```typescript
// ✅ 好的实践
const approval = interrupt({
  type: "budget_approval",
  amount: request.amount,
  reason: request.reason,
});

// ❌ 不推荐 - 没有携带有用信息
const x = interrupt({});
```

### 2. 提供足够的上下文

让审核者有足够的信息做决定：

```typescript
const review = interrupt({
  type: "code_review",
  PR: {
    title: pr.title,
    description: pr.description,
    changes: pr.changedFiles,
    tests: pr.testResults,
    author: pr.author,
  },
  autoReview: {
    lintPassed: true,
    testsPassed: 42,
    coverageChanged: "+2.3%",
  },
});
```

### 3. 处理超时

对于需要人工审核的场景，考虑超时处理：

```typescript
const reviewRequest = {
  type: "security_review",
  createdAt: Date.now(),
  timeoutAt: Date.now() + 24 * 60 * 60 * 1000,  // 24 小时
};

const review = interrupt(reviewRequest);

// 外部可以检查是否超时
if (Date.now() > reviewRequest.timeoutAt) {
  // 执行超时逻辑
}
```

### 4. 记录审核日志

```typescript
async function auditReview(state) {
  const review = interrupt({ type: "review", data: state.data });
  
  // 记录审核日志
  await auditLog.log({
    type: "human_review",
    timestamp: new Date(),
    reviewer: review.reviewer,
    decision: review.approved,
    comments: review.comments,
  });
  
  return review;
}
```

## 总结

`interrupt()` 是 LangGraphJS 实现人机协作的核心机制：

- ✅ **灵活**：可以在任何节点中使用，传递自定义数据
- ✅ **强大**：支持多次中断、多级审核
- ✅ **类型安全**：完整的 TypeScript 类型支持
- ✅ **可追踪**：与 Checkpoint 系统完美结合

合理使用中断机制可以构建复杂但可控的工作流，特别是在需要人工审核、多步骤确认或等待外部输入的场景。

## 参考资料

- [LangGraphJS 源码 - interrupt.ts](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/interrupt.ts)
- [LangGraph 中断文档](https://langchain-ai.github.io/langgraphjs/how-tos/human_in_the_loop/)
- [LangGraph Checkpoint 系统](https://langchain-ai.github.io/langgraphjs/reference/checkpointing/)