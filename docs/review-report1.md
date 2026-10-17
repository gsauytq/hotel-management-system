# 独立代码审查报告 — HMS（酒店管理系统）

## 0. 变更范围确认

- Git 仓库（`E:\web_project`）**尚无任何提交**，`git diff` 不存在；`hotel-management-system/` 整体为 untracked。**本次审查范围 = 整个工作树**（首次基线全量审查），而非增量 diff。
- 基线文档（requirements/api-contract/database-design 等 v1.0）自述为“待评审、未冻结”，FR/NFR 编号均为假设基线（Q-01）。
- 上一轮缺陷以代码注释形式存在：P-1（凌晨入住晚数）、P-2（过期预订入住触发 CHECK 500）、P-5（停用与会话删除非同事务）。经代码与回归测试核对（stays.integration.test.ts:779、:430；users.repository.ts:29），**三处均已修复且有测试**。

**实际执行的验证**（Windows/PS5.1，Node 22.22.0，dev MySQL 8.4 容器）：

| 检查                        | 命令                                                      | 结果                                       |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| 单元测试                    | `pnpm -r test`                                            | shared 37 ✓ / server 144 ✓ / web 135 ✓     |
| 集成测试（真库+并发）       | `node scripts/run-integration-tests.mjs`                  | 33 文件 / 238 用例 **全部通过**            |
| 类型/Lint/格式              | `pnpm typecheck` / `lint` / `format:check`                | 全部 exit 0                                |
| 构建                        | `pnpm -r build`                                           | 全部通过                                   |
| OpenAPI lint（CI 同款命令） | `npx --yes @redocly/cli@latest lint openapi/openapi.yaml` | **失败：3 errors / 17 warnings**（见 A-2） |
| 超售复现                    | 临时脚本（真实 MySQL，数据已清理并验证无残留）            | **复现成功**（见 A-1）                     |

## A. 确认缺陷

### A-1 在住/入住不消耗预订房量 → 合并视角超售（预订承诺不可履行）

- **严重程度**： High

- **关联需求**： FR-BK-001（创建预订“并发下不得超售”）、FR-SY-001、NFR-CON-001；database-design §2.4（“在住/已订合并视角由 §6.1 步骤 3 的重叠计数统一保证”）

- **文件与位置**：

  - `apps/server/src/modules/bookings/bookings.repository.ts:180-195` — 防超售重叠计数只统计 `status='CONFIRMED'` 的预订，**不计任何在住（stays）**；预订办理入住后状态翻为 `CHECKED_IN`，随即退出计数
  - `apps/server/src/modules/stays/stays.repository.ts:234-361`（createStay）— walk-in 与预订入住分支均**不检查**目标日期区间内重叠的 CONFIRMED 预订房量，仅校验房间状态与占用行

- **触发条件**：

  1. walk-in 入住某房间的区间覆盖同房型未来 CONFIRMED 预订的日期区间（两者互不知晓，先后顺序无关）；
  2. 或：预订 A 办理入住（→CHECKED_IN，退出计数）后，新预订仍可按“空计数”售出同区间，叠加在住需求超过物理房数。

- **影响**： 已确认（CONFIRMED）预订在到店当日无房可分（409 ROOM_OCCUPIED/ROOM_NOT_ASSIGNABLE），需现场拒客或改订。数据库唯一约束只保证“物理上不双占”，**不保证已售出的预订可履行**——与 db-design §2.4 的合并视角承诺直接矛盾（§2.4 与 §6.1 自相矛盾，实现取了弱解释）。

- **证据**（真实 MySQL 复现，脚本已清理数据）：

  ```
  STEP1 预订 [d+5,d+7): 200 "CONFIRMED"     ← 1 间房房型
  STEP2 walk-in [d0,d+8) 同房: 200 "CHECKED_IN" ← 跨越预订整个区间，未被拒绝
  STEP3 房间状态: OCCUPIED | 预订区间内该房占用行数: 2
  结论：预订到店当日必然无房 → 超售成立
  ```

  另：全部现有测试（含 concurrency-symmetric、TC-BK-005）均未覆盖“在住 × 预订”合并视角。

- **建议修复**： 需先做设计裁决——(a) 在 `createStay` 事务内（已持房间行锁）增加“同房型重叠区间 CONFIRMED 预订 + 在住合计 ≤ 可售房数”校验；或 (b) 在预订创建的重叠计数中加入在住（stays 按预计离店日展开）。若业务裁决为“允许 walk-in 挤占未来预订”，则必须修正 db-design §2.4 的表述并在前端 walk-in 流程给出警示（此时降级为文档缺陷）。

- **建议增加的测试**： 集成用例：① 1 房房型先订 [d+5,d+7)，walk-in [d0,d+8) 同房 → 断言 409（或按裁决断言 200 + 文档修正）；② 预订 A 入住后（CHECKED_IN），同房型同区间新预订受在住约束。

### A-2 openapi.yaml 无法通过仓库自定的 CI 契约门禁（redocly lint 3 errors）

- **严重程度**： Medium
- **关联需求**： api-contract §11.2（“CI 校验：@redocly/cli lint 阻断”）、NFR（契约冻结流程）
- **文件与位置**：
  - `openapi/openapi.yaml:1331`（`Room.currentStay`：`allOf + nullable: true` 无 `type` 兄弟字段 → `nullable-type-sibling` error）
  - `openapi/openapi.yaml:1496`（`StayDetail.order` 同上 → error）
  - `openapi/openapi.yaml:1536`（`Order.depositApplied` 的 description 未加引号，YAML 将 `totalAmount)` 解析为多余键 → `struct` error）
  - 触发命令：`.github/workflows/ci.yml:43-44` 的 `npx --yes @redocly/cli@latest lint openapi/openapi.yaml`
- **触发条件**： 运行 CI 的“OpenAPI 契约 lint”步骤（本地等价命令同样失败：2.64.1，3 errors / 17 warnings）。
- **影响**： CI 流水线必然红；api-contract 声称的“单一事实来源 + lint 门禁”实际未达成绿色状态（仓库零提交，该 job 从未真实跑过）。错误属结构问题，与实现的运行时行为无冲突，但契约文件不可作为可验证的事实来源。
- **证据**： 本地执行 CI 同款命令输出 `❌ Validation failed with 3 errors and 17 warnings`（redocly 2.64.1）。
- **建议修复**： 1331/1496 改为 `type: object` + `allOf` 或 OAS 3.0 惯用的 nullable 写法；1536 的 description 加引号；处理 17 个 warning（tag-description、operation-4xx-response 等）或添加 `.redocly.yaml` 显式配置并说明取舍。
- **建议增加的测试**： 无需新测试；修复后 CI job 变绿即验证。

### A-3 停用账号登录分支未执行恒定时间比较（时序泄露账号状态）

- **严重程度**： Low
- **关联需求**： NFR-SEC-003 / security-design §1（“用户不存在时执行一次恒定时间比较（dummy hash）防时序探测用户名是否存在”）
- **文件与位置**： `apps/server/src/modules/auth/auth.service.ts:100-108`（`status !== 'ACTIVE'` 分支直接抛错，未调用 `consumeDummyCompare`；对照 :91-98 的用户不存在分支有 dummy compare）
- **触发条件**： 攻击者向 `POST /auth/login` 发送正确格式凭证并测量响应时间。
- **影响**： “用户不存在”（慢，dummy bcrypt ≈100ms）与“用户存在但已停用”（快，无比较）可区分 → 可枚举已停用（离职）员工账号。与安全设计声明的防时序探测控制存在偏差；统一文案防线本身未破（响应体仍为同一 401）。
- **证据**： 代码审读确认该分支无任何 compare 调用；集成测试（auth.integration.test.ts:200-205）仅断言响应码，未覆盖时序行为。
- **建议修复**： 在 disabled 分支抛错前 `await consumeDummyCompare(input.password)`（顺带评估 423 锁定分支，其状态本身已通过响应码暴露，可不做）。
- **建议增加的测试**： 单测注入 spy 断言停用分支调用了 dummy compare；时延断言易 flaky，不建议做硬阈值。

### A-4 登录失败计数“复位”存在竞态 → 并行爆破可避免重新锁定/擦除新锁

- **严重程度**： Low
- **关联需求**： NFR-SEC-003（连续 5 次失败锁定 15 分钟）
- **文件与位置**：
  - `apps/server/src/modules/auth/auth.service.ts:119-137`（`resetFirst` 基于 bcrypt 比较前读取的 `user.lockedUntil`，存在 ~100ms 陈旧窗口）
  - `apps/server/src/modules/auth/auth.repository.ts:84-111`（`resetFirst` 分支无条件 `failedAttempts=1, lockedUntil=null`）
- **触发条件**： ① 锁定刚过期时并发 ≥5 次错误尝试：所有请求都读到“已过期的锁”→ 全部走 resetFirst → 各自写 count=1（最后写生效），计数永远到不了 5，**账户不会重新锁定**；② 请求 X 读到过期锁后在 bcrypt 窗口内其他失败将账户重新锁定，X 的无条件复位写会**擦除刚设置的锁**。
- **影响**： 账户锁定这一防爆破控制在并发下可被绕过/提前解除。残余缓解：每 IP 10/min 限流 + bcrypt cost=12，实际暴力破解可行性仍低。
- **证据**： 代码路径分析（变体①由代码语义确定成立；未做动态并发复现，标记为“代码确认、运行动态复现未执行”）。
- **建议修复**： 将“是否复位 + 自增 + 达标置锁”合并为单条条件 UPDATE（如 `failed_attempts = IF(locked_until IS NOT NULL AND locked_until <= :now, 1, failed_attempts + 1)` 且同语句置 `locked_until`），或短事务内 `SELECT ... FOR UPDATE` user 行后再判定。
- **建议增加的测试**： 集成用例（注入 now）：锁定过期后并发 5 次错误尝试 → 断言账户被重新锁定（当前实现会失败，即回归保护）。

## B. 潜在风险

### B-1 CSRF 辅助防线对无 Origin/Referer 的请求放行

- **严重程度**： Low
- **关联需求**： NFR-SEC-009 / security-design §8（防线 2 覆盖“SameSite 被旧浏览器忽略”场景）
- **文件与位置**： `apps/server/src/modules/shared/middleware/csrf.ts:38-40`（Origin/Referer 均缺失时直接放行）
- **触发条件**： 忽略 SameSite=Strict 的旧浏览器发起跨站状态变更请求（此类浏览器同时可能不携带 Origin）。
- **影响**： 有限——防线 3（写操作必须 `application/json`，跨站表单无法构造）在结构上兜底；现代浏览器跨站 POST 必带 Origin 已被上方拒绝。代码注释已记录取舍。
- **证据**： 代码审读 + 设计文档对照；无实际可利用 PoC。
- **建议修复**： 可考虑“携带会话 Cookie 的 POST/PATCH 若 Origin/Referer 均缺失则拒绝”（现代浏览器表单提交至少带 Referer），或保持现状并 security-design §8 明示该取舍。
- **建议增加的测试**： csrf 单测补“带 Cookie + 无 Origin/Referer 的 POST”预期行为用例（无论裁决如何先固化语义）。

### B-2 单实例内存限流：多实例/进程重启时静默失效

- **严重程度**： Low（文档已登记为单实例设计，ADR-002 演进条件）
- **关联需求**： NFR-SEC-003
- **文件与位置**： `apps/server/src/shared/middleware/rateLimit.ts:25`（进程内 Map）
- **触发条件**： 未来横向扩容为多 api 实例（限流阈值实际放大 N 倍）。
- **影响**： 登录防爆破限流弱化；当前单机部署拓扑下无影响。
- **建议**： 在部署文档/演进预案中显式标注“扩容前必须先外置限流”；非本期代码修改项。

### B-3 登录限流键为 IP：NAT 出口与分布式攻击下的局限

- **严重程度**： Low（与设计一致，属已知取舍）
- **文件与位置**： `rateLimit.ts:30`（`req.ip`）；`app.ts:66`（trust proxy 1，取 X-Forwarded-For 末位，经核对 Nginx 追加语义正确）
- **触发条件**： 酒店前台多终端共享出口 IP 时相互触发限流（10/min）；或攻击者换 IP 绕过 IP 限流（仍有账户锁定兜底，但见 A-4）。
- **建议**： 运行手册登记；如前台场景受影响可考虑按 IP+用户名双键。

## C. 非阻断性建议

1. **test-plan.md §1.1–§1.3 与现状脱节**（docs/test-plan.md:20-56）：称“无 CI、TC-RT-005 无实现、集成测试未执行”等，但 `.github/workflows/ci.yml`、`room-type-price-snapshot.integration.test.ts` 等已存在且集成测试现已全部通过（本次审查真实执行）。建议刷新该文档，避免验收决策被过时信息误导。
2. **退房失败未写审计日志**：`stays.service.ts:226-252` 仅在成功时审计；security-design §9 审计要求含“结果”。建议 409（重复退房）也记录 FAILURE 事件。
3. **过时文案**：根/server/web 三处 `package.json` description 与 `prisma/seed.ts:35-37` 控制台输出仍称“尚未实现/待补充”，与现状不符。
4. **redocly 版本未锁定**：ci.yml 使用 `@latest`，规则随版本漂移（本次失败即例证）；建议固定版本并入库 lockfile。
5. **E2E（Playwright，T-19）与 `docs/deployment.md`（T-20）仍缺失**：已在 test-plan（G-3/G-11）与 development-plan 登记，发布前必须落地，此处仅作遗留确认。

## 结论

**阻断合并的问题**

- **A-1（合并视角超售）**：涉及核心商业承诺（已确认预订不可履行）。若裁决为缺陷（当前 db-design §2.4 的表述支持此判断），必须修复后合并；若业务裁决 walk-in 允许挤占，则需先修订设计文档并在产品层面接受该风险——二选一须在合并前完成，不能维持“文档承诺 A、实现做 B”的状态。
- **A-2（openapi.yaml lint 失败）**：仓库自定的 CI 门禁必然红，合并前必须修复（3 处结构错误，改动小）。

**必须修复**：A-1（含设计裁决）、A-2。

**建议合并前顺手修复（改动极小，否则登记遗留）**：A-3（disabled 分支补 dummy compare 一行）、A-4（锁定计数原子化）。

**可记录为遗留事项**：B-1、B-2、B-3、C-1~C-5，以及文档已登记的 Q-09（生产 TLS/Secure Cookie/HSTS，上线阻断项）、A-20（首登强制改密）。

**无法验证的部分**

- E2E 浏览器主流程：测试资产不存在（G-3），未验证。
- 生产 compose 全栈（web+api+mysql）部署冒烟：未执行（本次仅使用 dev MySQL 跑集成测试；`pnpm compose:config` 语法校验未运行——注意其依赖 `docker compose` CLI）。
- CI 在真实 GitHub Actions 的执行：本地等价命令已全部执行（除 redocly 外均绿）；GitHub 环境（corepack pnpm、gitleaks）行为未验证。
- A-4 的动态并发复现：仅代码路径论证，未做运行时复现。
- 环境备注：本机 corepack pnpm 垫片损坏（`E:\nodejs\pnpm.ps1` → MODULE_NOT_FOUND），本次经独立安装的 pnpm 12.6.0 完成全部检查；与 test-plan §1.3 记录一致，属环境问题而非仓库缺陷。