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
    // 检查是否有聊天输入框
    const chatInputSelector = `.chat-conversation .message-controls .chat-input`
    const chatInputHandle = await page.$(chatInputSelector)

    if (!chatInputHandle) {
      console.error('[QuestionSender] 未找到聊天输入框')
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
      delay: 30 + Math.random() * 20
    })

    await sleep(500 + Math.random() * 300)

    // 点击发送按钮
    const sendButtonSelector = `.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)`
    const sendButton = await page.$(sendButtonSelector)

    if (!sendButton) {
      console.error('[QuestionSender] 未找到发送按钮')
      return false
    }

    await sendButton.click()
    await sleep(500)

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
 * 发送简历请求
 */
export async function sendResumeRequest(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate
): Promise<boolean> {
  const resumeRequestText = '您好，您的回答通过了我们的初步筛选，请问可以发一份简历给我们吗？期待您的回复！'

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