# 最佳实践与 FAQ

## 最佳实践

### 1. 图设计原则

#### 单一职责

每个节点应该只做一件事：

```typescript
// ✅ 好的设计
async function searchNode(state) {
  // 只负责搜索
  return { results: await search(state.query) };
}

async function rankNode(state) {
  // 只负责排序
  return { results: rankResults(state.results) };
}

// ❌ 避免巨型节点
async function doEverything(state) {
  const results = await search(state.query);
  const ranked = rankResults(results);
  const formatted = format(ranked);
  return { output: formatted };
}
```

#### 明确的状态流转

```typescript
const AgentState = Annotation.Root({
  // ✅ 清晰的字段命名
  currentStep: Annotation<string>({ default: () => "" }),
  iteration: Annotation<number>({ default: () => 0 }),
  
  // ❌ 模糊的命名
  // data: Annotation<any>(),
  // stuff: Annotation<any>(),
});
```

#### 可视化设计

```typescript
// 使用 Mermaid 等工具可视化你的图
const graphDiagram = `
graph TD
    A[START] --> B[Planner]
    B --> C[Researcher]
    C --> D[Writer]
    D --> E{Review?}
    E -->|Approved| F[END]
    E -->|Revise| D
`;
```

### 2. 状态管理

#### 精简状态

```typescript
// ✅ 只保存必要的状态
const MinimalState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  currentTask: Annotation<string>(),
});

// ❌ 状态膨胀
const BloatedState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  rawInput: Annotation<string>(),
  processedInput: Annotation<string>(),
  intermediateResults: Annotation<any[]>(),
  cachedResponses: Annotation<string[]>(),
  // ... 太多字段
});
```

#### 不可变更新

```typescript
// ✅ 不可变更新
async function safeUpdate(state) {
  return {
    messages: [...state.messages, newMessage],
    results: [...state.results, newResult],
  };
}

// ❌ 直接修改状态
async function unsafeUpdate(state) {
  state.messages.push(newMessage);  // 直接修改
  state.results.push(newResult);
  return state;
}
```

### 3. 错误处理

#### 明确的错误边界

```typescript
async function robustNode(state) {
  try {
    return await riskyOperation(state.input);
  } catch (error) {
    // ✅ 记录错误
    console.error("Node failed:", error);
    
    // ✅ 提供回退
    return { 
      result: getFallbackResult(),
      error: sanitizeError(error),
    };
  }
}

function sanitizeError(error: Error): string {
  // ❌ 不要暴露内部细节
  // return error.stack;
  
  // ✅ 返回用户友好的消息
  return "操作失败，请重试";
}
```

#### 重试策略

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries) throw error;
      
      // 指数退避
      await new Promise(r => 
        setTimeout(r, Math.pow(2, i) * 1000)
      );
    }
  }
}
```

### 4. 性能优化

#### 并行执行

```typescript
// ✅ 并行独立任务
function expandToParallel(state) {
  return state.items.map(item => 
    new Send("process", { item })
  );
}

// ❌ 串行执行
async function serialProcess(state) {
  const results = [];
  for (const item of state.items) {
    results.push(await process(item));  // 慢
  }
  return { results };
}
```

#### 缓存策略

```typescript
const cache = new Map();

async function cachedLLM(state) {
  const key = hashMessages(state.messages);
  
  if (cache.has(key)) {
    return cache.get(key);
  }
  
  const result = await llm.invoke(state.messages);
  cache.set(key, result);
  return result;
}
```

### 5. 测试最佳实践

#### 单元测试

```typescript
// 测试单个节点
test("searchNode returns results", async () => {
  const state = { query: "test" };
  const result = await searchNode(state);
  
  expect(result.results).toBeDefined();
  expect(result.results.length).toBeGreaterThan(0);
});

// 测试状态流转
test("state counter increments", async () => {
  const graph = createTestGraph();
  
  let state = await graph.invoke({});
  expect(state.counter).toBe(1);
  
  state = await graph.invoke(state);
  expect(state.counter).toBe(2);
});
```

#### 集成测试

```typescript
test("full graph execution", async () => {
  const graph = createAgentGraph().compile();
  
  const result = await graph.invoke({
    task: "write a blog post about AI",
  });
  
  expect(result.output).toBeDefined();
  expect(result.output.length).toBeGreaterThan(100);
});
```

### 6. 可维护性

#### 模块化设计

```typescript
// 将复杂图分解为子图
const researchSubgraph = createResearchGraph();
const writingSubgraph = createWritingGraph();
const reviewSubgraph = createReviewGraph();

const mainGraph = new StateGraph(MainState)
  .addNode("research", researchSubgraph)
  .addNode("writing", writingSubgraph)
  .addNode("review", reviewSubgraph)
  .addEdge(START, "research")
  .addEdge("research", "writing")
  .addEdge("writing", "review")
  .compile();
```

#### 文档化

```typescript
/**
 * 内容生成 Agent
 * 
 * 流程:
 * 1. 研究主题
 * 2. 生成草稿
 * 3. 审核质量
 * 4. 输出最终内容
 * 
 * @param state - 当前状态
 * @returns 更新后的状态
 */
async function contentAgent(state: ContentState): Promise<ContentUpdate> {
  // 实现...
}
```

### 7. 调试技巧

#### 详细日志

```typescript
async function debuggableNode(state, config) {
  const runId = config.runId;
  console.log(`[${runId}] Node started`, { state });
  
  try {
    const result = await process(state);
    console.log(`[${runId}] Node completed`, { result });
    return result;
  } catch (error) {
    console.error(`[${runId}] Node failed`, { error });
    throw error;
  }
}
```

#### LangSmith 集成

```typescript
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

const config = {
  callbacks: [
    new LangChainTracer({
      projectName: "my-agent",
    }),
  ],
};

await graph.invoke(input, config);

// 在 LangSmith UI 中查看完整追踪
```

## 常见问题 FAQ

### 通用问题

#### Q1: 我应该在什么情况下使用 LangGraph？

**A**: 当你需要：
- 多步骤 AI 工作流
- 状态管理和记忆
- 人工审核和中断
- 复杂的决策逻辑

如果只需要单次 LLM 调用，直接用 LangChain 就够了。

#### Q2: LangGraph 与 LangChain 的关系？

**A**: 
- **LangChain**: LLM 编排库（链、Agent、工具）
- **LangGraph**: 基于图的 Agent 框架（状态机、循环、多 Agent）

LangGraph 构建在 LangChain 之上，提供更强大的编排能力。

#### Q3: 如何选择预构建 Agent 还是自定义？

**A**:
| 场景 | 选择 |
|------|------|
| 标准 ReAct 模式 | `createReactAgent` |
| 简单多轮对话 | `createReactAgent` |
| 复杂工作流 | 自定义 StateGraph |
| 多 Agent 协作 | 自定义图 + Send API |
| 特殊业务逻辑 | 自定义 StateGraph |

### 技术问题

#### Q4: 如何处理长对话历史？

**A**: 
```typescript
// 策略 1: 截断
const MAX_MESSAGES = 50;
const recentMessages = state.messages.slice(-MAX_MESSAGES);

// 策略 2: 摘要
const summary = await summarize(messages.slice(0, -20));
const context = [
  { role: "system", content: `对话摘要: ${summary}` },
  ...messages.slice(-20),
];
```

#### Q5: Checkpoint 存储应该选什么？

**A**:
| 场景 | 推荐 |
|------|------|
| 本地开发测试 | `MemorySaver` |
| 生产环境 | `PostgresSaver` |
| 高性能缓存 | `RedisSaver` |
| 嵌入式应用 | `SqliteSaver` |

#### Q6: 如何实现流式输出？

**A**:
```typescript
const stream = await graph.stream(input, {
  streamMode: "values",  // 或 "messages", "updates"
});

for await (const chunk of stream) {
  console.log("Update:", chunk);
}
```

#### Q7: 如何调试执行问题？

**A**:
1. 使用 `streamMode: "debug"` 查看详细执行
2. 使用 LangSmith 追踪
3. 检查 Checkpoint 历史
4. 启用节点日志

### 性能问题

#### Q8: 我的图执行很慢，如何优化？

**A**:
1. 识别瓶颈：使用性能监控
2. 并行化：无依赖任务并行执行
3. 缓存：LLM 响应、计算结果
4. 精简 prompt：减少 token 数量
5. 模型选择：简单任务用快模型

#### Q9: 如何减少 LLM 调用成本？

**A**:
- 缓存重复请求
- 使用较小的模型处理简单任务
- 精简 prompt，去除冗余
- 批量处理多个问题
- 限制最大迭代次数

### 生产部署

#### Q10: 如何部署 LangGraph 到生产？

**A**:
1. 使用 Postgres 或 Redis 存储 Checkpoint
2. 配置合适的超时和重试
3. 启用监控和日志
4. 使用 LangSmith 追踪
5. 实现错误告警

#### Q11: 如何处理高并发？

**A**:
- 使用连接池（数据库、LLM）
- 并行执行无依赖任务
- 使用 Redis 等高性能缓存
- 水平扩展应用实例
- 监控资源使用

#### Q12: 如何保证数据安全？

**A**:
- 不存储敏感信息在 Checkpoint
- 使用加密存储
- 实施访问控制
- 定期清理旧数据
- 监控异常访问

## 设计模式总结

### 模式 1: 规划 - 执行 - 审核

```typescript
const workflow = new StateGraph(State)
  .addNode("plan", planner)
  .addNode("execute", executor)
  .addNode("review", reviewer)
  .addEdge(START, "plan")
  .addEdge("plan", "execute")
  .addConditionalEdges("review", shouldRevise, {
    true: "execute",
    false: END,
  })
  .compile();
```

### 模式 2: 并行处理

```typescript
function expand(state) {
  return items.map(item => new Send("process", item));
}

const workflow = new StateGraph(State)
  .addNode("expand", expand)
  .addNode("process", processor)
  .addNode("aggregate", aggregator)
  .addEdge(START, "expand")
  .addEdge("process", "aggregate")
  .compile();
```

### 模式 3: 人工审核

```typescript
async function reviewNode(state) {
  const decision = interrupt({ type: "review", data: state.output });
  return { decision };
}

const workflow = new StateGraph(State)
  .addNode("generate", generator)
  .addNode("review", reviewNode)
  .addConditionalEdges("review", routeByDecision)
  .compile({ checkpointer: true });
```

## 总结

LangGraphJS 最佳实践要点：

1. **设计原则**：单一职责、清晰流转、可视化
2. **状态管理**：精简、不可变、有文档
3. **错误处理**：明确边界、重试策略、友好消息
4. **性能优化**：并行、缓存、模型选择
5. **可维护性**：模块化、文档化、可测试
6. **调试技巧**：日志、追踪、检查点分析

记住：没有一成不变的最佳实践，根据具体场景调整。

## 参考资料

- [LangGraph 官方指南](https://langchain-ai.github.io/langgraphjs/)
- [LangChain 最佳实践](https://js.langchain.com/docs/guides/)