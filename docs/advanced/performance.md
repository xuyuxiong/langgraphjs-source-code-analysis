# 性能优化 Performance Optimization

## 概述

性能优化是构建高效 AI Agent 系统的关键。高效的 Agent 系统可以：

- **减少响应时间**：用户获得更快的反馈
- **降低成本**：减少 LLM 调用和资源消耗
- **提高吞吐量**：服务更多并发用户
- **改善体验**：流式输出、实时反馈

本章深入探讨 LangGraphJS 应用的性能优化策略。

## 并行执行优化

### Send API 并行处理

```typescript
import { Send } from "@langchain/langgraph";

// 并行分发任务
function parallelExpand(state) {
  const tasks = state.items.map((item, index) => ({
    itemId: item.id,
    data: item.data,
    index,
  }));
  
  // 使用 Send 并行分发
  return tasks.map(task => 
    new Send("processor", task)
  );
}

async function processor(state) {
  // 每个任务独立执行
  const result = await processItem(state.data);
  return { results: [{ id: state.itemId, result }] };
}

const parallelGraph = new StateGraph(StateAnnotation)
  .addNode("expand", parallelExpand)
  .addNode("processor", processor)
  .addNode("aggregate", aggregateResults)
  .addEdge(START, "expand")
  .addEdge("processor", "aggregate")
  .compile();

// 性能提升：N 个任务从 N*单次时间 变为 单次时间（理想情况）
```

### 并行 LLM 调用

```typescript
async function parallelLLMCalls(state) {
  const prompts = [
    "分析角度 A",
    "分析角度 B", 
    "分析角度 C",
  ];
  
  // 并行调用 LLM
  const results = await Promise.all(
    prompts.map(prompt =>
      llm.invoke([{ role: "user", content: prompt }])
    )
  );
  
  return { analyses: results.map(r => r.content) };
}

// 单线程 vs 并行
// 单线程：3 次调用 * 2 秒 = 6 秒
// 并行：约 2 秒（取决于并发限制）
```

## 缓存优化

### LLM 响应缓存

```typescript
import { Cache } from "node-cache";

const llmCache = new Cache({ 
  stdTTL: 3600,  // 1 小时过期
  checkperiod: 300,
});

async function cachedLLM(state, config) {
  const promptKey = hashMessages(state.messages);
  
  // 检查缓存
  const cached = llmCache.get(promptKey);
  if (cached) {
    return cached;
  }
  
  // 调用 LLM
  const response = await llm.invoke(state.messages);
  
  // 缓存结果
  llmCache.set(promptKey, response);
  
  return response;
}
```

### 代码执行缓存

```typescript
const computationCache = new Map();

async function cachedComputation(state) {
  const cacheKey = JSON.stringify(state.input);
  
  if (computationCache.has(cacheKey)) {
    return computationCache.get(cacheKey);
  }
  
  const result = await expensiveComputation(state.input);
  computationCache.set(cacheKey, result);
  
  return result;
}
```

### 多级缓存策略

```typescript
class MultiLevelCache {
  private l1: Map;     // 内存缓存（快速）
  private l2: Redis;   // 分布式缓存
  
  constructor() {
    this.l1 = new Map();
  }
  
  async get(key: string): Promise<any> {
    // L1 缓存
    if (this.l1.has(key)) {
      return this.l1.get(key);
    }
    
    // L2 缓存
    const l2Value = await this.l2.get(key);
    if (l2Value) {
      this.l1.set(key, l2Value);  // 回填 L1
      return l2Value;
    }
    
    return null;
  }
  
  async set(key: string, value: any, ttl?: number): Promise<void> {
    this.l1.set(key, value);
    await this.l2.set(key, value, { EX: ttl || 3600 });
  }
}
```

## 内存优化

### 状态修剪

```typescript
// 限制消息历史长度
const MAX_MESSAGES = 50;

async function managedMessageNode(state) {
  const truncatedMessages = state.messages.slice(-MAX_MESSAGES);
  
  const response = await llm.invoke(truncatedMessages);
  
  return {
    messages: [...truncatedMessages, response],
  };
}

// 或使用摘要压缩
async function summarizeOldMessages(state) {
  if (state.messages.length <= 20) {
    return { messages: state.messages };
  }
  
  // 将早期消息压缩为摘要
  const earlyMessages = state.messages.slice(0, -10);
  const recentMessages = state.messages.slice(-10);
  
  const summary = await llm.invoke([
    { role: "system", content: "总结以下对话的核心内容：" },
    ...earlyMessages,
  ]);
  
  return {
    messages: [
      { role: "system", content: `摘要：${summary.content}` },
      ...recentMessages,
    ],
  };
}
```

### 流式处理大对象

```typescript
// 避免一次性加载大对象
async function streamProcessor(state) {
  const results = [];
  
  // 使用 Generator 逐步处理
  for await (const chunk of processStream(state.largeInput)) {
    results.push(chunk);
    
    // 定期刷新，避免内存积累
    if (results.length > 100) {
      yield { partialResults: results };
      results.length = 0;
    }
  }
  
  return { results };
}
```

## LLM 优化

### Token 效率优化

```typescript
// 精简提示词
const efficientePrompt = `
Role: Assistant
Task: Answer questions

Constraints:
- Be concise
- No preamble
`;

// 避免冗余
async function efficientNode(state) {
  // ❌ 冗余的消息历史
  // await llm.invoke([
  //   { role: "system", content: "You are a helpful assistant..." },
  //   { role: "user", content: userMessage },
  //   { role: "assistant", content: "Sure, I can help with that..." },
  //   { role: "user", content: "Actually..." },
  // ]);
  
  // ✅ 精简的提示
  const prompt = `${state.context}\n\nQ: ${state.question}`;
  return await llm.invoke([{ role: "user", content: prompt }]);
}
```

### 模型选择策略

```typescript
// 根据任务复杂度选择模型
async function smartModelSelection(state) {
  const complexity = await estimateComplexity(state.task);
  
  let model;
  if (complexity < 0.3) {
    model = new ChatOpenAI({ model: "gpt-3.5-turbo" });  // 快速便宜
  } else if (complexity < 0.7) {
    model = new ChatOpenAI({ model: "gpt-4o-mini" });  // 平衡
  } else {
    model = new ChatOpenAI({ model: "gpt-4o" });  // 最强
  }
  
  return await model.invoke(state.messages);
}
```

### 批量 LLM 调用

```typescript
// 批量发送多个问题
async function batchLLMCall(questions: string[]) {
  // 合并为单个 prompt
  const batchPrompt = questions.map((q, i) => 
    `${i + 1}. ${q}`
  ).join("\n");
  
  const response = await llm.invoke([{
    role: "user",
    content: `请依次回答以下问题，用分隔符分开：\n${batchPrompt}`,
  }]);
  
  // 解析结果
  return parseBatchResponse(response.content, questions.length);
}
```

## Checkpoint 优化

### 选择性保存

```typescript
// 只保存关键状态
import { MemorySaver } from "@langchain/langgraph-checkpoint-memory";

class SelectiveSaver extends MemorySaver {
  async put(config, checkpoint, metadata) {
    // 过滤掉不需要保存的数据
    const filteredValues = { ...checkpoint.channel_values };
    
    // 移除大对象
    delete filteredValues.largeCache;
    delete filteredValues.tempData;
    
    checkpoint.channel_values = filteredValues;
    
    return super.put(config, checkpoint, metadata);
  }
}
```

### 延迟保存

```typescript
// 批量更新 checkpoint，减少写入次数
class BatchSaver extends MemorySaver {
  private pendingWrites: Array<{ config, checkpoint, metadata }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  
  async put(config, checkpoint, metadata) {
    this.pendingWrites.push({ config, checkpoint, metadata });
    
    // 批量或定时刷新
    if (this.pendingWrites.length >= 10) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 1000);
    }
    
    // 立即返回，不等待实际保存
    return config;
  }
  
  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    for (const write of this.pendingWrites) {
      await super.put(write.config, write.checkpoint, write.metadata);
    }
    this.pendingWrites = [];
  }
}
```

## 监控与调优

### 性能监控

```typescript
class PerformanceMonitor {
  private metrics = {
    nodeExecutions: new Map(),
    llmCalls: 0,
    totalLatency: 0,
  };
  
  startTimer(nodeId: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      const existing = this.metrics.nodeExecutions.get(nodeId) || {
        count: 0, total: 0,
      };
      existing.count++;
      existing.total += duration;
      this.metrics.nodeExecutions.set(nodeId, existing);
    };
  }
  
  getReport(): string {
    const lines = ["=== Performance Report ==="];
    
    for (const [node, data] of this.metrics.nodeExecutions) {
      const avg = data.total / data.count;
      lines.push(`${node}: ${data.count} calls, avg ${avg.toFixed(0)}ms`);
    }
    
    lines.push(`LLM calls: ${this.metrics.llmCalls}`);
    lines.push(`Total latency: ${this.metrics.totalLatency}ms`);
    
    return lines.join("\n");
  }
}

// 使用
const monitor = new PerformanceMonitor();

async function monitoredNode(state) {
  const stopTimer = monitor.startTimer("my_node");
  
  try {
    return await process(state);
  } finally {
    stopTimer();
  }
}
```

### 瓶颈识别

```typescript
// 识别慢节点
async function identifyBottlenecks(
  graph: CompiledStateGraph,
  input: any,
  iterations: number = 10
) {
  const timings: Map = new Map();
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await graph.invoke(input);
    const duration = Date.now() - start;
    
    timings.set(i, duration);
  }
  
  // 统计分析
  const values = Array.from(timings.values());
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  return {
    average: avg.toFixed(0),
    min: min.toFixed(0),
    max: max.toFixed(0),
    variance: calculateVariance(values),
  };
}
```

## 最佳实践清单

### 1. 减少 LLM 调用

- ✅ 缓存重复的 LLM 响应
- ✅ 使用较小的模型处理简单任务
- ✅ 批量处理多个问题
- ✅ 精简 prompt，去除冗余

### 2. 并行化

- ✅ 独立任务使用 Send API 并行
- ✅ 并行调用多个 LLM
- ✅ 并发读取（而非写入）Checkpoints

### 3. 内存管理

- ✅ 限制消息历史长度
- ✅ 定期清理临时数据
- ✅ 使用流式处理大对象
- ✅ 避免状态中存储大型对象

### 4. Checkpoint 优化

- ✅ 只保存必要状态
- ✅ 批量保存操作
- ✅ 定期清理旧 checkpoints
- ✅ 选择合适存储后端

### 5. 模型选择

- ✅ 简单任务用快模型
- ✅ 复杂推理用强模型
- ✅ 使用模型路由策略
- ✅ 监控 token 消耗

## 性能基准示例

```typescript
// 简单基准测试
import { Benchmark } from "node-benchmark";

async function runBenchmarks() {
  const bench = new Benchmark();
  
  // 测试单线程执行
  bench.add("Sequential", async () => {
    await sequentialGraph.invoke(input);
  });
  
  // 测试并行执行
  bench.add("Parallel", async () => {
    await parallelGraph.invoke(input);
  });
  
  await bench.run();
  console.log(bench.toString());
}
```

## 总结

性能优化要点：

- 🎯 **测量优先**：先识别瓶颈再优化
- 🔄 **并行化**：无依赖任务并行执行
- 💾 **缓存**：减少重复计算
- 📉 **精简**：最小化 token 和状态
- 🧹 **清理**：定期清理旧数据

没有银弹，需要根据具体场景选择合适的优化策略。

## 参考资料

- [LangGraph 性能指南](https://langchain-ai.github.io/langgraphjs/how-tos/performance/)
- [Node.js 性能最佳实践](https://nodejs.org/en/docs/guides/)