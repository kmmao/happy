export const meta = {
  name: 'claude-integration-gap',
  description: '盘点 happy-cli 对 Claude Code 的已集成能力，对比上游 Claude Code / Agent SDK，输出待集成功能差距报告',
  phases: [
    { title: 'Inventory', detail: '并行读 happy-cli/src/claude 代码 + docs，盘点已集成能力' },
    { title: 'Upstream', detail: '并行查 Claude Code CLI / Agent SDK / API 官方能力全集' },
    { title: 'Synthesize', detail: '对比现状 vs 上游，产出差距报告' },
  ],
}

const INVENTORY_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          status: { type: 'string', enum: ['integrated', 'partial'] },
          evidence: { type: 'string', description: 'file:line 或文件路径' },
          notes: { type: 'string' },
        },
        required: ['name', 'status', 'evidence'],
      },
    },
  },
  required: ['area', 'capabilities'],
}

const UPSTREAM_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          maturity: { type: 'string', description: 'stable / beta / preview 等' },
          docRef: { type: 'string', description: '文档链接或来源' },
        },
        required: ['name', 'category', 'description'],
      },
    },
  },
  required: ['source', 'capabilities'],
}

const GAP_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          category: { type: 'string' },
          currentStatus: { type: 'string', enum: ['missing', 'partial'] },
          description: { type: 'string', description: '中文：这个能力是什么、上游怎么用、本项目缺什么' },
          value: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          recommendation: { type: 'string', description: '中文：建议如何在本项目集成，涉及哪些文件/包' },
          evidence: { type: 'string' },
        },
        required: ['feature', 'category', 'currentStatus', 'description', 'value', 'effort', 'recommendation'],
      },
    },
    alreadyIntegrated: { type: 'array', items: { type: 'string' }, description: '已确认集成的能力名称列表' },
    summary: { type: 'string', description: '中文整体结论，3-6 句' },
  },
  required: ['gaps', 'alreadyIntegrated', 'summary'],
}

const REPO = 'happy-cli (packages/happy-cli)，对 Claude Code 的集成全部在 packages/happy-cli/src/claude/ 下，相关文档在 docs/。这是基于 slopus/happy 的 fork。本项目已从 @anthropic-ai/claude-agent-sdk 迁移到 PTY 方式控制本地 claude CLI 进程。'

const INVENTORY_DIMS = [
  {
    key: 'runtime',
    label: 'inv:runtime-launch',
    prompt: `你是代码盘点员。${REPO}\n盘点【Claude 进程启动与 PTY 运行时】维度已集成的能力。重点文件：packages/happy-cli/src/claude/pty/(claudePtyController/Runtime/Router/ReverseServer/DaemonBridge/claudeCliFlags)、runClaude.ts、claudeLocal.ts、claudeLocalLauncher.ts、claudeRemote.ts、claudeRemoteLauncher*.ts、loop.ts。\n用 codegraph_context / codegraph_explore 和 Read 高效阅读。列出每个能力：名称、status(integrated/partial)、evidence(file:line)、notes。area 填 "runtime-launch"。`,
  },
  {
    key: 'control',
    label: 'inv:rpc-protocol',
    prompt: `你是代码盘点员。${REPO}\n盘点【RPC 控制与 session 协议】维度已集成的能力（远程控制 claude：发消息、中断、切模型、切 permission mode、读 session store、context 详情等）。重点文件：packages/happy-cli/src/claude/rpc/(claudeControlHandlers/sessionStoreRpc)、session.ts、sessionEventReporter.ts、contextDetailRpc.ts、registerKillSessionHandler.ts、utils/sessionProtocolMapper.ts、utils/sessionScanner.ts、utils/claudeFindLastSession.ts、utils/claudeCheckSession.ts。也看 docs/session-protocol-claude.md。\n列出能力：名称、status、evidence、notes。area 填 "rpc-control-protocol"。`,
  },
  {
    key: 'settings',
    label: 'inv:settings-hooks-perms-mcp',
    prompt: `你是代码盘点员。${REPO}\n盘点【settings / hooks / permissions / MCP】维度已集成的能力。重点文件：packages/happy-cli/src/claude/utils/(generateHookSettings、claudeSettings、settingsParser、applyFlagSettings、flagSettingsPatch、permissionHandler、permissionMode、disallowedTools、mergeExitPlanAutoApproveIntoSettings、mergeThinkingIntoSettings、mcpServerManager、mcpRegistryReader、mcpStatusProbe、startHookServer、startHappyServer、systemPrompt、localeInstruction)。\n关注：hooks 注入了哪些事件、支持哪些 permission mode（含 plan/yolo）、MCP server 如何注册与探测、thinking 如何透传、自定义 system prompt。列出能力：名称、status、evidence、notes。area 填 "settings-hooks-permissions-mcp"。`,
  },
  {
    key: 'messages',
    label: 'inv:messages-jsonl-thinking',
    prompt: `你是代码盘点员。${REPO}\n盘点【消息解析 / jsonl / thinking / streaming / subagent】维度已集成的能力。重点文件：packages/happy-cli/src/claude/jsonl/(index/jsonlMessageTypes/types/prompts)、pty/rawToJsonlMessage.ts、utils/(incrementalJsonlReader、jsonlToLogConverter、streamEventMapper、thinkingTracker、subagentJsonlReader、getToolDescriptor、getToolName)、ui/messageFormatter*.ts。\n关注：支持解析哪些消息类型/工具结果、thinking/extended thinking 处理、subagent(Task) 输出、流式事件映射、是否支持图片/非文本 tool_result。列出能力：名称、status、evidence、notes。area 填 "messages-jsonl-thinking-streaming"。`,
  },
  {
    key: 'docs',
    label: 'inv:docs-tracking',
    prompt: `你是文档盘点员。${REPO}\n阅读这些文档，提炼"本项目已经声明集成/支持的 Claude 能力"以及"已记录但尚未做的待办/已知缺口"：docs/sdk-features.md、docs/sdk-vs-spawn.md、docs/sdk-upgrade-checklist.md、docs/session-protocol-claude.md、docs/cli-architecture.md、docs/UPSTREAM_TRACKING.md、packages/happy-cli/CLAUDE.md。\n对每条能力：name、status(integrated 表示文档称已支持；partial 表示文档提到部分/待办)、evidence(文档路径)、notes(若是待办或缺口，在 notes 注明 "TODO/缺口")。area 填 "docs-declared"。`,
  },
]

const UPSTREAM_DIMS = [
  {
    key: 'cli-features',
    label: 'up:claude-code-cli',
    prompt: `你是 Claude Code 上游能力调研员。当前是 2026 年 6 月，你的知识截止 2026 年 1 月，必须用 context7（解析 "Claude Code" 文档库）+ WebSearch/WebFetch 抓 docs.anthropic.com / docs.claude.com 的 Claude Code 文档，列出 Claude Code CLI（官方命令行工具）当前【完整的可集成能力清单】。务必覆盖：hooks（全部事件类型）、slash commands、subagents、plan mode、checkpointing/rewind、output styles、status line、background tasks/Bash、memory(CLAUDE.md imports)、@-mentions、MCP（含 plugins、ToolSearch）、permission modes、settings.json 结构、thinking/effort、context compaction/microcompact、/resume & session continuation、sandbox、skills、scheduled tasks、IDE/SDK 集成点等。\n每条：name、category、description、maturity、docRef(链接)。source 填 "claude-code-cli"。只列上游真实存在的能力，不要臆造。`,
  },
  {
    key: 'agent-sdk',
    label: 'up:claude-agent-sdk',
    prompt: `你是 Claude Agent SDK 调研员。当前 2026 年 6 月，知识截止 2026 年 1 月，必须用 context7（解析 "Claude Agent SDK" / "claude-agent-sdk" 文档库）+ WebSearch/WebFetch docs.anthropic.com 的 Agent SDK 文档，列出 @anthropic-ai/claude-agent-sdk 的【完整能力清单】：query() options、canUseTool/permission callback、hooks、in-process & external MCP servers、custom agents/agent definitions、settingSources、structured/JSON output、streaming input、session forking/resume、partial messages、systemPrompt presets、includePartialMessages、模型选择与 thinking 等。\n每条：name、category、description、maturity、docRef。source 填 "claude-agent-sdk"。`,
  },
  {
    key: 'recent',
    label: 'up:recent-changelog',
    prompt: `你是 Claude Code 最新动态调研员。当前 2026 年 6 月。用 WebSearch/WebFetch 查 Claude Code 的 CHANGELOG / release notes / 官方 blog（github.com/anthropics/claude-code 的 CHANGELOG.md、docs.anthropic.com 更新），找出 2025 年底到 2026 年中【新增或重大更新的功能】，特别是可能尚未被第三方客户端集成的新能力（如新的 hook 事件、新 slash 能力、checkpoint、新 MCP 能力、新 thinking/effort 控制、新 model 等）。\n每条：name、category、description(注明大致发布时间)、maturity、docRef。source 填 "claude-code-recent"。`,
  },
  {
    key: 'api-wrap',
    label: 'up:api-model-features',
    prompt: `你是 Claude API/模型能力调研员，聚焦"能通过 CLI 透传、值得移动客户端暴露"的特性。当前 2026 年 6 月。用 context7（"Anthropic SDK" / "Claude API"）+ WebSearch docs.claude.com，列出与包装 Claude Code 客户端相关的模型/API 能力：可用模型(Opus 4.8/4.7/4.6、Sonnet 4.6、Haiku 4.5 及其 ID)、extended thinking 与 effort/budget 参数、1M context、prompt caching、interleaved thinking、context editing/memory tool、fast mode、vision/图片输入等——重点是这些能力在 Claude Code CLI 层面如何被选择/透传（model 选择、thinking 开关等）。\n每条：name、category、description、maturity、docRef。source 填 "claude-api-model"。`,
  },
]

phase('Inventory')
log('启动盘点（5 维代码/文档）+ 上游调研（4 维官方能力）并发...')

const tasks = [
  ...INVENTORY_DIMS.map((d) => () =>
    agent(d.prompt, { label: d.label, phase: 'Inventory', schema: INVENTORY_SCHEMA })
      .then((r) => ({ kind: 'inventory', key: d.key, r })),
  ),
  ...UPSTREAM_DIMS.map((d) => () =>
    agent(d.prompt, { label: d.label, phase: 'Upstream', schema: UPSTREAM_SCHEMA })
      .then((r) => ({ kind: 'upstream', key: d.key, r })),
  ),
]

const all = (await parallel(tasks)).filter(Boolean)
const inventory = all.filter((x) => x.kind === 'inventory').map((x) => x.r)
const upstream = all.filter((x) => x.kind === 'upstream').map((x) => x.r)

log(`盘点完成：现状 ${inventory.length} 组、上游 ${upstream.length} 组。开始差距综合...`)

phase('Synthesize')
const gap = await agent(
  `你是首席架构分析师。下面是【本项目已集成能力清单】(inventory) 和【上游 Claude Code / Agent SDK / API 能力清单】(upstream)。\n` +
    `任务：找出本项目"针对 Claude 还需要集成/补全的功能"。逐条对比上游能力是否已在 inventory 中出现：\n` +
    `- 上游有、inventory 完全没有 → gap，currentStatus="missing"\n` +
    `- 上游有、inventory 只是部分支持(status=partial 或 notes 标了 TODO/缺口) → gap，currentStatus="partial"\n` +
    `- 已充分集成的能力 → 放进 alreadyIntegrated（只列名称）\n` +
    `为每个 gap 评估 value(high/medium/low：对移动端远程控制 Claude 的价值) 与 effort(small/medium/large)，并给中文 recommendation（指出大概涉及 packages/happy-cli/src/claude 下哪些文件或哪个包 wire/app）。\n` +
    `注意本项目是 PTY 包装本地 claude CLI，不是用 Agent SDK，所以判断"能否集成"时要考虑这点（有些 SDK-only 能力可能不适用，可标 low 并在 recommendation 说明）。如需确认本项目某能力到底有没有，可用 codegraph/Read 查 packages/happy-cli/src/claude。\n` +
    `summary 用中文给整体结论。\n\n` +
    `=== INVENTORY ===\n${JSON.stringify(inventory)}\n\n=== UPSTREAM ===\n${JSON.stringify(upstream)}`,
  { label: 'synthesize:gap-report', phase: 'Synthesize', schema: GAP_SCHEMA },
)

return { gap, inventoryGroups: inventory.length, upstreamGroups: upstream.length }
