import { describe, it, expect, vi } from 'vitest';
import { scopedDb } from '../../src/lib/scoped-query.js';

describe('scopedDb', () => {
  it('automatically injects userId into findMany queries', async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const fakeClient = {
      event: { findMany: mockFindMany },
    } as unknown as Parameters<typeof scopedDb>[1];

    const scoped = scopedDb('user-123', fakeClient);
    await scoped.event.findMany({ where: { status: 'SCHEDULED' } as any });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        status: 'SCHEDULED',
        userId: 'user-123',
      },
    });
  });

  it('injects userId into create mutations', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'evt-1' });
    const fakeClient = {
      event: { create: mockCreate },
    } as unknown as Parameters<typeof scopedDb>[1];

    const scoped = scopedDb('user-456', fakeClient);
    await scoped.event.create({
      data: { title: 'Test Event' } as any,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        title: 'Test Event',
        userId: 'user-456',
      },
    });
  });

  it('injects userId into updateMany and deleteMany', async () => {
    const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const mockDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeClient = {
      task: {
        updateMany: mockUpdateMany,
        deleteMany: mockDeleteMany,
      },
    } as unknown as Parameters<typeof scopedDb>[1];

    const scoped = scopedDb('user-789', fakeClient);
    await scoped.task.updateMany({ where: { status: 'PENDING' } as any, data: { status: 'COMPLETED' } as any });
    await scoped.task.deleteMany({ where: { isScheduled: false } as any });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', userId: 'user-789' },
      data: { status: 'COMPLETED' },
    });
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { isScheduled: false, userId: 'user-789' },
    });
  });
});
