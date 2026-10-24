import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  searchStudents,
  getOrCreateConversation,
  sendDirectMessage,
  getConversationMessages,
  listUserConversations,
} from '../../src/modules/chat/chat.service.js';
import { ApiError } from '../../src/lib/errors.js';

vi.mock('@personal-schedule/database', () => {
  const mDb = {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    directConversation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    directChatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    getPrismaClient: () => mDb,
  };
});

import { getPrismaClient } from '@personal-schedule/database';

describe('Chat Service (Direct 1-1)', () => {
  const db = getPrismaClient() as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchStudents', () => {
    it('returns empty array when query is too short', async () => {
      const res = await searchStudents('a', 'user-1');
      expect(res).toEqual([]);
      expect(db.user.findMany).not.toHaveBeenCalled();
    });

    it('searches users by name or studentId and excludes current user', async () => {
      db.user.findMany.mockResolvedValue([
        {
          id: 'user-2',
          name: 'Nguyễn Văn B',
          email: 'b@ued.udn.vn',
          studentId: '3120224099',
        },
      ]);

      const res = await searchStudents('312022', 'user-1');
      expect(res).toHaveLength(1);
      expect(res[0].studentId).toBe('3120224099');
      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { not: 'user-1' },
          }),
        })
      );
    });
  });

  describe('getOrCreateConversation', () => {
    it('throws CANNOT_CHAT_WITH_SELF if users are identical', async () => {
      await expect(getOrCreateConversation('user-1', 'user-1')).rejects.toThrow(ApiError);
      await expect(getOrCreateConversation('user-1', 'user-1')).rejects.toThrow(/bản thân/i);
    });

    it('returns existing conversation if found (sorted IDs)', async () => {
      const mockConv = {
        id: 'conv-1',
        user1Id: 'user-1',
        user2Id: 'user-2',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.directConversation.findUnique.mockResolvedValue(mockConv);

      const res = await getOrCreateConversation('user-2', 'user-1');
      expect(res).toEqual(mockConv);
      expect(db.directConversation.findUnique).toHaveBeenCalledWith({
        where: {
          user1Id_user2Id: {
            user1Id: 'user-1',
            user2Id: 'user-2',
          },
        },
        include: expect.any(Object),
      });
      expect(db.directConversation.create).not.toHaveBeenCalled();
    });

    it('creates new conversation if not exists', async () => {
      db.directConversation.findUnique.mockResolvedValue(null);
      const createdConv = {
        id: 'conv-new',
        user1Id: 'user-1',
        user2Id: 'user-2',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.directConversation.create.mockResolvedValue(createdConv);

      const res = await getOrCreateConversation('user-1', 'user-2');
      expect(res).toEqual(createdConv);
      expect(db.directConversation.create).toHaveBeenCalledWith({
        data: {
          user1Id: 'user-1',
          user2Id: 'user-2',
        },
        include: expect.any(Object),
      });
    });
  });

  describe('sendDirectMessage', () => {
    it('throws EMPTY_MESSAGE when content is empty or whitespace', async () => {
      await expect(sendDirectMessage('user-1', 'conv-1', '   ')).rejects.toThrow(ApiError);
      await expect(sendDirectMessage('user-1', 'conv-1', '   ')).rejects.toThrow(/trống/i);
    });

    it('throws CONVERSATION_NOT_FOUND when conversation does not exist', async () => {
      db.directConversation.findUnique.mockResolvedValue(null);
      await expect(sendDirectMessage('user-1', 'conv-unknown', 'Hello')).rejects.toThrow(ApiError);
    });

    it('throws FORBIDDEN when sender is not part of the conversation', async () => {
      db.directConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        user1Id: 'user-1',
        user2Id: 'user-2',
      });
      await expect(sendDirectMessage('user-imposter', 'conv-1', 'Hello')).rejects.toThrow(ApiError);
    });

    it('creates message and touches conversation updatedAt', async () => {
      db.directConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        user1Id: 'user-1',
        user2Id: 'user-2',
      });
      const mockMessage = {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'Chào bạn',
        isRead: false,
        createdAt: new Date(),
        sender: { id: 'user-1', name: 'User 1', studentId: '312' },
      };
      db.directChatMessage.create.mockResolvedValue(mockMessage);
      db.directConversation.update.mockResolvedValue({});

      const res = await sendDirectMessage('user-1', 'conv-1', 'Chào bạn');
      expect(res).toEqual(mockMessage);
      expect(db.directChatMessage.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-1',
          senderId: 'user-1',
          content: 'Chào bạn',
        },
        include: expect.any(Object),
      });
      expect(db.directConversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { updatedAt: expect.any(Date) },
      });
    });
  });

  describe('getConversationMessages', () => {
    it('throws FORBIDDEN if requesting user is not a participant', async () => {
      db.directConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        user1Id: 'user-1',
        user2Id: 'user-2',
      });
      await expect(getConversationMessages('user-outsider', 'conv-1')).rejects.toThrow(ApiError);
    });

    it('returns messages and marks unread messages as read', async () => {
      db.directConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        user1Id: 'user-1',
        user2Id: 'user-2',
      });
      const mockMessages = [
        { id: 'msg-1', content: 'Hi', senderId: 'user-2', createdAt: new Date() },
      ];
      db.directChatMessage.findMany.mockResolvedValue(mockMessages);
      db.directChatMessage.updateMany.mockResolvedValue({ count: 1 });

      const res = await getConversationMessages('user-1', 'conv-1');
      expect(res).toEqual(mockMessages);
      expect(db.directChatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'conv-1' },
          orderBy: { createdAt: 'asc' },
        })
      );
      // Marks messages sent by other user as read
      expect(db.directChatMessage.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          senderId: { not: 'user-1' },
          isRead: false,
        },
        data: { isRead: true },
      });
    });
  });

  describe('listUserConversations', () => {
    it('lists conversations with the other participant info and last message', async () => {
      const mockConvs = [
        {
          id: 'conv-1',
          user1Id: 'user-1',
          user2Id: 'user-2',
          createdAt: new Date(),
          updatedAt: new Date(),
          user1: { id: 'user-1', name: 'User 1', studentId: '111' },
          user2: { id: 'user-2', name: 'User 2', studentId: '222' },
          messages: [
            { id: 'msg-latest', content: 'Last msg', senderId: 'user-2', createdAt: new Date(), isRead: false },
          ],
        },
      ];
      db.directConversation.findMany.mockResolvedValue(mockConvs);

      const res = await listUserConversations('user-1');
      expect(res).toHaveLength(1);
      expect(res[0].otherUser.id).toBe('user-2');
      expect(res[0].otherUser.name).toBe('User 2');
      expect(res[0].lastMessage?.content).toBe('Last msg');
    });
  });
});
