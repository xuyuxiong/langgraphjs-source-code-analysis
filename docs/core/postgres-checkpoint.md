# Postgres Checkpoint 存储

## 概述

Postgres Checkpoint 是 LangGraphJS 官方提供的**生产级**检查点存储实现，基于 PostgreSQL 数据库。它提供了：

- **持久化存储**：状态不会因进程重启而丢失
- **高并发支持**：支持多进程同时读写
- **事务安全**：保证数据一致性
- **水平扩展**：支持读写分离和分片
- **丰富查询**：支持复杂查询和过滤

Postgres 是生产环境中最常用的 Checkpoint 存储后端。

## 架构设计

### 数据库 Schema

```sql
-- Checkpoints 表
CREATE TABLE checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    parent_id TEXT,
    checkpoint BYTEA,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (thread_id, checkpoint_id)
);

-- Checkpoint Blobs 表（存储大对象）
CREATE TABLE checkpoint_blobs (
    thread_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    blob BYTEA,
    PRIMARY KEY (thread_id, channel, version)
);

-- Checkpoint Writes 表（待处理写入）
CREATE TABLE checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    value BYTEA,
    PRIMARY KEY (thread_id, checkpoint_id, task_id, idx)
);

-- 索引
CREATE INDEX idx_checkpoints_thread ON checkpoints(thread_id);
CREATE INDEX idx_checkpoints_parent ON checkpoints(parent_id);
CREATE INDEX idx_checkpoints_created ON checkpoints(created_at DESC);
```

### 数据组织

```
┌─────────────────────────────────────────────────────────────────┐
│                        PostgreSQL Database                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  checkpoints 表                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ thread_id │ checkpoint_id │ parent_id │ checkpoint │ ... │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ thread-1  │ uuid-1        │ null      │ {...}    │     │   │
│  │ thread-1  │ uuid-2        │ uuid-1    │ {...}    │     │   │
│  │ thread-1  │ uuid-3        │ uuid-2    │ {...}    │     │   │
│  │ thread-2  │ uuid-4        │ null      │ {...}    │     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  checkpoint_blobs 表                                             │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ thread_id │ channel  │ version │ blob                   │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │ thread-1  │ messages │ 1       │ [msg1, msg2, ...]      │     │
│  │ thread-1  │ messages │ 2       │ [msg1, msg2, msg3]     │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  checkpoint_writes 表                                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ thread_id │ checkpoint_id │ task_id │ channel │ value  │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ thread-1  │ uuid-2        │ task-1  │ messages│ [...]  │   │
│  │ thread-1  │ uuid-2        │ task-2  │ counter │ 42     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 安装与配置

### 安装包

```bash
npm install @langchain/langgraph-checkpoint-postgres
```

### 基础配置

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

// 创建数据库连接池
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 20,  // 最大连接数
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 创建 PostgresSaver
const checkpointer = await PostgresSaver.fromPool(pool, {
  schemaName: "public",  // 可选，默认 public
  tableName: "checkpoints",  // 可选，默认 checkpoints
});

// 初始化数据库表（首次使用需要）
await checkpointer.setup();

// 与图一起使用
const graph = workflow.compile({ checkpointer });
```

### Docker 部署 Postgres

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: langgraph
      POSTGRES_PASSWORD: langgraph
      POSTGRES_DB: langgraph
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql

volumes:
  postgres_data:
```

### 连接字符串方式

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// 使用连接字符串
const checkpointer = await PostgresSaver.fromConnString(
  "postgresql://langgraph:langgraph@localhost:5432/langgraph"
);

await checkpointer.setup();
```

## 核心 API

### 创建实例

```typescript
// 方式 1: 使用连接字符串
const checkpointer = await PostgresSaver.fromConnString(connectionString);

// 方式 2: 使用连接池
const pool = new Pool(config);
const checkpointer = await PostgresSaver.fromPool(pool);

// 方式 3: 使用现有客户端
const client = new Client(config);
await client.connect();
const checkpointer = new PostgresSaver(client);
```

### 初始化数据库

```typescript
// 创建表结构
await checkpointer.setup();

// 验证表是否已创建
const tables = await checkpointer.listTables();
console.log("Tables:", tables);
// ['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']
```

### 清理资源

```typescript
// 关闭连接
await checkpointer.end();

// 或者使用 with 语句自动管理
async function withCheckpointer<T>(fn: (cp: PostgresSaver) => Promise<T>): Promise<T> {
  const cp = await PostgresSaver.fromConnString(connString);
  await cp.setup();
  try {
    return await fn(cp);
  } finally {
    await cp.end();
  }
}
```

## 使用示例

### 基础用法

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

async function node1(state) {
  return { messages: [{ role: "assistant", content: "Hello from node 1" }] };
}

async function node2(state) {
  return { messages: [{ role: "assistant", content: "Hello from node 2" }] };
}

const workflow = new StateGraph(StateAnnotation)
  .addNode("node1", node1)
  .addNode("node2", node2)
  .addEdge(START, "node1")
  .addEdge("node1", "node2");

// 创建 Postgres 检查点
const checkpointer = await PostgresSaver.fromConnString(
  "postgresql://user:pass@localhost:5432/lang_graph"
);
await checkpointer.setup();

const graph = workflow.compile({ checkpointer });

// 使用
const config = { configurable: { thread_id: "thread-1" } };

// 第一次执行
const result1 = await graph.invoke(
  { messages: [{ role: "user", content: "Start" }] },
  config
);
console.log("Result 1:", result1);

// 继续执行（会使用之前的状态）
const result2 = await graph.invoke(
  { messages: [{ role: "user", content: "Continue" }] },
  config
);
console.log("Result 2:", result2);

// 查看历史
const history = await checkpointer.list({ configurable: { thread_id: "thread-1" } });
for await (const cp of history) {
  console.log("Checkpoint:", cp.checkpoint.id, cp.metadata);
}

// 清理
await checkpointer.end();
```

### 中断与恢复

```typescript
import { interrupt, Command } from "@langchain/langgraph";

async function reviewNode(state) {
  const approval = interrupt({
    type: "review",
    content: state.messages[state.messages.length - 1].content,
  });
  return { approved: approval };
}

const graph = new StateGraph(StateAnnotation)
  .addNode("review", reviewNode)
  .addEdge(START, "review")
  .compile({ checkpointer });

const config = { configurable: { thread_id: "review-thread" } };

// 触发中断
await graph.invoke({ messages: [{ role: "user", content: "Please review" }] }, config);

// 检查中断状态
const state = await graph.getState(config);
console.log("Interrupts:", state.tasks);

// 恢复执行
await graph.invoke(
  new Command({ resume: { approved: true } }),
  config
);

console.log("Final state:", await graph.getState(config));
```

### 时间旅行

```typescript
const config = { configurable: { thread_id: "time-travel" } };

// 多次执行创建历史
await graph.invoke({ input: "step 1" }, config);
await graph.invoke({ input: "step 2" }, config);
await graph.invoke({ input: "step 3" }, config);

// 列出所有 checkpoints
const checkpoints = [];
for await (const cp of checkpointer.list(config)) {
  checkpoints.push(cp);
  console.log(`Step ${cp.metadata?.step}: ${cp.checkpoint.id}`);
}

// 恢复到一个历史点
const oldCheckpoint = checkpoints[1];  // 恢复到第二步之后
const oldConfig = {
  configurable: {
    thread_id: "time-travel",
    checkpoint_id: oldCheckpoint.checkpoint.id,
  },
};

// 从历史点继续
const result = await graph.invoke(
  { input: "modified input" },
  oldConfig
);
```

### 多线程并发

```typescript
// 并发处理多个会话
const threads = Array.from({ length: 100 }, (_, i) => `thread-${i}`);

await Promise.all(
  threads.map(async (threadId) => {
    const config = { configurable: { thread_id: threadId } };
    
    await graph.invoke(
      { messages: [{ role: "user", content: `Hello from ${threadId}` }] },
      config
    );
  })
);

// 验证所有线程都有状态
for (const threadId of threads) {
  const state = await graph.getState({ configurable: { thread_id: threadId } });
  console.log(`${threadId}:`, state?.values?.messages?.length);
}
```

### 元数据过滤

```typescript
// 带元数据的执行
const config = { configurable: { thread_id: "meta-thread" } };

await graph.invoke(
  { messages: ["test"] },
  { ...config, metadata: { userId: "user-123", experiment: "A" } }
);

await graph.invoke(
  { messages: ["test"] },
  { ...config, metadata: { userId: "user-456", experiment: "B" } }
);

// 按元数据过滤
const userAHistory = [];
for await (const cp of checkpointer.list(config, {
  filter: { userId: "user-123" },
})) {
  userAHistory.push(cp);
}

console.log("User A checkpoints:", userAHistory.length);
```

## 高级功能

### 数据库迁移

```typescript
// 自定义表名和 schema
const checkpointer = await PostgresSaver.fromConnString(connString, {
  tableName: "langgraph_checkpoints",
  schemaName: "langgraph",
});

// 创建自定义 schema
await checkpointer.setup({
  createSchema: true,  // 如果不存在则创建
});
```

### 连接池配置

```typescript
import { Pool } from "pg";

const pool = new Pool({
  // 基本连接配置
  host: process.env.PGHOST,
  port: 5432,
  database: "langgraph",
  user: "langgraph",
  password: process.env.PGPASSWORD,
  
  // 连接池配置
  max: 20,  // 最大连接数
  min: 5,   // 最小连接数
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  
  // SSL 配置（生产环境）
  ssl: process.env.NODE_ENV === "production" ? {
    rejectUnauthorized: false,
  } : undefined,
});

const checkpointer = await PostgresSaver.fromPool(pool);
```

### 读写分离

```typescript
// 主从配置
const primaryPool = new Pool({
  host: "primary.db.example.com",
  // ...
});

const replicaPool = new Pool({
  host: "replica.db.example.com",
  // ...
});

// 自定义 checkpointer 类
class ReadWritePostgresSaver extends PostgresSaver {
  private readPool: Pool;
  
  constructor(writePool: Pool, readPool: Pool) {
    super(writePool);
    this.readPool = readPool;
  }
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    // 从从库读取
    const client = await this.readPool.connect();
    try {
      return await this._getTuple(client, config);
    } finally {
      client.release();
    }
  }
  
  async put(...): Promise<RunnableConfig> {
    // 写入到主库（使用父类方法）
    return super.put(...);
  }
}
```

### 数据备份与恢复

```typescript
// 导出所有 checkpoints 到 JSON
async function exportCheckpoints(
  checkpointer: PostgresSaver,
  threadId: string
): Promise<string> {
  const checkpoints = [];
  
  for await (const cp of checkpointer.list(
    { configurable: { thread_id: threadId } }
  )) {
    checkpoints.push({
      config: cp.config,
      checkpoint: cp.checkpoint,
      metadata: cp.metadata,
    });
  }
  
  return JSON.stringify(checkpoints, null, 2);
}

// 从 JSON 恢复
async function importCheckpoints(
  checkpointer: PostgresSaver,
  json: string
): Promise<void> {
  const checkpoints = JSON.parse(json);
  
  for (const cp of checkpoints) {
    const config = cp.config;
    await checkpointer.put(
      config,
      cp.checkpoint,
      cp.metadata,
      {}
    );
  }
}
```

### 监控与指标

```typescript
class MonitoredPostgresSaver extends PostgresSaver {
  private metrics = {
    getCallCount: 0,
    putCallCount: 0,
    listCallCount: 0,
    avgGetLatency: 0,
    avgPutLatency: 0,
  };
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const start = Date.now();
    this.metrics.getCallCount++;
    
    const result = await super.getTuple(config);
    
    const latency = Date.now() - start;
    this.metrics.avgGetLatency = 
      (this.metrics.avgGetLatency * (this.metrics.getCallCount - 1) + latency) / 
      this.metrics.getCallCount;
    
    return result;
  }
  
  async put(...args): Promise<RunnableConfig> {
    const start = Date.now();
    this.metrics.putCallCount++;
    
    const result = await super.put(...args);
    
    const latency = Date.now() - start;
    this.metrics.avgPutLatency = 
      (this.metrics.avgPutLatency * (this.metrics.putCallCount - 1) + latency) / 
      this.metrics.putCallCount;
    
    return result;
  }
  
  getMetrics() {
    return { ...this.metrics };
  }
}

// 使用
const checkpointer = await MonitoredPostgresSaver.fromConnString(connString);

// 定期检查指标
setInterval(() => {
  console.log("Checkpointer metrics:", checkpointer.getMetrics());
}, 60000);
```

## 性能优化

### 批量操作

```typescript
// 批量获取多个 checkpoints
async function batchGetCheckpoints(
  checkpointer: PostgresSaver,
  threadIds: string[]
): Promise<Map<string, CheckpointTuple[]>> {
  const results = new Map();
  
  await Promise.all(
    threadIds.map(async (threadId) => {
      const checkpoints = [];
      for await (const cp of checkpointer.list(
        { configurable: { thread_id: threadId } },
        { limit: 10 }
      )) {
        checkpoints.push(cp);
      }
      results.set(threadId, checkpoints);
    })
  );
  
  return results;
}
```

### 缓存层

```typescript
import { LRUCache } from "lru-cache";

class CachedPostgresSaver extends PostgresSaver {
  private cache: LRUCache<string, CheckpointTuple>;
  
  constructor(pool: Pool, cacheSize: number = 1000) {
    super(pool);
    this.cache = new LRUCache({ max: cacheSize });
  }
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const key = this.getCacheKey(config);
    
    // 检查缓存
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    
    // 从数据库获取
    const result = await super.getTuple(config);
    
    // 写入缓存
    if (result) {
      this.cache.set(key, result);
    }
    
    return result;
  }
  
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const result = await super.put(config, checkpoint, metadata);
    
    // 使缓存失效
    this.cache.delete(this.getCacheKey(config));
    
    return result;
  }
  
  private getCacheKey(config: RunnableConfig): string {
    const { thread_id, checkpoint_id } = config.configurable;
    return `${thread_id}:${checkpoint_id}`;
  }
}
```

### 连接池调优

```typescript
const pool = new Pool({
  // 根据负载调整
  max: 50,           // 高并发可以增加
  min: 10,           // 保持最小连接
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  
  // 生产环境推荐配置
  allowExitOnIdle: false,  // 防止连接池退出
  maxUses: 7500,         // 连接回收
});
```

## 生产部署最佳实践

### 1. 高可用配置

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  postgres-primary:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${PGUSER}
      POSTGRES_PASSWORD: ${PGPASSWORD}
      POSTGRES_DB: langgraph
      REPLICATION_MODE: master
    volumes:
      - primary_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  postgres-replica:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${PGUSER}
      POSTGRES_PASSWORD: ${PGPASSWORD}
      REPLICATION_MODE: slave
      REPLICATION_HOST: postgres-primary
    depends_on:
      - postgres-primary
    ports:
      - "5433:5432"

volumes:
  primary_data:
```

### 2. 监控告警

```typescript
// 使用 Prometheus 监控
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

class MonitoredPostgresSaver extends PostgresSaver {
  private static registry = new Registry();
  
  private static checkpointGets = new Counter({
    name: 'langgraph_checkpoint_gets_total',
    help: 'Total number of checkpoint get operations',
    registers: [this.registry],
  });
  
  private static checkpointPuts = new Counter({
    name: 'langgraph_checkpoint_puts_total',
    help: 'Total number of checkpoint put operations',
    registers: [this.registry],
  });
  
  private static getLatency = new Histogram({
    name: 'langgraph_checkpoint_get_latency_seconds',
    help: 'Latency of checkpoint get operations',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [this.registry],
  });
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const end = MonitoredPostgresSaver.getLatency.startTimer();
    MonitoredPostgresSaver.checkpointGets.inc();
    
    const result = await super.getTuple(config);
    
    end();
    return result;
  }
}
```

### 3. 安全配置

```typescript
const pool = new Pool({
  // 使用环境变量
  host: process.env.PGHOST,
  password: process.env.PGPASSWORD,
  
  // SSL 配置
  ssl: {
    rejectUnauthorized: true,
    ca: process.env.PG_SSL_CA,
    cert: process.env.PG_SSL_CERT,
    key: process.env.PG_SSL_KEY,
  },
  
  // 限制连接
  max: 20,
  statement_timeout: 30000,  // 30 秒超时
});
```

## 常见问题 FAQ

### Q1: PostgresSaver 和 MemorySaver 性能差异？

**A**: 
- **MemorySaver**: 纳秒级访问，但不持久化
- **PostgresSaver**: 毫秒级访问，有网络开销，但持久化

对于生产环境，性能的微小差异是值得的，因为：
- 数据不会丢失
- 支持多实例部署
- 可以扩展

### Q2: 如何处理大量历史 Checkpoints？

**A**: 定期清理旧数据：

```typescript
async function cleanupOldCheckpoints(
  checkpointer: PostgresSaver,
  threadId: string,
  keepLast: number = 100
): Promise<void> {
  const client = await checkpointer.pool.connect();
  try {
    await client.query(`
      DELETE FROM checkpoints
      WHERE thread_id = $1
      AND checkpoint_id NOT IN (
        SELECT checkpoint_id 
        FROM checkpoints 
        WHERE thread_id = $1 
        ORDER BY created_at DESC 
        LIMIT $2
      )
    `, [threadId, keepLast]);
  } finally {
    client.release();
  }
}
```

### Q3: 能否使用 MongoDB 替代？

**A**: 是的，LangGraph 也提供 MongoDB 检查点实现：
`@langchain/langgraph-checkpoint-mongodb`

### Q4: Checkpoint 数据格式会变化吗？

**A**: Checkpoint 格式有版本号（当前 v4）。版本变化时会提供迁移工具。不要直接修改数据库中的 checkpoint 数据。

### Q5: 如何备份 Postgres 数据？

**A**: 
```bash
# 使用 pg_dump
pg_dump -h localhost -U langgraph langgraph > backup.sql

# 恢复
psql -h localhost -U langgraph langgraph < backup.sql
```

## 总结

Postgres Checkpoint 是 LangGraphJS 生产部署的首选存储方案：

- ✅ **持久化**：数据不会因重启丢失
- ✅ **高可用**：支持集群和复制
- ✅ **高性能**：优化的查询和索引
- ✅ **可扩展**：支持读写分离和分片
- ✅ **生态成熟**：PostgreSQL 有完善的工具和生态

对于任何严肃的应用，都应该使用 Postgres 或其他生产级存储后端。

## 参考资料

- [PostgresSaver 源码](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-postgres/src/index.ts)
- [LangGraph Persistence 文档](https://langchain-ai.github.io/langgraphjs/how-tos/persistence/)
- [PostgreSQL 官方文档](https://www.postgresql.org/docs/)