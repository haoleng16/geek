/**
 * 面试自动化 - 回复收集模块
 *
 * 负责收集候选人的回复
 */

import type { Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import type { DataSource } from 'typeorm'
import { saveInterviewQaRecord, getInterviewQaRecordList } from '@geekgeekrun/sqlite-plugin/handlers'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'

export interface CandidateAnswer {
  text: string
  timestamp: Date
  roundNumber: number
}

/**
 * 获取聊天历史消息
 */
export async function getChatHistory(page: Page): Promise<any[]> {
  try {
    const historyMessageList = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')
      if (chatConversation?.__vue__) {
        const vue = chatConversation.__vue__

        // 尝试获取消息列表
        const possibleListKeys = ['list$', 'list', 'messages', 'messageList', 'data', 'items', 'records', 'chatList']
        for (const key of possibleListKeys) {
          if (vue[key] && Array.isArray(vue[key]) && vue[key].length > 0) {
            return vue[key]
          }
        }

        // 检查 $data 里的属性
        if (vue.$data) {
          for (const key of Object.keys(vue.$data)) {
            if (Array.isArray(vue.$data[key]) && vue.$data[key].length > 0) {
              const firstItem = vue.$data[key][0]
              if (firstItem && (firstItem.text || firstItem.content || firstItem.message)) {
                return vue.$data[key]
              }
            }
          }
        }
      }

      // 从 DOM 获取
      const messageEls = chatConversation?.querySelectorAll('[class*="message"], [class*="msg"], [class*="chat-item"]')
      if (messageEls && messageEls.length > 0) {
        return [...messageEls].map(el => ({
          text: el.textContent || '',
          isSelf: el.classList.contains('self') || el.classList.contains('is-self') || !!el.closest('[class*="self"]'),
          className: el.className
        }))
      }

      return []
    })

    return historyMessageList || []
  } catch (error) {
    console.error('[AnswerCollector] 获取聊天历史失败:', error)
    return []
  }
}

/**
 * 获取候选人最新回复
 */
export async function getLatestCandidateAnswer(
  page: Page,
  candidate: InterviewCandidate
): Promise<CandidateAnswer | null> {
  try {
    const history = await getChatHistory(page)

    if (!history || history.length === 0) {
      return null
    }

    // 找到最后一条候选人发的消息（非自己发送的）
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i]
      const isSelf = msg.isSelf || msg.self || msg.fromSelf

      if (!isSelf) {
        const text = msg.text || msg.content || msg.message || ''
        if (text.trim()) {
          return {
            text: text.trim(),
            timestamp: msg.time ? new Date(msg.time) : new Date(),
            roundNumber: candidate.currentRound
          }
        }
      }
    }

    return null
  } catch (error) {
    console.error('[AnswerCollector] 获取最新回复失败:', error)
    return null
  }
}

/**
 * 检查是否有新回复
 */
export async function checkForNewAnswer(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate
): Promise<boolean> {
  try {
    // 获取已记录的问答
    const qaRecords = await getInterviewQaRecordList(ds, candidate.id!)
    const lastRecord = qaRecords[qaRecords.length - 1]

    // 获取最新回复
    const latestAnswer = await getLatestCandidateAnswer(page, candidate)

    if (!latestAnswer) {
      return false
    }

    // 如果有问答记录，检查是否是新回复
    if (lastRecord && lastRecord.questionSentAt) {
      const questionTime = new Date(lastRecord.questionSentAt).getTime()
      const answerTime = latestAnswer.timestamp.getTime()

      // 如果回复时间晚于问题发送时间，则是新回复
      if (answerTime > questionTime) {
        return true
      }
    }

    return false
  } catch (error) {
    console.error('[AnswerCollector] 检查新回复失败:', error)
    return false
  }
}

/**
 * 保存候选人回复
 */
export async function saveCandidateAnswer(
  ds: DataSource,
  candidate: InterviewCandidate,
  answer: CandidateAnswer
): Promise<void> {
  try {
    // 获取当前轮次的问答记录
    const qaRecords = await getInterviewQaRecordList(ds, candidate.id!)
    const currentRoundRecord = qaRecords.find(r => r.roundNumber === answer.roundNumber)

    if (currentRoundRecord) {
      // 更新现有记录
      await saveInterviewQaRecord(ds, {
        id: currentRoundRecord.id,
        answerText: answer.text,
        answeredAt: answer.timestamp
      })
    } else {
      // 创建新记录
      await saveInterviewQaRecord(ds, {
        candidateId: candidate.id,
        roundNumber: answer.roundNumber,
        questionText: '',
        answerText: answer.text,
        answeredAt: answer.timestamp
      })
    }

    console.log(`[AnswerCollector] 保存候选人回复: 轮次 ${answer.roundNumber}`)
  } catch (error) {
    console.error('[AnswerCollector] 保存回复失败:', error)
  }
}

/**
 * 合并多轮回复
 */
export async function mergeMultipleAnswers(
  page: Page,
  candidate: InterviewCandidate,
  sinceTime?: Date
): Promise<string> {
  try {
    const history = await getChatHistory(page)

    if (!history || history.length === 0) {
      return ''
    }

    // 筛选候选人的回复
    const candidateMessages = history
      .filter(msg => {
        const isSelf = msg.isSelf || msg.self || msg.fromSelf
        return !isSelf
      })
      .filter(msg => {
        if (!sinceTime) return true
        const msgTime = msg.time ? new Date(msg.time) : new Date()
        return msgTime.getTime() >= sinceTime.getTime()
      })
      .map(msg => msg.text || msg.content || msg.message || '')
      .filter(text => text.trim())

    return candidateMessages.join('\n\n')
  } catch (error) {
    console.error('[AnswerCollector] 合并回复失败:', error)
    return ''
  }
}