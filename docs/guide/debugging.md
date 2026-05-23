# 调试指南

## VSCode 调试配置

### 基础配置

在项目根目录创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "调试当前文件",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["exec", "tsx"],
      "args": ["${file}"],
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**", "**/node_modules/**"],
      "env": {
        "NODE_OPTIONS": "--enable-source-maps"
      }
    },
    {
      "name": "调试测试文件",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": [
        "exec",
        "jest",
        "--runInBand",
        "--testTimeout=60000"
      ],
      "args": ["${file}"],
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**", "**/node_modules/**"]
    },
    {
      "name": "附加到进程",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "restart": true,
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

### 高级调试配置

针对 LangGraphJS 的特定调试场景：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "调试 Pregel 引擎",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "program": "${workspaceFolder}/debug-pregel.ts",
      "console": "integratedTerminal",
      "preLaunchTask": "build:core",
      "skipFiles": [
        "<node_internals>/**",
        "**/node_modules/**",
        "**/dist/**"
      ],
      "env": {
        "DEBUG": "langgraph:*",
        "NODE_OPTIONS": "--enable-source-maps --inspect-brk"
      }
    },
    {
      "name": "调试 StateGraph",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}/libs/langgraph-core",
      "program": "${workspaceFolder}/examples/state-graph-debug.ts",
      "console": "integratedTerminal",
      "env": {
        "TS_NODE_FILES": "true"
      }
    },
    {
      "name": "调试 Checkpoint",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "program": "${workspaceFolder}/examples/checkpoint-debug.ts",
      "console": "integratedTerminal",
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/test"
      }
    }
  ]
}
```

### .vscode/settings.json

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": false,
  "debug.javascript.usePreview": true,
  "debug.javascript.terminalOptions": {
    "env": {
      "NODE_OPTIONS": "--enable-source-maps"
    }
  },
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.turbo": true
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/coverage": true
  }
}
```

## 断点技巧

### 1. 条件断点

在复杂循环中，只在特定条件下触发断点：

```typescript
// pregel/index.ts - Pregel 执行循环
for await (const { tasks, ...rest } of loop) {
  // 条件断点：step > 5
  // 条件表达式：step > 5
  
  // 条件断点：特定任务
  // 条件表达式: tasks.some(t => t.name === 'agent')
  
  console.log("Step", step, "Tasks", tasks.length);
}
```

### 2. 日志断点

记录执行过程但不中断：

```javascript
// 断点配置中添加 log 表达式
console.log(`[Pregel] step=${step}, tasks=${tasks.length}`)
```

### 3. 表达式断点

在断点处自动执行表达式：

```javascript
// 打印任务详情
tasks.forEach(t => console.log(t.name, t.input))

// 打印状态
JSON.stringify(checkpoint.channel_values, null, 2)
```

## 核心模块断点位置

### Pregel 引擎

```typescript
// libs/langgraph-core/src/pregel/index.ts

// 1. invoke 入口
async invoke(
  input: PregelInputType,
  options?: Partial<PregelOptions<Nodes, Channels>>
): Promise<PregelOutputType> {
  // 👈 在此设置断点
  const stream = await this.stream(input, {
    ...options,
    subgraphs: options?.subgraphs ?? false,
  });
  // ...
}

// 2. stream 方法
async *stream(
  input: PregelInputType,
  options?: Partial<PregelOptions<Nodes, Channels>>
): AsyncGenerator<PregelOutputType> {
  // 👈 在此设置断点，观察流式处理
  // ...
}

// 3. 执行循环
async *transform(
  input: ReadableStream<Record<string, unknown>>,
  options: PregelOptions<Nodes, Channels>
): AsyncGenerator {
  // 👈 核心循环
  for await (const { 
    tasks, 
    checkpoint, 
    step 
  } of loop) {
    // 👈 关键断点位置
    // 观察每个 step 的任务执行
  }
}
```

### StateGraph

```typescript
// libs/langgraph-core/src/graph/state.ts

// 1. StateGraph 构造函数
constructor(
  fields: StateDefinitionInit<C> | AnnotationRoot<S> | StateGraphArgsWithStateSchema<S, I, O>
) {
  // 👈 观察初始化参数
  if (isStateDefinitionInit(fields)) {
    // ...
  }
}

// 2. addNode 方法
addNode<NodeKey extends string>(
  id: NodeKey,
  action: RunnableLike<...>,
  metadata?: StateGraphAddNodeOptions
): this {
  // 👈 观察节点添加逻辑
  // ...
}

// 3. compile 方法
compile({ 
  checkpointer, 
  interruptBefore, 
  interruptAfter 
}: {
  checkpointer?: BaseCheckpointSaver;
  interruptBefore?: All | N[];
  interruptAfter?: All | N[];
} = {}): CompiledStateGraph<S, I, O, C, U, N> {
  // 👈 编译流程入口
  // ...
}
```

### Channels

```typescript
// libs/langgraph-core/src/channels/base.ts

// Channel 基类方法
abstract class BaseChannel<ValueType, UpdateType, CheckpointType> {
  // 👈 更新通道值
  abstract update(values: UpdateType[]): boolean;
  
  // 👈 获取通道值
  abstract get(): ValueType;
  
  // 👈 创建检查点
  abstract checkpoint(): CheckpointType | undefined;
}
```

## 调试脚本示例

### 1. 基础调试脚本

```typescript
// debug-pregel.ts
import { StateGraph } from "@langchain/langgraph";

interface State {
  messages: string[];
  count: number;
}

// 定义节点
async function nodeA(state: State) {
  console.log("[Node A] 输入:", state);
  debugger; // 断点
  const result = { messages: ["A executed"], count: state.count + 1 };
  console.log("[Node A] 输出:", result);
  return result;
}

async function nodeB(state: State) {
  console.log("[Node B] 输入:", state);
  debugger; // 断点
  const result = { messages: [...state.messages, "B executed"], count: state.count + 1 };
  console.log("[Node B] 输出:", result);
  return result;
}

// 构建图
const workflow = new StateGraph<State>()
  .addNode("nodeA", nodeA)
  .addNode("nodeB", nodeB)
  .addEdge("__start__", "nodeA")
  .addEdge("nodeA", "nodeB")
  .addEdge("nodeB", "__end__");

const app = workflow.compile();

// 运行
async function main() {
  console.log("开始执行...");
  const result = await app.invoke({ messages: [], count: 0 });
  console.log("最终结果:", result);
}

main();
```

### 2. Checkpoint 调试脚本

```typescript
// debug-checkpoint.ts
import { StateGraph } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";

interface State {
  value: number;
}

async function increment(state: State) {
  console.log("[Increment] Before:", state);
  debugger;
  return { value: state.value + 1 };
}

const workflow = new StateGraph<State>()
  .addNode("increment", increment)
  .addEdge("__start__", "increment");

// 使用 MemorySaver
const checkpointer = new MemorySaver();
const app = workflow.compile({ checkpointer });

async function main() {
  const config = { configurable: { thread_id: "1" } };
  
  // 第一次运行
  console.log("=== 第一次运行 ===");
  const result1 = await app.invoke({ value: 0 }, config);
  console.log("结果 1:", result1);
  
  // 获取状态
  debugger; // 在此观察 checkpoint
  const state1 = await app.getState(config);
  console.log("状态 1:", state1);
  
  // 第二次运行 (续跑)
  console.log("=== 第二次运行 ===");
  const result2 = await app.invoke({ value: 100 }, config);
  console.log("结果 2:", result2);
}

main();
```

### 3. 中断机制调试脚本

```typescript
// debug-interrupt.ts
import { StateGraph, interrupt, Command } from "@langchain/langgraph";

interface State {
  step: string;
  approved?: boolean;
}

async function step1(state: State) {
  console.log("[Step 1] 执行");
  return { step: "step1_done" };
}

async function humanApproval(state: State) {
  console.log("[Human Approval] 等待决策...");
  debugger; // 中断点
  const decision = interrupt<{ approve: boolean }>({ needsApproval: true });
  console.log("[Human Approval] 决策:", decision);
  return { approved: decision.approve };
}

async function step2(state: State) {
  console.log("[Step 2] 执行 (仅在批准后)");
  return { step: "step2_done" };
}

const workflow = new StateGraph<State>()
  .addNode("step1", step1)
  .addNode("approval", humanApproval)
  .addNode("step2", step2)
  .addEdge("__start__", "step1")
  .addEdge("step1", "approval")
  .addConditionalEdges("approval", (s) => s.approved ? "step2" : "__end__")
  .addEdge("step2", "__end__");

const app = workflow.compile();

async function main() {
  const config = { configurable: { thread_id: "approval-test" } };
  
  // 第一次运行 - 会被中断
  console.log("=== 第一次运行 (会被中断) ===");
  try {
    await app.invoke({}, config);
  } catch (e) {
    console.log("被中断:", e);
  }
  
  // 恢复执行
  console.log("=== 恢复执行 ===");
  debugger; // 观察恢复过程
  const result = await app.invoke(
    new Command({ resume: { approve: true } }),
    config
  );
  console.log("最终结果:", result);
}

main();
```

## 流式输出调试

### 事件流调试

```typescript
// debug-stream.ts
import { StateGraph } from "@langchain/langgraph";

interface State {
  value: number;
}

async function node1(state: State) {
  console.log("[Node 1]", state);
  return { value: state.value + 1 };
}

async function node2(state: State) {
  console.log("[Node 2]", state);
  return { value: state.value * 2 };
}

const workflow = new StateGraph<State>()
  .addNode("node1", node1)
  .addNode("node2", node2)
  .addEdge("__start__", "node1")
  .addEdge("node1", "node2");

const app = workflow.compile();

async function main() {
  console.log("=== 值流式输出 ===");
  for await (const chunk of app.stream({ value: 0 })) {
    console.log("Chunk:", chunk);
  }
  
  console.log("\n=== 事件流式输出 ===");
  for await (const event of app.streamEvents({ value: 0 }, {
    version: "v2",
  })) {
    console.log("Event:", event.event, event.data);
  }
}

main();
```

## 性能问题分析

### 1. 慢查询分析

```typescript
// 在 checkpoint 操作中设置性能断点
async save(
  checkpoint: Checkpoint,
  config: RunnableConfig
): Promise<void> {
  const start = Date.now();
  // 👈 设置断点测量耗时
  await this.client.query(...);
  const duration = Date.now() - start;
  console.log(`Save took ${duration}ms`);
}
```

### 2. 内存泄漏检测

```bash
# 使用 Node.js 内置性能工具
node --inspect --expose-gc debug-script.js

# 在 Chrome DevTools 中:
# 1. 打开 Memory 面板
# 2. 拍摄堆快照
# 3. 执行操作
# 4. 再次拍摄快照
# 5. 对比查找泄漏
```

### 3. 并发问题分析

```typescript
// 在 PregelRunner 中添加日志
async *executeTasks(
  tasks: PregelExecutableTask[]
): AsyncGenerator {
  console.log(`Executing ${tasks.length} tasks concurrently`);
  // 👈 观察并发任务数量
}
```

## 远程调试

### 附加到运行进程

```bash
# 启动时启用 inspect
node --inspect-brk dist/index.js

# 或重启现有进程
kill -USR1 <pid>  # Node.js v10+
```

### Docker 容器调试

```yaml
# docker-compose.debug.yml
services:
  app:
    command: node --inspect=0.0.0.0:9229 dist/index.js
    ports:
      - "9229:9229"
```

## 调试工具

### 1. LangGraph Studio

官方的可视化调试工具：

```bash
# 安装
pnpm add -D @langchain/langgraph-ui

# 启动
pnpm exec langgraph-studio
```

### 2. 日志级别控制

```typescript
// 设置调试日志
process.env.DEBUG = 'langgraph:*'

// 仅显示错误
process.env.DEBUG = 'langgraph:error'

// 显示特定模块
process.env.DEBUG = 'langgraph:pregel,langgraph:checkpoint'
```

### 3. 自定义调试中间件

```typescript
// debug-middleware.ts
import { RunnableConfig } from "@langchain/core/runnables";

export function createDebugMiddleware() {
  return async (config: RunnableConfig, next: () => Promise<any>) => {
    console.log("[Debug] Before:", config);
    const result = await next();
    console.log("[Debug] After:", result);
    return result;
  };
}
```

## 常见问题排查

### Q: 断点不触发

**检查清单：**
1. Source Maps 是否启用
2. 代码是否已重新编译
3. 断点是否在正确文件路径
4. 调试配置是否正确

```bash
# 重新编译
pnpm build

# 清理缓存
rm -rf node_modules/.vite
```

### Q: 变量值不显示

**解决方案：**
1. 添加到 Watch 面板
2. 使用 console.log 辅助
3. 检查作用域

### Q: 异步代码难以追踪

**技巧：**
1. 使用 async/await 而非 Promise
2. 添加详细的日志
3. 使用 Performance 面板

## 小结

本节介绍了 LangGraphJS 源码调试的完整方法论：

- ✅ VSCode 调试配置
- ✅ 断点设置技巧
- ✅ 核心模块断点位置
- ✅ 调试脚本示例
- ✅ 流式输出调试
- ✅ 性能问题分析
- ✅ 常见问题排查

掌握了调试技巧后，我们就可以深入学习 LangGraphJS 的架构设计了。

## 下一章

- [架构篇 - 整体架构](/architecture/overview) - 分层架构、图执行流程
- [架构篇 - Pregel 系统](/architecture/pregel) - Actor 模型、图执行引擎