# SQLite Checkpoint 存储

## 概述

SQLite Checkpoint 是 LangGraphJS 的轻量级检查点存储实现，基于 SQLite 嵌入式数据库。它特别适合：

- **本地开发**：无需额外数据库服务
- **边缘计算**：资源受限的环境
- **桌面应用**：内置数据存储
- **小型项目**：快速原型验证
- **测试环境**：隔离的测试数据存储

SQLite 是零配置的数据库，数据存储在本地文件中，非常适合开发和测试场景。

## 架构设计

### 数据库 Schema

```sql
-- Checkpoints 表
CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    parent_id TEXT,
    checkpoint BLOB,
    metadata TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (thread_id, checkpoint_id)
);

-- Checkpoint Blobs 表
CREATE TABLE IF NOT EXISTS checkpoint_blobs (
    thread_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    blob BLOB,
    PRIMARY KEY (thread_id, channel, version)
);

-- Checkpoint Writes 表
CREATE TABLE IF NOT EXISTS checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    value BLOB,
    PRIMARY KEY (thread_id, checkpoint_id, task_id, idx)
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_checkpoints_thread ON checkpoints(thread_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_parent ON checkpoints(parent_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(created_at DESC);
```

### 文件存储

```
┌─────────────────────────────────────────────────────────┐
│                   本地文件系统                            │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  /path/to/database/                                      │
│  ├── langgraph.db          # SQLite 数据库文件            │
│  ├── langgraph.db-journal  # WAL 日志文件（可选）         │
│  └── langgraph.db-shm      # 共享内存文件（可选）         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## 安装与配置

### 安装包

```bash
npm install @langchain/langgraph-checkpoint-sqlite
npm install better-sqlite3  # 或 sqlite3
```

### 基础配置

```typescript
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import Database from "better-sqlite3";

// 创建数据库连接
const db = new Database("langgraph.db");

// 创建 SqliteSaver
const checkpointer = new SqliteSaver(db);

// 初始化表结构（首次使用需要）
checkpointer.setup();

// 与图一起使用
const graph = workflow.compile({ checkpointer });

// 关闭连接
// db.close();
```

### 内存数据库

```typescript
// 使用内存数据库（重启后数据丢失，适合测试）
const db = new Database(":memory:");
const checkpointer = new SqliteSaver(db);
```

## 核心 API

### 创建实例

```typescript
// 方式 1: 使用文件路径
const checkpointer = SqliteSaver.fromConnString("./data/langgraph.db");

// 方式 2: 使用现有数据库实例
const db = new Database("./data/langgraph.db");
const checkpointer = new SqliteSaver(db);

// 方式 3: 使用内存数据库
const checkpointer = SqliteSaver.fromConnString(":memory:");
```

### 初始化表

```typescript
// 自动创建表
checkpointer.setup();

// 或手动执行 SQL
const db = new Database("langgraph.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id TEXT,
    checkpoint_id TEXT,
    PRIMARY KEY (thread_id, checkpoint_id)
  );
`);
```

## 使用示例

### 基础用法

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import Database from "better-sqlite3";

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

// 创建图
const workflow = new StateGraph(StateAnnotation)
  .addNode("process", async (state) => {
    return { messages: [{ role: "assistant", content: "Processed" }] };
  })
  .addEdge(START, "process")
  .compile();

// 创建 SQLite 检查点
const db = new Database("./data/langgraph.db");
const checkpointer = new SqliteSaver(db);
checkpointer.setup();

const graph = workflow.compile({ checkpointer });

// 使用
const config = { configurable: { thread_id: "thread-1" } };

// 多次调用以创建历史
for (let i = 0; i < 5; i++) {
  await graph.invoke(
    { messages: [{ role: "user", content: `Message ${i}` }] },
    config
  );
}

// 查询历史
const history = [];
for await (const cp of checkpointer.list(config)) {
  history.push({
    step: cp.metadata?.step,
    id: cp.checkpoint.id,
  });
}
console.log("History:", history);

// 关闭数据库
db.close();
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
await graph.invoke(
  { messages: [{ role: "user", content: "Please review" }] },
  config
);

// 恢复
await graph.invoke(
  new Command({ resume: { approved: true } }),
  config
);
```

### 时间旅行

```typescript
const config = { configurable: { thread_id: "time-travel" } };

// 创建多个 checkpoints
await graph.invoke({ input: "step1" }, config);
await graph.invoke({ input: "step2" }, config);
await graph.invoke({ input: "step3" }, config);

// 获取所有 checkpoints
const checkpoints = [];
for await (const cp of checkpointer.list(config)) {
  checkpoints.push(cp);
}

// 恢复到第二步
const oldConfig = {
  configurable: {
    thread_id: "time-travel",
    checkpoint_id: checkpoints[1].checkpoint.id,
  },
};

// 从历史点继续执行
const result = await graph.invoke(
  { input: "modified_step3" },
  oldConfig
);
```

### 多线程并发

```typescript
// SQLite 支持并发读取，但写入是串行的
const threads = Array.from({ length: 10 }, (_, i) => `thread-${i}`);

// 顺序写入
for (const threadId of threads) {
  const config = { configurable: { thread_id: threadId } };
  await graph.invoke({ messages: [{ role: "user", content: "test" }] }, config);
}

// 并发读取
const results = await Promise.all(
  threads.map(async (threadId) => {
    const state = await graph.getState({ configurable: { thread_id: threadId } });
    return { threadId, messageCount: state?.values?.messages?.length || 0 };
  })
);

console.log(results);
```

### WAL 模式（推荐）

```typescript
const db = new Database("./data/langgraph.db");

// 启用 WAL 模式以支持并发
db.exec("PRAGMA journal_mode = WAL");

// 设置同步模式
db.exec("PRAGMA synchronous = NORMAL");

// 设置缓存大小
db.exec("PRAGMA cache_size = -64000");  // 64MB

const checkpointer = new SqliteSaver(db);
checkpointer.setup();
```

## 高级功能

### 数据库加密

```typescript
import Database from "better-sqlite3";
import sqlcipher from "better-sqlite3";

// 使用 SQLCipher 加密数据库
const db = sqlcipher("./data/encrypted.db");
db.pragma("key = 'your-secret-key'");

const checkpointer = new SqliteSaver(db);
checkpointer.setup();
```

### 数据备份

```typescript
import fs from "fs";
import path from "path";

class BackupSqliteSaver extends SqliteSaver {
  private dbPath: string;
  
  constructor(dbPath: string) {
    const db = new Database(dbPath);
    super(db);
    this.dbPath = dbPath;
  }
  
  async createBackup(backupPath: string): Promise<void> {
    // 使用 SQLite 的 backup API
    const backup = new Database(backupPath);
    this.db.backup(backup);
    backup.close();
  }
  
  async restoreFromBackup(backupPath: string): Promise<void> {
    this.db.close();
    
    // 复制备份文件
    fs.copyFileSync(backupPath, this.dbPath);
    
    // 重新打开数据库
    this.db = new Database(this.dbPath);
  }
}

// 使用
const dbPath = "./data/langgraph.db";
const checkpointer = new BackupSqliteSaver(dbPath);

// 创建备份
await checkpointer.createBackup("./backups/langgraph-backup.db");

// 恢复备份
await checkpointer.restoreFromBackup("./backups/langgraph-backup.db");
```

### 数据清理

```typescript
class CleanupSqliteSaver extends SqliteSaver {
  async cleanupOldCheckpoints(
    threadId: string,
    keepLast: number = 100
  ): Promise<number> {
    const result = this.db.exec(`
      DELETE FROM checkpoints
      WHERE thread_id = ?
      AND checkpoint_id NOT IN (
        SELECT checkpoint_id
        FROM checkpoints
        WHERE thread_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
    `, [threadId, threadId, keepLast]);
    
    return result.changes;
  }
  
  async deleteThread(threadId: string): Promise<void> {
    this.db.exec(`DELETE FROM checkpoints WHERE thread_id = ?`, [threadId]);
    this.db.exec(`DELETE FROM checkpoint_blobs WHERE thread_id = ?`, [threadId]);
    this.db.exec(`DELETE FROM checkpoint_writes WHERE thread_id = ?`, [threadId]);
  }
}

// 使用
const checkpointer = new CleanupSqliteSaver("./data/langgraph.db");

// 清理旧检查点
await checkpointer.cleanupOldCheckpoints("old-thread", 50);

// 删除线程
await checkpointer.deleteThread("thread-to-delete");
```

### 性能监控

```typescript
class MonitoredSqliteSaver extends SqliteSaver {
  private metrics = {
    reads: 0,
    writes: 0,
    avgReadLatency: 0,
    avgWriteLatency: 0,
  };
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const start = Date.now();
    this.metrics.reads++;
    
    const result = await super.getTuple(config);
    
    const latency = Date.now() - start;
    this.metrics.avgReadLatency = (
      this.metrics.avgReadLatency * (this.metrics.reads - 1) + latency
    ) / this.metrics.reads;
    
    return result;
  }
  
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const start = Date.now();
    this.metrics.writes++;
    
    const result = await super.put(config, checkpoint, metadata);
    
    const latency = Date.now() - start;
    this.metrics.avgWriteLatency = (
      this.metrics.avgWriteLatency * (this.metrics.writes - 1) + latency
    ) / this.metrics.writes;
    
    return result;
  }
  
  getMetrics() {
    return { ...this.metrics };
  }
}

// 使用
const checkpointer = new MonitoredSqliteSaver("./data/langgraph.db");

// 定期检查
setInterval(() => {
  console.log("SQLite Checkpointer:", checkpointer.getMetrics());
}, 60000);
```

## 性能优化

### 连接池（对于高并发场景）

```typescript
import GenericPool from "generic-pool";
import Database from "better-sqlite3";

// 创建连接池
const pool = GenericPool.createPool(
  {
    create: () => new Database("./data/langgraph.db"),
    destroy: (db) => db.close(),
  },
  {
    min: 1,
    max: 10,
    acquireTimeoutMillis: 5000,
  }
);

// 使用
async function withCheckpointer<T>(fn: (cp: SqliteSaver) => Promise<T>): Promise<T> {
  const db = await pool.acquire();
  try {
    const checkpointer = new SqliteSaver(db);
    return await fn(checkpointer);
  } finally {
    pool.release(db);
  }
}
```

### 批量操作

```typescript
class BatchSqliteSaver extends SqliteSaver {
  async batchSave(
    updates: Array<{
      config: RunnableConfig;
      checkpoint: Checkpoint;
      metadata: CheckpointMetadata;
    }>
  ): Promise<void> {
    const transaction = this.db.transaction(() => {
      for (const { config, checkpoint, metadata } of updates) {
        this.putSync(config, checkpoint, metadata, {});
      }
    });
    
    transaction();
  }
}
```

### 查询优化

```typescript
// 添加额外的索引
const db = new Database("./data/langgraph.db");
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_checkpoints_metadata 
  ON checkpoints((metadata->>'$.userId'));
`);

// 使用参数化查询防止 SQL 注入
const stmt = db.prepare(
  "SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?"
);
const results = stmt.all(threadId, 10);
```

## 与其他存储对比

| 特性 | SQLite | Postgres | Redis | Memory |
|------|--------|----------|-------|--------|
| 配置复杂度 | 极低 | 中 | 低 | 无 |
| 性能 | 中 | 中 - 高 | 高 | 极高 |
| 持久化 | ✅ | ✅ | 可选 | ❌ |
| 并发写入 | 有限 | ✅ | ✅ | ✅ |
| 适用场景 | 本地/测试 | 生产 | 缓存 | 开发 |
| 数据量 | <10GB | 无限制 | 内存限制 | 内存限制 |

## 最佳实践

### 1. 开发环境配置

```typescript
// 开发环境使用 SQLite
if (process.env.NODE_ENV === "development") {
  const db = new Database("./dev-data/langgraph.db");
  db.exec("PRAGMA journal_mode = WAL");
  const checkpointer = new SqliteSaver(db);
  checkpointer.setup();
  
  return workflow.compile({ checkpointer });
}
```

### 2. 测试环境配置

```typescript
// 测试使用内存数据库
const db = new Database(":memory:");
const checkpointer = new SqliteSaver(db);
checkpointer.setup();

// 每个测试用例后清理
afterEach(() => {
  db.exec("DELETE FROM checkpoints");
});
```

### 3. 生产环境配置

```typescript
// 生产环境使用 Postgres
if (process.env.NODE_ENV === "production") {
  const { PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres");
  const checkpointer = await PostgresSaver.fromConnString(process.env.DATABASE_URL);
  await checkpointer.setup();
  
  return workflow.compile({ checkpointer });
}
```

### 4. 定期维护

```typescript
// 定期执行维护任务
async function maintenance(db: Database) {
  // VACUUM 缩减数据库文件
  db.exec("VACUUM");
  
  // ANALYZE 更新统计信息
  db.exec("ANALYZE");
  
  // integrity_check 检查数据完整性
  const result = db.pragma("integrity_check");
  if (result[0].integrity_check !== "ok") {
    console.error("Database integrity check failed!");
  }
}

// 每周执行一次
cron.schedule("0 3 * * 0", () => {
  maintenance(db);
});
```

## 常见问题 FAQ

### Q1: SQLite 适合生产环境吗？

**A**: 对于小型应用或边缘场景可以，但推荐：
- 单实例部署
- 数据量 < 10GB
- 并发写入 < 1000 次/秒

否则使用 Postgres。

### Q2: 数据库文件会无限增长吗？

**A**: 是的，需要定期清理：

```typescript
// 定期删除旧数据
db.exec(`
  DELETE FROM checkpoints
  WHERE created_at < datetime('now', '-30 days')
`);
```

### Q3: 如何迁移 PostgreSQL 数据到 SQLite？

**A**: 
```typescript
async function migrateFromPostgres(
  postgres: PostgresSaver,
  sqlite: SqliteSaver,
  threadId: string
) {
  for await (const cp of postgres.list({ configurable: { thread_id: threadId } })) {
    await sqlite.put(cp.config, cp.checkpoint, cp.metadata, {});
  }
}
```

### Q4: SQLite 支持并发读取吗？

**A**: 是的，多个进程可以同时读取，但写入会排他锁定数据库。

### Q5: 数据库文件损坏怎么办？

**A**: 
1. 使用 VACUUM 和 integrity_check 检查
2. 从备份恢复
3. 尝试导出残留数据

## 总结

SQLite Checkpoint 提供：

- ✅ **零配置**：开箱即用
- ✅ **嵌入式**：无需额外服务
- ✅ **持久化**：数据保存在文件
- ✅ **轻量级**：资源占用少
- ✅ **标准 SQL**：易于理解和维护

非常适合开发、测试和本地应用，生产环境可考虑 Postgres。

## 参考资料

- [SqliteSaver 源码](https://github.com/langchain-ai/langgraphjs/tree/main/libs/checkpoint-sqlite)
- [SQLite 官方文档](https://www.sqlite.org/docs.html)
- [better-sqlite3 文档](https://github.com/JoshuaWise/better-sqlite3)