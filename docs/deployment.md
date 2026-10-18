# 部署与运维手册（生产形态）

| 项 | 值 |
| --- | --- |
| 状态 | TLS 配置已落地（D2-a/b：容器内 Nginx 终结 443）；本地自签浏览器验证通过；生产域名/受信证书待提供 |
| 适用版本 | 需求基线 v1.0；含 A-20 B 首登强制改密与 walk-in 前端 |
| 关联 | [`post-approval-action-register.md`](./post-approval-action-register.md)、[`security-design.md`](./security-design.md)、[`test-plan.md`](./test-plan.md) |

> 本手册以 `compose.prod.yml` 为准。生产环境必须由业主/运维提供域名、TLS 证书与合规结论；不得把开发用 `.env` 或真实密钥提交到仓库。

## 1. 上线前置条件

- [ ] Docker Engine / Docker Compose v2 可用。
- [ ] 已复制 `.env.example` 为 `.env`，并替换全部 `REPLACE_*` 占位值。
- [ ] `MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD` 使用强随机值；`GUEST_ID_HMAC_KEY`、`GUEST_ID_CIPHER_KEY` 为 32 字节 base64。
- [ ] `ADMIN_INITIAL_PASSWORD` ≥10 位且不含用户名；首次登录后必须修改（A-20 B）。
- [ ] Q-09 A：生产域名与受信证书就绪，放入 `TLS_CERT_DIR`（`fullchain.pem` / `privkey.pem`）；web 容器内 Nginx 终结 443，80 仅 301 跳转并启用 HSTS。检查单见 [`tls-launch-checklist.md`](./tls-launch-checklist.md)。
- [ ] Q-08 B：PII 合规、证件号保留期、掩码口径已形成书面结论（2026-10-18 业主电子确认）；独立合规签字与生产前技术债待补。检查单见 [`pii-compliance-checklist.md`](./pii-compliance-checklist.md)。
- [ ] 已确认 `main` 分支保护与 CI 四项检查（静态/集成/密钥扫描/E2E）为合并门禁。

## 2. 首次部署

```bash
# 1) 准备环境变量与证书（均不得提交到仓库）
cp .env.example .env
# 编辑 .env，替换所有 REPLACE_*；确认 MYSQL_*、GUEST_ID_*、ADMIN_INITIAL_PASSWORD
# 将 fullchain.pem / privkey.pem 放入 TLS_CERT_DIR（默认 ./certs），私钥权限最小化

# 2) 构建并启动 web + api + mysql
docker compose -f compose.prod.yml up -d --build

# 3) 等待三容器 healthy
docker compose -f compose.prod.yml ps

# 4) 初始化管理员（仅 users 表为空时写入）
docker compose -f compose.prod.yml --profile tools run --rm seed

# 5) 首次登录：使用 ADMIN_INITIAL_PASSWORD 登录后，系统强制跳转 /change-password；
#    修改成功后全部会话失效，使用新密码重新登录。
```

- MySQL 不映射宿主端口，仅 Compose 内网可达。
- `api` 启动时执行 `prisma migrate deploy`；迁移失败则容器不启动（fail fast）。
- 管理员 seed 幂等：`users` 表非空即跳过。
- 不要在生产环境使用 seed 之外的方式写入默认密码。

## 3. 部署后冒烟

```bash
# 已有管理员已完成首登改密时：
HMS_SMOKE_BASE_URL='https://<域名>' \
HMS_SMOKE_PASSWORD='<当前管理员密码>' \
node scripts/deploy-smoke.mjs

# 全新 seed 且尚未改密时（脚本会执行一次改密，然后重新登录）：
HMS_SMOKE_BASE_URL='https://<域名>' \
HMS_SMOKE_PASSWORD='<ADMIN_INITIAL_PASSWORD>' \
HMS_SMOKE_NEW_PASSWORD='<新管理员密码>' \
node scripts/deploy-smoke.mjs
```

- 生产目标必须为 `https://<域名>`；HTTPS 下冒烟额外断言会话 Cookie 带 `Secure`。
- 冒烟检查：health、登录、me、room-types、rooms。
- 若首登未改密且未提供 `HMS_SMOKE_NEW_PASSWORD`，脚本会明确失败，不会静默通过。

## 4. TLS 与反向代理（D2-a/b：容器内 Nginx 终结）

- `web` 容器同时暴露 80 与 443：
  - 80 仅返回 301 到 `https://<host>`，不承载登录或业务请求；
  - 443 由 `apps/web/nginx.conf` 终结 TLS，使用 `TLS_CERT_DIR` 只读挂载的 `fullchain.pem` / `privkey.pem`；
  - HTTPS 响应带 `Strict-Transport-Security: max-age=15552000`。
- 端口与证书配置：
  - `.env` 中 `WEB_HTTP_PORT=80`、`WEB_HTTPS_PORT=443`、`TLS_CERT_DIR=./certs`；
  - 标准 80/443 是默认值；Nginx 的 301 使用 `$host`，非标准 HTTPS 端口不在当前支持范围；
  - 私钥不得入库；`certs/` 已在 `.gitignore` 中。
- `NODE_ENV=production` 时会话 Cookie 带 `Secure`；生产只允许 HTTPS 登录，因此 HTTP 与 Secure Cookie 的矛盾被 301 消除。
- **D2-c（HTTP 风险接受）未启用**：若负责人另行批准，必须在 API 配置中增加显式 `COOKIE_SECURE` 开关（默认跟随 `NODE_ENV`），保留 Secure 逻辑并书面接受风险；不得把 `NODE_ENV` 改为 development 作为替代。
- 验证：
  ```bash
  ./scripts/verify-deployment.sh
  # 私有 CA/自签本地验证可设置：
  # HMS_TLS_CA_FILE=./certs/fullchain.pem HMS_TLS_INSECURE=1 ./scripts/verify-deployment.sh
  ```
  脚本会加载 `.env`、检查 301/HSTS/证书有效期、执行 HTTPS 冒烟，并验证重启恢复。

## 5. 备份与恢复

**备份（维护窗口外可执行）：**

```bash
docker compose -f compose.prod.yml exec -T mysql sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  > "hms-$(date +%Y%m%d-%H%M%S).sql"
```

**恢复（需要维护窗口）：**

```bash
docker compose -f compose.prod.yml stop web api
docker compose -f compose.prod.yml exec -T mysql sh -c \
  'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < hms-YYYYmmdd-HHMMSS.sql
docker compose -f compose.prod.yml start api web
```

- 备份文件含 PII，必须加密存放并限制访问；不得提交到 Git。
- 定期演练恢复；迁移采用前滚策略，禁止手工改生产库结构。
- `GUEST_ID_*` 轮换需重加密证件数据（本期未实现，见 `security-design.md` §10）。

## 6. 升级与回滚

```bash
# 1) 备份数据库
# 2) 获取新版本
git fetch --tags
git checkout <release-tag>

# 3) 重建并滚动启动
docker compose -f compose.prod.yml up -d --build

# 4) 验证
docker compose -f compose.prod.yml ps
curl -fsS https://<域名>/api/health
HMS_SMOKE_BASE_URL='https://<域名>' \
HMS_SMOKE_PASSWORD='<当前密码>' \
node scripts/deploy-smoke.mjs
```

- 迁移只前滚；回滚应用镜像不等于回滚数据库。若迁移不兼容，必须使用备份恢复并评估数据损失。
- 回滚版本使用上一个镜像/tag 重新 `up -d`；禁止手工修改已执行迁移。
- 发布记录应包含：版本 tag、镜像 digest、迁移列表、冒烟结果、回滚点。

## 7. 日志、健康与排障

```bash
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs -f api
docker compose -f compose.prod.yml logs -f web
docker compose -f compose.prod.yml logs -f mysql
```

- `GET /api/health` 返回应用与数据库状态；失败时返回 503。
- 5xx 响应带 requestId；用 requestId 关联结构化日志。
- 常见问题：
  - 504/超时：检查边缘代理、API 健康、数据库连接池；
  - 登录 423：账户锁定 15 分钟；
  - 401 会话失效：检查 HTTPS/Cookie `Secure`、系统时间、会话清理任务；
  - 首登 403 `PASSWORD_CHANGE_REQUIRED`：按 A-20 B 完成改密，不要绕过；
  - 迁移失败：查看 api 日志，修复后前滚，不要手工改表。

## 8. 安全与运维检查清单

- [ ] `.env` 未入库；`git status` 无凭据文件。
- [ ] 生产 TLS、HSTS、Secure Cookie 生效。
- [ ] 管理员首登已改密；离职员工已停用。
- [ ] `pnpm audit --prod` 无高危；gitleaks 通过。
- [ ] 数据库备份可用并已演练恢复。
- [ ] `main` 分支保护与 CI 门禁已启用。
- [ ] 发布 tag/镜像 digest 已登记。
- [ ] 已知限制：单实例内存限流；无自动备份调度；D2-c HTTP 路径未启用。

## 9. 相关文档

- 需求基线：[`requirements-traceability-approval-draft.md`](./requirements-traceability-approval-draft.md)
- 安全设计：[`security-design.md`](./security-design.md)
- 数据库设计：[`database-design.md`](./database-design.md)
- 测试计划：[`test-plan.md`](./test-plan.md)
- 行动登记：[`post-approval-action-register.md`](./post-approval-action-register.md)

