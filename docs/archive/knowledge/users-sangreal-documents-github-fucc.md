# /Users/sangreal/Documents/GitHub/fucc

归档自 ProjectKnowledge，共 2 条 active 条目。


## 极智量化平台知识库构建完成 - v12策略架构审视

*discovery · high · 2026-04-13*

已完成极智量化平台的全面知识库建设，共5个核心文档+1个索引。知识库覆盖平台架构、完整API参考、策略开发模式、扩展函数和用户v12策略分析。

v12策略架构审视要点：

1. 全局变量管理：900+行代码包含60+个全局变量，存在状态被意外覆盖的风险。受限于极智量化的四函数框架，建议先用字典进行归类管理而非大幅重构。

2. 两个关键待解问题：
   - 进场后跟进持仓变化平仓：涉及策略持仓与真实持仓的一致性，实盘中手动操作或网络问题可能导致分歧
   - 止损空间更小：属策略逻辑层面问题，不是代码能直接解决的。BBI+量能进场的精度决定了止损下限

3. 锁机制设计亮点但高风险：利润锁+保本锁+跨月锁三层嵌套，边界条件众多，需逐个进行单元级场景验证。

知识库已可支持精准的策略优化定位。


## Repo Map: fucc

*repo_map · high · 2026-05-16*

## Project Structure (56 tracked files)

"doc/ (52 files, py"/md")
  └─ strategy/(52)
archived/ (1 files, py)
[root] .gitignore, README.md, v13.py
