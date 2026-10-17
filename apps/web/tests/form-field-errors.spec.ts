import { describe, expect, it } from 'vitest';

import { ApiRequestError, extractFieldErrors } from '../src/utils/errors';

/**
 * TC-UI-005（NFR-SEC-005 / 架构 §2.4）：422 details[].field 的字段级提取。
 *
 * 说明：当前页面表单通过统一的 submitError 文案展示后端详情（formatApiError），
 * 并未逐字段调用 ElForm.validateField；本用例验证共享提取函数的真实行为。
 * 视图层逐字段映射尚未接线，已在最终报告中登记为实现缺口，不在此虚构断言。
 */
describe('TC-UI-005 422 字段级错误提取', () => {
  it('按字段聚合 details，保留字段与消息顺序', () => {
    const error = new ApiRequestError({
      status: 422,
      message: '参数校验失败',
      details: [
        { field: 'checkInDate', message: '入住日期不能早于今日' },
        { field: 'checkOutDate', message: '离店日期必须晚于入住日期' },
        { field: 'checkInDate', message: '日期格式错误' },
      ],
    });

    expect(extractFieldErrors(error)).toEqual({
      checkInDate: ['入住日期不能早于今日', '日期格式错误'],
      checkOutDate: ['离店日期必须晚于入住日期'],
    });
  });

  it('无 details 或跨域错误时返回空映射，不抛异常', () => {
    expect(extractFieldErrors(new ApiRequestError({ status: 409, message: '业务冲突' }))).toEqual(
      {},
    );
    expect(
      extractFieldErrors(new ApiRequestError({ message: '网络异常', isNetworkError: true })),
    ).toEqual({});
  });
});
