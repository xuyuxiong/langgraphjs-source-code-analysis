---
outline: deep
---

# ToolNode 工具执行节点

## 概述

`ToolNode` 是 LangGraphJS 中用于执行工具调用的核心节点组件。在 ReAct（Reasoning + Acting）模式的 Agent 中，当大语言模型决定调用工具时，`ToolNode` 负责接收模型的工具调用请求，执行相应的工具函数，并将结果返回给图的状态。

ToolNode 是 LangGraphJS 预构建（prebuilt）组件之一，位于 `@langchain/langgraph/prebuilt`包中。它与`createReactAgent` 等高级 API 紧密配合，构成了完整的 Agent 执行循环。

## ToolNode 的核心概念

### 什么是 ToolNode

`ToolNode`是一个`Runnable` 对象，它可以：

1. **接收工具调用**：从 LLM 的输出中提取工具调用信息
2. **并行执行工具**：同时执行多个工具调用，提高效率
3. **处理工具结果**：将工具执行结果转换为标准的 ToolMessage 格式
4. **错误处理**：优雅地处理工具执行过程中的异常

### ToolNode 在 Agent 循环中的位置

在一个典型的 ReAct Agent 中，执行流程如下：

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   START     │ -> │   Agent     │ -> │  ToolNode   │
│             │    │  (LLM)      │    │             │
└─────────────┘    └─────────────┘    └─────────────┘
                        ^                   |
                        |                   |
                        +-------------------+
```

1. **Agent 节点**：LLM 接收当前状态，决定是否需要调用工具
2. **ToolNode 节点**：执行 LLM 请求的工具调用
3. **循环**：工具结果被添加到状态中，Agent 节点再次被调用

## 源码结构分析

### 文件位置

ToolNode 的源码位于：

```
libs/langgraph-core/src/prebuilt/tool_node.ts
```

### 核心代码实现

```typescript
import {
  Runnable,
  RunnableConfig,
  RunnableToolLike,
} from "@langchain/core/runnables";
import {
  AIMessage,
  BaseMessage,
  ToolMessage,
  isAIMessage,
} from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { LangGraphRunnableConfig } from "../pregel/runnable_types.js";

export class ToolNode<
  T extends BaseMessage[] | AIMessage
> extends Runnable<T, ToolMessage[]> {
  static lc_name() {
    return "ToolNode";
  }

  lc_namespace = ["langgraph", "prebuilt"];

  tools: (StructuredToolInterface | RunnableToolLike)[];

  constructor(tools: (StructuredToolInterface | RunnableToolLike)[]) {
    super();
    this.tools = tools;
  }

  async invoke(
    input: T,
    config?: RunnableConfig
  ): Promise<ToolMessage[]> {
    // 实现逻辑
  }
}
```

### ToolNode 的类结构

```typescript
export class ToolNode<
  T extends BaseMessage[] | AIMessage
> extends Runnable<T, ToolMessage[]> {
  // 工具列表
  tools: (StructuredToolInterface | RunnableToolLike)[];
  
  // 构造函数
  constructor(tools: (StructuredToolInterface | RunnableToolLike)[]);
  
  // 核心执行方法
  invoke(input: T, config?: RunnableConfig): Promise<ToolMessage[]>;
  
  // 批处理方法
  batch(inputs: T[], config?: RunnableConfig): Promise<ToolMessage[][]>;
}
```

## ToolNode 的工作原理

### 输入输出格式

**输入类型**：
- `BaseMessage[]`：消息数组（通常在 StateGraph 的状态中）
- `AIMessage`：单条 AI 消息（包含 tool_calls 字段）

**输出类型**：
- `ToolMessage[]`：工具执行结果数组

### 执行流程详解

#### 1. 输入消息处理

当 `ToolNode` 被调用时，首先需要处理输入：

```typescript
async invoke(
  input: T extends BaseMessage[] | AIMessage,
  config?: RunnableConfig
): Promise<ToolMessage[]> {
  // 如果输入是消息数组，获取最后一条消息
  const messages = Array.isArray(input) ? input : [input];
  const aiMessage = messages[messages.length - 1];
  
  // 验证是否为 AIMessage
  if (!isAIMessage(aiMessage)) {
    throw new Error("ToolNode 需要 AIMessage 包含 tool_calls");
  }
  
  // 继续处理 tool_calls...
}
```

#### 2. 提取工具调用

从 AI 消息中提取工具调用信息：

```typescript
const toolCalls = aiMessage.tool_calls ?? [];

if (toolCalls.length === 0) {
  // 没有工具调用，返回空数组
  return [];
}
```

每个 `tool_call` 包含以下结构：

```typescript
interface ToolCall {
  id: string;           // 工具调用的唯一标识
  name: string;         // 工具名称
  args: Record<string, any>;  // 工具参数
}
```

#### 3. 查找并执行工具

根据工具名称查找对应的工具函数并执行：

```typescript
const toolMap = new Map(
  this.tools.map((tool) => [tool.name, tool])
);

// 执行每个工具调用
const results = await Promise.all(
  toolCalls.map(async (toolCall) => {
    const tool = toolMap.get(toolCall.name);
    
    if (!tool) {
      // 工具不存在
      return {
        tool_call_id: toolCall.id,
        content: `Error: Tool "${toolCall.name}" not found.`,
        status: "error",
      };
    }
    
    try {
      // 执行工具
      const result = await tool.invoke(toolCall.args, config);
      return {
        tool_call_id: toolCall.id,
        content: result,
        status: "success",
      };
    } catch (error) {
      // 工具执行出错
      return {
        tool_call_id: toolCall.id,
        content: `Error: ${error.message}`,
        status: "error",
      };
    }
  })
);
```

#### 4. 处理工具结果

将执行结果转换为 `ToolMessage` 格式：

```typescript
import { ToolMessage } from "@langchain/core/messages";

const toolMessages = results.map((result) => {
  return new ToolMessage({
    content: result.content,
    tool_call_id: result.tool_call_id,
    name: result.name,
    // 其他元数据...
  });
});

return toolMessages;
```

## ToolNode 的高级特性

### 并行执行优化

ToolNode 默认使用 `Promise.all()` 并行执行所有工具调用，这可以显著提高效率：

```typescript
// 并行执行多个工具调用
const results = await Promise.all(
  toolCalls.map((toolCall) => executeTool(toolCall))
);
```

**优势**：
- 多个独立的工具调用可以同时执行
- 减少总体等待时间
- 特别适合 I/O 密集型操作（如 API 调用、数据库查询）

**注意事项**：
- 并行执行可能会触发速率限制
- 需要考虑并发连接数限制
- 某些工具可能有执行顺序依赖

### 错误处理机制

ToolNode 提供了多层错误处理：

```typescript
try {
  const result = await tool.invoke(args, config);
  return new ToolMessage({
    content: result,
    tool_call_id: call.id,
    name: tool.name,
  });
} catch (error) {
  // 错误处理
  return new ToolMessage({
    content: `Error: ${error.message}`,
    tool_call_id: call.id,
    name: tool.name,
    status: "error",
  });
}
```

**错误类型**：

| 错误类型 | 描述 | 处理方式 |
|---------|------|---------|
| ToolNotFound | 请求的工具不存在 | 返回错误消息 |
| ToolExecutionError | 工具执行异常 | 捕获并返回错误详情 |
| Validation error | 参数验证失败 | 返回验证错误信息 |
| Timeout | 工具执行超时 | 根据配置处理 |

### ToolMessage 结构

`ToolMessage` 是 LangChain 中用于表示工具执行结果的标准格式：

```typescript
interface ToolMessage {
  content: string | BaseMessageContent;  // 工具执行结果
  tool_call_id: string;                   // 对应工具调用的 ID
  name?: string;                          // 工具名称
  status?: "success" | "error";           // 执行状态
  additional_kwargs?: Record<string, any>; // 额外元数据
}
```

## 使用 ToolNode 的几种方式

### 方式一：在 createReactAgent 中自动使用

最常见的方式是通过 `createReactAgent` 自动创建和使用 ToolNode：

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// 定义工具
const getWeather = tool(
  (input) => {
    if (["sf", "san francisco"].includes(input.location.toLowerCase())) {
      return "It's 60 degrees and foggy.";
    }
    return "It's 90 degrees and sunny.";
  },
  {
    name: "get_weather",
    description: "获取指定位置的天气信息",
    schema: z.object({
      location: z.string().describe("位置名称"),
    }),
  }
);

const getStockPrice = tool(
  (input) => {
    return `${input.symbol}: $${(Math.random() * 100).toFixed(2)}`;
  },
  {
    name: "get_stock_price",
    description: "获取股票价格",
    schema: z.object({
      symbol: z.string().describe("股票代码"),
    }),
  }
);

// 创建 Agent，ToolNode 会自动创建
const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [getWeather, getStockPrice],
});

// 运行 Agent
const result = await agent.invoke({
  messages: [{ role: "user", content: "What's the weather in SF?" }]
});
```

### 方式二：手动创建 ToolNode 并在 StateGraph 中使用

对于更复杂的场景，可以手动创建 ToolNode 并在自定义 StateGraph 中使用：

```typescript
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { MessagesAnnotation } from "@langchain/langgraph";

// 创建 ToolNode
const toolNode = new ToolNode([getWeather, getStockPrice]);

// 定义状态
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

// 创建图
const workflow = new StateGraph(AgentState)
  .addNode("agent", agentNode)  // LLM 节点
  .addNode("tools", toolNode)   // ToolNode
  .addEdge("agent", "tools")    // agent -> tools
  .addEdge("tools", "agent")    // tools -> agent（循环）
  .compile();
```

### 方式三：在条件边中使用 ToolNode

根据工具调用结果动态决定下一步：

```typescript
const shouldReturnDirect = new Set(
  tools
    .filter((tool) => tool.returnDirect)
    .map((tool) => tool.name)
);

function routeAfterTool(state) {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  
  // 检查是否有工具配置为直接返回
  if (lastMessage.name && shouldReturnDirect.has(lastMessage.name)) {
    return END;  // 直接结束
  }
  
  return "agent";  // 继续调用 LLM
}

const workflow = new StateGraph(AgentState)
  .addNode("tools", toolNode)
  .addNode("agent", agentNode)
  .addConditionalEdges("tools", routeAfterTool)
  .compile();
```

## ToolNode 的配置选项

### tools 参数

`tools` 是 ToolNode 构造函数的唯一参数，接受以下类型：

```typescript
tools: (StructuredToolInterface | RunnableToolLike)[]
```

**StructuredToolInterface**：

结构化定义的完整工具对象，包含名称、描述、参数 schema 和执行函数。

```typescript
const tool: StructuredToolInterface = {
  name: "get_weather",
  description: "获取天气信息",
  schema: z.object({ /* ... */ }),
  invoke: async (input, config) => { /* ... */ },
};
```

**RunnableToolLike**：

任何符合 LangChain Runnable 接口的工具，包括：

- `@langchain/core/tools` 中的工具
- 通过 `tool()` 函数创建的工具
- 自定义实现的 Runnable

### configure 方法

可以通过 `config` 参数传递额外配置：

```typescript
const config = {
  runName: "weather_tool_execution",
  callbacks: [customHandler],
  metadata: { userId: "123" },
  tags: ["weather", "external-api"],
};

const result = await toolNode.invoke(input, config);
```

## ToolNode 与 createReactAgent 的关系

### createReactAgent 内部如何使用 ToolNode

在 `createReactAgent` 函数中，ToolNode 是这样被创建和使用的：

```typescript
export function createReactAgent(params: CreateReactAgentParams) {
  const { llm, tools, checkpointSaver, interruptBefore, interruptAfter } = params;
  
  let toolClasses: (ClientTool | ServerTool)[];
  let toolNode: ToolNode;
  
  // 如果传入的是 ToolNode，直接使用；否则创建新的
  if (!Array.isArray(tools)) {
    toolClasses = tools.tools;
    toolNode = tools;
  } else {
    toolClasses = tools;
    toolNode = new ToolNode(toolClasses.filter(isClientTool));
  }
  
  // 创建 StateGraph
  const workflow = new StateGraph(schema)
    .addNode("tools", toolNode)
    .addNode("agent", callModel)
    // 添加边和条件逻辑
    .compile({ checkpointer, interruptBefore, interruptAfter });
  
  return workflow;
}
```

### ToolNode 版本差异

`createReactAgent` 支持两种 ToolNode 使用模式：

**v1 版本**（默认）：
- ToolNode 处理所有工具调用
- 单次执行所有 tool_calls

**v2 版本**：
- 使用 Send API 将每个工具调用分发到独立的 ToolNode 实例
- 支持更细粒度的并行控制
- 更好的错误隔离

```typescript
// v2 版本的边定义
if (version === "v2") {
  return lastMessage.tool_calls.map(
    (toolCall) =>
      new Send("tools", { ...state, lg_tool_call: toolCall })
  );
}
```

## 实践示例

### 示例 1：基础天气查询 Agent

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

// 定义天气工具
const getWeather = tool(
  async ({ location }) => {
    // 模拟天气 API 调用
    const weatherData = {
      "san francisco": { temp: 60, condition: "foggy" },
      "new york": { temp: 75, condition: "sunny" },
      "london": { temp: 55, condition: "rainy" },
    };
    const data = weatherData[location.toLowerCase()] || { temp: 70, condition: "unknown" };
    return `The weather in ${location} is ${data.condition} with ${data.temp}°F.`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a location",
    schema: z.object({
      location: z.string().describe("The city name, e.g., San Francisco"),
    }),
  }
);

// 创建 Agent
const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [getWeather],
});

// 使用示例
const inputs = {
  messages: [
    { role: "user", content: "What's the weather in San Francisco?" }
  ],
};

const stream = await agent.stream(inputs, { streamMode: "values" });

for await (const { messages } of stream) {
  const lastMessage = messages[messages.length - 1];
  console.log(lastMessage);
}
```

### 示例 2：多工具协作

```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

// 多个工具定义
const getWeather = tool(
  (input) => { /* ... */ },
  { name: "get_weather", description: "Get weather", schema: z.object({ location: z.string() }) }
);

const getStockPrice = tool(
  (input) => { /* ... */ },
  { name: "get_stock_price", description: "Get stock price", schema: z.object({ symbol: z.string() }) }
);

const getNews = tool(
  (input) => { /* ... */ },
  { name: "get_news", description: "Get news headlines", schema: z.object({ topic: z.string() }) }
);

// 创建具有多个工具的 Agent
const agent = createReactAgent({
  llm: new ChatAnthropic({ model: "claude-3-sonnet-20240229" }),
  tools: [getWeather, getStockPrice, getNews],
});

const result = await agent.invoke({
  messages: [{
    role: "user",
    content: "Get the weather in SF, stock price for AAPL, and news about AI"
  }],
});

// Agent 会并行执行所有三个工具调用
```

### 示例 3：自定义 ToolNode 错误处理

```typescript
import { ToolNode } from "@langchain/langgraph/prebuilt";

// 创建自定义 ToolNode，添加额外的错误处理逻辑
class CustomToolNode extends ToolNode {
  async invoke(input, config) {
    const messages = Array.isArray(input) ? input : [input];
    const aiMessage = messages[messages.length - 1];
    
    // 前置验证
    if (!aiMessage?.tool_calls?.length) {
      console.warn("No tool calls found in the message");
      return [];
    }
    
    // 执行标准 ToolNode 逻辑
    const results = await super.invoke(input, config);
    
    // 后置处理
    for (const result of results) {
      if (result.status === "error") {
        console.error(`Tool ${result.name} failed: ${result.content}`);
        // 可以添加重试逻辑或其他处理
      }
    }
    
    return results;
  }
}

// 使用自定义 ToolNode
const customToolNode = new CustomToolNode([getWeather, getStockPrice]);
```

## 最佳实践

### 1. 工具设计原则

**单一职责**：
每个工具应该只负责一个明确的功能。

```typescript
// ❌ 不好的设计：一个工具做太多事情
const doEverything = tool(
  (input) => {
    if (input.type === "weather") { /* ... */ }
    if (input.type === "stock") { /* ... */ }
    if (input.type === "news") { /* ... */ }
  },
  { name: "do_everything", ... }
);

// ✅ 好的设计：职责分离
const getWeather = tool(/* ... */);
const getStockPrice = tool(/* ... */);
const getNews = tool(/* ... */);
```

**清晰的描述**：
工具描述应该清晰说明用途、参数和返回值。

```typescript
// ❌ 模糊的描述
{ name: "getData", description: "Gets data" }

// ✅ 清晰的描述
{ name: "get_weather", description: "获取指定城市当前的天气状况，包括温度、湿度和天气状况" }
```

### 2. 性能优化

**并行执行**：
利用 ToolNode 的并行执行能力，但注意不要过度并行。

```typescript
// 对于独立的工具调用，ToolNode 会自动并行执行
// 不需要额外代码
```

**缓存结果**：
对于重复的工具调用，可以考虑结果缓存。

```typescript
const cache = new Map<string, any>();

const getCachedWeather = tool(
  async ({ location }) => {
    const cacheKey = `weather:${location}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    const result = await fetchWeather(location);
    cache.set(cacheKey, result);
    return result;
  },
  { name: "get_weather", ... }
);
```

### 3. 错误处理

**优雅的错误处理**：
工具应该捕获并处理可能的错误，返回有意义的错误信息。

```typescript
const searchWeb = tool(
  async ({ query }) => {
    try {
      const response = await fetch(`https://api.example.com/search?q=${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      return `搜索失败：${error.message}。请尝试简化查询条件。`;
    }
  },
  { name: "search_web", ... }
);
```

## 调试 ToolNode

### 启用详细日志

```typescript
const config = {
  callbacks: [
    {
      handleToolStart(tool, input, runId) {
        console.log(`Tool ${tool} starting with input:`, input);
      },
      handleToolEnd(output, runId) {
        console.log(`Tool completed with output:`, output);
      },
      handleToolError(error, runId) {
        console.error(`Tool error:`, error);
      },
    },
  ],
};

await agent.invoke(inputs, config);
```

### 使用 LangSmith 追踪

```typescript
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

const config = {
  callbacks: [
    new LangChainTracer({
      projectName: "tool-node-debug",
    }),
  ],
};
```

## 常见问题 FAQ

### Q1: ToolNode 支持流式输出吗？

**A**: ToolNode 本身不直接支持流式输出，工具执行是完整完成后返回结果。但可以在整个 Agent 执行流程中使用流式模式：

```typescript
const stream = await agent.stream(inputs, {
  streamMode: ["values", "messages", "debug"],
});

for await (const chunk of stream) {
  console.log(chunk);
}
```

### Q2: 如何处理需要认证的工具？

**A**: 通过工具闭包传递认证信息：

```typescript
function createAuthenticatedTool(apiKey: string) {
  return tool(
    async ({ query }) => {
      const response = await fetch("https://api.example.com/data", {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });
      return response.text();
    },
    { name: "search_data", ... }
  );
}
```

### Q3: ToolNode 可以处理嵌套的工具调用吗？

**A**: 可以，但需要通过多轮 Agent 循环来实现。一次 Agent 循环只执行一层工具调用，工具结果返回后，LLM 可以根据结果决定是否调用其他工具。

### Q4: 如何限制工具执行时间？

**A**: 在工具内部实现超时逻辑：

```typescript
const timeoutTool = tool(
  async ({ query }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response.text();
    } catch (error) {
      if (error.name === "AbortError") {
        return "请求超时，请稍后重试";
      }
      throw error;
    }
  },
  { name: "search", ... }
);
```

## 总结

ToolNode 是 LangGraphJS 中执行工具调用的核心组件，它提供了：

- ✅ 简洁的 API 接口
- ✅ 自动并行执行
- ✅ 完善的错误处理
- ✅ 与 createReactAgent 的无缝集成
- ✅ 灵活的自定义扩展能力

理解 ToolNode 的工作原理对于构建高效的 Agent 系统至关重要。通过合理使用 ToolNode，可以实现复杂的工具调用逻辑，同时保持代码的清晰和可维护性。

## 参考资料

- [LangGraphJS 源码 - ToolNode](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/prebuilt/tool_node.ts)
- [LangChain Tools 文档](https://js.langchain.com/docs/modules/tools/)
- [LangGraph 预构建组件文档](https://langchain-ai.github.io/langgraphjs/reference/prebuilt/)