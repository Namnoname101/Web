import { getPrismaClient } from '@personal-schedule/database';
import { ApiError } from '../../lib/errors.js';

const db = () => getPrismaClient();

export interface StudentPublicProfile {
  id: string;
  name: string;
  email: string;
  studentId: string | null;
}

export interface ConversationSummary {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  otherUser: StudentPublicProfile;
  lastMessage: {
    id: string;
    content: string;
    senderId: string;
    createdAt: Date;
    isRead: boolean;
  } | null;
}

/**
 * Tìm kiếm sinh viên theo MSSV, họ tên hoặc email (loại trừ chính mình).
 */
export async function searchStudents(query: string, currentUserId: string): Promise<StudentPublicProfile[]> {
  const q = (query || '').trim();
  if (q.length < 2) return [];

  const students = await db().user.findMany({
    where: {
      id: { not: currentUserId },
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { studentId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      studentId: true,
    },
    take: 20,
  });

  return students;
}

/**
 * Lấy hoặc tạo mới cuộc trò chuyện 1-1 giữa 2 sinh viên.
 * Tự động chuẩn hoá thứ tự ID để luôn chỉ có duy nhất 1 cuộc trò chuyện giữa 2 người.
 */
export async function getOrCreateConversation(user1Id: string, user2Id: string) {
  if (user1Id === user2Id) {
    throw new ApiError(400, 'CANNOT_CHAT_WITH_SELF', 'Không thể tạo cuộc trò chuyện với chính bản thân');
  }

  const [u1, u2] = [user1Id, user2Id].sort();

  let conversation = await db().directConversation.findUnique({
    where: {
      user1Id_user2Id: {
        user1Id: u1,
        user2Id: u2,
      },
    },
    include: {
      user1: { select: { id: true, name: true, email: true, studentId: true } },
      user2: { select: { id: true, name: true, email: true, studentId: true } },
    },
  });

  if (!conversation) {
    conversation = await db().directConversation.create({
      data: {
        user1Id: u1,
        user2Id: u2,
      },
      include: {
        user1: { select: { id: true, name: true, email: true, studentId: true } },
        user2: { select: { id: true, name: true, email: true, studentId: true } },
      },
    });
  }

  return conversation;
}

/**
 * Gửi tin nhắn trực tiếp trong cuộc trò chuyện 1-1.
 */
export async function sendDirectMessage(senderId: string, conversationId: string, content: string) {
  const trimmed = (content || '').trim();
  if (!trimmed) {
    throw new ApiError(400, 'EMPTY_MESSAGE', 'Nội dung tin nhắn không được để trống');
  }

  const conversation = await db().directConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Không tìm thấy cuộc trò chuyện');
  }

  if (conversation.user1Id !== senderId && conversation.user2Id !== senderId) {
    throw new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền gửi tin nhắn trong cuộc trò chuyện này');
  }

  const message = await db().directChatMessage.create({
    data: {
      conversationId,
      senderId,
      content: trimmed,
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          studentId: true,
        },
      },
    },
  });

  // Cập nhật mốc thời gian hoạt động của cuộc trò chuyện
  await db().directConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return message;
}

/**
 * Lấy lịch sử tin nhắn trong cuộc trò chuyện và đánh dấu đã đọc.
 */
export async function getConversationMessages(userId: string, conversationId: string, limit = 50) {
  const conversation = await db().directConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Không tìm thấy cuộc trò chuyện');
  }

  if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
    throw new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền xem cuộc trò chuyện này');
  }

  const messages = await db().directChatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          studentId: true,
        },
      },
    },
  });

  // Đánh dấu đã đọc các tin nhắn gửi tới mình
  await db().directChatMessage.updateMany({
    where: {
      conversationId,
      senderId: { not: userId },
      isRead: false,
    },
    data: { isRead: true },
  });

  return messages;
}

/**
 * Liệt kê danh sách cuộc trò chuyện của một sinh viên, kèm tin nhắn gần nhất.
 */
export async function listUserConversations(userId: string): Promise<ConversationSummary[]> {
  const convs = await db().directConversation.findMany({
    where: {
      OR: [{ user1Id: userId }, { user2Id: userId }],
    },
    include: {
      user1: { select: { id: true, name: true, email: true, studentId: true } },
      user2: { select: { id: true, name: true, email: true, studentId: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return convs.map((c) => {
    const isUser1 = c.user1Id === userId;
    const otherUser = isUser1 ? c.user2 : c.user1;
    const lastMsg = c.messages && c.messages.length > 0 ? c.messages[0] : null;

    return {
      id: c.id,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      otherUser,
      lastMessage: lastMsg
        ? {
            id: lastMsg.id,
            content: lastMsg.content,
            senderId: lastMsg.senderId,
            createdAt: lastMsg.createdAt,
            isRead: lastMsg.isRead,
          }
        : null,
    };
  });
}
