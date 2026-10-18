# 批准后行动登记（需求基线 v1.0）

| 项 | 值 |
| --- | --- |
| 状态 | **批准阶段已收口；行动项进入下一阶段跟踪** |
| 日期 | 2026-10-18 |
| 已批准基线 | [`requirements-traceability-approval-draft.md`](./requirements-traceability-approval-draft.md) |
| 决议清单 | [`business-assumptions-decision-list.md`](./business-assumptions-decision-list.md) |
| 决策摘要 | [`requirements-approval-decision-summary.md`](./requirements-approval-decision-summary.md) |

> 本登记不是新的需求决议，也不改变已批准基线。未完成项不得在发布说明中标记为已完成。

## 1. 行动项

| ID | 行动项 | 状态 | 门禁级别 | 建议责任 | 说明 |
| --- | --- | --- | --- | --- | --- |
| PA-01 | **A-20 B：首登强制改密** | **未开始** | **生产阻断** | 后端 + 前端 + 安全 | 当前代码无 `mustChangePassword` 字段/接口/强制跳转；批准后必须实现，详见 §2 |
| PA-02 | **Q-08 B：PII 合规/保留期/掩码口径评审** | 待外部输入 | **生产阻断** | 业主/合规 | 需形成书面结论；开发/验收期可继续使用现行技术控制 |
| PA-03 | **Q-09 A：TLS 证书/域名、Secure/HSTS** | 待外部输入 | **生产阻断** | 业主/运维 | 未提供证书/域名前不得承载真实客人数据 |
| PA-04 | **walk-in（S1）前端入口** | **未开始** | 功能缺口 | 前端 | FR-SY-001 已批准；后端 S1、可用房与容量校验已实现并有集成测试 |
| PA-05 | CI 增加构建门禁 | 未开始 | 质量加固 | DevOps | 当前 CI 不执行 `pnpm build`；本地构建已通过 |
| PA-06 | `main` 分支保护 / required checks | 未开始 | 流程加固 | 仓库管理员 | 当前无保护、无 rulesets；建议要求 PR + 三个 job + 禁止强推/删除 |
| PA-07 | T-19 Playwright E2E | 未开始 | 发布门禁 | QA/开发 | `e2e/` 不存在；覆盖登录、预订、入住、退房、订单核对、walk-in、权限路径 |
| PA-08 | T-20 部署文档与运维手册 | 未开始 | 发布门禁 | 运维/开发 | `docs/deployment.md` 不存在；含 TLS、备份/恢复、密钥轮换、升级/回滚 |
| PA-09 | 发布标签溯源 | 待发布决策 | 发布记录 | 发布负责人 | `v1.0.0-rc.1` 仍指向 `ac369f3`，不含批准文档（`87769eb`）；如需新 RC，应新建 tag，禁止移动旧 tag |
| PA-10 | 文档状态对齐 | **本次收口完成** | 非阻断 | 开发 | README/package 描述、seed 日志、test-plan/review 报告历史标识、security-design A-20 状态已更新 |
| PA-11 | 低风险安全遗留：B-1/B-2/B-3/C-2 | 登记 | 非阻断 | 开发/运维 | CSRF 无 Origin/Referer 放行、单实例限流、IP 限流、退房失败审计；按现有风险登记跟踪 |

## 2. A-20 B 实现验收草案（下一阶段首项）

**目标**：种子管理员首次登录后，必须先修改初始密码，才能访问其他业务 API。

**最小验收条件**：

1. `users` 增加 `must_change_password` 布尔字段（默认 false）；新 seed 管理员置 true。
2. 登录响应与 `GET /auth/me` 返回 `mustChangePassword`。
3. 未改密时，除 `GET /auth/me`、`POST /auth/logout`、改密接口外，受保护 API 返回 403 `PASSWORD_CHANGE_REQUIRED`（后端强制，不能只靠前端）。
4. 新增自助改密接口：校验当前密码、密码策略（≥10 位、含字母+数字、不得含用户名、≤72 字节）；成功后更新 bcrypt 哈希、清除标记、使该用户全部会话失效。
5. 前端提供强制改密页/路由；未改密用户不能进入其他页面；改密成功后重新登录。
6. 审计记录成功/失败；日志不记录明文密码或哈希。
7. 自动化测试：后端单测/集成测试（含 gate、旧会话失效、旧密码失效、新密码登录）+ 前端组件/守卫测试；更新 OpenAPI、api-contract、shared 类型与部署冒烟说明。
8. 现有数据库中的旧管理员如何处理（迁移置 true 还是提供一次性脚本）需在任务开始时明确；不得假设 `username='admin'` 一定代表初始密码未改。

## 3. 阶段出口

本轮批准阶段出口条件已满足：

- 需求基线 v1.0 与 8 项决议已由业主电子确认并合并。
- 三份批准文档位于 `main`（合并提交 `87769eb`）。
- §2 FR/NFR 描述与原始假设内容未被改写。
- 文档状态漂移已在本收口提交中修正；剩余事项已登记为 PA-01~PA-11。
- 合并后 CI 三个 job 全绿。

**下一阶段建议顺序**：

1. **PA-01 A-20 B**（生产安全阻断，优先）
2. **PA-04 walk-in UI**（已批准功能缺口）
3. **PA-07 E2E / PA-08 部署文档**
4. PA-05 / PA-06 作为持续加固
5. PA-02 / PA-03 由业主/合规/运维并行推进
