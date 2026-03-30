/**
 * Checks whether the remote machine has the /dev skill installed
 * at ~/.claude/commands/dev.md.
 *
 * If not installed, provides an install function that writes
 * the skill content to the remote machine.
 */

import * as React from "react";
import { sessionBash } from "@/sync/ops";

export type DevSkillStatus = "checking" | "installed" | "outdated" | "not-installed" | "error";

export type DevSkillCheckResult = {
    readonly status: DevSkillStatus;
    readonly remoteVersion: number | null;
    readonly install: () => Promise<boolean>;
    readonly recheck: () => void;
};

/** Current version — bump this when updating the skill content below */
const CURRENT_VERSION = 3;

/** Version tag format in dev.md: <!-- happy-dev-skill v1 --> */
const VERSION_REGEX = /<!--\s*happy-dev-skill\s+v(\d+)\s*-->/;

/** Minimal /dev skill content to bootstrap on remote machines */
const DEV_SKILL_CONTENT = `<!-- happy-dev-skill v${CURRENT_VERSION} -->
识别项目结构并生成开发环境配置，或按配置启动指定服务

## 核心规则

- **\`/dev\`（无参数）**：如果没有 \`.happy/dev.yml\`，则扫描项目并**只生成配置文件，不启动任何服务**。如果已有配置文件，也**不自动启动**，只显示配置摘要并提示用户在 App 的 Dev 配置页面选择要启动的服务。
- **\`/dev <service>\`**：启动指定服务（按 \`activeMode\` 的命令启动）
- **\`/dev stop\`**：停止服务
- 启动操作**必须由用户明确指定**，\`/dev\` 本身永远不自动启动

## 流程

### 1. 读取配置

检查当前项目根目录下是否存在 \`.happy/dev.yml\` 配置文件。

#### 如果存在配置文件

读取并解析 \`.happy/dev.yml\`，获取服务定义列表。**不启动任何服务**，输出配置摘要即可。

#### 如果不存在配置文件

扫描项目结构，自动推断开发环境配置：

1. **扫描项目文件**：检测 pom.xml、build.gradle、package.json、docker-compose.yml 等特征文件
2. **多子项目扫描**：find . -maxdepth 2 查找子项目
3. 推断启动命令、端口、关联配置文件（configFiles）
4. 检测可用的端口映射方案（Caddy/Tailscale）自动建议 expose 配置
5. 读取 package.json scripts 确认启动命令
6. 直接生成 .happy/dev.yml，不逐项询问用户确认，使用合理默认值

3.1 **Docker Compose 深度检测**：

如果项目有 docker-compose.yml，必须解析其中定义的所有服务：
- 列出 docker compose 中定义的所有服务
- 查看每个服务的端口映射
- 端口从 ports 映射中读取宿主机端口
- configFiles 关联 docker-compose.yml 和对应的 Dockerfile

### 多启动模式（modes）— v3 新增

**关键规则：当同一个子项目既有本地启动方式又有 Docker 启动方式时，必须合并为一个 service 的 modes，而非拆成两个独立 service。**

判断条件：
- 子项目目录下有 package.json（或 pom.xml 等）= 本地启动方式
- 同一子项目在 docker-compose.yml 中有对应服务定义 = Docker 启动方式
- 两者同时存在 → 使用 modes 格式

\`\`\`yaml
services:
  frontend:
    name: "Vue Frontend"
    activeMode: "local"
    modes:
      local:
        label: "Local Dev"
        command: "yarn run serve"
        cwd: "./gs-frontend"
        port: 3000
      docker:
        label: "Docker"
        command: "docker compose up dev -d"
        port: 3000
        env:
          NODE_ENV: "production"
    depends_on: ["backend"]
    configFiles:
      - path: "./gs-frontend/vue.config.js"
        label: "Vue 配置"
      - path: "./gs-frontend/docker-compose.yml"
        label: "Docker Compose"
\`\`\`

modes 字段说明：
- \`activeMode\`：当前激活的模式 key（如 "local" 或 "docker"）
- 每个 mode 可以有自己的 command、cwd、port、env
- 服务级别的 port/env 是共享默认值，mode 级别的会覆盖
- **只有一种启动方式时**，使用传统的单 command 格式（不需要 modes）
- **纯 Docker 服务**（如 MySQL、Redis）也使用单 command 格式

### Spring Boot 深度推断

- 从 application.yml 读取实际的 spring.profiles.active，**不要假设 profile 是 dev**
- 端口号从 server.port 读取，**不要默认 8080**
- configFiles 关联实际激活的 profile 配置文件

### 2. 解析服务依赖关系

按 depends_on 拓扑排序，检测循环依赖。

### 3. 按顺序启动服务

每个服务：
1. 确定启动命令：如果有 modes，使用 activeMode 对应的 command；否则使用 service.command
2. 检查端口占用（lsof -i :PORT）
3. 安装依赖（如果需要）
4. 使用 Bash 工具的 run_in_background: true 启动
5. 等待服务就绪（healthCheck 或 nc -z）

### 4. 建立端口映射

服务就绪后，如果配置了 expose：
- Caddy：调用 Admin API 添加反向代理
- Tailscale：tailscale serve/funnel

### 5. 汇报启动结果

输出汇总表格（服务名称、端口、启动模式、状态、外网访问 URL）。

## 子命令

- \`/dev\` — 扫描项目生成配置（无配置时）或显示配置摘要（有配置时），**不启动服务**
- \`/dev <service>\` — 启动指定服务
- \`/dev stop\` — 停止所有服务
- \`/dev status\` — 检查运行状态
- \`/dev restart <service>\` — 重启指定服务
- \`/dev <service>\` — 只启动指定服务
- \`/dev scan\` — 增量扫描未配置的新服务

## 启动后健康监控

启动服务后提示用户：如需持续监控，可使用 \`/loop 5m /dev status\`

## 注意事项

- **\`/dev\` 永远不自动启动服务**，只生成配置或显示摘要
- 所有服务必须使用 run_in_background: true 启动
- 启动顺序严格按照 depends_on 拓扑排序
- 遇到端口冲突时询问用户而不是自动杀进程
- configFiles 路径必须是真实存在的文件（先用 ls 验证）
- expose 不自动配置，留给用户手动添加
- /dev scan 是增量的，不修改已有配置
- Docker 服务用 docker compose up <name> -d 启动，不要遗漏 -d
- **同一子项目有多种启动方式时，必须合并为一个 service 的 modes，不要拆成多个 service**
`;

export function useDevSkillCheck(sessionId: string, enabled: boolean): DevSkillCheckResult {
    const [status, setStatus] = React.useState<DevSkillStatus>("checking");
    const [remoteVersion, setRemoteVersion] = React.useState<number | null>(null);

    const check = React.useCallback(async () => {
        setStatus("checking");
        try {
            // Read the first line to check version tag
            const result = await sessionBash(sessionId, {
                command: "head -1 ~/.claude/commands/dev.md 2>/dev/null || echo 'missing'",
                timeout: 5000,
            });
            const output = (result.stdout ?? "").trim();

            if (output === "missing" || output === "") {
                setRemoteVersion(null);
                setStatus("not-installed");
                return;
            }

            // Extract version from <!-- happy-dev-skill vN -->
            const match = output.match(VERSION_REGEX);
            if (match) {
                const ver = parseInt(match[1], 10);
                setRemoteVersion(ver);
                setStatus(ver < CURRENT_VERSION ? "outdated" : "installed");
            } else {
                // File exists but no version tag — treat as outdated (v0)
                setRemoteVersion(0);
                setStatus("outdated");
            }
        } catch {
            setStatus("error");
        }
    }, [sessionId]);

    React.useEffect(() => {
        if (!enabled) return;
        check();
    }, [enabled, check]);

    const install = React.useCallback(async (): Promise<boolean> => {
        try {
            const result = await sessionBash(sessionId, {
                command: `mkdir -p ~/.claude/commands && cat > ~/.claude/commands/dev.md << 'HAPPY_DEV_EOF'
${DEV_SKILL_CONTENT}
HAPPY_DEV_EOF`,
                timeout: 10000,
            });

            if (result.success) {
                setRemoteVersion(CURRENT_VERSION);
                setStatus("installed");
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }, [sessionId]);

    return { status, remoteVersion, install, recheck: check };
}
