发布 happy-agent (@kmmao/happy-agent) 到 npm

## 流程

### 0. 预检：happy-wire 发布判断

在发布 agent 之前，检查 `@kmmao/happy-wire` 是否需要先行发布。

#### 检查方式

1. **获取 npm 已发布版本**：
```bash
npm view @kmmao/happy-wire version 2>/dev/null || echo "未发布"
```

2. **获取本地版本**：读取 `packages/happy-wire/package.json` 中的 `version`

3. **检查源码变更**：
```bash
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

1. **升版本号**（如未升过）：修改 `packages/happy-wire/package.json` 的 `version`
2. **构建**：`yarn workspace @kmmao/happy-wire build`
3. **测试**：`yarn workspace @kmmao/happy-wire test`
4. **发布到 npm**：`cd packages/happy-wire && npm publish --access public`
5. **更新 agent 的依赖版本号**：修改 `packages/happy-agent/package.json` 中 `dependencies["@kmmao/happy-wire"]`
6. **提交**：commit message `chore(wire): release @kmmao/happy-wire@X.Y.Z`，push 到 main

---

### 1. 升版本号
- 读取 `packages/happy-agent/package.json` 当前版本
- 按 semver 递增（patch/minor/major 根据变更程度）
- 修改 `version` 字段

### 2. 构建
```bash
yarn workspace @kmmao/happy-agent build
```

### 3. 测试
```bash
yarn workspace @kmmao/happy-agent test
```
- 全部测试必须通过（0 failed）才能继续

### 4. 提交版本变更
- commit message：`chore(agent): bump version to X.Y.Z`
- push 到 origin/main

### 5. 发布到 npm
```bash
cd packages/happy-agent && npm publish --access public --ignore-scripts
```
- 确认发布成功（输出中有 `+ @kmmao/happy-agent@X.Y.Z`）

### 6. 验证
- 确认发布：`npm view @kmmao/happy-agent version`
- 提醒用户更新：`npm install -g @kmmao/happy-agent`

## 注意事项
- 发布前必须确保 typecheck 和 test 全部通过
- 如果测试失败，先修复再发布，不要跳过测试
- `--ignore-scripts` 避免 prepublishOnly 在发布时重复执行
- happy-wire 必须在 agent 之前发布，agent 运行时依赖 wire
- happy-agent 无本地守护进程，发布后无需额外的本地安装步骤
