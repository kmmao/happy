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
const CURRENT_VERSION = 2;

/** Version tag format in dev.md: <!-- happy-dev-skill v1 --> */
const VERSION_REGEX = /<!--\s*happy-dev-skill\s+v(\d+)\s*-->/;

/** Minimal /dev skill content to bootstrap on remote machines */
const DEV_SKILL_CONTENT = `<!-- happy-dev-skill v${CURRENT_VERSION} -->
识别项目结构并生成开发环境配置，或按配置启动指定服务

## 核心规则

- /dev（无参数）：只生成或显示配置，不启动任何服务
- /dev <service>：启动指定服务
- /dev stop：停止服务
- 启动操作必须由用户明确指定

## 流程

### 1. 读取配置

检查当前项目根目录下是否存在 \`.happy/dev.yml\` 配置文件。

#### 如果存在配置文件

读取并解析 \`.happy/dev.yml\`，获取服务定义列表。

#### 如果不存在配置文件

扫描项目结构，自动推断开发环境配置：

1. 扫描项目文件，检测 pom.xml、build.gradle、package.json、docker-compose.yml 等特征文件
2. 多子项目扫描：find . -maxdepth 2 查找子项目
3. 推断启动命令、端口、关联配置文件（configFiles）
4. 检测可用的端口映射方案（Caddy/Tailscale）自动建议 expose 配置
5. 读取 package.json scripts 确认启动命令
6. 直接生成 .happy/dev.yml，不逐项询问用户确认，使用合理默认值（profile=dev，端口从配置提取）

### 2. 解析服务依赖关系

按 depends_on 拓扑排序，检测循环依赖。

### 3. 按顺序启动服务

每个服务：
1. 检查端口占用（lsof -i :PORT）
2. 安装依赖（如果需要）
3. 使用 Bash 工具的 run_in_background: true 启动
4. 等待服务就绪（healthCheck 或 nc -z）

### 4. 建立端口映射

服务就绪后，如果配置了 expose：
- Caddy：调用 Admin API 添加反向代理
- Tailscale：tailscale serve/funnel

### 5. 汇报启动结果

输出汇总表格（服务名称、端口、状态、外网访问 URL）。

## 子命令

- \`/dev\` — 启动全部服务
- \`/dev stop\` — 停止所有服务
- \`/dev status\` — 检查运行状态
- \`/dev restart <service>\` — 重启指定服务
- \`/dev <service>\` — 只启动指定服务
- \`/dev scan\` — 增量扫描未配置的新服务

## 注意事项

- 所有服务必须使用 run_in_background: true 启动
- 启动顺序严格按照 depends_on 拓扑排序
- 遇到端口冲突时询问用户而不是自动杀进程
- configFiles 路径必须是真实存在的文件
- expose 需先检测可用的隧道方案
- /dev scan 是增量的，不修改已有配置
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
