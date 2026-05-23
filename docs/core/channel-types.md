# Channel 类型 - 通道实现详解

## 概述

在 LangGraphJS 中，Channel（通道）是节点之间通信的核心机制。通道负责存储和管理状态值，定义了如何接收更新、如何读取值、以及如何持久化状态。LangGraphJS 提供了多种通道类型，每种类型都有其特定的使用场景和行为特征。

## 通道基础

### 通道接口

所有通道类型都继承自 `BaseChannel` 抽象类，该类定义了一组核心方法：

```typescript
abstract class BaseChannel<ValueType, UpdateType, CheckpointType> {
  /**
   * 从检查点创建一个新的通道实例
   * 用于恢复之前的状态
   */
  abstract fromCheckpoint(checkpoint?: CheckpointType): this;
  
  /**
   * 用一系列更新值更新通道
   * @param values 更新值数组
   * @returns 是否发生了变化
   */
  abstract update(values: UpdateType[]): boolean;
  
  /**
   * 获取通道的当前值
   * @throws EmptyChannelError 如果通道为空
   */
  abstract get(): ValueType;
  
  /**
   * 获取通道的检查点表示（用于持久化）
   * @throws EmptyChannelError 如果通道不支持检查点
   */
  abstract checkpoint(): CheckpointType | undefined;
  
  /**
   * 消耗当前值（某些通道类型使用）
   */
  consume(): boolean { return false; }
  
  /**
   * 标记 Pregel 运行结束（某些通道类型使用）
   */
  finish(): boolean { return false; }
}
```

### 类型参数

通道使用三个类型参数来表示不同的值类型：

- `ValueType`: 通道的输出类型（读取时返回的类型）
- `UpdateType`: 通道的输入类型（节点返回的更新类型）
- `CheckpointType`: 检查点类型（持久化时的类型）

这三个类型可以相同，也可以不同，取决于通道的具体实现。

## 核心通道类型

### 1. LastValue - 最后值通道

`LastValue` 是最简单的通道类型，存储最后一次接收到的值。

#### 源码分析

```typescript
export class LastValue<Value> extends BaseChannel<Value, Value, Value> {
  lc_graph_name = "LastValue";
  
  // value 是数组形式，避免将 undefined 误解为无写入
  value: [Value] | [] = [];

  constructor(protected initialValueFactory?: () => Value) {
    super();
    if (initialValueFactory) {
      this.value = [initialValueFactory()];
    }
  }

  fromCheckpoint(checkpoint?: Value) {
    const empty = new LastValue<Value>(this.initialValueFactory);
    if (typeof checkpoint !== "undefined") {
      empty.value = [checkpoint];
    }
    return empty as this;
  }

  update(values: Value[]): boolean {
    if (values.length === 0) {
      return false;
    }
    // LastValue 每个 step 只能接收一个值
    if (values.length !== 1) {
      throw new InvalidUpdateError(
        "LastValue can only receive one value per step.",
        { lc_error_code: "INVALID_CONCURRENT_GRAPH_UPDATE" }
      );
    }
    this.value = [values[values.length - 1]];
    return true;
  }

  get(): Value {
    if (this.value.length === 0) {
      throw new EmptyChannelError();
    }
    return this.value[0];
  }

  checkpoint(): Value {
    if (this.value.length === 0) {
      throw new EmptyChannelError();
    }
    return this.value[0];
  }
}
```

#### 关键行为

1. **单一值限制**：每个 step 只能接收一个值，多个节点同时写入会抛出 `InvalidUpdateError`
2. **最后值获胜**：如果有多个更新，只保留最后一个
3. **空状态检查**：读取空通道会抛出 `EmptyChannelError`

#### 使用场景

```typescript
import { Annotation } from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
  // 没有指定 reducer，默认使用 LastValue
  currentStep: Annotation<string>,
  status: Annotation<string>,
});
```

当使用 `Annotation<Type>`（没有 `reducer` 选项）时，会自动创建 `LastValue` 通道。

### 2. LastValueAfterFinish - 延迟可用通道

`LastValueAfterFinish` 是 `LastValue` 的变体，值只有在 `finish()` 被调用后才可访问。

#### 源码分析

```typescript
export class LastValueAfterFinish<Value> extends BaseChannel<
  Value,
  Value,
  [Value, boolean]
> {
  lc_graph_name = "LastValueAfterFinish";
  
  value: [Value] | [] = [];
  finished: boolean = false;

  update(values: Value[]): boolean {
    if (values.length === 0) return false;
    
    this.finished = false;
    this.value = [values[values.length - 1]];
    return true;
  }

  get(): Value {
    // 只有在 finished = true 时才可访问
    if (this.value.length === 0 || !this.finished) {
      throw new EmptyChannelError();
    }
    return this.value[0];
  }

  finish(): boolean {
    if (!this.finished && this.value.length > 0) {
      this.finished = true;
      return true;
    }
    return false;
  }

  consume(): boolean {
    if (this.finished) {
      this.finished = false;
      this.value = [];
      return true;
    }
    return false;
  }
}
```

#### 关键行为

1. **延迟可用**：写入后不会立即可读，需要调用 `finish()`
2. **自消耗**：调用 `consume()` 后会清除值并重置 `finished`
3. **检查点包含状态**：checkpoint 返回 `[value, finished]` 元组

#### 使用场景

用于需要延迟暴露值的场景，例如：
- 输出通道（只有在所有节点执行完毕后才暴露最终结果）
- 屏障同步（等待多个节点完成后才继续）

### 3. BinaryOperatorAggregate - 二元操作聚合通道

`BinaryOperatorAggregate` 使用二元操作符累积多个更新值。

#### 源码分析

```typescript
export class BinaryOperatorAggregate<ValueType, UpdateType = ValueType> 
  extends BaseChannel<ValueType, OverwriteOrValue<ValueType, UpdateType>, ValueType> 
{
  lc_graph_name = "BinaryOperatorAggregate";
  
  value: ValueType | undefined;
  operator: BinaryOperator<ValueType, UpdateType>;
  initialValueFactory?: () => ValueType;

  constructor(
    operator: BinaryOperator<ValueType, UpdateType>,
    initialValueFactory?: () => ValueType
  ) {
    super();
    this.operator = operator;
    this.initialValueFactory = initialValueFactory;
    this.value = initialValueFactory?.();
  }

  update(values: OverwriteOrValue<ValueType, UpdateType>[]): boolean {
    let newValues = values;
    if (!newValues.length) return false;

    // 初始化第一个值
    if (this.value === undefined) {
      const first = newValues[0];
      const [isOverwrite, overwriteVal] = _getOverwriteValue<ValueType>(first);
      if (isOverwrite) {
        this.value = overwriteVal;
      } else {
        this.value = first as ValueType;
      }
      newValues = newValues.slice(1);
    }

    // 应用二元操作符累积值
    let seenOverwrite = false;
    for (const incoming of newValues) {
      if (_isOverwriteValue<ValueType>(incoming)) {
        if (seenOverwrite) {
          throw new InvalidUpdateError(
            "Can receive only one Overwrite value per step."
          );
        }
        const [, val] = _getOverwriteValue<ValueType>(incoming);
        this.value = val;
        seenOverwrite = true;
        continue;
      } else if (!seenOverwrite && this.value !== undefined) {
        this.value = this.operator(this.value, incoming);
      }
    }
    return true;
  }

  get(): ValueType {
    if (this.value === undefined) {
      throw new EmptyChannelError();
    }
    return this.value;
  }
}
```

#### 关键行为

1. **累积更新**：使用 operator 函数累积所有更新
2. **覆盖值支持**：支持 `OverwriteValue` 类型来完全替换当前值
3. **单覆盖限制**：每个 step 只能有一个覆盖值

#### Overwrite 机制

```typescript
// OverwriteValue 是一个特殊标记，用于完全替换通道值
const OVERWRITE = Symbol("overwrite");

// 使用示例
const overwriteValue: OverwriteValue<string[]> = [OVERWRITE, ["new", "array"]];
```

#### 使用场景

```typescript
import { Annotation } from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
  // 数组追加
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => {
      if (Array.isArray(right)) {
        return left.concat(right);
      }
      return left.concat([right]);
    },
    default: () => [],
  }),
  
  // 数值累加
  totalCost: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  
  // 对象合并
  metadata: Annotation<Record<string, any>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
});
```

当使用 `Annotation<Type>({ reducer, default })` 时，会自动创建 `BinaryOperatorAggregate` 通道。

### 4. Topic - 话题通道

`Topic` 是一个可配置的发布/订阅通道，支持唯一性和累积选项。

#### 源码分析

```typescript
export class Topic<Value> extends BaseChannel<
  Array<Value>,
  Value | Value[],
  [Value[], Value[]]
> {
  lc_graph_name = "Topic";
  
  unique = false;       // 是否只允许唯一值
  accumulate = false;   // 是否跨 step 累积
  
  seen: Set<Value>;     // 用于唯一性检查
  values: Value[];      // 当前值列表

  constructor(fields?: {
    unique?: boolean;
    accumulate?: boolean;
  }) {
    super();
    this.unique = fields?.unique ?? this.unique;
    this.accumulate = fields?.accumulate ?? this.accumulate;
    this.seen = new Set<Value>();
    this.values = [];
  }

  update(values: Array<Value | Value[]>): boolean {
    let updated = false;
    
    // 如果不累积，每 step 清空
    if (!this.accumulate) {
      updated = this.values.length > 0;
      this.values = [];
    }
    
    const flatValues = values.flat() as Value[];
    if (flatValues.length > 0) {
      if (this.unique) {
        for (const value of flatValues) {
          if (!this.seen.has(value)) {
            updated = true;
            this.seen.add(value);
            this.values.push(value);
          }
        }
      } else {
        updated = true;
        this.values.push(...flatValues);
      }
    }
    return updated;
  }

  get(): Array<Value> {
    if (this.values.length === 0) {
      throw new EmptyChannelError();
    }
    return this.values;
  }

  checkpoint(): [Value[], Value[]] {
    return [[...this.seen], this.values];
  }
}
```

#### 关键行为

1. **唯一性**：`unique=true` 时使用引用相等去重
2. **累积**：`accumulate=true` 时跨 step 保留值，否则每 step 清空
3. **数组输出**：始终返回数组，即使只有一个值

#### 使用场景

```typescript
// 用于收集多轮对话中的所有工具调用
const ToolsAnnotation = Annotation.Root({
  toolCalls: Annotation<ToolCall[]>({
    reducer: (left, right) => {
      const calls = Array.isArray(right) ? right : [right];
      return [...left, ...calls];
    },
    default: () => [],
  }),
});

// 或使用 Topic 通道
const channel = new Topic<ToolCall>({
  unique: false,    // 允许重复
  accumulate: true, // 跨 step 累积
});
```

### 5. EphemeralValue - 临时值通道

`EphemeralValue` 存储一个临时值，一旦读取就会被清除。

#### 源码分析

```typescript
export class EphemeralValue<Value> extends BaseChannel<Value, Value, Value> {
  lc_graph_name = "EphemeralValue";
  
  value: [Value] | [] = [];

  fromCheckpoint(checkpoint?: Value) {
    const empty = new EphemeralValue<Value>();
    if (typeof checkpoint !== "undefined") {
      empty.value = [checkpoint];
    }
    return empty as this;
  }

  update(values: Value[]): boolean {
    if (values.length === 0) return false;
    if (values.length > 1) {
      throw new InvalidUpdateError(
        "EphemeralValue can only receive one value per step."
      );
    }
    this.value = [values[0]];
    return true;
  }

  get(): Value {
    if (this.value.length === 0) {
      throw new EmptyChannelError();
    }
    return this.value[0];
  }

  consume(): boolean {
    if (this.value.length > 0) {
      this.value = [];
      return true;
    }
    return false;
  }
}
```

#### 关键行为

1. **消费即清除**：调用 `consume()` 后值被清除
2. **单值限制**：每个 step 只能接收一个值
3. **不持久化**：值不会被长期保存，只存在于当前 step

#### 使用场景

```typescript
// 用于一次性传递的参数
const channel = new EphemeralValue<Command>();
```

### 6. UntrackedValue - 无追踪值通道

`UntrackedValue` 存储一个不被版本追踪的值。

#### 源码分析

```typescript
export class UntrackedValue<Value> extends BaseChannel<Value, Value, void> {
  lc_graph_name = "UntrackedValue";
  
  value: [Value] | [] = [];

  checkpoint(): void {
    // 返回 undefined，表示不保存检查点
    return undefined;
  }
}
```

#### 关键行为

1. **无检查点**：checkpoint() 总是返回 `undefined`
2. **不持久化**：状态不会被保存到检查点

#### 使用场景

用于临时状态，不需要恢复的场景。

### 7. AnyValue - 任意值通道

`AnyValue` 允许任何类型的值，没有任何约束。

```typescript
export class AnyValue extends BaseChannel<any, any, any> {
  lc_graph_name = "AnyValue";
  
  // 实现类似 LastValue，但类型更宽松
}
```

### 8. NamedBarrierValue - 命名屏障值

`NamedBarrierValue` 用于实现同步屏障，等待所有预期值到达。

#### 源码分析

```typescript
export class NamedBarrierValue extends BaseChannel<
  string[],
  string,
  [Set<string>, Set<string>]
> {
  lc_graph_name = "NamedBarrierValue";
  
  names: Set<string>;      // 预期到达的名称集合
  seen: Set<string>;       // 已经到达的名称集合

  update(values: string[]): boolean {
    for (const value of values) {
      this.seen.add(value);
    }
    // 检查是否所有预期名称都已到达
    return [...this.names].every((n) => this.seen.has(n));
  }

  get(): string[] {
    if (!this.isAvailable()) {
      throw new EmptyChannelError();
    }
    return [...this.seen];
  }
  
  isAvailable(): boolean {
    // 只有当所有预期值都到达时才可用
    return [...this.names].every((n) => this.seen.has(n));
  }
}
```

#### 使用场景

用于实现同步点，等待所有节点完成。

## 通道类型选择指南

| 通道类型 | 使用场景 | 多节点并发 | 版本追踪 |
|---------|---------|-----------|---------|
| `LastValue` | 简单状态，单节点写入 | ❌ 不支持 | ✅ |
| `LastValueAfterFinish` | 延迟暴露的输出口 | ❌ 不支持 | ✅ |
| `BinaryOperatorAggregate` | 数组/数值累积，对象合并 | ✅ 支持 | ✅ |
| `Topic` | 发布/订阅，事件收集 | ✅ 支持 | ✅ |
| `EphemeralValue` | 一次性传递参数 | ❌ 不支持 | ❌ |
| `UntrackedValue` | 临时状态，无需恢复 | ✅ 支持 | ❌ |
| `NamedBarrierValue` | 同步屏障，等待所有完成 | ✅ 支持 | ✅ |
| `AnyValue` | 类型不确定的灵活场景 | ❌ 不支持 | ✅ |

## 自定义通道

你可以通过继承 `BaseChannel` 创建自定义通道类型：

```typescript
import { BaseChannel, EmptyChannelError } from "@langchain/langgraph-core";

interface CounterCheckpoint {
  count: number;
  history: number[];
}

export class CounterChannel extends BaseChannel<
  number,      // ValueType: 读取时返回当前计数
  number,      // UpdateType: 更新时接收的增量
  CounterCheckpoint
> {
  lc_graph_name = "CounterChannel";
  
  count = 0;
  history: number[] = [];

  fromCheckpoint(checkpoint?: CounterCheckpoint) {
    const empty = new CounterChannel();
    if (checkpoint) {
      empty.count = checkpoint.count;
      empty.history = [...checkpoint.history];
    }
    return empty as this;
  }

  update(values: number[]): boolean {
    if (values.length === 0) return false;
    
    for (const delta of values) {
      this.count += delta;
      this.history.push(this.count);
    }
    return true;
  }

  get(): number {
    if (this.history.length === 0) {
      throw new EmptyChannelError();
    }
    return this.count;
  }

  checkpoint(): CounterCheckpoint {
    return {
      count: this.count,
      history: [...this.history],
    };
  }
}
```

## 通道与 Pregel 执行

在 Pregel 执行过程中，通道参与了完整的生命周期：

```
Step N:
1. 读取阶段
   - 节点从输入通道读取值（调用 channel.get()）
   
2. 执行阶段
   - 节点执行计算
   - 返回状态更新
   
3. 写入阶段
   - 更新应用到输出通道（调用 channel.update(values)）
   
4. 检查点阶段
   - 保存通道状态（调用 channel.checkpoint()）
   
5. 消耗阶段（某些通道类型）
   - 移除已消费的值（调用 channel.consume()）
   
6. 完成阶段（某些通道类型）
   - 标记 step 完成（调用 channel.finish()）
```

## 错误处理

通道相关的常见错误：

```typescript
// 1. EmptyChannelError - 读取空通道
try {
  const value = channel.get();
} catch (e) {
  if (e.name === "EmptyChannelError") {
    // 通道还没有值
  }
}

// 2. InvalidUpdateError - 无效的更新
// - LastValue 收到多个值
// - 多个 Overwrite 值同时出现
try {
  channel.update([val1, val2]); // LastValue 会抛错
} catch (e) {
  if (e.name === "InvalidUpdateError") {
    // 处理并发写入冲突
  }
}

// 3. INVALID_CONCURRENT_GRAPH_UPDATE
// 错误码，表示多个节点同时写入 LastValue 通道
```

## 总结

通道是 LangGraphJS 状态管理的核心，理解不同类型的通道对于构建正确的图至关重要：

- **LastValue**：默认选择，适合大多数简单状态
- **BinaryOperatorAggregate**：需要累积或合并的场景
- **Topic**：发布/订阅和事件流
- **EphemeralValue**：一次性传递的数据
- **NamedBarrierValue**：同步点

在选择通道类型时，需要考虑：
1. 是否需要累积多个更新？
2. 是否允许多节点并发写入？
3. 是否需要版本追踪（用于时间旅行）？
4. 值的生命周期是什么？

正确选择通道类型可以显著简化状态管理逻辑，并避免并发问题。