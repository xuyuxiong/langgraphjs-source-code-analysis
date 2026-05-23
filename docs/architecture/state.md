# 状态管理

状态管理是 LangGraphJS 的核心功能之一，它负责在图执行过程中维护和管理数据流。本章将深入解析状态管理机制，包括状态机、中断和恢复。

## 状态定义

### 基础状态接口

```typescript
interface State {
  // 状态字段定义
  messages: BaseMessage[];
  currentStep: string;
  retries: number;
  result?: unknown;
}
```

### 使用 Annotation 定义

```typescript
import { Annotation } from "@langchain/langgraph";

// 创建状态注解
const AgentState = Annotation<{
  messages: BaseMessage[];
  currentStep: string;
}>({
  messages: Annotation<BaseMessage[]>()
    .reducer((x, y) => x.concat(y))
    .default(() => []),
  
  currentStep: Annotation<string>()
    .reducer((x, y) => y)
    .default(() => "__start__")
});

// 使用注解创建 StateGraph
const workflow = new StateGraph(AgentState.spec);
```

### StateDefinition 接口

```typescript
// libs/langgraph-core/src/graph/annotation.ts
export interface StateDefinition {
  [key: string]: {
    reducer?: (a: unknown, b: unknown) => unknown;
    default?: () => unknown;
  };
}

// 示例
const stateDefinition: StateDefinition = {
  messages: {
    reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
    default: () => []
  },
  currentStep: {
    reducer: (x: string, y: string) => y,
    default: () => "__start__"
  }
};
```

## 状态机实现

### 状态转换

```typescript
// 状态机基本模型
interface StateMachine<State> {
  // 当前状态
  currentState: State;
  
  // 状态转换
  transition(action: string, input: unknown): State;
  
  // 检查是否可转换
  canTransition(action: string): boolean;
}

// 在 LangGraphJS 中的体现
class CompiledStateGraph {
  async invoke(input: State): Promise<State> {
    let state = input;
    
    // 执行节点
    for (const nodeName of this.executionOrder) {
      // 检查转换条件
      if (!this.canExecute(nodeName, state)) {
        continue;
      }
      
      // 执行节点（状态转换）
      const output = await this.nodes[nodeName](state);
      state = this.applyUpdate(state, output);
    }
    
    return state;
  }
}
```

### 条件边（Conditional Edges）

```typescript
// 添加条件边
workflow.addConditionalEdges(
  "router",                              // 源节点
  (state) => {                          // 路由函数
    if (state.needsSearch) {
      return "search";
    } else if (state.needsCalculation) {
      return "calculate";
    } else {
      return "end";
    }
  },
  {
    search: "search_node",
    calculate: "calc_node",
    end: END
  }
);
```

### 状态验证

```typescript
function validateStateUpdate(
  currentState: State,
  update: Partial<State>,
  schema: StateDefinition
): boolean {
  for (const [key, value] of Object.entries(update)) {
    const field = schema[key];
    if (!field) {
      throw new Error(`Unknown state field: ${key}`);
    }
    
    // 验证 reducer 兼容性
    if (field.reducer && typeof field.reducer !== 'function') {
      throw new Error(`Invalid reducer for field: ${key}`);
    }
  }
  
  return true;
}
```

## 中断机制

### interrupt 函数

```typescript
// libs/langgraph-core/src/interrupt.ts
export function interrupt<I = unknown, R = unknown>(value: I): R {
  // 1. 获取当前配置
  const config: RunnableConfig | undefined =
    AsyncLocalStorageProviderSingleton.getRunnableConfig();
  
  if (!config) {
    throw new Error("Called interrupt() outside the context of a graph.");
  }
  
  // 2. 获取检查器
  const checkpointer: BaseCheckpointSaver = 
    config.configurable?.[CONFIG_KEY_CHECKPOINTER];
  
  if (!checkpointer) {
    throw new GraphValueError("No checkpointer set");
  }
  
  // 3. 跟踪中断索引
  const scratchpad: PregelScratchpad = 
    config.configurable?.[CONFIG_KEY_SCRATCHPAD];
  
  scratchpad.interruptCounter += 1;
  const idx = scratchpad.interruptCounter;
  
  // 4. 查找之前的 resume 值
  if (scratchpad.resume.length > 0 && idx < scratchpad.resume.length) {
    config.configurable?.[CONFIG_KEY_SEND]?.([
      [RESUME, scratchpad.resume]
    ]);
    return scratchpad.resume[idx] as R;
  }
  
  // 5. 抛出中断异常
  throw new GraphInterrupt([{
    id: scratchpad.id,
    value
  }]);
}
```

### 中断工作流程

```
正常执行
   │
   ▼
┌─────────────┐
│  节点执行    │
│             │
│ interrupt() │───┐
│  被调用     │   │
└─────────────┘   │
   │              │
   ▼              ▼
┌─────────────┐  ┌─────────────┐
│ 抛出        │  │ 保存当前    │
│ GraphInterrupt│  │ 检查点    │
└─────────────┘  └─────────────┘
   │
   ▼
执行暂停
   │
   │  外部调用 resume
   ▼
┌─────────────┐
│ 加载检查点  │
└─────────────┘
   │
   ▼
┌─────────────┐
│ 注入 resume │
│ 值          │
└─────────────┘
   │
   ▼
继续执行
```

### 中断使用示例

```typescript
import { interrupt, Command } from "@langchain/langgraph";

// 定义带中断的节点
async function humanReview(state: State) {
  console.log("等待人工审核...");
  
  // 中断并等待决策
  const decision = interrupt<{ approve: boolean }>({
    type: "human_review",
    data: state
  });
  
  if (decision.approve) {
    return { status: "approved" };
  } else {
    return { status: "rejected" };
  }
}

// 构建图
const workflow = new StateGraph<State>()
  .addNode("review", humanReview)
  .addEdge("__start__", "review")
  .addEdge("review", END);

const app = workflow.compile();

// 首次执行（会被中断）
try {
  await app.invoke({ data: "test" });
} catch (e) {
  if (e instanceof GraphInterrupt) {
    console.log("被中断:", e.interrupts);
  }
}

// 恢复执行
const result = await app.invoke(
  new Command({
    resume: { approve: true }
  })
);
```

## 恢复机制

### Command 对象

```typescript
// libs/langgraph-core/src/constants.ts
export class Command<T = unknown> {
  resume?: T;              // 恢复值
  update?: Record<string, any>;  // 状态更新
  goto?: string | string[];      // 跳转到指定节点
  
  constructor(params: {
    resume?: T;
    update?: Record<string, any>;
    goto?: string | string[];
  }) {
    this.resume = params.resume;
    this.update = params.update;
    this.goto = params.goto;
  }
}
```

### Checkpoint 恢复

```typescript
async function restoreFromCheckpoint(
  config: RunnableConfig
): Promise<StateSnapshot> {
  // 1. 加载检查点
  const checkpoint = await checkpointer.get(config);
  
  if (!checkpoint) {
    throw new Error("No checkpoint found");
  }
  
  // 2. 恢复通道
  const channels = createChannelsFromCheckpoint(checkpoint);
  
  // 3. 恢复状态
  const state = readChannels(channels, outputChannels);
  
  return {
    values: state,
    next: getNextNodes(checkpoint),
    tasks: getPendingTasks(checkpoint)
  };
}
```

### Resume 值注入

```typescript
// 在 PregelLoop 中处理 resume
async _prepareNextTasks(): Promise<PregelExecutableTask[]> {
  const tasks: PregelExecutableTask[] = [];
  
  // 检查是否有 resume 值
  const resumeValue = this.config.configurable?.[CONFIG_KEY_RESUME];
  
  if (resumeValue !== undefined) {
    // 创建 resume 注入任务
    tasks.push({
      name: RESUME_NODE,
      input: resumeValue,
      runnable: this._createResumeHandler(),
      config: this.config,
      writes: []
    });
  }
  
  // ... 其他任务
  
  return tasks;
}

_createResumeHandler(): Runnable {
  return new RunnableCallable({
    func: (input) => {
      // 将 resume 值注入到状态
      return { resume: input };
    }
  });
}
```

## 状态更新策略

### Reducer 函数

```typescript
// 常见 reducer 模式

// 1. 替换（LastValue）
const replaceReducer = (x: unknown, y: unknown) => y;

// 2. 追加（消息列表）
const appendReducer = (x: BaseMessage[], y: BaseMessage[]) => 
  x.concat(y);

// 3. 合并（对象）
const mergeReducer = (x: Record<string, any>, y: Record<string, any>) => 
  ({ ...x, ...y });

// 4. 累加（数值）
const sumReducer = (x: number, y: number) => x + y;

// 5. 去重追加（集合）
const setReducer = (x: unknown[], y: unknown[]) => 
  Array.from(new Set([...x, ...y]));
```

### 深度合并

```typescript
function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };
  
  for (const key in source) {
    if (!source.hasOwnProperty(key)) continue;
    
    const sourceValue = source[key];
    const targetValue = target[key];
    
    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      // 递归深度合并
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      // 直接替换
      result[key] = sourceValue;
    }
  }
  
  return result;
}
```

## 状态快照

### StateSnapshot 接口

```typescript
interface StateSnapshot {
  values: Record<string, unknown>;     // 状态值
  next: string[];                       // 下一个节点
  tasks: PregelTask[];                  // 待处理任务
  metadata: CheckpointMetadata;         // 元数据
  config: RunnableConfig;               // 配置
  createdAt: string;                    // 创建时间
  parentConfig?: RunnableConfig;        // 父配置（时间旅行）
}
```

### 获取状态快照

```typescript
async getState(
  config: RunnableConfig
): Promise<StateSnapshot> {
  // 1. 加载检查点
  const checkpoint = await this.checkpointer.get(config);
  
  // 2. 创建通道
  const channels = createChannels(this.channels, checkpoint);
  
  // 3. 读取状态
  const values = readChannels(channels, this.outputChannels);
  
  // 4. 获取下一个节点
  const next = this._getNextNodes(checkpoint);
  
  // 5. 获取待处理任务
  const tasks = this._getPendingTasks(checkpoint);
  
  return {
    values,
    next,
    tasks,
    metadata: checkpoint.metadata,
    config,
    createdAt: checkpoint.ts
  };
}
```

## 时间旅行

### 历史状态遍历

```typescript
async *getHistory(
  config: RunnableConfig
): AsyncGenerator<StateSnapshot> {
  // 获取所有检查点
  const checkpoints = this.checkpointer.list(
    config,
    { limit: 100, reverse: true }
  );
  
  for await (const checkpointTuple of checkpoints) {
    yield {
      values: checkpointTuple.checkpoint.channel_values,
      next: [],
      tasks: [],
      metadata: checkpointTuple.metadata,
      config: checkpointTuple.config,
      createdAt: checkpointTuple.checkpoint.ts,
      parentConfig: checkpointTuple.parentConfig
    };
  }
}
```

### 回滚到历史状态

```typescript
async function rollbackToCheckpoint(
  config: RunnableConfig,
  targetCheckpointId: string
): Promise<void> {
  // 1. 查找目标检查点
  const target = await findCheckpoint(config, targetCheckpointId);
  
  if (!target) {
    throw new Error("Checkpoint not found");
  }
  
  // 2. 恢复通道值
  const channels = createChannels(
    this.channels,
    target.checkpoint
  );
  
  // 3. 更新当前状态
  await this.updateState(config, target.checkpoint.channel_values);
  
  // 4. 保存为新检查点
  const newCheckpoint = createCheckpoint(
    target.checkpoint,
    channels,
    this.step
  );
  
  await this.checkpointer.save(newCheckpoint, config);
}
```

## 并发状态管理

### 乐观锁

```typescript
async updateState(
  config: RunnableConfig,
  values: Record<string, unknown>
): Promise<void> {
  const current = await this.checkpointer.get(config);
  
  // 检查版本号（乐观锁）
  if (config.configurable?.checkpoint_id !== current?.id) {
    throw new Error("State has been modified by another process");
  }
  
  // 应用更新
  const newCheckpoint = {
    ...current,
    channel_values: {
      ...current.channel_values,
      ...values
    }
  };
  
  await this.checkpointer.save(newCheckpoint, config);
}
```

### 状态变更通知

```typescript
class StateManager {
  private listeners: Set<StateChangeListener> = new Set();
  
  addListener(listener: StateChangeListener): void {
    this.listeners.add(listener);
  }
  
  async updateState(values: Partial<State>): Promise<void> {
    const oldState = this.currentState;
    
    // 应用更新
    this.currentState = { ...this.currentState, ...values };
    
    // 通知监听器
    for (const listener of this.listeners) {
      await listener.onStateChange(oldState, this.currentState);
    }
  }
}

interface StateChangeListener {
  onStateChange(old: State, current: State): Promise<void>;
}
```

## 错误处理

### 状态验证错误

```typescript
function validateStateUpdate(
  update: Partial<State>,
  schema: StateDefinition
): void {
  for (const [key, value] of Object.entries(update)) {
    // 检查字段是否存在
    if (!schema[key]) {
      throw new GraphValueError(`Unknown state field: ${key}`);
    }
    
    // 检查类型
    if (!isValidType(value, schema[key])) {
      throw new GraphValueError(
        `Invalid type for field ${key}`,
        { expected: schema[key].type, got: typeof value }
      );
    }
  }
}
```

### 状态冲突处理

```typescript
async function handleStateConflict(
  config: RunnableConfig,
  localState: State,
  remoteState: State
): Promise<State> {
  // 策略 1: 最后写入获胜
  return remoteState;
  
  // 策略 2: 合并
  // return mergeStates(localState, remoteState);
  
  // 策略 3: 重试
  // return await retryWithBackoff(() => fetchAndMerge(config));
}
```

## 实际应用案例

### Agent 状态管理

```typescript
interface AgentState {
  messages: BaseMessage[];
  currentTool?: string;
  toolResults: ToolResult[];
  retries: number;
  metadata: {
    startTime: number;
    userId: string;
  };
}

const agentWorkflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      reducer: (x, y) => x.concat(y),
      default: () => []
    },
    currentTool: {
      reducer: (_, y) => y,
      default: () => undefined
    },
    toolResults: {
      reducer: (x, y) => [...x, y],
      default: () => []
    },
    retries: {
      reducer: (_, y) => y,
      default: () => 0
    },
    metadata: {
      reducer: (x, y) => ({ ...x, ...y }),
      default: () => ({ startTime: Date.now(), userId: "" })
    }
  }
});
```

### 工作流状态机

```typescript
type WorkflowState = 
  | { status: "pending" }
  | { status: "processing"; step: number }
  | { status: "reviewing"; reviewer: string }
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: string };

const workflow = new StateGraph<WorkflowState>()
  .addNode("start", (state) => ({ status: "processing", step: 0 }))
  .addNode("process", processStep)
  .addNode("review", reviewStep)
  .addNode("complete", (state) => ({ status: "completed", result: state.result }))
  .addNode("fail", (state) => ({ status: "failed", error: state.error }))
  
  .addConditionalEdges("start", () => "process")
  .addConditionalEdges("process", (state) => {
    if (state.error) return "fail";
    if (state.needsReview) return "review";
    return "complete";
  })
  .addEdge("review", "complete")
  .addEdge("fail", END)
  .addEdge("complete", END);
```

## 小结

本节深入解析了 LangGraphJS 的状态管理机制：

- ✅ 状态定义与 Annotation 系统
- ✅ 状态机实现与转换
- ✅ 中断机制详解
- ✅ 恢复机制与 Command 对象
- ✅ 状态更新策略
- ✅ 状态快照
- ✅ 时间旅行
- ✅ 并发状态管理
- ✅ 错误处理
- ✅ 实际应用案例

## 下一章

- [Checkpoint 机制](/architecture/checkpoint) - 持久化、时间旅行
- [核心篇 - StateGraph](/core/state-graph)
- [核心篇 - 中断机制](/core/interrupt)