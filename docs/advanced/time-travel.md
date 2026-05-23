# 时间旅行 Time Travel

## 概述

时间旅行（Time Travel）是 LangGraphJS 基于 Checkpoint 系统的强大调试和恢复能力。它允许你：

- **查看历史状态**：访问图执行的任何历史点
- **回滚到过去**：从任意 checkpoint 重新开始执行
- **分支探索**：尝试不同的执行路径
- **调试分析**：理解错误原因和修复问题

时间旅行功能对于开发复杂 Agent 系统特别有价值，可以显著提高调试效率。

## 时间旅行基础

### Checkpoint 历史

```typescript
// 创建一个简单的图
import { StateGraph, Annotation } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint-memory";

const StateAnnotation = Annotation.Root({
  counter: Annotation<number>({ default: () => 0 }),
});

const graph = new StateGraph(StateAnnotation)
  .addNode("increment", (state) => ({ counter: state.counter + 1 }))
  .addEdge(START, "increment")
  .compile({ checkpointer: new MemorySaver() });

const config = { configurable: { thread_id: "time-travel" } };

// 执行多次创建历史
for (let i = 0; i < 5; i++) {
  await graph.invoke({}, config);
}

// 查看历史
const history = [];
for await (const cp of graph.checkpointer.list(config)) {
  history.push({
    checkpoint_id: cp.checkpoint.id,
    step: cp.metadata?.step,
    counter: cp.checkpoint.channel_values.counter,
  });
}

console.log("History:", history);
// [
//   { checkpoint_id: "uuid-1", step: 1, counter: 1 },
//   { checkpoint_id: "uuid-2", step: 2, counter: 2 },
//   { checkpoint_id: "uuid-3", step: 3, counter: 3 },
//   { checkpoint_id: "uuid-4", step: 4, counter: 4 },
//   { checkpoint_id: "uuid-5", step: 5, counter: 5 },
// ]
```

### 恢复到历史状态

```typescript
// 恢复到第 2 步
const checkpointAtStep2 = history[1];  // 索引从 0 开始

const restoreConfig = {
  configurable: {
    thread_id: "time-travel",
    checkpoint_id: checkpointAtStep2.checkpoint_id,
  },
};

// 从历史点重新开始
const result = await graph.invoke({}, restoreConfig);

console.log("Counter from step 2:", result.counter);
// Counter from step 2: 3 (步骤 2 的 counter 是 2，再执行一次变成 3)
```

## 时间旅行 API

### getState() - 获取当前状态

```typescript
// 获取当前状态（最新 checkpoint）
const currentState = await graph.getState(config);
console.log("Current:", currentState.values);

// 获取历史状态
const historicalConfig = {
  configurable: {
    thread_id: "time-travel",
    checkpoint_id: "specific-checkpoint-id",
  },
};
const historicalState = await graph.getState(historicalConfig);
console.log("Historical:", historicalState.values);
```

### getHistory() - 获取历史

```typescript
// 获取所有历史
const history = [];
for await (const checkpoint of graph.checkpointer.list(config)) {
  history.push(checkpoint);
}

// 分页获取
const historyPage1 = [];
for await (const checkpoint of graph.checkpointer.list(config, { limit: 10 })) {
  historyPage1.push(checkpoint);
}

// 获取特定 checkpoint 之前的历史
const olderHistory = [];
const beforeCheckpoint = historyPage1[historyPage1.length - 1];
for await (const checkpoint of graph.checkpointer.list(config, {
  before: beforeCheckpoint.config,
})) {
  olderHistory.push(checkpoint);
}
```

### updateState() - 修改状态

```typescript
// 更新当前状态
await graph.updateState(config, {
  counter: 100,  // 直接设置 counter 为 100
});

const updated = await graph.getState(config);
console.log("Updated counter:", updated.values.counter);
// Updated counter: 100
```

### fork() - 分支执行

```typescript
// 从 checkpoint 创建新分支
const branchConfig = await graph.fork(config);

// 在分支上执行（不影响原线程）
await graph.invoke({ someInput: "test" }, branchConfig);

// 原线程不受影响
const originalState = await graph.getState(config);
```

## 实践示例

### 示例 1：调试执行问题

```typescript
// 假设图执行出现问题
const graph = createAgentGraph().compile({ checkpointer });

const config = { configurable: { thread_id: "debug-session" } };

try {
  await graph.invoke(input, config);
} catch (error) {
  console.error("Execution failed:", error);
  
  // 获取执行历史
  const history = [];
  for await (const cp of graph.checkpointer.list(config)) {
    history.push(cp);
  }
  
  // 分析问题
  console.log("Execution trail:");
  for (const cp of history) {
    console.log(`Step ${cp.metadata?.step}:`, {
      checkpoint: cp.checkpoint.id,
      values: cp.checkpoint.channel_values,
      pendingWrites: cp.pendingWrites,
    });
  }
  
  // 回滚到问题发生前的状态
  const lastGoodCheckpoint = history[history.length - 2];  // 倒数第二个
  const restoreConfig = {
    configurable: {
      thread_id: "debug-session",
      checkpoint_id: lastGoodCheckpoint.checkpoint.id,
    },
  };
  
  // 尝试不同的输入
  const result = await graph.invoke({ modifiedInput: "test" }, restoreConfig);
}
```

### 示例 2：分支探索

```typescript
const config = { configurable: { thread_id: "exploration" } };

// 基础执行
await graph.invoke({ task: "baseline" }, config);

// 创建多个分支尝试不同方法
const branches = await Promise.all([
  graph.fork(config),  // 分支 1
  graph.fork(config),  // 分支 2
  graph.fork(config),  // 分支 3
]);

// 在不同分支上尝试
await graph.invoke({ approach: "A" }, branches[0]);
await graph.invoke({ approach: "B" }, branches[1]);
await graph.invoke({ approach: "C" }, branches[2]);

// 比较结果
const results = await Promise.all(
  branches.map(branch => graph.getState(branch))
);

// 选择最佳结果
const bestResult = results.reduce((best, current) => {
  return scoreResult(current.values) > scoreResult(best.values) ? current : best;
});

// 在最佳分支上继续
await graph.invoke({ continue: true }, branches[bestResult === results[1] ? 1 : results.indexOf(bestResult)]);
```

### 示例 3：保存关键点

```typescript
class CheckpointManager {
  private checkpoints: Map<string, RunnableConfig> = new Map();
  
  // 保存重要状态的引用
  async saveKeyPoint(
    name: string,
    config: RunnableConfig,
    graph: CompiledStateGraph
  ): Promise<void> {
    const state = await graph.getState(config);
    this.checkpoints.set(name, {
      configurable: {
        thread_id: config.configurable.thread_id,
        checkpoint_id: state.checkpoint?.id,
      },
    });
  }
  
  // 恢复到保存的点
  async restoreKeyPoint(
    name: string,
    graph: CompiledStateGraph
  ): Promise<RunnableConfig> {
    const config = this.checkpoints.get(name);
    if (!config) {
      throw new Error(`Checkpoint "${name}" not found`);
    }
    return config;
  }
  
  // 列出所有保存点
  listKeyPoints(): string[] {
    return Array.from(this.checkpoints.keys());
  }
}

// 使用
const manager = new CheckpointManager();

// 在关键点保存
await manager.saveKeyPoint("before_complex_operation", config, graph);
await manager.saveKeyPoint("after_data_fetch", config, graph);

// 可以恢复
const restoreConfig = await manager.restoreKeyPoint("before_complex_operation", graph);
const result = await graph.invoke(input, restoreConfig);
```

### 示例 4：状态比较

```typescript
// 比较两个 checkpoint 的状态
async function compareCheckpoints(
  cp1: CheckpointTuple,
  cp2: CheckpointTuple
): Promise<Record<string, any>> {
  const diff: Record<string, any> = {};
  
  const values1 = cp1.checkpoint.channel_values;
  const values2 = cp2.checkpoint.channel_values;
  
  for (const key of new Set([...Object.keys(values1), ...Object.keys(values2)])) {
    if (JSON.stringify(values1[key]) !== JSON.stringify(values2[key])) {
      diff[key] = {
        before: values1[key],
        after: values2[key],
      };
    }
  }
  
  return diff;
}

// 使用
const history = [];
for await (const cp of graph.checkpointer.list(config)) {
  history.push(cp);
}

// 比较相邻步骤
for (let i = 1; i < history.length; i++) {
  const diff = await compareCheckpoints(history[i-1], history[i]);
  console.log(`Step ${i-1} → ${i}:`, diff);
}
```

### 示例 5：自动化回滚

```typescript
interface AutoRollbackConfig {
  maxSteps: number;
  failurePatterns: string[];
  rollbackSteps: number;
}

async function executeWithAutoRollback(
  graph: CompiledStateGraph,
  input: any,
  config: RunnableConfig,
  rollbackConfig: AutoRollbackConfig
): Promise<any> {
  const checkpoints = [];
  
  // 执行并记录 checkpoints
  let currentConfig = config;
  for (let step = 0; step < rollbackConfig.maxSteps; step++) {
    const state = await graph.invoke(input, currentConfig);
    
    // 保存 checkpoint
    const currentCheckpoint = await graph.getState(currentConfig);
    checkpoints.push(currentCheckpoint);
    
    // 检查失败模式
    for (const pattern of rollbackConfig.failurePatterns) {
      if (JSON.stringify(state).includes(pattern)) {
        console.log(`Failure pattern detected: ${pattern}`);
        
        // 回滚
        if (checkpoints.length <= rollbackConfig.rollbackSteps) {
          throw new Error("Cannot rollback: not enough checkpoints");
        }
        
        const rollbackCheckpoint = checkpoints[
          checkpoints.length - rollbackConfig.rollbackSteps - 1
        ];
        
        const rollbackConfig = {
          configurable: {
            thread_id: currentConfig.configurable.thread_id,
            checkpoint_id: rollbackCheckpoint.checkpoint?.id,
          },
        };
        
        // 修改输入重试
        const modifiedInput = { ...input, retryAttempt: true };
        return await graph.invoke(modifiedInput, rollbackConfig);
      }
    }
  }
  
  return await graph.invoke(input, currentConfig);
}

// 使用
const result = await executeWithAutoRollback(
  graph,
  { task: "complex" },
  { configurable: { thread_id: "auto-rollback" } },
  {
    maxSteps: 10,
    failurePatterns: ["error", "failed", "timeout"],
    rollbackSteps: 2,
  }
);
```

## 时间旅行 UI 集成

```typescript
// React 组件示例
function TimeTravelDebugger({ graph, threadId }) {
  const [history, setHistory] = useState([]);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);
  const [currentView, setCurrentView] = useState("latest");
  
  // 加载历史
  useEffect(() => {
    async function loadHistory() {
      const checkpoints = [];
      for await (const cp of graph.checkpointer.list(
        { configurable: { thread_id: threadId } }
      )) {
        checkpoints.push(cp);
      }
      setHistory(checkpoints);
    }
    loadHistory();
  }, [graph, threadId]);
  
  // 恢复选中点
  async function restoreCheckpoint(checkpoint) {
    await graph.updateState(
      {
        configurable: {
          thread_id: threadId,
          checkpoint_id: checkpoint.id,
        },
      },
      checkpoint.checkpoint.channel_values
    );
    setCurrentView("restored");
  }
  
  return (
    <div className="time-travel-debugger">
      <h3>Execution History</h3>
      
      {/* 时间线 */}
      <div className="timeline">
        {history.map((cp, index) => (
          <div
            key={cp.checkpoint.id}
            className={`checkpoint ${selectedCheckpoint?.id === cp.checkpoint.id ? 'selected' : ''}`}
            onClick={() => setSelectedCheckpoint(cp)}
          >
            <div>Step {cp.metadata?.step}</div>
            <div>{new Date(cp.checkpoint.ts).toLocaleTimeString()}</div>
          </div>
        ))}
      </div>
      
      {/* 选中点详情 */}
      {selectedCheckpoint && (
        <div className="checkpoint-details">
          <h4>Checkpoint Details</h4>
          <pre>{JSON.stringify(selectedCheckpoint.checkpoint.channel_values, null, 2)}</pre>
          
          <button onClick={() => restoreCheckpoint(selectedCheckpoint)}>
            Restore to this point
          </button>
          
          <button onClick={() => graph.fork({
            configurable: {
              thread_id: threadId,
              checkpoint_id: selectedCheckpoint.checkpoint.id,
            },
          })}>
            Fork from here
          </button>
        </div>
      )}
    </div>
  );
}
```

## 高级技巧

### 状态快照导出

```typescript
async function exportCheckpointHistory(
  graph: CompiledStateGraph,
  config: RunnableConfig
): Promise<string> {
  const checkpoints = [];
  
  for await (const cp of graph.checkpointer.list(config)) {
    checkpoints.push({
      checkpoint_id: cp.checkpoint.id,
      parent_id: cp.parentConfig?.configurable?.checkpoint_id,
      timestamp: cp.checkpoint.ts,
      step: cp.metadata?.step,
      values: cp.checkpoint.channel_values,
      pendingWrites: cp.pendingWrites,
    });
  }
  
  return JSON.stringify(checkpoints, null, 2);
}

// 导出为文件
function downloadHistory(history: string, filename: string) {
  const blob = new Blob([history], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 批量状态恢复

```typescript
async function batchRestore(
  graph: CompiledStateGraph,
  checkpoints: CheckpointTuple[]
): Promise<RunnableConfig[]> {
  return await Promise.all(
    checkpoints.map(async cp => {
      const config = {
        configurable: {
          thread_id: cp.config.configurable.thread_id,
          checkpoint_id: cp.checkpoint.id,
        },
      };
      
      await graph.updateState(config, cp.checkpoint.channel_values);
      
      return config;
    })
  );
}
```

## 最佳实践

### 1. 限制历史长度

```typescript
// 定期清理旧 checkpoints
async function cleanupOldCheckpoints(
  graph: CompiledStateGraph,
  config: RunnableConfig,
  keepLast: number = 100
): Promise<void> {
  const checkpoints = [];
  for await (const cp of graph.checkpointer.list(config)) {
    checkpoints.push(cp);
  }
  
  if (checkpoints.length > keepLast) {
    const toDelete = checkpoints.slice(0, checkpoints.length - keepLast);
    for (const cp of toDelete) {
      // 删除逻辑（取决于 checkpoint 实现）
    }
  }
}
```

### 2. 标记重要 Checkpoints

```typescript
// 使用 metadata 标记重要状态
const importantConfig = {
  ...config,
  metadata: {
    important: true,
    reason: "before-critical-operation",
  },
};

// 筛选重要 checkpoints
const importantCheckpoints = [];
for await (const cp of graph.checkpointer.list(config, {
  filter: { important: true },
})) {
  importantCheckpoints.push(cp);
}
```

### 3. 版本控制状态

```typescript
interface VersionedState {
  version: number;
  timestamp: Date;
  data: any;
}

const VersionedAnnotation = Annotation.Root({
  stateHistory: Annotation<VersionedState[]>({ default: () => [] }),
});

async function versionedNode(state) {
  const newVersion: VersionedState = {
    version: state.stateHistory.length + 1,
    timestamp: new Date(),
    data: computeNewState(),
  };
  
  return {
    stateHistory: [...state.stateHistory, newVersion],
  };
}
```

## 常见问题 FAQ

### Q1: 时间旅行会影响性能吗？

**A**: 查看历史不会影响性能，但保存 checkpoint 会有额外开销。建议在生产环境中权衡 checkpoint 频率。

### Q2: 可以跨线程恢复状态吗？

**A**: 不能。Checkpoint 是按 thread_id 组织的，不能跨线程恢复。

### Q3: Checkpoint 会无限增长吗？

**A**: 是的，需要定期清理旧 checkpoints。使用 list() 分页获取并删除旧的。

## 总结

时间旅行功能：

- ✅ **调试利器**：深入理解执行流程
- ✅ **恢复能力**：从错误中快速恢复
- ✅ **探索工具**：尝试不同执行路径
- ✅ **分析手段**：比较状态变化

合理利用时间旅行可以显著提高开发效率。

## 参考资料

- [LangGraph 持久化文档](https://langchain-ai.github.io/langgraphjs/how-tos/persistence/)
- [Checkpoint 系统详解](/core/checkpoint-system)