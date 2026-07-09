---
name: evolve-and-ship
description: 端到端演进流水线 — 先用 improve-codebase-architecture 找出架构改进项，再用 /goal 逐项自主开发到完成，最后按所有改动文件的包归属，定向执行 deploy-server / release-cli / deploy-webapp。Use when the user wants to run the full "架构改进 → 开发 → 部署" pipeline, evolve then ship, or process improvement opportunities in sequence and deploy only the affected packages.
---

# Evolve and Ship（架构改进 → 逐项开发 → 定向部署）

一条龙编排 skill：把「找改进点 → 完全开发 → 精准部署」串成可控的三阶段流水线。
每一阶段都有明确的完成判据，且**部署阶段严格按改动文件的包归属**触发，绝不多部署无关容器。

## 何时使用

用户想把一次架构演进从「发现问题」一路推到「上线」，例如：
- “跑一遍架构改进，然后逐项开发，最后按需要部署”
- “evolve-and-ship” / “演进并发布”
- 已经有一批 deepening opportunities，要按序开发完再定向部署

## 核心原则

- **阶段之间有闸门**：上一阶段的完成判据不满足，不进下一阶段。
- **/goal 驱动开发**：每个改进项作为一个独立 goal，自主开发到「代码 + 类型检查 + 测试全绿」才算完成，中途不回退给用户确认。
- **部署按归属，最小爆炸半径**：只重建/发布被实际改动触及的包，其余容器不动。
- **wire 是共享闸门**：`packages/happy-wire` 一旦改动，会波及所有下游，且**必须先发布到 npm**，否则 server/webapp 重建时会 pin 到未发布版本。

---

## 阶段 0 — 基线快照（必做）

后续「改动归属分析」要靠 diff，先钉住基线：

```bash
cd /Users/sangreal/Documents/dev-workspace/happy
git rev-parse --abbrev-ref HEAD          # 确认在合适的分支上
git status -s                             # 工作区应尽量干净
BASELINE=$(git rev-parse HEAD) && echo "基线提交：$BASELINE"
```

记住 `$BASELINE`（这一整轮流水线开始前的 HEAD）。阶段 3 用它来算「本轮所有改动」。
如果工作区已有未提交改动，先和用户确认：是纳入本轮部署，还是先 stash/commit。

---

## 阶段 1 — 架构改进探查（improve-codebase-architecture）

调用 `improve-codebase-architecture` skill，得到一批 **deepening opportunities**。

该 skill 的既定流程：探查 → 给出编号候选清单 → 用户挑选 → 设计接口 → 产出实现方案。
**不要跳过用户选择**：把候选清单原样呈现，让用户勾选要做哪些、按什么顺序。

**阶段 1 完成判据**：得到一份**有序的改进项清单**，每项含：
- 涉及文件/模块
- 要改成什么（接口设计已定）
- 预期落在哪些包（server / cli / app / wire / agent）—— 提前标注，方便阶段 3 路由

把这份有序清单落成一个 TaskCreate 列表（每个改进项一个 task），阶段 2 逐项推进。

---

## 阶段 2 — 逐项开发（/goal 驱动，按序完全处理）

对清单里的每个改进项，**按顺序**、作为一个独立 goal 开发到完成。

每项的 goal 完成判据（缺一不可）：
1. 接口与实现按阶段 1 的设计落地
2. 相关包 `typecheck` 通过
3. 相关包 `test` 通过（0 failed）
4. 该项单独提交（commit message 说明改的是哪个 deepening opportunity）

各包的验证命令（只跑被触及的包）：

| 包 | typecheck | test |
|----|-----------|------|
| server | `yarn workspace happy-server typecheck` | `yarn workspace happy-server test` |
| app | `yarn workspace happy-app typecheck` | `yarn workspace happy-app test` |
| cli | （build 内含 tsc）`yarn workspace @kmmao/happy-coder build` | `yarn workspace @kmmao/happy-coder test` |
| agent | `yarn workspace @kmmao/happy-agent build` | `yarn workspace @kmmao/happy-agent test` |
| wire | `yarn workspace @kmmao/happy-wire build` | `yarn workspace @kmmao/happy-wire test` |

> **改到 wire 的特殊规则**：`packages/happy-wire` 是单一真相源。改完必须
> 先 `yarn workspace @kmmao/happy-wire build`，再验证所有下游包 build 通过
> （CLI / Agent / Server / App）。详见 CLAUDE.md「happy-wire is the single source of truth」。

**用 /goal 的方式驱动本阶段**：把每个改进项当作一个 goal，自主开发直到上面 4 条判据全部成立才推进下一项；
不要在某项没做完时把控制权交回用户。如果用户希望整轮强制自动执行到底，可以让他用 `/goal` 包裹本 skill —— Stop hook 会阻止在完成判据未满足时收尾。

**阶段 2 完成判据**：清单里每一项都已实现、验证、提交；`git status -s` 干净。

---

## 阶段 3 — 改动归属分析 + 定向部署

### 3.1 列出本轮所有改动文件

```bash
cd /Users/sangreal/Documents/dev-workspace/happy
git diff --name-only "$BASELINE"..HEAD
```

### 3.2 按包归属分桶

| 改动路径前缀 | 触发的部署命令 | 说明 |
|--------------|----------------|------|
| `packages/happy-server/**` | `/deploy-server` | 重建并重启本地 Docker Server |
| `packages/happy-cli/**` | `/release-cli` | 发布 @kmmao/happy-coder 到 npm + 更新本地安装 |
| `packages/happy-app/**` | `/deploy-webapp` | 重建并重启本地 Docker Webapp（app 容器） |
| `packages/happy-agent/**` | `/release-agent` | 发布 @kmmao/happy-agent 到 npm（用户点名的三类之外，改到才触发） |
| `packages/happy-wire/**` | **先发布 wire**，再按下游归属 | 见 3.3，共享闸门 |

分桶时只看**实际出现在 diff 里的顶层包目录**；没被触及的包一律不部署。

### 3.3 wire 共享闸门（关键正确性约束）

如果 diff 里出现 `packages/happy-wire/**`：

- wire 的改动会波及**所有**下游（server / app / cli / agent 都消费它）。
- server / webapp 的部署命令在 1.5 步**只从 npm 同步 wire 版本号、不发布 wire**。
  所以 **wire 必须先发布到 npm**，否则 server/webapp 重建时会 pin 到一个 npm 上还不存在的版本。
- 发布 wire 的完整动作（升版 → build → test → `npm publish --access public` → 用 grep 全量同步 4 个下游 package.json → 提交并 push）见 `release-cli.md` 的「步骤 0」与 CLAUDE.md 的发布顺序。

**处理策略**：一旦 wire 改动，**先独立发布 wire**（按 release-cli 步骤 0 的流程），再进入 3.4 部署具体下游包。
若本轮 cli 也要发，`/release-cli` 的步骤 0 会自动完成 wire 发布判断，可让它顺带处理；
但只要有 server/webapp 需要重建而 cli/agent 不发，就必须在此显式先发 wire。

### 3.4 按依赖安全顺序执行部署

只执行 3.2 分桶里**命中的**命令，顺序固定（满足发布依赖）：

```
1. wire     —— 若改动（3.3）：先发布到 npm
2. cli      —— 命中则 /release-cli
3. agent    —— 命中则 /release-agent
4. server   —— 命中则 /deploy-server
5. webapp   —— 命中则 /deploy-webapp
```

> 为什么这个顺序：wire 是所有人的依赖，必须先上 npm；cli/agent 是 npm 发布类；
> server/webapp 是本地 Docker 重建类，且它们的 1.5 步会从 npm 拉最新 wire —— 所以放在 wire 发布之后。

**每个部署命令都是有外部副作用的操作**（npm publish / Docker 重建 / 重启容器）。逐个执行，
执行前用一句话说明「即将对 X 包执行 Y 命令」，再调用，让用户有中断窗口。
每个命令跑完按其自身的验证步骤确认成功（curl / 哈希比对 / 日志无 P20xx 等），再进行下一个。

### 3.5 收尾汇总

全部部署完成后，给用户一份汇总：
- 本轮开发了哪些改进项（对应 commit）
- 改动落在哪些包
- 触发了哪些部署命令、各自结果
- 需要用户手动跟进的（如其他机器 `npm update -g`、浏览器强制刷新 service worker）

---

## 反例与边界

- **不要在阶段 1 未产出有序清单前就开始写代码**：没有接口设计的实现会偏离架构改进目标。
- **不要一次性开发多个改进项再统一提交**：逐项 goal + 逐项 commit，阶段 3 的归属分析才准确。
- **不要部署没被 diff 触及的包**：多余的 Docker 重建/npm 发布会引入无关风险。
- **不要手动重启 daemon**：`/release-cli` 已说明——daemon 有心跳自动版本检测，手动 stop/start/restart 会断开所有 WebSocket、使活跃会话失效。
- **wire 改动却不先发布**：会导致 server/webapp pin 到未发布版本，构建/运行期类型不匹配。这是历史反复踩的坑。
