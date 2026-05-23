# Redis Checkpoint 存储

## 概述

Redis Checkpoint 是 LangGraphJS 提供的另一个高性能检查点存储实现，基于 Redis 数据库。它特别适合：

- **高性能场景**：微秒到毫秒级访问速度
- **缓存层**：作为快速状态缓存
- **会话管理**：天然的过期时间支持
- **分布式应用**：支持多实例共享状态

Redis 提供了比 Postgres 更快的读写性能，但通常不推荐单独作为长期存储。

## 架构设计

### Key 组织结构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Redis 数据结构                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  字符串键（存储 checkpoint 数据）                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ checkpoints:{thread_id}:{checkpoint_id}                  │   │
│  │   → JSON 序列化的 checkpoint                              │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ checkpoint_meta:{thread_id}:{checkpoint_id}              │   │
│  │   → JSON 序列化的 metadata                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  有序集合（存储历史排序）                                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ checkpoint_history:{thread_id}                            │   │
│  │   [{timestamp: 1, member: "checkpoint_id_1"},             │   │
│  │    {timestamp: 2, member: "checkpoint_id_2"}, ...]        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Hash（存储 pending writes）                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ checkpoint_writes:{thread_id}:{checkpoint_id}             │   │
│  │   { task_id:idx: { channel, value }, ... }                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  字符串键（存储 blobs）                                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ checkpoint_blob:{thread_id}:{channel}:{version}           │   │
│  │   → 序列化后的二进制 blob                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 数据类型选择

| 数据 | Redis 类型 | 说明 |
|------|-----------|------|
| Checkpoint | String | JSON 序列化存储 |
| Metadata | String | 关联元数据 |
| History | ZSet | 按时间排序 |
| Writes | Hash | 按 task_id 索引 |
| Blobs | String | 二进制数据 |

## 安装与配置

### 安装包

```bash
npm install @langchain/langgraph-checkpoint-redis
npm install redis
```

### 基础配置

```typescript
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";
import { createClient, type RedisClientType } from "redis";

// 创建 Redis 客户端
const client: RedisClientType = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

// 连接
await client.connect();

// 创建 RedisSaver
const checkpointer = new RedisSaver(client);

// 与图一起使用
const graph = workflow.compile({ checkpointer });

// 使用完毕后关闭
// await client.quit();
```

### 连接选项

```typescript
const client = createClient({
  // 基础连接
  url: "redis://localhost:6379",
  
  // 或者单独配置
  socket: {
    host: "localhost",
    port: 6379,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        return new Error("Redis connection failed");
      }
      return Math.min(retries * 50, 500);
    },
  },
  
  // 认证
  password: process.env.REDIS_PASSWORD,
  username: process.env.REDIS_USERNAME,
  
  // TLS（生产环境）
  socket: {
    tls: true,
    rejectUnauthorized: false,
  },
});
```

### Docker 部署 Redis

```yaml
# docker-compose.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

## 核心 API

### 创建实例

```typescript
// 方式 1: 使用现有客户端
const client = createClient({ url: "redis://localhost:6379" });
await client.connect();
const checkpointer = new RedisSaver(client);

// 方式 2: 从 URL 创建
const checkpointer = await RedisSaver.fromConnString(
  "redis://localhost:6379"
);

// 方式 3: 使用选项
const checkpointer = await RedisSaver.fromConnString(
  "redis://localhost:6379",
  {
    keyPrefix: "langgraph:",  // 键前缀，默认 "checkpoints:"
    scanCount: 100,           // SCAN 操作每次返回数量
  }
);
```

### 配置过期时间

```typescript
const checkpointer = new RedisSaver(client, {
  // 设置 checkpoint 过期时间（秒）
  checkpointTTL: 3600,  // 1 小时后过期
  
  // 设置 writes 过期时间
  writesTTL: 600,  // 10 分钟后过期
});
```

## 使用示例

### 基础用法

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";

const StateAnnotation = Annotation.Root({
  counter: Annotation<number>({ default: () => 0 }),
});

const workflow = new StateGraph(StateAnnotation)
  .addNode("increment", (state) => ({ counter: state.counter + 1 }))
  .addEdge(START, "increment")
  .compile();

// 创建 Redis 检查点
const client = createClient({ url: "redis://localhost:6379" });
await client.connect();
const checkpointer = new RedisSaver(client);

const graph = workflow.compile({ checkpointer });

// 使用
const config = { configurable: { thread_id: "thread-1" } };

await graph.invoke({}, config);  // counter = 1
await graph.invoke({}, config);  // counter = 2
await graph.invoke({}, config);  // counter = 3

// 查询历史
const history = [];
for await (const cp of checkpointer.list(config)) {
  history.push(cp);
  console.log(`Step ${cp.metadata?.step}: counter=${cp.checkpoint.channel_values.counter}`);
}

// 清理
await client.quit();
```

### 使用过期时间管理会话

```typescript
// 带 TTL 的检查点 - 适用于临时会话
const checkpointer = new RedisSaver(client, {
  checkpointTTL: 86400,  // 24 小时过期
});

const graph = workflow.compile({ checkpointer });

// 会话会在 24 小时后自动过期
const config = { configurable: { thread_id: `session-${Date.now()}` } };

// 不需要手动清理，Redis 会自动删除过期数据
await graph.invoke(input, config);
```

### 中断与恢复

```typescript
import { interrupt, Command } from "@langchain/langgraph";

async function reviewNode(state) {
  const approval = interrupt({
    type: "review",
    content: state.content,
  });
  return { approved: approval };
}

const graph = new StateGraph(StateAnnotation)
  .addNode("review", reviewNode)
  .addEdge(START, "review")
  .compile({ checkpointer });

const config = { configurable: { thread_id: "review-session" } };

// 触发中断
await graph.invoke({ content: "Please review" }, config);

// 恢复
await graph.invoke(
  new Command({ resume: true }),
  config
);
```

### 发布订阅模式

```typescript
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";

// 扩展 RedisSaver 支持发布订阅
class PubSubRedisSaver extends RedisSaver {
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const result = await super.put(config, checkpoint, metadata);
    
    // 发布 checkpoint 更新事件
    await this.client.publish(
      `checkpoint:updated:${config.configurable.thread_id}`,
      JSON.stringify({ checkpointId: checkpoint.id, metadata })
    );
    
    return result;
  }
}

// 监听更新
const subscriber = client.duplicate();
await subscriber.connect();

await subscriber.subscribe(
  "checkpoint:updated:thread-1",
  (message) => {
    console.log("Checkpoint updated:", JSON.parse(message));
  }
);
```

## 高级功能

### 集群模式

```typescript
import { createCluster } from "redis";

const cluster = createCluster({
  rootNodes: [
    { url: "redis://node1:6379" },
    { url: "redis://node2:6379" },
    { url: "redis://node3:6379" },
  ],
});

await cluster.connect();

const checkpointer = new RedisSaver(cluster);
```

### 哨兵模式

```typescript
const client = createClient({
  sentinels: [
    { host: "sentinel1", port: 26379 },
    { host: "sentinel2", port: 26379 },
  ],
  name: "mymaster",
});

await client.connect();
const checkpointer = new RedisSaver(client);
```

### 性能监控

```typescript
class MonitoredRedisSaver extends RedisSaver {
  private metrics = {
    ops: 0,
    totalLatency: 0,
    errors: 0,
  };
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const start = Date.now();
    try {
      this.metrics.ops++;
      return await super.getTuple(config);
    } catch (error) {
      this.metrics.errors++;
      throw error;
    } finally {
      this.metrics.totalLatency += Date.now() - start;
    }
  }
  
  getAverageLatency(): number {
    if (this.metrics.ops === 0) return 0;
    return this.metrics.totalLatency / this.metrics.ops;
  }
}

// 使用
const checkpointer = new MonitoredRedisSaver(client);

// 定期检查
setInterval(() => {
  console.log("Redis Checkpointer:", {
    ops: checkpointer["metrics"].ops,
    avgLatency: checkpointer.getAverageLatency(),
    errors: checkpointer["metrics"].errors,
  });
}, 60000);
```

### 数据压缩

```typescript
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const compress = promisify(gzip);
const decompress = promisify(gunzip);

class CompressedRedisSaver extends RedisSaver {
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    // 压缩 checkpoint 数据
    const json = JSON.stringify(checkpoint);
    const compressed = await compress(json);
    
    const key = this.getCheckpointKey(config);
    await this.client.set(key, compressed.toString("base64"));
    
    // ... 其他逻辑
    return result;
  }
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const key = this.getCheckpointKey(config);
    const data = await this.client.get(key);
    
    if (!data) return undefined;
    
    // 解压数据
    const buffer = Buffer.from(data, "base64");
    const decompressed = await decompress(buffer);
    const checkpoint = JSON.parse(decompressed.toString());
    
    return { config, checkpoint };
  }
}
```

### 批量操作

```typescript
class BatchRedisSaver extends RedisSaver {
  async batchGet(
    threadIds: string[]
  ): Promise<Map<string, Checkpoint[]>> {
    const pipeline = this.client.multi();
    
    // 批量获取最新 checkpoint
    threadIds.forEach(threadId => {
      pipeline.zrange(
        `checkpoint_history:${threadId}`,
        -1,
        -1
      );
    });
    
    const results = await pipeline.exec();
    
    const resultMap = new Map();
    threadIds.forEach((threadId, index) => {
      resultMap.set(threadId, results[index]);
    });
    
    return resultMap;
  }
}
```

## 性能优化

### 连接池

```typescript
import { createClient } from "redis";

const client = createClient({
  url: "redis://localhost:6379",
  // 连接池配置（ioredis 客户端）
  socket: {
    connectTimeout: 5000,
    keepAlive: 5000,
  },
});

// 对于高并发，使用多个连接
const pool = Array.from({ length: 10 }, () => 
  createClient({ url: "redis://localhost:6379" })
);

let currentPoolIndex = 0;

function getClient() {
  return pool[currentPoolIndex++ % pool.length];
}
```

### 管道批量写入

```typescript
async function batchSaveCheckpoints(
  checkpointer: RedisSaver,
  updates: Array<{ config: RunnableConfig; checkpoint: Checkpoint }>
) {
  const pipeline = checkpointer.client.multi();
  
  for (const { config, checkpoint } of updates) {
    const key = `checkpoints:${config.configurable.thread_id}:${checkpoint.id}`;
    pipeline.set(key, JSON.stringify(checkpoint));
  }
  
  await pipeline.exec();
}
```

### 缓存层

```typescript
import { LRUCache } from "lru-cache";

class CachedRedisSaver extends RedisSaver {
  private cache: LRUCache<string, CheckpointTuple>;
  
  constructor(client: RedisClientType, cacheSize: number = 10000) {
    super(client);
    this.cache = new LRUCache({ max: cacheSize });
  }
  
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const key = `${config.configurable.thread_id}:${config.configurable.checkpoint_id}`;
    
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    
    const result = await super.getTuple(config);
    
    if (result) {
      this.cache.set(key, result);
    }
    
    return result;
  }
  
  async put(...args): Promise<RunnableConfig> {
    const result = await super.put(...args);
    
    // 使缓存失效
    const key = `${args[0].configurable.thread_id}:${args[1].id}`;
    this.cache.delete(key);
    
    return result;
  }
}
```

## 生产部署最佳实践

### 1. 持久化配置

```conf
# redis.conf 配置

# RDB 快照
save 900 1
save 300 10
save 60 10000

# AOF 持久化
appendonly yes
appendfsync everysec

# 内存策略
maxmemory 4gb
maxmemory-policy allkeys-lru
```

### 2. 监控指标

```typescript
// 使用 Redis INFO 命令
async function getRedisMetrics(client: RedisClientType) {
  const info = await client.info();
  const metrics: Record<string, string> = {};
  
  info.split('\n').forEach(line => {
    const [key, value] = line.split(':');
    if (key && value) {
      metrics[key.trim()] = value.trim();
    }
  });
  
  return {
    usedMemory: metrics.used_memory,
    connectedClients: metrics.connected_clients,
    opsPerSecond: metrics.instantaneous_ops_per_sec,
    hitRate: metrics.keyspace_hits,
    missRate: metrics.keyspace_misses,
  };
}
```

### 3. 高可用架构

```yaml
# docker-compose.ha.yml
version: '3.8'

services:
  redis-master:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_master:/data

  redis-slave-1:
    image: redis:7-alpine
    command: redis-server --replicaof redis-master 6379 --appendonly yes
    depends_on:
      - redis-master

  redis-slave-2:
    image: redis:7-alpine
    command: redis-server --replicaof redis-master 6379 --appendonly yes
    depends_on:
      - redis-master

  sentinel-1:
    image: redis:7-alpine
    command: redis-sentinel /etc/sentinel.conf
    volumes:
      - ./sentinel.conf:/etc/sentinel.conf

  sentinel-2:
    image: redis:7-alpine
    command: redis-sentinel /etc/sentinel.conf
    volumes:
      - ./sentinel.conf:/etc/sentinel.conf

  sentinel-3:
    image: redis:7-alpine
    command: redis-sentinel /etc/sentinel.conf
    volumes:
      - ./sentinel.conf:/etc/sentinel.conf

volumes:
  redis_master:
```

## 与 Postgres 对比

| 特性 | Redis | Postgres |
|------|-------|----------|
| 访问速度 | 微秒 - 毫秒级 | 毫秒级 |
| 持久化 | 可选 | 强持久化 |
| 查询能力 | 简单 | 复杂 SQL |
| 过期时间 | ✅ 原生支持 | ❌ 需要额外逻辑 |
| 事务 | 有限 | 完整 ACID |
| 适用场景 | 缓存、会话 | 长期存储 |
| 内存占用 | 高 | 低 |

## 常见问题 FAQ

### Q1: Redis 比 Postgres 快多少？

**A**: 通常快 10-100 倍，但取决于：
- 网络延迟
- 数据大小
- 并发情况

### Q2: 如何防止 Redis 内存溢出？

**A**: 
```typescript
// 配置 maxmemory
const client = createClient({
  maxmemory: "4gb",
  maxmemoryPolicy: "allkeys-lru",
});

// 或使用过期时间
new RedisSaver(client, {
  checkpointTTL: 86400,  // 24 小时
});
```

### Q3: Redis 数据会丢失吗？

**A**: 可能会。配置持久化：
```conf
appendonly yes
appendfsync everysec
save 900 1
```

### Q4: 可以同时使用 Redis 和 Postgres 吗？

**A**: 可以。Redis 作为缓存层，Postgres 作为持久化层：

```typescript
class HybridSaver extends RedisSaver {
  private postgres: PostgresSaver;
  
  async put(...args) {
    // 同时写入 Redis 和 Postgres
    await Promise.all([
      super.put(...args),
      this.postgres.put(...args),
    ]);
  }
}
```

## 总结

Redis Checkpoint 提供：

- ✅ **超高速度**：微秒级访问
- ✅ **过期支持**：自动清理过期数据
- ✅ **发布订阅**：实时事件通知
- ✅ **缓存友好**：LRU 淘汰策略
- ✅ **集群支持**：水平扩展

适用于高性能、临时会话场景，但建议配合持久化存储使用。

## 参考资料

- [RedisSaver 源码](https://github.com/langchain-ai/langgraphjs/tree/main/libs/checkpoint-redis)
- [Redis 官方文档](https://redis.io/docs/)
- [LangGraph Persistence](https://langchain-ai.github.io/langgraphjs/how-tos/persistence/)