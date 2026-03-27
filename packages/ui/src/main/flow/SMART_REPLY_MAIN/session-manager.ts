import { randomUUID } from 'node:crypto'
import type { DataSource } from 'typeorm'

let currentSessionId: string | null = null

/**
 * 启动新会话
 */
export function startNewSession(): string {
  currentSessionId = randomUUID()
  console.log('[SessionManager] 新会话启动:', currentSessionId)
  return currentSessionId
}

/**
 * 获取当前会话ID
 */
export function getCurrentSessionId(): string | null {
  return currentSessionId
}

/**
 * 结束会话
 */
export function endSession(): void {
  console.log('[SessionManager] 会话结束:', currentSessionId)
  currentSessionId = null
}

/**
 * 检查候选人回复次数
 */
export async function getReplyCount(
  ds: DataSource,
  sessionId: string,
  encryptGeekId: string
): Promise<number> {
  try {
    const result = await ds.query(
      `SELECT replyCount FROM smart_reply_record WHERE sessionId = ? AND encryptGeekId = ? LIMIT 1`,
      [sessionId, encryptGeekId]
    )
    return result?.[0]?.replyCount || 0
  } catch (err) {
    console.error('[SessionManager] 获取回复次数失败:', err)
    return 0
  }
}

/**
 * 增加回复次数
 */
export async function incrementReplyCount(
  ds: DataSource,
  sessionId: string,
  encryptGeekId: string
): Promise<void> {
  try {
    await ds.query(
      `UPDATE smart_reply_record SET replyCount = replyCount + 1, lastReplyAt = datetime('now') WHERE sessionId = ? AND encryptGeekId = ?`,
      [sessionId, encryptGeekId]
    )
  } catch (err) {
    console.error('[SessionManager] 增加回复次数失败:', err)
  }
}

/**
 * 获取或创建记录
 */
export async function getOrCreateRecord(
  ds: DataSource,
  sessionId: string,
  encryptGeekId: string,
  info?: {
    geekName?: string
    encryptJobId?: string
    jobName?: string
    degree?: string
    workYears?: number
  }
): Promise<any> {
  try {
    // 先尝试查找
    const existing = await ds.query(
      `SELECT * FROM smart_reply_record WHERE sessionId = ? AND encryptGeekId = ? LIMIT 1`,
      [sessionId, encryptGeekId]
    )

    if (existing && existing.length > 0) {
      return existing[0]
    }

    // 创建新记录
    const now = new Date().toISOString()
    await ds.query(
      `INSERT INTO smart_reply_record (sessionId, encryptGeekId, geekName, encryptJobId, jobName, degree, workYears, replyCount, firstReplyAt, lastReplyAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'), datetime('now'))`,
      [
        sessionId,
        encryptGeekId,
        info?.geekName || '',
        info?.encryptJobId || '',
        info?.jobName || '',
        info?.degree || '',
        info?.workYears || 0,
        now,
        now
      ]
    )

    // 返回新创建的记录
    const newRecord = await ds.query(
      `SELECT * FROM smart_reply_record WHERE sessionId = ? AND encryptGeekId = ? LIMIT 1`,
      [sessionId, encryptGeekId]
    )
    return newRecord?.[0]
  } catch (err) {
    console.error('[SessionManager] 获取或创建记录失败:', err)
    return null
  }
}

/**
 * 更新最后回复内容
 */
export async function updateLastLlmReply(
  ds: DataSource,
  sessionId: string,
  encryptGeekId: string,
  reply: string,
  conversationHistory?: string
): Promise<void> {
  try {
    if (conversationHistory) {
      await ds.query(
        `UPDATE smart_reply_record SET lastLlmReply = ?, conversationHistory = ?, replyCount = replyCount + 1, lastReplyAt = datetime('now') WHERE sessionId = ? AND encryptGeekId = ?`,
        [reply, conversationHistory, sessionId, encryptGeekId]
      )
    } else {
      await ds.query(
        `UPDATE smart_reply_record SET lastLlmReply = ?, replyCount = replyCount + 1, lastReplyAt = datetime('now') WHERE sessionId = ? AND encryptGeekId = ?`,
        [reply, sessionId, encryptGeekId]
      )
    }
  } catch (err) {
    console.error('[SessionManager] 更新最后回复内容失败:', err)
  }
}