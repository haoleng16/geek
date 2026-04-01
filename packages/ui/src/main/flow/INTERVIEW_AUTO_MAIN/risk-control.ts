/**
 * 面试自动化 - 风控模块
 *
 * 负责风险控制，包括随机延迟、每日上限等
 */

import type { DataSource } from 'typeorm'
import {
  getInterviewSystemConfig,
  saveInterviewSystemConfig,
  countInterviewCandidatesByStatus,
  saveInterviewOperationLog
} from '@geekgeekrun/sqlite-plugin/handlers'

export interface RiskControlConfig {
  minDelayMs: number          // 最小延迟 3000ms
  maxDelayMs: number          // 最大延迟 8000ms
  dailyLimit: number          // 每日上限 100
  messagePerMinute: number    // 每分钟消息上限 5
  workHoursOnly: boolean      // 仅工作时间运行
  workHoursStart: number      // 工作时间开始 9
  workHoursEnd: number        // 工作时间结束 18
}

const DEFAULT_CONFIG: RiskControlConfig = {
  minDelayMs: 3000,
  maxDelayMs: 8000,
  dailyLimit: 100,
  messagePerMinute: 5,
  workHoursOnly: false,
  workHoursStart: 9,
  workHoursEnd: 18
}

// 今日发送消息计数
let todayMessageCount = 0
let lastResetDate = new Date().toDateString()

// 消息时间戳队列（用于限制每分钟消息数）
const messageTimestamps: number[] = []

/**
 * 获取风控配置
 */
export async function getRiskControlConfig(ds: DataSource): Promise<RiskControlConfig> {
  try {
    const configStr = await getInterviewSystemConfig(ds, 'risk_control_config')
    if (configStr) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(configStr) }
    }
    return DEFAULT_CONFIG
  } catch (error) {
    console.error('[RiskControl] 获取配置失败:', error)
    return DEFAULT_CONFIG
  }
}

/**
 * 保存风控配置
 */
export async function saveRiskControlConfig(
  ds: DataSource,
  config: Partial<RiskControlConfig>
): Promise<void> {
  const currentConfig = await getRiskControlConfig(ds)
  const newConfig = { ...currentConfig, ...config }
  await saveInterviewSystemConfig(ds, 'risk_control_config', JSON.stringify(newConfig))
}

/**
 * 随机延迟
 */
export async function randomDelay(
  minMs?: number,
  maxMs?: number
): Promise<void> {
  const min = minMs || DEFAULT_CONFIG.minDelayMs
  const max = maxMs || DEFAULT_CONFIG.maxDelayMs
  const delay = Math.floor(Math.random() * (max - min) + min)

  console.log(`[RiskControl] 随机延迟 ${delay}ms`)
  await new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * 检查是否在工作时间
 */
export function isWithinWorkHours(config: RiskControlConfig): boolean {
  if (!config.workHoursOnly) {
    return true
  }

  const now = new Date()
  const hour = now.getHours()

  return hour >= config.workHoursStart && hour < config.workHoursEnd
}

/**
 * 检查是否可以发送消息
 */
export async function canSendMessage(ds: DataSource): Promise<{
  allowed: boolean
  reason?: string
}> {
  try {
    const config = await getRiskControlConfig(ds)

    // 检查工作时间
    if (!isWithinWorkHours(config)) {
      return { allowed: false, reason: '不在工作时间内' }
    }

    // 检查每日上限
    resetDailyCountIfNeeded()

    if (todayMessageCount >= config.dailyLimit) {
      return { allowed: false, reason: '已达到每日上限' }
    }

    // 检查每分钟上限
    const now = Date.now()
    const oneMinuteAgo = now - 60000

    // 清理过期的消息时间戳
    while (messageTimestamps.length > 0 && messageTimestamps[0] < oneMinuteAgo) {
      messageTimestamps.shift()
    }

    if (messageTimestamps.length >= config.messagePerMinute) {
      return { allowed: false, reason: '每分钟消息上限已达到' }
    }

    return { allowed: true }
  } catch (error) {
    console.error('[RiskControl] 检查发送权限失败:', error)
    return { allowed: true } // 出错时默认允许
  }
}

/**
 * 记录消息发送
 */
export function recordMessageSent(): void {
  resetDailyCountIfNeeded()
  todayMessageCount++
  messageTimestamps.push(Date.now())
  console.log(`[RiskControl] 今日已发送消息: ${todayMessageCount}`)
}

/**
 * 重置每日计数（如果需要）
 */
function resetDailyCountIfNeeded(): void {
  const today = new Date().toDateString()
  if (lastResetDate !== today) {
    todayMessageCount = 0
    lastResetDate = today
    console.log('[RiskControl] 每日计数已重置')
  }
}

/**
 * 获取今日统计数据
 */
export function getTodayStats(): {
  messageCount: number
  date: string
} {
  resetDailyCountIfNeeded()
  return {
    messageCount: todayMessageCount,
    date: lastResetDate
  }
}

/**
 * 等待到下一个工作时段
 */
export async function waitUntilWorkHours(config: RiskControlConfig): Promise<void> {
  if (isWithinWorkHours(config)) {
    return
  }

  const now = new Date()
  const nextWorkTime = new Date()

  if (now.getHours() >= config.workHoursEnd) {
    // 已过工作时间，等到明天
    nextWorkTime.setDate(nextWorkTime.getDate() + 1)
  }

  nextWorkTime.setHours(config.workHoursStart, 0, 0, 0)

  const waitMs = nextWorkTime.getTime() - now.getTime()
  const waitMinutes = Math.round(waitMs / 60000)

  console.log(`[RiskControl] 等待到下一工作时段，约 ${waitMinutes} 分钟`)

  // 等待（每隔1分钟检查一次）
  while (!isWithinWorkHours(config)) {
    await new Promise(resolve => setTimeout(resolve, 60000))
  }
}

/**
 * 模拟人类行为
 */
export async function simulateHumanBehavior(): Promise<void> {
  // 随机短暂停顿
  const randomPause = Math.random() * 2000 + 500
  await new Promise(resolve => setTimeout(resolve, randomPause))

  // 有时稍微长一点
  if (Math.random() < 0.1) {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 2000))
  }
}

/**
 * 检查账号状态
 */
export async function checkAccountStatus(page: any): Promise<{
  normal: boolean
  reason?: string
}> {
  try {
    const currentUrl = page.url()

    // 检查是否被限制
    if (currentUrl.includes('verify') || currentUrl.includes('captcha')) {
      return { normal: false, reason: '需要验证码' }
    }

    if (currentUrl.includes('403') || currentUrl.includes('forbidden')) {
      return { normal: false, reason: '访问被限制' }
    }

    // 检查页面是否有错误提示
    const hasError = await page.evaluate(() => {
      const errorEl = document.querySelector('.error-tip, .error-message, [class*="error"]')
      return !!errorEl
    })

    if (hasError) {
      return { normal: false, reason: '页面存在错误提示' }
    }

    return { normal: true }
  } catch (error) {
    console.error('[RiskControl] 检查账号状态失败:', error)
    return { normal: true }
  }
}