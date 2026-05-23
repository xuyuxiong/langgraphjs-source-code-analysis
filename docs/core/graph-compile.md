# 图编译 (Graph Compile) - 从声明到执行

## 概述

图编译是 LangGraphJS 中将声明式的图定义转换为可执行的 Pregel 实例的关键过程。通过 `compile()` 方法，`StateGraph` 或 `Graph` 被转换成一个 `CompiledGraph`，这是一个完整的、可以执行的工作流引擎。

编译过程的核心任务是：
1. **验证图结构**：确保图的定义是有效的
2. **创建通道**：根据状态定义初始化通道
3. **附加节点**：将用户定义的节点转换为 PregelNode
4. **附加边**：建立节点之间的连接关系
5. **处理分支**：将条件边转换为可执行的路由逻辑

## 编译流程详解

### compile() 方法签名

```typescript
compile<const TTransformers extends ReadonlyArray<() => StreamTransformer<any>> = []>({
  checkpointer,
  interruptBefore,
  interruptAfter,
  name,
  transformers,
}: {
  checkpointer?: BaseCheckpointSaver | false;
  interruptBefore?: N[] | All;
  interruptAfter?: N[] | All;
  name?: string;
  transformers?: TTransformers;
} = {}): CompiledGraph<...>
```

#### 编译选项

| 选项 | 类型 | 说明 |
|------|------|------|
| `checkpointer` | `BaseCheckpointSaver \| false` | 检查点保存器，用于状态持久化和时间旅行 |
| `interruptBefore` | `N[] \| All` | 在哪些节点之前中断 |
| `interruptAfter` | `N[] \| All` | 在哪些节点之后中断 |
| `name` | `string` | 图的名称（用于调试和追踪） |
| `transformers` | `StreamTransformer[]` | 流式输出转换器 |

### 编译步骤

#### 步骤 1：图验证

编译的第一步是验证图的有效性：

```typescript
compile(options = {}) {
  // 验证中断配置
  this.validate([
    ...(Array.isArray(interruptBefore) ? interruptBefore : []),
    ...(Array.isArray(interruptAfter) ? interruptAfter : []),
  ]);
  ...
}
```

验证内容包括：
- 所有边的源节点必须存在
- 所有边的目标节点必须存在
- 没有不可达的节点
- 中断配置引用的节点必须存在

#### 步骤 2：创建 CompiledGraph 实例

```typescript
const compiled = new CompiledGraph({
  builder: this,
  checkpointer,
  interruptAfter,
  interruptBefore,
  autoValidate: false,
  nodes: {} as Record<N | typeof START, PregelNode<RunInput, RunOutput>>,
  channels: {
    [START]: new EphemeralValue(),
    [END]: new EphemeralValue(),
  } as Record<N | typeof START | typeof END | string, BaseChannel>,
  inputChannels: START,
  outputChannels: END,
  streamChannels: [] as N[],
  streamMode: "values",
  name,
  streamTransformers: transformers,
});
```

这里创建了 `CompiledGraph` 的基本结构，包括：
- **nodes**: 空的节点记录，稍后通过 `attachNode` 填充
- **channels**: 初始通道，至少包含 `START` 和 `END` 通道
- **inputChannels/outputChannels**: 输入输出通道引用
- **interruptBefore/After**: 中断配置

#### 步骤 3：附加节点

```typescript
for (const [key, node] of Object.entries<NodeSpec<RunInput, RunOutput>>(
  this.nodes
)) {
  compiled.attachNode(key as N, node);
}
```

`attachNode` 方法将用户定义的节点转换为 Pregel 节点：

```typescript
attachNode(key: N, node: NodeSpec<RunInput, RunOutput>): void {
  // 1. 创建通道写入器
  const channelWriter = new ChannelWrite(
    [{ channel: key, value: PASSTHROUGH }],
    [TAG_HIDDEN]
  );

  // 2. 创建 PregelNode
  this.nodes[key] = new PregelNode({
    channels: [],              // 输入通道列表
    writers: [channelWriter],  // 输出写入器
    triggers: [key],           // 触发条件
    name: node.name ?? key,    // 节点名称
    node: node.runnable,       // 实际的可执行节点
    metadata: node.metadata,   // 元数据
    retryPolicy: node.retryPolicy,     // 重试策略
    cachePolicy: node.cachePolicy,     // 缓存策略
  });

  // 3. 为节点创建状态通道（如果是 StateGraph）
  if (this.stateSchema) {
    const stateChannel = getChannel(key, this.stateSchema);
    this.channels[key] = stateChannel;
  }
}
```

PregelNode 的核心属性：
- **channels**: 节点订阅的输入通道
- **writers**: 节点的输出写入器
- **triggers**: 触发节点执行的条件
- **node**: 实际的可执行逻辑（Runnable）

#### 步骤 4：附加边

```typescript
for (const [start, end] of this.edges) {
  compiled.attachEdge(start, end);
}
```

`attachEdge` 方法建立节点之间的连接：

```typescript
attachEdge(start: string | typeof START, end: string | typeof END): void {
  // 处理特殊节点 START
  if (start === START) {
    if (end === END) return;
    // START -> X: 将输入直接传递给 X
    this.nodes[end as N].channels.push(
      new ChannelSubscribeEntry({
        channel: START,
        key: end,
      })
    );
    return;
  }

  // 处理特殊节点 END
  if (end === END) {
    // X -> END: 将 X 的输出写入 END 通道
    this.nodes[start as N].writers.push(
      new ChannelWrite(
        [{ channel: END, value: PASSTHROUGH }],
        [TAG_HIDDEN]
      )
    );
    return;
  }

  // 普通边 X -> Y
  // Y 订阅 X 的通道
  this.nodes[end].channels.push(
    new ChannelSubscribeEntry({
      channel: start,
      key: end,
    })
  );
  
  // X 写入 Y 的通道
  this.nodes[start].writers.push(
    new ChannelWrite(
      [{ channel: end, value: PASSTHROUGH }],
      [TAG_HIDDEN]
    )
  );
}
```

边的语义：
- **START -> X**: 图的入口，输入直接传递给节点 X
- **X -> END**: 图的出口，节点 X 的输出作为最终结果
- **X -> Y**: 节点 X 完成后，Y 可以执行

#### 步骤 5：附加分支（条件边）

```typescript
for (const [start, branches] of Object.entries(this.branches)) {
  for (const [name, branch] of Object.entries(branches)) {
    compiled.attachBranch(start as N, name, branch);
  }
}
```

`attachBranch` 方法处理条件路由：

```typescript
attachBranch(start: N, name: string, branch: Branch): void {
  // 1. 创建分支写入器
  const branchWriter = branch.run(
    (dests: (string | Send)[], config: LangGraphRunnableConfig) => {
      // 根据返回值决定下一个节点
      const writes: ChannelWriteEntry[] = dests.map((dest) => {
        if (_isSend(dest)) {
          return { channel: dest.node, value: dest.args };
        }
        return { channel: dest, value: PASSTHROUGH };
      });
      return new ChannelWrite(writes, [TAG_HIDDEN]);
    }
  );

  // 2. 将分支写入器附加到源节点
  this.nodes[start].writers.push(branchWriter);
}
```

分支的核心逻辑：
- 分支是一个 `Runnable`，接收当前状态并返回目标节点
- 分支的返回值可以是：
  - 单个节点名称（字符串）
  - `Send` 对象（带参数的节点调用）
  - 数组（多个目标）
- 分支在运行时动态决定下一个节点

### 编译后的结构

编译完成后，`CompiledGraph` 包含：

```typescript
class CompiledGraph<...> extends Pregel<...> {
  // 节点映射
  nodes: Record<N | typeof START, PregelNode>;
  
  // 通道集合
  channels: Record<string, BaseChannel>;
  
  // 输入/输出通道
  inputChannels: string | string[];
  outputChannels: string | string[];
  
  // 分支（条件边）
  branches: Record<N, Record<string, Branch>>;
  
  // 中断配置
  interruptBefore?: N[];
  interruptAfter?: N[];
  
  // 检查点保存器
  checkpointer?: BaseCheckpointSaver;
  
  // 方法
  invoke(input, config): Promise<output>
  stream(input, config): AsyncIterable<output>
  getState(config): Promise<StateSnapshot>
  updateState(config, values): Promise<void>
  compile(): this  // 返回自身（已经是编译状态）
}
```

## 编译时的验证

### validate() 方法

```typescript
validate(interrupt?: string[]): void {
  // 1. 收集所有源节点
  const allSources = new Set([...this.allEdges].map(([src, _]) => src));
  for (const [start] of Object.entries(this.branches)) {
    allSources.add(start);
  }

  // 2. 验证源节点存在
  for (const source of allSources) {
    if (source !== START && !(source in this.nodes)) {
      throw new Error(`Found edge starting at unknown node \`${source}\``);
    }
  }

  // 3. 收集所有目标节点
  const allTargets = new Set([...this.allEdges].map(([_, target]) => target));
  for (const [start, branches] of Object.entries(this.branches)) {
    for (const branch of Object.values(branches)) {
      if (branch.ends != null) {
        for (const end of Object.values(branch.ends)) {
          allTargets.add(end);
        }
      } else {
        allTargets.add(END);
        for (const node of Object.keys(this.nodes)) {
          if (node !== start) allTargets.add(node);
        }
      }
    }
  }

  // 4. 验证目标节点存在
  for (const target of allTargets) {
    if (target !== END && !(target in this.nodes)) {
      throw new Error(`Found edge ending at unknown node \`${target}\``);
    }
  }

  // 5. 验证中断配置
  for (const node of interrupt ?? []) {
    if (!(node in this.nodes)) {
      throw new Error(`Node \`${node}\` not found`);
    }
  }

  // 6. 检测死锁（可选）
  // 检查是否有节点不可达或无法到达 END
}
```

### 常见验证错误

```typescript
// 错误 1: 未知的源节点
// Error: Found edge starting at unknown node `unknownNode`
graph.addEdge("unknownNode", "validNode");

// 错误 2: 未知的目标节点
// Error: Found edge ending at unknown node `nonExistentNode`
graph.addEdge("validNode", "nonExistentNode");

// 错误 3: 中断节点不存在
// Error: Node `missingNode` not found
graph.compile({ interruptBefore: ["missingNode"] });

// 错误 4: 重复的条件名
// Error: Condition `route` already present for node `agent`
graph.addConditionalEdges("agent", route1, {...});
graph.addConditionalEdges("agent", route2, {...}); // route 同名
```

## 编译选项详解

### Checkpointer（检查点保存器）

```typescript
import { MemorySaver } from "@langchain/langgraph-checkpoint";

const memory = new MemorySaver();

const graph = new StateGraph(StateAnnotation)
  .addNode("a", nodeA)
  .addEdge("__start__", "a")
  .compile({ checkpointer: memory });
```

检查点保存器的作用：
- **状态持久化**：保存每个 step 的状态
- **时间旅行**：可以从任意检查点恢复
- **中断恢复**：支持人工审批等场景

### Interrupt（中断配置）

```typescript
// 在特定节点之前中断
const graph = stateGraph.compile({
  interruptBefore: ["approval", "deployment"],
});

// 在特定节点之后中断
const graph = stateGraph.compile({
  interruptAfter: ["research", "analysis"],
});

// 在所有节点之前中断
const graph = stateGraph.compile({
  interruptBefore: "*",  // 或 "All"
});
```

中断的行为：
- **interruptBefore**: 节点执行前暂停，返回中断信息
- **interruptAfter**: 节点执行后暂停，返回当前状态
- 使用 `Command({ resume: ... })` 恢复执行

### Transformers（流式转换器）

```typescript
import { createStreamTransformer } from "@langchain/langgraph";

const graph = stateGraph.compile({
  transformers: [
    () => createStreamTransformer((chunk) => {
      // 自定义转换逻辑
      return transform(chunk);
    }),
  ],
});
```

转换器在 `streamEvents` 调用时自动应用。

## 编译与执行的关系

### 编译时 vs 运行时

| 阶段 | 发生时间 | 主要任务 |
|------|---------|---------|
| 编译时 | 调用 `compile()` | 图验证、节点转换、通道初始化 |
| 运行时 | 调用 `invoke()`/`stream()` | 实际执行、状态更新、检查点保存 |

### 编译是不可变的

```typescript
const graph = stateGraph.compile();

// 编译后添加节点不会生效
stateGraph.addNode("new", newNode);
graph.invoke(input);  // 不会包含新节点

// 需要重新编译
const newGraph = stateGraph.compile();
```

### 多次编译

```typescript
// 可以多次编译同一个 StateGraph
const graph1 = stateGraph.compile({
  checkpointer: memory1,
  interruptBefore: ["a"],
});

const graph2 = stateGraph.compile({
  checkpointer: memory2,
  interruptAfter: ["b"],
});

// graph1 和 graph2 是独立的 CompiledGraph 实例
```

## 子图编译

子图是嵌套在父图中的编译图：

```typescript
const subgraph = new StateGraph(SubState)
  .addNode("sub1", subNode1)
  .addEdge("__start__", "sub1")
  .compile();

const mainGraph = new StateGraph(MainState)
  .addNode("sub", subgraph)  // 子图作为节点
  .addNode("other", otherNode)
  .addEdge("__start__", "sub")
  .addEdge("sub", "other")
  .compile();
```

子图编译的注意事项：
1. 子图需要先编译
2. 子图有自己的命名空间
3. 父图和子图可以有不同的检查点保存器

## 编译产物的序列化

编译后的图可以被序列化（用于远程执行）：

```typescript
// 获取图的配置
const config = graph.getConfig();

// 从配置重建
const restored = CompiledGraph.fromConfig(config);
```

但这通常用于 LangGraph 平台场景，本地使用不需要手动序列化。

## 性能考虑

### 编译成本

编译是一个相对昂贵的操作：
- 需要遍历所有节点和边
- 创建多个对象实例
- 执行验证逻辑

**建议**：
- 编译一次，重复使用
- 不要在高频路径中编译
- 使用单例模式管理编译后的图

```typescript
// ❌ 不好：每次都编译
async function run(data) {
  const graph = createGraph().compile();
  return graph.invoke(data);
}

// ✅ 好：编译一次，重复使用
const graph = createGraph().compile();
async function run(data) {
  return graph.invoke(data);
}
```

### 内存占用

编译后的图会占用一定内存：
- 节点对象
- 通道实例
- 分支路由表

对于大型图，考虑：
- 使用子图拆分
- 延迟编译（只在需要时）
- 定期清理不用的实例

## 调试编译问题

### 查看编译后的图结构

```typescript
const graph = stateGraph.compile();

// 查看节点
console.log(Object.keys(graph.nodes));

// 查看通道
console.log(Object.keys(graph.channels));

// 查看边（通过节点写入器推断）
for (const [name, node] of Object.entries(graph.nodes)) {
  console.log(`${name} writes to:`, node.writers);
}
```

### 可视化图

```typescript
const graph = stateGraph.compile();

// 获取图的可视化表示
const drawable = await graph.getGraph();
const png = await drawable.drawPng();
```

### 编译警告

```typescript
// 如果在编译后修改图，会收到警告
const graph = stateGraph.compile();
stateGraph.addNode("new", newNode);
// Warning: Adding a node to a graph that has already been compiled.
```

## 总结

图编译是 LangGraphJS 的关键环节，它将声明式的图定义转换为可执行的 Pregel 引擎：

1. **验证**：确保图结构有效
2. **转换**：将节点和边转换为 Pregel 内部格式
3. **初始化**：创建通道和写入器
4. **配置**：设置中断、检查点等选项

理解编译过程有助于：
- 诊断图结构问题
- 优化性能（避免重复编译）
- 正确使用高级特性（子图、中断、检查点）
- 调试运行时行为

编译是 LangGraphJS"声明式定义，命令式执行"理念的核心实现。