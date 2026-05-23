# 自定义 Agent

## 概述

自定义 Agent 是 LangGraphJS 中最灵活的开发模式，允许你从头开始构建完全自定义的 AI Agent。虽然 LangGraph 提供了预构建的 `createReactAgent` 和其他 Agent 模板，但实际应用中经常需要更复杂的逻辑、特定的流程控制或独特的交互模式。

## 为什么需要自定义 Agent

### 预构建 Agent 的限制

预构建 Agent（如 `createReactAgent`）提供了开箱即用的功能，但在以下场景可能不够用：

| 场景 | 预构建限制 | 自定义方案 |
|------|------------|------------|
| 多阶段处理 | 单一循环 | 自定义节点序列 |
| 条件路由 | 固定的工具调用 | 动态决策逻辑 |
| 并行执行 | 串行工具执行 | Send API 并行 |
| 人工审核 | 有限支持 | 完全控制 |
| 多模型协作 | 单一 LLM | 多 LLM 协作 |

### 自定义 Agent 的优势

- **灵活性**：完全控制执行流程
- **可扩展性**：支持任意复杂的逻辑
- **可维护性**：代码结构清晰
- **性能优化**：针对性的并行/缓存策略

## 从头构建自定义 Agent

### 基础结构

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { MessagesAnnotation } from "@langchain/langgraph";

// 1. 定义状态
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  iteration: Annotation<number>({
    reducer: (_, update) => update ?? 0,
    default: () => 0,
  }),
  step: Annotation<string>({ default: () => "start" }),
});

// 2. 创建 LLM
const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });

// 3. 定义节点
async function plannerNode(state) {
  // 规划阶段
  const systemPrompt = "你是一个规划助手。请规划任务步骤。";
  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    ...state.messages,
  ]);
  return { messages: [response], step: "planning" };
}

async function executorNode(state) {
  // 执行阶段
  const systemPrompt = "你是一个执行助手。请执行计划。";
  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    ...state.messages,
  ]);
  return { messages: [response], step: "executing" };
}

async function reviewerNode(state) {
  // 审核阶段
  const systemPrompt = "你是一个审核助手。请检查结果。";
  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    ...state.messages,
  ]);
  return { messages: [response], step: "reviewing" };
}

// 4. 决策逻辑
function shouldContinue(state) {
  if (state.iteration >= 3) {
    return END;  // 最多 3 轮
  }
  
  // 检查是否需要继续
  const lastMessage = state.messages[state.messages.length - 1];
  if (isComplete(lastMessage)) {
    return END;
  }
  return "executor";
}

// 5. 构建图
const workflow = new StateGraph(AgentState)
  .addNode("planner", plannerNode)
  .addNode("executor", executorNode)
  .addNode("reviewer", reviewerNode)
  .addEdge(START, "planner")
  .addEdge("planner", "executor")
  .addEdge("executor", "reviewer")
  .addConditionalEdges("reviewer", shouldContinue, {
    "executor": "executor",
    [END]: END,
  })
  .compile();
```

## 高级自定义模式

### 模式 1：多 Agent 协作

```typescript
// 不同的专家 Agent
const ResearcherAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  researchQuery: Annotation<string>(),
  findings: Annotation<string[]>({ default: () => [] }),
});

const WriterAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  content: Annotation<string>(),
  draft: Annotation<string>(),
});

const ReviewerAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  feedback: Annotation<string>(),
  approved: Annotation<boolean>({ default: () => false }),
});

// 研究人员
async function researcher(state, config) {
  const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.3 });
  
  const response = await llm.invoke([
    { role: "system", content: "你是一个研究专家。深入研究主题并提供详细的事实和信息。" },
    ...state.messages,
  ]);
  
  // 提取研究结果
  const findings = extractFindings(response.content);
  
  return {
    messages: [response],
    findings,
  };
}

// 写作者
async function writer(state, config) {
  const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.7 });
  
  const prompt = `基于以下研究发现撰写内容：
${state.findings.join("\n")}

请撰写清晰、连贯的内容。`;

  const response = await llm.invoke([
    { role: "system", content: prompt },
    ...state.messages,
  ]);
  
  return {
    messages: [response],
    content: response.content,
  };
}

// 审核员
async function reviewer(state, config) {
  const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.2 });
  
  const response = await llm.invoke([
    { role: "system", content: "审核以下内容是否清晰、准确、完整。" },
    ...state.messages,
  ]);
  
  const approved = response.content.includes("APPROVED");
  
  return {
    messages: [response],
    feedback: response.content,
    approved,
  };
}

// 监督者
async function supervisor(state, config) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  // 决定下一步
  if (!state.findings || state.findings.length === 0) {
    return new Send("researcher");
  }
  
  if (!state.content) {
    return new Send("writer");
  }
  
  if (!state.approved) {
    return new Send("reviewer");
  }
  
  return END;
}

// 构建协作 Agent
const collaborativeAgent = new StateGraph(/* 联合状态 */)
  .addNode("researcher", researcher)
  .addNode("writer", writer)
  .addNode("reviewer", reviewer)
  .addEdge(START, "researcher")
  .addConditionalEdges("researcher", supervisor, {
    "researcher": "researcher",
    "writer": "writer",
    "reviewer": "reviewer",
  })
  .addConditionalEdges("writer", supervisor)
  .addConditionalEdges("reviewer", supervisor)
  .compile();
```

### 模式 2：动态工具路由

```typescript
// 动态决定使用哪个工具
async function dynamicToolRouter(state) {
  // 分析输入意图
  const intent = await classifyIntent(state.messages);
  
  // 根据意图选择工具
  const toolNode = intent === "search" ? searchToolNode : calculatorToolNode;
  
  return await toolNode.invoke(state);
}

// 或者使用 Send API 动态选择
function routeToTool(state) {
  if (needsSearch(state)) {
    return new Send("web_search");
  }
  if (needsCalculation(state)) {
    return new Send("calculator");
  }
  if (needsThinking(state)) {
    return new Send("deep_thought");
  }
  return END;
}

const dynamicAgent = new StateGraph(AgentState)
  .addNode("route", dynamicToolRouter)
  .addNode("web_search", webSearchNode)
  .addNode("calculator", calculatorNode)
  .addNode("deep_thought", thoughtNode)
  .addEdge(START, "route")
  .addConditionalEdges("route", routeToTool)
  .addEdge("web_search", "route")
  .addEdge("calculator", "route")
  .addEdge("deep_thought", "route")
  .compile();
```

### 模式 3：记忆增强 Agent

```typescript
// 长期记忆状态
const MemoryAgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  // 短期记忆
  shortTermMemory: Annotation<string[]>({ default: () => [] }),
  // 长期记忆
  longTermMemory: Annotation<string[]>({ default: () => [] }),
  // 记忆摘要
  memorySummary: Annotation<string>({ default: () => "" }),
});

// 记忆管理节点
async function memoryManager(state) {
  // 更新短期记忆
  const newShortTerm = [
    ...state.shortTermMemory.slice(-5),  // 保持最近 5 条
    summarizeLastMessage(state.messages),
  ];
  
  // 定期归档到长期记忆
  const shouldArchive = state.shortTermMemory.length >= 5;
  
  if (shouldArchive) {
    const summary = await summarizeShortTermMemory(newShortTerm);
    return {
      shortTermMemory: [],
      longTermMemory: [...state.longTermMemory, summary],
      memorySummary: summary,
    };
  }
  
  return { shortTermMemory: newShortTerm };
}

// 增强 LLM 上下文
async function enhancedLLM(state) {
  const context = buildContext(state);
  
  const response = await llm.invoke([
    { role: "system", content: context },
    ...state.messages,
  ]);
  
  return { messages: [response] };
}

const memoryAgent = new StateGraph(MemoryAgentState)
  .addNode("memory", memoryManager)
  .addNode("llm", enhancedLLM)
  .addEdge(START, "memory")
  .addEdge("memory", "llm")
  .compile();
```

## 自定义 Agent 示例

### 示例 1：数据处理管道 Agent

```typescript
const PipelineState = Annotation.Root({
  input: Annotation<string>(),
  stage: Annotation<string>({ default: () => "validate" }),
  errors: Annotation<string[]>({ default: () => [] }),
  results: Annotation<any[]>({ default: () => [] }),
  processedCount: Annotation<number>({ default: () => 0 }),
});

// 验证节点
async function validateNode(state) {
  const errors = [];
  const valid = validateInput(state.input);
  
  if (!valid) {
    errors.push("Input validation failed");
  }
  
  return {
    errors,
    stage: errors.length > 0 ? "error" : "transform",
  };
}

// 转换节点
async function transformNode(state) {
  const results = await transformData(state.input);
  
  return {
    results,
    processedCount: 1,
    stage: "enrich",
  };
}

// 增强节点
async function enrichNode(state) {
  const enriched = await Promise.all(
    state.results.map(async (item) => {
      const enrichment = await callExternalAPI(item);
      return { ...item, ...enrichment };
    })
  );
  
  return { results: enriched, stage: "output" };
}

// 输出节点
async function outputNode(state) {
  const formatted = formatOutput(state.results);
  return { results: [formatted], stage: "complete" };
}

// 错误处理节点
async function errorNode(state) {
  console.error("Pipeline errors:", state.errors);
  
  // 可以选择恢复或停止
  const canRecover = determineRecoverability(state.errors);
  
  if (canRecover) {
    return { stage: "validate", errors: [] };
  }
  
  return { stage: "complete", errors: state.errors };
}

function pipelineRouter(state) {
  const routes: Record<string, string> = {
    "validate": "validate",
    "transform": "transform",
    "enrich": "enrich",
    "error": "error_handler",
    "output": "output",
    "complete": END,
  };
  
  return routes[state.stage] || END;
}

const pipelineAgent = new StateGraph(PipelineState)
  .addNode("validate", validateNode)
  .addNode("transform", transformNode)
  .addNode("enrich", enrichNode)
  .addNode("output", outputNode)
  .addNode("error_handler", errorNode)
  .addEdge(START, "validate")
  .addConditionalEdges("validate", pipelineRouter)
  .addConditionalEdges("transform", pipelineRouter)
  .addConditionalEdges("enrich", pipelineRouter)
  .addConditionalEdges("output", pipelineRouter)
  .addConditionalEdges("error_handler", pipelineRouter)
  .compile();
```

### 示例 2：对话式问答 Agent

```typescript
const QAState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  question: Annotation<string>(),
  answer: Annotation<string>({ default: () => "" }),
  confidence: Annotation<number>({ default: () => 0 }),
  sources: Annotation<string[]>({ default: () => [] }),
});

// 解析问题
async function parseQuestion(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const parsed = await llm.invoke([
    { role: "system", content: "分析用户问题的意图和关键信息。" },
    ...state.messages,
  ]);
  
  return { question: extractQuestion(parsed.content) };
}

// 搜索知识
async function searchKnowledge(state) {
  const results = await searchKnowledgeBase(state.question);
  
  return {
    sources: results.map(r => r.title),
    // 添加搜索结果到消息
    messages: [{
      role: "system",
      content: `Context: ${JSON.stringify(results)}`,
    }],
  };
}

// 生成答案
async function generateAnswer(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const prompt = `基于以下上下文回答问题：
${state.messages[state.messages.length - 1].content}

问题：${state.question}

如果不确定，请说明信息来源有限。`;

  const response = await llm.invoke([
    { role: "user", content: prompt },
  ]);
  
  // 评估置信度
  const confidence = await evaluateConfidence(response.content, state.sources);
  
  return {
    answer: response.content,
    confidence,
  };
}

// 质量保证
async function qualityCheck(state) {
  if (state.confidence < 0.7) {
    // 低置信度，需要人工审核
    return { stage: "review" };
  }
  return { stage: "complete" };
}

const qaAgent = new StateGraph(QAState)
  .addNode("parse", parseQuestion)
  .addNode("search", searchKnowledge)
  .addNode("generate", generateAnswer)
  .addNode("quality", qualityCheck)
  .addEdge(START, "parse")
  .addEdge("parse", "search")
  .addEdge("search", "generate")
  .addEdge("generate", "quality")
  .addConditionalEdges("quality", (state) => 
    state.stage === "review" ? "review" : END
  )
  .compile();
```

### 示例 3：代码生成 Agent

```typescript
const CodeGenState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  spec: Annotation<string>(),
  code: Annotation<string>({ default: () => "" }),
  tests: Annotation<string[]>({ default: () => [] }),
  testResults: Annotation<string[]>({ default: () => [] }),
  iterations: Annotation<number>({ default: () => 0 }),
});

async function specAnalysis(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const response = await llm.invoke([
    { role: "system", content: "分析需求规格，提取关键功能和技术要求。" },
    ...state.messages,
  ]);
  
  return { spec: response.content };
}

async function codeGeneration(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const code = await llm.invoke([
    { role: "system", content: `基于以下规格生成代码：${state.spec}` },
    ...state.messages,
  ]);
  
  return { code: extractCode(code.content) };
}

async function testGeneration(state) {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const tests = await llm.invoke([
    { role: "system", content: `为以下代码生成测试用例：${state.code}` },
  ]);
  
  return { tests: extractTests(tests.content) };
}

async function testExecution(state) {
  const results = [];
  
  for (const test of state.tests) {
    const result = await runTest(test, state.code);
    results.push(result);
  }
  
  return {
    testResults: results,
    iterations: state.iterations + 1,
  };
}

async function codeRevision(state) {
  const failedTests = state.testResults.filter(r => !r.passed);
  
  if (failedTests.length === 0 || state.iterations >= 3) {
    return { stage: "complete" };
  }
  
  // 基于失败测试修订代码
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const response = await llm.invoke([
    { role: "system", content: `修复代码通过失败的测试：${failedTests.join("\n")}` },
    { role: "assistant", content: state.code },
  ]);
  
  return { code: extractCode(response.content), stage: "test" };
}

function codeRouter(state) {
  if (state.stage === "complete") return END;
  if (state.stage === "test") return "test_exec";
  if (state.stage === "revision") return "revision";
  return "spec";
}

const codeAgent = new StateGraph(CodeGenState)
  .addNode("spec", specAnalysis)
  .addNode("generate", codeGeneration)
  .addNode("test_gen", testGeneration)
  .addNode("test_exec", testExecution)
  .addNode("revision", codeRevision)
  .addEdge(START, "spec")
  .addEdge("spec", "generate")
  .addEdge("generate", "test_gen")
  .addEdge("test_gen", "test_exec")
  .addConditionalEdges("test_exec", (state) => state.stage)
  .addEdge("revision", "test_exec")
  .compile();
```

## 性能优化

### 1. 并行执行

```typescript
// 使用 Send API 并行处理
function parallelExpand(state) {
  const tasks = ["task1", "task2", "task3"];
  
  return tasks.map(task => 
    new Send("worker", { task })
  );
}

// 并行节点可以配置
async function worker(state) {
  return { result: await process(state.task) };
}

const parallelAgent = new StateGraph(StateAnnotation)
  .addNode("expand", parallelExpand)
  .addNode("worker", worker)
  .addEdge(START, "expand")
  .addEdge("worker", END)
  .compile();
```

### 2. 缓存策略

```typescript
const cache = new Map<string, any>();

async function cachedLLM(state, config) {
  const cacheKey = hashMessages(state.messages);
  
  if (cache.has(cacheKey)) {
    return { messages: [cache.get(cacheKey)] };
  }
  
  const response = await llm.invoke(state.messages);
  cache.set(cacheKey, response);
  
  return { messages: [response] };
}
```

## 最佳实践

### 1. 明确的状态定义

```typescript
// ✅ 好的状态定义
const GoodState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  context: Annotation<string>({ default: () => "" }),
  step: Annotation<string>({ default: () => "initial" }),
});

// ❌ 避免过度复杂的状态
const BadState = Annotation.Root({
  // 太多字段...
  field1: Annotation<string>(),
  field2: Annotation<string>(),
  // ...
  field100: Annotation<string>(),
});
```

### 2. 清晰的节点职责

```typescript
// ✅ 每个节点做好一件事
async function searchNode(state) {
  // 只负责搜索
  return { results: await search(state.query) };
}

async function evaluateNode(state) {
  // 只负责评估
  return { score: await evaluate(state.results) };
}

// ❌ 避免巨型节点
async function doEverything(state) {
  // 做太多事情...
  const results = await search(state.query);
  const evaluated = await evaluate(results);
  const formatted = await format(evaluated);
  // ...
}
```

### 3. 良好的错误边界

```typescript
// 在节点内处理可恢复错误
async function robustNode(state) {
  try {
    return await riskyOperation(state.input);
  } catch (error) {
    // 返回降级结果
    return { result: getFallbackResult(), error: error.message };
  }
}
```

## 总结

自定义 Agent 提供：

- ✅ **完全控制**：精细的执行流程控制
- ✅ **高度灵活**：支持任意复杂的逻辑
- ✅ **可组合性**：模块化设计，易于维护
- ✅ **可扩展**：支持并行、缓存、记忆等高级特性

根据需求选择预构建 Agent 或自定义 Agent，在复杂度和灵活性之间找到平衡。

## 参考资料

- [LangGraph 自定义 Agent 文档](https://langchain-ai.github.io/langgraphjs/how-tos/custom-agent/)
- [StateGraph API 文档](https://langchain-ai.github.io/langgraphjs/reference/class/StateGraph/)
- [LangGraph 示例集合](https://github.com/langchain-ai/langgraphjs/tree/main/examples)