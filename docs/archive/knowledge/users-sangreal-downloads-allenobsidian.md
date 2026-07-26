# /Users/sangreal/Downloads/allenObsidian

归档自 ProjectKnowledge，共 3 条 active 条目。


## Repo Map: allenObsidian

*repo_map · high · 2026-05-16*

## Project Structure (500 tracked files)

.obsidian/ (122 files, json/css/js)
  └─ plugins/(87), themes/(14)
config/ (13 files, md)
dayNote/ (83 files, md)
Excalidraw/ (3 files, md/svg)
  └─ Scripts/(2)
life/ (36 files, md/png)
  └─ furturs/(19), synology/(4)
Secrets/ (1 files, md)
textgenerator/ (165 files, md)
  └─ templates/(165)
tp/ (3 files, md)
Wiki/ (48 files, md)
  └─ entities/(20), sources/(19), concepts/(3), topics/(3), syntheses/(1)
Yggdrassil/ (12 files, md)
[root] ai中转源.md, 研究内容.md, ElevenLabs 语音功能配置指南.md, 2026年独立开发内容.md, .DS_Store, dashboard.md, oLMX.md, homemac上用到的ai配合库.md, H外部设备安装.md, note.md


## Wiki健康检查与oMLX/Context Lens/Dify工具集成完成

*fix · high · 2026-05-22*

完成了Obsidian Wiki（48个markdown文件）的全量健康检查和清理，以及三个新开源工具的知识摄取集成。

【Wiki维护工作】
清理log.md中4组重复条目（保留最完整版本），修复Ollama→oMLX过时引用（10+文件20+处），删除孤儿文件，校正source_count（9个文件），修复frontmatter重复updated行。清理策略为从文件底部往上处理以避免行号偏移。Linter已自动清理3组重复（openclaude、archify、macmini query），仅需手动合并1组（oMLX + Context Lens + Dify条目）。Wiki结构包括：entities/(20)、sources/(19)、concepts/(3)、topics/(3)、syntheses/(1)。

【新工具摄取内容】
(1) oMLX：macOS原生MLX推理服务器，核心创新是SSD分页KV缓存机制，解决编程Agent场景中上下文切换导致的缓存失效问题，第二轮TTFT从30-90s优化至<5s，直接兼容Claude Code和OpenClaw。

(2) Context Lens：LLM上下文窗口可视化代理，通过本地透明代理拦截API流量，展示上下文组成（系统提示/工具定义/工具结果/思考块）和成本追踪，与CTOP互补。

(3) Dify：开源LLM应用开发平台，整合可视化Workflow、RAG、Agent（50+工具）和LLMOps，定位为"为他人构建应用"，区别于Multica的"协调自己Agent"。

摄取流程包括：检查未摄取文件→并行读取→批量写入实体页→更新索引和日志→补充Entities和Topics条目。已更新personal-ai-agent-frameworks架构图为四层，添加了LLM应用开发平台层。


## Repo Map: allenObsidian

*repo_map · high · 2026-05-24*

## Project Structure (500 tracked files)

.obsidian/ (122 files, json/css/js)
  └─ plugins/(87), themes/(14)
config/ (13 files, md)
dayNote/ (83 files, md)
Excalidraw/ (3 files, md/svg)
  └─ Scripts/(2)
life/ (22 files, md/png)
  └─ furturs/(5), synology/(4)
Secrets/ (1 files, md)
textgenerator/ (165 files, md)
  └─ templates/(165)
tp/ (3 files, md)
Wiki/ (62 files, md)
  └─ entities/(24), sources/(23), concepts/(6), syntheses/(4), topics/(3)
Yggdrassil/ (12 files, md)
[root] ai中转源.md, 研究内容.md, ElevenLabs 语音功能配置指南.md, 2026年独立开发内容.md, .DS_Store, dashboard.md, oLMX.md, homemac上用到的ai配合库.md, H外部设备安装.md, note.md
