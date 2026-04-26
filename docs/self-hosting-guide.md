# 自部署指南（Self-Hosting Guide）

本指南帮助你在自己的 VPS 或云服务器上部署 Happy Coder 后端，全程约 **15 分钟**。

---

## 前置条件

| 需求 | 说明 |
|------|------|
| VPS / 云服务器 | 最低 1 核 1GB RAM，推荐 2 核 2GB |
| 操作系统 | Ubuntu 22.04 / Debian 12 / 任意支持 Docker 的 Linux |
| Docker | 版本 ≥ 24，含 Docker Compose V2 |
| 域名 | 已解析 A 记录指向服务器 IP（Caddy 自动申请 SSL） |
| 开放端口 | 80、443 对外开放（Let's Encrypt 验证需要） |

---

## 第一步：安装 Docker

```bash
# Ubuntu / Debian 一键安装
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version   # 确认 Compose V2 可用
```

---

## 第二步：克隆仓库

```bash
git clone https://github.com/your-org/happy.git   # 替换为你 fork 后的地址
cd happy
```

---

## 第三步：配置环境变量

```bash
cp packages/happy-server/.env.example packages/happy-server/.env
nano packages/happy-server/.env
```

### 必填变量说明

| 变量 | 说明 | 生成方式 |
|------|------|---------|
| `DOMAIN` | 你的域名（Caddy 自动申请 SSL） | 填写实际域名，如 `happy.example.com` |
| `POSTGRES_PASSWORD` | 数据库密码 | `openssl rand -hex 16` |
| `REDIS_PASSWORD` | Redis 密码 | `openssl rand -hex 16` |
| `MINIO_ROOT_USER` | MinIO 管理员用户名 | 自定义，如 `happyadmin` |
| `MINIO_ROOT_PASSWORD` | MinIO 管理员密码 | `openssl rand -hex 16` |
| `S3_PUBLIC_URL` | 文件公开访问地址 | `https://happy.example.com/files` |
| `HANDY_MASTER_SECRET` | 主密钥（Auth 签名 + 加密） | `openssl rand -hex 32` |

**一键生成所有密钥：**

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
echo "REDIS_PASSWORD=$(openssl rand -hex 16)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)"
echo "HANDY_MASTER_SECRET=$(openssl rand -hex 32)"
```

将输出填入 `.env` 对应字段。

---

## 第四步：启动服务

```bash
docker compose -f packages/happy-server/docker-compose.yml up -d
```

首次启动约需 **2–3 分钟**，期间会：
- 拉取 PostgreSQL、Redis、MinIO、Caddy 镜像
- 从源码构建 Happy Server
- 执行数据库迁移（`prisma migrate deploy`）
- Caddy 自动申请 Let's Encrypt SSL 证书

### 检查服务状态

```bash
docker compose -f packages/happy-server/docker-compose.yml ps
```

所有服务应显示 `healthy` 或 `Up`：

```
NAME              STATUS
happy-caddy-1     Up (healthy)
happy-server-1    Up (healthy)
happy-postgres-1  Up (healthy)
happy-redis-1     Up (healthy)
happy-minio-1     Up (healthy)
```

### 验证部署

```bash
curl https://happy.example.com/health
# 返回 {"status":"ok"} 表示部署成功
```

---

## 第五步：连接自部署服务器

在你的本地机器上安装 CLI 并指向自部署服务器：

```bash
npm install -g @kmmao/happy-coder

# 方式一：单次使用
HAPPY_SERVER_URL=https://happy.example.com happy

# 方式二：永久设置
echo 'export HAPPY_SERVER_URL=https://happy.example.com' >> ~/.zshrc
source ~/.zshrc
happy
```

---

## 日常运维

### 查看日志

```bash
# 所有服务
docker compose -f packages/happy-server/docker-compose.yml logs -f

# 仅 Server
docker compose -f packages/happy-server/docker-compose.yml logs -f server
```

### 更新到新版本

```bash
git pull origin main
docker compose -f packages/happy-server/docker-compose.yml up -d --build
```

### 备份数据库

```bash
docker compose -f packages/happy-server/docker-compose.yml exec postgres \
  pg_dump -U happy happy > backup-$(date +%Y%m%d).sql
```

### 停止服务

```bash
docker compose -f packages/happy-server/docker-compose.yml down
```

---

## 反向代理说明

本方案使用 **Caddy** 作为反向代理：
- 自动申请和续期 Let's Encrypt 证书，**无需手动配置 SSL**
- 原生支持 HTTP/3 (QUIC)
- WebSocket / Socket.IO 长连接（`flush_interval -1`）

配置文件：`packages/happy-server/Caddyfile.prod`，可按需修改。

### 改用 Nginx（可选）

将 `docker-compose.yml` 中 `caddy` 服务替换为 Nginx，并配置：

```nginx
server {
    listen 443 ssl;
    server_name happy.example.com;

    ssl_certificate     /etc/letsencrypt/live/happy.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/happy.example.com/privkey.pem;

    location / {
        proxy_pass http://server:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
    }
}
```

---

## 常见问题

### Caddy 无法申请证书

**原因**：域名 A 记录未生效，或 80/443 端口未开放。

```bash
# 检查域名解析
dig happy.example.com

# 查看 Caddy 日志
docker compose -f packages/happy-server/docker-compose.yml logs caddy
```

### Server 启动失败

```bash
docker compose -f packages/happy-server/docker-compose.yml logs server
```

常见原因：
- `.env` 中有必填变量未填写
- 密码含特殊字符，需在 `.env` 中加引号

### 数据库迁移失败

```bash
docker compose -f packages/happy-server/docker-compose.yml exec server \
  npx prisma migrate deploy
```

---

## 相关文档

- 环境变量完整参考：[`packages/happy-server/.env.example`](../packages/happy-server/.env.example)
- Kubernetes 部署：[`docs/deployment.md`](deployment.md)
- 本地开发调试：[`docs/local-development.md`](local-development.md)
