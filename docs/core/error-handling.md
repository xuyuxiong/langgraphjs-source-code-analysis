# 错误处理 Error Handling

## 概述

错误处理是 LangGraphJS 图执行中不可或缺的部分。由于 AI Agent 执行涉及多个阶段、第三方 API 调用和外部依赖，错误处理变得至关重要。良好的错误处理策略可以：

- **优雅降级**：在部分失败时继续执行
- **可恢复错误**：支持重试和恢复
- **调试友好**：提供清晰的错误信息
- **用户友好**：提供有意义的错误提示

## 错误分类

LangGraphJS 中的错误可以分为以下几类：

### 1. 节点执行错误

```typescript
// 节点执行时抛出的错误
async function failingNode(state) {
  // 网络请求失败
  await fetch("https://api.example.com/data");  // 抛错
  
  // 数据处理错误
  const result = riskyOperation();  // 抛错
  
  // 资源不足
  const largeData = new Array(1000000000).fill("data");  // 内存溢出
}
```

### 2. 工具调用错误

```typescript
// ToolNode 执行错误
import { tool } from "@langchain/core/tools";

const riskyTool = tool(
  async ({ query }) => {
    // 工具执行失败
    const result = await externalAPI(query);  // 可能失败
    return result;
  },
  { name: "risky_tool", description: "A risky tool" }
);
```

### 3. Checkpoint 错误

```typescript
// Checkpoint 保存失败
try {
  await checkpointer.put(config, checkpoint, metadata, {});
} catch (error) {
  // 持久化失败，可能影响中断恢复
}
```

### 4. 中断错误

```typescript
// interrupt() 调用错误
import { interrupt, GraphInterrupt } from "@langchain/langgraph";

const value = interrupt({ type: "review" });
// 抛出 GraphInterrupt 错误用于正常中断流程
```

## LangGraphJS 内置错误类型

### 错误类层次

```typescript
// libs/langgraph-core/src/errors.ts

/**
 * Base class for all LangGraph errors
 */
export class LangGraphError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LangGraphError";
  }
}

/**
 * Graph 配置错误
 */
export class GraphConfigError extends LangGraphError {
  constructor(message: string) {
    super(message);
    this.name = "GraphConfigError";
  }
}

/**
 * 值错误 - 状态/输入/输出不正确
 */
export class GraphValueError extends LangGraphError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "GraphValueError";

    if (extra != null && typeof extra === "object") {
      Object.assign(this, extra);
    }
  }
}

/**
 * 中断错误 - 用于正常中断流程
 */
export class GraphInterrupt extends LangGraphError {
  constructor(
    public interrupts: Array<{ id?: string; value: unknown }>
  ) {
    super("Graph execution interrupted");
    this.name = "GraphInterrupt";
  }
}

/**
 * 超时错误
 */
export class GraphTimeoutError extends LangGraphError {
  constructor(message: string) {
    super(message);
    this.name = "GraphTimeoutError";
  }
}

/**
 * 循环错误 - 检测到无限循环
 */
export class GraphRecursionError extends LangGraphError {
  constructor(message: string) {
    super(message);
    this.name = "GraphRecursionError";
  }
}
```

## 错误处理策略

### 1. 节点级别的错误处理

```typescript
async function robustNode(state) {
  try {
    // 主要逻辑
    const result = await callExternalAPI(state.input);
    return { output: result };
  } catch (error) {
    // 错误处理
    if (error instanceof TypeError) {
      // 类型错误 - 返回默认值
      return { output: "default" };
    }
    
    if (error instanceof NetworkError) {
      // 网络错误 - 重试
      return await retryWithBackoff(state.input);
    }
    
    // 其他错误 - 抛出
    throw error;
  }
}
```

### 2. 重试机制

```typescript
// 指数退避重试
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      // 指数退避
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// 使用
async function nodeWithRetry(state) {
  const result = await retryWithBackoff(
    () => callUnreliableAPI(state.input)
  );
  return { output: result };
}
```

### 3. 超时处理

```typescript
// 节点执行超时
async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return await Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new GraphTimeoutError("Operation timed out")), timeoutMs)
    ),
  ]);
}

// 使用
async function timeoutNode(state) {
  const result = await withTimeout(
    () => callSlowAPI(state.input),
    30000  // 30 秒超时
  );
  return { output: result };
}
```

### 4. 熔断器模式

```typescript
class CircuitBreaker {
  private failures: number = 0;
  private lastFailure: number = -1;
  private state: "closed" | "open" | "half-open" = "closed";
  
  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeout: number = 60000,
    private readonly testRequestLimit: number = 1
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure < this.resetTimeout) {
        throw new Error("Circuit breaker is open");
      }
      this.state = "half-open";
    }
    
    try {
      const result = await fn();
      if (this.state === "half-open") {
        this.failures = 0;
        this.state = "closed";
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      
      if (this.failures >= this.failureThreshold) {
        this.state = "open";
      }
      
      throw error;
    }
  }
}

// 使用
const circuitBreaker = new CircuitBreaker();

async function nodeWithCircuitBreaker(state) {
  const result = await circuitBreaker.execute(
    () => callExternalAPI(state.input)
  );
  return { output: result };
}
```

## 图中错误处理

### 错误边路由

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
  input: Annotation<string>(),
  output: Annotation<string>({ default: () => "" }),
  error: Annotation<string>({ default: () => "" }),
  retries: Annotation<number>({ default: () => 0 }),
});

// 主处理节点
async function processNode(state) {
  try {
    const result = await riskyOperation(state.input);
    return { output: result };
  } catch (error) {
    // 记录错误但让决策节点处理
    return { error: error.message };
  }
}

// 决策路由
function processRoute(state) {
  if (state.error) {
    if (state.retries < 3) {
      return "retry";
    }
    return "error_handler";
  }
  return END;
}

// 重试节点
async function retryNode(state) {
  return {
    retries: state.retries + 1,
    error: "",  // 清除错误标记
  };
}

// 错误处理节点
async function errorNode(state) {
  console.error("Error:", state.error);
  return { output: "fallback_result" };
}

const graph = new StateGraph(StateAnnotation)
  .addNode("process", processNode)
  .addNode("retry", retryNode)
  .addNode("error_handler", errorNode)
  .addEdge(START, "process")
  .addConditionalEdges("process", processRoute, {
    "retry": "retry",
    "error_handler": "error_handler",
    [END]: END,
  })
  .addEdge("retry", "process")
  .compile();
```

### 全局错误处理

```typescript
const graph = workflow.compile({
  checkpointer,
});

// 全局错误处理
try {
  const result = await graph.invoke(input);
} catch (error) {
  if (error instanceof GraphInterrupt) {
    // 正常中断，不需要处理
    console.log("Graph interrupted, waiting for resume");
  } else if (error instanceof GraphRecursionError) {
    // 循环检测
    console.error("Recursion limit exceeded");
  } else if (error instanceof GraphTimeoutError) {
    // 超时错误
    console.error("Execution timed out");
  } else {
    // 未知错误
    console.error("Unexpected error:", error);
  }
}
```

## 工具错误处理

### ToolNode 错误

```typescript
import { ToolNode } from "@langchain/langgraph/prebuilt";

// 自定义 ToolNode 添加错误处理
class RobustToolNode extends ToolNode {
  async invoke(input, config) {
    try {
      return await super.invoke(input, config);
    } catch (error) {
      // 记录错误
      console.error("ToolNode error:", error);
      
      // 返回错误消息而不是抛出
      return [
        new ToolMessage({
          content: `Tool execution failed: ${error.message}`,
          tool_call_id: this.getToolCallId(input),
          status: "error",
        })
      ];
    }
  }
  
  private getToolCallId(input): string {
    // 从输入中提取 tool_call_id
    const messages = Array.isArray(input) ? input : [input];
    const lastMessage = messages[messages.length - 1];
    return lastMessage.tool_calls?.[0]?.id || "unknown";
  }
}
```

### 工具定义中的错误处理

```typescript
const safeTool = tool(
  async ({ input }) => {
    try {
      return await riskyOperation(input);
    } catch (error) {
      // 在工具内部处理错误
      return `Error: ${error.message}. Suggestion: Try again later.`;
    }
  },
  {
    name: "safe_tool",
    description: "A tool with error handling",
  }
);
```

## 恢复策略

### 1. 从 Checkpoint 恢复

```typescript
// 执行失败后从上一个 checkpoint 恢复
const config = { configurable: { thread_id: "my-thread" } };

try {
  await graph.invoke(input, config);
} catch (error) {
  // 获取上一个成功状态
  const lastCheckpoint = await graph.checkpointer.getTuple(config);
  
  if (lastCheckpoint) {
    // 从错误中恢复
    const_recovery_input = modifyInput(lastCheckpoint.checkpoint.channel_values);
    await graph.invoke(recovery_input, config);
  }
}
```

### 2. 手动恢复

```typescript
// 手动恢复到特定状态
async function recoverToCheckpoint(
  graph: CompiledStateGraph,
  config: RunnableConfig,
  checkpointId: string
) {
  // 获取 checkpoint
  const checkpoint = await graph.checkpointer.getTuple({
    ...config,
    configurable: { ...config.configurable, checkpoint_id: checkpointId },
  });
  
  if (!checkpoint) {
    throw new Error("Checkpoint not found");
  }
  
  // 从 checkpoint 继续执行
  return await graph.invoke(null, {
    ...config,
    configurable: { ...config.configurable, checkpoint_id: checkpointId },
  });
}
```

## 调试技巧

### 1. 详细日志

```typescript
// 启用详细日志
const config = {
  callbacks: [
    {
      handleStart(name, input) {
        console.log(`Starting: ${name}`, input);
      },
      handleEnd(name, output) {
        console.log(`Completed: ${name}`, output);
      },
      handleError(name, error) {
        console.error(`Error in ${name}:`, error);
      },
    },
  ],
};

await graph.invoke(input, config);
```

### 2. 使用 LangSmith 调试

```typescript
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

const config = {
  callbacks: [
    new LangChainTracer({
      projectName: "my-project",
      // 捕获所有错误
      exampleId: runId,
    }),
  ],
};

await graph.invoke(input, config);

// 在 LangSmith 查看详细的错误堆栈
```

### 3. 错误报告

```typescript
interface ErrorReport {
  nodeId: string;
  error: Error;
  state: Record<string, any>;
  timestamp: string;
  traceId: string;
}

class ErrorReporter {
  private reports: ErrorReport[] = [];
  
  report(nodeId: string, error: Error, state: Record<string, any>): void {
    this.reports.push({
      nodeId,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      state: this.sanitizeState(state),
      timestamp: new Date().toISOString(),
      traceId: generateTraceId(),
    });
  }
  
  private sanitizeState(state): Record<string, any> {
    // 移除敏感数据
    const sanitized = { ...state };
    delete sanitized.apiKey;
    delete sanitized.password;
    return sanitized;
  }
  
  getReports(): ErrorReport[] {
    return [...this.reports];
  }
}

// 使用
const reporter = new ErrorReporter();

async function nodeWithErrorHandling(state) {
  try {
    return await process(state);
  } catch (error) {
    reporter.report("process_node", error, state);
    throw error;  // 重新抛出以便全局处理
  }
}
```

## 最佳实践

### 1. 明确的错误边界

```typescript
// ✅ 好的错误边界
async function node(state) {
  // 只处理预期的错误
  if (!state.input) {
    throw new GraphValueError("Input is required");
  }
  
  try {
    return await riskyOperation(state.input);
  } catch (error) {
    // 转换为有意义的错误
    throw new GraphValueError(`Processing failed: ${error.message}`);
  }
}
```

### 2. 自定义错误类型

```typescript
class APIError extends GraphValueError {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = "APIError";
  }
}

// 使用
async function apiNode(state) {
  const response = await fetch("https://api.example.com/data");
  
  if (!response.ok) {
    const body = await response.text();
    throw new APIError(
      `API returned ${response.status}`,
      response.status,
      body
    );
  }
  
  return await response.json();
}
```

### 3. 错误分级处理

```typescript
// 分级错误
enum ErrorSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

async function processWithSeverity(state) {
  try {
    return await process(state.input);
  } catch (error) {
    const severity = determineSeverity(error);
    
    switch (severity) {
      case ErrorSeverity.INFO:
        // 记录但继续
        console.info("Info:", error);
        return { warnings: [error.message] };
        
      case ErrorSeverity.WARNING:
        // 记录并部分恢复
        console.warn("Warning:", error);
        return { partial_result: "fallback" };
        
      case ErrorSeverity.ERROR:
        // 停止当前节点但允许恢复
        throw error;
        
      case ErrorSeverity.CRITICAL:
        // 立即停止整个图
        throw new GraphValueError(`Critical error: ${error.message}`);
    }
  }
}
```

### 4. 资源清理

```typescript
async function nodeWithCleanup(state) {
  const resource = acquireResource();
  
  try {
    return await useResource(resource, state.input);
  } catch (error) {
    throw error;
  } finally {
    // 始终清理资源
    releaseResource(resource);
  }
}
```

## 常见问题 FAQ

### Q1: 错误应该在节点内还是全局处理？

**A**: 推荐分层处理：
- 节点内处理可恢复的错误
- 全局处理未知/严重错误

### Q2: 如何区分正常中断和错误？

**A**: `GraphInterrupt` 不是错误，是正常控制流。检查错误类型：

```typescript
if (error instanceof GraphInterrupt) {
  // 正常中断，不需要错误处理
} else if (error instanceof Error) {
  // 真正的错误
}
```

### Q3: 错误会影响 Checkpoint 吗？

**A**: 错误通常不会保存到 checkpoint。如果需要在错误后恢复，应该在错误前手动保存状态。

### Q4: 如何测试错误处理？

**A**: 
```typescript
test("should handle timeout error", async () => {
  const mockFn = jest.fn().mockRejectedValue(
    new GraphTimeoutError("Timeout")
  );
  
  await expect(node(mockState)).rejects.toThrow(GraphTimeoutError);
});
```

### Q5: 无限循环如何检测？

**A**: LangGraph 有内置的循环检测：

```typescript
const graph = workflow.compile({
  checkpointer,
  // 配置最大递归深度
  recursionLimit: 100,
});
// 超过限制会抛出 GraphRecursionError
```

## 总结

错误处理是构建健壮 AI Agent 的关键：

- ✅ **明确的错误类型**：使用自定义错误类
- ✅ **分层处理**：节点级 + 全局级
- ✅ **恢复策略**：重试、回退、checkpoint 恢复
- ✅ **调试支持**：良好的日志和追踪
- ✅ **用户友好**：有意义的错误信息

良好的错误处理可以让你的图应用更加可靠和易于维护。

## 参考资料

- [LangGraphJS 源码 - Errors](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/errors.ts)
- [LangGraph 错误处理文档](https://langchain-ai.github.io/langgraphjs/how-tos/error-handling/)
- [开源 resilient 系统设计](https://github.com/resilience4j/resilience4j)