# 安全设计 — 酒店管理系统（HMS）

| 项 | 值 |
| --- | --- |
| 文档版本 | v1.0（待评审，未冻结） |
| 日期 | 2026-10-14 |
| 总原则 | **单一认证方案**（服务器端 Session，见架构 ADR-002），不叠加 JWT 等第二种凭证；纵深防御（前端校验仅为 UX，后端为唯一安全边界） |

---

## 1. 密码哈希方案

| 项 | 决策 |
| --- | --- |
| 算法 | bcrypt（`bcryptjs`，cost factor = 12） |
| 理由 | 抗 GPU 暴力破解、生态成熟、纯 JS 实现免去 Alpine 容器原生编译；登录频率低，纯 JS 性能劣势可忽略（ADR-008） |
| 长度限制 | 密码输入上限 72 字节（bcrypt 算法上限，超长截断存在歧义 → 明确拒绝超长输入，422） |
| 哈希传输 | `password` 只出现在 `POST /auth/login`、`POST /users`、`PATCH /users/{id}/password` 请求体（HTTPS 保护）；**任何响应、日志、错误信息中永不出现** |
| 时机安全 | 登录校验：先取用户再 `bcrypt.compare`；用户不存在时执行一次恒定时间比较（dummy hash）防时序探测用户名是否存在 |

密码策略（服务端 zod 强制）：长度 ≥10 且 ≤72；至少含字母与数字；不得包含用户名。前端表单同规则即时提示。

## 2. 会话（Session）方案与风险

- **方案**：登录成功生成 256-bit 密码学随机 sid（`crypto.randomBytes(32).toString('hex')`），落 `sessions` 表（含 8h 过期【假设 A-11】），经 Cookie 下发；每请求实时查库校验（未过期 + user.status=ACTIVE）。
- **风险与对策**：

| 风险 | 对策 |
| --- | --- |
| 会话固定 | sid 仅在登录成功时生成，不接受客户端传入的 sid |
| 会话窃取（网络） | 生产强制 HTTPS（部署前置条件【待确认 Q-10】）；`Secure` 标志 |
| 会话窃取（XSS 读 JS） | `HttpOnly`，JS 不可读；配合 §7 XSS 防护 |
| 离职/停用员工仍在线 | 每请求校验 `user.status`，禁用即时失效；重置密码删除全部会话 |
| 并发长会话滥用 | 8h 绝对过期 + 每小时清理过期行；单用户会话数上限 10（超出淘汰最旧） |
| 数据库泄漏后 sid 可用 | sid 仅存明文（无 PII），泄漏库 ≠ 泄漏凭证仍需 TLS 链路；如需更强可存 sid 哈希（本期不做，登记） |

- **明确不采用 JWT**：无法即时吊销、凭证暴露于客户端可读存储、单实例场景无收益（ADR-002）。

## 3. Cookie 与凭证保护

```
Set-Cookie: hms_sid=<64 hex>;
  HttpOnly;            # JS 不可读（防 XSS 窃取）
  SameSite=Strict;     # 跨站请求不携带（CSRF 主防线，同源部署使其成立）
  Secure;              # 仅 HTTPS（生产；本地 http 调试时由 NODE_ENV 控制关闭）
  Path=/;
  Max-Age=28800        # 8h
```

登出：删除 sessions 行 + `Set-Cookie` 置空（`Max-Age=0`）。

**登录失败处理（NFR-SEC-003）**：

1. 统一错误文案 `INVALID_CREDENTIALS / 用户名或密码错误`（不区分"用户不存在"与"密码错误"，防枚举）。
2. 账户级锁定：连续失败 5 次 → `locked_until = now + 15min`，期间即使密码正确也返回 `423 ACCOUNT_LOCKED`；成功登录清零计数。
3. IP 级限流：`POST /auth/login` 每 IP 每分钟 10 次（内存滑动窗口，单实例足够；超限 `429`）。
4. 全部登录成功/失败写入审计日志（§9），不含密码。

## 4. 权限校验（后端唯一边界）

- 三层管道：`sessionMiddleware`（认证）→ `requireAuth`（401）→ `requireRole(...)`（403），逐路由声明，**默认拒绝**（路由未显式声明角色时中间件拒绝访问——路由表 review 时核查无遗漏）。
- 服务层资源级校验：如 ADMIN 不可停用自己、RECEPTIONIST 不可将房态置 `MAINTENANCE/DISABLED`（api-contract M5）、`OCCUPIED` 房不可改房型。
- 前端隐藏按钮/路由过滤**仅为 UX**，不构成安全控制（架构 §2.9 声明）；安全测试（TC-SEC 组）必须包含"绕过前端直接调 API 被拒"的用例。

## 5. 输入校验

- 所有 body / query / path 参数经 `@hms/shared` zod schema 运行时校验（ADR-007）；校验中间件在控制器之前，失败 `422 VALIDATION_FAILED + details[]`。
- 全部输入有长度上限（字符串）、范围上限（数值、分页 pageSize≤100）、枚举白名单（状态、角色、支付方式等）。
- JSON body 大小限制 `100kb`（`express.json({ limit: '100kb' })`）；URL query 长度由 Nginx `large_client_header_buffers` 限制。
- 环境变量：启动时 zod 校验（必填、格式、密钥长度），失败即拒绝启动（fail fast）。

## 6. SQL 注入防护

- **全部数据访问经 Prisma 参数化查询**；唯一手写 SQL 是 `SELECT ... FOR UPDATE`（事务锁读），强制使用 Prisma tagged template（`$queryRaw\`...\``）自动参数化——**禁止字符串拼接 SQL**（CI grep 检查 `$queryRawUnsafe` / `$executeRawUnsafe` 出现即失败）。
- 标识符（排序字段等）不进 SQL：排序白名单在 zod 层校验后映射为固定列名。
- 数据库账号最小权限：api 使用的 MySQL 账号仅对 `hotel` 库授权 DML，迁移用独立账号执行 DDL（Compose 中区分 `MIGRATION_DATABASE_URL`）。

## 7. XSS 防护

| 层 | 措施 |
| --- | --- |
| 框架 | Vue 3 默认对插值转义；**禁用 `v-html`**（ESLint `vue/no-v-html` 规则，CI 阻断） |
| 响应头 | `X-Content-Type-Options: nosniff`；`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`（Element Plus 运行时注入内联样式，故 style 放宽为 `unsafe-inline`——记录取舍） |
| 存储 | 不将任何用户可控内容写入 `innerHTML`/`document.write`；客人备注等长文本仅经转义插值渲染 |
| 服务端 | API 不返回 HTML（纯 JSON），`Content-Type: application/json` |

## 8. CSRF 防护及适用条件

- **适用条件**：本系统使用 **Cookie 携带凭证**，因此存在经典 CSRF 面；若采用 Bearer Header 则不适用——本项目明确适用。
- **防线 1（主）**：`SameSite=Strict` Cookie——跨站发起的请求（含第三方页面表单/预取）浏览器不携带 `hms_sid`，攻击请求退化为匿名，被 `requireAuth` 拒绝（401）。
- **防线 2（辅）**：`csrfMiddleware`——对非 `GET/HEAD/DELETE-with-query` 的状态变更请求校验 `Origin`（缺失时校验 `Referer`）与部署源一致，不一致即 `403`。防 SameSite 被旧浏览器忽略及子域风险。
- **防线 3（结构）**：全部写操作 POST/PATCH + JSON `Content-Type`，跨站简单表单无法构造（表单不能发 `application/json`）。
- 不引入 CSRF token：同源部署下双防线已充分，token 增加状态复杂度（记录为有意取舍）。

## 9. 敏感信息日志过滤

- 日志框架 pino，全局 `redact` 路径：`req.headers.cookie`、`req.headers.authorization`、`*.password`、`*.newPassword`、`*.idNumber`、`*.passwordHash`；脱敏输出 `[REDACTED]`。
- 审计日志（独立 channel）：登录成功/失败、账号锁定、登出、员工创建/停用、密码重置、退房结算——记录 operatorId、目标资源、requestId、结果，**不含凭证与证件明文**。
- 证件号明文仅存在于：请求瞬间（内存）与 `guests.id_number_cipher`（AES-256-GCM 密文）；日志、响应、前端存储均无明文。
- 错误堆栈：`500` 响应体只含 `INTERNAL_ERROR` + requestId；完整堆栈仅落日志。
- 前端：生产构建禁用 sourcemap 上传（或私有托管）；`console.log` 生产环境 ESLint 告警（error 级）。

## 10. 环境变量与密钥管理

| 变量 | 用途 | 要求 |
| --- | --- | --- |
| `NODE_ENV` | 环境 | `development` / `production` |
| `PORT` | api 端口 | 默认 3000 |
| `DATABASE_URL` | 运行库连接（DML 账号） | `mysql://hms_app:***@mysql:3306/hotel` |
| `MIGRATION_DATABASE_URL` | 迁移专用（DDL 账号） | 仅启动迁移时使用 |
| `SESSION_TTL_HOURS` | 会话时长 | 默认 8 |
| `GUEST_ID_HMAC_KEY` | 证件号查重 HMAC 密钥 | ≥32 bytes base64 |
| `GUEST_ID_CIPHER_KEY` | 证件号 AES-256-GCM 密钥 | 32 bytes base64 |
| `ADMIN_INITIAL_PASSWORD` | 种子管理员密码 | 仅 seed 用，≥10 位；**A-20 B 已于 2026-10-18 实现：首登强制改密，未改密仅允许 me/logout/change-password** |
| `LOG_LEVEL` | 日志级别 | 默认 `info` |
| `CORS_ORIGIN` | 显式允许的源（默认无） | 本期同源部署，不启用跨域 |

- `.env.example` 入库（占位值）；真实 `.env` 与 `docker compose -f compose.prod.yml --env-file` 由部署者保管，**永不入库**（`.gitignore` 覆盖）。
- CI/预提交扫描：`gitleaks`（或 `detect-secrets`）防密钥误提交。
- 密钥轮换：`GUEST_ID_*` 两密钥轮换需重算 `id_number_hash` 并重加密密文，本期不实现——登记为已知限制与运行手册项。

## 11. 其他传输与运维安全

- 生产 TLS：由 Nginx/宿主 LB 终结（证书待提供【待确认 Q-10】）；启用 HTTP→HTTPS 301 与 `HSTS`（max-age 半年）。
- 健康检查端点 `GET /api/health` 仅返回 `{ status: "ok" }`，不泄露版本/依赖信息。
- 依赖安全：CI `pnpm audit --prod`（高危阻断）、锁文件（`pnpm-lock.yaml`）必更。
- 容器：非 root 用户运行、镜像固定 digest、仅暴露 80/443（mysql 不映射宿主端口，仅 compose 内网）。
- 备份加密：`mysqldump` 产物落备份卷并 `chmod 600`；异地/加密上传为运维项（记录）。

## 12. 安全测试要求（对应测试编号 TC-SEC）

| 编号 | 用例 |
| --- | --- |
| TC-SEC-001 | 未登录访问全部受保护端点 → 401（含 M2/R1 等易漏项，逐路由断言） |
| TC-SEC-002 | RECEPTIONIST 调 U1/U2/R2/M3 等管理端点 → 403 |
| TC-SEC-003 | 停用用户会话即刻失效（U3 停用后原 Cookie 401） |
| TC-SEC-004 | 登录失败 5 次锁定、15 分钟后恢复 |
| TC-SEC-005 | 跨源（伪造 Origin）POST 请求 → 403（CSRF 防线 2 生效） |
| TC-SEC-006 | 422/409 响应体不含 password_hash、证件明文 |
| TC-SEC-007 | 日志 redact 抽查：登录请求日志中 password/cookie 为 `[REDACTED]` |
| TC-SEC-008 | 排序参数注入（`sort=id;DROP TABLE`）→ 422（白名单拒绝） |
| TC-SEC-009 | 会话固定：伪造自定义 sid 登录后 sid 被替换 |
| TC-SEC-010 | G1/G3 响应证件号恒为掩码 |
