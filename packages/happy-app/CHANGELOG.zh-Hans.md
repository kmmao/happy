# 更新日志

## 2.14.0 - 2026-04-21

重新设计的 Session 进度面板（Glass UI）、统一侧栏与独立 Code Changes 视图、按轮次的 Knowledge 生命周期与 hot/evicted 徽章、无需重启的归档恢复、全新重构的 AI Profile 设置 UI，以及对核心页面 loading / error / empty 三态的最终视觉统一。

### Session 进度面板
- 新增重新设计的进度面板 — Glass UI、活动时间轴，MCP 来源的 checklist/summary 同步到 Progress 标签
- 新增多列表进度支持 — `activeForm` 标签 + 从 Claude todo 流中提取的验证提示
- 新增每个列表的文件变更汇总 — 聚合 Edit/Write 命中数到进度面板
- 新增 checklist 完成后自动触发 summary — CLI 在所有项完成时让 Agent 通过 MCP 同步
- 新增 checklist 项按状态弹出菜单（verify / continue / report issue）— 将模板化提示词回填到输入框

### Session 侧栏
- 合并 Progress 和 Code 标签为统一的 **session** 标签；项目知识库关闭时自动隐藏 Knowledge 标签
- 新增 **Code Changes** 视图 — 按文件统计条 + 可展开 diff
- 新增独立 Codex 工具视图（plan preview、patch、diff）和 Codex 进度面板
- 新增 **默认展开 Diff** 外观设置 — 应用到 Edit/Write/GeminiEdit/CodexPatch
- 新增 InputFAB 纵向布局 — 独立按钮行，更易触达

### 视觉一致性
- 新增共享三态视图组件 — 将 loading / error / empty 统一应用到 sessions、inbox、usage、preview、timeline、process manager 和 OpenClaw
- 统一 OpenClaw 会话页路由和标签包装组件 — 不再各写一套状态 UI 导致视觉漂移
- 修复 usage 面板与图表的本地化兜底文案 — 空态/错误态不再回退到硬编码英文
- 将同一套三态系统继续扩展到 project / git / friends / artifacts 页面，包括更多 project 子页、knowledge evolution、issues、PRs 以及 artifact 详情/编辑页
- 新增共享 collection-state helper — 远程列表页不再各自复制一套略有偏差的 loading/error/empty 分支判断
- 修复 artifact 详情深链加载问题 — 本地 storage 为空时会主动拉取数据，不再一进页面就直接报错

### 知识库
- 新增按 Session 轮次的 Knowledge 条目生命周期 — 冷条目自动驱逐，命中频繁的条目延长寿命
- 新增 References 的 HotBadge — 显示预算/命中数（fresh / proven / evicted），长按查看说明
- 新增 4 标签 Knowledge 控制台 — Changes / References / Evicted / Archive，支持一键 Evict 与 Re-inject
- 新增实时 knowledge-access 更新 — 命中瞬间 Summary 和 References 即刻刷新
- 新增 Summary 行 `· N hit · M hot` 后缀（当 TTL 数据存在时）
- 调整 Summary 标签到桌面端和移动端的首位
- 修复 References 永远卡在 7/14 的问题 — 对 active 行的 re-injection 不再重置 TTL

### 归档与会话生命周期
- 新增无需重启的 unarchive 流程 — resume 或 unarchive 模式恢复归档会话，无需重建连接
- 新增 SessionProviderTag + 共享 `rpcSummaryVisualState` Helper — 提供商徽章样式统一
- 新增 Codex 信息面板中的 `codexThreadId` 展示

### AI Profile 与 Supervisor
- 重构 Profile 设置 UI — 基于共享内置档案（Anthropic / DeepSeek / Z.AI），编辑更清晰
- 新增 Supervisor request-profile 流程与 session 元数据恢复 — 提升 Supervisor 运行韧性
- 统一 Supervisor 触发分发（Scheduler + Webhook）— 定时和 Push 驱动的运行共用同一套 Profile 解析路径

### 移除
- 移除 Request Timing Diagnostics — 该功能从未为 Claude 会话采集到数据（CLI 挂在 turn-end envelope 上，App 读取的却是从不发出的 `ready` 事件）。App/CLI/Wire 三端整条链路完全移除

## 2.13.0 - 2026-04-17

Claude Agent SDK 升级至 Opus 4.7，新增 XHigh 推理强度档位，以及更智能的会话事件（记忆召回和 API 请求状态）。

### Claude 模型与推理强度
- 新增 Opus 4.7 作为可选模型（Latest，默认 1M 上下文）
- 合并 200K/1M 两个变体 — Sonnet 和 Opus 默认使用 1M 上下文（保留 `-1m` 键以兼容已绑定的会话）
- 新增 XHigh 推理强度档位（仅 Opus 4.7）— 原生 SDK 支持，不再被静默降级为 Max
- 重写全部 9 种语言的推理强度档位描述 — 明确 Low 和 Medium 的任务适用场景区分
- 智能降级 — 仅在当前模型原生支持时显示 XHigh，其他 Claude 模型自动回退到 Max/High/Medium/Low

### 会话事件
- 新增记忆召回事件 — App 显示哪些记忆被注入了本轮对话（"Recalled N notes"）
- 新增 Requesting 状态提示 — 每次 API 调用前显示轻量级会话事件
- 新增 shouldQuery=false 消息支持 — 仅追加到对话记录，不触发 Assistant 轮次

## 2.12.0 - 2026-03-30

Dev 开发环境管理与实时日志流、知识库项目级配置与生命周期管理 UI、任务展示全面优化（彩色徽章 + 折叠结果）、大量后台任务稳定性修复。

### Dev 开发环境管理
- 新增 `/dev` skill — 扫描并生成项目开发环境配置
- 新增 Dev 配置页面 — 服务卡片、一键全部启动及单服务启停按钮
- 新增服务实时日志流查看
- 新增文件浏览器弹窗 — 用于选择配置文件
- 新增 Docker 容器 stop 后保留容器复用（不自动删除）
- 新增 Rescan 按钮 — 删除并重新生成 dev.yml
- 修复 Dev 配置页面每次进入重新检测服务
- 修复 Dev 配置页面中文乱码问题
- 修复 dev.yml 保存失败 — 改用 base64 编码写入

### 知识库配置
- 新增项目级知识库配置和生命周期管理 UI
- 新增每个项目独立功能开关，不依赖 .env 全局设置

### 任务展示
- 新增彩色徽章统计 — 任务状态一目了然
- 新增子任务内联指标（进度指示器）
- 新增子任务结果折叠展示
- 新增 sub-agent 摘要折叠显示

### 后台任务稳定性
- 重构后台任务终止 — 改用 SDK 原生 stopTask RPC
- 新增 dismissed 状态持久化到 MMKV（刷新后不再重现）
- 新增面板去重 — 相同 command 只显示最新任务
- 新增 idle 任务 stop 时自动发送 task-end 消息
- 新增 stopTask 失败时 fallback 到 kill 命令
- 修复刷新后后台任务面板丢失
- 修复 Bash 工具完成后仍显示 running 状态
- 修复 task-start 从已有 tool message 获取 command 数据
- 修复旧会话残留任务错误显示为运行中
- 修复 normalizer 丢弃无 turn 的 envelope 导致 task-end 消息丢失
- 修复 backgroundTaskId 处理被 state guard 跳过

### Web 与 UI
- 新增 alert 弹窗按钮超过 2 个时自动切换竖排布局（类 iOS ActionSheet）
- 移除小话筒 STT 语音转文字输入功能
- 修复非语音模式下 voice 调试日志刷屏

## 2.11.0 - 2026-03-29

统一语音输入为系统原生语音识别，移除 Docker STT/TTS 服务，改进 ElevenLabs 语音配置界面。

### 语音输入
- 移除 Docker Whisper STT 服务 — 所有平台统一使用系统原生语音识别（iOS Siri、Android Google、Web Speech API）
- 移除 Haiku 语音转写纠错功能（sttCorrection 设置）
- 移除 Edge TTS 服务及所有相关代码
- Web 端语音转文字从 475 行精简到 45 行

### 语音设置
- 新增语音设置页保存按钮和配置状态反馈
- 新增 ElevenLabs 账户余额和用量显示
- 新增用户自填 ElevenLabs API Key 支持

### 语音稳定性
- 修复 ElevenLabs 客户端在缺少 error_event 时崩溃
- 修复向非活跃语音会话发送上下文更新和文本消息的问题
- 修复 handleErrorEvent 补丁改为静默忽略而非断开连接

## 2.10.0 - 2026-03-28

项目知识库语义检索与演化追踪、拖放文件上传、AskUserQuestion 交互式 step 界面恢复、容器管理改进。

### 知识库
- 新增项目知识库（实验性）— 自动提取和存储会话洞察
- 新增语义检索 — 向量嵌入（Ollama/OpenAI）+ HNSW 索引加速检索
- 新增知识演化时间线 — 查看洞察在不同会话中的演变过程
- 新增跨项目全局知识搜索 — 从项目列表顶部入口进入
- 新增概要自动重写 — 由 Haiku 4.5 驱动
- 新增可配置灵敏度预设和触发条件开关
- 新增 tab 切换自动刷新 + 刷新时间显示 + 手动刷新按钮
- 修复知识条目标题生成为空 + 重复条目竞态问题

### 文件上传
- 新增拖放文件/图片上传 — 毛玻璃遮罩 + 放置提示
- 新增新建会话时文件粘贴支持
- 新增附件按钮支持拍照/相册/文件三种方式
- 修复复制图片文件被误识别为文档的问题
- 修复新建会话图片预览 — 为 ID 添加 .jpg 扩展名

### 交互式问答
- 恢复 AskUserQuestion step tab 界面 — 修补 SDK deferred tools 机制，该机制自 SDK 0.2.81 起阻止模型调用此工具
- 修复 YOLO 模式下 AskUserQuestion 显示多余的通用权限审核栏（该工具有自己的提交 UI）

### 容器管理
- 新增容器卡片折叠 — 在线状态检测 + 一键重启
- 新增容器资源限制配置（内存/CPU/sudo）
- 新增设备页 CLI 版本远程升级按钮
- 新增容器状态每 15 秒自动刷新
- 新增还原 Token 时自动重建 Docker 容器

### SDK 集成
- 新增 Claude Code SDK 0.2.84 功能 — taskBudget UI + seedReadState + workflowName
- 新增设置 > 关于页面中的 CLI 安装指南

### 权限与 UI
- 修复暗黑模式下白底白字和硬编码颜色问题
- 修复 default 模式下自动批准改为显示权限审核列表
- 新增已批准操作支持还原到待处理
- 新增 requires_action 状态触发 needs_attention 提醒
- 改进配置文件页面布局

## 2.9.0 - 2026-03-26

完整的 Docker 容器生命周期管理：一键创建、HTTPS 反代、网络隔离、AI Profile 环境变量修复。

### Docker 容器管理
- 新增一键创建容器 — 从机器详情页点击即自动创建 Docker 容器并配置 Caddy HTTPS 反代
- 新增 Web Terminal (ttyd) HTTP Basic Auth 密码认证 — 用户名和密码以可复制字段显示
- 新增 Web Terminal 内网地址显示 — HTTPS 链接旁同时显示 LAN 直连地址
- 新增端口自动分配 — Docker + 系统双重扫描，从 7001-7099 找第一个空闲端口
- 新增容器 hostname 与容器名一致 — 设备列表中清晰标识
- 新增非 root 用户 (coder) — 修复 Claude Code 拒绝以 root 运行 `--dangerously-skip-permissions`
- 新增容器重启时自动清理旧 daemon state — 防止 PID 误判导致 daemon 启动失败

### HTTPS 与 Caddy
- 新增按容器自动生成 Caddy 站点文件 (`t-{name}.code.xycloud.info`)
- 新增 `*.code.xycloud.info` 泛域名 TLS 证书 — 新子域名即时可用，无需等待签发
- 新增可复用 `cloudflare_tls` snippet 减少 Caddyfile 重复配置
- 新增动态站点文件通过 Docker Volume 持久化，Caddy 重启后自动恢复
- 新增撤销/删除 Token 时自动清理对应的 Caddy 站点文件

### 安全加固
- 改进容器网络隔离 — 从 `happy_default` 网络移除，无法直连 PostgreSQL/Redis/MinIO
- 改进 API 密钥处理 — 从 Dockerfile 移除硬编码密钥，通过 docker run 或 AI Profile 运行时传入
- 新增 API 配置作为 Provision 页面持久化设置（设一次，所有容器复用）
- 新增 Docker 可用性检测 — 无 Docker 的机器隐藏 Provision Token 入口
- 修复 Docker 容器中 AI Profile 环境变量被错误剥离的问题（daemon 未预设时允许 GUI 覆盖）

### 渲染增强
- 新增 LaTeX 数学公式渲染 — 支持行内 (`$...$`) 和块级 (`$$...$$`) KaTeX 表达式
- 新增表格单元格内数学公式和行内 Markdown 渲染支持

### Provision Token
- 新增已撤销 Token 还原/重新激活功能（带确认弹窗）
- 新增永久删除功能（与撤销分开，带确认弹窗）
- 改进已撤销 Token 显示为独立卡片，包含撤销时间

### RPC 与连接
- 改进机器状态为三色指示（就绪/在线/离线），基于 RPC Handler 注册状态
- 修复 RPC 断连恢复 — App 端自动重试 + CLI/Agent 快速重注册

## 2.8.0 - 2026-03-25

统一网络服务管理、Docker 容器 Provision Token 免扫码认证、Supervisor 分析模式，以及大量 UI 优化。

### 网络服务
- 新增统一网络服务页面，将 Tailscale Serve/Funnel、Caddy HTTPS 反向代理和 UPnP 端口映射整合到一个管理界面
- 新增 Caddy 多域名 HTTPS 支持，通过 DNS-01 验证自动申请 Let's Encrypt 证书
- 新增 UPnP 端口映射管理，显示使用者标签（Tailscale、Happy 等），支持在 App 中添加/删除映射
- 新增 Tailscale Serve/Funnel 管理，支持路径配置和 Funnel 开关
- 改进机器详情页，以摘要入口跳转至完整网络服务页面

### Provision Token
- 新增 Provision Token，Docker 容器无需扫码即可自动认证
- 新增 daemon 自启动和 ttyd Web 终端集成
- 改进 Provision Token 移至机器详情页，绑定到具体设备

### Supervisor
- 新增 analyzed 标签页，独立展示分析完成的 action
- 新增 Supervisor 分析模式、Agent API 模块和会话清理优化

### 后台任务
- 新增前台任务面板，可点击查看进程监控
- 新增 Docker 容器支持，通过 docker inspect 可靠检测容器状态
- 新增长日志行 marquee 滚动效果
- 修复任务去重和过期状态处理

### UI 和质量
- 修复 576+ 处硬编码颜色值破坏主题系统
- 修复多处用户可见的硬编码字符串未使用 i18n
- 修复会话预览的 Dev Servers 列表现在遵循进程隐藏过滤
- 改进活跃会话卡片布局，缩小图标和标题
- 新增会话版本不一致时显示升级提示
- 修复 KV Store 跨设备同步和保存状态指示器

## 2.7.0 - 2026-03-22

新增插件市场、端口检测与 Web 预览、后台任务管理器、收藏命令排序，以及环境变量国际化。

### 插件市场
- 新增插件安装/卸载/启用/禁用及可用插件浏览
- 新增插件详情页，展示已安装插件和市场源
- 新增市场源推荐列表和"添加市场"功能
- 修复插件更新报错、详情弹窗和启用 Switch
- 修复插件 UI 中的硬编码 i18n 字符串和颜色值
- 新增搜索无结果时的空状态提示

### 端口检测与 Web 预览
- 新增多策略端口检测 — lsof/ss/netstat fallback + Docker + curl 探测
- 新增 Web/非 Web 端口区分，支持并行 curl 检测
- 新增通过 ps 命令丰富进程名 — 把 node 变成 next dev、vite 等
- 新增 Dev Server 关联预览与统一任务关闭交互
- 新增端口列表每 10 秒自动静默刷新
- 新增自定义 URL 和刷新移至顶部 + 进程名智能提取
- 新增端口列表标签块(chip)布局
- 新增端口检测分步进度提示
- 修复端口重复显示 + 大小写不敏感进程名匹配
- 修复预览截图路径权限被拒绝问题
- 修复严格 HTTP 检测 — 只有首行匹配 HTTP/ 才标记为 Web

### 后台任务管理
- 新增后台进程管理器 — 全局查看/kill/预览 Web 服务
- 新增后台任务面板 UI，智能标签、日志查看、停止与状态同步
- 新增后台任务元数据传递与 Hooks
- 新增按项目 CWD 过滤端口 — 只显示当前工作目录的服务

### 收藏命令
- 新增收藏命令排序，在命令列表中使用上下箭头调整顺序
- 修复收藏命令只显示当前会话支持的命令
- 新增命令列表显示描述和收藏按钮短名称

### 其他改进
- 新增环境变量卡片国际化，支持中文显示
- 修复会话列表设备名称跟随 displayName 实时更新
- 更新 MiniMax profile 模型版本 M2.5 → M2.7，超时改为 50 分钟
- 修复项目 Git 信息不显示和 theme 类型错误
- 隐藏设置页 Claude Code 连接项
- 移除生产代码中的 console.log 调试日志
- 修复 Loading indicator 样式不一致

## 2.6.0 - 2026-03-22

新增 Plugins 管理、文件回退、子 Agent 进度展示、fix session 自动恢复、折叠屏键盘修复，以及大量代码质量改进。

### Plugins
- 新增 Plugins 设置页 — 手动添加或从 CLI 自动发现 MCP 插件
- CLI 启动会话时自动加载已配置的 Plugins 到 SDK

### 文件回退
- 新增消息级别的文件回退按钮，支持撤销单条消息的文件变更

### 子 Agent 进度
- 新增子 Agent 进度摘要展示，包含耗时、Token 数和工具使用指标
- 修复 task-progress 事件无 usage 数据时的崩溃

### Fix Session 恢复
- 新增 fix session 异常退出后的自动状态检测
- 新增 Server 端 stale fix watchdog（5 分钟心跳检查）
- 新增修复中操作的手动「标记完成/失败」按钮

### Supervisor
- 新增操作列表按时间排序并显示状态变更时间
- 新增操作 Tab 与健康 Tab 数据实时同步
- 新增每次分析最大发现数配置 UI
- 改进 fixStatus 判断从 Server 移到 App 端

### 折叠屏与响应式
- 修复 Web 端折叠屏展开后键盘弹出立即消失
- 修复 Web 分屏/折叠屏时响应式布局不实时切换

### 代码质量
- 修复 50+ 处硬编码颜色为主题令牌
- 为 54 个页面组件添加 React.memo 包装
- 修复 20+ 处硬编码字符串为 i18n 翻译
- 修复 AppState 事件监听器未清理的内存泄漏
- 移除生产代码中的 console.log 语句
- 改进多处组件的错误处理和无障碍标签

## 2.5.0 - 2026-03-20

改进会话管理（活跃/归档分组和恢复功能）、输入栏新增文件浏览器及 @reference、Git 标签页分支切换、健康分析日期范围选择器，以及多语言 Changelog 支持。

### 会话管理
- 新增活跃/归档会话分组，带分区标题和操作按钮
- 新增会话恢复 API，支持重新激活已归档会话
- 新增归档分组顶部的"删除归档会话"按钮

### 文件浏览器与 Git
- 新增输入栏文件浏览器按钮，支持 @reference 插入文件路径
- 新增项目 Git 标签页分支切换弹窗，支持本地/远程分支
- 修复文件浏览器显示隐藏文件（.claude/、.github/、.gitignore 等）

### 健康分析
- 新增日期范围选择器（3天/7天/14天/30天），适用于成本和趋势图
- 修复成本计算遗漏失败/已取消的运行
- 降低趋势 API 最小天数从 7 天到 1 天，支持 3 天视图

### AI 建议
- 新增首个 AI 建议选项的推荐徽章和闪光图标
- 新增推荐选项边框的彗星闪烁动画

### 国际化
- 新增多语言 Changelog 支持，自动发现语言文件
- 新增全部版本的简体中文 Changelog 翻译
- Changelog 页面现在按用户语言显示，英文作为 fallback

### 清理
- 移除健康标签页中未使用的批量审批和操作卡片

## 2.4.0 - 2026-03-20

新增 Supervisor 循环模式（自动分析-修复-再分析循环）、项目配置标签页、Research 标签页重新设计，以及大量 Supervisor 和界面改进。

### Supervisor 循环模式
- 新增循环模式 — 自动分析代码、应用修复、再次分析，直到问题解决
- 新增循环配置面板，支持步进器控制最大迭代次数和并发数
- 新增循环详情页，时间轴视图展示每个周期的操作和结果
- 新增健康标签页中的循环历史记录
- 新增半自动和自动 Supervisor 模式的可配置严重级别
- 新增基于 AI 响应内容的智能 needsAttention 检测

### 项目配置标签页
- 新增项目配置标签页及基础设置
- 新增项目别名 — 自定义显示名称覆盖默认文件夹名
- 新增按项目设置新会话的默认模型
- 新增归档/取消归档项目开关
- 新增只读项目信息展示（路径、设备、创建日期）

### Research 标签页重设计
- 重新设计 Research 标签页，统一配置面板和弹窗式报告查看器
- 新增自定义分析规则支持
- 新增通过 KV Store 的多设备配置同步
- 新增研究进度 UI 及加载指示器

### Supervisor 增强
- 新增分析和修复会话的并发限制
- 改进 Supervisor 操作的排序、筛选和严重级别显示
- 新增 Supervisor 操作恢复功能
- 新增 Supervisor 操作按钮加载指示器

### 界面改进
- 将 Profile 选择器从输入栏移至输入框上方的下拉菜单
- 更新 Claude 模型定价 — 200K 和 1M 上下文价格相同
- 新增模型名称显示版本号
- 新增 UI/UX 维度的 Supervisor 健康监控

### 项目管理
- 新增创建新会话时自动创建项目
- 新增手动添加/删除项目支持

### Bug 修复
- 修复新建会话默认路径将 worktree 解析到父仓库
- 修复多处硬编码英文字符串缺少 i18n
- 修复模型选择器 UI 和状态栏模型显示
- 修复 IssueFilterBar/PRFilterBar 使用 Alert 模块而非 Modal
- 修复切换 Agent 时新会话的缓存 daemon 模型未重置
- 隔离健康/研究标签页运行，防止交叉污染

## 2.3.1 - 2026-03-18

升级 Claude Agent SDK 至 0.2.78 — 新增 StopFailure 错误横幅，改进 hook 服务器可靠性。

### StopFailure Hook
- 新增 StopFailure 错误横幅，显示 Claude 会话意外停止时的错误详情
- 新增可展开的最后一条助手消息，用于调试上下文
- 新增本地关闭及新错误时自动重置
- 新增回合开始时自动清除 stopFailure 状态

### 可靠性
- 修复 HTTP hook 服务器超时导致 Node.js 双写异常（用 AbortController 替换 setTimeout）
- 新增会话 hook 转发脚本的端口范围校验

## 2.3.0 - 2026-03-18

集成 Claude Agent SDK 0.2.77 功能 — 会话分叉、取消排队消息、MCP 服务器输入、API 重试状态和增强的计划查看。

### 会话分叉
- 新增会话信息中的分叉按钮，从当前上下文创建分支
- 新增完整分叉流程：CLI 创建 SDK 分叉，App 生成新会话并跳转

### 取消排队消息
- 新增排队消息的取消按钮，在执行前移除
- 改进取消流程，先确认服务端取消后再更新 UI

### MCP 询问
- 新增 MCP 服务器输入横幅，处理认证和配置请求
- 新增表单模式，支持 JSON Schema 字段渲染的结构化输入
- 新增 URL 模式，带协议验证的链接打开
- 新增 MCP 服务器请求用户输入时的推送通知

### API 重试状态
- 新增实时 API 重试指示器，显示尝试次数、最大重试数和延迟
- 新增请求成功时自动清除重试状态

### 计划文件查看
- 改进 ExitPlanMode，从文件显示完整计划内容并支持刷新
- 新增防竞态条件的计划文件读取，带内存内容回退

### 安全与可靠性
- 新增询问操作验证和中止清理，防止内存泄漏
- 新增 URL 协议验证，仅允许 http/https
- 新增数字询问输入的 NaN 防护
- 限制 Supervisor 操作删除仅限已关闭状态
- 批量 Supervisor 操作去重写入，减少数据库往返

## 2.2.0 - 2026-03-14

新增完整的 Pull Request 管理，实现移动端 AI DevOps 工作流 — 在手机上浏览 PR、审查 diff、检查 CI 状态并合并。

### PR 列表与导航
- 新增 Git 区域的 PR 标签页，徽章显示开放 PR 数量
- 新增 PR 卡片，包含状态图标、分支信息、diff 统计、标签和草稿徽章
- 新增筛选栏，支持 Open/Closed/All 状态和排序选项
- 新增无限滚动分页和 60 秒自动轮询
- 新增多仓库 PR 聚合

### PR 详情与 Diff 审查
- 新增 PR 详情面板，包含完整元数据、分支信息和描述
- 新增统一 diff 补丁查看器，用于审查文件变更
- 新增可折叠的已更改文件区域，支持逐文件 diff 渲染
- 新增 CI 检查详情视图，显示各检查运行状态
- 新增评审区域，包含作者、状态徽章和评审内容
- 新增评论区域，包含完整评论历史

### PR 操作
- 新增合并功能，支持合并方式选择（合并提交、压缩合并、变基合并）
- 新增批准和关闭 PR 操作
- 新增文本输入评论发布
- 新增在浏览器中打开操作

### 平台支持
- 支持 GitHub（通过 `gh api` CLI）
- 支持 Gitea（通过 REST API token 认证）
- 新增全部 10 种语言的 i18n 翻译

## 2.1.2 - 2026-03-14

新增 AI 建议选项的复制到输入按钮，允许用户在发送前编辑建议。

- 新增 AI 建议选项上的复制到输入图标，将文本追加到输入框供编辑
- 新增选项弹出框和书签弹出框中的复制到输入图标

## 2.1.1 - 2026-03-13

修复消息加载、使用量图表、会话管理和 CLI 思考状态的 Bug。更新 README 添加 fork 声明。

- 修复切换会话时分页和回填导致的消息丢失
- 改进使用趋势图表，补填缺失日期并优化布局
- 修复本地模式下 CLI 思考状态准确性，正确反映模型状态
- 修复服务器拒绝已归档会话的心跳，防止幽灵连接
- 更新 README，移除上游品牌标识并添加 fork 声明
- 修复可折叠输入的折叠按钮因闭包过期无响应

## 2.1.0 - 2026-03-09

GitHub/Gitea Issue 管理、平板侧边栏、动画 AI 头像，以及会话加载性能大幅优化。

### Issue 集成
- 新增 GitHub 和 Gitea Issue 集成及 Git Hosts 设置
- 新增多仓库 Issue 聚合和详情面板
- 新增 Issue 会话自动化，支持 CRUD 管理和完成生命周期
- 新增会话列表中的 Issue 标签展示，支持可点击链接和 URL 预览
- 修复 Issue 会话完成竞态条件和 PR 合并状态检查
- 修复逗号分隔的标签和作者在自动 Issue 配置中的问题
- 修复 Issue 有开放 PR 时阻止归档/删除

### 平板与布局
- 新增平板端可折叠侧边栏及图标导航栏
- 新增可折叠内屏检测为平板以启用侧边栏布局
- 修复分屏模式未从平板切换到手机布局
- 改进 SidebarNavigator 和 SidebarView 组件

### 界面体验
- 用动画状态点替换 AI 头像，改进 AskUserQuestion UI
- 新增 Claude Code 风格的回合指标，带动画 token 展示
- 新增 FAB 操作按钮，支持禁用状态和脉冲动画
- 新增展开工具设置，用于详细工具视图
- 增强计划模式反馈，支持多行输入和图片
- 增强看板 UI，添加药丸选择器和界面打磨
- 新增设置中的项目标签页功能开关

### 性能
- 优化会话消息加载，使用本地缓存和渐进式渲染

### 认证与设置
- 新增密钥登录选项，退出后导航至登录页
- 移除设置页面中的 Happy Logo

### CLI
- 升级 CLI 至 v0.29.36
- 修复计划模式权限处理（ExitPlanMode 需要手动批准）
- 修复无活跃查询时的中断回退

## 2.0.3 - 2026-03-05

修复间歇性图片上传失败。

- 修复多图上传失败，通过串行化上传避免并发大文件传输超时

## 2.0.2 - 2026-03-01

语音交互大幅升级、Worktree 支持、工具分组紧凑模式，以及会话管理和界面的重大改进。

### 语音助手
- 新增完整语音管线：Edge TTS 语音合成、Web VAD 活动检测、状态动画
- 新增 WebSocket 实时语音转文本服务
- 新增 Haiku 模型智能 STT 纠错，提升识别准确率
- 修复移动端 Web 中文转录问题
- 降低语音交互延迟，支持 TTS 打断
- 移除 Claude Code 完成后多余的"Done"语音提示

### Worktree
- 新增 Worktree 检测和会话元数据支持
- 将 Worktree 会话类型移出实验性功能
- 新增 9 种语言的 i18n 翻译
- 修复合并冲突自动中止、命令注入漏洞和生命周期管理

### 工具与权限
- 新增工具分组显示及紧凑模式
- 新增工具组内自动批准权限（TodoWrite 除外）
- 移除未知工具的审查按钮
- 新增 dontAsk 权限模式和 opusplan 模型支持

### 会话管理
- 新增会话列表中的左滑归档和左滑删除
- 新增会话偏好（权限模式、模型模式）同步到服务器
- 新增会话 Profile 跟踪和持久化
- 注册远程模式的 getCompactionSummary RPC
- 新增实时会话排序开关

### 界面体验
- 改进代码块交互和工具描述显示
- 新增 Task 工具卡片的 Agent 类型、实时副标题和 Copilot 图标
- 新增 Modal.toast 自动消失通知
- 新增窄屏下工具栏自动换行
- 新增使用量面板宽度约束

### CLI
- 修复 Shell 命令结果不在 App 中显示
- 新增 App 语言偏好转发到 Claude 系统提示
- 升级 SDK 至 0.2.62
- 升级 CLI 至 v0.29.27

### 安全
- 修补 22 个 Dependabot 安全漏洞

## 2.0.1 - 2026-02-27

修复会话恢复时复用同一 Happy 会话而非创建新会话，保留消息历史和会话标识。

- 修复恢复后会话元数据显示为 unknown，通过检测加密密钥变更重新初始化加密器
- 修复恢复后会话标题回退到项目名称，在元数据更新时保留 summary 字段
- 新增会话恢复 V2 支持 — 恢复现在重新连接到同一会话而非创建新会话

## 2.0.0 - 2026-02-27

Happy Coder 2.0 — 基于上游 Happy Coder 深度定制的移动端 AI 开发助手，支持端到端加密远程控制 Claude Code 和 Codex。

- 新增从手机远程控制 Claude Code 和 Codex，随时随地进行 AI 编程
- 新增端到端加密（AES-256-GCM / NaCl secretbox），完全保护会话内容隐私
- 新增二维码扫描和手动 URL 输入，快速设备认证
- 新增 Daemon 后台常驻模式，一键启动远程会话
- 新增智能语音助手，支持 15+ 种语言自然对话
- 新增 GitHub 和 Claude 账户连接，统一开发者身份管理
- 新增多设备实时同步，在线/离线状态指示
- 新增深色模式和外观自定义，自动跟随系统主题
- 新增聊天中的 Markdown 表格渲染和代码语法高亮
- 精简设置页面，移除上游链接，开始维护自有更新日志
- 支持 iOS、Android 和 Web 平台
