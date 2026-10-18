# Q-09 A：TLS/域名/Secure/HSTS 上线检查单

| 项 | 值 |
| --- | --- |
| 状态 | **待域名/证书与运维签字**；不得视为已完成 |
| 依据 | 需求基线 v1.0 Q-09 A；`security-design.md` §11；`docs/deployment.md` §4 |
| 日期 | 2026-10-18 |

> 当前 `compose.prod.yml` 的 web 容器只提供 HTTP 80（宿主默认 8080），TLS 由边缘 Nginx/LB 终结。没有证书/域名时无法完成本检查单。

## 1. 上线前检查

- [ ] 已提供生产域名，DNS 指向边缘代理。
- [ ] 证书链完整、未过期，覆盖域名；私钥权限最小化。
- [ ] TLS 1.2/1.3 启用，弱套件禁用。
- [ ] HTTP → HTTPS 301/308。
- [ ] HSTS 已启用（建议 `max-age=15552000`，确认子域策略后再考虑 `includeSubDomains`/preload）。
- [ ] 边缘代理只回源到 web 的 8080；MySQL/api 不暴露公网。
- [ ] 传递 `X-Forwarded-For` / `X-Forwarded-Proto`，与 API `trust proxy=1` 语义一致。
- [ ] `NODE_ENV=production`，会话 Cookie 带 `Secure`。
- [ ] 登录、改密、walk-in、退房在 HTTPS 下通过。
- [ ] `deploy-smoke.mjs` 使用 `HMS_SMOKE_BASE_URL=https://<域名>` 通过。

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
