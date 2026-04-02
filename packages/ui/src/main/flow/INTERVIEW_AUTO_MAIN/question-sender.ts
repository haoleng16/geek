/**
 * 面试自动化 - 问题发送模块
 *
 * 负责向候选人发送面试问题
 */

import type { Page } from 'puppeteer'
import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import type { DataSource } from 'typeorm'
import { saveInterviewQaRecord, updateInterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/handlers'
import { InterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewQuestionRound } from '@geekgeekrun/sqlite-plugin/entity/InterviewQuestionRound'

/**
 * 发送文本消息
 */
export async function sendTextMessage(page: Page, text: string): Promise<boolean> {
  try {
    // 使用正确的输入框选择器（与 manual-test.ts 一致）
    const chatInputSelector = '.boss-chat-editor-input'
    const chatInputHandle = await page.$(chatInputSelector)

    if (!chatInputHandle) {
      console.error('[QuestionSender] 未找到聊天输入框')
      return false
    }

    console.log('[QuestionSender] 找到输入框，准备输入内容')

    // 点击输入框获取焦点
    await chatInputHandle.click()
    await sleep(300)

    // 方法1：使用 execCommand 设置内容（兼容 React/Vue）
    let setInputSuccess = false
    try {
      setInputSuccess = await page.evaluate((content) => {
        const input = document.querySelector('.boss-chat-editor-input') as HTMLTextAreaElement
        if (!input) return false

        input.focus()
        input.select()
        document.execCommand('delete', false)
        document.execCommand('insertText', false, content)

        return input.value === content
      }, text)
      console.log('[QuestionSender] execCommand 设置结果:', setInputSuccess)
    } catch (evalError: any) {
      console.error('[QuestionSender] execCommand 执行失败:', evalError?.message)
    }

    // 如果 execCommand 失败，回退到 type 方法
    if (!setInputSuccess) {
      console.log('[QuestionSender] 使用 type 方法输入')
      // 清空现有内容
      await page.evaluate(() => {
        const input = document.querySelector('.boss-chat-editor-input') as HTMLTextAreaElement
        if (input) {
          input.value = ''
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })
      await sleep(100)

      // 模拟打字输入
      await chatInputHandle.type(text, {
        delay: 30 + Math.random() * 20
      })
    }

    await sleep(500)

    // 验证输入内容
    const inputValue = await page.evaluate(() => {
      const input = document.querySelector('.boss-chat-editor-input') as HTMLTextAreaElement
      return input?.value || ''
    })
    console.log('[QuestionSender] 输入验证, 期望长度:', text.length, '实际长度:', inputValue.length)

    // 按 Enter 发送（与 manual-test.ts 一致）
    await chatInputHandle.press('Enter')
    console.log('[QuestionSender] 已按 Enter 发送')

    await sleep(1000)
    console.log('[QuestionSender] 消息发送成功:', text.substring(0, 50))
    return true
  } catch (error) {
    console.error('[QuestionSender] 发送消息失败:', error)
    return false
  }
}

/**
 * 发送面试问题
 */
export async function sendInterviewQuestion(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate,
  questionRound: InterviewQuestionRound
): Promise<boolean> {
  try {
    console.log(`[QuestionSender] 发送第 ${questionRound.roundNumber} 轮问题给 ${candidate.geekName}`)

    const success = await sendTextMessage(page, questionRound.questionText)

    if (success) {
      // 保存问答记录
      await saveInterviewQaRecord(ds, {
        candidateId: candidate.id,
        roundNumber: questionRound.roundNumber,
        questionText: questionRound.questionText,
        questionSentAt: new Date()
      })

      // 更新候选人状态
      const newStatus = getNextWaitingStatus(questionRound.roundNumber)
      await updateInterviewCandidateStatus(ds, candidate.id, newStatus, {
        currentRound: questionRound.roundNumber,
        lastQuestionAt: new Date()
      })

      console.log(`[QuestionSender] 问题发送成功，状态更新为: ${newStatus}`)
      return true
    }

    return false
  } catch (error) {
    console.error('[QuestionSender] 发送面试问题失败:', error)
    return false
  }
}

/**
 * 点击"求简历"按钮发送简历交换请求
 * BOSS直聘聊天框中有"求简历"按钮，点击后发送简历交换请求
 * 候选人会收到带有"同意"按钮的消息卡片
 */
export async function sendResumeExchangeRequest(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate
): Promise<boolean> {
  try {
    console.log(`[QuestionSender] 向 ${candidate.geekName} 发送简历交换请求`)

    // 查找"求简历"按钮（BOSS直聘聊天框中的按钮）
    // 可能的选择器：.btn-resume, .resume-btn, [class*="resume"], .request-resume
    const resumeBtnSelectors = [
      '.chat-conversation .message-controls .btn-resume',
      '.chat-conversation .message-controls .resume-btn',
      '.chat-conversation .message-controls [class*="resume"]',
      '.chat-conversation .message-controls [class*="request-resume"]',
      '.boss-chat-editor-wrap .btn-resume',
      '.boss-chat-editor-wrap .resume-btn',
      '.boss-chat-editor-wrap [class*="resume"]',
      '.message-controls .btn-request-resume',
      '.message-controls .btn-ask-resume',
      // 添加更多可能的选择器
      '.chat-editor-box .btn-resume',
      '.chat-editor-box [class*="resume"]',
      '.editor-box .btn-resume',
      '[class*="ask-resume"]',
      '[class*="request-resume"]'
    ]

    let resumeBtn = null
    for (const selector of resumeBtnSelectors) {
      resumeBtn = await page.$(selector)
      if (resumeBtn) {
        console.log(`[QuestionSender] 找到求简历按钮: ${selector}`)
        break
      }
    }

    if (!resumeBtn) {
      console.error('[QuestionSender] 未找到"求简历"按钮，尝试从DOM查找')
      // 尝试从DOM中查找包含"简历"文字的按钮
      resumeBtn = await page.evaluateHandle(() => {
        const buttons = document.querySelectorAll('.chat-conversation button, .message-controls button, .boss-chat-editor-wrap button')
        for (const btn of buttons) {
          if (btn.textContent?.includes('简历') || btn.textContent?.includes('求简历')) {
            return btn
          }
        }
        return null
      })

      if (!resumeBtn) {
        console.error('[QuestionSender] 仍未找到"求简历"按钮')
        return false
      }
    }

    // 点击"求简历"按钮
    await resumeBtn.click()
    console.log('[QuestionSender] 已点击"求简历"按钮')
    await sleep(1000)

    // 可能会出现确认弹窗，需要点击确认
    const confirmBtnSelectors = [
      '.dialog-box .btn-confirm',
      '.dialog-box .confirm-btn',
      '.modal-box .btn-confirm',
      '.confirm-dialog .btn-confirm',
      '[class*="dialog"] .btn-confirm',
      '[class*="modal"] .btn-confirm'
    ]

    for (const selector of confirmBtnSelectors) {
      const confirmBtn = await page.$(selector)
      if (confirmBtn) {
        console.log(`[QuestionSender] 找到确认按钮: ${selector}`)
        await confirmBtn.click()
        await sleep(500)
        break
      }
    }

    // 更新候选人状态
    await updateInterviewCandidateStatus(ds, candidate.id, InterviewCandidateStatus.RESUME_REQUESTED, {
      lastQuestionAt: new Date()
    })

    console.log('[QuestionSender] 简历交换请求发送成功，状态更新为 RESUME_REQUESTED')
    return true
  } catch (error) {
    console.error('[QuestionSender] 发送简历交换请求失败:', error)
    return false
  }
}

/**
 * 发送简历请求（文本消息方式 - 作为备用方案）
 * 支持自定义邀约话术
 */
export async function sendResumeRequest(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate,
  inviteText?: string
): Promise<boolean> {
  const defaultText = '您好，您的回答通过了我们的初步筛选，请问可以发一份简历给我们吗？期待您的回复！'
  const resumeRequestText = inviteText || defaultText

  try {
    console.log(`[QuestionSender] 发送简历请求给 ${candidate.geekName}`)

    const success = await sendTextMessage(page, resumeRequestText)

    if (success) {
      // 更新候选人状态
      await updateInterviewCandidateStatus(ds, candidate.id, InterviewCandidateStatus.RESUME_REQUESTED, {
        lastQuestionAt: new Date()
      })

      console.log('[QuestionSender] 简历请求发送成功')
      return true
    }

    return false
  } catch (error) {
    console.error('[QuestionSender] 发送简历请求失败:', error)
    return false
  }
}

/**
 * 发送拒绝消息
 */
export async function sendRejectionMessage(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate,
  reason?: string
): Promise<boolean> {
  const rejectionText = reason || '感谢您的关注，经过评估，您的背景暂时不太匹配当前岗位的需求。祝您求职顺利！'

  try {
    console.log(`[QuestionSender] 发送拒绝消息给 ${candidate.geekName}`)

    const success = await sendTextMessage(page, rejectionText)

    if (success) {
      await updateInterviewCandidateStatus(ds, candidate.id, InterviewCandidateStatus.REJECTED)
      console.log('[QuestionSender] 拒绝消息发送成功')
      return true
    }

    return false
  } catch (error) {
    console.error('[QuestionSender] 发送拒绝消息失败:', error)
    return false
  }
}

/**
 * 获取下一个等待状态
 */
function getNextWaitingStatus(roundNumber: number): string {
  switch (roundNumber) {
    case 1:
      return InterviewCandidateStatus.WAITING_ROUND_1
    case 2:
      return InterviewCandidateStatus.WAITING_ROUND_2
    default:
      return InterviewCandidateStatus.WAITING_ROUND_N
  }
}