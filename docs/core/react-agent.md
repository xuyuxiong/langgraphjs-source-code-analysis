# createReactAgent - 预构建 ReAct Agent

## 概述

`createReactAgent` 是 LangGraphJS 提供的预构建 Agent 实现，基于经典的 **ReAct（Reasoning + Acting）** 模式。它自动处理工具调用、消息历史和循环执行，是构建 AI Agent 最快捷的方式。

ReAct 模式的核心思想是：
1. **思考（Reasoning）**：LLM 分析当前状态，决定采取什么行动
2. **行动（Acting）**：执行工具调用获取信息
3. **观察（Observation）**：将工具返回结果反馈给 LLM
4. **循环**：重复上述过程直到问题解决

## 源码结构

`createReactAgent` 的实现位于 `libs/langgraph-core/src/prebuilt/react_agent_executor.ts`，主要包含：

```typescript
// 核心导出
export function createReactAgent<...>(params: CreateReactAgentParams): CompiledStateGraph<...>

// 相关类型
export interface CreateReactAgentParams {
  llm: LanguageModelLike;
  tools: (ClientTool | ServerTool)[];
  stateSchema?: AnnotationRoot<SD>;
  stateModifier?: StateModifier;
  messageModifier?: MessageModifier;
  prompt?: Prompt;
  responseFormat?: "auto" | "force Tool Use" | StructuredResponseFormat;
  checkpointSaver?: BaseCheckpointSaver;
  interruptBefore?: N[] | All;
  interruptAfter?: N[] | All;
  name?: string;
}
```

## 内部架构

### 状态定义

`createReactAgent` 使用 `MessagesAnnotation` 作为默认状态：

```typescript
const MessagesAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});
```

`messagesStateReducer` 是一个专门的消息合并函数：

```typescript
export function messagesStateReducer(
  left: BaseMessage[],
  right: BaseMessage | BaseMessage[]
): BaseMessage[] {
  // 1. 标准化为数组
  const rightArray = Array.isArray(right) ? right : [right];
  
  // 2. 合并消息
  const merged = [...left, ...rightArray];
  
  // 3. 去重（基于消息 ID）
  const seen = new Set<string>();
  const deduped: BaseMessage[] = [];
  for (const msg of merged) {
    if (msg.id && !seen.has(msg.id)) {
      seen.add(msg.id);
      deduped.push(msg);
    } else if (!msg.id) {
      deduped.push(msg);
    }
  }
  
  return deduped;
}
```

### 节点定义

内部创建两个核心节点：

```typescript
// 1. Agent 节点 - 调用 LLM
async function callModel(state: typeof MessagesAnnotation.State, config: LangGraphRunnableConfig) {
  // 获取系统提示
  const systemMessage = await getSystemMessage(state, config);
  
  // 构建完整消息历史
  const messages = [systemMessage, ...state.messages].filter(Boolean);
  
  // 调用 LLM（已绑定工具）
  const response = await modelWithTools.invoke(messages, config);
  
  return { messages: [response] };
}

// 2. ToolNode - 执行工具调用
const toolNode = new ToolNode(tools);
```

### 条件路由

```typescript
function shouldContinue(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  
  // 检查是否有工具调用
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls)) {
    return "tools";
  }
  
  // 没有工具调用，结束
  return END;
}
```

### 图构建

```typescript
function createReactAgent(params) {
  const { llm, tools, stateSchema, ...options } = params;
  
  // 1. 确保 LLM 已绑定工具
  const modelWithTools = _ensureToolBindings(llm, tools);
  
  // 2. 创建状态图
  const builder = new StateGraph(stateSchema ?? MessagesAnnotation);
  
  // 3. 添加节点
  builder.addNode("agent", callModel);
  builder.addNode("tools", toolNode);
  
  // 4. 添加边
  builder.addEdge(START, "agent");
  builder.addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    [END]: END,
  });
  builder.addEdge("tools", "agent");
  
  // 5. 编译
  return builder.compile({
    checkpointer: options.checkpointSaver,
    interruptBefore: options.interruptBefore,
    interruptAfter: options.interruptAfter,
    name: options.name,
  });
}
```

## 使用方式

### 基础用法

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";

// 定义工具
const getWeather = tool((input) => {
  const weatherData = {
    "sf": "60°F, foggy",
    "nyc": "72°F, sunny",
    "london": "55°F, rainy",
  };
  return weatherData[input.location.toLowerCase()] || "Unknown location";
}, {
  name: "get_weather",
  description: "Get the current weather for a location",
  schema: z.object({
    location: z.string().describe("City name"),
  }),
});

const getStockPrice = tool((input) => {
  const prices = { "AAPL": 150, "GOOGL": 2800, "MSFT": 300 };
  return `$${prices[input.symbol] || 0}`;
}, {
  name: "get_stock_price",
  description: "Get the current stock price",
  schema: z.object({
    symbol: z.string().describe("Stock symbol"),
  }),
});

// 创建 LLM
const model = new ChatAnthropic({
  model: "claude-3-haiku-20240307",
  temperature: 0,
});

// 创建 Agent
const agent = createReactAgent({
  llm: model,
  tools: [getWeather, getStockPrice],
});

// 运行 Agent
const result = await agent.invoke({
  messages: [{
    role: "user",
    content: "What's the weather in San Francisco and the stock price of Apple?",
  }],
});

console.log(result.messages);
```

### 带检查点的持久化

```typescript
import { MemorySaver } from "@langchain/langgraph-checkpoint";

const memory = new MemorySaver();

const agent = createReactAgent({
  llm: model,
  tools: [getWeather],
  checkpointSaver: memory,
});

// 第一次调用
const config = { configurable: { thread_id: "conversation-1" } };
const result1 = await agent.invoke({
  messages: [{ role: "user", content: "What's the weather in SF?" }],
}, config);

// 后续调用会保留历史
const result2 = await agent.invoke({
  messages: [{ role: "user", content: "What about NYC?" }],
}, config);
```

### 带中断的人工审核

```typescript
const agent = createReactAgent({
  llm: model,
  tools: [executeTrade], // 高风险操作
  checkpointSaver: memory,
  interruptBefore: ["tools"], // 在执行工具前中断
});

// 第一次执行，会在 tools 节点前中断
const stream1 = await agent.stream({
  messages: [{ role: "user", content: "Buy 100 shares of AAPL" }],
}, config);

for await (const chunk of stream1) {
  console.log(chunk);
}
// 输出中断信息，等待人工审批

// 检查中断状态
const state = await agent.getState(config);
console.log(state.next); // ["tools"]
console.log(state.values.interrupt); // 中断信息

// 人工审核后恢复
const stream2 = await agent.stream(new Command({
  resume: { approved: true }, // 或者 resume: true
}), config);
```

### 自定义状态

```typescript
import { Annotation } from "@langchain/langgraph";

const CustomState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  userContext: Annotation<Record<string, any>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  stepCount: Annotation<number>({
    reducer: (a, b) => a + (b ?? 0),
    default: () => 0,
  }),
});

const agent = createReactAgent({
  llm: model,
  tools: [getWeather],
  stateSchema: CustomState,
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Hello" }],
  userContext: { userId: "123", preferences: { temp: "celsius" } },
  stepCount: 0,
});
```

### Prompt 定制

```typescript
// 方式 1: 字符串 prompt
const agent1 = createReactAgent({
  llm: model,
  tools: [getWeather],
  prompt: "You are a helpful weather assistant. Always be concise.",
});

// 方式 2: SystemMessage
const agent2 = createReactAgent({
  llm: model,
  tools: [getWeather],
  prompt: new SystemMessage("You are a helpful weather assistant."),
});

// 方式 3: 函数式 prompt（动态系统提示）
const agent3 = createReactAgent({
  llm: model,
  tools: [getWeather],
  prompt: async (state) => {
    const { messages, userContext } = state;
    const systemPrompt = `You are helpful for user ${userContext.userId}.`;
    return [new SystemMessage(systemPrompt), ...messages];
  },
});

// 方式 4: Runnable prompt
const promptChain = RunnableSequence.from([
  (state) => state.messages,
  async (messages) => {
    // 自定义处理
    return [new SystemMessage("Custom"), ...messages];
  },
]);

const agent4 = createReactAgent({
  llm: model,
  tools: [getWeather],
  prompt: promptChain,
});
```

### 结构化输出

```typescript
// 强制 Agent 返回结构化响应
const agent = createReactAgent({
  llm: model,
  tools: [getWeather],
  responseFormat: {
    schema: z.object({
      location: z.string(),
      temperature: z.number(),
      conditions: z.string(),
      recommendation: z.string(),
    }),
    prompt: "Extract the weather information in the specified format.",
  },
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "What's the weather in SF?" }],
});

// result 包含 structured_response 字段
console.log(result.structuredResponse);
// { location: "San Francisco", temperature: 60, conditions: "foggy", ... }
```

## 源码深度分析

### 工具绑定逻辑

`createReactAgent` 需要确保 LLM 已绑定工具：

```typescript
async function _shouldBindTools(llm, tools): Promise<boolean> {
  // 1. 如果是 RunnableSequence，找到内部的 BaseChatModel
  let model = llm;
  if (RunnableSequence.isRunnableSequence(model)) {
    model = model.steps.find(
      (step) => RunnableBinding.isRunnableBinding(step) || _isBaseChatModel(step)
    ) || model;
  }

  // 2. 如果是 ConfigurableModel，获取真实模型
  if (_isConfigurableModel(model)) {
    model = await model._model();
  }

  // 3. 检查是否已经绑定
  if (!RunnableBinding.isRunnableBinding(model)) {
    return true; // 需要绑定
  }

  // 4. 检查已绑定的工具
  const boundTools = model.kwargs?.tools || model.config?.tools;
  if (boundTools == null) return true;

  // 5. 验证工具数量匹配
  if (tools.length !== boundTools.length) {
    throw new Error("Tool count mismatch");
  }

  // 6. 验证工具名称匹配
  const toolNames = new Set(tools.map(t => t.name));
  const boundToolNames = new Set(boundTools.map(t => t.name));
  
  const missingTools = [...toolNames].filter(n => !boundToolNames.has(n));
  if (missingTools.length > 0) {
    throw new Error(`Missing tools: ${missingTools.join(", ")}`);
  }

  return false; // 不需要重新绑定
}

function _ensureToolBindings(llm, tools) {
  if (await _shouldBindTools(llm, tools)) {
    return llm.bindTools(tools);
  }
  return llm;
}
```

### 消息修饰器处理

支持多种消息修饰方式：

```typescript
function _convertMessageModifierToPrompt(messageModifier): Prompt {
  // 1. 字符串 -> SystemMessage
  if (typeof messageModifier === "string") {
    return new SystemMessage(messageModifier);
  }
  
  // 2. SystemMessage -> 直接使用
  if (isBaseMessage(messageModifier) && messageModifier._getType() === "system") {
    return messageModifier;
  }
  
  // 3. 函数 -> 包装为 RunnableLambda
  if (typeof messageModifier === "function") {
    return RunnableLambda.from(
      (state: typeof MessagesAnnotation.State) => messageModifier(state.messages)
    );
  }
  
  // 4. Runnable -> 直接使用
  if (Runnable.isRunnable(messageModifier)) {
    return messageModifier;
  }
  
  throw new Error(`Unexpected type: ${typeof messageModifier}`);
}

function _getPromptRunnable(prompt) {
  if (prompt == null) {
    // 默认：直接返回消息历史
    return RunnableLambda.from(
      (state) => state.messages
    ).withConfig({ runName: "prompt" });
  }
  
  if (typeof prompt === "string") {
    // 字符串：添加系统消息
    const systemMessage = new SystemMessage(prompt);
    return RunnableLambda.from(
      (state) => [systemMessage, ...state.messages]
    );
  }
  
  if (isBaseMessage(prompt) && prompt._getType() === "system") {
    // SystemMessage: 前置
    return RunnableLambda.from(
      (state) => [prompt, ...state.messages]
    );
  }
  
  if (typeof prompt === "function" || Runnable.isRunnable(prompt)) {
    // 函数或 Runnable: 直接使用
    return Runnable.isRunnable(prompt) ? prompt : RunnableLambda.from(prompt);
  }
  
  throw new Error(`Unexpected prompt type: ${typeof prompt}`);
}
```

### 响应格式处理

结构化响应的内部实现：

```typescript
async function _getStructuredResponseHandler(params) {
  const { llm, tools, responseFormat } = params;
  
  if (!responseFormat || responseFormat === "auto") {
    return null;
  }
  
  const { schema, prompt: formatPrompt, strict } = 
    typeof responseFormat === "object" ? responseFormat : { schema: responseFormat };
  
  // 创建结构化 LLM
  const structuredLlm = llm.withStructuredOutput(schema, {
    name: "structured_response",
    strict,
  });
  
  // 创建处理节点
  return async (state, config) => {
    const messages = state.messages;
    
    // 如果有格式化 prompt，添加到最后
    if (formatPrompt) {
      messages.push(new HumanMessage(formatPrompt));
    }
    
    // 调用结构化 LLM
    const response = await structuredLlm.invoke(messages, config);
    
    return { structuredResponse: response };
  };
}
```

## 调试技巧

### 查看详细日志

```typescript
import { setVerbose } from "@langchain/core/utils/env";
setVerbose(true);

const agent = createReactAgent({ llm: model, tools: [getWeather] });

const result = await agent.invoke({
  messages: [{ role: "user", content: "Weather in SF?" }],
}, {
  callbacks: [new ConsoleCallbackHandler()],
});
```

### 流式输出

```typescript
// 流式输出每个步骤
const stream = await agent.stream({
  messages: [{ role: "user", content: "Weather in SF?" }],
}, {
  streamMode: "values", // 或 "updates"
});

for await (const { messages } of stream) {
  console.log("Messages:", messages.length);
  console.log("Last:", messages[messages.length - 1].content);
}
```

### 检查中间状态

```typescript
const config = { configurable: { thread_id: "test" } };

// 执行一步
const result1 = await agent.invoke(..., config);
const state1 = await agent.getState(config);
console.log(state1.values);

// 执行另一步
const result2 = await agent.invoke(..., config);
const state2 = await agent.getState(config);
console.log(state2.values);
```

## 性能优化

### 工具缓存

```typescript
import { CachePolicy } from "@langchain/langgraph";

const agent = createReactAgent({
  llm: model,
  tools: [getWeather],
  // 在 ToolNode 上启用缓存
}).withConfig({
  cachePolicy: {
    ttl: 3600, // 1 小时
    cacheKeyFn: (input) => JSON.stringify(input),
  },
});
```

### 限制循环次数

```typescript
// 使用递归限制器包装 agent
import { RecursiveUrlLoader } from "langchain/document_loaders";

const agentWithLimit = RunnableSequence.from([
  (input) => ({ ...input, stepCount: 0 }),
  async (state) => {
    let current = state;
    const maxSteps = 10;
    
    for (let i = 0; i < maxSteps; i++) {
      const result = await agent.invoke(current);
      current = result;
      
      // 检查是否完成
      const lastMessage = result.messages[result.messages.length - 1];
      if (!("tool_calls" in lastMessage)) {
        break;
      }
    }
    
    return current;
  },
]);
```

## 最佳实践

### 1. 总是使用检查点保存器

```typescript
const memory = new MemorySaver();

const agent = createReactAgent({
  llm: model,
  tools: tools,
  checkpointSaver: memory, // 总是添加
});
```

### 2. 为目标操作使用中断

```typescript
const agent = createReactAgent({
  llm: model,
  tools: [readData, executeTrade], // 高风险工具
  checkpointSaver: memory,
  interruptBefore: ["tools"], // 在执行前中断
});
```

### 3. 使用有意义的 prompt

```typescript
const agent = createReactAgent({
  llm: model,
  tools: tools,
  prompt: `You are an expert assistant for our e-commerce platform.
  
You have access to the following tools:
{tool_descriptions}

Guidelines:
- Always verify the user's intent before taking action
- For sensitive operations (refunds, cancellations), confirm with the user
- If unsure, ask clarifying questions

Current conversation:
{messages}`,
});
```

### 4. 监控工具调用

```typescript
const agent = createReactAgent({
  llm: model,
  tools: tools.map(tool => ({
    ...tool,
    invoke: async (input, config) => {
      console.log(`Tool called: ${tool.name}`, input);
      const result = await tool.invoke(input, config);
      console.log(`Tool result: ${tool.name}`, result);
      return result;
    },
  })),
});
```

## 总结

`createReactAgent` 是 LangGraphJS 中最快速创建 Agent 的方式：

- **开箱即用**：自动处理工具绑定、消息管理、循环执行
- **高度可定制**：支持自定义状态、prompt、响应格式
- **生产就绪**：内置检查点、中断、错误处理
- **易于调试**：详细的日志和状态检查

对于大多数 Agent 场景，`createReactAgent` 是首选方案。只有当需要完全控制执行流程时，才需要手动构建 StateGraph。