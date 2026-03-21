更新 Happy 项目的 Changelog、版本号和 README

## 使用方式

`/changelog [包名] [版本号]`

- 包名：`app` | `cli` | `agent` | `wire`（不指定则交互式选择）
- 版本号：semver 格式如 `2.4.0`（不指定则根据变更自动建议）

## 流程

### 0. 确定目标包和版本号

#### 包名映射

| 参数 | 包路径 | 版本文件 | Changelog |
|------|--------|---------|-----------|
| `app` | `packages/happy-app` | `app.config.js` → `version: "X.Y.Z"` | `packages/happy-app/CHANGELOG.md` + `CHANGELOG.zh-Hans.md` 等 |
| `cli` | `packages/happy-cli` | `package.json` → `version` | 无本地 CHANGELOG（release-it 生成 GitHub Release） |
| `agent` | `packages/happy-agent` | `package.json` → `version` | 无本地 CHANGELOG |
| `wire` | `packages/happy-wire` | `package.json` → `version` | 无本地 CHANGELOG |

#### 版本号确定

如果未指定版本号：
1. 读取当前版本
2. 使用 git log 分析自上次版本提交以来的变更：
```bash
LAST_VER_COMMIT=$(git log -1 --format="%H" -- <版本文件>)
git log --oneline $LAST_VER_COMMIT..HEAD -- <包路径>/
```
3. 根据变更类型建议版本：
   - 有 `feat:` → minor 升级
   - 仅 `fix:`/`chore:` → patch 升级
   - 有 `BREAKING CHANGE` → major 升级
4. 展示建议版本，等用户确认

---

### 1. 收集变更内容

```bash
LAST_VER_COMMIT=$(git log -1 --format="%H" -- <版本文件>)
git log --oneline $LAST_VER_COMMIT..HEAD -- <包路径>/
```

分析提交内容，按功能分组，生成用户友好的变更描述。

---

### 2. 生成 Changelog 条目（仅 app）

**仅 `app` 包有本地 CHANGELOG**，其他包跳过此步。

#### 2a. 英文版（CHANGELOG.md）

格式规范：

```markdown
## X.Y.Z - YYYY-MM-DD

一句话总结本次更新的核心变化。

### 功能分组标题
- Added/Fixed/Improved 开头的变更描述
- 面向用户的语言，不要写实现细节

### 另一个功能分组
- 变更描述
```

规则：
- 日期使用当天日期
- 摘要段落简洁描述核心变化
- 变更以动词开头：Added、Fixed、Improved、Removed、Updated
- 按功能/模块分组，每组用 `### 标题`
- 描述面向最终用户，不写代码细节
- 新版本条目插入到 `# Changelog` 标题之后、上一个版本之前

#### 2b. 中文版（CHANGELOG.zh-Hans.md）

在写完英文版后，同步生成中文翻译版本：

规则：
- 保持与英文版完全相同的版本号、日期和分组结构
- 变更以动词开头：新增、修复、改进、移除、更新
- 专业术语保留英文原文（如 SDK、API、Worktree、Hook）
- 功能名称首次出现时保留英文（如 Supervisor Loop Mode）
- 新版本条目插入到 `# 更新日志` 标题之后、上一个版本之前

翻译示例：
| 英文 | 中文 |
|------|------|
| Added Loop Mode — autonomous cycles... | 新增循环模式 — 自动分析代码... |
| Fixed HTTP hook server timeout... | 修复 HTTP hook 服务器超时... |
| Improved Supervisor Actions with... | 改进 Supervisor 操作的排序... |

#### 2c. 其他语言（按需）

如果项目中存在其他 `CHANGELOG.{locale}.md` 文件（如 `CHANGELOG.ja.md`、`CHANGELOG.zh-Hant.md`），也需要同步翻译新版本条目。

发现已有的语言文件：
```bash
ls packages/happy-app/CHANGELOG.*.md
```

#### 2d. 写入流程

1. 读取现有 `packages/happy-app/CHANGELOG.md`
2. 在第一个 `## X.Y.Z` 之前插入新版本英文条目
3. 读取现有 `packages/happy-app/CHANGELOG.zh-Hans.md`
4. 在第一个 `## X.Y.Z` 之前插入新版本中文条目
5. 对其他已存在的语言文件重复此流程
6. 运行解析器生成 JSON：
```bash
cd packages/happy-app && npx tsx sources/scripts/parseChangelog.ts
```
7. 验证生成的 `sources/changelog/changelog.json` 包含新版本且所有语言都已收录

---

### 3. 更新版本号

#### app
编辑 `packages/happy-app/app.config.js`：
```javascript
version: "X.Y.Z",  // 更新此值
```

#### cli / agent / wire
编辑对应 `packages/<包>/package.json`：
```json
"version": "X.Y.Z"
```

---

### 4. 更新 README（如有需要）

检查是否需要更新 README：

#### 检查清单
- [ ] 新功能是否需要在 README 中添加使用说明？
- [ ] 是否有 CLI 命令变更（新增/删除/修改参数）？
- [ ] 是否有安装方式变更？
- [ ] 是否有项目结构变更（新增/删除包）？
- [ ] 是否有配置项变更？

#### 需要更新的 README 文件

| 变更范围 | 需要更新的 README |
|---------|-----------------|
| CLI 命令/参数变化 | `packages/happy-cli/README.md` + 根目录 `README.md` |
| Agent 命令/参数变化 | `packages/happy-agent/README.md` |
| 新增/删除 monorepo 包 | 根目录 `README.md` |
| App 功能（一般不需要） | `packages/happy-app/README.md`（少见） |
| Wire 协议变化 | `packages/happy-wire/README.md` |

#### 操作
1. 如果变更涉及 CLI/Agent 的命令行参数或使用方式，更新对应 README 的 Usage 部分
2. 如果涉及项目结构变化，更新根目录 README 的项目结构表
3. 展示要更新的 README 内容差异，等用户确认

---

### 5. 提交

将所有变更文件一起提交：

#### commit message 格式

| 包 | 格式 |
|----|------|
| app | `chore(app): bump version to X.Y.Z + update CHANGELOG` |
| cli | `chore(cli): bump version to X.Y.Z` |
| agent | `chore(agent): bump version to X.Y.Z` |
| wire | `chore(wire): release @kmmao/happy-wire@X.Y.Z` |

如果同时更新了 README，在 commit body 中注明。

```bash
git add <所有变更文件>
git commit -m "<commit message>"
git push
```

---

### 6. 输出摘要

完成后输出：
```
✅ 版本更新完成

包：<包名>
版本：<旧版本> → <新版本>
Changelog：<已更新 / 不适用>
  - en: ✅
  - zh-Hans: ✅
  - 其他语言: ✅ / ⚠️ 未找到语言文件
README：<已更新 / 无需更新>
提交：<commit SHA> - <message>
已推送：origin/main

后续操作提示：
- app: 运行 /happy-release-app 或 yarn ota 发布 OTA
- cli: 运行 /release-cli 发布到 npm
- agent: 运行 /release-agent 发布到 npm
- wire: 运行 cd packages/happy-wire && npm publish --access public
```

## 多语言 Changelog 架构

### 文件结构
```
packages/happy-app/
├── CHANGELOG.md              # 英文（source of truth）
├── CHANGELOG.zh-Hans.md      # 简体中文
├── CHANGELOG.ja.md           # 日文（按需创建）
├── CHANGELOG.zh-Hant.md      # 繁体中文（按需创建）
└── sources/
    ├── scripts/parseChangelog.ts   # 扫描所有 CHANGELOG.*.md 生成 JSON
    └── changelog/
        ├── changelog.json          # 合并后的多语言 JSON
        ├── types.ts                # LocalizedChangelogData 类型
        ├── parser.ts               # 按 getCurrentLanguage() 返回对应语言
        ├── storage.ts              # MMKV 已读版本存储
        └── index.ts                # 导出
```

### 添加新语言
1. 创建 `packages/happy-app/CHANGELOG.{locale}.md`，翻译已有条目
2. 运行 `cd packages/happy-app && npx tsx sources/scripts/parseChangelog.ts`
3. 新语言自动被发现和收录，无需改代码

### 运行时行为
- `parser.ts` 根据 `getCurrentLanguage()` 选择对应语言
- 无翻译时自动 fallback 到英文
- 相近语言自动回退（如 `zh-Hant` 无翻译时回退到 `zh-Hans`）

## 注意事项

- **app 的版本在 `app.config.js` 而非 `package.json`**
- **只有 app 有本地 CHANGELOG**，其他包的 changelog 在 release-it 发布时自动通过 git log 生成
- Changelog 写完后必须运行 `parseChangelog.ts` 生成 JSON
- 版本号必须严格遵循 semver
- README 更新是可选的，只有功能性变更才需要
- 不要修改 `runtimeVersion`（那是 Expo OTA 的原生兼容版本，只在原生代码变更时手动调整）
- **所有已存在的语言文件都必须同步更新**，不能只更新英文版
