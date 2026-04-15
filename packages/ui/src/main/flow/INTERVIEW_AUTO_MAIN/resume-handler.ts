/**
 * 面试自动化 - 简历处理模块
 *
 * 负责简历相关操作
 */

import type { Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import type { DataSource } from 'typeorm'

/**
 * 获取候选人简历路径
 */
export async function getCandidateResumePath(
  _ds: DataSource,
  _candidateId: number
): Promise<string | null> {
  return null
}

/**
 * 检测候选人是否发送了简历卡片（带"同意"按钮）
 * 当候选人点击"同意发送简历"后，招聘方会收到一个带"同意"按钮的简历卡片
 * 按钮结构: <div class="message-card-buttons"><span class="card-btn">同意</span></div>
 */
export async function detectResumeCard(page: Page): Promise<{
  hasCard: boolean
  hasAcceptButton: boolean
}> {
  try {
    const result = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')

      // 查找 .message-card-buttons 容器（包含"同意"按钮）
      const buttonContainers = chatConversation?.querySelectorAll('.message-card-buttons')

      if (buttonContainers && buttonContainers.length > 0) {
        // 找到最新的按钮容器（最后一个，且非自己发送的）
        for (let i = buttonContainers.length - 1; i >= 0; i--) {
          const container = buttonContainers[i]

          // 检查是否是候选人发送的（非自己）
          const parentMessage =
            container.closest('.message-item') ||
            container.closest('.chat-item') ||
            container.closest('[class*="message"]')

          const isSelf =
            parentMessage?.classList.contains('self') ||
            parentMessage?.classList.contains('is-self') ||
            !!parentMessage?.closest('[class*="self"]')

          if (!isSelf) {
            // 找到"同意"按钮
            const buttons = container.querySelectorAll('.card-btn')
            for (const btn of buttons) {
              const btnText = btn.textContent?.trim() || ''
              if (btnText === '同意' || btnText.includes('同意')) {
                return {
                  hasCard: true,
                  hasAcceptButton: true
                }
              }
            }
          }
        }
      }

      // 备用：检查 Vue 组件数据
      if (chatConversation?.__vue__) {
        const vue = chatConversation.__vue__
        const listKey = Object.keys(vue).find((k) => Array.isArray(vue[k]) && vue[k].length > 0)

        if (listKey) {
          const messages = vue[listKey]
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            // 检查是否是简历卡片消息
            if (
              msg.type === 'resume_card' ||
              msg.msgType === 'resume_card' ||
              msg.contentType === 'resume_card' ||
              msg.needAccept
            ) {
              const isSelf = msg.isSelf || msg.self || msg.fromSelf
              if (!isSelf) {
                return {
                  hasCard: true,
                  hasAcceptButton: msg.needAccept || msg.canAccept || false
                }
              }
            }
          }
        }
      }

      return { hasCard: false, hasAcceptButton: false }
    })

    console.log(
      `[ResumeHandler] 简历卡片检测: hasCard=${result.hasCard}, hasAcceptButton=${result.hasAcceptButton}`
    )
    return result
  } catch (error) {
    console.error('[ResumeHandler] 检测简历卡片失败:', error)
    return { hasCard: false, hasAcceptButton: false }
  }
}

/**
 * 点击简历卡片上的"同意/接收"按钮
 * 招聘方需要点击同意才能真正接收候选人发送的简历
 * 按钮结构: <div class="message-card-buttons"><span class="card-btn">同意</span></div>
 */
export async function clickResumeAcceptButton(page: Page): Promise<{
  success: boolean
  message?: string
}> {
  try {
    console.log('[ResumeHandler] 开始点击简历卡片上的同意按钮...')

    // 先等待按钮变为可点击状态（disabled class移除）
    console.log('[ResumeHandler] 等待按钮变为可点击状态...')
    await sleep(500)

    const result = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')

      // 查找简历卡片按钮容器: .message-card-buttons
      const buttonContainers = chatConversation?.querySelectorAll('.message-card-buttons')

      if (buttonContainers && buttonContainers.length > 0) {
        // 找到最新的按钮容器（最后一个，且非自己发送的）
        for (let i = buttonContainers.length - 1; i >= 0; i--) {
          const container = buttonContainers[i]

          // 检查是否是候选人发送的（非自己）
          const parentMessage =
            container.closest('.message-item') ||
            container.closest('.chat-item') ||
            container.closest('[class*="message"]')

          const isSelf =
            parentMessage?.classList.contains('self') ||
            parentMessage?.classList.contains('is-self') ||
            !!parentMessage?.closest('[class*="self"]')

          if (!isSelf) {
            // 找到"同意"按钮
            const buttons = container.querySelectorAll('.card-btn')
            for (const btn of buttons) {
              const btnText = btn.textContent?.trim() || ''
              if (btnText === '同意' || btnText.includes('同意')) {
                // 检查是否有 disabled class
                if (btn.classList.contains('disabled')) {
                  // 尝试移除 disabled class 或强制点击
                  btn.classList.remove('disabled')
                }

                // 点击按钮
                ;(btn as HTMLElement).click()
                console.log(`[ResumeHandler] 已点击"同意"按钮`)

                // 如果点击无效，尝试触发 Vue/React 事件
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

                return {
                  success: true,
                  message: `点击了"同意"按钮，原始class: ${btn.className}`
                }
              }
            }
          }
        }
      }

      // 备用方案：查找包含"同意"文字的 span.card-btn
      const allCardBtns = chatConversation?.querySelectorAll('.card-btn')
      if (allCardBtns) {
        for (const btn of allCardBtns) {
          const btnText = btn.textContent?.trim() || ''
          if (btnText === '同意' || btnText.includes('同意')) {
            // 强制移除 disabled
            btn.classList.remove('disabled')
            ;(btn as HTMLElement).click()
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            return {
              success: true,
              message: `备用方案：点击了"同意"按钮`
            }
          }
        }
      }

      return {
        success: false,
        message: '未找到 .message-card-buttons 或"同意"按钮'
      }
    })

    console.log(
      `[ResumeHandler] 点击同意按钮结果: success=${result.success}, ${result.message || ''}`
    )
    return result
  } catch (error) {
    console.error('[ResumeHandler] 点击同意按钮失败:', error)
    return { success: false, message: String(error) }
  }
}
