/**
 * 面试自动化 - 回复收集模块
 *
 * 负责收集候选人的回复
 */

import type { Page } from 'puppeteer'
import type { DataSource } from 'typeorm'
import { saveInterviewQaRecord, getInterviewQaRecordList } from '@geekgeekrun/sqlite-plugin/handlers'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'

export interface CandidateAnswer {
  text: string
  timestamp: Date
  roundNumber: number
}

/**
 * 【新增】解析BOSS直聘的时间字符串为Date对象
 * 支持格式："昨天 17:01"、"04-03 11:46"、" 17:17"
 */
function parseBossTime(timeStr: string): Date | null {
  if (!timeStr || typeof timeStr !== 'string') return null

  const trimmed = timeStr.trim()
  const now = new Date()

  // 格式1："昨天 17:01"
  if (trimmed.startsWith('昨天')) {
    const match = trimmed.match(/昨天\s*(\d{1,2}):(\d{2})/)
    if (match) {
      const hours = parseInt(match[1])
      const minutes = parseInt(match[2])
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      yesterday.setHours(hours, minutes, 0, 0)
      return yesterday
    }
  }

  // 格式2："MM-DD HH:MM" 或 "M-D H:M"
  const match = trimmed.match(/(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2})/)
  if (match) {
    const month = parseInt(match[1])
    const day = parseInt(match[2])
    const hours = parseInt(match[3])
    const minutes = parseInt(match[4])

    const date = new Date(now.getFullYear(), month - 1, day, hours, minutes, 0, 0)

    // 如果解析出的日期在未来，可能是去年的
    if (date > now) {
      date.setFullYear(date.getFullYear() - 1)
    }
    return date
  }

  // 格式3："HH:MM"（当天）
  const timeMatch = trimmed.match(/(\d{1,2}):(\d{2})/)
  if (timeMatch) {
    const hours = parseInt(timeMatch[1])
    const minutes = parseInt(timeMatch[2])
    const today = new Date(now)
    today.setHours(hours, minutes, 0, 0)
    return today
  }

  return null
}

/**
 * 【新增】检查消息文本是否是简历卡片等需要过滤的内容
 */
function shouldFilterMessage(text: string): boolean {
  if (!text || !text.trim()) return true

  // 过滤简历卡片相关的文本
  if (text.includes('对方想发送附件简历') ||
      text.includes('您可以在线预览') ||
      text.includes('设置邮箱')) {
    console.log(`[AnswerCollector] 过滤简历/系统消息: "${text.substring(0, 30)}"`)
    return true
  }

  return false
}

/**
 * 获取聊天历史消息
 * 通过 Vue 组件获取聊天记录，确保 isSelf 字段正确
 */
export async function getChatHistory(page: Page): Promise<any[]> {
  try {
    const historyMessageList = await page.evaluate(() => {
      // 【新增】优先从 .chat-message-list 获取（BOSS直聘最新版DOM结构）
      const chatMessageList = document.querySelector('.chat-message-list')
      if (chatMessageList) {
        console.log('[AnswerCollector] 找到 .chat-message-list 容器')
        // 尝试从Vue组件获取
        if ((chatMessageList as any).__vue__) {
          const vue = (chatMessageList as any).__vue__
          console.log('[AnswerCollector] .chat-message-list 有Vue组件')
          const possibleListKeys = ['list$', 'list', 'messages', 'messageList', 'data', 'items', 'records', 'chatList']
          for (const key of possibleListKeys) {
            if (vue[key] && Array.isArray(vue[key]) && vue[key].length > 0) {
              console.log(`[AnswerCollector] 使用 chat-message-list.${key} 获取到消息`)
              return vue[key].map((msg: any) => ({
                ...msg,
                _source: `chat-message-list.${key}`
              }))
            }
          }
        }
      }

      // 优先从 Vue 组件获取消息列表
      const chatRecordVue = document.querySelector('.message-content .chat-record') as any
      if (chatRecordVue?.__vue__?.list$ && Array.isArray(chatRecordVue.__vue__.list$)) {
        console.log('[AnswerCollector] 使用 .message-content .chat-record 选择器获取到消息')
        return chatRecordVue.__vue__.list$.map((msg: any) => ({
          ...msg,
          _originalIsSelf: msg.isSelf,
          _originalSelf: msg.self,
          _source: 'chat-record'
        }))
      }

      // 备选方案：尝试从 chat-conversation 获取
      const chatConversation = document.querySelector('.chat-conversation') || chatMessageList
      if ((chatConversation as any)?.__vue__) {
        const vue = (chatConversation as any).__vue__

        const possibleListKeys = ['list$', 'list', 'messages', 'messageList', 'data', 'items', 'records', 'chatList']
        for (const key of possibleListKeys) {
          if (vue[key] && Array.isArray(vue[key]) && vue[key].length > 0) {
            console.log(`[AnswerCollector] 使用 chat-conversation.${key} 获取到消息`)
            return vue[key].map((msg: any) => ({
              ...msg,
              _source: `chat-conversation.${key}`
            }))
          }
        }

        if (vue.$data) {
          for (const key of Object.keys(vue.$data)) {
            if (Array.isArray(vue.$data[key]) && vue.$data[key].length > 0) {
              const firstItem = vue.$data[key][0]
              if (firstItem && (firstItem.text || firstItem.content || firstItem.message)) {
                console.log(`[AnswerCollector] 使用 chat-conversation.$data.${key} 获取到消息`)
                return vue.$data[key].map((msg: any) => ({
                  ...msg,
                  _source: `chat-conversation.$data.${key}`
                }))
              }
            }
          }
        }
      }

      // 从 DOM 获取（最后的备选方案）
      const messageEls = (chatConversation as any)?.querySelectorAll('.message-item')
      if (messageEls && messageEls.length > 0) {
        console.log('[AnswerCollector] 使用 DOM 方式获取消息')
        return [...messageEls].map((el: any) => {
          const hasItemFriend = !!el.querySelector('.item-friend')
          const hasItemMyself = !!el.querySelector('.item-myself')

          // 优先从 .item-friend .text span 或 .item-myself .text span 获取消息文本
          let text = ''
          if (hasItemFriend) {
            text = el.querySelector('.item-friend .text span')?.textContent?.trim() || ''
          } else if (hasItemMyself) {
            text = el.querySelector('.item-myself .text span')?.textContent?.trim() || ''
          }

          if (!text) {
            const textEl = el.querySelector('.message-text')
            text = textEl?.textContent?.trim() || ''
          }

          if (!text) {
            text = el.querySelector('.text span')?.textContent?.trim() || ''
          }

          // 【新增】从 DOM 提取时间
          let time: string | null = null
          const timeEl = el.querySelector('.message-time .time')
          if (timeEl) {
            time = timeEl.textContent?.trim() || null
          }

          const isSelf = hasItemMyself ||
                        el.classList.contains('self') ||
                        el.classList.contains('is-self') ||
                        !!el.closest('[class*="self"]') ||
                        el.classList.contains('mine')

          return {
            text,
            isSelf,
            time,
            className: el.className,
            hasItemFriend,
            hasItemMyself,
            _source: 'dom'
          }
        }).filter((msg: any) => msg.text)
      }

      return []
    })

    if (historyMessageList && historyMessageList.length > 0) {
      console.log(`[AnswerCollector] ========== 消息结构诊断开始 ==========`)
      console.log(`[AnswerCollector] 总消息数: ${historyMessageList.length}`)

      historyMessageList.slice(0, 3).forEach((msg: any, idx: number) => {
        console.log(`[AnswerCollector] 消息${idx + 1} 完整结构:`, JSON.stringify(msg, null, 2).substring(0, 500))
        console.log(`[AnswerCollector] 消息${idx + 1} isSelf=${msg.isSelf}, time=${msg.time}`)
        console.log(`[AnswerCollector] 消息${idx + 1} 文本: "${(msg.text || msg.content || msg.message || '').substring(0, 50)}"`)
      })

      const selfCount = historyMessageList.filter((msg: any) => msg.isSelf).length
      console.log(`[AnswerCollector] 统计: 招聘者发送 ${selfCount} 条, 候选人发送 ${historyMessageList.length - selfCount} 条`)
      console.log(`[AnswerCollector] ========== 消息结构诊断结束 ==========`)
    }

    return historyMessageList || []
  } catch (error) {
    console.error('[AnswerCollector] 获取聊天历史失败:', error)
    return []
  }
}

/**
 * 对消息列表进行去重
 */
function deduplicateMessages(messages: any[]): any[] {
  const seen = new Set<string>()
  const result: any[] = []

  for (const msg of messages) {
    const text = msg.text || msg.content || msg.message || ''
    const time = msg.time || ''
    const sender = msg.sender || msg.from || ''

    const key = msg.id || `${text.trim().slice(0, 50)}_${time}_${sender}`

    if (!seen.has(key) && text.trim()) {
      seen.add(key)
      result.push(msg)
    }
  }

  return result
}

/**
 * 【新增】对回答文本内部的重复句子进行去重
 */
export function deduplicateSentencesInText(text: string): string {
  if (!text || !text.trim()) return ''

  const lines = text.split(/\n+/).filter(line => line.trim())
  const sentenceEndPattern = /([。！？；.!?;]+)/g

  const allSentences: string[] = []
  for (const line of lines) {
    const parts = {line}.split(sentenceEndPattern) as string[]
    let currentSentence = ''
    for (let i = 0; i < parts.length; i++) {
      currentSentence += parts[i]
      if (sentenceEndPattern.test(parts[i]) || i === parts.length - 1) {
        if (currentSentence.trim()) {
          allSentences.push(currentSentence.trim())
        }
        currentSentence = ''
      }
    }
  }

  const seen = new Set<string>()
  const uniqueSentences: string[] = []

  for (const sentence of allSentences) {
    const normalized = sentence.replace(/\s+/g, ' ').trim()
    if (!seen.has(normalized) && normalized) {
      seen.add(normalized)
      uniqueSentences.push(sentence)
    } else if (seen.has(normalized)) {
      console.log(`[AnswerCollector] 去重重复句子: "${normalized.substring(0, 50)}..."`)
    }
  }

  const result = uniqueSentences.join('\n')

  if (allSentences.length !== uniqueSentences.length) {
    console.log(`[AnswerCollector] 句子去重: 原始 ${allSentences.length} 句 -> 去重后 ${uniqueSentences.length} 句`)
  }

  return result
}

/**
 * 【新增】检查回答是否与已有记录重复
 */
export async function isDuplicateAnswer(
  ds: DataSource,
  candidateId: number,
  roundNumber: number,
  answerText: string
): Promise<boolean> {
  if (!answerText || !answerText.trim()) return false

  try {
    const qaRecords = await getInterviewQaRecordList(ds, candidateId)
    const sameRoundRecord = qaRecords.find((r: any) => r.roundNumber === roundNumber)

    if (sameRoundRecord && sameRoundRecord.answerText) {
      const normalizedExisting = sameRoundRecord.answerText.replace(/\s+/g, ' ').trim()
      const normalizedNew = answerText.replace(/\s+/g, ' ').trim()

      if (normalizedExisting === normalizedNew) {
        console.log(`[AnswerCollector] 检测到重复回答: 候选人 ${candidateId} 轮次 ${roundNumber}`)
        return true
      }
    }

    return false
  } catch (error) {
    console.error('[AnswerCollector] 检查重复回答失败:', error)
    return false
  }
}

/**
 * 【新增】无关内容过滤模式

 * 【关键修复】避免过滤掉有用的回答内容
 */
const IRRELEVANT_PATTERNS = [
  // 纯问候语（很短且没有实质内容）
  /^嗨$/,
  /^哈喽$/,
]

/**
 * 【新增】过滤回答中的无关内容
 */
export function filterIrrelevantContent(answerText: string): string {
  if (!answerText || !answerText.trim()) return ''

  const lines = answerText.split(/\n+/).filter(line => line.trim())

  const filteredLines = lines.filter(line => {
    const trimmed = line.trim()

    // 只过滤非常短且匹配模式的问候语
    for (const pattern of IRRELEVANT_PATTERNS) {
      if (pattern.test(trimmed)) {
        console.log(`[AnswerCollector] 过滤无关内容: "${trimmed}"`)
        return false
      }
    }

    return true
  })

  return filteredLines.join('\n').trim()
}

/**
 * 【新增】格式化问答记录用于展示
 */
export function formatQaRecordsForDisplay(
  qaRecords: any[],
  maxRecords: number = 3
): any[] {
  if (!qaRecords || qaRecords.length === 0) return []

  const sortedRecords = [...qaRecords].sort((a: any, b: any) => a.roundNumber - b.roundNumber)

  const formattedRecords = sortedRecords.map((record: any) => {
    const filteredAnswer = filterIrrelevantContent(record.answerText || '')

    return {
      ...record,
      questionText: record.questionText?.trim() || '（问题未记录）',
      answerText: filteredAnswer || '（未回答或回答无实质内容）',
      hasSubstantiveAnswer: filteredAnswer.length > 10
    }
  })

  const substantiveRecords = formattedRecords.filter((r: any) => r.hasSubstantiveAnswer)
  const limitedRecords = substantiveRecords.slice(0, maxRecords)

  if (limitedRecords.length === 0 && formattedRecords.length > 0) {
    return [formattedRecords[0]]
  }

  console.log(`[AnswerCollector] 格式化问答记录: 原始 ${qaRecords.length} 条 -> 有实质内容 ${substantiveRecords.length} 条 -> 展示 ${limitedRecords.length} 条`)

  return limitedRecords
}

/**
 * 【新增】生成问答展示文本
 */
export function generateQaDisplayText(qaRecords: any[]): string {
  const formattedRecords = formatQaRecordsForDisplay(qaRecords)

  if (formattedRecords.length === 0) return '暂无问答记录'

  return formattedRecords.map((record: any) => {
    const roundLabel = `第${record.roundNumber}轮`
    const question = `问题：${record.questionText}`
    const answer = `回答：${record.answerText}`
    const score = record.totalScore ? `得分：${record.totalScore}分` : ''

    return [roundLabel, question, answer, score].filter(Boolean).join('\n')
  }).join('\n\n')
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
    const qaRecords = await getInterviewQaRecordList(ds, candidate.id!)
    const lastRecord = qaRecords[qaRecords.length - 1]

    const latestAnswer = await getLatestCandidateAnswer(page, candidate)

    if (!latestAnswer) {
      return false
    }

    if (lastRecord && lastRecord.questionSentAt) {
      const questionTime = new Date(lastRecord.questionSentAt).getTime()
      const answerTime = latestAnswer.timestamp.getTime()

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
    const qaRecords = await getInterviewQaRecordList(ds, candidate.id!)
    const currentRoundRecord = qaRecords.find((r: any) => r.roundNumber === answer.roundNumber)

    if (currentRoundRecord) {
      await saveInterviewQaRecord(ds, {
        id: currentRoundRecord.id,
        answerText: answer.text,
        answeredAt: answer.timestamp
      })
    } else {
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

    const candidateMessages = history
      .filter((msg: any) => {
        const isSelf = msg.isSelf || msg.self || msg.fromSelf
        return !isSelf
      })
      .filter((msg: any) => {
        if (!sinceTime) return true
        const msgTime = msg.time ? new Date(msg.time) : new Date()
        return msgTime.getTime() >= sinceTime.getTime()
      })
      .map((msg: any) => msg.text || msg.content || msg.message || '')
      .filter((text: string) => text.trim())

    return candidateMessages.join('\n\n')
  } catch (error) {
    console.error('[AnswerCollector] 合并回复失败:', error)
    return ''
  }
}

/**
 * 检查消息发送者是否是自己（招聘者）
 */
export function isSelfMessage(msg: any): boolean {
  // 【新增】优先检查 DOM 属性 hasItemFriend / hasItemMyself
  if (msg.hasItemMyself === true) return true
  if (msg.hasItemFriend === true) return false

  if (msg.isSelf === true) return true
  if (msg.isSelf === false) return false

  if (msg.self === true) return true
  if (msg.fromSelf === true) return true
  if (msg.sender === 'recruiter') return true

  if (msg.direction === 'self' || msg.direction === 'out') return true
  if (msg.direction === 'other' || msg.direction === 'in') return false

  if (msg.from === 'self' || msg.from === 'recruiter') return true
  if (msg.from === 'other' || msg.from === 'candidate') return false

  if (msg.messageSource === 'self') return true

  if (msg.to === 'self' || msg.to === 'recruiter') return false
  if (msg.to === 'other' || msg.to === 'candidate') return true

  return false
}

/**
 * 【新增】检查文本是否看起来像问题（而非回答）
 */
function textLooksLikeQuestion(text: string): boolean {
  if (!text) return false

  if (text.trim().endsWith('？') || text.trim().endsWith('?')) return true

  const questionStarts = ['请问', '你之前', '你是否', '有没有', '是否', '能不能', '可以吗', '什么', '怎么', '如何', '为什么', '哪个', '哪些', '多少']
  for (const start of questionStarts) {
    if (text.includes(start)) {
      if (text.length < 20 && (text.includes('有的') || text.includes('没有') || text.includes('是') || text.includes('不是'))) {
        return false
      }
      return true
    }
  }

  return false
}

/**
 * 【新增】清理候选人的回答文本
 */
export function cleanCandidateAnswer(rawText: string): string {
  if (!rawText) return ''

  const lines = rawText.split(/\n+/)

  const answerLines = lines.filter((line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return false

    if (textLooksLikeQuestion(trimmed)) {
      console.log(`[AnswerCollector] 过滤掉问题行: "${trimmed.substring(0, 50)}"`)
      return false
    }

    return true
  })

  const cleaned = answerLines.join('\n').trim()
  const deduplicated = deduplicateSentencesInText(cleaned)

  console.log(`[AnswerCollector] 清理回答: 原始${rawText.length}字符 -> 清理后${cleaned.length}字符 -> 去重后${deduplicated.length}字符`)

  return deduplicated
}

/**
 * 检查最新消息是否来自候选人（非招聘者发送）
 */
export async function isLatestMessageFromCandidate(page: Page): Promise<boolean> {
  const history = await getChatHistory(page)
  if (!history || history.length === 0) return false

  const latestMsg = history[history.length - 1]
  return !isSelfMessage(latestMsg)
}

/**
 * 合并30秒时间窗口内的多条消息
 * 用于将候选人连续发送的多条消息合并为一条答案
 */
export async function mergeMessagesInWindow(
  page: Page,
  candidate: InterviewCandidate,
  windowSeconds: number = 30
): Promise<{ mergedText: string; messages: any[]; latestMessageTime: Date | null }> {
  try {
    const history = await getChatHistory(page)

    if (!history || history.length === 0) {
      return { mergedText: '', messages: [], latestMessageTime: null }
    }

    const dedupedHistory = deduplicateMessages(history)
    console.log(`[AnswerCollector] 历史消息: ${history.length}条, 去重后: ${dedupedHistory.length}条`)

    const sampleMessages = dedupedHistory.slice(0, 5).map((msg: any) => ({
      text: (msg.text || msg.content || msg.message || '').substring(0, 30),
      isSelf: msg.isSelf,
      time: msg.time
    }))
    console.log(`[AnswerCollector] 示例消息:`, JSON.stringify(sampleMessages))

    // 筛选候选人的消息（非自己发送的）
    const candidateMessages = dedupedHistory
      .filter((msg: any) => {
        const isSelf = isSelfMessage(msg)
        if (!isSelf) {
          console.log(`[AnswerCollector] 候选人消息: "${(msg.text || msg.content || msg.message || '').substring(0, 50)}"`)
        }
        return !isSelf
      })
      // 【新增】过滤简历卡片等无关消息
      .filter((msg: any) => {
        if (shouldFilterMessage(msg.text || msg.content || msg.message || '')) {
          return false
        }
        return true
      })
      .filter((msg: any) => {
        // 只取发送问题后的消息
        if (!candidate.lastQuestionAt) {
          console.log('[AnswerCollector] lastQuestionAt 为空，不过滤时间，取最近的候选人消息')
          return true
        }

        // 【关键修复】从 DOM 解析的消息需要用 parseBossTime 解析时间
        let msgTime: Date
        if (msg._source === 'dom' && msg.time) {
          const parsedTime = parseBossTime(msg.time)
          if (parsedTime) {
            msgTime = parsedTime
            console.log(`[AnswerCollector] DOM时间解析: "${msg.time}" -> ${msgTime.toISOString()}`)
          } else {
            // 解析失败，使用当前时间
            msgTime = new Date()
            console.log(`[AnswerCollector] DOM时间解析失败: "${msg.time}"，使用当前时间`)
          }
        } else {
          msgTime = msg.time ? new Date(msg.time) : new Date()
        }

        const questionTime = new Date(candidate.lastQuestionAt)
        const isAfterQuestion = msgTime.getTime() >= questionTime.getTime()
        console.log(`[AnswerCollector] 消息时间检查: msgTime=${msgTime.toISOString()}, questionTime=${questionTime.toISOString()}, isAfter=${isAfterQuestion}`)
        return isAfterQuestion
      })
      .filter((msg: any) => {
        // 【BUG修复】lastScoredAt 过滤只在同一轮次内生效
        // 如果 lastQuestionAt 存在且晚于 lastScoredAt，说明已发送新一轮问题，
        // 此时 lastQuestionAt 过滤已经确保只采集新一轮的回复，不需要再用 lastScoredAt 过滤
        // 否则 lastScoredAt 会误杀第二轮及以后的所有新消息
        if (!candidate.lastScoredAt) {
          console.log('[AnswerCollector] lastScoredAt 为空，不过滤已评分消息')
          return true
        }

        // 如果已经发送了新一轮问题（lastQuestionAt 晚于 lastScoredAt），跳过 lastScoredAt 过滤
        if (candidate.lastQuestionAt) {
          const questionTime = new Date(candidate.lastQuestionAt).getTime()
          const scoredTime = new Date(candidate.lastScoredAt).getTime()
          if (questionTime > scoredTime) {
            console.log(`[AnswerCollector] 已发送新一轮问题（questionTime=${new Date(candidate.lastQuestionAt).toISOString()} > scoredTime=${new Date(candidate.lastScoredAt).toISOString()}），跳过 lastScoredAt 过滤`)
            return true
          }
        }

        // 同一轮次内，过滤已评分的消息
        let msgTime: Date
        if (msg._source === 'dom' && msg.time) {
          const parsedTime = parseBossTime(msg.time)
          msgTime = parsedTime || new Date()
        } else {
          msgTime = msg.time ? new Date(msg.time) : new Date()
        }

        const scoredTime = new Date(candidate.lastScoredAt)
        const isNew = msgTime.getTime() > scoredTime.getTime()
        console.log(`[AnswerCollector] 同轮次评分时间检查: msgTime=${msgTime.toISOString()}, scoredTime=${scoredTime.toISOString()}, isNew=${isNew}`)
        return isNew
      })

    console.log(`[AnswerCollector] 筛选后候选人消息数量: ${candidateMessages.length}`)

    const maxMessages = 3
    const limitedMessages = candidateMessages.slice(0, maxMessages)

    if (limitedMessages.length === 0) {
      console.log('[AnswerCollector] 没有新消息需要评分（已评分消息已被过滤）')
      return { mergedText: '', messages: [], latestMessageTime: null }
    }

    limitedMessages.sort((a: any, b: any) => {
      let timeA: number, timeB: number
      if (a._source === 'dom' && a.time) {
        const parsed = parseBossTime(a.time)
        timeA = parsed ? parsed.getTime() : 0
      } else {
        timeA = a.time ? new Date(a.time).getTime() : 0
      }

      if (b._source === 'dom' && b.time) {
        const parsed = parseBossTime(b.time)
        timeB = parsed ? parsed.getTime() : 0
      } else {
        timeB = b.time ? new Date(b.time).getTime() : 0
      }

      return timeA - timeB
    })

    const lastMsg = limitedMessages[limitedMessages.length - 1]
    const latestMessageTime = lastMsg?.time
      ? (lastMsg._source === 'dom' ? parseBossTime(lastMsg.time) || new Date() : new Date(lastMsg.time))
      : new Date()

    const merged: any[] = []
    let currentGroup: any[] = [limitedMessages[0]]

    for (let i = 1; i < limitedMessages.length; i++) {
      const prevMsg = limitedMessages[i - 1]
      const currMsg = limitedMessages[i]

      let prevTime: number, currTime: number
      if (prevMsg._source === 'dom' && prevMsg.time) {
        const parsed = parseBossTime(prevMsg.time)
        prevTime = parsed ? parsed.getTime() : 0
      } else {
        prevTime = prevMsg.time ? new Date(prevMsg.time).getTime() : 0
      }

      if (currMsg._source === 'dom' && currMsg.time) {
        const parsed = parseBossTime(currMsg.time)
        currTime = parsed ? parsed.getTime() : 0
      } else {
        currTime = currMsg.time ? new Date(currMsg.time).getTime() : 0
      }

      if (currTime - prevTime <= windowSeconds * 1000) {
        currentGroup.push(currMsg)
      } else {
        merged.push(...currentGroup)
        currentGroup = [currMsg]
      }
    }
    merged.push(...currentGroup)

    const rawText = merged
      .map((msg: any) => msg.text || msg.content || msg.message || '')
      .filter((text: string) => text.trim())
      .join('\n\n')

    const mergedText = cleanCandidateAnswer(rawText)

    console.log(`[AnswerCollector] 合并了 ${merged.length} 条消息（最多取${maxMessages}条），时间窗口: ${windowSeconds}秒`)
    console.log(`[AnswerCollector] 最新消息时间: ${latestMessageTime.toISOString()}`)

    if (!mergedText) {
      console.log('[AnswerCollector] 清理后回答为空，可能全是问题内容')
      return { mergedText: '', messages: [], latestMessageTime: null }
    }

    return { mergedText, messages: merged, latestMessageTime }
  } catch (error) {
    console.error('[AnswerCollector] 消息合并失败:', error)
    return { mergedText: '', messages: [], latestMessageTime: null }
  }
}
