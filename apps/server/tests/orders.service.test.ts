import { describe, expect, it, vi } from 'vitest';

import type {
  OrderDetailRecord,
  OrderListItemRecord,
  OrdersRepository,
} from '../src/modules/orders/orders.repository.js';
import { createOrdersService } from '../src/modules/orders/orders.service.js';

function createRepositoryMock() {
  return {
    list: vi.fn<OrdersRepository['list']>(),
    findById: vi.fn<OrdersRepository['findById']>(),
  };
}

function makeListItem(overrides: Partial<OrderListItemRecord> = {}): OrderListItemRecord {
  return {
    id: 900,
    stayId: 501,
    guestName: '张三',
    roomNumber: '0821',
    totalAmount: 614,
    paidAmount: 414,
    paymentMethod: 'WECHAT',
    status: 'PAID',
    createdAt: new Date('2026-10-17T04:30:00.000Z'),
    ...overrides,
  };
}

function makeDetail(overrides: Partial<OrderDetailRecord> = {}): OrderDetailRecord {
  return {
    ...makeListItem(),
    items: [
      { type: 'ROOM_FEE', name: '房费 2 晚 × 288.00', amount: 576 },
      { type: 'MISC', name: '迷你吧消费', amount: 38 },
      { type: 'DEPOSIT_APPLIED', name: '押金抵扣', amount: 200 },
    ],
    depositAmount: 200,
    depositApplied: 200,
    note: '客人对房费无异议',
    updatedAt: new Date('2026-10-17T04:30:00.000Z'),
    ...overrides,
  };
}

describe('orders.service（O1/O2 只读账单）', () => {
  it('列表：筛选/分页透传仓储，映射为 OrderListItem DTO', async () => {
    const repository = createRepositoryMock();
    repository.list.mockResolvedValue({ total: 3, items: [makeListItem()] });
    const service = createOrdersService({ repository });

    const result = await service.list({
      stayId: 501,
      createdFrom: '2026-10-01',
      createdTo: '2026-10-31',
      page: 1,
      pageSize: 20,
      orderBy: [{ createdAt: 'desc' }],
    });

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        stayId: 501,
        createdFrom: '2026-10-01',
        createdTo: '2026-10-31',
      }),
    );
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    expect(result.items[0]).toEqual({
      id: 900,
      stayId: 501,
      guestName: '张三',
      roomNumber: '0821',
      totalAmount: 614,
      paidAmount: 414,
      paymentMethod: 'WECHAT',
      status: 'PAID',
      createdAt: '2026-10-17T04:30:00.000Z',
    });
  });

  it('详情：返回费用明细与押金抵扣；不存在 404', async () => {
    const repository = createRepositoryMock();
    const service = createOrdersService({ repository });

    repository.findById.mockResolvedValueOnce(makeDetail());
    const detail = await service.getById(900);
    expect(detail).toMatchObject({
      id: 900,
      stayId: 501,
      status: 'PAID',
      totalAmount: 614,
      depositAmount: 200,
      depositApplied: 200,
      paidAmount: 414,
      paymentMethod: 'WECHAT',
      note: '客人对房费无异议',
      createdAt: '2026-10-17T04:30:00.000Z',
      updatedAt: '2026-10-17T04:30:00.000Z',
    });
    expect(detail.items).toEqual([
      { type: 'ROOM_FEE', name: '房费 2 晚 × 288.00', amount: 576 },
      { type: 'MISC', name: '迷你吧消费', amount: 38 },
      { type: 'DEPOSIT_APPLIED', name: '押金抵扣', amount: 200 },
    ]);

    repository.findById.mockResolvedValueOnce(null);
    await expect(service.getById(999)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});
