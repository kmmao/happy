重建并重启本地 Docker Server

## 前提检查

### 1. 确认 Docker 环境可用
```bash
docker compose version
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml ps
```

### 2. 检查是否有 Prisma schema 变更
```bash
git diff HEAD~1 -- packages/happy-server/prisma/schema.prisma
```
- 如果有变更，重启后需要跑迁移
- 如果没有变更，不需要额外操作

## 部署流程

### 3. 重建 Server 镜像
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml build server
```
- 此步骤耗时较长（1-2 分钟），包含 yarn install、happy-wire 构建、happy-server 构建

### 4. 重启 Server 容器
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml up -d server
```
- 只重启 server 容器，数据库/Redis/MinIO 保持不动

### 5. 如有 Prisma 变更，执行迁移
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec server npx prisma migrate deploy
```

### 6. 验证
```bash
sleep 3
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml logs --tail 15 server
curl -s http://localhost:3005/
```
- 日志中应看到正常的请求处理（statusCode: 200）
- curl 应返回 "Welcome to Happy Server!"

## 注意事项
- Docker Compose 文件路径：`/Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml`
- Server 端口：3005
- 如果构建失败，检查 `Dockerfile.server` 是否包含所有必要的 COPY 步骤
- 如果启动失败，用 `docker compose logs server` 查看完整日志
