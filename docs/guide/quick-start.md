# 快速开始

## 源码克隆

首先，从 GitHub 克隆 LangGraphJS 源码 repository：

```bash
# 克隆仓库
git clone https://github.com/langchain-ai/langgraphjs.git
cd langgraphjs

# 查看当前分支和标签
git branch -a
git tag -l

# 可选：切换到特定版本
# git checkout v0.3.5
```

### 仓库结构概览

```
langgraphjs/
├── libs/                    # 核心包目录
│   ├── langgraph/          # 主库（re-export）
│   ├── langgraph-core/     # 核心实现
│   ├── langgraph-checkpoint/  # 持久化基础
│   ├── langgraph-checkpoint-postgres/
│   ├── langgraph-checkpoint-redis/
│   ├── langgraph-checkpoint-sqlite/
│   ├── langgraph-swarm/    # 多 Agent 协作
│   ├── sdk/                # SDK 客户端
│   ├── langgraph-ui/       # 界面组件
│   └── ...
├── docs/                    # 官方文档
├── examples/                # 示例代码
├── scripts/                 # 构建脚本
├── package.json            # 根配置
├── pnpm-workspace.yaml     # pnpm 工作区配置
├── turbo.json              # Turborepo 配置
└── tsconfig.json           # TypeScript 配置
```

## 安装依赖

### 环境要求

- **Node.js**: 18+ (推荐 20+)
- **pnpm**: 10.27.0+ (项目指定包管理器)
- **Git**: 用于版本管理

```bash
# 检查 Node.js 版本
node -v  # 应 >= v18

# 检查 pnpm 版本
pnpm -v  # 应 >= 10.27.0

# 如需要升级 pnpm
npm install -g pnpm
```

### 安装项目依赖

```bash
# 使用 pnpm 安装所有依赖
pnpm install

# 安装过程会：
# 1. 解析 pnpm-lock.yaml 锁定版本
# 2. 安装根目录依赖
# 3. 递归安装各 libs/* 包的依赖
```

### 依赖管理

LangGraphJS 使用 **pnpm workspace** 进行多包管理：

```yaml
# pnpm-workspace.yaml
packages:
  - "libs/*"
  - "examples/*"
```

```json
// package.json (根)
{
  "private": true,
  "packageManager": "pnpm@10.27.0",
  "pnpm": {
    "overrides": {
      "@langchain/core": "^1.1.44",
      "langchain": "1.4.0-dev-1777615538778",
      "@langchain/langgraph-sdk": "workspace:*"
    }
  }
}
```

**关键依赖解析：**

| 依赖 | 版本 | 用途 |
|------|------|------|
| @langchain/core | ^1.1.44 | LangChain 核心组件 |
| @langchain/langgraph-checkpoint | workspace:* | 内部包引用 |
| typescript | ^4.9.5 \|\| ^5.4.5 | TypeScript 编译器 |
| turbo | ^2.9.14 | 构建工具 |

## 构建项目

### 使用 Turborepo 构建

LangGraphJS 使用 **Turborepo** 进行多包构建编排：

```bash
# 构建所有包
pnpm build

# 等同于
turbo run build:internal
```

### Turborepo 配置

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build:internal": {
      "dependsOn": ["^build:internal"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build:internal"],
      "outputs": []
    },
    "clean": {
      "outputs": []
    }
  }
}
```

**配置解读：**
- `dependsOn: ["^build:internal"]`：先构建所有依赖包
- `outputs: ["dist/**"]`：构建产物目录
- `^` 符号表示依赖包也执行相同任务

### 构建流程

```
构建顺序:
1. @langchain/langgraph-checkpoint (无依赖)
2. @langchain/langgraph-checkpoint-postgres (依赖 checkpoint)
3. @langchain/langgraph-core (依赖 checkpoint)
4. @langchain/langgraph (依赖 core)
5. @langchain/sdk (依赖 langgraph)
...
```

### 构建单个包

```bash
# 构建特定包
cd libs/langgraph-core
pnpm build:internal

# 或通过 turbo filter
pnpm turbo run build:internal --filter=@langchain/langgraph-core
```

### 构建产物

```
libs/langgraph-core/
├── src/              # 源码
└── dist/             # 构建产物
    ├── index.js      # CommonJS
    ├── index.mjs     # ESM
    └── index.d.ts    # 类型声明
```

## 运行测试

### 单元测试

```bash
# 运行所有测试
pnpm test

# 运行特定包的测试
cd libs/langgraph-core
pnpm test

# 运行特定测试文件
pnpm test -- src/graph/state.test.ts
```

### 集成测试

```bash
# 启动集成测试依赖（Docker 容器）
pnpm test:int:deps

# 运行集成测试
pnpm test:int

# 停止容器
pnpm test:int:deps:down
```

**集成测试依赖：**
- PostgreSQL 数据库
- Redis 缓存
- MongoDB 数据库

```yaml
# int-test-deps-docker-compose.yml
services:
  postgres:
    image: postgres:16
  redis:
    image: redis:alpine
  mongodb:
    image: mongo:7
```

### 测试覆盖

```bash
# 查看测试覆盖率
pnpm test -- --coverage

# 生成覆盖率报告
# 输出到 coverage/ 目录
```

## 调试方法

### VSCode 调试配置

在项目根目录创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "调试当前测试",
      "skipFiles": ["<node_internals>/**"],
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["exec", "tsx"],
      "args": ["${file}"],
      "console": "integratedTerminal",
      "env": {
        "NODE_OPTIONS": "--inspect-brk"
      }
    },
    {
      "type": "node",
      "request": "launch",
      "name": "调试 Pregel 引擎",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/debug-pregel.ts",
      "console": "integratedTerminal",
      "preLaunchTask": "build"
    },
    {
      "type": "node",
      "request": "attach",
      "name": "附加到运行进程",
      "port": 9229,
      "restart": true
    }
  ]
}
```

### 调试脚本示例

创建 `debug-pregel.ts`：

```typescript
import { StateGraph } from "@langchain/langgraph";

interface State {
  messages: string[];
}

// 定义节点
async function nodeA(state: State) {
  console.log("[Node A] 执行开始", state);
  return { messages: ["A executed"] };
}

async function nodeB(state: State) {
  console.log("[Node B] 执行开始", state);
  debugger; // 断点
  return { messages: ["B executed"] };
}

// 构建图
const workflow = new StateGraph<State>()
  .addNode("nodeA", nodeA)
  .addNode("nodeB", nodeB)
  .addEdge("__start__", "nodeA")
  .addEdge("nodeA", "nodeB");

const app = workflow.compile();

// 运行并调试
async function main() {
  const result = await app.invoke({ messages: [] });
  console.log("最终结果:", result);
}

main();
```

### 断点技巧

#### 1. 条件断点

在 VSCode 中右键点击断点，设置条件：

```typescript
// 仅当 step > 5 时触发
step > 5

// 仅当 channel 为 'messages' 时触发
channel === 'messages'
```

#### 2. 日志断点

```javascript
console.log("Pregel step:", step, "tasks:", tasks.length)
```

#### 3. Watch 表达式

在调试面板添加监控：

```
pregelLoop.step
pregelLoop.tasks
pregelLoop.checkpoint
```

### 源码阅读调试

```bash
# 使用 tsx 直接运行 TypeScript
pnpm exec tsx debug-script.ts

# 启用 Source Map
export NODE_OPTIONS="--enable-source-maps"

# 调试构建后的代码
pnpm exec tsx --inspect dist/index.js
```

## 代码导航

### IDE 配置

#### VSCode 插件推荐

- **ESLint**：代码检查
- **Prettier**：代码格式化
- **TypeScript Hero**：导入管理
- **GitLens**：Git 增强

#### 工作区设置

```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true
  }
}
```

### 关键入口文件

```typescript
// libs/langgraph-core/src/index.ts
// 主入口

// libs/langgraph-core/src/web.ts
// Web 环境导出

// libs/langgraph-core/src/graph/state.ts
// StateGraph 实现

// libs/langgraph-core/src/pregel/index.ts
// Pregel 引擎实现
```

## 文档生成

### 生成 API 文档

```bash
# 使用 TypeDoc 生成文档（如项目配置）
pnpm exec typedoc

# 或手动生成
pnpm add -D typedoc
pnpm exec typedoc libs/langgraph-core/src/index.ts
```

### 阅读官方文档

```bash
# 启动本地文档服务器
cd docs
pnpm install
pnpm dev

# 访问 http://localhost:3000
```

## 常见问题

### Q: pnpm 安装失败

```bash
# 清除缓存重试
pnpm store prune
pnpm install

# 或使用国内镜像
pnpm config set registry https://registry.npmmirror.com
pnpm install
```

### Q: 构建时 TypeScript 报错

```bash
# 清除构建缓存
rm -rf libs/*/dist
pnpm build

# 检查 TypeScript 版本
pnpm exec tsc --version
```

### Q: 测试超时

```bash
# 增加超时时间
pnpm test -- --testTimeout=60000

# 单线程运行便于调试
pnpm test -- --runInBand
```

### Q: Docker 容器启动失败

```bash
# 检查 Docker 状态
docker ps

# 重启 Docker
docker compose -f int-test-deps-docker-compose.yml down
docker compose -f int-test-deps-docker-compose.yml up -d
```

## 下一步

完成环境搭建后：

1. **阅读 [源码结构](/guide/structure)** - 了解 Monorepo 组织结构
2. **学习 [调试指南](/guide/debugging)** - 深入调试技巧
3. **开始 [架构篇](/architecture/overview)** - 理解整体架构设计

## 小结

本节介绍了 LangGraphJS 源码开发的完整环境搭建流程：

- ✅ 源码仓库克隆
- ✅ 依赖安装与配置
- ✅ 项目构建流程
- ✅ 测试运行方法
- ✅ VSCode 调试配置
- ✅ 代码导航技巧

接下来我们将深入源码结构，理解 LangGraphJS 的 Monorepo 组织方式。