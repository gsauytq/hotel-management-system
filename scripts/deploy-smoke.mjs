#!/usr/bin/env node
/**
 * 部署后冒烟（docs/test-plan.md §7-15、TC-DEP-005）。
 *
 * 只读检查，不写入任何业务数据：
 *   1) GET /api/health            → { status: "ok" }
 *   2) POST /api/v1/auth/login    → 200 + HttpOnly 会话 Cookie
 *   3) GET /api/v1/auth/me        → 200 且用户名匹配
 *   4) GET /api/v1/room-types     → 200 列表信封 + X-Request-Id
 *   5) GET /api/v1/rooms          → 200 列表信封
 *
 * 环境变量：
 *   HMS_SMOKE_BASE_URL  默认 http://127.0.0.1:8080（compose.prod 的 web 端口）
 *   HMS_SMOKE_USERNAME  默认 admin
 *   HMS_SMOKE_PASSWORD  必填（或回退 ADMIN_INITIAL_PASSWORD）
 *
 * 任一检查失败即以非 0 退出码结束。
 */
const baseUrl = (process.env.HMS_SMOKE_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const username = process.env.HMS_SMOKE_USERNAME ?? 'admin';
const password = process.env.HMS_SMOKE_PASSWORD ?? process.env.ADMIN_INITIAL_PASSWORD;

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

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginBody = await login.json().catch(() => null);
  check(
    '登录 200',
    login.status === 200,
    `status=${login.status} body=${JSON.stringify(loginBody)}`,
  );
  check('登录返回用户', typeof loginBody?.data?.username === 'string');
  const setCookie = login.headers.get('set-cookie') ?? '';
  check('会话 Cookie 存在', /hms_sid=[0-9a-f]{64}/.test(setCookie));
  check('Cookie HttpOnly', /HttpOnly/i.test(setCookie));
  check('Cookie SameSite=Strict', /SameSite=Strict/i.test(setCookie));
  const cookie = setCookie.split(',')[0]?.split(';')[0] ?? '';

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
