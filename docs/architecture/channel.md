# 通道机制

通道（Channel）是 LangGraphJS 中节点间通信的核心抽象，负责管理和传递状态。理解通道机制是掌握 LangGraphJS 的关键。

## 通道基础

### BaseChannel 抽象类

```typescript
// libs/langgraph-core/src/channels/base.ts
export abstract class BaseChannel<
  ValueType = unknown,      // 值的类型（读取时返回）
  UpdateType = unknown,     // 更新类型（update 方法接收）
  CheckpointType = unknown  // 检查点类型（序列化用）
> {
  ValueType: ValueType;
  UpdateType: UpdateType;
  
  /** 通道名称 */
  abstract lc_graph_name: string;
  
  /** 标识这是一个通道 */
  lg_is_channel = true;
  
  /** 从检查点恢复 */
  abstract fromCheckpoint(checkpoint?: CheckpointType): this;
  
  /** 更新通道值 */
  abstract update(values: UpdateType[]): boolean;
  
  /** 获取当前值 */
  abstract get(): ValueType;
  
  /** 创建检查点 */
  abstract checkpoint(): CheckpointType | undefined;
  
  /** 消耗值（可选） */
  consume(): boolean {
    return false;
  }
  
  /** 通知完成（可选） */
  finish(): boolean {
    return false;
  }
  
  /** 检查是否可用 */
  isAvailable(): boolean {
    try {
      this.get();
      return true;
    } catch (error) {
      if (error.name === EmptyChannelError.unminifiable_name) {
        return false;
      }
      throw error;
    }
  }
}
```

### 通道生命周期

```
创建 ──► 更新 ──► 读取 ──► 检查点 ──► 消耗/完成
  │        │       │         │           │
  │        │       │         │           └──► 销毁
  │        │       │         │
  │        │       │         └──► 持久化
  │        │       │
  │        │       └──► 节点读取
  │        │
  │        └──► 节点写入
  │
  └──► 从检查点恢复
```

## 通道类型详解

### 1. LastValue（最后值）

最简单的通道类型，只保留最后一个值：

```typescript
// libs/langgraph-core/src/channels/last_value.ts
export class LastValue<
  ValueType = unknown,
  UpdateType = ValueType
> extends BaseChannel<ValueType, UpdateType, ValueType> {
  lc_graph_name = "LastValue";
  
  value?: ValueType;
  
  fromCheckpoint(checkpoint?: ValueType): this {
    const empty = new LastValue<ValueType, UpdateType>();
    if (checkpoint !== undefined) {
      empty.value = checkpoint;
    }
    return empty as this;
  }
  
  update(values: UpdateType[]): boolean {
    if (values.length === 0) return false;
    // 取最后一个值
    this.value = values[values.length - 1] as unknown as ValueType;
    return true;
  }
  
  get(): ValueType {
    if (this.value === undefined) {
      throw new EmptyChannelError("LastValue channel is empty");
    }
    return this.value;
  }
  
  checkpoint(): ValueType | undefined {
    return this.value;
  }
  
  // 完成后保留值
  finish(): boolean {
    return false; // 不改变状态
  }
}

// 完成后保留最后值的变体
export class LastValueAfterFinish<
  ValueType,
  UpdateType = ValueType
> extends LastValue<ValueType, UpdateType> {
  fromCheckpoint(checkpoint?: ValueType): this {
    const empty = new LastValueAfterFinish<ValueType, UpdateType>();
    if (checkpoint !== undefined) {
      empty.value = checkpoint;
    }
    return empty as this;
  }
  
  finish(): boolean {
    // 完成后清空
    this.value = undefined;
    return true;
  }
}
```

**使用场景：**
- 存储单个状态值
- 配置参数
- 当前步骤标识

```typescript
const workflow = new StateGraph<{
  currentStep: string;
  config: ConfigType;
}>({
  channels: {
    currentStep: { reducer: (x, y) => y },  // LastValue 行为
    config: { reducer: (x, y) => y }
  }
});
```

### 2. AnyValue（任意值）

接受任何值，成功读取后清空：

```typescript
// libs/langgraph-core/src/channels/any_value.ts
export class AnyValue<ValueType = unknown> extends BaseChannel<
  ValueType,
  ValueType,
  ValueType
> {
  lc_graph_name = "AnyValue";
  
  value?: ValueType;
  
  fromCheckpoint(checkpoint?: ValueType): this {
    const empty = new AnyValue<ValueType>();
    if (checkpoint !== undefined) {
      empty.value = checkpoint;
    }
    return empty as this;
  }
  
  update(values: ValueType[]): boolean {
    if (values.length === 0) return false;
    // 取第一个非 undefined 值
    this.value = values.find(v => v !== undefined);
    return this.value !== undefined;
  }
  
  get(): ValueType {
    if (this.value === undefined) {
      throw new EmptyChannelError("AnyValue channel is empty");
    }
    return this.value;
  }
  
  checkpoint(): ValueType | undefined {
    return this.value;
  }
  
  // 读取后清空
  consume(): boolean {
    this.value = undefined;
    return true;
  }
}
```

**使用场景：**
- 一次性事件
- 触发信号
- 临时数据

### 3. BinaryOperator（二元操作聚合）

使用二元操作符聚合多个更新：

```typescript
// libs/langgraph-core/src/channels/binop.ts
export class BinaryOperatorAggregate<
  ValueType,
  UpdateType = ValueType
> extends BaseChannel<ValueType, UpdateType, ValueType> {
  lc_graph_name = "BinaryOperatorAggregate";
  
  value?: ValueType;
  operator: (a: ValueType, b: UpdateType) => ValueType;
  
  constructor(operator: (a: ValueType, b: UpdateType) => ValueType) {
    super();
    this.operator = operator;
  }
  
  fromCheckpoint(checkpoint?: ValueType): this {
    const empty = new BinaryOperatorAggregate<ValueType, UpdateType>(
      this.operator
    );
    if (checkpoint !== undefined) {
      empty.value = checkpoint;
    }
    return empty as this;
  }
  
  update(values: UpdateType[]): boolean {
    let updated = false;
    for (const value of values) {
      if (this.value === undefined) {
        this.value = value as unknown as ValueType;
      } else {
        this.value = this.operator(this.value, value);
      }
      updated = true;
    }
    return updated;
  }
  
  get(): ValueType {
    if (this.value === undefined) {
      throw new EmptyChannelError("BinaryOperatorAggregate channel is empty");
    }
    return this.value;
  }
  
  checkpoint(): ValueType | undefined {
    return this.value;
  }
}
```

**使用场景：**
- 消息累加
- 数值计算
- 状态合并

```typescript
// 消息追加示例
const workflow = new StateGraph<{
  messages: BaseMessage[];
}>({
  channels: {
    messages: {
      reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
      default: () => []
    }
  }
});

// 计数器示例
const counterChannel = new BinaryOperatorAggregate<number, number>(
  (a, b) => a + b
);
counterChannel.update([1, 2, 3]);  // value = 6
```

### 4. Topic（主题通道）

消息队列式的通道，支持发布 - 订阅模式：

```typescript
// libs/langgraph-core/src/channels/topic.ts
export class Topic<ValueType = unknown> extends BaseChannel<
  ValueType[],
  ValueType,
  ValueType[]
> {
  lc_graph_name = "Topic";
  
  items: ValueType[] = [];
  accumulate: boolean;
  
  constructor(accumulate = false) {
    super();
    this.accumulate = accumulate;  // 是否累积消息
  }
  
  fromCheckpoint(checkpoint?: ValueType[]): this {
    const empty = new Topic<ValueType>(this.accumulate);
    if (checkpoint !== undefined) {
      empty.items = [...checkpoint];
    }
    return empty as this;
  }
  
  update(values: ValueType[]): boolean {
    if (values.length === 0 && !this.accumulate) return false;
    this.items.push(...values);
    return true;
  }
  
  get(): ValueType[] {
    if (this.items.length === 0) {
      throw new EmptyChannelError("Topic channel is empty");
    }
    return [...this.items];
  }
  
  checkpoint(): ValueType[] | undefined {
    if (this.items.length === 0) return undefined;
    return [...this.items];
  }
  
  // 消费后清空
  consume(): boolean {
    if (this.items.length === 0) return false;
    this.items = [];
    return true;
  }
}
```

**使用场景：**
- 事件总线
- 消息队列
- 广播通知

```typescript
// 多 Agent 事件广播
const eventTopic = new Topic<AgentEvent>();

// Agent A 发布事件
eventTopic.update([{ type: 'decision', agent: 'A' }]);

// Agent B 和 C 订阅
const events = eventTopic.get();  // 获取所有事件
eventTopic.consume();  // 清空队列
```

### 5. NamedBarrierValue（命名屏障值）

等待特定命名的值到达后才释放：

```typescript
// libs/langgraph-core/src/channels/named_barrier_value.ts
export class NamedBarrierValue<
  ValueType,
  NameType = string
> extends BaseChannel<ValueType, ValueType, { value?: ValueType }> {
  lc_graph_name = "NamedBarrierValue";
  
  value?: ValueType;
  seen: Set<NameType> = new Set();
  namesToTrigger: Set<NameType>;
  
  constructor(namesToTrigger: Set<NameType>) {
    super();
    this.namesToTrigger = namesToTrigger;
  }
  
  fromCheckpoint(checkpoint?: { value?: ValueType }): this {
    const empty = new NamedBarrierValue<ValueType, NameType>(
      this.namesToTrigger
    );
    if (checkpoint?.value !== undefined) {
      empty.value = checkpoint.value;
    }
    return empty as this;
  }
  
  update(values: ValueType[]): boolean {
    for (const value of values) {
      // 检查是否是需要等待的命名值
      // ...
    }
    return this.value !== undefined;
  }
  
  get(): ValueType {
    if (this.value === undefined) {
      throw new EmptyChannelError("NamedBarrierValue channel is empty");
    }
    return this.value;
  }
  
  checkpoint(): { value?: ValueType } | undefined {
    if (this.value === undefined) return undefined;
    return { value: this.value };
  }
}
```

**使用场景：**
- 等待多个条件满足
- 同步多个节点
- 门控机制

### 6. EphemeralValue（临时值）

不被检查点保存的临时值：

```typescript
// libs/langgraph-core/src/channels/ephemeral_value.ts
export class EphemeralValue<ValueType = unknown> 
  extends LastValue<ValueType> {
  lc_graph_name = "EphemeralValue";
  
  checkpoint(): undefined {
    // 不保存检查点
    return undefined;
  }
  
  fromCheckpoint(): this {
    // 从检查点恢复时总是为空
    return new EphemeralValue<ValueType>() as this;
  }
}
```

**使用场景：**
- 临时计算结果
- 不需要持久化的数据
- 敏感信息

## 通道组合

### 状态定义中的通道

```typescript
// 定义状态时使用 reducer 指定通道行为
interface State {
  messages: BaseMessage[];      // 消息列表
  currentStep: string;           // 当前步骤
  retries: number;               // 重试次数
  config: ConfigType;            // 配置
}

const stateSchema = {
  messages: {
    reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
    default: () => []
  },
  currentStep: {
    reducer: (x: string, y: string) => y,  // LastValue
    default: () => "__start__"
  },
  retries: {
    reducer: (x: number, y: number) => y,
    default: () => 0
  },
  config: {
    reducer: (x: ConfigType, y: ConfigType) => ({ ...x, ...y }),
    default: () => ({})
  }
};
```

### Annotation 系统

```typescript
// libs/langgraph-core/src/graph/annotation.ts
export function Annotation<T>(): AnnotationRoot<T> {
  return class AnnotationRoot {
    __LG_ANNOTATION_SYMBOL = Symbol();
  };
}

// 使用示例
const StateAnnotation = Annotation<State>();

class MyAnnotation extends StateAnnotation {
  static messages = Annotation<BaseMessage[]>()
    .reducer((x, y) => x.concat(y));
  
  static currentStep = Annotation<string>()
    .reducer((x, y) => y)
    .default(() => "__start__");
}

// 创建 StateGraph
const workflow = new StateGraph(MyAnnotation.spec);
```

## 通道读写机制

### ChannelRead（读取）

```typescript
// libs/langgraph-core/src/pregel/read.ts
export class ChannelRead {
  static doRead<S>(
    channels: Record<string, string> | string[],
    config: RunnableConfig
  ): Promise<S> {
    // 从配置中获取通道管理器
    const channelManager = config.configurable?.[CONFIG_KEY_READ];
    
    if (Array.isArray(channels)) {
      // 读取多个通道
      return Promise.all(
        channels.map(ch => channelManager(ch))
      ) as Promise<S>;
    }
    
    // 读取单个通道
    return channelManager(channels) as Promise<S>;
  }
}
```

### ChannelWrite（写入）

```typescript
// libs/langgraph-core/src/pregel/write.ts
export const PASSTHROUGH = Symbol.for("langchain_passthrough");

export class ChannelWrite<
  RunInput = unknown,
  RunOutput = unknown
> extends Runnable<RunInput, RunOutput> {
  writes: ChannelWriteEntry[];
  
  constructor(writes: ChannelWriteEntry[]) {
    super();
    this.writes = writes;
  }
  
  async invoke(input: RunInput, config?: RunnableConfig): Promise<RunOutput> {
    // 收集写入
    const writes: [string, unknown][] = [];
    
    for (const write of this.writes) {
      let value: unknown;
      
      if (write.value === PASSTHROUGH) {
        value = input;
      } else if (typeof write.value === 'function') {
        value = await write.value(input);
      } else {
        value = write.value;
      }
      
      writes.push([write.channel, value]);
    }
    
    // 应用写入
    const channelManager = config.configurable?.[CONFIG_KEY_SEND];
    channelManager?.(writes);
    
    return input as RunOutput;
  }
}

interface ChannelWriteEntry {
  channel: string;
  value: unknown | ((input: unknown) => unknown);
}
```

## 通道版本控制

```typescript
interface Checkpoint {
  channel_values: Record<string, unknown>;      // 通道值
  channel_versions: Record<string, number>;     // 通道版本
  versions_seen: Record<string, Record<string, number>>; // 节点已见版本
}

// 版本更新逻辑
function updateChannelVersions(
  checkpoint: Checkpoint,
  updatedChannels: string[]
): void {
  for (const channel of updatedChannels) {
    checkpoint.channel_versions[channel] = 
      (checkpoint.channel_versions[channel] ?? 0) + 1;
  }
}

// 检查节点是否应该触发
function shouldNodeTrigger(
  node: PregelNode,
  checkpoint: Checkpoint
): boolean {
  const seen = checkpoint.versions_seen[node.name] ?? {};
  
  return node.triggers.some(channel => {
    const current = checkpoint.channel_versions[channel] ?? 0;
    const lastSeen = seen[channel] ?? 0;
    return current > lastSeen;  // 有新版本
  });
}
```

## 通道生命周期管理

### 完成后行为

```typescript
// 某些通道在图完成后有特殊行为
class LastValueAfterFinish<ValueType> extends LastValue<ValueType> {
  finish(): boolean {
    // 完成后清空值
    this.value = undefined;
    return true;
  }
}

class TopicAfterFinish<ValueType> extends Topic<ValueType> {
  finish(): boolean {
    // 完成后保留消息
    return false;
  }
}
```

### 消费语义

```typescript
// 可消费的通道
class ConsumableValue<ValueType> extends BaseChannel<ValueType> {
  value?: ValueType;
  
  consume(): boolean {
    if (this.value === undefined) return false;
    this.value = undefined;
    return true;
  }
}

// 使用示例
const workflow = new StateGraph<{ trigger: TriggerType }>();
const app = workflow.compile();

// 每次读取后自动清空
for await (const chunk of app.stream(input)) {
  // trigger 通道在被读取后会自动清空
  console.log(chunk);
}
```

## 实际案例分析

### 消息历史通道

```typescript
interface AgentState {
  messages: BaseMessage[];
}

// 消息追加 reducer
function messagesStateReducer(
  x: BaseMessage[],
  y: BaseMessage[] | BaseMessage
): BaseMessage[] {
  // 处理单个消息
  if (!Array.isArray(y)) {
    return [...x, y];
  }
  
  // 处理消息数组
  return [...x, ...y];
}

const workflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      reducer: messagesStateReducer,
      default: () => []
    }
  }
});
```

### 中断通道

```typescript
interface InterruptState {
  pendingInterrupts: Interrupt[];
  resumeValue?: unknown;
}

// 中断通道实现
class InterruptChannel extends BaseChannel<Interrupt[], Interrupt> {
  interrupts: Interrupt[] = [];
  
  update(values: Interrupt[]): boolean {
    this.interrupts.push(...values);
    return true;
  }
  
  get(): Interrupt[] {
    if (this.interrupts.length === 0) {
      throw new EmptyChannelError("No pending interrupts");
    }
    return [...this.interrupts];
  }
  
  clear(): void {
    this.interrupts = [];
  }
}
```

## 性能考虑

### 1. 浅拷贝 vs 深拷贝

```typescript
// LastValue 使用浅拷贝
fromCheckpoint(checkpoint?: ValueType): this {
  const empty = new LastValue();
  if (checkpoint !== undefined) {
    // 对于对象类型，可能需要深拷贝
    empty.value = checkpoint;  // 或 structuredClone(checkpoint)
  }
  return empty as this;
}
```

### 2. 批量更新优化

```typescript
// 批量应用更新
update(values: UpdateType[]): boolean {
  if (values.length === 0) return false;
  
  // 合并多个更新
  const merged = this.mergeUpdates(values);
  this.value = merged;
  return true;
}

// Topic 批量的例子
update(values: ValueType[]): boolean {
  // 使用批量 push 而非逐个添加
  this.items.push(...values);
  return true;
}
```

### 3. 延迟计算

```typescript
// 只在需要时计算值
class LazyChannel<ValueType> extends BaseChannel<ValueType> {
  private _value?: ValueType;
  private _dirty = false;
  
  update(values: ValueType[]): boolean {
    this._dirty = true;  // 标记需要重新计算
    // ... 存储更新
    return true;
  }
  
  get(): ValueType {
    if (this._dirty) {
      this._value = this.computeValue();
      this._dirty = false;
    }
    return this._value!;
  }
}
```

## 小结

本节深入解析了 LangGraphJS 的通道机制：

- ✅ BaseChannel 抽象类与生命周期
- ✅ 六种核心通道类型详解
- ✅ 通道组合与 Annotation 系统
- ✅ 通道读写机制
- ✅ 版本控制与触发机制
- ✅ 实际案例分析
- ✅ 性能优化考虑

掌握了通道机制后，我们将学习状态管理和中断恢复机制。

## 下一章

- [状态管理](/architecture/state) - 状态机、中断、恢复
- [Checkpoint 机制](/architecture/checkpoint) - 持久化、时间旅行
- [核心篇 - Pregel 引擎](/core/pregel-engine)