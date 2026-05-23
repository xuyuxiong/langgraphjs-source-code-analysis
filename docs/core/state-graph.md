# StateGraph - 状态图构建器

## 概述

`StateGraph` 是 LangGraphJS 中最核心的图构建器类，它提供了一种声明式的方式来定义基于共享状态的状态机。与普通的 `Graph` 不同，`StateGraph` 的节点通过读取和写入共享状态来进行通信，每个节点接收一个定义的 `State` 作为输入，并返回一个 `Partial<State>` 来更新状态。

## 设计思想

### 状态中心的架构

`StateGraph` 的设计哲学是"状态中心"（State-Centric）。在这种架构中：

1. **状态是唯一的真相源**：整个图的执行过程就是状态的流转过程
2. **节点是状态转换器**：每个节点接收当前状态，经过处理后返回状态的增量更新
3. **Reducer 是状态合并规则**：定义如何将多个节点的更新聚合到最终状态中

这种设计使得：
- 状态管理变得清晰和可预测
- 可以轻松地实现时间旅行调试（通过保存状态快照）
- 支持中断和恢复机制
- 天然适合 AI Agent 的场景（消息历史、工具调用结果等都可以作为状态）

### 与 Graph 的区别

`StateGraph` 和普通 `Graph` 的主要区别在于：

```typescript
// 普通 Graph - 节点之间通过边直接传递数据
const graph = new Graph()
  .addNode("a", nodeA)
  .addNode("b", nodeB)
  .addEdge("a", "b");

// StateGraph - 节点通过共享状态通信
const stateGraph = new StateGraph(StateAnnotation)
  .addNode("a", nodeA)
  .addNode("b", nodeB)
  .addEdge("a", "b");
```

在普通 Graph 中，节点 a 的返回值直接传递给节点 b。而在 StateGraph 中，节点 a 返回的是状态的增量更新，这些更新被应用到共享状态中，然后节点 b 读取更新后的状态。

## 核心概念

### StateAnnotation（状态注解）

状态注解是定义状态结构的核心机制。它使用 Zod 或类似的 schema 定义工具来声明状态的类型和 reducer 函数。

```typescript
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

const StateAnnotation = Annotation.Root({
  // 简单值类型
  sentiment: Annotation<string>,
  
  // 带 reducer 的复杂类型
  messages: Annotation<BaseMessage[]>({
    reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
      if (Array.isArray(right)) {
        return left.concat(right);
      }
      return left.concat([right]);
    },
    default: () => [],
  }),
  
  // 带默认值的类型
  attempts: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
});
```

#### 注解的工作原理

`Annotation.Root` 创建一个状态定义的根节点，每个字段可以：

1. **简单类型**：使用 `Annotation<Type>`，默认的最后值获胜（LastValue）
2. **复杂类型**：使用 `Annotation<Type>({ reducer, default })` 自定义 reducer 和默认值

Reducer 函数的签名是 `(left: Value, right: UpdateValue) => Value`，其中：
- `left` 是当前状态中的值
- `right` 是节点返回的更新值
- 返回值是合并后的新值

### 状态类型和更新类型

从状态注解中，LangGraphJS 自动推导两种类型：

```typescript
// 完整的状态类型（所有字段都是必填的）
type State = typeof StateAnnotation.State;
// {
//   sentiment: string;
//   messages: BaseMessage[];
//   attempts: number;
// }

// 更新类型（所有字段都是可选的，表示增量更新）
type Update = typeof StateAnnotation.Update;
// {
//   sentiment?: string;
//   messages?: BaseMessage | BaseMessage[];
//   attempts?: number;
// }
```

### 节点函数

节点函数接收当前状态作为输入，返回状态的增量更新：

```typescript
const myNode = async (state: typeof StateAnnotation.State) => {
  // 读取状态
  const { messages, sentiment } = state;
  
  // 处理逻辑
  const newMessage = new AIMessage("Hello!");
  
  // 返回增量更新
  return {
    messages: [newMessage],
    sentiment: "positive",
  };
};
```

## 源码解析

### StateGraph 类结构

让我们深入 `state.ts` 源码，理解 `StateGraph` 的内部实现：

```typescript
export class StateGraph<
  SD extends StateDefinitionInit | unknown,
  S = ExtractStateType<SD>,
  U = ExtractUpdateType<SD, S>,
  N extends string = typeof START,
  I extends StateDefinitionInit = ExtractStateDefinition<SD>,
  O extends StateDefinitionInit = ExtractStateDefinition<SD>,
  C extends StateDefinitionInit = StateDefinition,
  // ... 更多类型参数
> {
  // 内部状态
  nodes: Record<string, StateGraphNodeSpec<any, any>>;
  edges: Set<[string | typeof START, string | typeof END]>;
  stateSchema: StateDefinition;
  inputSchema?: StateDefinition;
  outputSchema?: StateDefinition;
  
  constructor(args: StateDefinition | StateGraphArgs<any>) { ... }
  addNode(...): StateGraph<...> { ... }
  addEdge(...): StateGraph<...> { ... }
  addConditionalEdges(...): StateGraph<...> { ... }
  compile(...): CompiledGraph<...> { ... }
}
```

关键的类型参数包括：
- `SD`: 状态定义（可以直接是 `StateDefinition` 或通过 Zod schema 推导）
- `S`: 完整状态类型（所有 reducer 应用后的类型）
- `U`: 更新类型（节点返回的类型）
- `N`: 节点名称的联合类型（随着 `addNode` 调用累积）
- `I`: 输入 schema（限制图的输入）
- `O`: 输出 schema（限制图的输出）
- `C`: 配置 schema（运行时配置的类型）
- `InterruptType`: 中断恢复值的类型
- `WriterType`: 自定义流式写入器的类型

### 状态 Schema 处理

`StateGraph` 可以接受多种形式的状态定义：

```typescript
// 方式 1: 使用 Annotation.Root
const StateAnnotation = Annotation.Root({...});
const graph = new StateGraph(StateAnnotation);

// 方式 2: 使用 Zod Schema
import { z } from "zod";
const schema = z.object({
  messages: z.array(z.any()),
  sentiment: z.string(),
});
const graph = new StateGraph(schema);

// 方式 3: 直接使用 StateDefinition
const graph = new StateGraph({
  channels: {
    messages: { reducer: ..., default: ... },
  },
});
```

内部，`StateGraph` 使用以下辅助函数来处理不同类型的定义：

```typescript
type ExtractStateDefinition<T> = T extends AnyStateSchema
  ? T // StateSchema 保持不变
  : T extends StateDefinitionInit
    ? ToStateDefinition<T> // Zod schema 转换为 StateDefinition
    : StateDefinition;
```

### addNode 方法

`addNode` 方法用于向图中添加节点：

```typescript
addNode<
  NodeName extends string,
  NodeInput extends object = StateType<ExtractStateDefinition<SD>>,
  InterruptType = unknown,
  WriterType = unknown,
>(
  nodeName: NodeName,
  action: NodeAction<NodeInput, UpdateType, SD, InterruptType, WriterType>,
  options?: StateGraphAddNodeOptions<NodeName, InputSchema>
): StateGraph<...> {
  // 1. 验证节点名称
  if (nodeName in this.nodes) {
    throw new Error(`Node '${nodeName}' already exists`);
  }
  
  // 2. 将 action 转换为 Runnable 格式
  const runnable = _coerceToRunnable(action);
  
  // 3. 创建节点规格
  const nodeSpec: StateGraphNodeSpec<any, any> = {
    runnable,
    input: options?.input,
    retryPolicy: options?.retryPolicy,
    cachePolicy: options?.cachePolicy,
  };
  
  // 4. 存储节点
  this.nodes[nodeName] = nodeSpec;
  
  // 5. 返回新的 StateGraph 实例（支持链式调用）
  return new StateGraph<...>(/* 传递所有内部状态 */);
}
```

这种设计允许链式调用：

```typescript
const graph = new StateGraph(StateAnnotation)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addEdge("agent", "tools")
  .addEdge("tools", "agent");
```

### addEdge 和 addConditionalEdges

**addEdge** 添加一条固定的边：

```typescript
addEdge(
  startNode: N | typeof START,
  endNode: N | typeof END
): StateGraph<...> {
  // 验证节点存在
  if (startNode !== START && !(startNode in this.nodes)) {
    throw new Error(`Node '${startNode}' not found`);
  }
  if (endNode !== END && !(endNode in this.nodes)) {
    throw new Error(`Node '${endNode}' not found`);
  }
  
  // 添加边
  this.edges.add([startNode, endNode]);
  
  return this;
}
```

**addConditionalEdges** 添加条件边（动态路由）：

```typescript
addConditionalEdges<
  V extends string | Send | Command,
>(
  source: N | typeof START,
  path: (state: S) => V | Promise<V>,
  pathMap?: Record<string, N | typeof END> | (N | typeof END)[]
): StateGraph<...> {
  // 验证源节点
  if (source !== START && !(source in this.nodes)) {
    throw new Error(`Node '${source}' not found`);
  }
  
  // 创建 Branch 对象
  const branch = new Branch({
    source,
    path: _coerceToRunnable(path),
    pathMap,
  });
  
  // 将 Branch 关联到源节点
  // Branch 会在运行时根据 path 的返回值决定下一个节点
  this._branches[source] = branch;
  
  return this;
}
```

### compile 方法

`compile` 方法将 `StateGraph` 转换为 `CompiledGraph`，这是一个可以执行的 Pregel 实例：

```typescript
compile(options?: CompileOptions): CompiledGraph<...> {
  // 1. 验证图的有效性
  validateGraph(this.nodes, this.edges, this._branches);
  
  // 2. 构建通道（Channels）
  const channels = this._createChannels();
  
  // 3. 构建输入/输出节点
  const inputNode = this._createInputNode();
  const outputNode = this._createOutputNode();
  
  // 4. 为每个节点创建 PregelNode
  const pregelNodes = Object.entries(this.nodes).map(
    ([name, spec]) => [name, this._createPregelNode(name, spec)]
  );
  
  // 5. 处理条件边（Branches）
  const branches = this._compileBranches();
  
  // 6. 创建 CompiledGraph
  return new CompiledGraph({
    nodes: Object.fromEntries(pregelNodes),
    channels,
    inputChannels: inputNode,
    outputChannels: outputNode,
    branches,
    ...options,
  });
}
```

编译过程的核心是将高层的 StateGraph 抽象转换为底层的 Pregel 执行引擎可以理解的格式。

### 通道创建

`StateGraph` 根据状态定义自动创建通道：

```typescript
_createChannels(): Record<string, BaseChannel> {
  const channels: Record<string, BaseChannel> = {};
  
  for (const [key, spec] of Object.entries(this.stateSchema.channels)) {
    // 根据 reducer 类型选择合适的通道实现
    if (spec.reducer) {
      // 有 reducer 的字段使用 BinOp 通道（支持累积更新）
      channels[key] = new BinOp(
        spec.reducer,
        spec.default?.(),
        key
      );
    } else {
      // 无 reducer 的字段使用 LastValue 通道（最后值获胜）
      channels[key] = new LastValue(
        key,
        spec.default?.()
      );
    }
  }
  
  return channels;
}
```

## 使用场景

### 1. 简单状态机

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
  count: Annotation<number>({
    reducer: (a, b) => a + (b ?? 0),
    default: () => 0,
  }),
});

const increment = (state: typeof StateAnnotation.State) => ({
  count: 1,
});

const double = (state: typeof StateAnnotation.State) => ({
  count: state.count,
});

const graph = new StateGraph(StateAnnotation)
  .addNode("increment", increment)
  .addNode("double", double)
  .addEdge("__start__", "increment")
  .addEdge("increment", "double")
  .compile();

const result = await graph.invoke({});
console.log(result); // { count: 1 } (0 + 1, 然后 double 返回 count 当前值)
```

### 2. ReAct Agent

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => {
      if (Array.isArray(right)) return left.concat(right);
      return left.concat([right]);
    },
    default: () => [],
  }),
});

const getWeather = tool((input) => {
  return `Weather in ${input.location}: sunny, 25°C`;
}, {
  name: "get_weather",
  schema: z.object({ location: z.string() }),
});

const model = new ChatAnthropic({
  model: "claude-3-haiku-20240307",
}).bindTools([getWeather]);

const callModel = async (state: typeof StateAnnotation.State) => {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
};

const route = (state: typeof StateAnnotation.State) => {
  const lastMessage = state.messages[state.messages.length - 1];
  if ("tool_calls" in lastMessage && lastMessage.tool_calls?.length) {
    return "tools";
  }
  return "__end__";
};

const callTools = async (state: typeof StateAnnotation.State) => {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const results = await Promise.all(
    lastMessage.tool_calls.map(async (call) => {
      const output = await getWeather.invoke(call);
      return new ToolMessage({
        content: output,
        tool_call_id: call.id!,
      });
    })
  );
  return { messages: results };
};

const graph = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", callTools)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", route, {
    tools: "tools",
    __end__: "__end__",
  })
  .addEdge("tools", "agent")
  .compile();

const result = await graph.invoke({
  messages: [new HumanMessage("What's the weather in SF?")],
});
```

### 3. 带中断的审批流程

```typescript
import { StateGraph, Annotation, interrupt } from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
  request: Annotation<string>,
  approval: Annotation<string | null>({
    reducer: (_, b) => b ?? null,
    default: () => null,
  }),
  result: Annotation<string | null>({
    reducer: (_, b) => b ?? null,
    default: () => null,
  }),
});

const requestNode = (state: typeof StateAnnotation.State) => {
  console.log(`Processing request: ${state.request}`);
  return {};
};

const approvalNode = (state: typeof StateAnnotation.State) => {
  // 中断等待人工审批
  const approval = interrupt<{ approve: boolean; comment?: string }>({
    type: "approval",
    request: state.request,
  });
  
  if (approval.approve) {
    return { approval: "approved" };
  } else {
    return { approval: "rejected", result: `Rejected: ${approval.comment}` };
  }
};

const processNode = (state: typeof StateAnnotation.State) => {
  return { result: `Approved: ${state.request}` };
};

const route = (state: typeof StateAnnotation.State) => {
  if (state.approval === "approved") return "process";
  return "__end__";
};

const graph = new StateGraph(StateAnnotation)
  .addNode("request", requestNode)
  .addNode("approval", approvalNode)
  .addNode("process", processNode)
  .addEdge("__start__", "request")
  .addEdge("request", "approval")
  .addConditionalEdges("approval", route, {
    process: "process",
    __end__: "__end__",
  })
  .compile();

// 第一次执行，会在 approval 节点中断
const stream1 = await graph.stream({ request: "Deploy to production" });
for await (const chunk of stream1) {
  console.log(chunk);
}
// 输出中断信息，等待恢复

// 恢复执行，提供审批结果
const stream2 = await graph.stream(new Command({
  resume: { approve: true, comment: "Looks good!" },
}));
```

## 高级特性

### 输入/输出 Schema

通过 `input` 和 `output` 选项，可以限制图的输入和输出：

```typescript
const InputAnnotation = Annotation.Root({
  query: Annotation<string>,
});

const OutputAnnotation = Annotation.Root({
  answer: Annotation<string>,
  sources: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
});

const graph = new StateGraph(StateAnnotation, {
  input: InputAnnotation,
  output: OutputAnnotation,
})
  .addNode("search", searchNode)
  .addNode("generate", generateNode)
  .addEdge("__start__", "search")
  .addEdge("search", "generate")
  .addEdge("generate", "__end__")
  .compile();

// 输入类型被限制为 { query: string }
const result = await graph.invoke({ query: "What is TypeScript?" });
// 输出类型被限制为 { answer: string, sources: string[] }
```

### 节点级重试和缓存

```typescript
import { RetryPolicy, CachePolicy } from "@langchain/langgraph";

const retryPolicy: RetryPolicy = {
  initialInterval: 1000,
  maxInterval: 10000,
  maxAttempts: 3,
};

const cachePolicy: CachePolicy = {
  ttl: 3600, // 1 小时
};

const graph = new StateGraph(StateAnnotation)
  .addNode("flaky", flakyNode, { retryPolicy })
  .addNode("expensive", expensiveNode, { cachePolicy })
  .compile();
```

### 流式输出

```typescript
const graph = new StateGraph(StateAnnotation)
  .addNode("a", nodeA)
  .addNode("b", nodeB)
  .addEdge("__start__", "a")
  .addEdge("a", "b")
  .addEdge("b", "__end__")
  .compile();

// 流式输出每个节点的值
const stream = await graph.stream(
  { /* initial state */ },
  { streamMode: "values" }
);

for await (const snapshot of stream) {
  console.log(snapshot);
}
```

## 核心篇总结

StateGraph 是 LangGraphJS 的核心构建块，它提供：

1. **声明式状态定义**：通过 Annotation 或 Zod schema 定义状态结构
2. **自动类型推导**：从状态定义推导 State 和 Update 类型
3. **灵活的节点添加**：支持链式调用和选项配置
4. **条件路由**：通过 addConditionalEdges 实现动态流程控制
5. **可执行的编译**：compile() 将高层抽象转换为 Pregel 执行引擎

理解 StateGraph 的工作原理是掌握 LangGraphJS 的关键，因为它抽象了底层的 Pregel 执行细节，提供了更直观的编程模型。