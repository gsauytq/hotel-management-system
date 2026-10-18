# Q-09 A：TLS/域名/Secure/HSTS 上线检查单

| 项 | 值 |
| --- | --- |
| 状态 | **D2-a/b TLS 配置已落地；本地自签 + Chromium 录屏验证通过；生产域名/受信证书待提供**；Q-09 A 不视为已完成 |
| 依据 | 需求基线 v1.0 Q-09 A；`security-design.md` §11；`docs/deployment.md` §4 |
| 日期 | 2026-10-18 |

> D2-a/b 路径已将 TLS 终结下沉到 `web` 容器的 Nginx：80 仅 301，443 使用 `TLS_CERT_DIR` 中的 `fullchain.pem` / `privkey.pem`。没有生产证书/域名时 Q-09 A 仍不关闭。
>
> **业主决定（2026-10-18）**：暂缓生产上线，不承载真实客人数据；待域名、受信证书与运维资源就绪后重启本检查单。

## 0. 本地技术验证（2026-10-18，自签证书）

已用自签证书 + 生产 Compose 栈做技术验证，**不代表生产域名/证书已就绪**：

| 验证项 | 结果 |
| --- | --- |
| HTTP → HTTPS | 301，`Location: https://hms.local/` |
| HTTPS 访问 | 200 |
| HSTS | `Strict-Transport-Security: max-age=15552000` |
| 会话 Cookie | `Secure` / `HttpOnly` / `SameSite=Strict` 均存在 |
| `deploy-smoke.mjs`（HTTPS） | 15/15 PASS（`https://127.0.0.1:443`） |
| TLS 协议配置 | TLS 1.2 / 1.3 |
| Chromium 浏览器 | `https://hms.local` 登录 → 刷新 → `/guests` 查询 200；录屏 `artifacts/tls-browser/login-refresh-business.webm` |

> 自签证书仅用于本地验证；测试时使用 `HMS_TLS_INSECURE=1` / `HMS_TLS_CA_FILE`，不得进入生产。生产必须使用受信 CA 证书、真实域名与正式证书。`hms.local` 为非 loopback 主机名，通过 Chromium host-resolver 映射到 127.0.0.1。

## 1. 上线前检查

- [ ] 已提供生产域名，DNS 指向 `web` 宿主。
- [ ] 证书链完整、未过期，覆盖域名；私钥权限最小化（生产证书，非自签）。
- [x] TLS 1.2/1.3 启用，弱套件禁用（本地配置验证）。
- [x] HTTP → HTTPS 301（本地验证）。
- [x] HSTS 已启用：`max-age=15552000`（本地验证；子域策略待生产确认）。
- [x] 只暴露 web 的 80/443；MySQL/api 不暴露公网（本地验证）。
- [x] 传递 `X-Forwarded-For` / `X-Forwarded-Proto`，与 API `trust proxy=1` 语义一致（本地验证）。
- [x] `NODE_ENV=production`，HTTPS 会话 Cookie 带 `Secure`（本地验证）。
- [ ] 登录、改密、walk-in、退房在 HTTPS 下全部通过（本地已覆盖登录/刷新/客户查询）。
- [x] `deploy-smoke.mjs` 使用 `HMS_SMOKE_BASE_URL=https://<host>` 通过（本地自签）。

## 2. 验证命令示例

```bash
# 证书与 TLS
openssl s_client -connect <域名>:443 -servername <域名> </dev/null
curl -sSI https://<域名>/ | grep -iE 'strict-transport-security|location'
curl -sSI http://<域名>/ | grep -iE '^HTTP|location'

# 冒烟（使用已改密后的管理员密码）
HMS_SMOKE_BASE_URL='https://<域名>' \
HMS_SMOKE_PASSWORD='<当前管理员密码>' \
node scripts/deploy-smoke.mjs

# Cookie Secure（登录响应）
curl -sSI -X POST https://<域名>/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<当前密码>"}' | grep -i 'set-cookie'
```

预期：HTTPS 200；HTTP 跳转 HTTPS；响应含 HSTS；`Set-Cookie` 含 `Secure; HttpOnly; SameSite=Strict`。

## 3. 签字

| 角色 | 姓名 | 签字 | 日期 | 结论/备注 |
| --- | --- | --- | --- | --- |
| 业主/授权代表 |  |  |  |  |
| 运维/网络 |  |  |  |  |
| 安全负责人 |  |  |  |  |

> 未签字/未提供证书前，Q-09 A 保持“待业主决议”，不得承载真实客人数据。

## 4. 决定记录

| 日期 | 决定人 | 决定 | 影响 |
| --- | --- | --- | --- |
| 2026-10-18 | 业主/授权代表 | **暂缓生产上线** | Q-09 A 不关闭；D2-a/b Nginx 443 配置与本地 HTTPS/浏览器验证已完成；提供生产域名/受信证书后重新执行 §1 并签字 |
