/**
 * 登录后跳转目标校验，防止开放重定向（架构 §2.7）。
 * 只允许站内绝对路径；拒绝协议相对地址、外部 URL 与登录页自身。
 */
export function resolveSafeRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login#')) {
    return null;
  }
  return value;
}
