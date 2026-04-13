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
    const inputSelectors = [
      '.boss-chat-editor-input',
      '.chat-conversation .message-controls .chat-input',
      '.chat-conversation .chat-input',
      '.message-controls .chat-input',
      '.chat-input',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="发送"]',
      '[contenteditable="true"]',
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

    console.log('[sendMessage] 点击输入框获取焦点...')
    await chatInputHandle.click()
    await sleep(300)
    await chatInputHandle.click()
    await sleep(200)

    console.log('[sendMessage] 尝试设置输入框内容...')
    let setInputSuccess = false

    // 方法1：使用原生 setter + InputEvent（对 Vue/React 框架兼容性最好）
    try {
      setInputSuccess = await page.evaluate((selector, content) => {
        const input = document.querySelector(selector) as HTMLElement | null
        if (!input) return false

        input.focus()

        if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
          // 使用原生 value setter 绕过框架拦截
          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
          )?.set

          if (nativeSetter) {
            nativeSetter.call(input, content)
          } else {
            input.value = content
          }

          input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: content
          }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return input.value === content
        }

        if (input.isContentEditable) {
          const selection = window.getSelection()
          const range = document.createRange()
          range.selectNodeContents(input)
          selection?.removeAllRanges()
          selection?.addRange(range)
          document.execCommand('delete', false)
          document.execCommand('insertText', false, content)
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: content, inputType: 'insertText' }))
          return (input.innerText || input.textContent || '').trim() === content.trim()
        }

        return false
      }, foundSelector, text)
      console.log('[sendMessage] 原生 setter 设置结果:', setInputSuccess)
    } catch (error) {
      console.error('[sendMessage] 原生 setter 设置失败:', error)
    }

    // 方法2：execCommand 回退（部分场景更可靠）
    if (!setInputSuccess) {
      try {
        setInputSuccess = await page.evaluate((selector, content) => {
          const input = document.querySelector(selector) as HTMLElement | null
          if (!input) return false

          input.focus()

          if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
            input.select()
            document.execCommand('delete', false)
            document.execCommand('insertText', false, content)
            input.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: content
            }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
            return input.value === content
          }

          return false
        }, foundSelector, text)
        console.log('[sendMessage] execCommand 设置结果:', setInputSuccess)
      } catch (error) {
        console.error('[sendMessage] execCommand 设置失败:', error)
      }
    }

    // 方法3：type 键盘模拟（最可靠但最慢）
    if (!setInputSuccess) {
      console.log('[sendMessage] 回退到 type 方法输入...')
      await page.evaluate((selector) => {
        const input = document.querySelector(selector) as HTMLElement | null
        if (!input) return

        if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
          input.value = ''
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return
        }

        if (input.isContentEditable) {
          input.textContent = ''
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' }))
        }
      }, foundSelector)

      await sleep(100)
      await chatInputHandle.type(text, {
        delay: 30 + Math.random() * 20
      })
    }

    // 等待框架处理输入事件
    await sleep(300)

    const inputValue = await page.evaluate((selector) => {
      const input = document.querySelector(selector) as HTMLElement | null
      if (!input) return ''

      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        return input.value || ''
      }

      return input.innerText || input.textContent || ''
    }, foundSelector)
    console.log('[sendMessage] 输入框当前值长度:', inputValue.length)

    if (!inputValue.trim()) {
      console.error('[sendMessage] 输入框内容为空，取消发送')
      return false
    }

    await sleep(500 + Math.random() * 300)

    console.log('[sendMessage] 尝试按 Enter 发送...')
    await chatInputHandle.press('Enter')
    await sleep(800)

    const afterEnterValue = await page.evaluate((selector) => {
      const input = document.querySelector(selector) as HTMLElement | null
      if (!input) return ''

      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        return input.value || ''
      }

      return input.innerText || input.textContent || ''
    }, foundSelector)
    console.log('[sendMessage] Enter 后输入框长度:', afterEnterValue.length)

    if (!afterEnterValue.trim()) {
      // 输入框为空，但不一定是发送成功——可能是值从未被框架接受
      // 通过检查是否有新消息出现来验证
      const messageAppeared = await page.evaluate((expectedText) => {
        // 检查聊天区域最后一条消息是否包含我们发送的内容
        const messages = document.querySelectorAll('.chat-conversation [class*="message"], .chat-conversation [class*="msg"]')
        if (messages.length === 0) return false
        const lastMsg = messages[messages.length - 1] as HTMLElement
        const text = lastMsg.innerText || lastMsg.textContent || ''
        return text.includes(expectedText.substring(0, 20))
      }, text.substring(0, 50))
      console.log('[sendMessage] Enter 后新消息出现:', messageAppeared)

      if (messageAppeared) {
        console.log('[sendMessage] Enter 发送成功（已验证消息出现）')
        return true
      }

      // 输入框为空但消息也没出现——可能是 execCommand 方式不生效，尝试 type 重试
      console.log('[sendMessage] 输入框为空但消息未出现，尝试 type 方法重试...')
      try {
        await chatInputHandle.click()
        await sleep(200)
        await chatInputHandle.type(text, { delay: 30 + Math.random() * 20 })
        await sleep(500)
        await chatInputHandle.press('Enter')
        await sleep(800)

        const retryValue = await page.evaluate((selector) => {
          const input = document.querySelector(selector) as HTMLElement | null
          if (!input) return ''
          if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
            return input.value || ''
          }
          return input.innerText || input.textContent || ''
        }, foundSelector)
        console.log('[sendMessage] type 重试后输入框长度:', retryValue.length)

        if (!retryValue.trim()) {
          console.log('[sendMessage] type 重试发送成功')
          return true
        }
      } catch (retryErr) {
        console.error('[sendMessage] type 重试失败:', retryErr)
      }
    }

    const sendButtonSelectors = [
      '.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)',
      '.chat-conversation .message-controls .btn-send:not(.disabled)',
      '.message-controls .btn-send:not(.disabled)',
      '.boss-chat-editor-wrap .btn-send:not(.disabled)',
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
    await sleep(800)

    const afterClickValue = await page.evaluate((selector) => {
      const input = document.querySelector(selector) as HTMLElement | null
      if (!input) return ''

      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        return input.value || ''
      }

      return input.innerText || input.textContent || ''
    }, foundSelector)

    const sendSuccess = !afterClickValue.trim()
    console.log('[sendMessage] 点击发送后输入框长度:', afterClickValue.length)
    console.log('[sendMessage] 消息发送结果:', sendSuccess)
    return sendSuccess
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
