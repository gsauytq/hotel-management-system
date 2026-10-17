import { isApiRequestError, toApiRequestError } from './errors';

export interface LoginErrorPresentation {
  title: string;
  message: string;
}

/**
 * 将登录失败分类为用户可理解的提示（架构 §2.8）：
 * - 网络/超时与 5xx 不暴露内部细节；
 * - 凭证错误、锁定、限流、权限不足使用后端稳定文案；
 * - 非 API 异常给出通用提示，避免泄露内部错误。
 */
export function describeLoginError(error: unknown): LoginErrorPresentation {
  if (!isApiRequestError(error)) {
    const normalized = toApiRequestError(error);
    if (normalized.isNetworkError) {
      return { title: '网络异常', message: normalized.message };
    }
    if (normalized.status !== undefined && normalized.status >= 500) {
      return {
        title: '服务器异常',
        message:
          normalized.requestId !== undefined
            ? `服务器暂时不可用（请求编号：${normalized.requestId}）`
            : '服务器暂时不可用，请稍后重试。',
      };
    }
    return { title: '登录失败', message: '登录失败，请稍后重试。' };
  }

  if (error.isNetworkError) {
    return { title: '网络异常', message: error.message };
  }

  if (error.status !== undefined && error.status >= 500) {
    return {
      title: '服务器异常',
      message:
        error.requestId !== undefined
          ? `服务器暂时不可用（请求编号：${error.requestId}）`
          : '服务器暂时不可用，请稍后重试。',
    };
  }

  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return { title: '登录失败', message: error.message };
    case 'ACCOUNT_LOCKED':
      return { title: '账号已锁定', message: error.message };
    case 'RATE_LIMITED':
      return { title: '请求过于频繁', message: error.message };
    case 'SESSION_EXPIRED':
      return { title: '会话已失效', message: '登录状态已失效，请重新登录。' };
    case 'FORBIDDEN':
      return { title: '权限不足', message: error.message };
    case 'VALIDATION_FAILED':
      return { title: '输入有误', message: error.message };
    default:
      return { title: '登录失败', message: error.message };
  }
}
