# Happy 自主 Loop 巡检与复盘清单

## 每日巡检

### 系统层

- [ ] 打开 `Machine -> Automation`
- [ ] 查看 `Loop Rollup`
- [ ] 查看 failed jobs 是否上升
- [ ] 查看 blocked loops 是否上升
- [ ] 查看 pending events 是否堆积
- [ ] 查看 guardian / audit 是否异常

### loop 层

- [ ] 打开 1-3 个关键 loop
- [ ] 检查 `Last brief`
- [ ] 检查 `Current Focus`
- [ ] 检查 `Stop reason` / `Blocked reason`
- [ ] 必要时打开 memory / context

## 每周复盘

### 保留 / 下线判断

- [ ] 这个 loop 最近一周是否有稳定产出？
- [ ] brief 是否有信息增量？
- [ ] memory 是否真实演进？
- [ ] 是否经常失败或空转？
- [ ] 是否和其他 loop 职责重叠？
- [ ] 它应该长期存在，还是应该变成有限型 loop？

### 参数治理

- [ ] 是否需要增加 cooldown？
- [ ] 是否需要降低 max-auto-runs？
- [ ] 是否需要增加 max-iterations？
- [ ] 是否需要 stop-on-success？
- [ ] 是否需要更严格的失败预算？

### 编排治理

- [ ] 是否应该拆成 upstream / downstream loops？
- [ ] 是否应该接入通知？
- [ ] 是否应该纳入 Auto-Dream？

## 月度整理

- [ ] 删除长期无效 loop
- [ ] 暂停不再需要的 loop
- [ ] 合并重复 loop
- [ ] 更新最佳实践与模板
- [ ] 清理不再需要的 bootstrap / Auto-Dream profiles
