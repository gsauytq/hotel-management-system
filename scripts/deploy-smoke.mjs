#!/usr/bin/env node
/**
 * 部署后冒烟（docs/test-plan.md §7-15、TC-DEP-005）。
 *
 * 默认只读检查，不写入业务数据：
 *   1) GET /api/health            → { status: "ok" }
 *   2) POST /api/v1/auth/login    → 200 + HttpOnly 会话 Cookie
 *   3) GET /api/v1/auth/me        → 200 且用户名匹配
 *   4) GET /api/v1/room-types     → 200 列表信封 + X-Request-Id
 *   5) GET /api/v1/rooms          → 200 列表信封
 *
 * A-20 B：新 seed 管理员首登必须改密。若登录返回 mustChangePassword=true：
 *   - 提供 HMS_SMOKE_NEW_PASSWORD 时，执行一次改密并以新密码重新登录；
 *   - 未提供时明确失败，不进行后续只读检查。
 *
 * 环境变量：
 *   HMS_SMOKE_BASE_URL      默认 http://127.0.0.1:8080；生产应使用 https://<域名>
 *   HMS_SMOKE_USERNAME      默认 admin
 *   HMS_SMOKE_PASSWORD      必填（或回退 ADMIN_INITIAL_PASSWORD）
 *   HMS_SMOKE_NEW_PASSWORD  可选；仅首登强制改密时需要
 *
 * HTTPS 下额外断言会话 Cookie 带 Secure；HTTP 仅限已批准的 D2-c 风险接受路径。
 *
 * 任一检查失败即以非 0 退出码结束。
 */
const baseUrl = (process.env.HMS_SMOKE_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const isHttps = baseUrl.startsWith('https://');
const username = process.env.HMS_SMOKE_USERNAME ?? 'admin';
const password = process.env.HMS_SMOKE_PASSWORD ?? process.env.ADMIN_INITIAL_PASSWORD;
const newPassword = process.env.HMS_SMOKE_NEW_PASSWORD;

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.info(`[PASS] ${name}`);
    return true;
  }
  failures += 1;
  console.error(`[FAIL] ${name}${detail === '' ? '' : `：${detail}`}`);
  return false;
}

async function main() {
  if (password === undefined || password === '') {
    console.error('[FAIL] 缺少 HMS_SMOKE_PASSWORD / ADMIN_INITIAL_PASSWORD');
    process.exit(1);
  }

  console.info(`[smoke] baseUrl=${baseUrl} username=${username}`);

  const health = await fetch(`${baseUrl}/api/health`);
  const healthBody = await health.json().catch(() => null);
  check('health 200', health.status === 200, `status=${health.status}`);
  check('health status=ok', healthBody?.status === 'ok', JSON.stringify(healthBody));

  let login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  let loginBody = await login.json().catch(() => null);
  check(
    '登录 200',
    login.status === 200,
    `status=${login.status} body=${JSON.stringify(loginBody)}`,
  );
  check('登录返回用户', typeof loginBody?.data?.username === 'string');
  let setCookie = login.headers.get('set-cookie') ?? '';
  check('会话 Cookie 存在', /hms_sid=[0-9a-f]{64}/.test(setCookie));
  check('Cookie HttpOnly', /HttpOnly/i.test(setCookie));
  check('Cookie SameSite=Strict', /SameSite=Strict/i.test(setCookie));
  if (isHttps) {
    check('Cookie Secure（HTTPS）', /(?:^|;\s*)Secure(?:;|$)/i.test(setCookie));
  } else if (/(?:^|;\s*)Secure(?:;|$)/i.test(setCookie)) {
    console.warn(
      '[WARN] HTTP 下 Set-Cookie 带 Secure，浏览器会拒绝；生产必须使用 HTTPS，或按 D2-c 增加 COOKIE_SECURE 开关',
    );
  }
  let cookie = setCookie.split(',')[0]?.split(';')[0] ?? '';

  if (loginBody?.data?.mustChangePassword === true) {
    if (newPassword === undefined || newPassword === '') {
      console.error('[FAIL] 首登强制改密：请设置 HMS_SMOKE_NEW_PASSWORD，或先人工完成改密后重跑');
      process.exit(1);
    }

    const change = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword: password, newPassword }),
    });
    const changeBody = await change.json().catch(() => null);
    check(
      '首登改密 200',
      change.status === 200,
      `status=${change.status} body=${JSON.stringify(changeBody)}`,
    );

    login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: newPassword }),
    });
    loginBody = await login.json().catch(() => null);
    check('改密后重新登录 200', login.status === 200, `status=${login.status}`);
    check('改密标记已清除', loginBody?.data?.mustChangePassword === false);
    setCookie = login.headers.get('set-cookie') ?? '';
    cookie = setCookie.split(',')[0]?.split(';')[0] ?? '';
  }

  const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: cookie } });
  const meBody = await me.json().catch(() => null);
  check('auth/me 200', me.status === 200, `status=${me.status}`);
  check('auth/me 用户名匹配', meBody?.data?.username === username, JSON.stringify(meBody?.data));

  const roomTypes = await fetch(`${baseUrl}/api/v1/room-types?page=1&pageSize=1`, {
    headers: { Cookie: cookie },
  });
  const roomTypesBody = await roomTypes.json().catch(() => null);
  check('room-types 200', roomTypes.status === 200, `status=${roomTypes.status}`);
  check('room-types 列表信封', Array.isArray(roomTypesBody?.data?.items));
  check('响应含 X-Request-Id', roomTypes.headers.get('x-request-id') !== null);

  const rooms = await fetch(`${baseUrl}/api/v1/rooms?page=1&pageSize=1`, {
    headers: { Cookie: cookie },
  });
  const roomsBody = await rooms.json().catch(() => null);
  check('rooms 200', rooms.status === 200, `status=${rooms.status}`);
  check('rooms 列表信封', Array.isArray(roomsBody?.data?.items));

  if (failures > 0) {
    console.error(`[smoke] 失败检查数：${failures}`);
    process.exit(1);
  }
  console.info('[smoke] 全部通过');
}

main().catch((error) => {
  console.error('[smoke] 冒烟执行异常：', error instanceof Error ? error.message : error);
  process.exit(1);
});
