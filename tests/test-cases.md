# 测试用例目录 — 酒店管理系统（HMS）

| 项           | 值                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 文档版本     | v1.0（待评审，未冻结）                                                                                                                                                                                                                                                                                             |
| 日期         | 2026-10-17                                                                                                                                                                                                                                                                                                         |
| 上游文档     | [docs/test-plan.md](../docs/test-plan.md)（分层策略、覆盖矩阵、发布门槛）                                                                                                                                                                                                                                          |
| 规则出处约定 | 每条「预期结果」均可追溯：`契约 §x` = api-contract.md；`库设 §x` = database-design.md；`架构 §x` = architecture.md；`安全 §x` = security-design.md；`shared/states.ts` = packages/shared 状态机常量；`实现` = 对应服务/仓储源码。**未在上述出处出现的规则不在本目录虚构**，一律挂 docs/test-plan.md §11 待确认事项 |
| 执行状态声明 | 「已实现」= 测试代码存在（源码审阅确认）；单元层已于 2026-10-17 真实执行通过（见 docs/test-plan.md §1.3）；集成层因本机无 MySQL **未执行**，不推测结果                                                                                                                                                             |

**用例格式（11 字段）**：测试编号 / 关联需求 / 风险等级 / 前置条件 / 测试数据 / 操作步骤 / 预期结果 / 可执行断言 / 测试实现位置 / 是否适合自动化 / 失败后影响。每用例以下述紧凑块表达，字段缺失视为无效用例。

---

## 实施状态更新（2026-10-17，第二轮）

本轮按本目录与 [docs/test-plan.md](../docs/test-plan.md) §7 补全并**真实执行**了以下用例（其余状态见各用例块与 §17）：

| 用例                     | 实现文件                                                                     | 结果                                                    |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| TC-RM-013                | `apps/server/tests/room-transitions-matrix.test.ts`                          | 通过（3 用例，矩阵 50 组合）                            |
| TC-RT-005                | `apps/server/tests/integration/room-type-price-snapshot.integration.test.ts` | 通过                                                    |
| TC-SY-013                | `apps/server/tests/integration/same-day-resale.integration.test.ts`          | 通过                                                    |
| TC-DB-001~003            | `apps/server/tests/integration/db-constraints.integration.test.ts`           | 通过                                                    |
| TC-CON-003               | 同上                                                                         | 通过（P2002 兜底）                                      |
| TC-CON-001/002           | `apps/server/tests/integration/concurrency-symmetric.integration.test.ts`    | 通过（真实并发）                                        |
| TC-AUTH-009 / TC-SEC-009 | `apps/server/tests/integration/session-fixation.integration.test.ts`         | 通过                                                    |
| TC-BK-023                | `apps/server/tests/integration/bookings.integration.test.ts`（新增用例）     | 通过（现行语义固化，Q-TP-01 待裁决）                    |
| TC-UI-001/002            | `apps/web/tests/checkout-dialog.spec.ts`                                     | 通过（提交防重、杂费、载荷）                            |
| TC-UI-003                | `apps/web/tests/check-in-dialog.spec.ts`                                     | 通过                                                    |
| TC-UI-004                | `apps/web/tests/guest-picker.spec.ts`                                        | 通过（搜索/防抖/选择/错误重试；409 建档引导不在本组件） |
| TC-UI-005                | `apps/web/tests/form-field-errors.spec.ts`                                   | 通过（字段提取；视图逐字段接线仍缺）                    |
| TC-UI-008b               | `apps/web/tests/dashboard-view.spec.ts`                                      | 通过                                                    |
| TC-E2E-001~008           | 未实现（Playwright 未安装、无浏览器缓存）                                    | **未验证**                                              |
| TC-OPS-001（坏迁移）     | 仅验证缺失环境变量 fail-fast（一次性容器退出码 1）                           | **部分验证**                                            |

实测汇总（2026-10-17）：服务端 33 文件 / 238 用例、前端 37 文件 / 135 用例、shared 6 文件 / 37 用例，全部通过；部署/运维检查见最终实施报告。

---

## 0. 共享约定

### 0.1 共享前置条件（P-xxx）

| 编号    | 内容                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-AUTH  | 环境可用；DB 存在 ACTIVE 用户 `admin01`（ADMIN）与 `front01`（RECEPTIONIST），密码为测试常量（集成测试以 `seedUser` 生成，见 auth.integration.test.ts） |
| P-LOGIN | 持有任一登录角色的有效 `hms_sid` Cookie（P-AUTH 登录获得）                                                                                              |
| P-ADMIN | 持有 ADMIN 的有效 Cookie                                                                                                                                |
| P-RT    | P-ADMIN；存在房型 T1：code=STD、basePrice=288.00、capacity=2、ACTIVE                                                                                    |
| P-RM    | P-ADMIN；T1 + 房间 R1（roomNumber 唯一，VACANT_DIRTY）                                                                                                  |
| P-GS    | P-LOGIN；存在客人 G1：张三 / 13800138000 / ID_CARD（证件号唯一）                                                                                        |
| P-BK    | P-LOGIN；T1 及其下 N 间非维修/停用房；客人 G1                                                                                                           |
| P-SY    | P-LOGIN；T1 + 房间 R1（VACANT_CLEAN）；客人 G1                                                                                                          |
| P-E2E   | Playwright（待建）+ compose 全栈（web:8080/api/mysql）干净卷启动，迁移与种子完成；测试账号同 P-AUTH                                                     |
| P-DEP   | Docker 可用；`.env` 按 `.env.example` 填写真实值；目标环境数据卷干净                                                                                    |
| P-INT   | 本机 MySQL（127.0.0.1:3307）运行且已 `prisma migrate deploy`（`HMS_INTEGRATION=1`）                                                                     |

### 0.2 日期与数据记号

- `d(n)` = 相对**酒店本地今日（Asia/Shanghai）**偏移 n 天的 `YYYY-MM-DD`（沿用 bookings.integration.test.ts 的 `d()`，保证与运行时刻无关）。
- 「可售数」= 该房型下 `status NOT IN (MAINTENANCE, DISABLED)` 的房间数（库设 §2.4）。
- 占用区间 = `[入住日, 预计离店日)` 左闭右开（库设 §2.8 / A-05）。

### 0.3 状态机引用（预期结果的唯一依据）

- 房间人工迁移（shared/states.ts，与库设 §5.2 一致）：`VACANT_DIRTY→VACANT_CLEAN`；`VACANT_CLEAN→{MAINTENANCE,DISABLED}`；`VACANT_DIRTY→{MAINTENANCE,DISABLED}`；`MAINTENANCE→{VACANT_DIRTY,DISABLED}`；`DISABLED→VACANT_DIRTY`；`OCCUPIED` 无人工迁移。
- 预订：`CONFIRMED→{CHECKED_IN,CANCELLED,NO_SHOW}`，其余为终态。
- 入住：`CHECKED_IN→CHECKED_OUT`（仅退房事务）。

---

## 1. 认证域 TC-AUTH（FR-AUTH-001~003）

**TC-AUTH-001 登录成功（会话与 Cookie 属性）**

- 需求/风险：FR-AUTH-001、NFR-SEC-002｜高
- 前置：P-AUTH；无既有会话
- 数据：`{username:"front01", password:<正确值>}`
- 步骤：POST `/api/v1/auth/login`
- 预期：200，`data={id,username,displayName,role}`；`Set-Cookie: hms_sid=<64hex>; HttpOnly; SameSite=Strict; Path=/`（生产另含 `Secure`）；DB sessions 新行且 `expires_at≈now+8h`；`failed_attempts` 清零；审计 `auth.login/SUCCESS`
- 断言：`expect(res.headers['set-cookie'][0]).toMatch(/hms_sid=[0-9a-f]{64}/)` 且含 `HttpOnly`、`SameSite=Strict`；直查库 `sessions` 计数=1、`users.failed_attempts=0`
- 位置：`apps/server/tests/integration/auth.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：系统无法登录或会话凭证可被 XSS 窃取

**TC-AUTH-002 密码错误**

- 需求/风险：FR-AUTH-001、NFR-SEC-003｜高
- 前置：P-AUTH
- 数据：正确用户名 + 错误密码
- 步骤：POST `/api/v1/auth/login`
- 预期：401 `INVALID_CREDENTIALS`「用户名或密码错误」（统一文案）；`failed_attempts+1`；无 sessions 行；审计 FAILURE/`invalid_credentials`（契约 §3 A1）
- 断言：`res.status===401 && res.body.error.code==='INVALID_CREDENTIALS'`；DB 计数 +1、sessions 计数 0
- 位置：`apps/server/tests/integration/auth.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：爆破防护失效或账号状态泄露

**TC-AUTH-003 连续失败触发账户锁定**

- 需求/风险：FR-AUTH-001、NFR-SEC-003｜高
- 前置：P-AUTH；目标账号 `failed_attempts=0`
- 数据：错误密码 ×5，随后正确密码 1 次
- 步骤：连续 POST login 5 次 → 第 6 次用正确密码
- 预期：第 1~4 次 401；第 5 次 401（该次触发 `locked_until=now+15min`，安全 §3）；第 6 次（锁定期内）即使密码正确 → 423 `ACCOUNT_LOCKED`
- 断言：第 6 次 `res.status===423 && res.body.error.code==='ACCOUNT_LOCKED'`；DB `locked_until` 非空
- 位置：`apps/server/tests/integration/auth.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：防爆破失效

**TC-AUTH-004 锁定恢复与计数重置（时钟注入）**

- 需求/风险：FR-AUTH-001、NFR-SEC-003｜中
- 前置：账号已锁定；`now()` 可注入（auth.service `deps.now`）
- 数据：锁定后推 15 分钟
- 步骤：①锁定期内正确密码 → 断言 423；②推进时钟 15min 后再失败 1 次 → 断言计数从 1 重新开始（`resetFirst`）；③成功登录清零
- 预期：①423；②`failed_attempts=1`（非延续旧值）；③登录成功且计数 0
- 断言：fake repository 收到 `recordFailedLogin({resetFirst:true})`；成功路径 `completeLogin` 前计数清零
- 位置：`apps/server/tests/auth-service.test.ts`（已实现，单元时钟注入；真实 15 分钟等待不做——见 test-plan Q-TP-05）
- 自动化：是（L1）
- 失败影响：锁死账号无法自愈或锁定形同虚设

**TC-AUTH-005 登出后原 Cookie 失效**

- 需求/风险：FR-AUTH-002｜中
- 前置：P-LOGIN
- 数据：有效 Cookie
- 步骤：POST `/api/v1/auth/logout` → 用同一 Cookie GET `/api/v1/auth/me`
- 预期：登出 200 `{data:{ok:true}}`，DB sessions 行删除，Set-Cookie 置空（Max-Age=0）；后续 401 `SESSION_EXPIRED`（契约 §3 A2）
- 断言：`sessions` 计数 0；第二次请求 401
- 位置：`apps/server/tests/integration/auth.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：共享/被盗会话无法主动终结

**TC-AUTH-006 刷新后会话重建**

- 需求/风险：FR-AUTH-003｜中
- 前置：P-LOGIN（浏览器或组件层模拟）
- 步骤：①GET `/auth/me` → 200；②前端刷新（重新挂载 app）→ 守卫触发 `fetchMe` 重建 `authStore`
- 预期：`me` 返回当前用户（含 `status`）；刷新后仍为登录态，无需重新登录（架构 §2.7）
- 断言：`res.body.data.username==='front01'`；组件层 `authStore.user` 非空
- 位置：`apps/server/tests/integration/auth.integration.test.ts` + `apps/web/tests/auth-store.spec.ts`（已实现）
- 自动化：是（L2+L4）
- 失败影响：每次刷新被登出（可用性缺陷）

**TC-AUTH-007 未知用户名防枚举**

- 需求/风险：FR-AUTH-001、NFR-SEC-003｜高
- 前置：P-AUTH；用户名不存在
- 数据：`{username:"no_such_user", password:"whatever#123"}`
- 步骤：POST login
- 预期：401 `INVALID_CREDENTIALS` **与密码错误完全同文案同耗时量级**；不产生任何失败计数（无该用户行）；执行 dummy bcrypt 比较防时序探测（安全 §1）
- 断言：`res.body.error` 与 TC-AUTH-002 逐字节一致；DB 无变化
- 位置：`apps/server/tests/integration/auth.integration.test.ts`（已实现）；dummy compare 单元断言 `apps/server/tests/auth-service.test.ts`（已实现）
- 自动化：是（L2+L1）
- 失败影响：可枚举有效用户名，针对性爆破

**TC-AUTH-008 登录 IP 限流**

- 需求/风险：FR-AUTH-001、NFR-SEC-003｜中
- 前置：P-AUTH；单一客户端 IP
- 数据：任意凭证 ×11
- 步骤：60 秒窗口内连续 POST login 11 次
- 预期：第 1~10 次按凭证正常返回（401/200）；第 11 次 → 429 `RATE_LIMITED` + `Retry-After`；窗口滑过恢复；不同 IP 互不影响（每 IP 每分钟 10 次，安全 §3）
- 断言：`res.status===429` 且 `res.headers['retry-after']` 存在
- 位置：`apps/server/tests/app.test.ts`（端点级，已实现）+ `apps/server/tests/rate-limit.test.ts`（中间件矩阵，已实现）
- 自动化：是（L1+L2）
- 失败影响：分布式爆破无节制

**TC-AUTH-009 会话固定防护**（待新增）

- 需求/风险：NFR-SEC-002｜中
- 前置：P-AUTH；客户端预置伪造 Cookie `hms_sid=<forged 64hex>`
- 数据：伪造 sid + 正确凭证
- 步骤：带伪造 Cookie POST login → 提取响应 Set-Cookie 新 sid → 分别用 forged / 新 sid 访问 `/auth/me`
- 预期：新 sid ≠ forged；forged → 401；新 sid → 200（sid 仅服务端登录成功时生成，安全 §2）
- 断言：`newSid!==forged`；两次 me 请求状态码 401/200
- 位置：`apps/server/tests/integration/session-fixation.integration.test.ts`（待新增，test-plan §7-8）
- 自动化：是（L2）
- 失败影响：攻击者可预置会话 id 实施固定攻击

---

## 2. 员工域 TC-USER（FR-USER-001~004，全部 ADMIN）

**TC-USER-001 列表分页/筛选/排序**

- 需求/风险：FR-USER-001｜低
- 前置：P-ADMIN；预置 ≥3 个不同角色/状态员工
- 数据：`?role=RECEPTIONIST&status=ACTIVE&keyword=王&page=1&pageSize=2&sort=createdAt:desc`
- 步骤：GET `/api/v1/users`
- 预期：200；items 仅含匹配项且**不含 passwordHash**；pagination.total/totalPages 正确（契约 §4 U1）
- 断言：`items.every(u=>!('passwordHash' in u))`；`totalPages===ceil(total/pageSize)`
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：管理功能不可用或凭据泄漏

**TC-USER-002 非 ADMIN 访问员工接口**

- 需求/风险：FR-USER-001、NFR-SEC-004｜高
- 前置：P-LOGIN（RECEPTIONIST）
- 步骤：分别调 U1~U5 全部端点
- 预期：全部 403 `FORBIDDEN`（契约 §4；route-authz 矩阵）
- 断言：`res.status===403`
- 位置：`apps/server/tests/route-authz.test.ts`（逐路由，已实现）+ `apps/server/tests/integration/users.integration.test.ts`（真会话，已实现）
- 自动化：是（L3+L2）
- 失败影响：越权管理员工=权限体系崩溃

**TC-USER-003 创建员工成功**

- 需求/风险：FR-USER-002｜中
- 前置：P-ADMIN
- 数据：`{username:"front02", password:"Init#12345", displayName:"李雷", role:"RECEPTIONIST"}`
- 步骤：POST `/api/v1/users`
- 预期：200 返回 UserListItem；DB 存 bcrypt 哈希（≠明文，cost=12）；审计 `user.create`
- 断言：响应无密码字段；直查库 `password_hash` 以 `$2` 开头且 ≠ 明文
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：明文存码=安全事故

**TC-USER-004 用户名重复**

- 需求/风险：FR-USER-002｜低
- 前置：P-ADMIN；用户名已存在
- 步骤：POST `/api/v1/users`
- 预期：409 `DUPLICATE_USERNAME`（含并发竞态由 uq_users_username 兜底）
- 断言：`res.body.error.code==='DUPLICATE_USERNAME'`
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：账号唯一性破坏

**TC-USER-005 密码策略违规**

- 需求/风险：FR-USER-002、NFR-SEC-001｜中
- 前置：P-ADMIN
- 数据：①9 位 ②纯字母无数字 ③包含用户名 ④>72 字节
- 步骤：POST `/api/v1/users`（各一次）
- 预期：全部 422 `VALIDATION_FAILED`，details 指向 `password`（安全 §1：≥10、字母+数字、≤72、不含用户名）
- 断言：`res.body.error.details[0].field==='password'`
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现）+ `apps/server/tests/users.service.test.ts`（已实现）
- 自动化：是（L2+L1）
- 失败影响：弱口令面扩大

**TC-USER-006 修改姓名/角色/启停**

- 需求/风险：FR-USER-003｜中
- 前置：P-ADMIN；目标员工存在
- 数据：`{displayName:"李雷（值班）", role:"RECEPTIONIST", status:"DISABLED"}`
- 步骤：PATCH `/api/v1/users/{id}`
- 预期：200 返回更新后对象；角色变更写审计 `user.role_change`
- 断言：`res.body.data.status==='DISABLED'`；审计记录存在
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：员工管理失效

**TC-USER-007 停用后该用户即刻 401**

- 需求/风险：FR-USER-003、NFR-SEC-004｜高
- 前置：P-ADMIN；目标 RECEPTIONIST 持有效会话
- 步骤：PATCH 停用目标 → 目标用户用原 Cookie GET `/auth/me`
- 预期：401 `SESSION_EXPIRED`（停用与会话删除同事务；每请求实时查库，安全 §2）
- 断言：第二次请求 401；DB 该用户 sessions=0
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现，TC-SEC-003 同源）
- 自动化：是（L2）
- 失败影响：离职员工保留访问权=安全事故

**TC-USER-008 重置密码后新旧密码行为**

- 需求/风险：FR-USER-004｜中
- 前置：P-ADMIN；目标用户存在
- 步骤：PATCH `/api/v1/users/{id}/password`（newPassword）→ 旧密码登录 → 新密码登录
- 预期：重置 200 `{data:{ok:true}}`；旧密码 401；新密码 200（契约 §4 U4）
- 断言：两次登录状态码 401/200
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：密码重置失效（账号不可恢复或旧密仍可用）

**TC-USER-009 重置密码后全部会话失效**

- 需求/风险：FR-USER-004、NFR-SEC-004｜高
- 前置：目标用户持有 ≥2 个有效会话
- 步骤：重置密码 → 逐个用旧 Cookie 访问
- 预期：全部 401（重置与会话删除同事务，users.service.ts:167）
- 断言：DB sessions=0；各 Cookie 请求均 401
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：被盗号后无法通过重置密码踢出攻击者

**TC-USER-010 ADMIN 不可停用自己**

- 需求/风险：FR-USER-003｜中
- 前置：P-ADMIN
- 步骤：PATCH `/api/v1/users/{自己}/status=DISABLED`
- 预期：403 `FORBIDDEN`，message 说明原因（契约 §4 U3 资源级规则）
- 断言：`res.status===403`；自己仍可访问
- 位置：`apps/server/tests/integration/users.integration.test.ts`（已实现）+ `apps/server/tests/users.service.test.ts`（已实现）
- 自动化：是（L2+L1）
- 失败影响：唯一管理员自锁，系统失去管理能力

---

## 3. 房型域 TC-RT（FR-RT-001~002）

**TC-RT-001 列表含价格与房间数**

- 需求/风险：FR-RT-001｜低
- 前置：P-LOGIN；T1 下有 2 间非停用房 + 1 间 DISABLED
- 步骤：GET `/api/v1/room-types`
- 预期：200；T1 项 `basePrice=288.00`、`roomCount=2`（未停用房计数，契约 §5 R1）
- 断言：`item.roomCount===2`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：看板数据失真

**TC-RT-002 创建房型成功**

- 需求/风险：FR-RT-002｜中
- 前置：P-ADMIN
- 数据：`{code:"DLX", name:"豪华大床房", basePrice:388.00, capacity:2, description:"25㎡"}`
- 步骤：POST `/api/v1/room-types`
- 预期：200 返回完整 DTO（契约 §5 R2）
- 断言：`res.body.data.code==='DLX'`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：无法扩展房型

**TC-RT-003 code 重复**

- 需求/风险：FR-RT-002｜低
- 前置：P-ADMIN；code 已存在
- 预期：409 `ROOM_TYPE_CODE_EXISTS`（uq_room_types_code 兜底）
- 断言：`res.body.error.code==='ROOM_TYPE_CODE_EXISTS'`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：主数据唯一性破坏

**TC-RT-004 非法价格/编码/容量**

- 需求/风险：FR-RT-002、NFR-SEC-005｜中
- 数据：basePrice=-1 / 100000；code 小写或 1 位；capacity=0/21
- 预期：全部 422 details 指向对应字段
- 断言：`res.status===422`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：脏数据入库污染计费

**TC-RT-005 调价不影响存量预订/在住价格快照**（待新增，缺口 G-4）

- 需求/风险：FR-RT-002（A-12/A-13）｜高
- 前置：P-BK；T1 basePrice=288；存在预订 B1（288×2 晚，CONFIRMED）与在住 S1（pricePerNight=288）
- 数据：PATCH `{basePrice:428.00}`
- 步骤：PATCH `/api/v1/room-types/{T1}` → 读 B1 详情 / S1 详情 → 新建预订 B2（不传价格）
- 预期：200；B1 `pricePerNight=288.00`、`totalPrice=576.00` 不变；S1 不变；**新**预订 B2 `pricePerNight=428.00`
- 断言：`B1.totalPrice===576.00`；`B2.pricePerNight===428.00`；DB bookings 行快照字段不变
- 位置：`apps/server/tests/integration/room-type-price-snapshot.integration.test.ts`（待新增，test-plan §7-4）
- 自动化：是（L2）
- 失败影响：历史账单被追溯改写=资损与对账事故

**TC-RT-006 归档后不可创建该房型预订**

- 需求/风险：FR-RT-002｜中
- 前置：P-BK；T1 已归档
- 步骤：POST `/api/v1/bookings`（T1）；GET `/rooms/available?roomTypeId=T1...`
- 预期：预订 409 `ROOM_TYPE_ARCHIVED`；可分配列表返回空数组（rooms.service.ts:179-183）
- 断言：`res.body.error.code==='ROOM_TYPE_ARCHIVED'`；available 为 `[]`
- 位置：`apps/server/tests/integration/{rooms,bookings}.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：已下线房型继续售卖

**TC-RT-007 存在未完结预订/在住时拒绝归档**

- 需求/风险：FR-RT-002｜中
- 前置：P-ADMIN；T1 有 CONFIRMED 预订（或 CHECKED_IN 在住）
- 步骤：POST `/api/v1/room-types/{T1}/archive`
- 预期：409 `ROOM_TYPE_ARCHIVED`（有引用时）；干净房型 200 `{status:"ARCHIVED"}`；重复归档 409（契约 §5 R4）
- 断言：三种分支状态码/错误码分别成立
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：在售资源被误下线

---

## 4. 客房域 TC-RM（FR-RM-001~004）

**TC-RM-001 列表筛选/分页/前缀/排序白名单**

- 需求/风险：FR-RM-001｜低
- 前置：P-LOGIN；多状态/多房型房间
- 数据：`?status=VACANT_CLEAN&roomTypeId=T1&roomNumber=08&page=1&pageSize=50&sort=roomNumber:asc`；另试 `sort=id;DROP TABLE`
- 预期：合法参数过滤正确；注入与白名单外字段 → 422（TC-SEC-008 同源）
- 断言：`items` 全部匹配筛选；注入请求 422
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：看板失真或注入面

**TC-RM-002 房态看板含在住摘要**

- 需求/风险：FR-RM-001｜中
- 前置：P-LOGIN；R1 为 OCCUPIED 且有在住 S1
- 步骤：GET `/api/v1/rooms`
- 预期：R1 项 `currentStay={stayId,guestName,checkInAt,expectedCheckOutDate}` 非空；非 OCCUPIED 房 `currentStay=null`（契约 §6 M1）
- 断言：字段逐项匹配 S1
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：前台误操作（不知道谁在住）

**TC-RM-003 可分配房间排除日期重叠占用**

- 需求/风险：FR-RM-004｜高
- 前置：P-LOGIN；R1 在 `[d(2),d(4))` 已被占用
- 数据：`?roomTypeId=T1&checkInDate=d(2)&checkOutDate=d(4)` 与 `?checkInDate=d(4)&checkOutDate=d(6)`
- 预期：前者列表不含 R1；后者（相邻，退房日释放）包含 R1（A-05 左闭右开）
- 断言：两次请求的 items 含/不含 R1
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：排房时选到已占房 → 入住失败或双占

**TC-RM-004 可分配房间排除维修/停用**

- 需求/风险：FR-RM-004｜中
- 前置：P-LOGIN；R2=MAINTENANCE、R3=DISABLED、R4=VACANT_CLEAN、R5=OCCUPIED
- 预期：仅 R4 出现在可用列表（实现：status ∈ {VACANT_CLEAN, VACANT_DIRTY} 且区间无占用）
- 断言：`items.map(id)` 恰为 `[R4]`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：不可用房被分配

**TC-RM-005 创建房间成功**

- 需求/风险：FR-RM-002｜中
- 前置：P-ADMIN
- 数据：`{roomNumber:"0822", roomTypeId:T1, note:"无窗房"}`
- 预期：200；初始 `status=VACANT_DIRTY`（库设 §2.4 默认值）
- 断言：`res.body.data.status==='VACANT_DIRTY'`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：房源管理失效

**TC-RM-006 房号重复**

- 需求/风险：FR-RM-002｜低
- 预期：409 `ROOM_NUMBER_EXISTS`（uq_rooms_room_number 兜底，含并发竞态）
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：物理房混淆

**TC-RM-007 房型不存在**

- 需求/风险：FR-RM-002｜低
- 预期：404 `NOT_FOUND`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：脏引用

**TC-RM-008 在住房不可改房型/房号**

- 需求/风险：FR-RM-002、NFR-CON-003｜中
- 前置：P-ADMIN；R1=OCCUPIED
- 步骤：PATCH R1 `{roomTypeId:T2}`（或改房号）→ PATCH R1 `{note:"x"}`
- 预期：前者 409 `ROOM_STATUS_INVALID`「在住房间不可修改房型或房号」；仅改 note 成功（契约 §6 M4）
- 断言：409/200 分支成立；房号房型未变
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：在住记录与房间主数据脱钩

**TC-RM-009 改房号唯一性**

- 需求/风险：FR-RM-002｜低
- 预期：改为已存在房号 → 409 `ROOM_NUMBER_EXISTS`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：同 TC-RM-006

**TC-RM-010 清洁完成（前台可执行）**

- 需求/风险：FR-RM-003｜中
- 前置：P-LOGIN（RECEPTIONIST）；R1=VACANT_DIRTY
- 步骤：PATCH `/api/v1/rooms/{R1}/status` `{status:"VACANT_CLEAN"}`
- 预期：200，`status=VACANT_CLEAN`（清洁完成登录用户即可，契约 §6 M5）
- 断言：`res.body.data.status==='VACANT_CLEAN'`
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：保洁流程线上化失效

**TC-RM-011 非法人工迁移**

- 需求/风险：FR-RM-003、NFR-CON-003｜高
- 前置：分别构造 VACANT_CLEAN / OCCUPIED / DISABLED 状态房
- 数据：`{status:"OCCUPIED"}`（人工设置）；OCCUPIED→VACANT_CLEAN；DISABLED→VACANT_CLEAN
- 预期：全部 409 `ROOM_STATUS_INVALID`（OCCUPIED 只能经入住/退房事务，shared/states.ts）；并发下状态已变 → 409「请刷新后重试」
- 断言：409 与 message 语义
- 位置：`apps/server/tests/integration/rooms.integration.test.ts` + `apps/server/tests/rooms.service.test.ts`（已实现）
- 自动化：是（L2+L1）
- 失败影响：绕过事务直接改房态=占用/计费不一致

**TC-RM-012 维修/停用/恢复仅 ADMIN**

- 需求/风险：FR-RM-003、NFR-SEC-004｜高
- 前置：R1=VACANT_CLEAN
- 步骤：RECEPTIONIST PATCH `{status:"MAINTENANCE"}` → ADMIN 同操作 → ADMIN `{MAINTENANCE→VACANT_DIRTY}`
- 预期：前台 403；ADMIN 全部 200（ADMIN_ONLY_ROOM_STATUSES，shared/states.ts:28）
- 断言：403/200 分支
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：前台误停用房源影响售卖

**TC-RM-013 房态迁移矩阵穷举**（待新增）

- 链接需求/风险：FR-RM-003、NFR-CON-003｜中
- 前置：单元层，注入 fake repository
- 数据：5×5 全排列 `{from,to}` × 角色 {ADMIN, RECEPTIONIST}
- 预期：与 `ROOM_STATUS_MANUAL_TRANSITIONS` 完全一致（25 对中合法 7 对 → 200；其余 → 409；涉及 MAINTENANCE/DISABLED 的合法对仅 ADMIN）
- 断言：矩阵逐一比对常量表
- 位置：`apps/server/tests/room-transitions-matrix.test.ts`（待新增，test-plan §7-9）
- 自动化：是（L1）
- 失败影响：状态机实现与契约漂移

**TC-RM-014 归档房型不可新增/分配房间**

- 需求/风险：FR-RT-002｜中
- 前置：P-ADMIN；T2=ARCHIVED
- 预期：POST rooms（T2）→ 409 `ROOM_TYPE_ARCHIVED`；改房间到 T2 → 409（rooms.service.ts:103/135）
- 位置：`apps/server/tests/integration/rooms.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：下线房型继续扩容

---

## 5. 客人域 TC-GS（FR-GS-001~004）

**TC-GS-001 关键字/手机号查询**

- 需求/风险：FR-GS-001｜低
- 数据：keyword=姓名子串 / 手机前缀
- 预期：模糊/前缀匹配 + 分页正确（契约 §7 G1）
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：档案检索失效

**TC-GS-002 分页与排序白名单**

- 需求/风险：FR-GS-001｜低
- 预期：sort 白名单 `createdAt,name`；越界 422
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：注入面

**TC-GS-003 创建成功（加密存储+掩码返回）**

- 需求/风险：FR-GS-002、NFR-SEC-007｜高
- 前置：P-LOGIN
- 数据：`{name:"张三", phone:"13800138000", idType:"ID_CARD", idNumber:"110101199001011234"}`
- 步骤：POST `/api/v1/guests` → 直查库
- 预期：200 返回 `idNumberMasked`（前 1 后 1 中间 *）；DB：`id_number_hash`=64 hex HMAC、`id_number_cipher` 布局 `iv(12)‖tag(16)‖密文`、**全库无明文**
- 断言：响应无 `idNumber` 明文字段；直查库断言密文布局与哈希格式
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）+ `apps/server/tests/crypto.test.ts`（已实现）
- 自动化：是（L2+L1）
- 失败影响：PII 泄漏=合规事故

**TC-GS-004 同证件号重复**

- 需求/风险：FR-GS-002｜中
- 前置：证件号已建档
- 预期：409 `GUEST_EXISTS`，details 含 `existingGuestId`；**不同 idType 同号码允许**（唯一键为 (id_type, id_number_hash)）
- 断言：`res.body.error.details[0].message` 含 existingGuestId
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：一客多档污染对账

**TC-GS-005 手机号格式**

- 需求/风险：FR-GS-002、NFR-SEC-005｜低
- 数据：`"12345"`（不匹配 `^1[3-9]\d{9}$|^\+?\d{6,20}$`）
- 预期：422 指向 phone
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：脏数据

**TC-GS-006 详情含近期预订摘要且恒掩码**

- 需求/风险：FR-GS-003、NFR-SEC-007｜中
- 预期：`idNumberMasked` 掩码；`recentBookings`（≤10 条，日期 YYYY-MM-DD）；响应无明文字段
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：PII 泄漏

**TC-GS-007 客人不存在**

- 需求/风险：FR-GS-003｜低
- 预期：404
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：—

**TC-GS-008 更新档案（证件不可改）**

- 需求/风险：FR-GS-004｜中
- 步骤：PATCH `{phone,remark}` → PATCH `{idNumber:"..."}` 或 `{idType:...}`
- 预期：前者 200；后者 409 `GUEST_EXISTS`「证件号不可修改，如需变更请新建档案」（A-16；口径待追认 Q-TP-06）
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：档案身份漂移

**TC-GS-009 非法输入 422**

- 需求/风险：FR-GS-002、NFR-SEC-005｜低
- 数据：name 超 100、idNumber 非法字符/长度
- 预期：422 details 指向字段
- 位置：`apps/server/tests/integration/guests.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：脏数据

---

## 6. 预订域 TC-BK（FR-BK-001~005）

**TC-BK-001 创建成功（价格快照与总价服务端计算）**

- 需求/风险：FR-BK-001、A-12｜高
- 前置：P-BK（T1 1 间可售）
- 数据：`{guestId:G1, roomTypeId:T1, checkInDate:d(2), checkOutDate:d(4), pricePerNight:288.00}`
- 步骤：POST `/api/v1/bookings`
- 预期：200 `status=CONFIRMED`、`totalPrice=576.00`（2 晚×288）、记录 createdBy；DB bookings 落快照
- 断言：`totalPrice===576.00`；DB `price_per_night=288.00`
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：核心交易/计费错误

**TC-BK-002 房量不足（含重叠判定）**

- 需求/风险：FR-BK-001、NFR-CON-001｜高
- 前置：T1 仅 1 间可售且 `[d(2),d(4))` 已有 1 条 CONFIRMED
- 数据：部分重叠 `[d(3),d(5))`；完全同区间；相邻 `[d(4),d(6))`
- 预期：重叠两例 409 `ROOM_TYPE_SOLD_OUT`（details 含剩余可售）；相邻例 200（半开区间，库设 §6.1）
- 断言：409/200 分支与错误码
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：超售=到店无房，直接资损与商誉

**TC-BK-003 日期倒挂/非法**

- 链接需求/风险：FR-BK-001、NFR-SEC-005｜中
- 数据：checkOut=checkIn；checkOut<checkIn
- 预期：422（`check_out > check_in`，库设 §2.6）
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：脏数据

**TC-BK-004 归档房型**

- 需求/风险：FR-BK-001、FR-RT-002｜中
- 预期：409 `ROOM_TYPE_ARCHIVED`（与 TC-RT-006 互补：此处为 B1 入口）
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：同 TC-RT-006

**TC-BK-005 并发创建不超售**

- 需求/风险：FR-BK-001、NFR-CON-001｜高
- 前置：P-INT；T1 恰 2 间可售、无既有预订
- 步骤：`Promise.all` 并发 10 个创建请求（同区间 `[d(2),d(5))`）
- 预期：恰 2 个 200，8 个 409 `ROOM_TYPE_SOLD_OUT`；DB 该区间 CONFIRMED 计数=2（房型行锁串行化，库设 §6.1）
- 断言：成功数与 DB 计数均为 2
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现，TC-BK-005）
- 自动化：是（L2，串行文件内并发）
- 失败影响：超售（最高风险缺陷）

**TC-BK-006 多条件组合查询**

- 需求/风险：FR-BK-002｜低
- 数据：status/guestId/keyword（姓名子串或手机前缀）/checkInDate 范围/checkOutDate 范围（增量参数）
- 预期：各过滤维度叠加正确（契约 §8 B2）
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：查询不可用

**TC-BK-007 日期范围过滤（闭区间）**

- 需求/风险：FR-BK-002｜低
- 预期：From/To 边界含当日
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：漏单

**TC-BK-008 详情含客人摘要**

- 需求/风险：FR-BK-003｜低
- 预期：guestName/guestPhone/roomTypeName 齐备
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：—

**TC-BK-009 预订不存在**

- 需求/风险：FR-BK-003｜低
- 预期：404
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：—

**TC-BK-010 已入住预订含 stayId**

- 需求/风险：FR-BK-003、FR-BK-006｜中
- 预期：CHECKED_IN 预订详情 `stayId` 非空；CONFIRMED 时为 null（契约 §8 B3）
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：追踪断链

**TC-BK-011 取消成功并释放房量**

- 需求/风险：FR-BK-004、NFR-CON-001｜高
- 步骤：取消 1 房售罄区间的预订 → 再订同区间
- 预期：取消后 `status=CANCELLED`、`cancelledAt`/`cancelReason` 持久化、记录保留（不物理删）；再订 200（释放生效，事务内先锁房型行）
- 断言：DB 行仍在 + 新预订成功
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：房量泄漏（假性售罄）

**TC-BK-012 重复取消**

- 需求/风险：FR-BK-004、NFR-CON-003｜中
- 预期：第二次 409 `BOOKING_STATUS_INVALID`「仅已确认预订可取消」
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：状态机穿透

**TC-BK-013 CHECKED_IN 不可取消**

- 需求/风险：FR-BK-004、NFR-CON-003｜中
- 预期：409（库设 §5.1：CHECKED_IN 为终态，后续看 stay）
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：在住被取消→账务断裂

**TC-BK-014 NO_SHOW 释放房量**

- 需求/风险：FR-BK-005｜中
- 前置：CONFIRMED 预订 `checkInDate<=d(0)`
- 预期：`status=NO_SHOW`；同区间可再订
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：房量泄漏

**TC-BK-015 非 CONFIRMED 不可标记 NO_SHOW**

- 需求/风险：FR-BK-005、NFR-CON-003｜中
- 预期：409 `BOOKING_STATUS_INVALID`；未到入住日（`checkInDate>d(0)`）→ 409「未到入住日，暂不可标记未到」（A-17）
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：状态机穿透

**TC-BK-016 预订入住成功（全链路联动）**

- 需求/风险：FR-BK-006、NFR-CON-002｜高
- 前置：P-SY；CONFIRMED 预订 B1（`[d(0),d(2))`，T1）
- 数据：`{roomId:R1, depositAmount:200.00}`（价格缺省）
- 步骤：POST `/api/v1/bookings/{B1}/check-in`
- 预期：200 stay `status=CHECKED_IN`、`pricePerNight`=预订价、`expectedCheckOutDate`=预订离店日；DB：booking→CHECKED_IN、room→OCCUPIED、occupancy 生成 `[d(0),d(2))` 逐日行、记录 createdBy（库设 §6.2）
- 断言：四表状态联动逐一验证
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：核心业务不可用/数据不一致

**TC-BK-017 房间已占用**

- 需求/风险：FR-BK-006、NFR-CON-002｜高
- 前置：R1 在目标区间已有占用行
- 预期：409 `ROOM_OCCUPIED`（占用预检 + uq 兜底）；整体回滚
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：同房双占

**TC-BK-018 房态不可分配**

- 需求/风险：FR-BK-006、NFR-CON-003｜中
- 前置：R2=MAINTENANCE（或 DISABLED）
- 预期：409 `ROOM_NOT_ASSIGNABLE`「房间处于维修或停用状态，不可分配」；回滚
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：维修房被卖

**TC-BK-019 日期与预订不符**

- 需求/风险：FR-BK-006、A-18｜中
- 数据：①`checkInDate>d(0)`（未到入住日）②预订 `checkOutDate<=d(0)`（离店日已到/已过）
- 预期：①409 `BOOKING_DATE_MISMATCH`；②409 `BOOKING_DATE_MISMATCH`「预订离店日期已到或已过，不可办理入住，请重新预订」（防 DB CHECK 误报 500，实现 P-2）
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：过期预订入住→0 晚计费异常

**TC-BK-020 重复办理入住**

- 需求/风险：FR-BK-006、NFR-CON-002/003｜高
- 步骤：对同一预订二次 check-in
- 预期：409 `BOOKING_STATUS_INVALID`「该预订已办理入住或已取消」；不产生第二条 stay（`stays.booking_id` UNIQUE 兜底）
- 断言：DB stays 计数=1
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：一订多住=资损

**TC-BK-021 并发同房双入住仅一次成功**

- 需求/风险：FR-BK-006、NFR-CON-002｜高
- 步骤：两笔**不同**预订（同房型）`Promise.all` 入住同一房间
- 预期：恰 1 个 200、1 个 409 `ROOM_OCCUPIED`；DB 该房仅 1 条在住（房间行锁 + 唯一约束双保险）
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现，TC-BK-021）
- 自动化：是（L2）
- 失败影响：同房双占

**TC-BK-022 日期边界（今日/过去/同日/相邻）**

- 需求/风险：FR-BK-001、A-10｜中
- 数据：checkIn=d(0)（应成功）；checkIn=d(-1)（422）；checkIn=checkOut（422）
- 预期：如上（bookings.service.ts:75 本地今日判断，不依赖服务器时区）
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（已实现）+ `apps/server/tests/bookings.service.test.ts`（已实现）
- 自动化：是（L2+L1）
- 失败影响：边界日订单错误

**TC-BK-023 同一客人重叠时段预订（语义固化）**（待新增，Q-TP-01）

- 需求/风险：FR-BK-001｜中
- 前置：P-BK（≥2 间可售）；客人 G1 已有 `[d(2),d(4))` CONFIRMED 预订
- 步骤：同客人再创建 `[d(3),d(5))` 预订
- 预期（当前模型）：**200 成功**（无客人维度冲突规则，仅受房型容量约束）——本用例固化现行语义；若业务裁决应拒绝，则该用例预期变更为 409 并触发需求变更（Q-TP-01）
- 断言：`res.status===200`（现状）
- 位置：`apps/server/tests/integration/bookings.integration.test.ts`（待新增补充用例）
- 自动化：是（L2）
- 失败影响：语义未固化→后续改动无回归网

---

## 7. 入住域 TC-SY（FR-SY-001~004）

**TC-SY-001 walk-in 入住成功**

- 需求/风险：FR-SY-001、NFR-CON-002｜高
- 前置：P-SY
- 数据：`{guestId:G1, roomId:R1, pricePerNight:318.00, expectedCheckOutDate:d(2), depositAmount:300.00}`
- 步骤：POST `/api/v1/stays`
- 预期：200 `bookingId=null`、`status=CHECKED_IN`；DB：occupancy `[d(0),d(2))`、room→OCCUPIED、createdBy 记录（契约 §9 S1）
- 断言：三表联动
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：散客业务不可用

**TC-SY-002 walk-in 房间已占用**

- 需求/风险：FR-SY-001、NFR-CON-002｜高
- 预期：409 `ROOM_OCCUPIED`
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：同房双占

**TC-SY-003 walk-in 房态非法**

- 需求/风险：FR-SY-001、NFR-CON-003｜中
- 前置：R1=MAINTENANCE
- 预期：409 `ROOM_NOT_ASSIGNABLE`
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：不可用房被售

**TC-SY-004 并发双 walk-in 仅一次成功**

- 需求/风险：FR-SY-001、NFR-CON-002｜高
- 步骤：`Promise.all` 两个 walk-in 同房同区间
- 预期：1×200 + 1×409 `ROOM_OCCUPIED`；DB 仅 1 条 stay（TC-SY-004）
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：同房双占

**TC-SY-005 在住/已退筛选**

- 需求/风险：FR-SY-002｜低
- 预期：status/roomId/keyword 过滤正确
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：—

**TC-SY-006 列表分页排序**

- 需求/风险：FR-SY-002｜低
- 预期：白名单 `checkInAt,expectedCheckOutDate,status`；越界 422
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：—

**TC-SY-007 在住详情费用实时累计**

- 需求/风险：FR-SY-003、A-06/A-19｜高
- 前置：在住 S1（单价 288，`[d(0),d(2))`，押金 200）
- 预期：`currentCharges={roomFee:576.00, miscTotal:0, total:614 → 此处 576.00, nights:2}`（在住杂费恒 0，A-19）；`order=null`；`actualCheckOutAt=null`
- 断言：`currentCharges.roomFee===576.00 && currentCharges.nights===2`
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：费用显示错误→结算纠纷

**TC-SY-008 已退房详情含订单摘要（杂费反推）**

- 需求/风险：FR-SY-003｜中
- 预期：`order` 非空（OrderListItem：guestName/roomNumber）；`miscTotal` 由账单 MISC 明细精确汇总
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：历史账查询失真

**TC-SY-009 退房结算成功（全副作用）**

- 需求/风险：FR-SY-004、A-06/A-07｜高
- 前置：S1 在住（288×2 晚，押金 200）
- 数据：`{paymentMethod:"WECHAT", miscItems:[{name:"迷你吧消费", amount:38.00}]}`
- 步骤：POST `/api/v1/stays/{S1}/checkout`
- 预期：200 订单：items=[ROOM_FEE 576, MISC 38, DEPOSIT_APPLIED 200]、`totalAmount=614.00`、`paidAmount=414.00`、`status=PAID`；DB：stay→CHECKED_OUT+`actual_check_out_at`、room→**VACANT_DIRTY**、occupancy 删除 `date>=d(0)`（当日及未来）、审计 `stay.checkout`（库设 §6.3 全步骤）
- 断言：金额四项 + 三表状态 + occupancy 计数=0
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：结算错误/房态错乱=资损

**TC-SY-010 重复退房**

- 需求/风险：FR-SY-004、NFR-CON-002/003｜高
- 预期：第二次 409 `STAY_STATUS_INVALID`「该入住记录已退房，不可重复结算」；DB 仅一张账单（uq_orders_stay）
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：重复收款

**TC-SY-011 押金抵扣金额校验**

- 需求/风险：FR-SY-004、A-07｜高
- 数据：①押金 200 < 总额 614（抵扣 200，实收 414）②押金 ≥ 总额（抵扣封顶=总额，实收 0，DEPOSIT_APPLIED=总额）
- 预期：`depositApplied=min(deposit,total)`、`paidAmount=total−depositApplied`（实现 Decimal 精确）
- 断言：两组数值
- 位置：`apps/server/tests/integration/stays.integration.test.ts` + `apps/server/tests/integration/orders.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：多收/少收

**TC-SY-012 并发退房仅一次成功**

- 需求/风险：FR-SY-004、NFR-CON-002｜高
- 步骤：`Promise.all` 两个 checkout 同一 stay
- 预期：1×200 + 1×409；仅一张账单（TC-SY-012）
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：重复收款

**TC-SY-013 退房后当日该房可再售（显式回归）**（待新增，缺口 G-5）

- 需求/风险：FR-SY-004、A-05｜高
- 前置：R1 在住 S1（`expectedCheckOutDate=d(1)`）
- 步骤：今日退房 S1 → GET `/rooms/available?roomTypeId=T1&checkInDate=d(0)&checkOutDate=d(2)`（含 R1）→ 同日对 R1 办理 walk-in `[d(0),d(2))`
- 预期：退房后 R1 出现在可用列表；同日再入住 200，occupancy 重新生成（退房事务已删除 `date>=今日` 占用）
- 断言：available 含 R1；第二次入住 200 且 DB occupancy 计数=2
- 位置：`apps/server/tests/integration/same-day-resale.integration.test.ts`（待新增，test-plan §7-5）
- 自动化：是（L2）
- 失败影响：退房日房量假性占用=收入损失

**TC-SY-014 凌晨入住计晚数（时区边界）**

- 需求/风险：FR-SY-003/004、A-10｜高
- 前置：构造 `checkInAt` 位于酒店本地 `d(0) 00:00–08:00`（=UTC `d(-1) 16:00–24:00`）
- 预期：晚数 = `expected_check_out_date − 酒店本地日(checkInAt)`，**不多计一晚**；结算房费按此晚数（实现 P-1 修复口径）
- 断言：`currentCharges.nights` 与结算 `房费 n 晚` 一致
- 位置：`apps/server/tests/integration/stays.integration.test.ts` + `apps/server/tests/hotel-date.test.ts`（已实现）
- 自动化：是（L2+L1）
- 失败影响：多收一晚房费

**TC-SY-015 杂费项边界**

- 需求/风险：FR-SY-004、NFR-SEC-005｜中
- 数据：0 项（合法）；20 项（合法上限）；21 项（422）；单项 0.00（422）/100000（422）；name 101 字（422）
- 预期：如上（契约 §9 S4 校验）
- 位置：`apps/server/tests/integration/stays.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：脏账单

---

## 8. 订单域 TC-OD（FR-OD-001~002，只读）

**TC-OD-001 列表：日期范围（酒店本地日）+ 分页**

- 需求/风险：FR-OD-001、A-10｜中
- 数据：`createdFrom/createdTo` 闭区间（本地日 → 服务端换算 `[起日00:00, 止日+1 00:00)` UTC）；stayId 过滤
- 预期：跨时区边界订单归属正确；sort 白名单 `createdAt`
- 位置：`apps/server/tests/integration/orders.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：对账错日

**TC-OD-002 详情明细完整**

- 需求/风险：FR-OD-002｜中
- 预期：items 三类明细、金额四项、支付方式、note 齐备（契约 §10 O2）
- 位置：`apps/server/tests/integration/orders.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：账单不可审计

**TC-OD-003 订单不存在**

- 需求/风险：FR-OD-002｜低
- 预期：404；非法 id 422
- 位置：`apps/server/tests/integration/orders.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：—

**TC-OD-004 最小金额**

- 需求/风险：FR-SY-004、NFR 精度｜中
- 数据：房价 0.01×1 晚、押金 0
- 预期：total=0.01、paid=0.01、无 DEPOSIT_APPLIED 项
- 位置：`apps/server/tests/integration/orders.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：分位金额被吞

**TC-OD-005 押金等于总额**

- 需求/风险：A-07｜中
- 预期：depositApplied=total、paid=0、含 DEPOSIT_APPLIED 明细
- 位置：`apps/server/tests/integration/orders.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：多收

**TC-OD-006 精度不漂移**

- 需求/风险：A-09｜中
- 数据：33.33×3 晚 + 0.01
- 预期：total=100.00（DECIMAL 精确，无浮点误差）
- 位置：`apps/server/tests/integration/orders.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：分位累积误差

**TC-OD-007 大额与客户端伪造**

- 需求/风险：NFR-SEC-005｜中
- 数据：杂费 99999.99；请求体夹带 `totalAmount` 伪造字段
- 预期：大额精确保留；伪造字段 → 422（严格 schema 拒绝未知字段）
- 位置：`apps/server/tests/integration/orders.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：客户端篡改价格

---

## 9. 安全专项 TC-SEC（NFR-SEC-001~009）

**TC-SEC-001 未登录访问全部受保护端点**

- 需求/风险：NFR-SEC-004｜高
- 前置：无 Cookie
- 步骤：对契约 §2 索引**全部**端点（含 M2/R1 等易漏项）逐一请求
- 预期：全部 401 `SESSION_EXPIRED`（默认拒绝）
- 断言：逐路由断言矩阵
- 位置：`apps/server/tests/route-authz.test.ts`（已实现，fake session 逐路由）+ 各域 integration 401 用例（已实现）
- 自动化：是（L3+L2）
- 失败影响：匿名越权读/写

**TC-SEC-002 RECEPTIONIST 调管理端点**

- 需求/风险：NFR-SEC-004｜高
- 预期：U/R2-R4/M3/M4 全部 403（见 TC-USER-002/TC-RM-012，此处为矩阵汇总）
- 位置：`apps/server/tests/route-authz.test.ts`（已实现）
- 自动化：是（L3）
- 失败影响：越权

**TC-SEC-003 停用用户会话即刻失效**

- 需求/风险：NFR-SEC-004｜高
- 同 TC-USER-007（交叉引用，不重复实现）
- 位置：`apps/server/tests/integration/{users,auth}.integration.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：离职账号残留权限

**TC-SEC-004 锁定 15 分钟恢复**

- 需求/风险：NFR-SEC-003｜中
- 同 TC-AUTH-004（交叉引用）
- 位置：`apps/server/tests/auth-service.test.ts`（已实现）
- 自动化：是（L1）
- 失败影响：账号永久锁死

**TC-SEC-005 跨源 Origin 拒绝**

- 需求/风险：NFR-SEC-009｜高
- 前置：任意非 GET 业务请求
- 数据：`Origin: https://evil.example`
- 预期：403 `FORBIDDEN`（CSRF 防线 2；同源 Origin 放行）
- 位置：`apps/server/tests/app.test.ts`（已实现）
- 自动化：是（L2）
- 失败影响：跨站伪造写入

**TC-SEC-006 错误响应不含敏感字段**

- 需求/风险：NFR-SEC-001/007｜高
- 步骤：构造 422/409/500 各类失败响应
- 预期：响应体无 `passwordHash`、无证件明文；500 仅 `INTERNAL_ERROR`+requestId（不含堆栈）
- 位置：`apps/server/tests/app.test.ts` + 各域 integration（已实现）
- 自动化：是（L2）
- 失败影响：凭据/PII 泄漏

**TC-SEC-007 日志脱敏**

- 需求/风险：NFR-SEC-008｜高
- 步骤：执行登录（含密码）/客人创建，捕获日志输出
- 预期：password、cookie、idNumber 均为 `[REDACTED]`；明文密码/哈希/sid 不出现
- 位置：`apps/server/tests/logger.test.ts` + `apps/server/tests/integration/auth.integration.test.ts`（已实现）
- 自动化：是（L1+L2）
- 失败影响：日志成为泄漏源

**TC-SEC-008 排序参数注入**

- 需求/风险：NFR-SEC-006｜高
- 数据：`sort=id;DROP TABLE users`、`sort=passwordHash`
- 预期：422（白名单拒绝，标识符不进 SQL）
- 位置：`apps/server/tests/pagination.test.ts` + 各域 integration 注入用例（已实现）
- 自动化：是（L1+L2）
- 失败影响：SQL 注入

**TC-SEC-009 会话固定**

- 需求/风险：NFR-SEC-002｜中
- 同 TC-AUTH-009（交叉引用；待新增）
- 位置：待新增（见 TC-AUTH-009）
- 自动化：是（L2）
- 失败影响：会话固定攻击

**TC-SEC-010 证件号恒掩码**

- 需求/风险：NFR-SEC-007｜高
- 步骤：G1 列表/详情/创建/查重错误响应全部检查
- 预期：一切响应仅 `idNumberMasked`（前 1 后 1），无明文字段（安全 §12）
- 位置：`apps/server/tests/integration/guests.integration.test.ts` + `apps/server/tests/guests.service.test.ts`（已实现）
- 自动化：是（L2+L1）
- 失败影响：PII 泄漏

---

## 10. 前端专项 TC-UI（组件层，jsdom）

**TC-UI-001 提交中防重复点击**（待新增，缺口 G-8）

- 需求/风险：NFR-TST-001、架构 §2.10｜中
- 前置：挂载含提交按钮的表单组件（如 BookingCreateDialog/CheckInDialog）；http 请求挂起（可控 promise）
- 步骤：点击提交 → 请求未返回前再点 2 次 → 放行请求
- 预期：按钮 `loading`+`disabled`；仅发出 **1 次** API 请求；失败后按钮恢复可点
- 断言：mock http 调用计数=1；按钮 disabled 属性存在
- 位置：`apps/web/tests/submit-loading.spec.ts`（待新增，test-plan §7-13）
- 自动化：是（L4）
- 失败影响：重复建单/重复结算请求（服务端虽 409 兜底，但产生噪音与误判）

**TC-UI-002 CheckoutDialog 费用预览与杂费录入**（待新增）

- 需求/风险：FR-SY-004、T-17 验收｜高
- 前置：挂载 CheckoutDialog，注入在住数据（288×2 晚、押金 200）
- 步骤：查看初始预览 → 添加杂费行 `{迷你吧,38}` → 添加空行/删除行 → 选支付方式 → 提交
- 预期：预览显示房费 576、杂费动态合计、押金抵扣 200、应付 414；提交载荷仅 `{paymentMethod, miscItems[], note}`（不含客户端计算的金额）
- 断言：预览数值；`expect(postBody).not.toHaveProperty('totalAmount')`
- 位置：`apps/web/tests/checkout-dialog.spec.ts`（待新增，test-plan §7-10）
- 自动化：是（L4）
- 失败影响：结算界面金额误导员工

**TC-UI-003 CheckInDialog 可用房过滤**（待新增）

- 需求/风险：FR-BK-006、T-17 验收｜中
- 前置：挂载对话框；mock `/rooms/available` 返回混合状态房
- 预期：仅展示服务端返回的可用房（前端不做二次过滤规则）；选择后提交 `{roomId, depositAmount, pricePerNight?}`
- 位置：`apps/web/tests/check-in-dialog.spec.ts`（待新增，test-plan §7-11）
- 自动化：是（L4）
- 失败影响：排房错误

**TC-UI-004 GuestPicker 搜索与 409 引导**（待新增）

- 需求/风险：FR-GS-002、T-15 验收｜中
- 步骤：关键字搜索 → 选中回填 → 模拟创建客人返回 409 `GUEST_EXISTS`（含 existingGuestId）
- 预期：列表过滤；选中回填姓名/电话；409 时 UI 引导「选用已有档案」而非报错卡死
- 位置：`apps/web/tests/guest-picker.spec.ts`（待新增，test-plan §7-12）
- 自动化：是（L4）
- 失败影响：重复建档流程断裂

**TC-UI-005 422 字段级错误映射**（部分已有，补全）

- 需求/风险：NFR-SEC-005、架构 §2.4｜中
- 步骤：提交表单 → mock 422 `{details:[{field:"checkInDate",...}]}`
- 预期：对应表单项展示字段错误（ElForm validateField 映射），非全局弹窗重复提示
- 位置：`apps/web/tests/request.spec.ts`（details 保留，已实现）+ `apps/web/tests/form-field-errors.spec.ts`（映射展示，待新增 §7-14）
- 自动化：是（L4）
- 失败影响：用户看不懂失败原因

**TC-UI-006 网络失败三态**

- 需求/风险：架构 §2.4/§2.10｜中
- 步骤：①列表请求超时/断网 → ErrorState+重试按钮；②写操作网络失败 → ElMessage「网络异常，请稍后重试」；重试成功后恢复
- 预期：如上；无自动重试
- 位置：`apps/web/tests/request.spec.ts`（超时映射，已实现）+ `apps/web/tests/{rooms,stay-list,stay-detail}-view.spec.ts`（加载失败重试，已实现）
- 自动化：是（L4）
- 失败影响：白屏/卡死观感

**TC-UI-007 空态与筛选无结果**

- 需求/风险：架构 §2.10｜低
- 预期：无数据显示「暂无数据」；有筛选时显示「筛选无结果+清空筛选」
- 位置：`apps/web/tests/rooms-view.spec.ts` 等（空状态已实现；筛选无结果文案分支待补）
- 自动化：是（L4）
- 失败影响：UX

**TC-UI-008 401 跳转与防死循环**

- 需求/风险：架构 §2.7｜高
- 步骤：登录后任一请求 401 → 观察跳转；redirect 参数以 `/` 开头且非 `//` 才回跳
- 预期：清 authStore → `/login?redirect=原路径`；登录页自身请求 401 不触发跳转（防死循环）；开放重定向被拒
- 位置：`apps/web/tests/request.spec.ts` + `apps/web/tests/guards.spec.ts`（已实现）
- 自动化：是（L4）
- 失败影响：会话过期后体验崩溃或开放重定向漏洞

**（补充）TC-UI-008b Dashboard 未接入状态**（待新增，P2）

- 需求/风险：Q-STAT 范围外声明｜低
- 预期：统计页展示「未接入」明确提示，不渲染任何 Mock 指标
- 位置：`apps/web/tests/dashboard-view.spec.ts`（待新增，test-plan §7-18）
- 自动化：是（L4）
- 失败影响：误导运营

---

## 11. 浏览器端到端 TC-E2E（NFR-TST-002，Playwright，待建）

> 设计原则：仅主流程闭环（8 条），字段级断言一律留在 L2/L4；全部在干净数据卷环境执行并留录屏。

**TC-E2E-001 登录-登出闭环**

- 需求/风险：FR-AUTH-001~003｜高
- 前置：P-E2E
- 步骤：错误密码登录（观察统一错误提示）→ 正确登录 → 断言进入房态看板 → 登出 → 回登录页 → 浏览器后退验证需重新登录
- 预期：如上；错误文案与后端一致
- 断言：`await expect(page).toHaveURL(/\/login/)`；看板菜单按角色渲染
- 位置：`e2e/tests/auth.spec.ts`（待新增，test-plan §7-3）
- 自动化：是（L5）
- 失败影响：入口不可用

**TC-E2E-002 预订主流程（含 SOLD_OUT 分支）**

- 需求/风险：FR-GS-002、FR-BK-001/002/004｜高
- 步骤：建客人 → 建预订 `[d(2),d(4))` → 列表可见 → 再订同区间至售罄（1 房房型）观察 409 提示 → 取消首单 → 重订成功
- 预期：售罄提示后端 message；取消后房量释放可重订
- 位置：`e2e/tests/booking-flow.spec.ts`（待新增）
- 自动化：是（L5）
- 失败影响：核心流程断裂

**TC-E2E-003 预订入住-退房-订单核对**

- 需求/风险：FR-BK-006、FR-SY-003/004、FR-OD-002｜高
- 步骤：预订入住（选房、押金 200）→ 在住列表/详情费用 576 → 退房（杂费 38、微信支付）→ 核对订单详情总额 614/实收 414 → 房态看板该房变 VACANT_DIRTY
- 预期：全链路 UI 数值与 §7 计算一致
- 位置：`e2e/tests/checkin-checkout-flow.spec.ts`（待新增）
- 自动化：是（L5）
- 失败影响：主营收流程不可用

**TC-E2E-004 walk-in 流程**

- 需求/风险：FR-SY-001｜中
- 步骤：在住页 → walk-in 对话框 → 选客人/房/价格/离店日 → 入住 → 退房
- 预期：闭环成功
- 位置：`e2e/tests/walkin-flow.spec.ts`（待新增）
- 自动化：是（L5）
- 失败影响：散客流程不可用

**TC-E2E-005 权限路径（前端隐藏≠权限）**

- 需求/风险：NFR-SEC-004、架构 §2.9｜高
- 步骤：RECEPTIONIST 登录 → 菜单无「员工管理」→ **直接输入 URL** `/users` → 403 页；直调管理 API（浏览器 fetch）403
- 预期：403 视图（非重定向登录页）；后端 403
- 位置：`e2e/tests/permission.spec.ts`（待新增）
- 自动化：是（L5）
- 失败影响：仅靠前端隐藏=越权

**TC-E2E-006 会话过期跳转**

- 需求/风险：FR-AUTH-002、架构 §2.7｜中
- 步骤：登录 → 使会话失效（调 logout API 但保持页面）→ 页面内导航触发请求
- 预期：跳 `/login?redirect=...`；重新登录后回到原页
- 位置：`e2e/tests/session.spec.ts`（待新增）
- 自动化：是（L5）
- 失败影响：过期后死循环/丢失上下文

**TC-E2E-007 提交防重（慢网络）**

- 需求/风险：架构 §2.10｜中
- 步骤：Playwright route 拦截延迟入住请求 3s → 双击提交按钮
- 预期：仅 1 次请求发出；按钮期间禁用
- 位置：`e2e/tests/checkin-checkout-flow.spec.ts`（并入，待新增）
- 自动化：是（L5）
- 失败影响：重复请求噪音

**TC-E2E-008 刷新会话重建**

- 需求/风险：FR-AUTH-003｜低
- 步骤：登录 → `page.reload()` → 断言仍在看板（非登录页）
- 位置：`e2e/tests/auth.spec.ts`（并入，待新增）
- 自动化：是（L5）
- 失败影响：刷新即登出

---

## 12. 并发补充 TC-CON（NFR-CON-001/002，待新增）

**TC-CON-001 停用房间 vs 并发预订（对称锁）**

- 需求/风险：NFR-CON-001、库设 §6.1 对称规则｜高
- 前置：P-INT；T1 2 间可售（R1、R2），无既有预订
- 步骤：`Promise.all`：①ADMIN `PATCH /rooms/{R2}/status {status:"DISABLED"}` ②N 个并发 `POST /bookings` `[d(2),d(4))`
- 预期：两操作经**房型行锁**串行化；任何 interleaving 下 `CONFIRMED 数 ≤ 停用生效后的可售数`；无超售、无「停用后仍计入可售」窗口
- 断言：`CONFIRMED 数 ≤ 2`（若停在后则为 1），且 `sold out` 拒绝数与之互补
- 位置：`apps/server/tests/integration/concurrency-symmetric.integration.test.ts`（待新增，test-plan §7-7）
- 自动化：是（L2）
- 失败影响：停用竞态窗口超售

**TC-CON-002 取消 vs 创建竞态**

- 需求/风险：NFR-CON-001｜高
- 前置：T1 1 间可售；已有 1 条 CONFIRMED `[d(2),d(4))`（已售罄）
- 步骤：`Promise.all`：①cancel 该预订 ②并发创建同区间新预订
- 预期：串行化后二选一皆合法：新单成功（占用释放的容量）或新单 409（先于取消提交）；**不得**出现「取消成功但新单 409 且容量未释放」的中间态错乱；最终 DB 容量计数与状态一致
- 断言：终态 `CONFIRMED 数 ∈ {0,1}` 且与响应互补；无孤儿容量
- 位置：同 TC-CON-001 文件（待新增）
- 自动化：是（L2）
- 失败影响：房量计数漂移

**TC-CON-003 数据库唯一约束直接验证（绕过应用）**

- 需求/风险：NFR-CON-002｜高
- 前置：P-INT；直连测试库
- 步骤：直接 SQL 插入与既有行冲突的 ①`room_occupancy(room_id,date)` ②`orders(stay_id)` ③`stays(booking_id)` 重复行
- 预期：三者均被唯一约束拒绝（ERROR 1062）——应用层 bug 时数据库仍兜底（ADR-006）
- 断言：`await expect(insert).rejects.toThrow(/Duplicate entry/)`
- 位置：`apps/server/tests/integration/db-constraints.integration.test.ts`（待新增，test-plan §7-6）
- 自动化：是（L2）
- 失败影响：最后防线缺失

---

## 13. 数据库结构验证 TC-DB（待新增）

**TC-DB-001 唯一约束存在性**

- 需求/风险：库设 §3、NFR-CON-002｜中
- 步骤：查询 `information_schema.TABLE_CONSTRAINTS`/`STATISTICS`
- 预期：7 个唯一键全部存在：`uq_users_username`、`uq_room_types_code`、`uq_rooms_room_number`、`uq_guests_id_number(id_type,id_number_hash)`、`uq_bookings_booking_stay(stays.booking_id)`、`uq_occupancy_room_date`、`uq_orders_stay`
- 断言：逐键 `expect(rows).toContain(...)`；**迁移漂移即失败**
- 位置：`apps/server/tests/integration/db-constraints.integration.test.ts`（待新增）
- 自动化：是（L2）
- 失败影响：并发兜底静默消失

**TC-DB-002 CHECK 约束存在性**

- 需求/风险：库设 §2/§7｜中
- 预期：`chk` 约束按迁移 SQL 实际清单存在（base_price≥0、capacity 1–20、check_out>check_in、expected>DATE(check_in)、amount>0 等）；`check_in_date >= CURDATE()-1` 因 MySQL 限制**不落库**（库设 §2.6 实现说明）——该规则由服务层 TC-BK-022 覆盖
- 位置：同上文件（待新增）
- 自动化：是（L2）
- 失败影响：非法数据入库

**TC-DB-003 关键索引存在性**

- 需求/风险：库设 §4、NFR-PERF-001｜中
- 预期：`idx_bookings_capacity`、`idx_rooms_type`、`idx_stays_room`、`idx_orders_created`、`idx_occupancy_room_date` 等存在
- 位置：同上文件（待新增）
- 自动化：是（L2）
- 失败影响：查询性能退化

---

## 14. 运维专项 TC-OPS（NFR-DEP-001，待新增）

**TC-OPS-001 迁移失败 fail-fast**

- 需求/风险：库设 §7.2｜高
- 前置：P-DEP；临时注入一条必然失败的迁移 SQL（测试分支）
- 步骤：`docker compose -f compose.prod.yml up api`
- 预期：容器启动命令 `prisma migrate deploy` 失败 → 容器退出（exit≠0），**不启动** Express 监听；`docker ps` 显示非 running/healthy
- 断言：`docker inspect` State.ExitCode≠0；`curl /api/health` 不可达
- 位置：`scripts/verify-deployment.sh`（待新增，test-plan §7-16）
- 自动化：是（L6，脚本）
- 失败影响：结构漂移下服务带病上线

**TC-OPS-002 迁移幂等**

- 需求/风险：NFR-DEP-001｜中
- 步骤：连续两次 `prisma migrate deploy`（容器重启两次）
- 预期：第二次无新迁移执行、正常启动（幂等）
- 位置：同上（待新增）
- 自动化：是（L6）
- 失败影响：重启即故障

**TC-OPS-003 api 重启后会话存活**

- 需求/风险：FR-AUTH-003、ADR-002｜中
- 步骤：登录 → `docker compose restart api` → 原 Cookie GET `/auth/me`
- 预期：200（sessions 落库；内存限流计数清零可接受——安全 §3 单实例语义）
- 位置：同上（待新增）
- 自动化：是（L6）
- 失败影响：每次发版全员掉线

**TC-OPS-004 mysql 重启后恢复**

- 需求/风险：NFR-DEP-001｜中
- 步骤：写入业务数据 → `docker compose restart mysql` → 等 api healthcheck 恢复 → 查询数据
- 预期：InnoDB 数据完好；api 因 `restart: unless-stopped` + depends_on healthcheck 自动恢复
- 位置：同上（待新增）
- 自动化：是（L6）
- 失败影响：数据库抖动后服务不恢复

**TC-OPS-005 seed 仅空表执行**

- 需求/风险：库设 §7.3、安全 §10｜中
- 步骤：已有管理员的库上再跑 seed（`--profile tools run --rm seed`）
- 预期：不创建新管理员、不覆盖既有密码（空表判断）；`ADMIN_INITIAL_PASSWORD` 仅 seed 使用
- 位置：同上（待新增）
- 自动化：是（L6）
- 失败影响：误重置生产管理员凭证

---

## 15. 部署与环境配置 TC-DEP（NFR-DEP-001）

**TC-DEP-001 compose 配置校验**

- 需求/风险：NFR-DEP-001｜低
- 步骤：`pnpm compose:config`（dev+prod 两文件）
- 预期：`docker compose config --quiet` 0 退出码（占位 env 下必填项校验生效）
- 位置：根 `package.json` `compose:config` 脚本（已实现）
- 自动化：是（L6）
- 失败影响：配置漂移

**TC-DEP-002 一键拉起与 healthcheck**

- 需求/风险：NFR-DEP-001｜高
- 前置：P-DEP
- 步骤：`docker compose -f compose.prod.yml up -d --build` → 轮询三容器状态
- 预期：web/api/mysql 均 healthy（依赖顺序：mysql→api→web）
- 位置：`scripts/verify-deployment.sh`（待新增）
- 自动化：是（L6）
- 失败影响：交付不可用

**TC-DEP-003 Nginx 同源反代与 SPA 回退**

- 需求/风险：ADR-010｜中
- 步骤：`GET /`（静态 200）→ `GET /bookings`（SPA 回退 index.html）→ `GET /api/v1/room-types`（经反代，未登录 401 信封）
- 预期：同源部署成立（Cookie 链路）；反代转发 `Host`/`X-Forwarded-*`（nginx.conf:15-18）
- 位置：同上（待新增）
- 自动化：是（L6）
- 失败影响：跨源 Cookie/CSRF 防线失效

**TC-DEP-004 密钥零入库**

- 需求/风险：安全 §10｜高
- 步骤：`gitleaks detect`（全历史）+ 确认 `.env` 被 `.gitignore` 覆盖
- 预期：0 告警；`GUEST_ID_*`/`ADMIN_INITIAL_PASSWORD` 等不出现在版本库
- 位置：CI job（待新增，test-plan §7-1）
- 自动化：是（L6/CI）
- 失败影响：密钥泄漏

**TC-DEP-005 部署后冒烟**

- 需求/风险：NFR-DEP-001、T-20 验收｜高
- 步骤：`GET /api/health` → 用种子管理员登录 → `GET /room-types`、`GET /rooms`（只读）
- 预期：health `{status:"ok"}`；登录 200+Cookie；只读接口 200 信封且带 `X-Request-Id`
- 位置：`scripts/deploy-smoke.mjs`（待新增，test-plan §7-15）
- 自动化：是（L6）
- 失败影响：带病上线

**TC-DEP-006 环境变量缺失 fail-fast**

- 需求/风险：安全 §10、ADR-007｜中
- 步骤：移除 `DATABASE_URL`/密钥长度不足启动 api
- 预期：进程拒绝启动并指明字段（env zod 校验）
- 位置：`apps/server/tests/env.test.ts`（单元，已实现）；容器级并入 verify-deployment（待新增）
- 自动化：是（L1+L6）
- 失败影响：默认值静默运行=配置事故

**TC-DEP-007 安全响应头与暴露面**

- 需求/风险：安全 §7/§11｜中
- 步骤：curl 检查响应头；`docker compose ps`/`docker inspect` 检查端口
- 预期：`X-Content-Type-Options: nosniff`、CSP（含 `style-src 'unsafe-inline'` 记录取舍 Q-10）；**mysql 不映射宿主端口**；仅 web 暴露 80（`WEB_HTTP_PORT`）
- 位置：verify-deployment 脚本（待新增）；生产 `Secure`/HSTS 待 TLS 后**手动**（Q-TP-04）
- 自动化：部分（头与端口自动；TLS 手动）
- 失败影响：暴露面扩大/头缺失

---

## 16. 手动/探索性测试项（不适合自动化或按设计为手动）

| 编号  | 内容                                                                                 | 关联         | 原因                                            |
| ----- | ------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------- |
| TM-01 | 生产 TLS 链路：`Secure` Cookie、HSTS、HTTP→HTTPS 301                                 | NFR-SEC-002  | 证书未提供（Q-09/Q-TP-04）                      |
| TM-02 | NFR-PERF-001 性能抽查：≤10 万行数据集下列表端点 P95<300ms（EXPLAIN 命中索引）        | NFR-PERF-001 | 设计明确「非自动化门禁」；需造数脚本（Q-TP-10） |
| TM-03 | mysqldump 备份/恢复演练（备份卷留存 14 天）                                          | 库设 §7.4    | 运维演练                                        |
| TM-04 | UX 走查：三态/表单/对话框交互观感、Element Plus 行为与设计偏差复核（开发计划风险项） | T-17         | 主观判断                                        |
| TM-05 | 真实 15 分钟锁定恢复等待（可选抽查，日常由 TC-AUTH-004 时钟注入覆盖）                | FR-AUTH-001  | 时间成本（Q-TP-05）                             |
| TM-06 | 全新主机 30 分钟一键部署验收（对照 docs/deployment.md，待文档落地）                  | NFR-DEP-001  | 真实环境                                        |

---

## 17. 用例统计

| 域       | 编号区间 | 数量    | 已实现                            | 待新增             | 仅手动          |
| -------- | -------- | ------- | --------------------------------- | ------------------ | --------------- |
| TC-AUTH  | 001~009  | 9       | 8                                 | 1（009）           | —               |
| TC-USER  | 001~010  | 10      | 10                                | —                  | —               |
| TC-RT    | 001~007  | 7       | 6                                 | 1（005）           | —               |
| TC-RM    | 001~014  | 14      | 13                                | 1（013）           | —               |
| TC-GS    | 001~009  | 9       | 9                                 | —                  | —               |
| TC-BK    | 001~023  | 23      | 22                                | 1（023）           | —               |
| TC-SY    | 001~015  | 15      | 14                                | 1（013）           | —               |
| TC-OD    | 001~007  | 7       | 7                                 | —                  | —               |
| TC-SEC   | 001~010  | 10      | 9                                 | 1（009）           | —               |
| TC-UI    | 001~008b | 9       | 4（005 部分、006、007 部分、008） | 5（001~004、008b） | —               |
| TC-E2E   | 001~008  | 8       | 0                                 | 8                  | —               |
| TC-CON   | 001~003  | 3       | 0                                 | 3                  | —               |
| TC-DB    | 001~003  | 3       | 0                                 | 3                  | —               |
| TC-OPS   | 001~005  | 5       | 0                                 | 5                  | —               |
| TC-DEP   | 001~007  | 7       | 2（001、006 单元部分）            | 5                  | 部分（007 TLS） |
| TM       | 01~06    | 6       | —                                 | —                  | 6               |
| **合计** |          | **145** | **104**                           | **35**             | **6**           |

> 交叉引用说明：TC-SEC-003/004/009 分别与 TC-USER-007/TC-AUTH-004/TC-AUTH-009 同源，**不重复计数实现**（统计按主实现归属域计）。
