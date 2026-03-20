发布 CLI (@kmmao/happy-coder) 到 npm 并更新本地安装

## 流程

### 0. 预检：happy-wire 发布判断

在发布 CLI 之前，检查 `@kmmao/happy-wire` 是否需要先行发布。

#### 检查方式

1. **获取 npm 已发布版本**：
```bash
npm view @kmmao/happy-wire version 2>/dev/null || echo "未发布"
```

2. **获取本地版本**：读取 `packages/happy-wire/package.json` 中的 `version`

3. **检查源码变更**：
```bash
# 对比 wire/src 自上次 package.json 版本变更后是否有新的提交
LAST_VER_COMMIT=$(git log -1 --format="%H" -- packages/happy-wire/package.json)
git log --oneline $LAST_VER_COMMIT..HEAD -- packages/happy-wire/src/
```

#### 判断逻辑

| 本地版本 vs npm 版本 | src/ 有新提交 | 操作 |
|---------------------|-------------|------|
| 相同 | 无 | **跳过**，直接进入步骤 1 |
| 相同 | 有 | 需要**升版本 + 发布** |
| 本地 > npm | — | 已升版本，需要**发布** |
| npm 未发布 | — | 首次发布，需要**发布** |

#### 发布 happy-wire（仅当需要时）

1. **升版本号**（如未升过）：修改 `packages/happy-wire/package.json` 的 `version`（patch/minor/major 根据变更程度）
2. **构建**：
```bash
yarn workspace @kmmao/happy-wire build
```
3. **测试**：
```bash
yarn workspace @kmmao/happy-wire test
```
4. **发布到 npm**：
```bash
cd packages/happy-wire && npm publish --access public
```
5. **更新依赖方版本号**（如果 wire 版本变了）：
   - `packages/happy-cli/package.json` → `devDependencies["@kmmao/happy-wire"]`
   - `packages/happy-agent/package.json` → `dependencies["@kmmao/happy-wire"]`
   - 注意：只需更新版本范围（如 `"^0.2.0"`），不要改变 `^` 前缀
6. **提交**：
   - commit message 格式：`chore(wire): release @kmmao/happy-wire@X.Y.Z`
   - 将 wire 的 package.json 和所有依赖方 package.json 变更一起提交
   - push 到 origin/main

---

### 1. 升版本号
- 读取 `packages/happy-cli/package.json` 当前版本
- 按 semver 递增版本号（patch/minor/major 根据变更程度决定）
- 修改 `package.json` 中的 `version` 字段

### 2. 构建
```bash
yarn workspace @kmmao/happy-coder build
```

### 3. 测试
```bash
yarn workspace @kmmao/happy-coder test
```
- 全部测试必须通过（0 failed）才能继续

### 4. 提交版本变更
- 将 `packages/happy-cli/package.json` 和任何修复的文件一起提交
- commit message 格式：`chore(cli): bump version to X.Y.Z`
- push 到 origin/main

### 5. 发布到 npm
```bash
cd packages/happy-cli && npm publish --access public --ignore-scripts
```
- 确认发布成功（输出中有 `+ @kmmao/happy-coder@X.Y.Z`）

### 6. 更新本地全局安装
```bash
npm uninstall -g @kmmao/happy-coder happy-coder 2>/dev/null; npm install -g ./packages/happy-cli
```
- 先卸载所有可能的旧名称（避免产生重复条目），再重新安装
- 重新构建以确保 dist 中版本号同步：`yarn workspace @kmmao/happy-coder build`
- 验证版本：`happy --version`（会因 Claude Code 环境报错，只要版本号正确即可）
- 验证只有一条全局记录：`npm list -g --depth=0 | grep happy`

### 7. 验证守护进程版本（不要重启！）
- 运行 `happy daemon status` 查看当前守护进程版本
- 守护进程会通过心跳机制（每 60 秒）自动检测版本变更并自动重启
- 如果需要立即生效，`happy daemon status` 本身也会触发版本检查
- **⚠️ 绝对不要手动执行 `happy daemon stop/start/restart`** — 这会断开所有 WebSocket 连接，导致所有活跃会话失效，用户必须强制重新登录才能恢复

### 8. 验证
- 确认 npm 发布成功
- 确认本地全局安装版本正确
- 确认守护进程版本正确（自动更新或通过 status 触发）
- 提醒用户其他机器需要执行：`npm update -g @kmmao/happy-coder`

## 注意事项
- 发布前必须确保 typecheck 和 test 全部通过
- 如果测试失败，先修复再发布，不要跳过测试
- `--ignore-scripts` 避免 postinstall 在发布时执行
- 当前目录可能在子包下，注意使用绝对路径或回到仓库根目录
- **永远不要手动重启守护进程** — 守护进程有自动版本检测机制，手动重启会破坏所有活跃连接
- **happy-wire 发布顺序**：wire 必须在 CLI 和 Agent 之前发布，因为 Agent 运行时依赖 wire（CLI 已改为 devDependency，pkgroll 内联打包）
