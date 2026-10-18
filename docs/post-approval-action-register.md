# 批准后行动登记（需求基线 v1.0）

| 项 | 值 |
| --- | --- |
| 状态 | **行动项已收口；剩余 Q-08/Q-09 外部门禁待签字** |
| 日期 | 2026-10-18 |
| 已批准基线 | [`requirements-traceability-approval-draft.md`](./requirements-traceability-approval-draft.md) |
| 决议清单 | [`business-assumptions-decision-list.md`](./business-assumptions-decision-list.md) |
| 决策摘要 | [`requirements-approval-decision-summary.md`](./requirements-approval-decision-summary.md) |

> 本登记不是新的需求决议，也不改变已批准基线。未完成项不得在发布说明中标记为已完成。

## 1. 行动项

| ID | 行动项 | 状态 | 门禁级别 | 建议责任 | 说明 |
| --- | --- | --- | --- | --- | --- |
| PA-01 | **A-20 B：首登强制改密** | **已完成（2026-10-18）** | **生产阻断（已解除代码缺口）** | 后端 + 前端 + 安全 | 已实现 DB 标记、登录/me 返回、403 gate、`POST /auth/change-password`、前端强制改密页与守卫；详见 §2 |
| PA-02 | **Q-08 B：PII 合规/保留期/掩码口径评审** | **检查单已准备，待外部签字** | **生产阻断** | 业主/合规 | 证据与待决项见 [`pii-compliance-checklist.md`](./pii-compliance-checklist.md)；未签字不得上线 |
| PA-03 | **Q-09 A：TLS 证书/域名、Secure/HSTS** | **本地链路已验证；生产域名/证书待外部提供与签字** | **生产阻断** | 业主/运维 | 自签证书本地验证：301、HSTS、Secure/HttpOnly/SameSite、HTTPS 冒烟 14/14；生产证书/DNS/边缘配置仍未提供，详见 [`tls-launch-checklist.md`](./tls-launch-checklist.md) |
| PA-04 | **walk-in（S1）前端入口** | **已完成（2026-10-18）** | 功能缺口（已关闭） | 前端 | 已实现 `/stays` 直接入住对话框、可用房查询、S1 契约提交、409/超时处理与页面刷新测试 |
| PA-05 | CI 增加构建门禁 | **已完成（2026-10-18）** | 质量加固 | DevOps | `static-and-unit` 已增加 `pnpm build`，CI 已实际通过 |
| PA-06 | `main` 分支保护 / required checks | **已完成（2026-10-18）** | 流程加固 | 仓库管理员 | 已启用：PR（0 approvals）、四个 required checks、strict、linear、conversation、禁止强推/删除、enforce admins；`v*` tag ruleset 禁止删除/更新 |
| PA-07 | T-19 Playwright E2E | **已完成（2026-10-18）** | 发布门禁 | QA/开发 | `e2e/` 已落地；4 条主流程：首登改密、预订/入住/退房/订单、walk-in、RECEPTIONIST 403；CI e2e job 已接入 |
| PA-08 | T-20 部署文档与运维手册 | **初版完成 + 备份恢复演练通过（2026-10-18）** | 发布门禁 | 运维/开发 | `docs/deployment.md` 已覆盖 TLS、首登改密、备份/恢复、升级/回滚、排障；10 张表 dump/restore 计数一致，草稿库已删除 |
| PA-09 | 发布标签溯源 | **已完成（2026-10-18）** | 发布记录 | 发布负责人 | `v1.0.0-rc.2` 指向 `d3e5cca`，四个 CI job 全绿；`v1.0.0-rc.1` 保留；tag ruleset 已保护 `v*` |
| PA-10 | 文档状态对齐 | **本次收口完成** | 非阻断 | 开发 | README/package 描述、seed 日志、test-plan/review 报告历史标识、security-design A-20 状态已更新 |
| PA-11 | 低风险安全遗留：B-1/B-2/B-3/C-2 | 登记 | 非阻断 | 开发/运维 | CSRF 无 Origin/Referer 放行、单实例限流、IP 限流、退房失败审计；按现有风险登记跟踪 |

## 2. A-20 B 实现验收（2026-10-18 已完成）

**目标**：种子管理员首次登录后，必须先修改初始密码，才能访问其他业务 API。

**实现结果**：

1. `users` 已增加 `must_change_password BOOLEAN NOT NULL DEFAULT FALSE`；新 seed 管理员置 true。
2. 登录响应与 `GET /auth/me` 返回 `mustChangePassword`。
3. 未改密时，`requireAuth` 与 `requireRole` 均拦截业务端点，返回 403 `PASSWORD_CHANGE_REQUIRED`；仅放行 `GET /auth/me`、`POST /auth/logout`、`POST /auth/change-password`。
4. 已新增自助改密接口：校验当前密码、密码策略（≥10 位、含字母+数字、不得含用户名、≤72 字节）；成功后更新 bcrypt 哈希、清除标记、使该用户全部会话失效。
5. 前端已提供 `/change-password` 强制页与路由守卫；未改密用户不能进入其他页面；改密成功后重新登录。
6. 审计记录 `auth.change_password` 成功/失败；日志不记录明文密码或哈希。
7. 测试已覆盖：后端改密成功/当前密码错误/策略拒绝/首登 gate/旧会话与旧密码失效/新密码登录；前端强制改密页、守卫、登录跳转。当前本地单元测试 339（shared 37 + server 151 + web 151），integration job 255 passed / 35 files。
8. 现有数据库中的旧管理员默认保持 false（迁移不追溯）；如需强制，应由运维在确认未轮换初始密码后执行一次性更新。该策略已记录在迁移注释与本登记中。

## 3. 阶段出口

本轮批准阶段出口条件已满足：

- 需求基线 v1.0 与 8 项决议已由业主电子确认并合并。
- 三份批准文档位于 `main`（合并提交 `87769eb`）。
- §2 FR/NFR 描述与原始假设内容未被改写。
- 文档状态漂移已在本收口提交中修正；剩余事项已登记为 PA-01~PA-11。
- 合并后 CI 全绿；当前为四个 job（static/integration/secret-scan/e2e）。

**剩余外部门禁**：

1. **PA-02 Q-08 B**：PII 合规/保留期/掩码口径，待业主/合规签字。
2. **PA-03 Q-09 A**：本地 TLS/Secure/HSTS 链路已验证；生产域名/证书/边缘配置待业主/运维提供并签字。

其余行动项（PA-01、PA-04~PA-09）已完成；解除上述两项外部门禁后方可生产上线。



