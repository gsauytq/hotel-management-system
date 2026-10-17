/**
 * 从 Cookie 请求头中读取指定名称的值（不依赖额外依赖）。
 * 仅做精确名称匹配；值按原样返回（会话 sid 为 hex，无需解码）。
 */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (cookieHeader === undefined || cookieHeader.length === 0) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) {
      return part.slice(separatorIndex + 1).trim();
    }
  }
  return undefined;
}
