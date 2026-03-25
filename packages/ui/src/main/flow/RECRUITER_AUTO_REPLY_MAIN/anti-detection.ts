/**
 * 反检测策略模块
 *
 * 用于模拟人类行为，避免被平台检测
 */

import { Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'

// ==================== 类型定义 ====================

/**
 * 反检测配置
 */
export interface AntiDetectionConfig {
  // 延迟配置
  minDelay: number              // 最小延迟（毫秒）
  maxDelay: number              // 最大延迟（毫秒）

  // 频率限制
  perMinuteLimit: number        // 每分钟操作上限
  perHourLimit: number          // 每小时操作上限
  dailyLimit: number            // 每日操作上限

  // 行为模拟
  simulateTyping: boolean       // 模拟打字
  simulateMouseMovement: boolean // 模拟鼠标移动
  randomScroll: boolean         // 随机滚动

  // 工作时间
  workHourStart: number         // 工作时间开始（小时，0-23）
  workHourEnd: number           // 工作时间结束（小时，0-23）
  respectWorkHours: boolean     // 是否遵守工作时间
}

/**
 * 默认反检测配置
 */
export const DEFAULT_ANTI_DETECTION_CONFIG: AntiDetectionConfig = {
  minDelay: 3000,
  maxDelay: 10000,
  perMinuteLimit: 10,
  perHourLimit: 50,
  dailyLimit: 100,
  simulateTyping: true,
  simulateMouseMovement: true,
  randomScroll: true,
  workHourStart: 9,
  workHourEnd: 18,
  respectWorkHours: false
}

/**
 * 操作统计
 */
export interface OperationStats {
  minuteCount: number
  hourCount: number
  dailyCount: number
  lastMinuteReset: Date
  lastHourReset: Date
  lastDailyReset: Date
}

// ==================== 全局统计 ====================

let operationStats: OperationStats = {
  minuteCount: 0,
  hourCount: 0,
  dailyCount: 0,
  lastMinuteReset: new Date(),
  lastHourReset: new Date(),
  lastDailyReset: new Date()
}

// ==================== 延迟函数 ====================

/**
 * 随机延迟
 */
export async function randomDelay(
  minMs: number = DEFAULT_ANTI_DETECTION_CONFIG.minDelay,
  maxMs: number = DEFAULT_ANTI_DETECTION_CONFIG.maxDelay
): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs)
  await sleep(delay)
}

/**
 * 带随机延迟发送消息
 */
export async function sendMessageWithDelay(
  page: Page,
  content: string,
  options: {
    minDelay?: number
    maxDelay?: number
    simulateTyping?: boolean
  } = {}
): Promise<void> {
  const minDelay = options.minDelay ?? DEFAULT_ANTI_DETECTION_CONFIG.minDelay
  const maxDelay = options.maxDelay ?? DEFAULT_ANTI_DETECTION_CONFIG.maxDelay
  const simulateTyping = options.simulateTyping ?? DEFAULT_ANTI_DETECTION_CONFIG.simulateTyping

  // 先随机等待
  await randomDelay(minDelay, maxDelay)

  // 获取输入框
  const chatInputSelector = `.chat-conversation .message-controls .chat-input`
  const chatInputHandle = await page.$(chatInputSelector)

  if (!chatInputHandle) {
    throw new Error('未找到聊天输入框')
  }

  // 点击输入框
  await chatInputHandle.click()
  await sleep(300 + Math.random() * 200)

  // 输入内容
  if (simulateTyping) {
    // 模拟真实打字
    const typingDelay = 30 + Math.random() * 50
    await chatInputHandle.type(content, { delay: typingDelay })
  } else {
    // 直接输入
    await page.evaluate((text) => {
      const input = document.querySelector('.chat-conversation .message-controls .chat-input') as HTMLTextAreaElement
      if (input) {
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }, content)
  }

  // 等待一下再发送
  await sleep(500 + Math.random() * 300)

  // 点击发送按钮
  const sendButtonSelector = `.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)`
  await page.click(sendButtonSelector)

  // 记录操作
  recordOperation()
}

// ==================== 行为模拟 ====================

/**
 * 模拟人类行为
 */
export async function simulateHumanBehavior(page: Page): Promise<void> {
  const actions = [
    () => simulateMouseMovement(page),
    () => simulateRandomScroll(page),
    () => simulatePause(page)
  ]

  // 随机选择1-2个行为
  const selectedActions = shuffleArray(actions).slice(0, 1 + Math.floor(Math.random() * 2))

  for (const action of selectedActions) {
    try {
      await action()
    } catch (error) {
      // 忽略错误，继续其他行为
    }
  }
}

/**
 * 模拟鼠标移动
 */
export async function simulateMouseMovement(page: Page): Promise<void> {
  try {
    const viewport = page.viewport()
    if (!viewport) return

    // 随机移动鼠标
    const x = Math.random() * viewport.width
    const y = Math.random() * viewport.height

    await page.mouse.move(x, y, {
      steps: 5 + Math.floor(Math.random() * 10)
    })

    await sleep(100 + Math.random() * 200)
  } catch (error) {
    // 忽略鼠标移动错误
  }
}

/**
 * 模拟随机滚动
 */
export async function simulateRandomScroll(page: Page): Promise<void> {
  try {
    const scrollAmount = 100 + Math.random() * 300
    const direction = Math.random() > 0.5 ? 1 : -1

    await page.evaluate((amount, dir) => {
      window.scrollBy({
        top: amount * dir,
        behavior: 'smooth'
      })
    }, scrollAmount, direction)

    await sleep(500 + Math.random() * 500)
  } catch (error) {
    // 忽略滚动错误
  }
}

/**
 * 模拟暂停（阅读时间）
 */
export async function simulatePause(page: Page): Promise<void> {
  // 模拟阅读或思考时间
  const pauseTime = 1000 + Math.random() * 3000
  await sleep(pauseTime)
}

// ==================== 频率限制 ====================

/**
 * 检查频率限制
 */
export function checkFrequencyLimit(
  config: AntiDetectionConfig = DEFAULT_ANTI_DETECTION_CONFIG
): {
  allowed: boolean
  reason?: string
  waitTime?: number
} {
  // 更新统计
  updateOperationStats()

  // 检查每分钟限制
  if (operationStats.minuteCount >= config.perMinuteLimit) {
    const waitTime = 60000 - (Date.now() - operationStats.lastMinuteReset.getTime())
    return {
      allowed: false,
      reason: '每分钟操作次数已达上限',
      waitTime
    }
  }

  // 检查每小时限制
  if (operationStats.hourCount >= config.perHourLimit) {
    const waitTime = 3600000 - (Date.now() - operationStats.lastHourReset.getTime())
    return {
      allowed: false,
      reason: '每小时操作次数已达上限',
      waitTime
    }
  }

  // 检查每日限制
  if (operationStats.dailyCount >= config.dailyLimit) {
    const waitTime = 86400000 - (Date.now() - operationStats.lastDailyReset.getTime())
    return {
      allowed: false,
      reason: '今日操作次数已达上限',
      waitTime
    }
  }

  return { allowed: true }
}

/**
 * 检查每日上限
 */
export function checkDailyLimit(
  dailyLimit: number = DEFAULT_ANTI_DETECTION_CONFIG.dailyLimit
): boolean {
  updateOperationStats()
  return operationStats.dailyCount < dailyLimit
}

/**
 * 获取当前统计
 */
export function getOperationStats(): OperationStats {
  updateOperationStats()
  return { ...operationStats }
}

/**
 * 记录操作
 */
export function recordOperation(): void {
  updateOperationStats()
  operationStats.minuteCount++
  operationStats.hourCount++
  operationStats.dailyCount++
}

/**
 * 重置统计
 */
export function resetOperationStats(): void {
  operationStats = {
    minuteCount: 0,
    hourCount: 0,
    dailyCount: 0,
    lastMinuteReset: new Date(),
    lastHourReset: new Date(),
    lastDailyReset: new Date()
  }
}

/**
 * 更新操作统计（自动重置过期数据）
 */
function updateOperationStats(): void {
  const now = new Date()
  const nowTime = now.getTime()

  // 每分钟重置
  if (nowTime - operationStats.lastMinuteReset.getTime() >= 60000) {
    operationStats.minuteCount = 0
    operationStats.lastMinuteReset = now
  }

  // 每小时重置
  if (nowTime - operationStats.lastHourReset.getTime() >= 3600000) {
    operationStats.hourCount = 0
    operationStats.lastHourReset = now
  }

  // 每日重置（检查日期变化）
  const lastDate = operationStats.lastDailyReset.toDateString()
  const currentDate = now.toDateString()
  if (lastDate !== currentDate) {
    operationStats.dailyCount = 0
    operationStats.lastDailyReset = now
  }
}

// ==================== 工作时间检查 ====================

/**
 * 检查是否在工作时间
 */
export function isWithinWorkHours(
  config: AntiDetectionConfig = DEFAULT_ANTI_DETECTION_CONFIG
): boolean {
  if (!config.respectWorkHours) {
    return true
  }

  const now = new Date()
  const hour = now.getHours()

  return hour >= config.workHourStart && hour < config.workHourEnd
}

/**
 * 获取下一个工作时间
 */
export function getNextWorkTime(
  config: AntiDetectionConfig = DEFAULT_ANTI_DETECTION_CONFIG
): Date {
  const now = new Date()
  const currentHour = now.getHours()

  if (currentHour < config.workHourStart) {
    // 当前时间早于工作时间，返回今天的开始时间
    const next = new Date(now)
    next.setHours(config.workHourStart, 0, 0, 0)
    return next
  } else if (currentHour >= config.workHourEnd) {
    // 当前时间晚于工作时间，返回明天的开始时间
    const next = new Date(now)
    next.setDate(next.getDate() + 1)
    next.setHours(config.workHourStart, 0, 0, 0)
    return next
  }

  // 当前在工作时间内
  return now
}

// ==================== 辅助函数 ====================

/**
 * 打乱数组
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * 解析反检测配置
 */
export function parseAntiDetectionConfig(json: any): AntiDetectionConfig {
  const config = json?.antiDetection || {}

  return {
    minDelay: config.minDelay ?? DEFAULT_ANTI_DETECTION_CONFIG.minDelay,
    maxDelay: config.maxDelay ?? DEFAULT_ANTI_DETECTION_CONFIG.maxDelay,
    perMinuteLimit: config.perMinuteLimit ?? DEFAULT_ANTI_DETECTION_CONFIG.perMinuteLimit,
    perHourLimit: config.perHourLimit ?? DEFAULT_ANTI_DETECTION_CONFIG.perHourLimit,
    dailyLimit: config.dailyLimit ?? DEFAULT_ANTI_DETECTION_CONFIG.dailyLimit,
    simulateTyping: config.simulateTyping ?? DEFAULT_ANTI_DETECTION_CONFIG.simulateTyping,
    simulateMouseMovement: config.simulateMouseMovement ?? DEFAULT_ANTI_DETECTION_CONFIG.simulateMouseMovement,
    randomScroll: config.randomScroll ?? DEFAULT_ANTI_DETECTION_CONFIG.randomScroll,
    workHourStart: config.workHourStart ?? DEFAULT_ANTI_DETECTION_CONFIG.workHourStart,
    workHourEnd: config.workHourEnd ?? DEFAULT_ANTI_DETECTION_CONFIG.workHourEnd,
    respectWorkHours: config.respectWorkHours ?? DEFAULT_ANTI_DETECTION_CONFIG.respectWorkHours
  }
}

/**
 * 格式化等待时间
 */
export function formatWaitTime(ms: number): string {
  if (ms < 60000) {
    return `${Math.ceil(ms / 1000)}秒`
  } else if (ms < 3600000) {
    return `${Math.ceil(ms / 60000)}分钟`
  } else {
    const hours = Math.floor(ms / 3600000)
    const minutes = Math.ceil((ms % 3600000) / 60000)
    return `${hours}小时${minutes}分钟`
  }
}