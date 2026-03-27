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
 * 获取候选人的累计回复次数
 * 每个候选人总共最多回复 maxReplyCount 次（永久累计，不按天）
 */
export async function getReplyCount(
  ds: DataSource,
  sessionId: string,
  encryptGeekId: string
): Promise<number> {
  try {
    // 查询该候选人的累计回复次数（基于 encryptGeekId，跨所有记录）
    const result = await ds.query(
      `SELECT COALESCE(SUM(replyCount), 0) as totalReplyCount
       FROM smart_reply_record
       WHERE encryptGeekId = ?`,
      [encryptGeekId]
    )
    const count = result?.[0]?.totalReplyCount || 0
    console.log('[SessionManager] 候选人', encryptGeekId, '累计回复次数:', count)
    return count
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
    const now = new Date().toISOString()
    await ds.query(
      `UPDATE smart_reply_record SET replyCount = replyCount + 1, lastReplyAt = ? WHERE sessionId = ? AND encryptGeekId = ?`,
      [now, sessionId, encryptGeekId]
    )
  } catch (err) {
    console.error('[SessionManager] 增加回复次数失败:', err)
  }
}

/**
 * 获取或创建记录
 * 每个候选人在每次会话中有一条记录，replyCount 累加
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
    // 查找当前会话中该候选人的记录
    const existing = await ds.query(
      `SELECT * FROM smart_reply_record
       WHERE sessionId = ? AND encryptGeekId = ?
       LIMIT 1`,
      [sessionId, encryptGeekId]
    )

    if (existing && existing.length > 0) {
      console.log('[SessionManager] 找到会话记录:', existing[0].id)
      return existing[0]
    }

    // 创建新记录
    const now = new Date().toISOString()
    await ds.query(
      `INSERT INTO smart_reply_record (sessionId, encryptGeekId, geekName, encryptJobId, jobName, degree, workYears, replyCount, firstReplyAt, lastReplyAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        sessionId,
        encryptGeekId,
        info?.geekName || '',
        info?.encryptJobId || '',
        info?.jobName || '',
        info?.degree || '',
        info?.workYears || 0,
        now,
        now,
        now,
        now
      ]
    )

    console.log('[SessionManager] 创建新记录, encryptGeekId:', encryptGeekId)

    // 返回新创建的记录
    const newRecord = await ds.query(
      `SELECT * FROM smart_reply_record
       WHERE sessionId = ? AND encryptGeekId = ?
       LIMIT 1`,
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
    const now = new Date().toISOString()
    if (conversationHistory) {
      await ds.query(
        `UPDATE smart_reply_record
         SET lastLlmReply = ?, conversationHistory = ?, replyCount = replyCount + 1, lastReplyAt = ?
         WHERE sessionId = ? AND encryptGeekId = ?`,
        [reply, conversationHistory, now, sessionId, encryptGeekId]
      )
    } else {
      await ds.query(
        `UPDATE smart_reply_record
         SET lastLlmReply = ?, replyCount = replyCount + 1, lastReplyAt = ?
         WHERE sessionId = ? AND encryptGeekId = ?`,
        [reply, now, sessionId, encryptGeekId]
      )
    }
    console.log('[SessionManager] 更新回复成功, encryptGeekId:', encryptGeekId)
  } catch (err) {
    console.error('[SessionManager] 更新最后回复内容失败:', err)
  }
}