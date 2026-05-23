# 远程执行 Remote Graph

## 概述

远程执行（Remote Graph）是 LangGraphJS 提供的一项重要能力，允许将图的执行**卸载到远程服务器**上运行。这种架构模式使得开发者可以：

- **分离计算资源**：在本地编排图结构，在云端执行
- **实现分布式部署**：将复杂计算分布到多个节点
- **构建 API 服务**：提供托管的图执行服务
- **节省本地资源**：将密集计算任务放到服务器

LangGraphJS 通过 `RemoteGraph` 类实现了这一功能，使得远程图 execution 与本地图 execution 具有几乎相同的接口。

## 为什么需要远程执行

### 本地执行的局限

在纯本地执行模式下：

```
┌─────────────────────────────────────┐
│         本地应用                      │
│  ┌──────────────┐                   │
│  │   Graph      │                   │
│  │  Execution   │                   │
│  └──────────────┘                   │
│         ↓                            │
│  需要本地资源                         │
│  - CPU/GPU                           │
│  - 内存                              │
│  - LLM API 密钥                       │
└─────────────────────────────────────┘
```

面临的问题：
1. **资源限制**：复杂的图需要大量计算资源
2. **安全性**：LLM API 密钥可能暴露在客户端
3. **版本管理**：难以统一更新图逻辑
4. **可扩展性**：无法轻松扩展执行能力

### 远程执行的优势

```
┌─────────────────────────────────────────────────────────┐
│                    本地应用                              │
│  ┌──────────────┐                                       │
│  │ RemoteGraph  │                                       │
│  └──────┬───────┘                                       │
│         │ HTTP/远程调用                                  │
└─────────┼───────────────────────────────────────────────┘
          │
          ↓
┌─────────────────────────────────────────────────────────┐
│                  远程服务器                              │
│  ┌──────────────┐                                       │
│  │ Graph        │                                       │
│  │ Execution    │ ← 强大的服务器资源                     │
│  └──────────────┘                                       │
│         ↓                                               │
│  - 集中式密钥管理                                        │
│  - 统一版本控制                                         │
│  - 弹性扩展                                             │
└─────────────────────────────────────────────────────────┘
```

## RemoteGraph 架构

### 基本组件

```typescript
// libs/langgraph-core/src/pregel/remote.ts

export class RemoteGraph extends BaseChannel {
  // 远程服务的配置
  private readonly url: string;
  private readonly headers?: Record<string, string>;
  
  // 代理的本地图标识
  public readonly name?: string;
  
  // 是否强制本地执行某些操作
  private readonly forceLocalProcesses?: boolean;
  
  constructor(options: RemoteGraphOptions);
}
```

### 核心特性

| 特性 | 描述 |
|------|------|
| **透明代理** | RemoteGraph 接口与本地图几乎相同 |
| **异步调用** | 所有操作都是异步的 |
| **状态同步** | 支持获取远程状态 |
| **流式支持** | 支持远程流式输出 |
| **Checkpoints** | 支持远程检查点 |

## 基本用法

### 创建 RemoteGraph

```typescript
import { RemoteGraph } from "@langchain/langgraph/remote";

// 连接到远程 LangGraph 服务
const remoteGraph = new RemoteGraph({
  url: "https://api.example.com/langgraph",
  graphId: "my-assistant-graph",  // 远程图的标识符
  apiKey: "your-api-key",
});

// 使用方式与本地图相同
const result = await remoteGraph.invoke({
  messages: [{ role: "user", content: "Hello" }]
});
```

### 配置选项

```typescript
interface RemoteGraphOptions {
  /**
   * 远程 LangGraph 服务的 URL
   */
  url: string;
  
  /**
   * 远程图的标识符
   */
  graphId: string;
  
  /**
   * 认证 API Key（可选）
   */
  apiKey?: string;
  
  /**
   * 额外的 HTTP 头（可选）
   */
  headers?: Record<string, string>;
  
  /**
   * 是否强制某些操作本地执行（可选）
   */
  forceLocalProcesses?: boolean;
  
  /**
   * 请求超时（毫秒）
   */
  timeout?: number;
}
```

### 完整的远程执行流程

```typescript
import { RemoteGraph } from "@langchain/langgraph/remote";
import { Notify } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

// 创建远程图实例
const graph = new RemoteGraph({
  url: "https://langgraph-api.example.com",
  graphId: "customer-support-agent",
  apiKey: process.env.LANGGRAPH_API_KEY,
  headers: {
    "Content-Type": "application/json",
  },
});

async function chatWithAgent(userMessage: string, threadId: string) {
  const config = {
    configurable: { thread_id: threadId },
  };
  
  // 调用远程图
  const result = await graph.invoke(
    {
      messages: [new HumanMessage(userMessage)],
    },
    config
  );
  
  // 获取 AI 回复
  const lastMessage = result.messages[result.messages.length - 1];
  return lastMessage.content;
}

// 使用示例
const response = await chatWithAgent(
  "I need help with my order",
  "user-123"
);
console.log("Agent response:", response);
```

## 远程流式输出

RemoteGraph 支持流式输出，与本地图类似：

```typescript
async function streamFromRemote() {
  const stream = await graph.stream(
    { messages: [new HumanMessage("Process this")] },
    {
      streamMode: "values",
      configurable: { thread_id: "session-1" },
    }
  );
  
  for await (const chunk of stream) {
    console.log("Remote state update:", chunk);
  }
}
```

### 获取远程状态

```typescript
async function getRemoteState(threadId: string) {
  const config = { configurable: { thread_id: threadId } };
  
  // 获取最新状态
  const state = await graph.getState(config);
  console.log("Current state:", state.values);
  
  // 获取历史状态
  const history = await graph.getHistory(config);
  for await (const checkpoint of history) {
    console.log("Historical state:", checkpoint);
  }
}
```

## LangGraph SDK 集成

LangGraph 提供了官方的 SDK 来简化远程图的调用：

### SDK 安装

```bash
npm install @langchain/langgraph-sdk
```

### SDK 基本用法

```typescript
import { Client } from "@langchain/langgraph-sdk";

// 创建客户端
const client = new Client({
  apiUrl: "https://api.langgraph.example.com",
  apiKey: process.env.LANGGRAPH_API_KEY,
});

// 调用远程图
async function runGraph(input: any, threadId?: string) {
  const response = await client.runs.create(
    threadId,  // 线程 ID
    "my-graph-assistant",  // 图标识
    { input }
  );
  return response;
}

// 流式执行
async function streamGraph(input: any, threadId: string) {
  const events = client.runs.stream(
    threadId,
    "my-graph-assistant",
    { input, streamMode: "values" }
  );
  
  for await (const event of events) {
    console.log("Event:", event);
  }
}
```

### SDK 高级功能

#### 线程管理

```typescript
// 创建新线程
const thread = await client.threads.create({
  metadata: { userId: "user-123" },
});

console.log("Thread created:", thread.thread_id);

// 获取线程信息
const threadInfo = await client.threads.get(thread.thread_id);

// 删除线程
await client.threads.delete(thread.thread_id);

// 列出线程
const threads = await client.threads.search({
  metadata: { userId: "user-123" },
  limit: 10,
});
```

#### 检查点管理

```typescript
// 列出检查点
const checkpoints = await client.checkpoints.list(threadId);

// 获取特定检查点
const checkpoint = await client.checkpoints.get(threadId, checkpointId);

// 恢复检查点
await client.runs.create(
  threadId,
  "my-graph",
  {
    input: null,  // 使用 checkpoint 的状态
    checkpointId: checkpoint.id,
  }
);
```

#### Cron 调度

```typescript
// 创建定时任务
const cronJob = await client.crons.create({
  graphId: "daily-report-generator",
  schedule: "0 9 * * *",  // 每天 9 点
  input: { reportType: "daily" },
  config: { configurable: { thread_id: "reports" } },
});

// 列出定时任务
const cronJobs = await client.crons.search();

// 删除定时任务
await client.crons.delete(cronJob.cron_id);
```

## 服务器端部署

### LangGraph Server

LangGraph 提供了官方的服务器部署方案：

```yaml
# docker-compose.yml
version: '3'
services:
  langgraph-api:
    image: langchain/langgraph-api:latest
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - LANGSMITH_API_KEY=${LANGSMITH_API_KEY}
    ports:
      - "8123:8000"
    volumes:
      - ./langgraph.json:/langgraph.json
      - ./src:/src
```

### langgraph.json 配置

```json
{
  "graphs": {
    "assistant": "./src/agent.py:graph"
  },
  "env": ".env",
  "python_version": "3.11",
  "dependencies": [
    "."
  ]
}
```

### 本地测试服务器

```bash
# 安装 LangGraph CLI
pip install langgraph-cli

# 启动本地服务器
langgraph dev

# 访问 http://localhost:8123
```

## 实践示例

### 示例 1：多租户客服系统

```typescript
// 远程客服 Agent
import { Client } from "@langchain/langgraph-sdk";

class CustomerSupportService {
  private client: Client;
  
  constructor() {
    this.client = new Client({
      apiUrl: process.env.LANGGRAPH_API_URL,
      apiKey: process.env.LANGGRAPH_API_KEY,
    });
  }
  
  async startConversation(customerId: string, initialMessage: string) {
    // 为每个客户创建独立的线程
    const thread = await this.client.threads.create({
      metadata: { 
        customerId,
        channel: "web" 
      },
    });
    
    // 发送初始消息
    await this.client.runs.create(
      thread.thread_id,
      "customer-support-agent",
      {
        input: { 
          messages: [{ role: "user", content: initialMessage }] 
        },
      }
    );
    
    return thread.thread_id;
  }
  
  async sendMessage(threadId: string, message: string) {
    const response = await this.client.runs.create(
      threadId,
      "customer-support-agent",
      {
        input: { 
          messages: [{ role: "user", content: message }] 
        },
      }
    );
    
    return response;
  }
  
  async getConversationHistory(threadId: string) {
    const state = await this.client.threads.getState(threadId);
    return state?.values?.messages || [];
  }
}

// 使用示例
const support = new CustomerSupportService();

// 开始对话
const threadId = await support.startConversation(
  "customer-456",
  "I have a billing question"
);

// 发送消息
await support.sendMessage(threadId, "My last charge seems incorrect");

// 获取历史记录
const history = await support.getConversationHistory(threadId);
```

### 示例 2：分布式数据处理管道

```typescript
// 主应用程序
import { Client } from "@langchain/langgraph-sdk";

class DataProcessingPipeline {
  private client: Client;
  
  constructor() {
    this.client = new Client({
      apiUrl: process.env.PROCESSING_API_URL,
    });
  }
  
  async processDocuments(documents: any[]) {
    // 为每批文档创建处理任务
    const batches = this.chunkDocuments(documents, 10);
    
    const results = await Promise.all(
      batches.map(batch => this.processBatch(batch))
    );
    
    return results.flat();
  }
  
  private async processBatch(documents: any[]) {
    const thread = await this.client.threads.create({
      metadata: { 
        type: "document-processing",
        batchId: crypto.randomUUID(),
      },
    });
    
    const result = await this.client.runs.create(
      thread.thread_id,
      "document-processor",
      {
        input: { documents },
      }
    );
    
    return result;
  }
  
  private chunkDocuments(docs: any[], size: number): any[][] {
    const chunks = [];
    for (let i = 0; i < docs.length; i += size) {
      chunks.push(docs.slice(i, i + size));
    }
    return chunks;
  }
}

// 使用示例
const pipeline = new DataProcessingPipeline();

const processed = await pipeline.processDocuments(
  documents  // 大量文档
);
```

### 示例 3：A/B 测试框架

```typescript
// 使用远程图进行 A/B 测试
import { Client } from "@langchain/langgraph-sdk";

class ABTestingFramework {
  private client: Client;
  
  constructor() {
    this.client = new Client({
      apiUrl: process.env.AGENT_API_URL,
    });
  }
  
  async routeRequest(userId: string, input: any) {
    // A/B 测试分流
    const variant = this.getVariant(userId);
    const graphId = variant === 'A' 
      ? 'agent-variant-a' 
      : 'agent-variant-b';
    
    const thread = await this.getOrCreateThread(userId);
    
    const result = await this.client.runs.create(
      thread.thread_id,
      graphId,
      { input }
    );
    
    // 记录测试数据
    await this.logExperiment(userId, variant, result);
    
    return result;
  }
  
  private getVariant(userId: string): 'A' | 'B' {
    // 简单的哈希分流
    const hash = this.hashUserId(userId);
    return hash % 2 === 0 ? 'A' : 'B';
  }
  
  private async getOrCreateThread(userId: string) {
    // 查找或创建用户线程
    const threads = await this.client.threads.search({
      metadata: { userId },
    });
    
    if (threads.length > 0) {
      return threads[0];
    }
    
    return await this.client.threads.create({
      metadata: { userId },
    });
  }
}
```

### 示例 4：多区域部署

```typescript
// 根据用户区域路由到最近的服务器
import { Client } from "@langchain/langgraph-sdk";

class MultiRegionAgent {
  private clients: Map<string, Client>;
  
  constructor() {
    this.clients = new Map([
      ['us', new Client({ apiUrl: 'https://us.api.langgraph.example.com' })],
      ['eu', new Client({ apiUrl: 'https://eu.api.langgraph.example.com' })],
      ['ap', new Client({ apiUrl: 'https://ap.api.langgraph.example.com' })],
    ]);
  }
  
  async routeAndExecute(userRegion: string, input: any, threadId: string) {
    const client = this.getClientForRegion(userRegion);
    
    return await client.runs.create(
      threadId,
      'global-agent',
      { input }
    );
  }
  
  private getClientForRegion(region: string): Client {
    // 确保有区域回退
    return this.clients.get(region) || this.clients.get('us');
  }
}
```

## 安全考虑

### API 密钥管理

```typescript
// ❌ 不推荐：硬编码密钥
const client = new Client({
  apiKey: "sk-1234567890",  // 密钥泄露风险
});

// ✅ 推荐：使用环境变量
const client = new Client({
  apiKey: process.env.LANGGRAPH_API_KEY,
});

// ✅ 推荐：使用密钥管理服务
const client = new Client({
  apiKey: await getSecretFromVault("langgraph-api-key"),
});
```

### 访问控制

```typescript
// 服务器端验证
app.post('/api/run', async (req, res) => {
  // 验证用户身份
  const user = await authenticateUser(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // 检查权限
  const hasPermission = await checkGraphPermission(user.id, req.body.graphId);
  if (!hasPermission) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  // 执行远程图
  const result = await client.runs.create(...);
  res.json(result);
});
```

### 数据加密

```typescript
// 使用 HTTPS
const client = new Client({
  apiUrl: 'https://api.langgraph.example.com',  // 必须使用 HTTPS
});

// 敏感数据加密
const encryptedInput = await encryptData(sensitiveInput);
const result = await client.runs.create(threadId, graphId, {
  input: { encryptedData: encryptedInput },
});
```

## 性能优化

### 连接池

```typescript
// SDK 默认会维护连接池，但可以配置
const client = new Client({
  apiUrl: 'https://api.langgraph.example.com',
  timeout: 30000,  // 30 秒超时
  retry: {
    maxAttempts: 3,
    factor: 2,
  },
});
```

### 批量处理

```typescript
// 批量提交多个请求
async function batchRequests(inputs: any[]) {
  const promises = inputs.map(input => 
    client.runs.create(threadId, graphId, { input })
  );
  
  return await Promise.all(promises);
}
```

### 缓存策略

```typescript
const cache = new Map<string, any>();

async function cachedRun(input: string) {
  const cacheKey = `run:${hash(input)}`;
  
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  
  const result = await client.runs.create(threadId, graphId, {
    input: { message: input },
  });
  
  cache.set(cacheKey, result);
  return result;
}
```

## 调试与监控

### 使用 LangSmith 追踪

```typescript
import { Client } from "@langchain/langgraph-sdk";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

const client = new Client({
  apiUrl: process.env.LANGGRAPH_API_URL,
  apiKey: process.env.LANGGRAPH_API_KEY,
});

// 配置追踪
const tracer = new LangChainTracer({
  projectName: "remote-graph-debug",
});

// 远程执行会被追踪
const result = await client.runs.create(
  threadId,
  "my-graph",
  { input, config: { callbacks: [tracer] } }
);
```

### 日志记录

```typescript
// 详细日志
client.setLogLevel('debug');

// 或使用自定义日志
client.setLogger({
  debug: (msg) => console.log('[DEBUG]', msg),
  info: (msg) => console.log('[INFO]', msg),
  warn: (msg) => console.warn('[WARN]', msg),
  error: (msg) => console.error('[ERROR]', msg),
});
```

## 常见问题 FAQ

### Q1: RemoteGraph 和本地图性能差异大吗？

**A**: 会有一定的网络延迟开销，但对于复杂的图执行来说，这个开销通常可以接受。对于延迟敏感的场景，建议：
- 尽量让服务器靠近客户端
- 使用批量处理减少调用次数
- 考虑缓存结果

### Q2: 如何处理远程执行失败？

**A**: SDK 提供重试机制：

```typescript
const client = new Client({
  retry: {
    maxAttempts: 3,
    factor: 2,  // 指数退避
    minTimeout: 1000,
    maxTimeout: 10000,
  },
});
```

### Q3: 可以混合使用远程和本地执行吗？

**A**: 可以。可以配置某些操作本地执行：

```typescript
const graph = new RemoteGraph({
  url: REMOTE_URL,
  forceLocalProcesses: ['cleanup', 'local_cache'],
});
```

### Q4: 如何确保数据一致性？

**A**: 
- 使用线程 ID 确保会话隔离
- 使用检查点系统保存状态
- 实现幂等操作

### Q5: RemoteGraph 支持子图吗？

**A**: 支持，但需要在服务器端正确配置子图路由。

## 总结

RemoteGraph 提供了强大的远程执行能力：

- ✅ **接口一致**：与本地图几乎相同的 API
- ✅ **SDK 支持**：完整的 TypeScript SDK
- ✅ **流式输出**：支持远程流式执行
- ✅ **状态管理**：远程线程和检查点管理
- ✅ **可扩展**：支持分布式部署

合理使用远程执行可以将计算密集型任务转移到服务器，同时保持客户端的简洁和响应性。

## 参考资料

- [LangGraphJS 源码 - Remote](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/remote.ts)
- [LangGraph SDK 文档](https://langchain-ai.github.io/langgraphjs/sdk/)
- [LangGraph Server 部署指南](https://langchain-ai.github.io/langgraph/cloud/deployment/)