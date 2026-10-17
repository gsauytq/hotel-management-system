import { describe, expect, it } from 'vitest';

import { describeLoginError } from '../src/utils/auth-errors';
import { ApiRequestError } from '../src/utils/errors';

describe('describeLoginError', () => {
  it('区分凭证错误、账号锁定与限流', () => {
    expect(
      describeLoginError(
        new ApiRequestError({
          status: 401,
          code: 'INVALID_CREDENTIALS',
          message: '用户名或密码错误',
        }),
      ),
    ).toEqual({ title: '登录失败', message: '用户名或密码错误' });

    expect(
      describeLoginError(
        new ApiRequestError({
          status: 423,
          code: 'ACCOUNT_LOCKED',
          message: '失败次数过多，账号已锁定，请 15 分钟后重试',
        }),
      ),
    ).toEqual({
      title: '账号已锁定',
      message: '失败次数过多，账号已锁定，请 15 分钟后重试',
    });

    expect(
      describeLoginError(
        new ApiRequestError({
          status: 429,
          code: 'RATE_LIMITED',
          message: '尝试次数过多，请稍后再试',
        }),
      ),
    ).toEqual({ title: '请求过于频繁', message: '尝试次数过多，请稍后再试' });
  });

  it('区分权限不足与输入校验失败', () => {
    expect(
      describeLoginError(
        new ApiRequestError({ status: 403, code: 'FORBIDDEN', message: '无权限执行该操作' }),
      ),
    ).toEqual({ title: '权限不足', message: '无权限执行该操作' });

    expect(
      describeLoginError(
        new ApiRequestError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: '参数校验失败',
        }),
      ),
    ).toEqual({ title: '输入有误', message: '参数校验失败' });
  });

  it('区分网络异常与服务器错误且不泄露内部错误详情', () => {
    expect(
      describeLoginError(
        new ApiRequestError({ message: '请求超时，请稍后重试', isNetworkError: true }),
      ),
    ).toEqual({ title: '网络异常', message: '请求超时，请稍后重试' });

    expect(
      describeLoginError(
        new ApiRequestError({
          status: 500,
          code: 'INTERNAL_ERROR',
          message: '数据库连接失败：secret-detail',
          requestId: 'req-500',
        }),
      ),
    ).toEqual({
      title: '服务器异常',
      message: '服务器暂时不可用（请求编号：req-500）',
    });

    expect(describeLoginError(new Error('unexpected internal detail'))).toEqual({
      title: '登录失败',
      message: '登录失败，请稍后重试。',
    });
  });
});
