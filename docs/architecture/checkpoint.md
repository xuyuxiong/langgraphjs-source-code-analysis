# Checkpoint 机制

Checkpoint（检查点）机制是 LangGraphJS 实现状态持久化、时间旅行和中断恢复的核心。本章将深入解析 Checkpoint 系统的完整实现。

## Checkpoint 基础

### Checkpoint 结构

```typescript
// libs/langgraph-checkpoint/src/types.ts
export interface Checkpoint {
  v: number;              // 版本号（当前为 4）
  id: string;             // 检查点 ID（UUID）
  ts: string;             // 时间戳（ISO 8601）
  
  channel_values: Record<string, unknown>;        // 通道值
  channel_versions: Record<string, number>;       // 通道版本
  versions_seen: Record<string, Record<string, number>>; // 节点已见版本
  
  metadata?: Record<string, unknown>;             // 元数据
  parent_config?: RunnableConfig;                 // 父配置（时间旅行）
}
```

### CheckpointTuple

```typescript
export interface CheckpointTuple {
  config: RunnableConfig;          // 当前配置
  checkpoint: Checkpoint;          // 检查点
  metadata?: CheckpointMetadata;   // 元数据
  parent_config?: RunnableConfig;  // 父配置
  pending_writes?: PendingWrite[]; // 待写入
}

export interface CheckpointMetadata {
  source?: string;         // 来源（input/update/loop/...)
  step?: number;           // 步骤数
  writes?: Record<string, unknown>; // 写入内容
  parents?: Record<string, string>; // 父节点 ID
}
```

## BaseCheckpointSaver 接口

### 核心方法

```typescript
// libs/langgraph-checkpoint/src/base.ts
export abstract class BaseCheckpointSaver {
  /**
   * 保存检查点
   */
  abstract save(
    checkpoint: Checkpoint,
    config: RunnableConfig
  ): Promise<void>;
  
  /**
   * 获取检查点
   */
  abstract get(
    config: RunnableConfig
  ): Promise<Checkpoint | undefined>;
  
  /**
   * 列出检查点（支持分页）
   */
  abstract list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncIterable<CheckpointTuple>;
  
  /**
   * 删除检查点
   */
  abstract delete(
    config: RunnableConfig
  ): Promise<void>;
  
  /**
   * 获取元数据
   */
  abstract getTuple(
    config: RunnableConfig
  ): Promise<CheckpointTuple | undefined>;
}
```

### 配置接口

```typescript
interface CheckpointListOptions {
  limit?: number;              // 每次返回数量
  before?: RunnableConfig;     // 在此之前的检查点
  after?: RunnableConfig;      // 在此之后的检查点
  reverse?: boolean;           // 是否倒序
  filter?: CheckpointFilter;   // 过滤条件
}
```

## MemorySaver 实现

### 内存存储

```typescript
// libs/langgraph-checkpoint/src/memory.ts
export class MemorySaver extends BaseCheckpointSaver {
  // 存储结构
  storage: Map<string, StoredCheckpoint> = new Map();
  writes: Map<string, Record<string, unknown>[]> = new Map();
  
  async save(
    checkpoint: Checkpoint,
    config: RunnableConfig
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error("thread_id is required");
    }
    
    const key = `${threadId}:${checkpoint.id}`;
    
    this.storage.set(key, {
      checkpoint,
      metadata: {
        source: config.configurable?.checkpoint_ns ?? "update",
        step: checkpoint.channel_versions?.__root__ ?? 0
      }
    });
  }
  
  async get(
    config: RunnableConfig
  ): Promise<Checkpoint | undefined> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;
    
    if (!threadId) {
      throw new Error("thread_id is required");
    }
    
    // 组合 key
    const key = checkpointId 
      ? `${threadId}:${checkpointId}`
      : threadId;
    
    // 查找最新检查点
    if (!checkpointId) {
      // 返回最新的检查点
      const checkpoints = Array.from(this.storage.entries())
        .filter(([k]) => k.startsWith(threadId))
        .sort((a, b) => b[1].checkpoint.ts.localeCompare(a[1].checkpoint.ts));
      
      return checkpoints[0]?.[1].checkpoint;
    }
    
    // 返回指定检查点
    return this.storage.get(key)?.checkpoint;
  }
  
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncIterable<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    
    // 获取所有检查点
    const checkpoints = Array.from(this.storage.entries())
      .filter(([k]) => k.startsWith(`${threadId}:`))
      .map(([_, v]) => v)
      .sort((a, b) => b.checkpoint.ts.localeCompare(a.checkpoint.ts));
    
    // 应用过滤
    let filtered = checkpoints;
    if (options?.before) {
      const beforeId = options.before.configurable?.checkpoint_id;
      filtered = filtered.filter(c => c.checkpoint.id < beforeId!);
    }
    
    // 应用限制
    const limit = options?.limit ?? 10;
    for (const checkpoint of filtered.slice(0, limit)) {
      yield {
        config: { configurable: { thread_id, checkpoint_id: checkpoint.checkpoint.id } },
        checkpoint: checkpoint.checkpoint,
        metadata: checkpoint.metadata
      };
    }
  }
}
```

## PostgresSaver 实现

### 数据库结构

```typescript
// libs/langgraph-checkpoint-postgres/src/index.ts
class PostgresSaver extends BaseCheckpointSaver {
  private client: Pool;
  
  constructor(connString: string) {
    super();
    this.client = new Pool({ connectionString: connString });
  }
  
  async setup(): Promise<void> {
    // 创建表结构
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        parent_id TEXT,
        checkpoint BYTEA,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (thread_id, checkpoint_id)
      );
      
      CREATE TABLE IF NOT EXISTS checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        value BYTEA,
        PRIMARY KEY (thread_id, checkpoint_id, channel)
      );
      
      CREATE INDEX IF NOT EXISTS idx_checkpoints_thread 
        ON checkpoints (thread_id, created_at DESC);
    `);
  }
  
  async save(
    checkpoint: Checkpoint,
    config: RunnableConfig
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = checkpoint.id;
    const parentId = config.configurable?.checkpoint_id;
    
    await this.client.query(
      `INSERT INTO checkpoints (thread_id, checkpoint_id, parent_id, checkpoint, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (thread_id, checkpoint_id) 
       DO UPDATE SET checkpoint = $4, metadata = $5`,
      [
        threadId,
        checkpointId,
        parentId ?? null,
        serializeCheckpoint(checkpoint),
        JSON.stringify({
          source: config.configurable?.checkpoint_ns,
          step: checkpoint.channel_versions?.__root__ ?? 0
        })
      ]
    );
  }
  
  async get(
    config: RunnableConfig
  ): Promise<Checkpoint | undefined> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;
    
    let query = `SELECT checkpoint FROM checkpoints WHERE thread_id = $1`;
    const params: any[] = [threadId];
    
    if (checkpointId) {
      query += ` AND checkpoint_id = $2`;
      params.push(checkpointId);
    } else {
      query += ` ORDER BY created_at DESC LIMIT 1`;
    }
    
    const result = await this.client.query(query, params);
    
    if (result.rows.length === 0) {
      return undefined;
    }
    
    return deserializeCheckpoint(result.rows[0].checkpoint);
  }
}
```

## RedisSaver 实现

### Redis 存储结构

```typescript
// libs/langgraph-checkpoint-redis/src/index.ts
class RedisSaver extends BaseCheckpointSaver {
  private client: Redis;
  private keyPrefix: string = "langgraph:checkpoint";
  
  async save(
    checkpoint: Checkpoint,
    config: RunnableConfig
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    
    // Key 格式：langgraph:checkpoint:{thread_id}:{checkpoint_id}
    const key = `${this.keyPrefix}:${threadId}:${checkpoint.id}`;
    
    // 保存检查点
    await this.client.set(
      key,
      JSON.stringify(checkpoint),
      'EX',  // 过期时间（秒）
      this.ttl
    );
    
    // 维护检查点列表
    const listKey = `${this.keyPrefix}:list:${threadId}`;
    await this.client.zAdd(listKey, {
      score: Date.now(),
      value: checkpoint.id
    });
  }
  
  async get(
    config: RunnableConfig
  ): Promise<Checkpoint | undefined> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;
    
    let key: string;
    if (checkpointId) {
      key = `${this.keyPrefix}:${threadId}:${checkpointId}`;
    } else {
      // 获取最新检查点
      const listKey = `${this.keyPrefix}:list:${threadId}`;
      const latest = await this.client.zRevRange(listKey, 0, 0);
      if (latest.length === 0) return undefined;
      key = `${this.keyPrefix}:${threadId}:${latest[0]}`;
    }
    
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : undefined;
  }
}
```

## SqliteSaver 实现

### SQLite 存储

```typescript
// libs/langgraph-checkpoint-sqlite/src/index.ts
class SqliteSaver extends BaseCheckpointSaver {
  private db: Database;
  
  constructor(dbPath: string) {
    super();
    this.db = new Database(dbPath);
    this.setup();
  }
  
  private setup(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        parent_id TEXT,
        checkpoint BLOB,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, checkpoint_id)
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_thread 
        ON checkpoints (thread_id, created_at DESC);
    `);
  }
  
  async save(
    checkpoint: Checkpoint,
    config: RunnableConfig
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints 
        (thread_id, checkpoint_id, parent_id, checkpoint, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      threadId,
      checkpoint.id,
      config.configurable?.checkpoint_id ?? null,
      serializeCheckpoint(checkpoint),
      JSON.stringify({ source: "update" })
    );
  }
}
```

## 时间旅行

### 获取历史状态

```typescript
async *getHistory(
  config: RunnableConfig,
  options?: { limit?: number }
): AsyncGenerator<StateSnapshot> {
  // 获取所有检查点
  const checkpoints = this.checkpointer.list(config, {
    limit: options?.limit ?? 100,
    reverse: true
  });
  
  for await (const tuple of checkpoints) {
    // 从检查点恢复状态
    const channels = createChannels(
      this.channels,
      tuple.checkpoint
    );
    
    const values = readChannels(channels, this.outputChannels);
    
    yield {
      values,
      next: [],
      tasks: [],
      metadata: tuple.metadata,
      config: tuple.config,
      createdAt: tuple.checkpoint.ts,
      parentConfig: tuple.parent_config
    };
  }
}
```

### 回滚到历史状态

```typescript
async function restoreFromCheckpoint(
  threadId: string,
  checkpointId: string
): Promise<StateSnapshot> {
  const config = { configurable: { thread_id: threadId } };
  
  // 1. 获取目标检查点
  const targetConfig = {
    configurable: { ...config.configurable, checkpoint_id: checkpointId }
  };
  
  const checkpoint = await checkpointer.get(targetConfig);
  if (!checkpoint) {
    throw new Error("Checkpoint not found");
  }
  
  // 2. 创建新分支（不覆盖历史）
  const newConfig = {
    configurable: {
      ...config.configurable,
      checkpoint_ns: `fork:${checkpointId}`
    }
  };
  
  // 3. 应用检查点
  await updateState(newConfig, checkpoint.channel_values);
  
  // 4. 返回新状态
  return getState(newConfig);
}
```

## 状态更新

### updateState 实现

```typescript
async updateState(
  config: RunnableConfig,
  values: Record<string, unknown>,
  asNode?: string
): Promise<void> {
  // 1. 获取当前检查点
  const checkpoint = await this.checkpointer.get(config);
  
  if (!checkpoint) {
    throw new Error("No checkpoint found");
  }
  
  // 2. 应用更新到通道
  const channels = createChannels(this.channels, checkpoint);
  
  for (const [key, value] of Object.entries(values)) {
    const channel = channels[key];
    if (channel) {
      channel.update([value]);
    }
  }
  
  // 3. 创建新检查点
  const newCheckpoint = createCheckpoint(
    checkpoint,
    channels,
    checkpoint.channel_versions?.__root__ ?? 0 + 1
  );
  
  // 4. 添加元数据
  newCheckpoint.metadata = {
    ...checkpoint.metadata,
    source: "update",
    updatedBy: asNode ?? "user",
    updatedAt: new Date().toISOString()
  };
  
  // 5. 保存
  await this.checkpointer.save(newCheckpoint, config);
}
```

## 性能优化

### 1. 增量保存

```typescript
async save(
  checkpoint: Checkpoint,
  config: RunnableConfig
): Promise<void> {
  // 检查是否有变化
  const previous = await this.get(config);
  
  if (previous) {
    // 对比版本号
    const hasChanged = Object.entries(checkpoint.channel_versions)
      .some(([key, version]) => 
        version !== previous.channel_versions[key]
      );
    
    if (!hasChanged) {
      // 无变化，跳过保存
      return;
    }
  }
  
  // 保存到数据库
  await this._saveToDatabase(checkpoint, config);
}
```

### 2. 批量写入

```typescript
class BatchedCheckpointSaver {
  private queue: Array<{ checkpoint: Checkpoint; config: RunnableConfig }> = [];
  private timer: NodeJS.Timeout | null = null;
  
  async save(
    checkpoint: Checkpoint,
    config: RunnableConfig
  ): Promise<void> {
    this.queue.push({ checkpoint, config });
    
    // 批量保存（延迟 100ms）
    if (!this.timer) {
      this.timer = setTimeout(() => this._flush(), 100);
    }
  }
  
  async _flush(): Promise<void> {
    const batch = this.queue.splice(0);
    this.queue = [];
    this.timer = null;
    
    // 批量事务保存
    await this.db.transaction(async (tx) => {
      for (const { checkpoint, config } of batch) {
        await this._doSave(tx, checkpoint, config);
      }
    });
  }
}
```

### 3. 缓存优化

```typescript
class CachedCheckpointSaver extends BaseCheckpointSaver {
  private cache = new LRUCache<string, Checkpoint>({
    max: 1000,
    ttl: 60_000  // 1 分钟
  });
  
  async get(config: RunnableConfig): Promise<Checkpoint | undefined> {
    const key = this._getKey(config);
    
    // 检查缓存
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    
    // 从存储加载
    const checkpoint = await this._loadFromStorage(key);
    
    if (checkpoint) {
      this.cache.set(key, checkpoint);
    }
    
    return checkpoint;
  }
  
  async save(
    checkpoint: Checkpoint,
    config: RunnableConfig
  ): Promise<void> {
    // 保存到存储
    await this._saveToStorage(checkpoint, config);
    
    // 更新缓存
    const key = this._getKey(config);
    this.cache.set(key, checkpoint);
  }
}
```

## 元数据管理

### Checkpoint 元数据

```typescript
interface CheckpointMetadata {
  source?: "loop" | "input" | "update" | "fork";
  step?: number;
  writes?: Record<string, unknown>;
  parents?: Record<string, string>;
  checkpoint_ns?: string;  // 检查点命名空间
  run_id?: string;          // 运行 ID
  langgraph_step?: number;  // LangGraph 步骤数
}
```

### 元数据查询

```typescript
async findCheckpointsByMetadata(
  filter: CheckpointFilter
): Promise<CheckpointTuple[]> {
  const results: CheckpointTuple[] = [];
  
  for await (const tuple of this.list(filter.config, { limit: 1000 })) {
    // 应用过滤条件
    if (this._matchesFilter(tuple.metadata, filter)) {
      results.push(tuple);
    }
  }
  
  return results;
}

_matchesFilter(
  metadata: CheckpointMetadata,
  filter: CheckpointFilter
): boolean {
  // 按来源过滤
  if (filter.source && metadata.source !== filter.source) {
    return false;
  }
  
  // 按步骤范围过滤
  if (filter.minStep && (metadata.step ?? 0) < filter.minStep) {
    return false;
  }
  
  if (filter.maxStep && (metadata.step ?? 0) > filter.maxStep) {
    return false;
  }
  
  return true;
}
```

## 错误处理

### 保存失败处理

```typescript
async saveWithRetry(
  checkpoint: Checkpoint,
  config: RunnableConfig,
  maxRetries = 3
): Promise<void> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await this.checkpointer.save(checkpoint, config);
      return;
    } catch (error) {
      lastError = error;
      
      // 指数退避
      const delay = Math.pow(2, attempt) * 100;
      await sleep(delay);
    }
  }
  
  throw lastError;
}
```

### 数据一致性

```typescript
async save(
  checkpoint: Checkpoint,
  config: RunnableConfig
): Promise<void> {
  // 使用事务确保原子性
  await this.db.transaction(async (tx) => {
    // 1. 检查版本号（乐观锁）
    const existing = await tx.get(
      "SELECT * FROM checkpoints WHERE thread_id = ? AND checkpoint_id = ?",
      [config.thread_id, checkpoint.id]
    );
    
    // 2. 保存检查点
    await tx.run(
      "INSERT OR REPLACE INTO checkpoints ...",
      [/* params */]
    );
    
    // 3. 保存待写入
    if (checkpoint.pending_writes) {
      for (const write of checkpoint.pending_writes) {
        await tx.run(
          "INSERT INTO checkpoint_writes ...",
          [config.thread_id, checkpoint.id, write.channel, write.value]
        );
      }
    }
  });
}
```

## 小结

本节深入解析了 LangGraphJS 的 Checkpoint 机制：

- ✅ Checkpoint 基础结构
- ✅ BaseCheckpointSaver 接口
- ✅ MemorySaver 内存实现
- ✅ PostgresSaver 实现
- ✅ RedisSaver 实现
- ✅ SqliteSaver 实现
- ✅ 时间旅行机制
- ✅ 状态更新
- ✅ 性能优化技术
- ✅ 元数据管理
- ✅ 错误处理

完整的 Checkpoint 系统是 LangGraphJS 实现可靠状态管理的基石。

## 下一章

- [核心篇 - StateGraph](/core/state-graph) - 状态图构建器
- [核心篇 - Checkpoint 系统](/core/checkpoint-system)
- [核心篇 - Postgres 存储](/core/postgres-storage)