# Checkpoint 系统详解

## 概述

Checkpoint 系统是 LangGraphJS 的核心组件之一，负责**图执行状态的管理**。它提供了以下关键能力：

- **状态持久化**：将图的执行状态保存到存储中
- **恢复执行**：从保存点恢复图的执行
- **时间旅行**：访问历史状态并进行调试
- **人工审核**：在中断点等待人工输入后恢复
- **线程管理**：支持多会话的独立状态管理

Checkpoint 系统采用抽象接口设计，支持多种存储后端，包括内存、Postgres、Redis、SQLite、MongoDB 等。

## Checkpoint 系统架构

### 核心概念

```
┌─────────────────────────────────────────────────────────────┐
│                     Checkpoint 系统                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐                                        │
│  │   Checkpoint    │ ← 状态快照                              │
│  │   (状态数据)     │                                        │
│  └─────────────────┘                                        │
│           ↓                                                  │
│  ┌─────────────────┐                                        │
│  │ CheckpointSaver │ ← 保存/读取接口                         │
│  │  (抽象类)        │                                        │
│  └─────────────────┘                                        │
│           ↓                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐│
│  │    Memory       │  │    Postgres     │  │    Redis     ││
│  │ CheckpointSaver │  │ CheckpointSaver │  │ Checkpoint...││
│  └─────────────────┘  └─────────────────┘  └──────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 关键组件

| 组件 | 作用 |
|------|------|
| **Checkpoint** | 状态的快照，包含 channel_values、channel_versions、versions_seen |
| **CheckpointSaver** | 保存和读取 Checkpoint 的抽象接口 |
| **CheckpointTuple** | 包含 checkpoint、config、metadata 的完整数据结构 |
| **ChannelVersions** | 追踪每个 channel 的版本号 |
| **PendingWrites** | 尚未提交到 checkpoint 的待处理写入 |

## Checkpoint 数据结构

### Checkpoint 结构

```typescript
// libs/langgraph-checkpoint/src/base.ts

interface Checkpoint<N extends string = string, C extends string = string> {
  /**
   * Checkpoint 格式版本，当前为 4
   */
  v: number;
  
  /**
   * Checkpoint 唯一 ID（UUIDv6）
   */
  id: string;
  
  /**
   * 创建时间 ISO 字符串
   */
  ts: string;
  
  /**
   * Channel 的值
   */
  channel_values: Record<C, unknown>;
  
  /**
   * Channel 的版本号
   */
  channel_versions: Record<C, ChannelVersion>;
  
  /**
   * 每个 node 已看到的 channel 版本
   */
  versions_seen: Record<N, Record<C, ChannelVersion>>;
}
```

### CheckpointTuple 结构

```typescript
interface CheckpointTuple {
  /**
   * 配置信息（包含 thread_id、checkpoint_id 等）
   */
  config: RunnableConfig;
  
  /**
   * Checkpoint 数据
   */
  checkpoint: Checkpoint;
  
  /**
   * 元数据（用户自定义）
   */
  metadata?: CheckpointMetadata;
  
  /**
   * 父 checkpoint 配置（用于时间旅行）
   */
  parentConfig?: RunnableConfig;
  
  /**
   * 待处理的写入（尚未提交）
   */
  pendingWrites?: CheckpointPendingWrite[];
}
```

### CheckpointMetadata 结构

```typescript
interface CheckpointMetadata {
  /**
   * 创建时间（可选，由系统自动生成）
   */
  source?: "input" | "loop" | "update" | "fork";
  
  /**
   * 创建时间戳（可选，由系统自动生成）
   */
  step?: number;
  
  /**
   * 用户自定义元数据
   */
  [key: string]: any;
}
```

## CheckpointSaver 接口

### 抽象类定义

```typescript
// libs/langgraph-checkpoint/src/base.ts

export abstract class BaseCheckpointSaver<
  V extends string | number = number
> {
  /**
   * 序列化器
   */
  serde: SerializerProtocol = new JsonPlusSerializer();

  constructor(serde?: SerializerProtocol) {
    this.serde = serde || this.serde;
  }

  /**
   * 获取指定 checkpoint
   */
  async get(config: RunnableConfig): Promise<Checkpoint | undefined> {
    const value = await this.getTuple(config);
    return value ? value.checkpoint : undefined;
  }

  /**
   * 获取 checkpoint tuple（包含更多元数据）
   */
  abstract getTuple(
    config: RunnableConfig
  ): Promise<CheckpointTuple | undefined>;

  /**
   * 列出 checkpoint（支持分页和过滤）
   */
  abstract list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple>;

  /**
   * 保存新的 checkpoint
   */
  abstract put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions
  ): Promise<RunnableConfig>;

  /**
   * 保存待处理写入
   */
  abstract putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void>;

  /**
   * 删除线程的所有 checkpoint
   */
  abstract deleteThread(threadId: string): Promise<void>;

  /**
   * 生成下一个版本号
   */
  getNextVersion(current: V | undefined): V {
    if (typeof current === "string") {
      throw new Error("Please override this method to use string versions.");
    }
    return (
      current !== undefined && typeof current === "number" ? current + 1 : 1
    ) as V;
  }
}
```

### 核心方法说明

#### getTuple() - 获取 Checkpoint

```typescript
async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
  const { thread_id, checkpoint_ns, checkpoint_id } = config.configurable;
  
  // 从存储中获取 checkpoint
  const checkpoint = await this._loadCheckpoint(thread_id, checkpoint_id);
  
  return {
    config,
    checkpoint,
    metadata: await this._loadMetadata(thread_id, checkpoint_id),
    parentConfig: await this._loadParentConfig(thread_id, checkpoint_id),
    pendingWrites: await this._loadPendingWrites(thread_id, checkpoint_id),
  };
}
```

#### put() - 保存 Checkpoint

```typescript
async put(
  config: RunnableConfig,
  checkpoint: Checkpoint,
  metadata: CheckpointMetadata,
  newVersions: ChannelVersions
): Promise<RunnableConfig> {
  // 生成新的 checkpoint ID
  const checkpointId = uuid6();
  const ts = new Date().toISOString();
  
  // 创建完整的 checkpoint
  const fullCheckpoint: Checkpoint = {
    v: 4,
    id: checkpointId,
    ts,
    channel_values: checkpoint.channel_values,
    channel_versions: newVersions,
    versions_seen: checkpoint.versions_seen,
  };
  
  // 保存到存储
  await this._saveCheckpoint(
    config.configurable.thread_id,
    checkpointId,
    fullCheckpoint,
    metadata
  );
  
  return {
    configurable: {
      thread_id: config.configurable.thread_id,
      checkpoint_ns: config.configurable.checkpoint_ns,
      checkpoint_id: checkpointId,
    },
  };
}
```

#### list() - 列出 Checkpoints

```typescript
async *list(
  config: RunnableConfig,
  options?: CheckpointListOptions
): AsyncGenerator<CheckpointTuple> {
  const { limit, before, filter } = options || {};
  
  // 从存储中查询 checkpoints
  const checkpoints = await this._queryCheckpoints(
    config.configurable.thread_id,
    { limit, before, filter }
  );
  
  for (const checkpoint of checkpoints) {
    yield {
      config: { ...config, configurable: { checkpoint_id: checkpoint.id } },
      checkpoint,
      metadata: checkpoint.metadata,
    };
  }
}
```

## 线程与命名空间

### Thread 概念

Thread 是 Checkpoint 系统用于隔离不同会话的机制。每个 thread 有独立的状态历史。

```typescript
// 创建带 thread 的图
const graph = workflow.compile({
  checkpointer: new MemorySaver(),
});

// 使用 thread
const config = {
  configurable: { 
    thread_id: "user-session-123"  // 线程 ID
  }
};

// 每次调用都会保存到这个 thread 的历史
await graph.invoke(input1, config);
await graph.invoke(input2, config);
await graph.invoke(input3, config);

// 可以查看完整历史
const history = await graph.checkpointer.list(config);
```

### Checkpoint 命名空间

命名空间用于支持子图和并行执行：

```typescript
interface Configurable {
  thread_id: string;        // 线程 ID
  checkpoint_ns: string;    // Checkpoint 命名空间
  checkpoint_id: string;    // Checkpoint ID
}

// 命名空间的格式
// ""                           - 主图
// "child_graph"                - 子图
// "parent:child:grandchild"    - 多级嵌套
```

## Checkpoint 版本控制

### 版本递增机制

每次 checkpoint 保存时，channel 版本会递增：

```typescript
// 版本号递增逻辑
getNextVersion(current: number): number {
  return current !== undefined ? current + 1 : 1;
}

// 使用示例
const channelVersions: ChannelVersions = {
  messages: 1,  // 第一次
  messages: 2,  // 第二次更新
  messages: 3,  // 第三次更新
};
```

### versions_seen 追踪

```typescript
// 每个节点追踪已看到的 channel 版本
versions_seen: {
  agent: {
    messages: 5,    // agent 节点已看到 messages 的第 5 版
  },
  tools: {
    messages: 3,    // tools 节点只看到 messages 的第 3 版
  },
}
```

### 版本比较

```typescript
// 版本比较函数
function compareChannelVersions(
  a: ChannelVersion,
  b: ChannelVersion
): number {
  if (typeof a === "number" && typeof b === "number") {
    return Math.sign(a - b);
  }
  return String(a).localeCompare(String(b));
}

// 获取最大版本
function maxChannelVersion(...versions: ChannelVersion[]): ChannelVersion {
  return versions.reduce((max, version, idx) => {
    if (idx === 0) return version;
    return compareChannelVersions(max, version) >= 0 ? max : version;
  });
}
```

## Checkpoint 序列化

### JsonPlusSerializer

```typescript
// libs/langgraph-checkpoint/src/serde/jsonplus.ts

export class JsonPlusSerializer extends SerializerProtocol {
  async serialize(obj: any): Promise<string> {
    return JSON.stringify(obj, this._replacer);
  }
  
  async deserialize(str: string): Promise<any> {
    return JSON.parse(str, this._reviver);
  }
  
  private _replacer(key: string, value: any): any {
    // 处理特殊类型
    if (value instanceof Date) {
      return { __type: "date", value: value.toISOString() };
    }
    if (value instanceof Map) {
      return { __type: "map", value: Array.from(value.entries()) };
    }
    // ... 更多类型处理
    return value;
  }
  
  private _reviver(key: string, value: any): any {
    // 反序列化特殊类型
    if (value?.__type === "date") {
      return new Date(value.value);
    }
    if (value?.__type === "map") {
      return new Map(value.value);
    }
    // ... 更多类型处理
    return value;
  }
}
```

### 支持的类型

| 类型 | 序列化方式 |
|------|-----------|
| Date | ISO 字符串 |
| Map | 数组形式 |
| Set | 数组形式 |
| RegExp | 正则字符串 |
| BigInt | 字符串 |
| TypedArray | base64 编码 |
| Error | 错误信息对象 |

## Checkpoint 工作流程

### 完整生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│                      Checkpoint 工作流程                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 图开始执行                                                    │
│     ↓                                                            │
│  2. 获取或创建 checkpoint                                         │
│     ↓                                                            │
│  3. 执行节点                                                       │
│     ↓                                                            │
│  4. 收集节点的输出 (pending writes)                                │
│     ↓                                                            │
│  5. 应用更新到 checkpoint                                         │
│     ↓                                                            │
│  6. 保存新的 checkpoint                                           │
│     ↓                                                            │
│  7. 如果有中断，保存中断状态                                       │
│     ↓                                                            │
│  8. 从 checkpoint 恢复（下次执行）                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 代码流程

```typescript
// Pregel 执行循环中的 checkpoint 处理

async *_execute(
  input: Record<string, any>,
  config: RunnableConfig
): AsyncGenerator<Record<string, any>> {
  // 1. 加载或创建 checkpoint
  let checkpoint = await this.checkpointer.get(config);
  if (!checkpoint) {
    checkpoint = emptyCheckpoint();
  }
  
  // 2. 初始化执行状态
  const state = initializeState(checkpoint);
  
  // 3. 执行循环
  while (true) {
    // 4. 选择下一个节点
    const nextNode = await this._selectNextNode(state);
    
    if (nextNode === END) {
      break;  // 执行结束
    }
    
    // 5. 执行节点
    const output = await this.nodes.get(nextNode).invoke(state, config);
    
    // 6. 收集写入
    const pendingWrites = collectWrites(output);
    
    // 7. 应用更新
    const newCheckpoint = applyWrites(checkpoint, pendingWrites);
    
    // 8. 保存 checkpoint
    const newConfig = await this.checkpointer.put(
      config,
      newCheckpoint,
      { source: "loop", step: stepNumber },
      newVersions
    );
    
    // 9. 发出状态更新
    yield newCheckpoint.channel_values;
    
    checkpoint = newCheckpoint;
    config = newConfig;
  }
}
```

## 与 Pregel 引擎集成

### PregelConfigurable

```typescript
// libs/langgraph-core/src/pregel/types.ts

interface PregelConfigurable {
  // Checkpoint 相关
  [CONFIG_KEY_CHECKPOINTER]: BaseCheckpointSaver;
  [CONFIG_KEY_CHECKPOINT_NS]: string;
  [CONFIG_KEY_CHECKPOINT_ID]: string;
  
  // 执行相关
  [CONFIG_KEY_SEND]: (writes: PendingWrite[]) => void;
  [CONFIG_KEY_READ]: (
    channel: string,
    fresh?: boolean,
    preload?: boolean
  ) => unknown;
  
  // 其他
  [CONFIG_KEY_RESUME_MAP]: Map<string, any>;
  [CONFIG_KEY_SCRATCHPAD]: PregelScratchpad;
  [CONFIG_KEY_STREAM]: StreamMux;
  [CONFIG_KEY_TASK_ID]: string;
}
```

### 检查点触发时机

```typescript
// 在每个步骤后检查是否需要保存 checkpoint

async function _step(checkpoint, tasks): Promise<Checkpoint> {
  // 执行任务
  const results = await Promise.all(tasks.map(executeTask));
  
  // 收集所有写入
  const allWrites = results.flatMap(r => r.writes);
  
  // 应用写入到 checkpoint
  const updated = applyWrites(checkpoint, allWrites);
  
  // 生成新的版本号
  const newVersions = generateNewVersions(checkpoint.channel_versions, allWrites);
  
  return { checkpoint: updated, versions: newVersions };
}
```

## 实践示例

### 示例 1：使用 MemorySaver

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint-memory";

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  counter: Annotation<number>({
    reducer: (_, update) => update ?? 0,
    default: () => 0,
  }),
});

// 创建内存检查点
const memorySaver = new MemorySaver();

// 编译图
const graph = new StateGraph(StateAnnotation)
  .addNode("increment", (state) => ({ counter: state.counter + 1 }))
  .addEdge(START, "increment")
  .compile({ checkpointer: memorySaver });

// 使用
const config = { configurable: { thread_id: "thread-1" } };

// 多次调用
await graph.invoke({}, config);  // counter = 1
await graph.invoke({}, config);  // counter = 2
await graph.invoke({}, config);  // counter = 3

// 查看历史
const history = await graph.checkpointer.list(config);
for await (const checkpoint of history) {
  console.log("Step:", checkpoint.metadata?.step);
  console.log("Counter:", checkpoint.checkpoint.channel_values.counter);
}
```

### 示例 2：中断与恢复

```typescript
import { interrupt, Command } from "@langchain/langgraph";

const ReviewState = Annotation.Root({
  content: Annotation<string>(),
  approved: Annotation<boolean>({ default: () => false }),
});

async function reviewNode(state) {
  // 中断等待人工审核
  const approval = interrupt({
    type: "review",
    content: state.content,
  });
  
  return { approved: approval };
}

const reviewGraph = new StateGraph(ReviewState)
  .addNode("review", reviewNode)
  .addEdge(START, "review")
  .compile({ checkpointer: new MemorySaver() });

const config = { configurable: { thread_id: "review-1" } };

// 第一次调用 - 会中断
await reviewGraph.invoke({ content: "Please review this" }, config);

// 检查中断状态
const state = await reviewGraph.getState(config);
console.log("Interrupts:", state.tasks);

// 恢复执行
await reviewGraph.invoke(
  new Command({ resume: true }),  // 批准
  config
);

console.log("Final state:", await reviewGraph.getState(config));
```

### 示例 3：时间旅行调试

```typescript
// 执行多次
const config = { configurable: { thread_id: "debug-thread" } };

await graph.invoke({ input: "first" }, config);
await graph.invoke({ input: "second" }, config);
await graph.invoke({ input: "third" }, config);

// 获取所有 checkpoints
const checkpoints = [];
for await (const cp of graph.checkpointer.list(config)) {
  checkpoints.push(cp);
}

// 查看历史状态
checkpoints.forEach(cp => {
  console.log(`Step ${cp.metadata?.step}:`, cp.checkpoint.channel_values);
});

// 恢复到一个历史检查点
const oldCheckpoint = checkpoints[1];  // 恢复到第二步
const oldConfig = {
  configurable: {
    thread_id: "debug-thread",
    checkpoint_id: oldCheckpoint.checkpoint.id,
  },
};

const restoredState = await graph.getState(oldConfig);
console.log("Restored state:", restoredState.values);

// 从历史点重新执行
const result = await graph.invoke(
  { input: "modified_input" },
  oldConfig
);
```

### 示例 4：多线程管理

```typescript
interface UserSessionState {
  userId: string;
  messages: BaseMessage[];
  context: any;
}

class SessionManager {
  private graph: CompiledStateGraph;
  
  constructor() {
    this.graph = createAgentGraph().compile({
      checkpointer: new MemorySaver(),
    });
  }
  
  async createSession(userId: string) {
    const threadId = `user-${userId}-${Date.now()}`;
    await this.graph.invoke({}, { configurable: { thread_id: threadId } });
    return threadId;
  }
  
  async sendMessage(threadId: string, message: string) {
    return await this.graph.invoke(
      { messages: [{ role: "user", content: message }] },
      { configurable: { thread_id: threadId } }
    );
  }
  
  async getSessionHistory(threadId: string) {
    const history = [];
    for await (const cp of this.graph.checkpointer.list(
      { configurable: { thread_id: threadId } }
    )) {
      history.push({
        step: cp.metadata?.step,
        state: cp.checkpoint.channel_values,
      });
    }
    return history;
  }
  
  async deleteSession(threadId: string) {
    await this.graph.checkpointer.deleteThread(threadId);
  }
}

// 使用示例
const manager = new SessionManager();

// 创建会话
const threadId = await manager.createSession("user-123");

// 发送消息
await manager.sendMessage(threadId, "Hello");

// 查看历史
const history = await manager.getSessionHistory(threadId);

// 删除会话
await manager.deleteSession(threadId);
```

### 示例 5：自定义元数据

```typescript
const graph = workflow.compile({
  checkpointer: new MemorySaver(),
});

const config = { configurable: { thread_id: "custom-meta" } };

// 带有自定义元数据的调用
await graph.invoke(
  { input: "test" },
  {
    ...config,
    metadata: {
      userId: "user-123",
      sessionId: "session-456",
      experiment: "variant-a",
    },
  }
);

// 按元数据过滤 checkpoints
const userCheckpoints = [];
for await (const cp of graph.checkpointer.list(config, {
  filter: { userId: "user-123" },
})) {
  userCheckpoints.push(cp);
}

// 按实验分组
const experimentCheckpoints = [];
for await (const cp of graph.checkpointer.list(config, {
  filter: { experiment: "variant-a" },
})) {
  experimentCheckpoints.push(cp);
}
```

## 存储后端实现

### MemorySaver

```typescript
// 内存存储实现
export class MemorySaver extends BaseCheckpointSaver {
  #storage: Map<string, Array<CheckpointTuple>> = new Map();
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id, checkpoint_id } = config.configurable;
    const thread = this.#storage.get(thread_id) || [];
    
    if (!checkpoint_id) {
      return thread[thread.length - 1];  // 返回最新的
    }
    
    return thread.find(cp => cp.checkpoint.id === checkpoint_id);
  }
  
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const threadId = config.configurable.thread_id;
    
    let thread = this.#storage.get(threadId);
    if (!thread) {
      thread = [];
      this.#storage.set(threadId, thread);
    }
    
    const tuple: CheckpointTuple = {
      config,
      checkpoint,
      metadata,
      parentConfig: thread.length > 0 ? thread[thread.length - 1].config : undefined,
    };
    
    thread.push(tuple);
    
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
      },
    };
  }
  
  async deleteThread(threadId: string): Promise<void> {
    this.#storage.delete(threadId);
  }
}
```

### 其他存储后端

LangGraph 提供多种官方存储实现：

| 存储 | 包名 | 适用场景 |
|------|------|---------|
| Memory | `@langchain/langgraph-checkpoint-memory` | 开发、测试 |
| Postgres | `@langchain/langgraph-checkpoint-postgres` | 生产、持久化 |
| Redis | `@langchain/langgraph-checkpoint-redis` | 高性能缓存 |
| SQLite | `@langchain/langgraph-checkpoint-sqlite` | 本地存储 |
| MongoDB | `@langchain/langgraph-checkpoint-mongodb` | 文档数据库 |

## 常见问题 FAQ

### Q1: Checkpoint 会占用多少存储空间？

**A**: 取决于状态大小和执行步数。每个 checkpoint 包含：
- channel_values: 当前状态
- channel_versions: 版本号
- versions_seen: 节点版本追踪

建议：
- 定期清理旧 checkpoints
- 使用 MongoDB/Postgres 进行压缩存储
- 不要存储过大的状态对象

### Q2: 如何备份 Checkpoints？

**A**: 取决于存储后端：
- **Postgres**: 使用 `pg_dump`
- **MongoDB**: 使用 `mongodump`
- **Memory**: 导出到文件或数据库

### Q3: Checkpoint 中的 sensitive data 如何处理？

**A**: 
- 在存入前加密敏感字段
- 使用支持加密的存储后端
- 避免在 checkpoint 中存储 API 密钥等

### Q4: 如何迁移 Checkpoint 数据？

**A**: 
```typescript
// 从 Memory 迁移到 Postgres
async function migrateCheckpoints(
  fromSaver: BaseCheckpointSaver,
  toSaver: BaseCheckpointSaver,
  threadId: string
) {
  for await (const cp of fromSaver.list({ configurable: { threadId } })) {
    await toSaver.put(cp.config, cp.checkpoint, cp.metadata, {});
  }
}
```

### Q5: Checkpoint 版本号溢出怎么办？

**A**: 版本号是数字类型，最大值约为 2^53。对于大多数应用来说足够的。如果需要更大范围：
- 使用字符串版本号
- 自定义 `getNextVersion` 方法

## 总结

Checkpoint 系统是 LangGraphJS 状态管理的核心：

- ✅ **灵活存储**：支持多种后端
- ✅ **版本控制**：追踪通道和节点版本
- ✅ **时间旅行**：支持历史状态恢复
- ✅ **中断恢复**：配合 interrupt() 实现人工审核
- ✅ **线程隔离**：多会话独立管理

理解 Checkpoint 系统对于构建可靠的图应用至关重要。

## 参考资料

- [LangGraphJS 源码 - Checkpoint Base](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint/src/base.ts)
- [LangGraph Checkpoint 文档](https://langchain-ai.github.io/langgraphjs/reference/checkpointing/)
- [LangGraph 存储后端指南](https://langchain-ai.github.io/langgraphjs/how-tos/persistence/)