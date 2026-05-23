# 流式输出 Stream

## 概述

流式输出（Streaming）是 LangGraphJS 提供的重要特性，允许在图执行过程中**实时接收**各个节点的输出、状态更新和事件通知。这对于构建响应式应用、实时调试和监控长运行任务至关重要。

LangGraphJS 支持多种流式模式，包括：
- **values 模式**：流式输出每个步骤后的完整状态
- **messages 模式**：流式输出新增的消息
- **updates 模式**：流式输出每个节点的增量更新
- **debug 模式**：流式输出详细的调试信息
- **events 模式**：流式输出完整的事件流

## 为什么需要流式输出

### 传统批量执行的局限

在传统的批量执行模式中：

```typescript
const result = await graph.invoke(input);
// 只有执行完成后才能看到结果
```

这种模式存在以下问题：

1. **延迟反馈**：用户必须等待整个流程完成才能看到任何输出
2. **无法监控进度**：对于长时间运行的任务，无法知道当前执行到哪一步
3. **调试困难**：出错时难以定位问题发生在哪个节点
4. **用户体验差**：无法显示中间状态或进度

### 流式输出的优势

```typescript
const stream = await graph.stream(input, { streamMode: "values" });

for await (const chunk of stream) {
  // 实时接收每个步骤的输出
  console.log("Current state:", chunk);
}
```

优势包括：

| 优势 | 描述 |
|------|------|
| 实时反馈 | 立即看到处理进度 |
| 增量更新 | 只传输变化的部分 |
| 可中断性 | 可以在任何时候停止流 |
| 调试友好 | 详细观察每步执行 |
| 用户体验 | 可以实时更新 UI |

## 流式 API 基础

### stream() 方法签名

```typescript
async *stream(
  input: InputType | Command,
  options?: {
    streamMode?: StreamMode | StreamMode[];
    config?: Partial<RunnableConfig>;
    subgraphs?: boolean;
  }
): AsyncGenerator<OutputType>
```

### 基础用法

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

async function node1(state) {
  return { messages: [{ role: "assistant", content: "From node 1" }] };
}

async function node2(state) {
  return { messages: [{ role: "assistant", content: "From node 2" }] };
}

const workflow = new StateGraph(StateAnnotation)
  .addNode("node1", node1)
  .addNode("node2", node2)
  .addEdge(START, "node1")
  .addEdge("node1", "node2")
  .compile();

// 流式执行
const stream = await workflow.stream(
  { messages: [{ role: "user", content: "Hello" }] },
  { streamMode: "values" }
);

for await (const chunk of stream) {
  console.log("State:", chunk);
}
```

## 流式模式详解

### streamMode 选项

LangGraphJS 支持多种流式模式：

#### 1. values 模式

输出每个步骤后的**完整状态**。

```typescript
const stream = await graph.stream(input, { streamMode: "values" });

for await (const state of stream) {
  // state 是完整的状态对象
  console.log("Full state:", state);
  // {
  //   messages: [...],
  //   otherFields: ...
  // }
}
```

**适用场景**：
- 需要查看完整状态快照
- 前端需要实时显示当前状态
- 调试时需要完整的上下文

#### 2. updates 模式

输出每个节点的**增量更新**。

```typescript
const stream = await graph.stream(input, { streamMode: "updates" });

for await (const update of stream) {
  // update 格式：{ nodeName: { field: value } }
  console.log("Update:", update);
  // { "node1": { messages: [...] } }
}
```

**适用场景**：
- 只关心变化的部分
- 减少数据传输量
- 需要根据节点名处理更新

#### 3. messages 模式

输出**消息的增量**（仅适用于消息状态）。

```typescript
const stream = await graph.stream(input, { streamMode: "messages" });

for await (const [message, metadata] of stream) {
  // message 是新增的消息
  // metadata 包含消息来源等信息
  console.log("New message:", message);
  console.log("Metadata:", metadata);
}
```

**适用场景**：
- 聊天应用
- LLM token 级流式输出
- 只关心消息内容

#### 4. debug 模式

输出**详细的调试信息**。

```typescript
const stream = await graph.stream(input, { streamMode: "debug" });

for await (const debug of stream) {
  // debug 包含详细的执行信息
  console.log("Debug:", debug);
  // {
  //   type: "task",
  //   timestamp: "...",
  //   step: 1,
  //   payload: { ... }
  // }
}
```

**适用场景**：
- 调试复杂流程
- 监控执行性能
- 了解内部状态变化

#### 5. events 模式（高级）

输出**完整的事件流**，包含所有类型的生命周期事件。

```typescript
const stream = await graph.stream(input, { streamMode: "events" });

for await (const event of stream) {
  console.log("Event:", event);
  // {
  //   type: "on_chat_model_stream",
  //   data: { chunk: ... },
  //   metadata: { runId: "...", ... }
  // }
}
```

#### 6. 组合模式

可以同时使用多个模式：

```typescript
const stream = await graph.stream(input, {
  streamMode: ["values", "updates", "debug"],
});

for await (const [mode, data] of stream) {
  // mode 是当前流式模式的名称
  // data 是对应的数据
  console.log(`[${mode}]:`, data);
}
```

### 输出格式对比

| 模式 | 输出格式 | 数据量 | 适用场景 |
|------|----------|--------|----------|
| `values` | 完整状态对象 | 大 | 前端状态同步 |
| `updates` | `{ nodeName: update }` | 中 | 增量更新处理 |
| `messages` | `[message, metadata]` | 小 | 消息流式显示 |
| `debug` | 详细调试对象 | 大 | 调试和监控 |
| `events` | 完整事件对象 | 最大 | 深度集成 |

## 源码分析

### 流式系统架构

LangGraphJS 的流式系统经过多次迭代，当前版本（v2）采用事件驱动架构：

```
libs/langgraph-core/src/stream/
├── index.ts          # 公共导出
├── types.ts          # 类型定义
├── mux.ts            # 流式多路复用器
├── run-stream.ts     # 图执行流
├── stream-channel.ts # 流式通道
├── convert.ts        # 事件格式转换
└── transformers/     # 流式转换器
    ├── index.ts
    ├── messages.ts
    ├── values.ts
    └── lifecycle.ts
```

### 核心组件

#### StreamMux（流式多路复用器）

```typescript
// libs/langgraph-core/src/stream/mux.ts

export class StreamMux {
  #streams: Map<string, StreamChannel<any>>;
  
  constructor() {
    this.#streams = new Map();
  }
  
  // 创建新的流式通道
  registerStream<T>(
    ns: string[],
    streamMode: StreamMode
  ): StreamChannel<T> {
    const key = nsKey(ns, streamMode);
    const channel = new StreamChannel<T>();
    this.#streams.set(key, channel);
    return channel;
  }
  
  // 写入流式数据
  write<T>(
    ns: string[],
    streamMode: StreamMode,
    data: T
  ): void {
    const key = nsKey(ns, streamMode);
    const channel = this.#streams.get(key);
    if (channel) channel.write(data);
  }
  
  // 结束流
  close(ns: string[]): void {
    for (const channel of this.#streams.values()) {
      channel.close();
    }
  }
}
```

#### createLifecycleTransformer

```typescript
// libs/langgraph-core/src/stream/transformers/lifecycle.ts

export function createLifecycleTransformer(
  options: LifecycleTransformerOptions
): StreamTransformer<LifecycleEntry, LifecycleEntry> {
  return async function* transform(source) {
    for await (const entry of source) {
      // 处理生命周期事件
      if (shouldInclude(entry, options)) {
        yield entry;
      }
    }
  };
}
```

### Pregel 中的流式实现

在 Pregel 引擎中，流式输出通过以下方式实现：

```typescript
// libs/langgraph-core/src/pregel/index.ts (简化示例)

async *stream(
  input: InputType,
  options?: StreamOptions
): AsyncGenerator<StreamOutput> {
  const {
    streamMode = "values",
    config,
    subgraphs = false,
  } = options || {};
  
  // 创建流式多路复用器
  const streamMux = new StreamMux();
  
  // 注册请求的流式模式
  const modes = Array.isArray(streamMode) ? streamMode : [streamMode];
  const channels = modes.map(mode =>
    streamMux.registerStream([], mode)
  );
  
  // 执行图，同时写入流式通道
  this._executeWithStreaming(input, config, streamMux, subgraphs);
  
  // 从通道读取流式数据
  for await (const output of this._readFromChannels(channels)) {
    yield output;
  }
}
```

## 高级流式特性

### 子图流式

当使用子图时，可以控制是否流式输出子图的内部状态：

```typescript
// 启用子图流式
const stream = await graph.stream(input, {
  streamMode: "updates",
  subgraphs: true,  // 包含子图事件
});

for await (const [namespace, update] of stream) {
  // namespace 标识子图路径
  // 例如：["parent_graph", "child_graph"]
  console.log(`[${namespace.join(" > ")}]:`, update);
}
```

### 条件中断流

```typescript
const stream = await graph.stream(input, {
  streamMode: "values",
  interruptBefore: ["review"],  // 在 review 节点前中断
});

for await (const chunk of stream) {
  console.log("State:", chunk);
  // 到达 review 节点前会停止
}

// 检查是否因为中断而停止
if (await graph.getState(config)).tasks.length > 0 {
  console.log("流被中断停止");
}
```

### 流式取消

可以在任何时候取消流：

```typescript
const controller = new AbortController();

const stream = await graph.stream(input, {
  streamMode: "values",
  signal: controller.signal,
});

// 处理流
setTimeout(() => {
  controller.abort();  // 取消流
}, 5000);

try {
  for await (const chunk of stream) {
    console.log("Chunk:", chunk);
  }
} catch (error) {
  if (error.name === "AbortError") {
    console.log("Stream was cancelled");
  }
}
```

### 流式与 Command 配合

```typescript
import { Command } from "@langchain/langgraph";

// 处理中断后的恢复
const stream = await graph.stream(
  new Command({ resume: { approved: true } }),
  { streamMode: "values" }
);

for await (const state of stream) {
  console.log("Resumed state:", state);
}
```

## 实践示例

### 示例 1：聊天应用流式响应

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

const ChatState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

async function chatNode(state, config) {
  const llm = new ChatOpenAI({ model: "gpt-4o", streaming: true });
  
  const response = await llm.invoke(state.messages, config);
  
  return { messages: [response] };
}

const chatGraph = new StateGraph(ChatState)
  .addNode("chat", chatNode)
  .addEdge(START, "chat")
  .compile();

// 流式聊天
async function streamChat(userMessage: string) {
  const stream = await chatGraph.stream(
    { messages: [{ role: "user", content: userMessage }] },
    { streamMode: "messages" }
  );
  
  let content = "";
  for await (const [chunk, metadata] of stream) {
    // 实时显示 LLM 生成的内容
    if (chunk.content) {
      content += chunk.content;
      process.stdout.write(chunk.content);  // 打字机效果
    }
  }
  console.log("\nFinal content:", content);
}
```

### 示例 2：数据处理管道进度显示

```typescript
const DataState = Annotation.Root({
  items: Annotation<any[]>({ default: () => [] }),
  processed: Annotation<number>({ default: () => 0 }),
  errors: Annotation<string[]>({ default: () => [] }),
});

async function fetchNode(state) {
  // 获取数据
  const items = await fetchData();
  return { items, processed: 0 };
}

async function processNode(state) {
  const results = [];
  const errors = [];
  
  for (let i = 0; i < state.items.length; i++) {
    try {
      const result = await processItem(state.items[i]);
      results.push(result);
    } catch (error) {
      errors.push(`Item ${i}: ${error.message}`);
    }
    
    // 报告进度
    yield { processed: i + 1 };
  }
  
  return { items: results, errors };
}

async function reportNode(state) {
  console.log(`Processed: ${state.processed}`);
  console.log(`Errors: ${state.errors.length}`);
  return { status: "complete" };
}

const dataGraph = new StateGraph(DataState)
  .addNode("fetch", fetchNode)
  .addNode("process", processNode)
  .addNode("report", reportNode)
  .addEdge(START, "fetch")
  .addEdge("fetch", "process")
  .addEdge("process", "report")
  .compile();

// 显示进度
async function processDataWithProgress() {
  const stream = await dataGraph.stream(
    {},
    { streamMode: "updates" }
  );
  
  for await (const update of stream) {
    const node = Object.keys(update)[0];
    const data = update[node];
    
    if (node === "process" && data.processed !== undefined) {
      // 显示进度条
      const progress = data.processed;
      console.log(`Processing: ${progress}%`);
    }
  }
}
```

### 示例 3：多 Agent 协作流式输出

```typescript
const SupervisorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  currentAgent: Annotation<string>({ default: () => "researcher" }),
});

async function researcherAgent(state) {
  // 研究任务
  return {
    messages: [{ role: "assistant", content: "Researching..." }],
    currentAgent: "writer",
  };
}

async function writerAgent(state) {
  // 写作任务
  return {
    messages: [{ role: "assistant", content: "Writing..." }],
    currentAgent: "reviewer",
  };
}

async function reviewerAgent(state) {
  // 审核任务
  return {
    messages: [{ role: "assistant", content: "Reviewing..." }],
    currentAgent: "researcher",  // 可能需要更多研究
  };
}

function supervisor(state) {
  // 监督者逻辑
  const iteration = countIterations(state.messages);
  if (iteration >= 3) {
    return END;
  }
  return state.currentAgent;
}

const multiAgentGraph = new StateGraph(SupervisorState)
  .addNode("researcher", researcherAgent)
  .addNode("writer", writerAgent)
  .addNode("reviewer", reviewerAgent)
  .addEdge(START, "researcher")
  .addConditionalEdges("reviewer", supervisor, {
    "researcher": "researcher",
    "writer": "writer",
    [END]: END,
  })
  .addEdge("researcher", "writer")
  .addEdge("writer", "reviewer")
  .compile();

// 流式观察多 Agent 协作
async function streamMultiAgent() {
  const stream = await multiAgentGraph.stream(
    { messages: [{ role: "user", content: "Write a report" }] },
    { streamMode: ["updates", "debug"] }
  );
  
  for await (const [mode, data] of stream) {
    if (mode === "updates") {
      const node = Object.keys(data)[0];
      console.log(`Agent ${node} completed`);
    } else if (mode === "debug") {
      console.log(`Step ${data.step}: ${data.type}`);
    }
  }
}
```

### 示例 4：LLM Token 级流式

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

const LLMState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
});

async function llmNode(state, config) {
  const llm = new ChatOpenAI({ 
    model: "gpt-4o",
    streaming: true,
  });
  
  // 使用流式调用
  const response = await llm.stream(state.messages, config);
  
  let content = "";
  for await (const chunk of response) {
    if (chunk.content) {
      content += chunk.content;
    }
  }
  
  return { 
    messages: [new AIMessage({ 
      content,
      response_metadata: { finish_reason: "stop" }
    })] 
  };
}

const llmGraph = new StateGraph(LLMState)
  .addNode("llm", llmNode)
  .addEdge(START, "llm")
  .compile();

// Token 级流式输出
async function streamTokens(userInput: string) {
  const stream = await llmGraph.stream(
    { messages: [new HumanMessage(userInput)] },
    { streamMode: "messages" }
  );
  
  process.stdout.write("\n🤖: ");
  for await (const [message, metadata] of stream) {
    if (message.content && typeof message.content === "string") {
      // 逐个字符显示
      process.stdout.write(message.content.slice(-1));
    }
  }
  console.log("\n");
}
```

### 示例 5：复杂工作流监控仪表板

```typescript
interface WorkflowMetrics {
  nodeTimings: Map<string, number>;
  totalDuration: number;
  stepCount: number;
  errors: string[];
}

async function monitorWorkflow(input: any) {
  const metrics: WorkflowMetrics = {
    nodeTimings: new Map(),
    totalDuration: 0,
    stepCount: 0,
    errors: [],
  };
  
  const startTime = Date.now();
  
  const stream = await complexGraph.stream(input, {
    streamMode: ["updates", "debug"],
    subgraphs: true,
  });
  
  let lastNodeTime = Date.now();
  
  for await (const [mode, data] of stream) {
    if (mode === "debug") {
      // 记录步骤
      metrics.stepCount++;
      
      // 计算节点执行时间
      if (data.type === "task_result") {
        const nodeDuration = Date.now() - lastNodeTime;
        metrics.nodeTimings.set(data.payload.id, nodeDuration);
        lastNodeTime = Date.now();
      }
      
      // 记录错误
      if (data.type === "error") {
        metrics.errors.push(data.payload.error);
      }
    }
    
    // 实时更新仪表板
    updateDashboard({
      progress: metrics.stepCount,
      currentNode: debug?.payload?.name,
      elapsed: Date.now() - startTime,
      errors: metrics.errors.length,
    });
  }
  
  metrics.totalDuration = Date.now() - startTime;
  return metrics;
}
```

## 流式性能优化

### 缓冲策略

对于高频更新，可以使用缓冲来减少输出次数：

```typescript
async function* bufferedStream(
  source: AsyncGenerator,
  bufferSizeMs: number
) {
  let buffer: any[] = [];
  let timer: NodeJS.Timeout | null = null;
  
  const flush = () => {
    if (buffer.length > 0) {
      yield buffer;
      buffer = [];
    }
  };
  
  for await (const chunk of source) {
    buffer.push(chunk);
    
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, bufferSizeMs);
  }
  
  flush();
}

// 使用
const stream = await graph.stream(input, { streamMode: "updates" });
const buffered = bufferedStream(stream, 100);  // 100ms 缓冲

for await (const chunks of buffered) {
  // 最多每 100ms 收到一次更新
  console.log("Buffered chunks:", chunks);
}
```

### 选择性流式

只流式输出特定节点或特定类型的数据：

```typescript
const stream = await graph.stream(input, {
  streamMode: "updates",
});

for await (const update of stream) {
  const nodeName = Object.keys(update)[0];
  
  // 只关注特定节点
  if (["node1", "node3"].includes(nodeName)) {
    console.log("Update from important node:", update);
  }
}
```

### 前端集成优化

```typescript
// React 组件示例
function WorkflowViewer({ graph, input }) {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  
  useEffect(() => {
    const runStream = async () => {
      const stream = await graph.stream(input, {
        streamMode: "values",
      });
      
      for await (const chunk of stream) {
        setState(chunk);
        setHistory(prev => [...prev, chunk]);
      }
    };
    
    runStream();
  }, [graph, input]);
  
  return (
    <div>
      <StateDisplay state={state} />
      <HistoryView history={history} />
    </div>
  );
}
```

## 调试技巧

### 使用 debug 模式

```typescript
const stream = await graph.stream(input, {
  streamMode: "debug",
});

for await (const debug of stream) {
  console.log(JSON.stringify(debug, null, 2));
}
// 输出完整的执行跟踪
```

### 组合调试

```typescript
const stream = await graph.stream(input, {
  streamMode: ["values", "updates", "debug", "messages"],
});

for await (const [mode, data] of stream) {
  console.log(`\n--- ${mode.toUpperCase()} ---`);
  console.log(data);
}
```

### 性能分析

```typescript
const timings = new Map<string, number>();
const startTime = Date.now();

const stream = await graph.stream(input, {
  streamMode: "debug",
});

for await (const debug of stream) {
  if (debug.type === "task_start") {
    timings.set(debug.payload.id, Date.now());
  } else if (debug.type === "task_end") {
    const duration = Date.now() - timings.get(debug.payload.id);
    console.log(`Node ${debug.payload.name}: ${duration}ms`);
  }
}

console.log(`Total: ${Date.now() - startTime}ms`);
```

## 常见问题 FAQ

### Q1: stream() 和 invoke() 可以同时使用吗？

**A**: 不推荐。对于同一个 thread_id，应该避免同时调用 stream 和 invoke，这可能导致状态冲突。

### Q2: 如何在流式输出中处理错误？

**A**: 使用 try-catch 包裹流式循环：

```typescript
try {
  for await (const chunk of stream) {
    // 处理 chunk
  }
} catch (error) {
  console.error("Stream error:", error);
}
```

### Q3: 流式输出会消耗更多资源吗？

**A**: 流式输出确实会有一定的开销，但对于大多数应用来说是可以忽略的。主要开销在于：
- 创建和维护流式通道
- 序列化/反序列化增量数据

### Q4: 如何测试流式功能？

**A**: 可以收集所有流式输出进行验证：

```typescript
async function testStreaming() {
  const chunks = [];
  const stream = await graph.stream(input);
  
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  
  expect(chunks.length).toBeGreaterThan(0);
  // 验证最终状态
  expect(chunks[chunks.length - 1]).toEqual(expectedFinalState);
}
```

### Q5: 流式输出支持浏览器环境吗？

**A**: 是的，LangGraphJS 的流式输出完全支持浏览器环境，使用标准的 AsyncIterator 协议。

## 总结

流式输出是 LangGraphJS 的核心特性之一，它提供了：

- ✅ **多种流式模式**：values、updates、messages、debug、events
- ✅ **细粒度控制**：可以选择性地流式输出特定节点或数据
- ✅ **子图支持**：可以深入观察子图的内部执行
- ✅ **可取消**：支持在任意时刻取消流式执行
- ✅ **类型安全**：完整的 TypeScript 类型定义

合理使用流式输出可以显著提升用户体验和开发效率，特别是在构建实时应用和调试复杂流程时。

## 参考资料

- [LangGraphJS 源码 - Stream](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph-core/src/stream)
- [LangGraph 流式输出文档](https://langchain-ai.github.io/langgraphjs/how-tos/streaming/)
- [LangGraph 事件流文档](https://langchain-ai.github.io/langgraphjs/reference/events/)