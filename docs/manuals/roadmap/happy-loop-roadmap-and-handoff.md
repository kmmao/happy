# Happy 自主 Loop Roadmap 与交接说明

这份文档用于回答三个问题：

- 现在已经做到了什么
- 明确还没有做什么
- 下一阶段最值得做什么

适合：

- 后续继续开发的人
- 需要判断当前系统边界的人
- 想避免重复造轮子的人

---

## 1. 当前已经完成的核心能力

## 1.1 Agent Loop runtime

已经具备：

- daemon 内统一承载的 `agent_loop` runtime
- durable loop 存储
- scheduler 驱动的周期运行
- 事件驱动唤醒
- guardian continuity / automation plane 集成
- loop phase / runtimeState 状态管理
- recent events / audit 追踪

这意味着：

- Happy 已经不是只有“自动任务”
- 而是有了真正的自主 loop substrate

---

## 1.2 Loop 长期连续性

已经具备：

- `memory.md`
- `context.md`
- brief 产物
- terminal 后 memory resync
- 当前 focus / reflection / working memory 持续保存

这意味着：

- loop 具备跨轮次连续性
- 不再是每次完全重新开始的 stateless 自动执行

---

## 1.3 事件驱动与桥接

已经具备：

- 手动事件注入
- file watch 唤醒
- CI bridge
- GitHub Actions webhook bridge
- 下游 loop fan-out

这意味着：

- loop 不只是定时轮询
- 而是可以被环境变化真正唤醒

---

## 1.4 策略控制与边界

已经具备：

- `cooldown`
- `quiet hours`
- `max auto runs per day`
- `max failures`
- `retry backoff`
- `max iterations`
- `stop on success`
- `stopReason` / `blockedReason`

这意味着：

- loop 已经有“运营边界”
- 不再是只能无限运行或完全手停

---

## 1.5 产品化操作面

已经具备：

- CLI CRUD / run / pause / resume / event / suggest / bootstrap / brief / memory / context
- `Machine -> Loops` 页面
- `Machine -> Automation` 页面
- loop rollup 汇总
- 审计、guardian、jobs 可观测
- 文件 viewer（brief / memory / context / dream report）

这意味着：

- 这套系统已经可以被真实操作者使用
- 不再只是底层能力库

---

## 1.6 Auto-Dream

已经具备：

- Auto-Dream profile
- 扫描 loop memory
- 生成 dream report
- CLI / UI 管理面

这意味着：

- 系统已经有“高层记忆整理层”
- 不是只依赖单个 loop 的局部记忆

---

## 2. 明确还没有做的事情

下面这些是**明确未完成**，而且应该被视为下一阶段或更后阶段，不应误判为已经具备。

## 2.1 广义自我升级 / 自我改造

当前没有做：

- loop 自主升级 daemon 本身
- loop 自主改写自身 runtime 规则
- 自主自举出第二套自治守护系统

原因：

- 风险太高
- 证据链不够强
- 运营边界不清晰

这部分不应该默认开启。

---

## 2.2 更深的 daemon 恢复硬化

当前还没有做到非常深的恢复覆盖，例如：

- 更复杂的 tmux PID migration recovery
- 更强的异常会话恢复证据模型
- 更激进的未知 session 恢复

当前恢复策略是偏保守的，这属于有意设计。

---

## 2.3 更高级的多层工作流图

当前已具备：

- upstream / downstream 基本 fan-out

但还没有做到：

- 更复杂 DAG 式工作流图
- 多阶段条件路由
- 更强的任务编排 DSL

也就是说：

- 现在已经能编排
- 但还没到复杂 workflow engine 的程度

---

## 2.4 云端对象化 / 跨设备同步的 loop 定义

当前 loop 主要还是 daemon-local 运营对象。

还没有做：

- 服务端对象化
- 多端统一定义同步
- 云端中心化治理

这属于产品方向决策问题，不是简单的工程遗漏。

---

## 3. 现在最值得继续做的方向

如果后续要继续推进，最值得做的不是重写，而是沿着现有平台继续增强。

## 3.1 恢复与可靠性硬化

优先级：高

建议继续做：

- 更强的 daemon 恢复测试
- 更深的 guardian / session 恢复证据模型
- 针对长运行会话的可靠性验证

原因：

- 当前系统已经可用
- 下一步最值钱的是可靠性，而不是更多表面功能

---

## 3.2 策略智能化

优先级：高

建议继续做：

- 更丰富 stop conditions
- 更细粒度预算模型
- 资源预算 / 时间预算 / 频率预算
- 更智能的 policy 建议

原因：

- 当前已有基础策略框架
- 加强这一层能显著提升“终局感”

---

## 3.3 更好的跨 loop 运营视图

优先级：中高

建议继续做：

- 项目级 rollup
- workspace 级 rollup
- loop 集群健康视图
- 更细的筛选与 drill-down

原因：

- 当前已经有 machine 级 automation 页面
- 下一步是更高层聚合视图

---

## 3.4 Prompt / memory 质量运营

优先级：中高

建议继续做：

- 针对低质量 memory 的识别
- 针对空转 brief 的识别
- 自动建议收紧 prompt / focus / bounds

原因：

- 未来系统质量的上限，很大程度取决于 loop memory 的质量

---

## 3.5 更好的模板与策略推荐

优先级：中

建议继续做：

- 基于 repo 类型的模板建议
- 基于 loop 表现的参数建议
- 自动建议是否启用 `max-iterations` / `stop-on-success`

原因：

- 这会让系统从“能配置”升级为“更会配置”

---

## 4. 不建议做的方向

以下方向短期内不建议优先推进：

### 不建议 1：重造第二套 autonomy daemon

原因：

- 现在已经有 shared automation plane
- 再造一套只会造成双轨混乱

### 不建议 2：以 Claude Code feature parity 为目标

原因：

- 目标应该是 Happy 自己的产品闭环
- 不是对齐别人的所有实现细节

### 不建议 3：没有边界的自我改造

原因：

- 风险和运营复杂度过高
- 很容易把“自主”做成“不可控”

---

## 5. 后续开发的推荐优先级

如果下一阶段要排优先级，建议顺序是：

1. 恢复与可靠性硬化
2. 策略智能化与预算模型
3. 更高层 rollup / dashboard
4. memory / brief 质量运营
5. 模板与策略推荐增强
6. 更复杂 workflow graph
7. 云端对象化（如果产品方向确定）

---

## 6. 交接给后续开发者时最重要的几点

如果只交代最重要的事，应该是这几条：

### 1. Happy 已经有真实自主 loop runtime

不要把它误认为只是一些自动任务拼起来的假系统。

### 2. 当前正确方向是增强，不是重写

重点应该是：

- hardening
- policy
- operations
- observability

而不是：

- 再造第二套 daemon
- 推翻现有 shared automation plane

### 3. brief / memory / Auto-Dream 都是 runtime 的补强层

它们不是替代 loop 的第二执行系统，而是：

- brief：结果摘要层
- memory：连续性层
- Auto-Dream：高层整理层

### 4. `stopReason` 和 `blockedReason` 语义要保持清楚

- `stopReason`：预期内停止
- `blockedReason`：异常阻塞

不要把这两个语义弄混。

### 5. 文档体系已经建立，后续应继续沿着 manuals 扩展

当前建议继续维护这些目录：

- `getting-started/`
- `best-practices/`
- `templates/`
- `operations/`
- `troubleshooting/`
- `reference/`
- `faq/`
- `roadmap/`

---

## 7. 一句话总结

Happy 的自主 loop 系统现在已经跨过了“概念验证”阶段，进入了“可运营、可观察、可收敛”的产品化阶段。

下一阶段最重要的事情，不是再证明它能跑，而是让它：

- 更可靠
- 更有边界
- 更好运营
- 更容易持续迭代
