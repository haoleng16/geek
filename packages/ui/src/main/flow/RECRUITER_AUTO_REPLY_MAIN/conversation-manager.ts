/**
 * 多轮对话管理模块
 *
 * 用于追踪和管理与候选人的多轮对话状态
 */

import { DataSource } from 'typeorm'
import {
  CandidateConversation,
  saveCandidateConversation,
  getCandidateConversation
} from '@geekgeekrun/sqlite-plugin/dist/handlers'

// ==================== 类型定义 ====================

/**
 * 对话状态枚举
 */
export enum ConversationStatus {
  PENDING = 'pending',       // 待处理
  MATCHED = 'matched',       // 已匹配
  REJECTED = 'rejected',     // 已拒绝
  HANDOVER = 'handover'      // 已转人工
}

/**
 * 对话轮次信息
 */
export interface ConversationRoundInfo {
  encryptGeekId: string
  encryptJobId: string
  roundCount: number
  status: ConversationStatus
  firstContactAt: Date | null
  lastReplyAt: Date | null
  shouldHandover: boolean
}

/**
 * 对话管理配置
 */
export interface ConversationManagerConfig {
  maxRounds: number              // 最大对话轮次，超过后转人工
  handoverKeywords: string[]     // 触发转人工的关键词
  autoHandoverOnComplex: boolean // 遇到复杂问题自动转人工
}

/**
 * 默认配置
 */
export const DEFAULT_CONVERSATION_CONFIG: ConversationManagerConfig = {
  maxRounds: 3,
  handoverKeywords: ['人工客服', '转人工', '人工', '电话联系', '面试', '薪资'],
  autoHandoverOnComplex: true
}

// ==================== 核心函数 ====================

/**
 * 获取对话轮次
 */
export async function getConversationRound(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
): Promise<number> {
  try {
    const conversation = await getCandidateConversation(ds, encryptGeekId, encryptJobId)
    return conversation?.roundCount || 0
  } catch (error) {
    console.error('[对话管理] 获取轮次失败:', error)
    return 0
  }
}

/**
 * 获取对话状态
 */
export async function getConversationStatus(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
): Promise<ConversationStatus> {
  try {
    const conversation = await getCandidateConversation(ds, encryptGeekId, encryptJobId)
    return (conversation?.status as ConversationStatus) || ConversationStatus.PENDING
  } catch (error) {
    console.error('[对话管理] 获取状态失败:', error)
    return ConversationStatus.PENDING
  }
}

/**
 * 获取完整对话信息
 */
export async function getConversationInfo(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string,
  config: ConversationManagerConfig = DEFAULT_CONVERSATION_CONFIG
): Promise<ConversationRoundInfo> {
  try {
    const conversation = await getCandidateConversation(ds, encryptGeekId, encryptJobId)

    if (!conversation) {
      return {
        encryptGeekId,
        encryptJobId,
        roundCount: 0,
        status: ConversationStatus.PENDING,
        firstContactAt: null,
        lastReplyAt: null,
        shouldHandover: false
      }
    }

    return {
      encryptGeekId,
      encryptJobId,
      roundCount: conversation.roundCount || 0,
      status: (conversation.status as ConversationStatus) || ConversationStatus.PENDING,
      firstContactAt: conversation.firstContactAt,
      lastReplyAt: conversation.lastReplyAt,
      shouldHandover: shouldHandoverToHuman(conversation.roundCount, config.maxRounds)
    }
  } catch (error) {
    console.error('[对话管理] 获取对话信息失败:', error)
    return {
      encryptGeekId,
      encryptJobId,
      roundCount: 0,
      status: ConversationStatus.PENDING,
      firstContactAt: null,
      lastReplyAt: null,
      shouldHandover: false
    }
  }
}

/**
 * 初始化对话记录（首次联系）
 */
export async function initConversation(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
): Promise<CandidateConversation> {
  const now = new Date()

  const conversation = await saveCandidateConversation(ds, {
    encryptGeekId,
    encryptJobId,
    roundCount: 0,
    status: ConversationStatus.PENDING,
    firstContactAt: now,
    lastReplyAt: now
  })

  console.log(`[对话管理] 初始化对话: ${encryptGeekId} - ${encryptJobId}`)
  return conversation
}

/**
 * 增加对话轮次
 */
export async function incrementConversationRound(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
): Promise<number> {
  try {
    // 获取当前对话
    let conversation = await getCandidateConversation(ds, encryptGeekId, encryptJobId)

    if (!conversation) {
      // 如果不存在，创建新记录
      conversation = await initConversation(ds, encryptGeekId, encryptJobId)
    }

    // 增加轮次
    const newRoundCount = (conversation.roundCount || 0) + 1

    await saveCandidateConversation(ds, {
      ...conversation,
      roundCount: newRoundCount,
      lastReplyAt: new Date()
    })

    console.log(`[对话管理] 轮次更新: ${encryptGeekId} -> ${newRoundCount}`)
    return newRoundCount
  } catch (error) {
    console.error('[对话管理] 更新轮次失败:', error)
    return 0
  }
}

/**
 * 更新对话状态
 */
export async function updateConversationStatus(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string,
  status: ConversationStatus
): Promise<void> {
  try {
    let conversation = await getCandidateConversation(ds, encryptGeekId, encryptJobId)

    if (!conversation) {
      conversation = await initConversation(ds, encryptGeekId, encryptJobId)
    }

    await saveCandidateConversation(ds, {
      ...conversation,
      status,
      lastReplyAt: new Date()
    })

    console.log(`[对话管理] 状态更新: ${encryptGeekId} -> ${status}`)
  } catch (error) {
    console.error('[对话管理] 更新状态失败:', error)
  }
}

// ==================== 转人工判断 ====================

/**
 * 判断是否应该转人工
 */
export function shouldHandoverToHuman(
  roundCount: number,
  maxRounds: number
): boolean {
  return roundCount >= maxRounds
}

/**
 * 检查消息是否包含转人工关键词
 */
export function checkHandoverKeywords(
  message: string,
  keywords: string[] = DEFAULT_CONVERSATION_CONFIG.handoverKeywords
): boolean {
  if (!message) return false

  const lowerMessage = message.toLowerCase()
  return keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))
}

/**
 * 标记转人工
 */
export async function markAsHandover(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
): Promise<void> {
  await updateConversationStatus(ds, encryptGeekId, encryptJobId, ConversationStatus.HANDOVER)
  console.log(`[对话管理] 已转人工: ${encryptGeekId}`)
}

/**
 * 标记为已匹配
 */
export async function markAsMatched(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
): Promise<void> {
  await updateConversationStatus(ds, encryptGeekId, encryptJobId, ConversationStatus.MATCHED)
}

/**
 * 标记为已拒绝
 */
export async function markAsRejected(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
): Promise<void> {
  await updateConversationStatus(ds, encryptGeekId, encryptJobId, ConversationStatus.REJECTED)
}

// ==================== 对话历史 ====================

/**
 * 检查是否已处理过该候选人
 */
export async function isAlreadyProcessed(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
): Promise<boolean> {
  const conversation = await getCandidateConversation(ds, encryptGeekId, encryptJobId)
  return !!conversation && conversation.status !== ConversationStatus.PENDING
}

/**
 * 获取待处理候选人数量
 */
export async function getPendingCount(
  ds: DataSource,
  encryptJobId?: string
): Promise<number> {
  try {
    // 这里需要直接查询数据库
    const repo = ds.getRepository('CandidateConversation')
    const where: any = { status: ConversationStatus.PENDING }
    if (encryptJobId) where.encryptJobId = encryptJobId

    const count = await repo.count({ where })
    return count
  } catch (error) {
    console.error('[对话管理] 获取待处理数量失败:', error)
    return 0
  }
}

// ==================== 辅助函数 ====================

/**
 * 解析对话管理配置
 */
export function parseConversationConfig(json: any): ConversationManagerConfig {
  const config = json?.conversation || {}

  return {
    maxRounds: config.maxRounds || DEFAULT_CONVERSATION_CONFIG.maxRounds,
    handoverKeywords: config.handoverKeywords || DEFAULT_CONVERSATION_CONFIG.handoverKeywords,
    autoHandoverOnComplex: config.autoHandoverOnComplex ?? DEFAULT_CONVERSATION_CONFIG.autoHandoverOnComplex
  }
}

/**
 * 格式化对话信息（用于日志）
 */
export function formatConversationInfo(info: ConversationRoundInfo): string {
  return `候选人: ${info.encryptGeekId.slice(-6)} | ` +
         `轮次: ${info.roundCount} | ` +
         `状态: ${info.status}` +
         (info.shouldHandover ? ' | ⚠️ 建议转人工' : '')
}