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
 * 【修复】使用与 READ_NO_REPLY_AUTO_REMINDER_MAIN 相同的选择器，确保 isSelf 字段正确
 */
export async function getChatHistory(page: Page): Promise<any[]> {
  try {
    const historyMessageList = await page.evaluate(() => {
      // 【关键修复】优先使用与 READ_NO_REPLY_AUTO_REMINDER_MAIN 相同的选择器
      // 这个选择器返回的消息对象包含正确的 isSelf 字段
      const chatRecordVue = document.querySelector('.message-content .chat-record')?.__vue__
      if (chatRecordVue?.list$ && Array.isArray(chatRecordVue.list$)) {
        console.log('[AnswerCollector] 使用 .message-content .chat-record 选择器获取到消息')
        return chatRecordVue.list$.map(msg => ({
          ...msg,
          // 保留原始字段，同时添加标准化的字段
          _originalIsSelf: msg.isSelf,
          _originalSelf: msg.self,
          _source: 'chat-record'
        }))
      }

      // 备选方案：尝试从 chat-conversation 获取
      const chatConversation = document.querySelector('.chat-conversation')
      if (chatConversation?.__vue__) {
        const vue = chatConversation.__vue__

        // 尝试获取消息列表
        const possibleListKeys = ['list$', 'list', 'messages', 'messageList', 'data', 'items', 'records', 'chatList']
        for (const key of possibleListKeys) {
          if (vue[key] && Array.isArray(vue[key]) && vue[key].length > 0) {
            console.log(`[AnswerCollector] 使用 chat-conversation.${key} 获取到消息`)
            return vue[key].map(msg => ({
              ...msg,
              _source: `chat-conversation.${key}`
            }))
          }
        }

        // 检查 $data 里的属性
        if (vue.$data) {
          for (const key of Object.keys(vue.$data)) {
            if (Array.isArray(vue.$data[key]) && vue.$data[key].length > 0) {
              const firstItem = vue.$data[key][0]
              if (firstItem && (firstItem.text || firstItem.content || firstItem.message)) {
                console.log(`[AnswerCollector] 使用 chat-conversation.$data.${key} 获取到消息`)
                return vue.$data[key].map(msg => ({
                  ...msg,
                  _source: `chat-conversation.$data.${key}`
                }))
              }
            }
          }
        }
      }

      // 从 DOM 获取（最后的备选方案）
      // 【修复】优先使用 .message-item 选择器，并精确获取消息文本
      const messageEls = chatConversation?.querySelectorAll('.message-item, [class*="message-item"], [class*="msg-item"]')
      if (messageEls && messageEls.length > 0) {
        console.log('[AnswerCollector] 使用 DOM 方式获取消息')
        return [...messageEls].map(el => {
          // 【修复】使用 .message-text 选择器精确获取消息文本
          // 避免获取到时间戳（如 "03-18 23:25"）、日期分隔（如 "3月18日"）、职位信息等元数据
          const textEl = el.querySelector('.message-text')
          const text = textEl?.textContent?.trim() || ''
          return {
            text,
            // 【修复】增强 DOM 方式的 isSelf 判断
            isSelf: el.classList.contains('self') ||
                    el.classList.contains('is-self') ||
                    !!el.closest('[class*="self"]') ||
                    !!el.closest('[class*="my-message"]') ||
                    el.classList.contains('mine') ||
                    el.getAttribute('data-self') === 'true',
            className: el.className,
            _source: 'dom'
          }
        }).filter(msg => msg.text) // 过滤掉空消息
      }

      return []
    })

    // 【新增】打印完整的消息对象结构，帮助调试
    if (historyMessageList && historyMessageList.length > 0) {
      console.log(`[AnswerCollector] ========== 消息结构诊断开始 ==========`)
      console.log(`[AnswerCollector] 总消息数: ${historyMessageList.length}`)

      // 打印前3条消息的完整结构
      historyMessageList.slice(0, 3).forEach((msg, idx) => {
        console.log(`[AnswerCollector] 消息${idx + 1} 完整结构:`, JSON.stringify(msg, null, 2).substring(0, 500))
        console.log(`[AnswerCollector] 消息${idx + 1} isSelf=${msg.isSelf}, self=${msg.self}, fromSelf=${msg.fromSelf}`)
        console.log(`[AnswerCollector] 消息${idx + 1} 文本: "${(msg.text || msg.content || msg.message || '').substring(0, 50)}"`)
      })

      const selfCount = historyMessageList.filter(msg => msg.isSelf).length
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
 * 使用消息文本内容作为去重依据
 * 【改进】使用更稳定的去重键，避免因时间格式差异导致重复
 */
function deduplicateMessages(messages: any[]): any[] {
  const seen = new Set<string>()
  const result: any[] = []

  for (const msg of messages) {
    const text = msg.text || msg.content || msg.message || ''
    const time = msg.time || ''
    const sender = msg.sender || msg.from || ''

    // 【改进】优先使用消息ID，否则使用文本前50字符+时间+发送者作为唯一标识
    // 这样可以避免因时间格式差异或空白字符差异导致的去重失败
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
 * 将文本按句子分割，去除完全相同的重复句子
 * @param text 回答文本
 * @returns 去重后的文本
 */
export function deduplicateSentencesInText(text: string): string {
  if (!text || !text.trim()) return ''

  // 按换行分割（每行可能包含一个或多个句子）
  const lines = text.split(/\n+/).filter(line => line.trim())

  // 对每行进行句子分割
  // 中文句子通常以 。！？；结尾，英文以 . ! ? ; 结尾
  const sentenceEndPattern = /([。！？；.!?;]+)/g

  const allSentences: string[] = []
  for (const line of lines) {
    // 分割句子，保留分隔符
    const parts = line.split(sentenceEndPattern)
    let currentSentence = ''
    for (let i = 0; i < parts.length; i++) {
      currentSentence += parts[i]
      // 如果当前部分是分隔符，或者到达末尾，则形成一个完整句子
      if (sentenceEndPattern.test(parts[i]) || i === parts.length - 1) {
        if (currentSentence.trim()) {
          allSentences.push(currentSentence.trim())
        }
        currentSentence = ''
      }
    }
  }

  // 去重：使用 Set 去除完全相同的句子
  const seen = new Set<string>()
  const uniqueSentences: string[] = []

  for (const sentence of allSentences) {
    // 标准化比较：去除多余空格
    const normalized = sentence.replace(/\s+/g, ' ').trim()
    if (!seen.has(normalized) && normalized) {
      seen.add(normalized)
      uniqueSentences.push(sentence)
    } else if (seen.has(normalized)) {
      console.log(`[AnswerCollector] 去重重复句子: "${normalized.substring(0, 50)}..."`)
    }
  }

  // 合并去重后的句子
  // 尝试保持原有的段落结构（连续句子合并为一行）
  const result = uniqueSentences.join('\n')

  if (allSentences.length !== uniqueSentences.length) {
    console.log(`[AnswerCollector] 句子去重: 原始 ${allSentences.length} 句 -> 去重后 ${uniqueSentences.length} 句`)
  }

  return result
}

/**
 * 【新增】检查回答是否与已有记录重复
 * 对同一候选人的同一轮次，检查回答内容是否与之前保存的回答完全相同
 * @param ds DataSource
 * @param candidateId 候选人ID
 * @param roundNumber 轮次
 * @param answerText 待检查的回答文本
 * @returns 如果重复返回 true，否则返回 false
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

    // 查找同一轮次的记录
    const sameRoundRecord = qaRecords.find(r => r.roundNumber === roundNumber)

    if (sameRoundRecord && sameRoundRecord.answerText) {
      // 标准化比较：去除多余空格和换行
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
 * 用于过滤候选人回答中的问候语、自我介绍等无关内容
 */
const IRRELEVANT_PATTERNS = [
  // 问候语
  /^您好[，。!]?$/,
  /^你好[，。!]?$/,
  /^嗨[，。!]?$/,
  /^哈喽[，。!]?$/,
  /^谢谢[，。!]?$/,
  /^感谢[，。!]?$/,
  /^好的[，。!]?$/,
  /^收到[，。!]?$/,
  /^明白了[，。!]?$/,
  /^了解[，。!]?$/,
  /^没问题[，。!]?$/,
  /^可以的[，。!]?$/,
  /^OK[，。!]?$/i,
  /^okay[，。!]?$/i,

  // 简短回复（通常不是实质性回答）
  /^是的[，。!]?$/,
  /^不是[，。!]?$/,
  /^有[，。!]?$/,
  /^没有[，。!]?$/,
  /^对[，。!]?$/,
  /^嗯[，。!]?$/,
  /^噢[，。!]?$/,
  /^啊[，。!]?$/,

  // 自我介绍开头（通常不需要包含在回答中）
  /^我是.*应聘/,
  /^我叫.*应聘/,
  /^我之前在/,
  /^本人.*从事/,
  /^自我介绍/,
]

/**
 * 【新增】过滤回答中的无关内容
 * @param answerText 原始回答文本
 * @returns 过滤后的回答文本
 */
export function filterIrrelevantContent(answerText: string): string {
  if (!answerText || !answerText.trim()) return ''

  // 按行分割
  const lines = answerText.split(/\n+/).filter(line => line.trim())

  // 过滤掉无关行
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim()

    // 检查是否匹配无关模式
    for (const pattern of IRRELEVANT_PATTERNS) {
      if (pattern.test(trimmed)) {
        console.log(`[AnswerCollector] 过滤无关内容: "${trimmed}"`)
        return false
      }
    }

    // 过滤过短的内容（少于5个字符且不含实质信息）
    if (trimmed.length < 5 && !trimmed.includes('经验') && !trimmed.includes('项目')) {
      return false
    }

    return true
  })

  return filteredLines.join('\n').trim()
}

/**
 * 【新增】格式化问答记录用于展示
 * 实现读取时过滤逻辑：
 * 1. 格式为「问题：回答」
 * 2. 最多保留3条问答
 * 3. 过滤掉候选人介绍等无关内容
 * @param qaRecords 原始问答记录列表
 * @param maxRecords 最大保留记录数（默认3）
 * @returns 格式化后的问答记录列表
 */
export function formatQaRecordsForDisplay(
  qaRecords: any[],
  maxRecords: number = 3
): any[] {
  if (!qaRecords || qaRecords.length === 0) return []

  // 按轮次排序
  const sortedRecords = [...qaRecords].sort((a, b) => a.roundNumber - b.roundNumber)

  // 过滤并格式化每条记录
  const formattedRecords = sortedRecords.map(record => {
    // 过滤无关内容
    const filteredAnswer = filterIrrelevantContent(record.answerText || '')

    return {
      ...record,
      // 格式化：确保有实质内容
      questionText: record.questionText?.trim() || '（问题未记录）',
      answerText: filteredAnswer || '（未回答或回答无实质内容）',
      // 标记是否有实质回答
      hasSubstantiveAnswer: filteredAnswer.length > 10
    }
  })

  // 只保留有实质问答的记录，最多 maxRecords 条
  const substantiveRecords = formattedRecords.filter(r => r.hasSubstantiveAnswer)
  const limitedRecords = substantiveRecords.slice(0, maxRecords)

  // 如果没有实质问答，返回第一条记录（即使是空的）
  if (limitedRecords.length === 0 && formattedRecords.length > 0) {
    return [formattedRecords[0]]
  }

  console.log(`[AnswerCollector] 格式化问答记录: 原始 ${qaRecords.length} 条 -> 有实质内容 ${substantiveRecords.length} 条 -> 展示 ${limitedRecords.length} 条`)

  return limitedRecords
}

/**
 * 【新增】生成问答展示文本
 * 用于导出或简单展示场景
 * @param qaRecords 问答记录列表
 * @returns 格式化的文本，如 "第1轮\n问题：xxx\n回答：xxx\n\n第2轮..."
 */
export function generateQaDisplayText(qaRecords: any[]): string {
  const formattedRecords = formatQaRecordsForDisplay(qaRecords)

  if (formattedRecords.length === 0) return '暂无问答记录'

  return formattedRecords.map(record => {
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

/**
 * 检查消息发送者是否是自己（招聘者）
 * 【修复】增强判断逻辑，支持更多字段格式
 */
export function isSelfMessage(msg: any): boolean {
  // 优先检查 isSelf 字段（BOSS直聘标准字段）
  if (msg.isSelf === true) return true
  if (msg.isSelf === false) return false

  // 检查其他可能的字段
  if (msg.self === true) return true
  if (msg.fromSelf === true) return true
  if (msg.sender === 'recruiter') return true

  // 【新增】检查 direction 字段（某些版本可能使用）
  if (msg.direction === 'self' || msg.direction === 'out') return true
  if (msg.direction === 'other' || msg.direction === 'in') return false

  // 【新增】检查 from 字段
  if (msg.from === 'self' || msg.from === 'recruiter') return true
  if (msg.from === 'other' || msg.from === 'candidate') return false

  // 【新增】检查 messageSource 字段
  if (msg.messageSource === 'self') return true

  // 【新增】检查 to 字段（某些结构可能用 to 表示接收方）
  if (msg.to === 'self' || msg.to === 'recruiter') return false
  if (msg.to === 'other' || msg.to === 'candidate') return true

  // 默认返回 false（视为候选人消息）
  return false
}

/**
 * 【新增】检查文本是否看起来像问题（而非回答）
 * 用于过滤被错误识别为回答的问题文本
 */
function textLooksLikeQuestion(text: string): boolean {
  if (!text) return false

  // 检查是否以问号结尾
  if (text.trim().endsWith('？') || text.trim().endsWith('?')) return true

  // 检查是否包含典型的问题开头
  const questionStarts = ['请问', '你之前', '你是否', '有没有', '是否', '能不能', '可以吗', '什么', '怎么', '如何', '为什么', '哪个', '哪些', '多少']
  for (const start of questionStarts) {
    if (text.includes(start)) {
      // 但如果文本很短且只是确认（如"有的"），不算问题
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
 * 移除被错误混入的问题内容，并去除重复句子
 */
export function cleanCandidateAnswer(rawText: string): string {
  if (!rawText) return ''

  // 按换行分割
  const lines = rawText.split(/\n+/)

  // 过滤掉看起来像问题的行
  const answerLines = lines.filter(line => {
    const trimmed = line.trim()
    if (!trimmed) return false

    // 如果这行看起来像问题，过滤掉
    if (textLooksLikeQuestion(trimmed)) {
      console.log(`[AnswerCollector] 过滤掉问题行: "${trimmed.substring(0, 50)}"`)
      return false
    }

    return true
  })

  // 合并成文本
  const cleaned = answerLines.join('\n').trim()

  // 【新增】对回答文本内部的重复句子进行去重
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
 * @param page Puppeteer 页面
 * @param candidate 候选人信息
 * @param windowSeconds 时间窗口（秒）
 * @returns 合并后的消息文本和消息列表
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

    // 【关键修复】对消息进行去重，避免DOM重复导致同一条消息被多次读取
    const dedupedHistory = deduplicateMessages(history)
    console.log(`[AnswerCollector] 历史消息: ${history.length}条, 去重后: ${dedupedHistory.length}条`)

    // 【调试】打印消息详情，帮助排查问题
    const sampleMessages = dedupedHistory.slice(0, 5).map(msg => ({
      text: (msg.text || msg.content || msg.message || '').substring(0, 30),
      isSelf: msg.isSelf,
      time: msg.time
    }))
    console.log(`[AnswerCollector] 示例消息:`, JSON.stringify(sampleMessages))

    // 筛选候选人的消息（非自己发送的）
    const candidateMessages = dedupedHistory
      .filter(msg => {
        const isSelf = isSelfMessage(msg)
        if (!isSelf) {
          console.log(`[AnswerCollector] 候选人消息: "${(msg.text || msg.content || msg.message || '').substring(0, 50)}"`)
        }
        return !isSelf
      })
      .filter(msg => {
        // 只取发送问题后的消息
        if (!candidate.lastQuestionAt) {
          console.log('[AnswerCollector] lastQuestionAt 为空，跳过该消息')
          return false
        }
        const msgTime = msg.time ? new Date(msg.time) : new Date()
        const questionTime = new Date(candidate.lastQuestionAt)
        const isAfterQuestion = msgTime.getTime() >= questionTime.getTime()
        console.log(`[AnswerCollector] 消息时间检查: msgTime=${msgTime.toISOString()}, questionTime=${questionTime.toISOString()}, isAfter=${isAfterQuestion}`)
        return isAfterQuestion
      })
      .filter(msg => {
        // 【关键修复】过滤已评分的消息：只取上次评分时间之后的消息
        if (candidate.lastScoredAt) {
          const msgTime = msg.time ? new Date(msg.time) : new Date()
          const scoredTime = new Date(candidate.lastScoredAt)
          // 只获取上次评分之后的新消息
          const isNew = msgTime.getTime() > scoredTime.getTime()
          console.log(`[AnswerCollector] 评分时间检查: msgTime=${msgTime.toISOString()}, scoredTime=${scoredTime.toISOString()}, isNew=${isNew}`)
          return isNew
        }
        console.log('[AnswerCollector] lastScoredAt 为空，不过滤已评分消息')
        return true
      })

    console.log(`[AnswerCollector] 筛选后候选人消息数量: ${candidateMessages.length}`)

    // 【修复】最多只取3条消息回答一个问题
    const maxMessages = 3
    const limitedMessages = candidateMessages.slice(0, maxMessages)

    if (limitedMessages.length === 0) {
      console.log('[AnswerCollector] 没有新消息需要评分（已评分消息已被过滤）')
      return { mergedText: '', messages: [], latestMessageTime: null }
    }

    // 按时间排序
    limitedMessages.sort((a, b) => {
      const timeA = a.time ? new Date(a.time).getTime() : 0
      const timeB = b.time ? new Date(b.time).getTime() : 0
      return timeA - timeB
    })

    // 获取最新消息时间
    const latestMessageTime = limitedMessages[limitedMessages.length - 1].time
      ? new Date(limitedMessages[limitedMessages.length - 1].time)
      : new Date()

    // 合并30秒窗口内的消息（最多3条）
    const merged: any[] = []
    let currentGroup: any[] = [limitedMessages[0]]

    for (let i = 1; i < limitedMessages.length; i++) {
      const prevMsg = limitedMessages[i - 1]
      const currMsg = limitedMessages[i]

      const prevTime = prevMsg.time ? new Date(prevMsg.time).getTime() : 0
      const currTime = currMsg.time ? new Date(currMsg.time).getTime() : 0

      if (currTime - prevTime <= windowSeconds * 1000) {
        // 在时间窗口内，合并到当前组
        currentGroup.push(currMsg)
      } else {
        // 超出时间窗口，保存当前组并开始新组
        merged.push(...currentGroup)
        currentGroup = [currMsg]
      }
    }
    merged.push(...currentGroup)

    // 合并文本
    const rawText = merged
      .map(msg => msg.text || msg.content || msg.message || '')
      .filter(text => text.trim())
      .join('\n\n')

    // 【关键修复】清理候选人的回答，移除被错误混入的问题内容
    const mergedText = cleanCandidateAnswer(rawText)

    console.log(`[AnswerCollector] 合并了 ${merged.length} 条消息（最多取${maxMessages}条），时间窗口: ${windowSeconds}秒`)
    console.log(`[AnswerCollector] 最新消息时间: ${latestMessageTime.toISOString()}`)

    // 如果清理后文本为空，返回空结果
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