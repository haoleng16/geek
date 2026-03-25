/**
 * 快捷回复消息模块
 *
 * 用于招聘者一键发送预设消息给求职者
 */

import { Page } from 'puppeteer'
import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'

// ==================== 类型定义 ====================

/**
 * 快捷回复项
 */
export interface QuickReplyItem {
  id: string | number          // 唯一标识
  name: string                 // 回复名称，如 "邀请面试"
  content: string              // 回复内容
  enabled: boolean             // 是否启用
  order: number                // 排序
  shortcut?: string            // 快捷键（可选）
}

/**
 * 快捷回复配置
 */
export interface QuickReplyConfig {
  list: QuickReplyItem[]       // 快捷回复列表
  defaultReplyIndex: number    // 默认回复的索引
}

/**
 * 回复策略配置
 */
export interface ReplyStrategyConfig {
  // 匹配时的回复
  matchReplyMode: 'constant' | 'first_quick_reply' | 'random_quick_reply'
  matchReplyContent: string    // 固定回复内容
  matchQuickReplyId: string | number | null  // 指定的快捷回复ID

  // 不匹配时的处理
  notMatchAction: 'skip' | 'mark_not_suitable' | 'reply'
  notMatchReplyContent: string // 不匹配时的回复内容（如果action是reply）
}

/**
 * 默认快捷回复列表
 */
export const DEFAULT_QUICK_REPLY_LIST: QuickReplyItem[] = [
  {
    id: 1,
    name: '收到简历',
    content: '您好，收到您的简历，我们会尽快查看并给您回复，谢谢！',
    enabled: true,
    order: 1
  },
  {
    id: 2,
    name: '邀请面试',
    content: '您好，您的简历已通过初步筛选，方便安排面试吗？请问您什么时间方便？',
    enabled: true,
    order: 2
  },
  {
    id: 3,
    name: '索要简历',
    content: '您好，能发一份详细的简历吗？我们想进一步了解您的背景。',
    enabled: true,
    order: 3
  },
  {
    id: 4,
    name: '询问期望薪资',
    content: '您好，请问您的期望薪资是多少？我们这边好评估一下。',
    enabled: true,
    order: 4
  },
  {
    id: 5,
    name: '询问到岗时间',
    content: '您好，请问您最快什么时候能到岗？',
    enabled: true,
    order: 5
  },
  {
    id: 6,
    name: '发送面试地址',
    content: '您好，面试地址：[请填写具体地址]，请准时参加。',
    enabled: false,
    order: 6
  }
]

// ==================== 发送消息函数 ====================

/**
 * 发送文本消息
 */
export async function sendTextMessage(page: Page, text: string): Promise<boolean> {
  try {
    // 检查是否有聊天输入框
    const chatInputSelector = `.chat-conversation .message-controls .chat-input`
    const chatInputHandle = await page.$(chatInputSelector)

    if (!chatInputHandle) {
      console.error('未找到聊天输入框')
      return false
    }

    // 点击输入框，获取焦点
    await chatInputHandle.click()
    await sleep(300)
    await chatInputHandle.click()
    await sleep(200)

    // 清空现有内容
    await page.evaluate(() => {
      const input = document.querySelector('.chat-conversation .message-controls .chat-input') as HTMLTextAreaElement
      if (input) {
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    // 输入文本（模拟真实打字）
    await chatInputHandle.type(text, {
      delay: 30 + Math.random() * 20  // 30-50ms随机延迟
    })

    await sleep(500 + Math.random() * 300)

    // 点击发送按钮
    const sendButtonSelector = `.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)`
    const sendButton = await page.$(sendButtonSelector)

    if (!sendButton) {
      console.error('未找到发送按钮')
      return false
    }

    await sendButton.click()
    await sleep(500)

    // 验证是否发送成功
    const sendSuccess = await verifyMessageSent(page, text)
    return sendSuccess
  } catch (error) {
    console.error('发送消息失败:', error)
    return false
  }
}

/**
 * 发送快捷回复
 */
export async function sendQuickReply(
  page: Page,
  quickReply: QuickReplyItem
): Promise<boolean> {
  console.log(`[快捷回复] 发送: ${quickReply.name} - ${quickReply.content}`)
  return sendTextMessage(page, quickReply.content)
}

/**
 * 通过索引发送快捷回复
 */
export async function sendQuickReplyByIndex(
  page: Page,
  quickReplyList: QuickReplyItem[],
  index: number
): Promise<boolean> {
  const quickReply = quickReplyList[index]
  if (!quickReply) {
    console.error(`快捷回复索引 ${index} 不存在`)
    return false
  }

  if (!quickReply.enabled) {
    console.warn(`快捷回复 "${quickReply.name}" 已禁用`)
    return false
  }

  return sendQuickReply(page, quickReply)
}

/**
 * 通过ID发送快捷回复
 */
export async function sendQuickReplyById(
  page: Page,
  quickReplyList: QuickReplyItem[],
  id: string | number
): Promise<boolean> {
  const quickReply = quickReplyList.find(item => item.id === id)

  if (!quickReply) {
    console.error(`快捷回复 ID ${id} 不存在`)
    return false
  }

  if (!quickReply.enabled) {
    console.warn(`快捷回复 "${quickReply.name}" 已禁用`)
    return false
  }

  return sendQuickReply(page, quickReply)
}

/**
 * 发送随机快捷回复
 */
export async function sendRandomQuickReply(
  page: Page,
  quickReplyList: QuickReplyItem[]
): Promise<boolean> {
  const enabledList = quickReplyList.filter(item => item.enabled)

  if (enabledList.length === 0) {
    console.error('没有启用的快捷回复')
    return false
  }

  const randomIndex = Math.floor(Math.random() * enabledList.length)
  return sendQuickReply(page, enabledList[randomIndex])
}

/**
 * 发送匹配回复（根据策略）
 */
export async function sendMatchReply(
  page: Page,
  quickReplyList: QuickReplyItem[],
  strategy: ReplyStrategyConfig
): Promise<boolean> {
  switch (strategy.matchReplyMode) {
    case 'constant':
      return sendTextMessage(page, strategy.matchReplyContent)

    case 'first_quick_reply':
      const firstEnabled = quickReplyList.find(item => item.enabled)
      if (firstEnabled) {
        return sendQuickReply(page, firstEnabled)
      }
      return sendTextMessage(page, strategy.matchReplyContent)

    case 'random_quick_reply':
      return sendRandomQuickReply(page, quickReplyList)

    default:
      return sendTextMessage(page, strategy.matchReplyContent)
  }
}

// ==================== 辅助函数 ====================

/**
 * 验证消息是否发送成功
 */
async function verifyMessageSent(page: Page, text: string): Promise<boolean> {
  try {
    // 检查消息是否出现在聊天记录中
    const found = await page.evaluate((msgText) => {
      const messages = document.querySelectorAll('.chat-conversation .chat-record .message-item')
      for (const msg of messages) {
        const textEl = msg.querySelector('.message-text')
        if (textEl && textEl.textContent?.includes(msgText)) {
          return true
        }
      }
      return false
    }, text.substring(0, 50))  // 只检查前50个字符

    return found
  } catch {
    // 无法验证时默认返回成功
    return true
  }
}

/**
 * 标记候选人不合适
 */
export async function markCandidateNotSuitable(
  page: Page,
  reason?: string
): Promise<boolean> {
  try {
    // 查找"不合适"按钮
    const notSuitableBtn = await page.$(
      '.candidate-action .not-suitable-btn, ' +
      '.geek-action .btn-not-suit, ' +
      '[class*="not-suit"]'
    )

    if (!notSuitableBtn) {
      console.warn('未找到"不合适"按钮')
      return false
    }

    await notSuitableBtn.click()
    await sleep(500)

    // 如果有选择原因的弹窗，选择一个原因
    const reasonDialog = await page.$('.not-suit-dialog, .reason-select-dialog')
    if (reasonDialog) {
      const reasonOptions = await reasonDialog.$$(' .reason-item, .option-item')
      if (reasonOptions.length > 0) {
        await reasonOptions[0].click()
        await sleep(300)
      }

      const confirmBtn = await reasonDialog.$('.confirm-btn, .submit-btn')
      if (confirmBtn) {
        await confirmBtn.click()
        await sleep(500)
      }
    }

    return true
  } catch (error) {
    console.error('标记不合适失败:', error)
    return false
  }
}

/**
 * 获取当前聊天对象的信息
 */
export async function getCurrentChatGeekInfo(page: Page): Promise<{
  name: string
  encryptGeekId: string
} | null> {
  try {
    const info = await page.evaluate(() => {
      // 从Vue组件获取
      const chatRecordVue = document.querySelector('.chat-conversation .chat-record')?.__vue__
      const geek = chatRecordVue?.geek || chatRecordVue?.boss

      if (geek) {
        return {
          name: geek.name || '',
          encryptGeekId: geek.encryptGeekId || geek.encryptBossId || ''
        }
      }

      // 从DOM获取
      const nameEl = document.querySelector('.chat-conversation .user-name, .geek-name')
      const name = nameEl?.textContent?.trim() || ''

      return { name, encryptGeekId: '' }
    })

    return info
  } catch {
    return null
  }
}

/**
 * 检查是否可以发送消息
 */
export async function canSendMessage(page: Page): Promise<boolean> {
  try {
    const inputEl = await page.$('.chat-conversation .message-controls .chat-input')
    const sendBtn = await page.$('.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)')

    return !!(inputEl && sendBtn)
  } catch {
    return false
  }
}

// ==================== 配置解析函数 ====================

/**
 * 从JSON解析快捷回复配置
 */
export function parseQuickReplyConfigFromJson(json: any): QuickReplyConfig {
  const quickReplyConfig = json?.quickReply || {}

  return {
    list: quickReplyConfig.list || DEFAULT_QUICK_REPLY_LIST,
    defaultReplyIndex: quickReplyConfig.defaultReplyIndex || 0
  }
}

/**
 * 从JSON解析回复策略配置
 */
export function parseReplyStrategyFromJson(json: any): ReplyStrategyConfig {
  const strategyConfig = json?.replyStrategy || {}

  return {
    matchReplyMode: strategyConfig.matchReplyMode || 'constant',
    matchReplyContent: strategyConfig.matchReplyContent || '您好，收到您的消息，我们会尽快回复您。',
    matchQuickReplyId: strategyConfig.matchQuickReplyId || null,
    notMatchAction: strategyConfig.notMatchAction || 'skip',
    notMatchReplyContent: strategyConfig.notMatchReplyContent || ''
  }
}

/**
 * 创建新的快捷回复项
 */
export function createQuickReplyItem(
  name: string,
  content: string
): QuickReplyItem {
  return {
    id: Date.now(),
    name,
    content,
    enabled: true,
    order: 0
  }
}

/**
 * 验证快捷回复配置
 */
export function validateQuickReplyList(list: QuickReplyItem[]): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!Array.isArray(list)) {
    return { valid: false, errors: ['快捷回复列表必须是数组'] }
  }

  const ids = new Set<string | number>()

  for (const item of list) {
    // 检查必填字段
    if (!item.name || !item.name.trim()) {
      errors.push('快捷回复名称不能为空')
    }
    if (!item.content || !item.content.trim()) {
      errors.push(`快捷回复 "${item.name}" 的内容不能为空`)
    }

    // 检查ID唯一性
    if (item.id !== undefined) {
      if (ids.has(item.id)) {
        errors.push(`快捷回复 ID "${item.id}" 重复`)
      }
      ids.add(item.id)
    }

    // 检查内容长度
    if (item.content && item.content.length > 500) {
      errors.push(`快捷回复 "${item.name}" 内容过长（最多500字）`)
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}