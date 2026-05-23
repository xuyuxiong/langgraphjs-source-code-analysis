# Pregel 系统

## Pregel 模型简介

Pregel 是 Google 提出的大规模图处理框架，专为并行图计算设计。LangGraphJS 将 Pregel 模型适配用于 AI Agent 的执行引擎。

### 原始 Pregel vs LangGraphJS Pregel

| 特性 | Google Pregel | LangGraphJS Pregel |
|------|---------------|-------------------|
| 目标场景 | 大规模图分析 | AI Agent 执行 |
| 图规模 | 数十亿顶点 | 通常<100 节点 |
| 执行模式 | 纯同步 | 同步 + 异步混合 |
| 持久化 | 可选 | 核心特性 |
| 中断恢复 | 不支持 | 原生支持 |

## Pregel 核心概念

### 1. 超级步骤（Superstep）

Pregel 计算以超级步骤为单位进行：

```
┌─────────────────────────────────────────────────────┐
│                  Superstep N                         │
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │ Vertex 1 │   │ Vertex 2 │   │ Vertex 3 │        │
│  │  (Node)  │   │  (Node)  │   │  (Node)  │        │
│  │          │   │          │   │          │        │
│  │ 读取输入  │   │ 读取输入  │   │ 读取输入  │        │
│  │ 计算     │   │ 计算     │   │ 计算     │        │
│  │ 发送消息  │   │ 发送消息  │   │ 发送消息  │        │
│  └──────────┘   └──────────┘   └──────────┘        │
│                                                      │
│  ═══════════════════════════════════════════════    │
│                    同步屏障                           │
│  ═══════════════════════════════════════════════    │
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │ Vertex 4 │   │ Vertex 5 │   │ Vertex 6 │        │
│  │  (Node)  │   │  (Node)  │   │  (Node)  │        │
│  └──────────┘   └──────────┘   └──────────┘        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 2. 节点（Vertex/Node）

```typescript
// 在 LangGraphJS 中的对应概念
interface PregelNode {
  channels: Record<string, string>;  // 订阅的通道
  triggers: string[];                // 触发条件
  tags?: string[];                   // 标签
}
```

### 3. 通道（Channel）

节点间通信的抽象，类似于消息队列：

```typescript
interface BaseChannel {
  // 更新值
  update(values: UpdateType[]): boolean;
  
  // 获取值
  get(): ValueType;
  
  // 检查是否可用
  isAvailable(): boolean;
}
```

## PregelLoop 实现

### 类结构

```typescript
// libs/langgraph-core/src/pregel/loop.ts
export class PregelLoop {
  // 状态
  step: number = 0;
  checkpoint: Checkpoint;
  channels: Record<string, BaseChannel>;
  
  // 配置
  config: LangGraphRunnableConfig;
  inputConfig: LangGraphRunnableConfig;
  
  // 节点和通道规范
  specs: PregelSpecs;
  
  // 核心方法
  async *transform(
    input: ReadableStream<Record<string, unknown>>
  ): AsyncGenerator<PregelLoopOutput> {
    // 执行循环主体
  }
  
  async _prepareNextTasks(): Promise<PregelExecutableTask[]> {
    // 准备下一个任务
  }
  
  async _applyWrites(
    writes: [string, any][]
  ): Promise<void> {
    // 应用写入
  }
}
```

### 执行循环详解

```typescript
async *transform(
  input: ReadableStream<Record<string, unknown>>
): AsyncGenerator<PregelLoopOutput> {
  // 1. 读取输入
  let inputChunks = [];
  for await (const chunk of input) {
    inputChunks.push(chunk);
  }
  const inputValues = this._mapInput(inputChunks);
  
  // 2. 初始化
  this.checkpoint = await this._loadCheckpoint();
  this.channels = this._createChannels(this.checkpoint);
  
  // 3. 应用输入到通道
  this._applyInput(inputValues);
  
  // 4. 主执行循环
  while (true) {
    // a) 准备任务
    const tasks = await this._prepareNextTasks();
    
    // b) 检查结束条件
    if (tasks.length === 0) {
      // 无任务可执行，结束
      break;
    }
    
    // c) 检查递归限制
    if (this.step >= this.recursionLimit) {
      throw new GraphRecursionError(
        `Recursion limit of ${this.recursionLimit} reached`
      );
    }
    
    // d) 产生当前步骤
    yield {
      tasks,
      checkpoint: this.checkpoint,
      step: this.step,
      stop: this.stop
    };
    
    // e) 等待任务执行完成（在 PregelRunner 中）
    // 实际执行由外部 runner 完成
    
    // f) 应用任务写入
    await this._applyWrites(tasks);
    
    // g) 更新检查点
    this.checkpoint = createCheckpoint(
      this.checkpoint,
      this.channels,
      this.step
    );
    
    // h) 步数 +1
    this.step++;
  }
  
  // 5. 结束
  yield {
    tasks: [],
    checkpoint: this.checkpoint,
    step: this.step,
    stop: true
  };
}
```

### _prepareNextTasks 实现

```typescript
async _prepareNextTasks(): Promise<PregelExecutableTask[]> {
  const tasks: PregelExecutableTask[] = [];
  
  // 遍历所有节点
  for (const [name, node] of Object.entries(this.nodes)) {
    // 检查节点是否应该触发
    const shouldTrigger = this._shouldNodeTrigger(name);
    
    if (!shouldTrigger) continue;
    
    // 准备输入
    const input = await this._readNodeInput(node);
    
    // 创建可执行任务
    tasks.push({
      name,
      input,
      runnable: node.runnable,
      config: this._createTaskConfig(name),
      writes: [],
      triggers: node.triggers
    });
  }
  
  // 处理定时任务（SCHEDULED）
  const scheduledTasks = this._getScheduledTasks();
  tasks.push(...scheduledTasks);
  
  return tasks;
}

_shouldNodeTrigger(nodeName: string): boolean {
  const node = this.nodes[nodeName];
  
  // 检查任意触发通道是否可用
  return node.triggers.some(channelName => {
    const channel = this.channels[channelName];
    return channel?.isAvailable() ?? false;
  });
}

async _readNodeInput(node: PregelNode): Promise<unknown> {
  const input: Record<string, unknown> = {};
  
  for (const [key, channelName] of Object.entries(node.channels)) {
    try {
      input[key] = this.channels[channelName].get();
    } catch (e) {
      if (e instanceof EmptyChannelError) {
        input[key] = undefined;
      } else {
        throw e;
      }
    }
  }
  
  // 如果是单通道订阅，直接返回值
  if (Array.isArray(node.channels)) {
    return input[0];
  }
  
  return input;
}
```

## PregelRunner 实现

### 执行器类

```typescript
// libs/langgraph-core/src/pregel/runner.ts
export class PregelRunner {
  async *executeTasks(
    tasks: PregelExecutableTask[],
    options: ExecuteOptions
  ): AsyncGenerator<void> {
    const { 
      taskConfigs, 
      stream, 
      retryPolicy 
    } = options;
    
    // 并发执行所有任务
    const promises = tasks.map(async (task, idx) => {
      const config = {
        ...task.config,
        ...taskConfigs?.[idx]
      };
      
      try {
        // 执行任务
        const output = await this._executeWithRetry(
          task.runnable,
          task.input,
          config,
          retryPolicy
        );
        
        // 记录成功
        task.writes.push([TASKS, output]);
        
        // 流式输出
        if (stream) {
          await this._streamOutput(task, output);
        }
        
      } catch (error) {
        // 记录错误
        task.writes.push([ERROR, error]);
        
        // 流式错误
        if (stream) {
          await this._streamError(task, error);
        }
      }
    });
    
    // 等待所有任务完成
    await Promise.allSettled(promises);
    
    // 检查是否有未处理的错误
    for (const task of tasks) {
      const errorWrite = task.writes.find(w => w[0] === ERROR);
      if (errorWrite) {
        throw errorWrite[1];
      }
    }
  }
  
  async _executeWithRetry(
    runnable: Runnable,
    input: unknown,
    config: RunnableConfig,
    retryPolicy?: RetryPolicy
  ): Promise<unknown> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; ; attempt++) {
      try {
        return await runnable.invoke(input, config);
      } catch (error) {
        lastError = error;
        
        // 检查是否应该重试
        if (!retryPolicy || !this._shouldRetry(error, attempt)) {
          throw error;
        }
        
        // 等待重试间隔
        const delay = retryPolicy.initialInterval * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
}
```

### 并发控制

```typescript
async executeTasks(
  tasks: PregelExecutableTask[],
  options: ExecuteOptions
) {
  const semaphore = new Semaphore(options.maxConcurrency ?? Infinity);
  
  const promises = tasks.map(async (task) => {
    // 获取并发许可
    await semaphore.acquire();
    
    try {
      return await this._executeTask(task);
    } finally {
      // 释放许可
      semaphore.release();
    }
  });
  
  await Promise.all(promises);
}

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  
  constructor(private maxPermits: number) {
    this.permits = maxPermits;
  }
  
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    
    // 等待许可
    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }
  
  release(): void {
    this.permits++;
    if (this.queue.length > 0) {
      const resolve = this.queue.shift()!;
      this.permits--;
      resolve();
    }
  }
}
```

## 通道算法

### _applyWrites 实现

```typescript
// libs/langgraph-core/src/pregel/algo.ts
export function _applyWrites(
  checkpoint: Checkpoint,
  channels: Record<string, BaseChannel>,
  tasks: PregelExecutableTask[]
): void {
  // 收集所有写入
  const writesByChannel: Record<string, unknown[]> = {};
  
  for (const task of tasks) {
    for (const [channel, value] of task.writes) {
      if (!writesByChannel[channel]) {
        writesByChannel[channel] = [];
      }
      writesByChannel[channel].push(value);
    }
  }
  
  // 应用到通道
  for (const [channelName, values] of Object.entries(writesByChannel)) {
    const channel = channels[channelName];
    if (channel) {
      channel.update(values);
    }
  }
  
  // 更新版本
  for (const [channelName] of Object.entries(writesByChannel)) {
    checkpoint.channel_versions[channelName] = 
      (checkpoint.channel_versions[channelName] || 0) + 1;
  }
}
```

### 通道版本管理

```typescript
interface Checkpoint {
  // 通道值
  channel_values: Record<string, unknown>;
  
  // 通道版本（每次更新递增）
  channel_versions: Record<string, number>;
  
  // 节点已看到的版本
  versions_seen: Record<string, Record<string, number>>;
}

// 检查节点是否应该触发
function _shouldNodeTrigger(
  node: PregelNode,
  checkpoint: Checkpoint
): boolean {
  const lastSeen = checkpoint.versions_seen[node.name] ?? {};
  
  return node.triggers.some(channel => {
    const currentVersion = checkpoint.channel_versions[channel] ?? 0;
    const seenVersion = lastSeen[channel] ?? 0;
    return currentVersion > seenVersion;
  });
}
```

## 输入输出映射

### mapInput

```typescript
// libs/langgraph-core/src/pregel/io.ts
export function mapInput(
  inputChannels: Record<string, string> | string[],
  input: unknown
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  
  if (Array.isArray(inputChannels)) {
    // 数组形式：直接映射
    if (Array.isArray(input)) {
      for (let i = 0; i < inputChannels.length; i++) {
        mapped[inputChannels[i]] = input[i];
      }
    } else {
      mapped[inputChannels[0]] = input;
    }
  } else {
    // 对象形式：键值映射
    for (const [key, channel] of Object.entries(inputChannels)) {
      if (typeof input === 'object' && input !== null) {
        mapped[channel] = (input as Record<string, unknown>)[key];
      }
    }
  }
  
  return mapped;
}
```

### readChannels

```typescript
export function readChannels(
  channels: Record<string, BaseChannel>,
  selector: string | string[] | Record<string, string>
): unknown {
  if (typeof selector === 'string') {
    // 单通道
    return channels[selector].get();
  }
  
  if (Array.isArray(selector)) {
    // 多通道数组
    return selector.map(key => channels[key].get());
  }
  
  // 对象选择器
  const result: Record<string, unknown> = {};
  for (const [key, channelName] of Object.entries(selector)) {
    result[key] = channels[channelName].get();
  }
  return result;
}
```

## 调试与日志

### 调试输出

```typescript
// libs/langgraph-core/src/pregel/debug.ts
export function printStepCheckpoint(
  step: number,
  checkpoint: Checkpoint,
  channels: Record<string, BaseChannel>
): void {
  console.log(`\n=== Step ${step} ===`);
  console.log('Checkpoint:', {
    id: checkpoint.id,
    ts: checkpoint.ts,
    versions: checkpoint.channel_versions
  });
}

export function printStepTasks(
  step: number,
  tasks: PregelExecutableTask[]
): void {
  console.log(`\n--- Step ${step} Tasks ---`);
  for (const task of tasks) {
    console.log(`  ${task.name}:`, {
      input: truncate(task.input),
      triggers: task.triggers
    });
  }
}

export function printStepWrites(
  step: number,
  writes: [string, unknown][],
  channels: Record<string, BaseChannel>
): void {
  console.log(`\n>>> Step ${step} Writes >>>`);
  for (const [channel, value] of writes) {
    console.log(`  ${channel}:`, truncate(value));
  }
}

function truncate(value: unknown, maxLength = 100): string {
  const str = JSON.stringify(value);
  if (str.length > maxLength) {
    return str.slice(0, maxLength) + '...';
  }
  return str;
}
```

## 性能优化

### 1. 增量更新

```typescript
// 只处理有变化的通道
async _prepareNextTasks(): Promise<PregelExecutableTask[]> {
  const tasks: PregelExecutableTask[] = [];
  
  for (const [name, node] of Object.entries(this.nodes)) {
    // 增量检查：只看新版本的通道
    const hasNewVersion = node.triggers.some(channel => {
      const current = this.checkpoint.channel_versions[channel];
      const seen = this.checkpoint.versions_seen[name]?.[channel] ?? 0;
      return current > seen;
    });
    
    if (!hasNewVersion) continue;
    
    // ... 创建任务
  }
  
  return tasks;
}
```

### 2. 缓存节点输入

```typescript
class NodeInputCache {
  private cache = new Map<string, {
    version: number;
    input: unknown;
  }>();
  
  getInput(
    node: PregelNode,
    channels: Record<string, BaseChannel>,
    versions: Record<string, number>
  ): unknown {
    const cacheKey = this._createCacheKey(node, versions);
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached.input;
    }
    
    // 重新计算
    const input = this._readInput(node, channels);
    this.cache.set(cacheKey, { version: this._getMaxVersion(versions), input });
    return input;
  }
}
```

### 3. 批量处理

```typescript
// 批量应用写入
async _applyWrites(tasks: PregelExecutableTask[]): Promise<void> {
  // 收集所有写入
  const batchWrites = new Map<string, unknown[]>();
  
  for (const task of tasks) {
    for (const [channel, value] of task.writes) {
      if (!batchWrites.has(channel)) {
        batchWrites.set(channel, []);
      }
      batchWrites.get(channel)!.push(value);
    }
  }
  
  // 批量更新通道
  const updatePromises = [];
  for (const [channel, values] of batchWrites) {
    updatePromises.push(this.channels[channel].update(values));
  }
  
  await Promise.all(updatePromises);
}
```

## 错误恢复

### Checkpoint 恢复

```typescript
async _loadCheckpoint(): Promise<Checkpoint> {
  if (this.checkpointer) {
    try {
      const saved = await this.checkpointer.get(this.config);
      if (saved) {
        return saved;
      }
    } catch (error) {
      console.warn('Failed to load checkpoint, starting fresh:', error);
    }
  }
  
  // 创建新检查点
  return emptyCheckpoint();
}

async recoverFromCheckpoint(
  checkpoint: Checkpoint,
  config: RunnableConfig
): Promise<void> {
  // 恢复通道
  this.channels = this._createChannels(checkpoint);
  
  // 恢复步数
  this.step = this._extractStepFromCheckpoint(checkpoint);
  
  // 恢复版本
  this.checkpoint = checkpoint;
}
```

## 小结

本节深入解析了 LangGraphJS 的 Pregel 系统实现：

- ✅ Pregel 模型核心概念
- ✅ PregelLoop 执行循环详解
- ✅ PregelRunner 任务执行器
- ✅ 通道算法实现
- ✅ 输入输出映射
- ✅ 调试与日志
- ✅ 性能优化技术
- ✅ 错误恢复机制

接下来我们将深入通道机制的具体实现。

## 下一章

- [通道机制](/architecture/channel) - Channel 类型、状态管理
- [状态管理](/architecture/state) - 状态机、中断、恢复
- [Checkpoint 机制](/architecture/checkpoint) - 持久化、时间旅行