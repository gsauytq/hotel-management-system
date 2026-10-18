# 测试计划 — 酒店管理系统（HMS）

| 项 | 值 |
| --- | --- |
| 文档版本 | v1.0（待评审，未冻结） |
| 日期 | 2026-10-17 |
| 编制角色 | 独立测试架构师（不参与业务代码实现） |
| 输入基线 | [requirements-traceability.md](./requirements-traceability.md) §2 假设需求基线（**未批准**，Q-01）；[api-contract.md](./api-contract.md) v1.0；[database-design.md](./database-design.md) v1.0；[architecture.md](./architecture.md) v1.0；[security-design.md](./security-design.md) v1.0；[development-plan.md](./development-plan.md) v1.0；当前实现（`apps/server`、`apps/web`、`packages/shared`）源码审阅 |
| 用例目录 | [tests/test-cases.md](../tests/test-cases.md)（单一事实来源，本文只做索引） |

> **状态更新（2026-10-18）**：需求基线 v1.0 已批准（见 [`requirements-traceability-approval-draft.md`](./requirements-traceability-approval-draft.md)）。A-20 B 首登强制改密、walk-in 前端入口与 Playwright E2E 均已实现。当前单元测试 **339**（shared 37 + server 151 + web 151），integration job **255 passed / 35 files**（含 server 单测与真库用例），E2E **4 passed**（A-20、预订闭环、walk-in、权限）。G-1/G-2/G-3 已解决；G-4/G-8/G-9 等已有回归测试。部署手册初版（G-11）已补齐至 [`deployment.md`](./deployment.md)，备份恢复演练待执行。以下 §1.1–§1.3 为 **2026-10-17 历史快照**，阅读时以本横幅为准。

> **声明 1（基线风险）**：本文原文的“未批准假设基线”描述适用于 2026-10-18 之前；批准后以 [`requirements-traceability-approval-draft.md`](./requirements-traceability-approval-draft.md) 为准。
> **声明 2（证据纪律）**：本文「已有自动化」指**测试代码存在**（经源码审阅确认），不等价于「已通过」。历史执行记录见 §1.3；未执行的部分明确标注，不虚构结果。

---

## 1. 当前测试资产盘点与真实执行状态

### 1.1 资产清单（经源码审阅）

| 层 | 位置 | 规模（文件/用例名义数） | 执行方式 | 状态 |
| --- | --- | --- | --- | --- |
| 共享包单测 | `packages/shared/tests/*.test.ts` | 6 文件 | `pnpm --filter @hms/shared test` | 已有 |
| 服务端单测（mock 仓储） | `apps/server/tests/*.test.ts`（不含 integration） | 20 文件 | `pnpm --filter @hms/server test`（默认**排除** integration） | 已有 |
| 服务端集成（真库） | `apps/server/tests/integration/*.test.ts` | 7 文件 | `HMS_INTEGRATION=1 pnpm --filter @hms/server test`（需 MySQL，`fileParallelism=false`） | 已有（**默认不执行**） |
| 前端组件/视图测试 | `apps/web/tests/*.spec.ts` | 32 文件 | `pnpm --filter @hms/web test`（jsdom） | 已有 |
| 浏览器 E2E（Playwright） | 不存在（无 `e2e/` 目录，未安装 `@playwright/test`） | 0 | — | **缺失** |
| 部署/环境配置测试 | 仅有 `pnpm compose:config`（compose 语法校验）；无部署冒烟、无迁移失败用例 | — | — | **缺失** |
| CI 流水线 | 不存在（仓库无 `.github/`；redocly lint / gitleaks / pnpm audit 均未接入任何自动化） | — | — | **缺失** |

### 1.2 覆盖缺口总览（按风险排序）

| # | 缺口 | 关联 | 风险 |
| --- | --- | --- | --- |
| G-1 | 集成测试不在默认 `pnpm test` 内：不显式设 `HMS_INTEGRATION=1` 时全部跳过，且无 CI 强制执行 → 并发/真库用例可能在长期开发中「存在但从未运行」 | NFR-TST-001 | 高 |
| G-2 | 无 CI：lint/typecheck/test 无门禁；契约 lint（redocly）、密钥扫描（gitleaks）、`pnpm audit` 均未落地（api-contract §11、security §10/§11 要求） | NFR-TST-001 | 高 |
| G-3 | E2E 完全缺失（development-plan T-19 未开始）：无浏览器级主流程验证 | NFR-TST-002 | 高 |
| G-4 | TC-RT-005「调价不影响存量预订」**有用例编号、无实现**（api-contract 已定义，代码库无对应断言） | FR-RT-002 | 高（计费正确性） |
| G-5 | TC-SY-013「退房后当日可再售」仅间接覆盖（已断言占用行释放、预订相邻区间可订），无显式「当日退房→当日再入住」回归用例 | FR-SY-004 | 中 |
| G-6 | 数据库层防护未做存在性断言：7 个唯一键、CHECK 约束、关键索引未用 `information_schema` 验证（development-plan T-02 验收要求「唯一键存在性」断言，未实现）；`database.test.ts` 仅 ping | NFR-CON-002 | 中 |
| G-7 | 对称锁规则无并发用例：「停用房间 vs 并发创建预订」「取消 vs 创建」竞态未测（实现存在：rooms/bookings repository 均先锁房型行） | NFR-CON-001 | 中 |
| G-8 | 前端关键业务组件无测试：`CheckoutDialog`（费用预览/杂费行/押金抵扣）、`CheckInDialog`（可用房过滤）、`GuestPicker`（409 引导）；提交中按钮 loading/防重复点击无断言 | FR-SY-004、T-17 验收 | 中 |
| G-9 | TC-SEC-009 会话固定无显式用例（登录必然换发新 sid，行为正确但未断言「客户端伪造 sid 登录后被替换且旧值失效」） | NFR-SEC-002 | 低 |
| G-10 | 运维级场景无测试：迁移失败 fail-fast、服务重启后会话存活、seed 幂等 | NFR-DEP-001 | 中 |
| G-11 | 部署文档缺失：`docs/deployment.md` 不存在（T-20 交付物），部署测试无对照手册 | NFR-DEP-001 | 中 |
| G-12 | DashboardView（统计未接入状态）无 UI 断言；统计域本身待决（statistics-design v0.1）不在范围 | Q-STAT | 低 |

### 1.3 本次编制过程中的真实执行记录（2026-10-17，Windows/PowerShell 5.1，Node v22.22.0）

| 命令 | 结果 |
| --- | --- |
| `vitest run`（`apps/server`，默认排除 integration） | **20 文件 / 141 用例，全部通过**（2.11s） |
| `vitest run`（`apps/web`） | **32 文件 / 121 用例，全部通过** |
| `vitest run`（`packages/shared`） | **6 文件 / 37 用例，全部通过** |
| 集成测试（`HMS_INTEGRATION=1`） | **未执行**——本机 MySQL（127.0.0.1:3307）未运行（TCP 探测 CLOSED），属环境限制，不推测结果 |
| E2E / 部署测试 | **未执行**——测试资产不存在 |
| 备注 | 根 `package.json` 声明 `packageManager: pnpm@12.6.0`，本机 corepack pnpm 入口损坏（`MODULE_NOT_FOUND`），故经各包 `node_modules/.bin/vitest.CMD` 直连执行；**CI 环境须先修复 pnpm 可用性**（见 §8 Gate 0） |

---

## 2. 测试分层策略

总原则：**越靠下层越多、越快、越稳定**；上层只验证下层无法覆盖的「组合与真实环境」。任何断言优先落在能表达它的最低层（例如「押金抵扣= min(押金, 总额)」的算术属单元层，「退房事务原子性」属集成层，「按钮 loading」属组件层），禁止同一断言在三层重复出现。

### L1 单元测试（Unit）

| 项 | 说明 |
| --- | --- |
| 被测对象 | 纯函数与可注入依赖的类/服务：`@hms/shared` 全部 zod schema 与常量、`utils/{hotel-date,money,crypto,password,audit}`、各 `*.service.ts`（注入 fake repository）、`shared/http/{pagination,ApiError,prisma-errors}`、`shared/middleware/*`（含 rate-limit、csrf 的分支）、前端 `utils/`、`composables/`、`stores/`、`views/**/room-status.ts` 等纯逻辑 |
| 边界（不测） | 不触库、不启 HTTP、不测 Prisma 查询本身；Express 装配仅测 app 工厂的错误映射（`app.test.ts` 现状保留） |
| 执行 | `pnpm -r test`（当前默认路径即含），毫秒~秒级，任意提交前必跑 |
| 关键既有资产 | 141 个服务端 + 37 个 shared +（前端逻辑类并入 L4 文件） |

### L2 服务层 + 数据库集成测试（Integration）

| 项 | 说明 |
| --- | --- |
| 被测对象 | repository + 真实 MySQL 8.4 的事务行为：行锁串行化、唯一约束兜底、回滚完整性、`FOR UPDATE` 当前读、日期/金额在真库 DECIMAL/DATE 上的精度 |
| 边界（不测） | 不测前端；HTTP 层仅作为驱动入口（Supertest + 真 app 工厂，部分模块注入 fake 服务聚焦被测域——沿用现有 integration 文件的模式）；不测 Nginx/容器 |
| 执行 | `HMS_INTEGRATION=1 pnpm --filter @hms/server test`；串行（`fileParallelism=false`，防清理死锁——vitest.config.ts 注释）；**必须纳入 CI 的独立 job（MySQL service 容器）** |
| 必含用例族 | 防超售并发（TC-BK-005）、同房并发入住（TC-BK-021/TC-SY-004）、并发退房（TC-SY-012）、对称锁竞态（TC-CON-001/002，新增）、约束存在性（TC-DB-001~003，新增） |

### L3 API 契约测试

| 项 | 说明 |
| --- | --- |
| 被测对象 | 端点 × 角色 × 输入 的请求/响应形状：状态码、错误码注册表、信封结构、分页排序白名单、脱敏字段 |
| 边界 | 契约断言寄生在 L2 集成测试（Supertest 断言即契约断言）+ `route-authz.test.ts`（fake session 逐路由矩阵）；**不重复造独立契约层**；关键端点响应按 `@hms/shared` zod schema 二次校验（api-contract §11.3）——现有测试部分做到（严格 schema 拒绝未知字段），建议对 A1/B1/B6/S4 显式加 schema 解析断言 |
| 执行 | 随 L1（route-authz 无需库）与 L2（真库端点）执行；redocly lint 纳入 CI（新增） |

### L4 前端组件测试（Component）

| 项 | 说明 |
| --- | --- |
| 被测对象 | Vue 组件（jsdom + Vue Test Utils）：视图三态（loading/error/empty）、角色渲染分支、表单校验与 422 字段映射、关键业务对话框（CheckoutDialog/CheckInDialog/GuestPicker）、提交防重、API 模块调用契约（mock http） |
| 边界 | 不测 Element Plus 内部实现；不测路由真实跳转（归 L5）；权限「不渲染按钮」仅断言 UX（真权限断言在 L3，见架构 §2.9 边界声明） |
| 执行 | `pnpm --filter @hms/web test`；现有 32 文件，补 G-8 缺口 |

### L5 浏览器端到端测试（E2E，Playwright）——**待建**

| 项 | 说明 |
| --- | --- |
| 被测对象 | 真浏览器中的**关键业务闭环**（登录→客人→预订→入住→退房→账单；walk-in；权限路径；会话过期跳转）。数量克制：只保留 8 条主流程（TC-E2E-001~008），一切字段级断言留在 L2/L4，避免脆弱的 UI 细节选择器 |
| 边界 | 不测性能、不测视觉回归、不覆盖错误分支矩阵（后端已覆盖） |
| 执行 | 独立包 `e2e/`（待建），CI 独立 job：`docker compose -f compose.prod.yml up -d --build` 后运行；本地可对 dev 栈运行；失败录屏/trace 留档（T-19 要求） |
| 前置 | 需安装 `@playwright/test` 并提交 `playwright.config.ts`（baseURL、webServer 或依赖 compose） |

### L6 部署与环境配置测试（Deployment/Config）

| 项 | 说明 |
| --- | --- |
| 被测对象 | compose 拓扑（web/api/mysql healthcheck、依赖顺序、端口暴露面）、`prisma migrate deploy` 幂等与失败 fail-fast、seed 仅空表执行、Nginx 同源反代与安全响应头、密钥零入库、api 重启后会话存活（DB 持久）、部署后冒烟（health + 登录 + 核心只读接口） |
| 边界 | 不在单测框架内模拟 Docker；以**脚本 + compose 环境**执行（`scripts/deploy-smoke.mjs` 等待建），CI 用专用 job；备份/恢复演练归运维手册（手动，见 §9 手动项） |
| 执行 | 发布前必须；开发机可选 |

### 分层防重复对照（示例）

| 断言 | 唯一归属层 |
| --- | --- |
| 押金抵扣 = min(押金, 总额) | L2（orders.integration 已有；算术正确性由 Decimal 保证，不另设 L1 重复用例——`money.test.ts` 只测工具函数本身） |
| 房态非法迁移 409 | L1（rooms.service，矩阵穷举）+ L2（M5 代表性路径）——L1 管穷举、L2 管落库，不算重复 |
| 未登录 401 | L3（route-authz 逐路由，唯一全量矩阵处） |
| 登录→退房全流程可用 | L5（唯一） |
| 迁移失败容器不启动 | L6（唯一） |

---

## 3. 需求覆盖矩阵

图例：**A** = 已有自动化（用例代码存在；运行结果见 §1.3，集成层未在本次执行）；**P** = 部分覆盖，需补；**M** = 仅手动；**N** = 尚无测试（计划新增）；**R** = 范围外/待确认。用例明细（编号→11 字段）见 [tests/test-cases.md](../tests/test-cases.md)。

### 3.1 功能需求（FR）

| 需求 | 测试编号 | 状态 | 说明 |
| --- | --- | --- | --- |
| FR-AUTH-001 登录+锁定 | TC-AUTH-001~004、007、008 | A | 成功/错密/未知用户/锁定/限流均有集成或单测；锁定恢复经时钟注入（auth-service.test） |
| FR-AUTH-002 登出失效 | TC-AUTH-005 | A | auth.integration |
| FR-AUTH-003 会话重建 | TC-AUTH-006 | A | auth.integration A3 + web auth-store.spec |
| FR-USER-001 员工列表 | TC-USER-001、002 | A | users.integration + route-authz |
| FR-USER-002 创建员工 | TC-USER-003~005 | A | 含 409/422 |
| FR-USER-003 修改/启停 | TC-USER-006、007、010 | A | 含不可停用自己、停用即时踢出 |
| FR-USER-004 重置密码 | TC-USER-008、009 | A | 含全会话失效 |
| FR-RT-001 房型列表 | TC-RT-001 | A | rooms.integration R1 |
| FR-RT-002 房型维护 | TC-RT-002~004、006、007；**TC-RT-005** | A / **N** | **TC-RT-005（调价不影响存量预订）有用例号无实现，须新增**（缺口 G-4） |
| FR-RM-001 客房查询 | TC-RM-001、002 | A | 含在住摘要 |
| FR-RM-002 客房维护 | TC-RM-005~009、014 | A | 含 OCCUPIED 限制、归档房型限制 |
| FR-RM-003 房态状态机 | TC-RM-010~012、**013** | A / P | 代表路径已测；**013 全矩阵穷举**建议补 L1 |
| FR-RM-004 可分配房间 | TC-RM-003、004 | A | rooms.integration M2 |
| FR-GS-001 客人查询 | TC-GS-001、002 | A | |
| FR-GS-002 创建+加密 | TC-GS-003~005 | A | 含「库中无明文」直查库断言 |
| FR-GS-003 客人详情 | TC-GS-006、007 | A | |
| FR-GS-004 更新（证件不可改） | TC-GS-008、009 | A | 409 语义与实现一致（待确认 Q-TP-07） |
| FR-BK-001 创建+防超售 | TC-BK-001~005、022、**023** | A / R | 并发防超售已测；**023 同客人重叠预订**当前设计允许，待业务确认（Q-TP-01） |
| FR-BK-002 预订列表 | TC-BK-006、007 | A | 含增量筛选参数 |
| FR-BK-003 预订详情 | TC-BK-008~010 | A | |
| FR-BK-004 取消 | TC-BK-011~013 | A | 含释放房量回归 |
| FR-BK-005 NO_SHOW | TC-BK-014、015 | A | 含边界（今日/历史入住日） |
| FR-BK-006 预订入住 | TC-BK-016~021 | A | 含并发双入住 |
| FR-SY-001 walk-in | TC-SY-001~004 | A | 含并发 |
| FR-SY-002 入住列表 | TC-SY-005、006 | A | |
| FR-SY-003 入住详情+费用 | TC-SY-007、008、014 | A | 含凌晨入住计晚数（P-1） |
| FR-SY-004 退房结算 | TC-SY-009~**013**、015 | A / P | **013 当日再售**仅间接覆盖，须补显式回归（G-5） |
| FR-OD-001 订单列表 | TC-OD-001 | A | 含酒店本地日边界（A-10） |
| FR-OD-002 订单详情 | TC-OD-002、003、004~007 | A | 金额边界组已实现（未编号，本次补号） |

### 3.2 非功能需求（NFR）

| 需求 | 测试编号 | 状态 | 说明 |
| --- | --- | --- | --- |
| NFR-SEC-001 bcrypt/哈希不泄漏 | TC-SEC-006、TC-AUTH 组 | A | auth-password、logger redact、users.integration |
| NFR-SEC-002 Cookie 属性 | TC-AUTH-001、**TC-SEC-009**、TC-DEP-007 | A / N / M | HttpOnly/SameSite 已测；**会话固定用例须新增**（G-9）；生产 `Secure`/HSTS 待 TLS 后手动（Q-TP-06） |
| NFR-SEC-003 防爆破 | TC-AUTH-002~004、008 | A | 单元（时钟）+ 集成 + 中间件 |
| NFR-SEC-004 默认拒绝 | TC-SEC-001、002 | A | route-authz 逐路由矩阵 |
| NFR-SEC-005 zod 全输入 | 各域 422 用例 + shared schema 测试 | A | |
| NFR-SEC-006 参数化 SQL | TC-SEC-008 | A / N | 白名单注入已测；**CI grep `$*RawUnsafe` 规则须新增**（无 CI，G-2） |
| NFR-SEC-007 证件加密+掩码 | TC-GS-003、TC-SEC-010 | A | crypto.test + 集成直查库 |
| NFR-SEC-008 日志脱敏 | TC-SEC-007 | A | logger.test + auth.integration |
| NFR-SEC-009 CSRF | TC-SEC-005 | A / M | Origin 校验已测（app.test）；真实跨站浏览器行为属 L5 可选/手动 |
| NFR-CON-001 防超售 | TC-BK-005、**TC-CON-001、002** | A / N | 对称锁竞态用例须新增（G-7） |
| NFR-CON-002 占用唯一约束 | TC-BK-021、TC-SY-004、**TC-DB-001~003、TC-CON-003** | A / N | 行为已测；约束存在性断言须新增（G-6） |
| NFR-CON-003 状态机拒绝 | TC-RM-010~013、TC-BK-012/013/015、TC-SY-010 | A | |
| NFR-OBS-001 requestId | app.test（404/500 信封） | A | |
| NFR-OBS-002 结构化日志+审计 | logger.test、auth/users.service 审计断言 | A | |
| NFR-TST-001 覆盖关键路径 | 本计划 + tests/test-cases.md | P | 落地 §7 新增清单后闭环 |
| NFR-TST-002 E2E | TC-E2E-001~008 | **N** | T-19 未开始（G-3），发布前必须落地 |
| NFR-DEP-001 一键部署+迁移 | TC-DEP-001~007、TC-OPS-001~005 | P / N | 仅 compose:config 存在；其余须新增（G-10/G-11） |
| NFR-PERF-001 P95<300ms | 性能抽查 | **M** | 设计上为「非自动化门禁」；按 §9 手动清单执行（10 万行内数据集） |

### 3.3 汇总

- 假设基线 FR 29 项（requirements-traceability §2.1）：**25 项已有完整自动化覆盖、3 项部分覆盖（FR-RT-002 / FR-RM-003 / FR-SY-004，补充用例已列入 §7）、1 项含待业务确认项（FR-BK-001 的同客人重叠预订语义）**；无「完全无测试」的 FR。
- NFR 18 项：**9 项已有完整自动化、7 项部分覆盖（SEC-002/006/009、CON-001/002、TST-001、DEP-001——缺口均已列入 §7 清单）、1 项待建自动化（TST-002 E2E）、1 项仅手动（PERF-001；生产 TLS 链路另受 Q-09 阻塞）**。
- 用例总计 145 条（自动化 139：已实现 104 + 待新增 35；仅手动 6），逐条明细与统计见 [tests/test-cases.md](../tests/test-cases.md) §17。

---

## 4. 业务专项测试设计（13 项）

> 每项给出「实际业务模型推导的预期结果」（依据 database-design §5/§6、api-contract 错误码注册表、shared/states.ts 与对应实现源码），**不虚构规则**；规则本身未定者列入 §11。

### 4.1 错误密码与未登录访问
- 规则：错误密码/未知用户名/停用账号 → 401 `INVALID_CREDENTIALS` 统一文案（防枚举）；未登录访问一切受保护端点 → 401 `SESSION_EXPIRED`（路由表默认拒绝）。第 5 次失败触发锁定（该次仍 401），锁定期内 → 423；同 IP 每分钟第 11 次登录请求 → 429 + `Retry-After`。
- 覆盖：TC-AUTH-002/003/004/007/008、TC-SEC-001（**已实现**）。

### 4.2 前台员工访问管理员接口
- 规则：U1~U5、R2~R4、M3/M4 仅 ADMIN → 403 `FORBIDDEN`；M5 中进入/退出 MAINTENANCE、DISABLED 仅 ADMIN；「ADMIN 停用自己」资源级 403。前端隐藏按钮不算防线（架构 §2.9），测试必须直调 API。
- 覆盖：TC-SEC-002、TC-USER-002/010、TC-RM-012、TC-E2E-005（前三者**已实现**，E2E 待建）。

### 4.3 非法客房状态转换
- 规则（shared/states.ts `ROOM_STATUS_MANUAL_TRANSITIONS`，与 database-design §5.2 一致）：人工可执行迁移仅 `VACANT_DIRTY→VACANT_CLEAN`、`VACANT_{CLEAN,DIRTY}→MAINTENANCE/DISABLED`、`MAINTENANCE→VACANT_DIRTY/DISABLED`、`DISABLED→VACANT_DIRTY`；`OCCUPIED` 迁入/迁出仅经入住/退房事务，M5 人工设置 → 409 `ROOM_STATUS_INVALID`。并发下状态已被改 → 409「请刷新后重试」。
- 覆盖：TC-RM-010~013（010~012 已实现；013 全矩阵穷举新增）。

### 4.4 重复提交入住和退房
- 规则：同一预订二次入住 → 409 `BOOKING_STATUS_INVALID`（`stays.booking_id` 唯一约束兜底）；已退房再退房 → 409 `STAY_STATUS_INVALID`，且不产生第二张账单（`orders.stay_id` 唯一约束）。**注意**：创建类 POST（B1 建预订、S1 walk-in）按契约 §1.1 **无幂等键**，重复提交会生成两条记录（受房量约束）——前端仅做按钮 loading（UX），这是设计决定而非缺陷（Q-TP-02）。
- 覆盖：TC-BK-020、TC-SY-010、TC-SY-012（已实现）；前端防重 TC-UI-001（新增，见 4.11）。

### 4.5 重叠时间段的重复预订
- 规则：重叠判定半开区间（`check_in < :checkOut AND check_out > :checkIn`）；同房型重叠预订总量 > 可售房数（非维修/停用房）→ 409 `ROOM_TYPE_SOLD_OUT`。相邻区间（退房日=下一单入住日）合法。**同一客人**重叠时段预订当前**允许**（模型无此限制）——是否需拒绝待业务确认（Q-TP-01）。
- 覆盖：TC-BK-002、TC-BK-005（已实现）；TC-BK-023（新增：固化当前语义，若业务裁决改变则改预期）。

### 4.6 两个请求并发操作同一客房
- 规则：入住走房间行锁 + `uq_occupancy_room_date` 唯一约束，同房并发分配仅一次成功（败者 409 `ROOM_OCCUPIED`）；并发退房仅一次成功（败者 409）；预订创建/取消走房型行锁，同房型并发完全串行。隔离级别 READ COMMITTED（当前读 `FOR UPDATE` 不受快照影响，database-design §6.4）。
- 覆盖：TC-BK-021、TC-SY-004、TC-SY-012（已实现）；TC-CON-001/002（新增：房间停用/恢复 vs 并发订房的对称锁竞态）。

### 4.7 数据库事务失败与回滚
- 规则：入住/退房/取消全程单事务；任一步失败整体回滚（如占用冲突时不得留下 stay 行、房态不得变为 OCCUPIED；退房冲突时不得产生第二张账单、stay 不得变 CHECKED_OUT）。
- 覆盖：stays.integration（日期不符回滚、占用冲突回滚）、orders.integration（已有账单→整体回滚）（**已实现**）；TC-OPS-001（迁移失败 fail-fast，新增）。

### 4.8 不存在的客人或客房
- 规则：guest/room/room_type/booking/stay/order 不存在 → 404 `NOT_FOUND`（由服务层显式返回）；**不依赖** FK 报错穿透（FK RESTRICT 失败应为 500 兜底而非业务码——现有实现已前置校验规避）。
- 覆盖：各域 404 用例（TC-BK 组、TC-SY 组、TC-OD-003、TC-GS-007 等，**已实现**）。

### 4.9 无效日期与边界日期
- 规则（已实现口径，A-10/A-17/A-18）：入住日 < 酒店今日 → 422；同日入住离店 → 422（`checkOut > checkIn`）；入住日 = 今日可订；walk-in 离店日 ≤ 今日 → 422；预订入住：`checkInDate > 今日` → 409 `BOOKING_DATE_MISMATCH`，`checkOutDate ≤ 今日` → 409（「离店日已到」）；NO_SHOW：入住日 > 今日 → 409；凌晨（UTC 前一日 16:00–24:00 即酒店本地 00:00–08:00）入住按酒店本地日计晚数，不多计一晚；订单日期筛选按酒店本地日闭区间换算 UTC 边界。
- 覆盖：hotel-date.test（跨月/跨年/时区）、bookings.integration 日期边界、stays.integration 凌晨用例（**已实现**）。

### 4.10 缺失字段、错误类型和超长输入
- 规则：全部输入经 shared zod（strict：未知字段拒绝）；缺失/类型错 → 422 `VALIDATION_FAILED` + `details[].field`；字符串有长度上限（name 100、note 500 等）、数值有范围（pageSize 1–100、金额 0.01–99999.99、密码 ≤72 字节）；body > 100kb → 400 `INVALID_BODY`；畸形 JSON → 400。
- 覆盖：shared schema 测试 + 各域集成 422 用例 + app.test（**已实现**；前端同源校验的映射见 TC-UI-005，部分新增）。

### 4.11 前端重复点击、网络失败和加载状态
- 规则（架构 §2.4/§2.10）：提交中按钮 loading 且禁用（防重复提交）；读操作失败 → ErrorState + 重试按钮；写操作失败 → `ElMessage`（后端 message）；401 → 清会话跳登录（带 redirect，防死循环）；409 → 后端文案；422 → 字段级映射；5xx → 提示 + requestId；不自动重试。
- 覆盖：request.spec（拦截器全分支）、各 view 三态用例（**已实现**）；**缺口**：提交防重、CheckoutDialog/CheckInDialog/GuestPicker（TC-UI-001~005，新增）。

### 4.12 数据库迁移失败和服务重启
- 规则（database-design §7 / compose.prod.yml）：api 容器入口 `prisma migrate deploy`，失败则容器不启动（fail fast）；`migrate deploy` 幂等；seed 仅 users 空表执行；sessions 落库 → api 重启后已登录会话仍有效；mysql 重启后数据完好、api 依赖 healthcheck 自动恢复。
- 覆盖：TC-OPS-001~005、TC-DEP-002~005（**全部新增**，当前无任何自动化）。

### 4.13 金额与计费边界（补充专项，源自订单域实现）
- 规则：房费 = 单价 × 预计晚数（Decimal 精确）；杂费 0–20 项、单项 0.01–99999.99；抵扣 = min(押金, 总额)；实收 = 总额 − 抵扣；押金 ≥ 总额 → 实收 0；最小金额 0.01 不被浮点吞掉；客户端伪造总额字段 → 422（严格 schema）。
- 覆盖：orders.integration 金额边界组 + money.test（**已实现**）。

---

## 5. 测试用例格式规范

每个用例必须含 11 字段（模板与全部用例见 [tests/test-cases.md](../tests/test-cases.md)）：

| 字段 | 约束 |
| --- | --- |
| 测试编号 | 全局唯一，沿用既有 TC-\<域\>-NNN；新域：UI/CON/DB/OPS/DEP/E2E |
| 关联需求编号 | 必须映射到 requirements-traceability §2 的 FR/NFR（含 NFR-TST/DEP） |
| 风险等级 | 高（资损/超售/越权/数据泄漏/一致性）/ 中（状态机、校验、可用性）/ 低（展示、筛选） |
| 前置条件 | 引用 tests/test-cases.md §0 的共享前置（P-xxx）+ 用例特有项 |
| 测试数据 | 具体值或构造器（d(n) 相对日期等），**禁止**依赖运行时刻的绝对日期 |
| 操作步骤 | HTTP 方法+路径 / UI 操作序列 |
| 预期结果 | 状态码 + 错误码/字段值 + **数据库副作用**（集成层用例必须） |
| 可执行断言 | 伪代码级（`expect(res.body.error.code).toBe('ROOM_OCCUPIED')`）或 DB 直查断言 |
| 测试实现位置 | 已有：实际文件；新增：§7 清单中的规划路径 |
| 是否适合自动化 | 是（注明层）/ 否（注明手动原因，如真实 15 分钟等待、TLS） |
| 失败后影响 | 业务后果（用于确定修复 SLA 与发布阻断级别） |

---

## 6. （并入 §3）需求覆盖矩阵

见 §3。

---

## 7. 建议新增的自动化测试文件清单

> 优先级：P0 = 发布阻断缺口（G-1/2/3/4）；P1 = 高价值补强；P2 = 完整性。

| # | 文件（新增） | 内容（用例） | 层 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | `.github/workflows/ci.yml` | Gate 0/1/2 三段流水线：静态检查+单测（无库）→ 集成（MySQL service）→ E2E（compose）；含 `redocly lint openapi/openapi.yaml`、`gitleaks`、`pnpm audit --prod`、grep `$executeRawUnsafe/$queryRawUnsafe` | L6 | **P0** |
| 2 | `apps/server/package.json`（脚本修改，非业务代码） | 增加 `test:integration` 脚本（`cross-env HMS_INTEGRATION=1 vitest run`），CI 显式调用——消除「集成测试从不运行」缺口 G-1 | — | **P0** |
| 3 | `e2e/package.json`、`e2e/playwright.config.ts`、`e2e/tests/{auth,booking-flow,checkin-checkout-flow,walkin-flow,permission,session}.spec.ts`、`e2e/README.md` | TC-E2E-001~008 主流程；录屏/trace 留档 | L5 | **P0** |
| 4 | `apps/server/tests/integration/room-type-price-snapshot.integration.test.ts` | TC-RT-005：R3 调价后存量预订/在住价格快照不变 | L2 | **P0** |
| 5 | `apps/server/tests/integration/same-day-resale.integration.test.ts` | TC-SY-013：退房当日同房再入住（显式回归） | L2 | P1 |
| 6 | `apps/server/tests/integration/db-constraints.integration.test.ts` | TC-DB-001~003 + TC-CON-003：information_schema 断言 7 唯一键/CHECK/关键索引；直插重复 occupancy/order 行被拒 | L2 | P1 |
| 7 | `apps/server/tests/integration/concurrency-symmetric.integration.test.ts` | TC-CON-001/002：停用房间 vs 并发订房；取消 vs 创建竞态 | L2 | P1 |
| 8 | `apps/server/tests/integration/session-fixation.integration.test.ts`（或并入 auth.integration） | TC-SEC-009：伪造 sid 登录后被换发，旧 sid 失效 | L2 | P1 |
| 9 | `apps/server/tests/room-transitions-matrix.test.ts` | TC-RM-013：TRANSITIONS 矩阵 × 服务守卫穷举 | L1 | P2 |
| 10 | `apps/web/tests/checkout-dialog.spec.ts` | TC-UI-002：费用预览（房费×晚数+杂费−押金抵扣显示）、杂费行动态增删、支付方式必选 | L4 | P1 |
| 11 | `apps/web/tests/check-in-dialog.spec.ts` | TC-UI-003：可用房列表过滤（房型+日期）、提交中禁用 | L4 | P1 |
| 12 | `apps/web/tests/guest-picker.spec.ts` | TC-UI-004：关键字搜索、选中回填、409 GUEST_EXISTS 引导选用已有档案 | L4 | P1 |
| 13 | `apps/web/tests/submit-loading.spec.ts` | TC-UI-001：useFormSubmit 期间按钮 loading+disabled，请求期间二次点击不重复发请求 | L4 | P1 |
| 14 | `apps/web/tests/form-field-errors.spec.ts` | TC-UI-005：422 details[].field → 表单项错误展示（B1/S1 表单各一） | L4 | P2 |
| 15 | `scripts/deploy-smoke.mjs` | TC-DEP-005：部署后 health + 登录 + 只读接口（room-types/rooms）断言；退出码非 0 即失败 | L6 | P1 |
| 16 | `scripts/verify-deployment.sh`（或并入 15） | TC-DEP-001~004/007：compose config 校验、一键拉起 healthcheck、迁移幂等、seed 空表限制、mysql 端口不暴露宿主、Nginx 安全头 | L6 | P1 |
| 17 | `docs/deployment.md`（文档，T-20 交付物） | 部署手册，使 L6 用例有可执行对照 | — | P1 |
| 18 | `apps/web/tests/dashboard-view.spec.ts` | TC-UI-008b：统计未接入状态展示明确提示、无 Mock 数据 | L4 | P2 |

另：对既有 `apps/server/tests/integration/{bookings,stays}.integration.test.ts` 的**非预期修改**建议——为 A1/B1/B6/S4 响应补 `@hms/shared` zod 二次解析断言（api-contract §11.3 的契约测试要求）；属测试增强，不改变验收标准。

---

## 8. 测试执行顺序

```
静态 → 单元 → 集成 → 契约 lint → 前端构建 → E2E → 部署验证 → 手动验收
```

| 步骤 | 命令（建议） | 依赖环境 | 预期耗时 |
| --- | --- | --- | --- |
| 1 静态检查 | `pnpm lint && pnpm typecheck && pnpm format:check` | 无 | ~1–2 min |
| 2 单元测试（三包） | `pnpm -r test`（server 默认排除 integration） | 无 | <1 min |
| 3 集成测试 | `pnpm --filter @hms/server test:integration`（新脚本；= `HMS_INTEGRATION=1 vitest run`） | MySQL 8.4（compose 或 CI service），串行 | ~2–5 min |
| 4 契约 lint | `npx @redocly/cli lint openapi/openapi.yaml` | 无 | <1 min |
| 5 前端构建 | `pnpm --filter @hms/web build`（vue-tsc + vite build） | 无 | ~1 min |
| 6 E2E | `docker compose -f compose.prod.yml up -d --build` → `pnpm --filter @hms/e2e test` → `down -v`（隔离卷） | Docker | ~10–20 min |
| 7 部署验证 | `scripts/verify-deployment.sh` + `scripts/deploy-smoke.mjs` + TC-OPS 组 | Docker（干净卷） | ~15 min |
| 8 手动验收 | §9 手动清单（性能抽查、TLS、备份演练、UX 走查） | 生产/类生产 | 按清单 |

顺序原则：**失败成本递增**——任何步骤失败即停止后续（不带着红灯往下走）；步骤 3 与 4 可并行；步骤 6 必须在干净数据卷上执行（避免历史数据干扰主流程断言）。

---

## 9. 发布门槛（Release Gates）

### Gate 0 — 每次提交 / PR（CI 必须，当前缺失，须先落地）
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm format:check` 通过
- [ ] 三包单元测试通过（server 141 / web 121 / shared 37 为当前基线，只增不减）
- [ ] 无 `$queryRawUnsafe` / `$executeRawUnsafe` 新增（CI grep）
- [ ] `redocly lint` 0 error
- [ ] gitleaks 0 告警

### Gate 1 — 合入主干
- [ ] Gate 0 全部
- [ ] **集成测试（HMS_INTEGRATION=1）全绿**（含全部并发用例，串行执行）
- [ ] 变更触及的域：requirements-traceability §4 对应行已刷新（见 §10 建议）

### Gate 2 — 发布候选（RC）
- [ ] Gate 1 全部
- [ ] E2E TC-E2E-001~008 全绿（干净卷、录屏留档）
- [ ] 部署验证：TC-DEP-001~007 + TC-OPS-001~005 全绿（一键拉起、迁移幂等、seed 限制、冒烟通过）
- [ ] 需求覆盖矩阵无 N 状态遗留（或每条 N 有书面豁免+负责人）
- [ ] 高风险用例（§5 风险=高）无一跳过；被跳过的用例必须关联未解决事项编号

### Gate 3 — 生产验收（T-20 口径）
- [ ] 全新主机按 `docs/deployment.md` 30 分钟内一键拉起并通过部署冒烟
- [ ] 手动项完成：生产 TLS + `Secure` Cookie + HSTS 生效确认（依赖 Q-09 解决）；NFR-PERF-001 抽查（<10 万行数据集，列表端点 P95 < 300ms）；mysqldump 备份/恢复演练；UX 走查记录
- [ ] 首次登录改密建议执行（A-20 登记项）

### 门槛红线（任何一条不满足即阻断发布）
1. 并发类用例（TC-BK-005/021、TC-SY-004/012、TC-CON-*）任一失败——超售/双占用直接资损。
2. 认证授权类用例（TC-SEC-001/002、TC-AUTH-*）任一失败——越权/爆破面暴露。
3. 计费类用例（TC-SY-011、TC-OD-004~007、TC-RT-005）任一失败。
4. 集成测试因环境不可用而「静默跳过」——必须显式失败（`HMS_INTEGRATION` 未设置时 CI job 应直接报错，而非 0 用例通过）。

---

## 10. requirements-traceability.md 测试映射更新建议

> 按 requirements-traceability §5 变更控制：以下为**建议稿**，随本计划一并评审批准后由文档负责人刷新 §4 矩阵；本文档不直接改动该文件。

1. **§4 矩阵增加两列**：`现有自动化用例（文件粒度）`、`覆盖状态（A/P/N/M）`——消除「映射到测试组编号但不知是否落地」的盲区（本次审计发现 TC-RT-005 即为编号存在、实现缺失）。
2. **逐行修订**（基于 §3 矩阵结论）：
   - FR-RT-002 行：标注「TC-RT-005 未实现，见测试计划 G-4，新增 `room-type-price-snapshot.integration.test.ts`」；
   - FR-SY-004 行：补充 TC-SY-014/015（已实现未编号）与 TC-SY-013 显式回归待补；
   - FR-BK-001 行：补充 TC-BK-022（日期边界，已实现未编号）、TC-BK-023（同客人重叠预订，待确认 Q-TP-01）；
   - FR-RM-003 行：补充 TC-RM-013/014；
   - NFR-SEC-002 行：补充 TC-SEC-009（会话固定，待新增）与 TC-DEP-007（安全头）；
   - NFR-CON-001/002 行：补充 TC-CON-001~003、TC-DB-001~003；
   - NFR-TST-002 行：标注「TC-E2E-001~008 待建（e2e/ 包）」；
   - NFR-DEP-001 行：补充 TC-DEP-001~007、TC-OPS-001~005 映射；
   - 新增行：`前端交互（防重/三态/字段映射）→ TC-UI-001~008 → apps/web/tests/*`（挂 NFR-TST-001）。
3. **§4 表尾追加执行纪律注记**：「集成测试组默认不入 `pnpm test`，须经 `test:integration` / CI Gate 1 执行；编号存在 ≠ 已实现 ≠ 已通过，三态以 docs/test-plan.md §3 为准」。
4. **新增测试组注册**：TC-UI / TC-CON / TC-DB / TC-OPS / TC-DEP / TC-E2E-006~008 纳入 §2 测试组命名空间，防止后续编号冲突。

---

## 11. 待确认事项（无法凭现有基线裁决，先挂起）

| 编号 | 事项 | 影响 | 建议 |
| --- | --- | --- | --- |
| Q-TP-01 | 同一客人重叠时段能否重复预订？当前模型**允许**（仅受房型容量约束，无客人维度冲突检查） | TC-BK-023 预期、bookings 服务层是否加规则 | 业主裁决；若禁止需走需求变更（影响 api-contract B1 与 db 设计） |
| Q-TP-02 | 创建类 POST（B1/S1）无幂等键，网络重试会产生重复记录（契约 §1.1 明示接受） | 前端防重是唯一缓解 | 维持现状并在运维手册登记；V2 若加幂等键须改契约 |
| Q-TP-03 | 需求基线本身未批准（原 Q-01）：本计划全部 FR/NFR 编号随假设基线漂移 | 矩阵整体 | 优先推动基线评审；批准后刷新 §3 |
| Q-TP-04 | 生产 TLS 未就绪（原 Q-09）→ `Secure` Cookie、HSTS、真实 HTTPS 链路无法自动化 | TC-DEP-007 部分、Gate 3 手动项 | 证书到位前按内网 HTTP 预案，Gate 3 手动清单保留该项为阻断 |
| Q-TP-05 | 15 分钟锁定恢复：真等待 15 分钟的集成用例不可行 | TC-AUTH-004 实现方式 | 维持时钟注入（单元层）+ 集成层只测「进入锁定」；接受 |
| Q-TP-06 | G4 证件不可改返回 409 `GUEST_EXISTS`（api-contract 自标「保守做法待评审」，假设 A-16） | TC-GS-008 预期 | 评审追认或改 422；当前测试按 409 固化 |
| Q-TP-07 | 统计看板（statistics-design v0.1 未批准）是否纳入本期 | DashboardView 测试深度 | 范围外；仅保留 TC-UI-008「未接入状态」最小断言 |
| Q-TP-08 | `pnpm test`（root）当前会真实执行 server 单测但不执行集成——是否将 `test:integration` 并入 root `check` | 本地开发体验 vs 漏测风险 | 建议 root `check` 保持无库可跑；集成由 CI Gate 1 强制 |
| Q-TP-09 | CI 基础设施选型（GitHub Actions vs 其他）与 runner 可用性（本机 corepack pnpm 已损坏，见 §1.3） | §7 清单 #1 落地 | 交付给平台/DevOps 决策；流水线内容以 §8/§9 为准 |
| Q-TP-10 | NFR-PERF-001 的数据集构造方式（真实造数脚本 vs 抽样生产脱敏数据） | 性能抽查可重复性 | 建议编写一次性造数脚本（≤10 万行）纳入 `scripts/`，属新增测试资产 |

---

## 12. 风险登记（测试视角）

| 风险 | 概率/影响 | 缓解 |
| --- | --- | --- |
| 集成测试长期不被执行（G-1）导致并发回归逃逸 | 高/高 | Gate 1 强制 + CI 显式 job（缺环境=失败而非跳过） |
| E2E 选择器脆弱导致维护成本失控 | 中/中 | 严格限定 8 条主流程；字段级断言留在 L2/L4 |
| 假设基线变更（Q-TP-03）导致大面积改预期 | 中/中 | 用例预期全部标注规则出处（条款号/源文件），变更时按出处批量修订 |
| Windows/macOS 开发机与 Linux 容器行为差异（路径、时区、换行） | 低/中 | 集成/E2E 一律在容器内跑；本地时区不信任（hotel-date 已按 Asia/Shanghai 固定） |
| Playwright 浏览器依赖下载受限 | 低/低 | CI 缓存浏览器二进制；失败重试 1 次 |

---

## 13. 交付物索引

| 交付物 | 位置 |
| --- | --- |
| 测试计划（本文） | `docs/test-plan.md` |
| 全量用例目录（11 字段/用例） | `tests/test-cases.md` |
| 需求追踪矩阵更新建议 | 本文 §10 |
| 新增自动化测试文件清单 | 本文 §7 |
| 执行顺序与发布门槛 | 本文 §8、§9 |

