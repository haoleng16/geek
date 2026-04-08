/**
 * BOSS 聊天通用工具
 *
 * 提供聊天列表类型定义和消息发送函数
 */

import { Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'

/**
 * 聊天列表项类型
 */
export interface ChatListItem {
  name: string
  encryptGeekId: string
  encryptBossId?: string
  encryptJobId?: string
  unreadCount: number
  lastIsSelf: boolean
  lastText: string
  avatar?: string
  time: string
  jobName?: string
  mid?: string
  _rawData?: any
  _className?: string
  _textContent?: string
}

/**
 * 发送消息到聊天界面
 */
export async function sendMessage(page: Page, text: string): Promise<boolean> {
  console.log('[sendMessage] 开始发送消息，文本长度:', text?.length || 0)
  console.log('[sendMessage] 文本内容预览:', text?.substring(0, 100))

  try {
    // 定义所有可能的选择器
    const inputSelectors = [
      '.chat-conversation .message-controls .chat-input',
      '.chat-conversation .chat-input',
      '.message-controls .chat-input',
      '.chat-input',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="发送"]',
      '.conversation-footer textarea',
      '.chat-footer textarea'
    ]

    let chatInputHandle: import('puppeteer').ElementHandle<Element> | null = null
    let foundSelector = ''

    // 尝试每个选择器
    for (const selector of inputSelectors) {
      console.log('[sendMessage] 尝试选择器:', selector)
      chatInputHandle = await page.$(selector)
      if (chatInputHandle) {
        console.log('[sendMessage] 找到输入框，使用选择器:', selector)
        foundSelector = selector
        break
      }
    }

    if (!chatInputHandle) {
      console.error('[sendMessage] 所有选择器都未找到输入框')
      // 打印页面结构帮助调试
      const pageStructure = await page.evaluate(() => {
        const chatConversation = document.querySelector('.chat-conversation')
        const messageControls = document.querySelector('.message-controls')
        const allInputs = document.querySelectorAll('textarea, input[type="text"]')

        return {
          hasChatConversation: !!chatConversation,
          hasMessageControls: !!messageControls,
          inputCount: allInputs.length,
          inputSelectors: [...allInputs].map(el => ({
            className: el.className,
            placeholder: el.getAttribute('placeholder'),
            parentClass: (el.parentElement as HTMLElement)?.className
          }))
        }
      })
      console.log('[sendMessage] 页面结构:', JSON.stringify(pageStructure, null, 2))
      return false
    }

    // 点击输入框，获取焦点
    console.log('[sendMessage] 点击输入框获取焦点...')
    await chatInputHandle.click()
    await sleep(300)
    await chatInputHandle.click()
    await sleep(200)

    // 清空现有内容并输入文本
    console.log('[sendMessage] 清空输入框并输入文本...')
    await page.evaluate((selector) => {
      const input = document.querySelector(selector) as HTMLTextAreaElement
      if (input) {
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, foundSelector)

    // 输入文本（模拟真实打字）
    console.log('[sendMessage] 模拟打字输入...')
    await chatInputHandle.type(text, {
      delay: 30 + Math.random() * 20  // 30-50ms随机延迟
    })

    // 验证输入是否成功
    const inputValue = await page.evaluate((selector) => {
      const input = document.querySelector(selector) as HTMLTextAreaElement
      return input?.value || ''
    }, foundSelector)
    console.log('[sendMessage] 输入框当前值长度:', inputValue.length)

    await sleep(500 + Math.random() * 300)

    // 点击发送按钮
    const sendButtonSelectors = [
      '.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)',
      '.chat-conversation .btn-send:not(.disabled)',
      '.btn-send:not(.disabled)',
      '.chat-op .btn-send',
      'button[class*="send"]'
    ]

    let sendButton: import('puppeteer').ElementHandle<Element> | null = null

    for (const selector of sendButtonSelectors) {
      console.log('[sendMessage] 尝试发送按钮选择器:', selector)
      sendButton = await page.$(selector)
      if (sendButton) {
        console.log('[sendMessage] 找到发送按钮，使用选择器:', selector)
        break
      }
    }

    if (!sendButton) {
      console.error('[sendMessage] 未找到发送按钮')
      // 打印按钮相关信息
      const buttonInfo = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button')
        return [...buttons].map(btn => ({
          className: btn.className,
          text: btn.textContent?.substring(0, 30),
          disabled: btn.disabled
        }))
      })
      console.log('[sendMessage] 页面按钮:', JSON.stringify(buttonInfo, null, 2))
      return false
    }

    console.log('[sendMessage] 点击发送按钮...')
    await sendButton.click()
    await sleep(500)

    console.log('[sendMessage] 消息发送成功')
    return true
  } catch (error) {
    console.error('[sendMessage] 发送消息失败:', error)
    return false
  }
}

/**
 * 获取聊天列表
 */
export async function getChatList(page: Page): Promise<ChatListItem[]> {
  try {
    const friendListData = await page.evaluate(() => {
      const geekItems = document.querySelectorAll('[role="listitem"]')

      return [...geekItems].map(el => {
        const geekItem = el.querySelector('.geek-item') || el
        const textContent = (geekItem as HTMLElement).innerText || (el as HTMLElement).innerText || ''
        const textLines = textContent.split('\n').filter((line: string) => line.trim())

        let name = ''
        let time = ''
        let lastText = ''
        let unreadCount = 0
        let jobName = ''

        if (textLines.length >= 4) {
          const firstLine = textLines[0]
          const secondLine = textLines[1]

          if (/^\d+$/.test(firstLine) && textLines.length >= 5) {
            unreadCount = parseInt(firstLine) || 0
            time = secondLine || ''
            name = textLines[2] || ''
            jobName = textLines[3] || ''
            lastText = textLines.slice(4).join('\n') || ''
          } else {
            time = firstLine || ''
            name = textLines[1] || ''
            jobName = textLines[2] || ''
            lastText = textLines.slice(3).join('\n') || ''
          }
        }

        const keyId = el.getAttribute('key') || geekItem?.getAttribute('data-id') || ''

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vue = (geekItem as any).__vue__ || (el as any).__vue__
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const props = (vue as any)?._props || (vue as any)?.$props || (vue as any)?.props || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (props as any).geek || (props as any).item || (props as any).message || (props as any).user || (props as any).data || (props as any).row || {}

        return {
          name: name || (data as any).name || (data as any).geekName || '',
          encryptGeekId: keyId || (data as any).encryptGeekId || '',
          unreadCount: unreadCount || (data as any).unreadCount || (data as any).newMsgCount || 0,
          lastIsSelf: (data as any).isSelf === true || (data as any).lastIsSelf === true,
          lastText: lastText || (data as any).lastText || '',
          time: time || (data as any).time || '',
          jobName: jobName || (data as any).jobName || '',
          encryptJobId: (data as any).encryptJobId || ''
        }
      })
    })

    return friendListData
  } catch (error) {
    console.error('[getChatList] 获取聊天列表失败:', error)
    return []
  }
}