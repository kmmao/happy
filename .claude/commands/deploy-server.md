重建并重启本地 Docker Server

## 前提检查

### 1. 确认 Docker 环境可用
```bash
docker compose version
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml ps
```

### 1.5 同步 server 的内部依赖版本号（关键前置）

Docker 构建过程中 `yarn install` 会按 `packages/happy-server/package.json` 的版本约束从 npm 拉取依赖。
如果 server 的 `@kmmao/*` 版本号落后于 npm 最新发布，新代码可能依赖尚未被 server 显式 pin 的 wire schema，
运行时会出现类型不匹配 / zod 校验失败。

**扫描 server 的所有内部包依赖**：
```bash
grep -E '"@kmmao/' packages/happy-server/package.json
```

**对每个 `@kmmao/*` 依赖，比较 server pin 版本 vs npm latest**：
```bash
for pkg in $(grep -oE '"@kmmao/[a-z-]+"' packages/happy-server/package.json | sort -u | tr -d '"'); do
  server_pin=$(grep "\"$pkg\"" packages/happy-server/package.json | head -1 | sed 's/.*: "//; s/",*//')
  npm_latest=$(npm view "$pkg" version 2>/dev/null || echo "未发布")
  echo "$pkg → server pins $server_pin | npm latest $npm_latest"
done
```

如果发现任何 `@kmmao/*` 落后（例如 `^0.13.0` vs npm `0.16.0`）：

1. 更新 `packages/happy-server/package.json` 的版本约束到最新（保留 `^` 前缀）
2. 运行 `yarn install` 刷新 `yarn.lock`
3. 运行 `yarn workspace happy-server typecheck` 验证 typecheck 通过
4. 提交：`chore(server): bump @kmmao/happy-wire to ^X.Y.Z`
5. 再进入步骤 2 重建镜像

> **历史教训**：server / app 的 wire 依赖曾长期 pin 在 `^0.13.0`，而 cli / agent 已到 `^0.16.0`。如果部署时不同步，新 schema 类型会在 server 启动时异常。

## 部署流程

### 2. 重建 Server 镜像

**始终使用 `--no-cache` 完全重建**：
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml build --no-cache server
```

> 为什么不用 `--no-cache-filter builder`？buildx 在多阶段构建中可能缓存 COPY 指令的源文件快照，导致源码变更不生效。`--no-cache` 虽然多花 30 秒但确保正确。

### 3. 重启 Server 容器
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml up -d server
```
- 只重启 server 容器，数据库/Redis/MinIO 保持不动

### 4. 确认迁移状态（关键步骤）
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml logs --tail 30 server
```

**正常情况**：日志中出现 `No pending migrations to apply.` 或 `All migrations have been successfully applied.`

**异常情况 1：出现 P2021 / P2022 错误**（`table does not exist` / `column does not exist`）

这意味着 `schema.prisma` 新增了模型或字段，但**没有生成对应的迁移文件**，数据库里缺表/缺列。

处理流程：

1. **确认数据库名**：
```bash
grep "DATABASE_URL" /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml
# 例如：postgresql://postgres:postgres@postgres:5432/handy → 数据库名 = handy
```

2. **对比 schema 与数据库**，找出缺失的表/列：
```bash
# 查看数据库现有表
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec -T postgres psql -U postgres -d handy -c "\dt"

# 查看某张表的列
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec -T postgres psql -U postgres -d handy -c "\d \"TableName\""

# 确认 schema.prisma 中的模型定义
grep -A 50 "^model TableName {" packages/happy-server/prisma/schema.prisma
```

3. **手动创建迁移 SQL 并应用**：
```bash
mkdir -p packages/happy-server/prisma/migrations/YYYYMMDD_description

cat > packages/happy-server/prisma/migrations/YYYYMMDD_description/migration.sql << 'EOF'
-- 根据 schema.prisma 手写 DDL
CREATE TABLE "TableName" ( ... );
ALTER TABLE "ExistingTable" ADD COLUMN "newCol" TEXT;
CREATE INDEX ...;
ALTER TABLE "TableName" ADD CONSTRAINT ... FOREIGN KEY ...;
EOF

# 应用到数据库
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec -T postgres psql -U postgres -d handy -f /dev/stdin < packages/happy-server/prisma/migrations/YYYYMMDD_description/migration.sql

# 注册到 _prisma_migrations（否则 Prisma 启动时会认为有未执行的迁移）
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec -T postgres psql -U postgres -d handy -c "
INSERT INTO _prisma_migrations (id, checksum, started_at, finished_at, migration_name, logs, rolled_back_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'manual', NOW(), NOW(), 'YYYYMMDD_description', NULL, NULL, 1);
"
```

4. **重启 server 并验证**（见步骤 5）

**异常情况 2：迁移执行失败**（构建或 migrate deploy 报错）
- 不要在容器内直接跑 `npx prisma migrate deploy`（工作目录不固定，会找不到 schema）
- 先定位实际 schema 路径：
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec server sh -lc 'find /repo -path "*/schema.prisma" | head -n 5'
```
- 找到路径后再显式传 `--schema` 执行

### 5. 验证
```bash
sleep 5
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml logs server 2>&1 | grep -iE "error|P20[0-9]+"
curl -s http://localhost:3005/
```
- 无 P20xx 错误 + curl 返回 "Welcome to Happy Server!" = 部署成功
- 如果仍有 P2021/P2022，说明还有其他表/列缺失，重复步骤 4

## 注意事项
- Docker Compose 文件路径：`/Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml`
- 数据库名：`handy`，用户：`postgres`，密码：`postgres`
- Server 端口：3005
- **始终用 `--no-cache`**，不要用 `--no-cache-filter`（buildx 缓存不可靠）
- **schema drift 的根因**：只改了 `schema.prisma` 但没运行 `yarn generate`（不生成迁移文件），导致数据库和代码不同步。修复后应补全迁移文件并提交到 git
- 注册 `_prisma_migrations` 时 checksum 填 `'manual'` 即可，Prisma 只检查 migration_name 是否存在，不校验 checksum
