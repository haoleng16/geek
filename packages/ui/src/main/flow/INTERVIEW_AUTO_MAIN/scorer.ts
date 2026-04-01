/**
 * 面试自动化 - 评分模块
 *
 * 负责关键词评分和 LLM 语义评分
 */

import type { DataSource } from 'typeorm'
import { completes } from '@geekgeekrun/utils/gpt-request.mjs'
import { readConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { saveInterviewQaRecord, getInterviewQaRecordList, updateInterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/handlers'
import { InterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewScoreRule } from '@geekgeekrun/sqlite-plugin/entity/InterviewScoreRule'
import type { InterviewQuestionRound } from '@geekgeekrun/sqlite-plugin/entity/InterviewQuestionRound'
import type { ChatMessage } from '../RECRUITER_AUTO_REPLY_MAIN/llm-reply'

export interface ScoreResult {
  totalScore: number
  keywordScore: number
  llmScore: number
  llmReason: string
  matchedKeywords: string[]
  passed: boolean
}

export interface LlmConfig {
  id: string
  providerCompleteApiUrl: string
  providerApiSecret: string
  model: string
  enabled?: boolean
}

// 默认评分提示词
const DEFAULT_SCORING_PROMPT = `你是一个专业的招聘助手，请根据候选人的回答进行评分。

## 问题
{question}

## 候选人回答
{answer}

## 评分标准
1. 回答是否切题（0-40分）
2. 回答是否有深度（0-30分）
3. 是否展现了相关经验（0-30分）

请以JSON格式返回评分结果：
{
  "score": <0-100的分数>,
  "reason": "<评分理由，简要说明为什么给这个分数>"
}

只返回JSON，不要其他内容。`

/**
 * 计算关键词得分
 * 新逻辑：包含任意关键词即满分（100分）
 * keywordsJson 格式支持两种：
 *   1. 简单字符串数组: ["redis", "cache"]
 *   2. 带权重的对象数组: [{"keyword": "redis", "weight": 10}, {"keyword": "cache", "weight": 5}]
 */
export function calculateKeywordScore(
  answer: string,
  keywordsJson: string
): { score: number; matchedKeywords: string[] } {
  try {
    if (!keywordsJson || !answer) {
      return { score: 0, matchedKeywords: [] }
    }

    const keywordsData = JSON.parse(keywordsJson)
    if (!keywordsData || keywordsData.length === 0) {
      return { score: 0, matchedKeywords: [] }
    }

    const answerLower = answer.toLowerCase()
    const matchedKeywords: string[] = []

    // 支持两种格式
    if (typeof keywordsData[0] === 'string') {
      // 简单字符串数组格式
      for (const keyword of keywordsData as string[]) {
        if (answerLower.includes(keyword.toLowerCase())) {
          matchedKeywords.push(keyword)
        }
      }
    } else if (keywordsData[0]?.keyword) {
      // 带权重的对象数组格式
      for (const kw of keywordsData as Array<{ keyword: string; weight: number }>) {
        if (answerLower.includes(kw.keyword.toLowerCase())) {
          matchedKeywords.push(kw.keyword)
        }
      }
    }

    // 包含任意关键词即满分（100分）
    const score = matchedKeywords.length > 0 ? 100 : 0

    console.log(`[Scorer] 关键词匹配结果: 匹配了 ${matchedKeywords.length} 个关键词: ${matchedKeywords.join(', ')}`)

    return { score, matchedKeywords }
  } catch (error) {
    console.error('[Scorer] 关键词评分失败:', error)
    return { score: 0, matchedKeywords: [] }
  }
}

/**
 * 获取 LLM 配置
 */
export async function getLlmConfig(): Promise<LlmConfig | null> {
  try {
    const llmConfigList = await readConfigFile('llm.json')

    if (!llmConfigList || llmConfigList.length === 0) {
      console.warn('[Scorer] 未找到LLM配置')
      return null
    }

    const enabledConfig = llmConfigList.find((it: LlmConfig) => it.enabled)
    if (enabledConfig) {
      return enabledConfig
    }

    return llmConfigList[0]
  } catch (error) {
    console.error('[Scorer] 获取LLM配置失败:', error)
    return null
  }
}

/**
 * 使用 LLM 进行语义评分
 */
export async function scoreWithLLM(
  question: string,
  answer: string,
  customPrompt?: string
): Promise<{ score: number; reason: string }> {
  try {
    const llmConfig = await getLlmConfig()
    if (!llmConfig) {
      return { score: 50, reason: '未配置LLM，使用默认分数' }
    }

    const prompt = (customPrompt || DEFAULT_SCORING_PROMPT)
      .replace('{question}', question)
      .replace('{answer}', answer)

    const messages: ChatMessage[] = [
      { role: 'user', content: prompt }
    ]

    console.log('[Scorer] 正在调用 LLM 进行评分...')

    const completion = await completes(
      {
        baseURL: llmConfig.providerCompleteApiUrl,
        apiKey: llmConfig.providerApiSecret,
        model: llmConfig.model,
        maxTokens: 300
      },
      messages
    )

    const rawContent = completion?.choices?.[0]?.message?.content
    if (!rawContent) {
      return { score: 50, reason: 'LLM 返回空内容' }
    }

    // 解析 JSON 响应
    return parseLlmScoringResponse(rawContent)
  } catch (error) {
    console.error('[Scorer] LLM 评分失败:', error)
    return { score: 50, reason: 'LLM 评分失败，使用默认分数' }
  }
}

/**
 * 解析 LLM 评分响应
 */
function parseLlmScoringResponse(content: string): { score: number; reason: string } {
  try {
    // 尝试提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*"score"[\s\S]*"reason"[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        score: Math.min(100, Math.max(0, Number(parsed.score) || 50)),
        reason: parsed.reason || '无评分理由'
      }
    }
  } catch (error) {
    console.warn('[Scorer] JSON 解析失败:', error)
  }

  return { score: 50, reason: '无法解析评分结果' }
}

/**
 * 综合评分
 * 新逻辑：固定权重（关键词 0.7 + LLM 0.3）
 * 使用问题轮次的配置（keywords 和 llmPrompt）
 */
export async function scoreAnswer(
  ds: DataSource,
  candidate: InterviewCandidate,
  question: string,
  answer: string,
  questionRound: InterviewQuestionRound,
  passThreshold: number
): Promise<ScoreResult> {
  try {
    console.log(`[Scorer] 开始评分，候选人: ${candidate.geekName}`)

    // 固定权重
    const KEYWORD_WEIGHT = 0.7
    const LLM_WEIGHT = 0.3

    // 1. 关键词评分（使用问题轮次的 keywords 配置）
    const keywordResult = calculateKeywordScore(answer, questionRound.keywords || '[]')
    console.log(`[Scorer] 关键词得分: ${keywordResult.score}, 匹配关键词: ${keywordResult.matchedKeywords.join(', ')}`)

    // 2. LLM 评分（使用问题轮次的自定义提示词）
    let llmResult
    try {
      llmResult = await scoreWithLLM(question, answer, questionRound.llmPrompt)
    } catch (error) {
      // LLM 失败降级：使用关键词评分 + 默认LLM分50
      console.warn('[Scorer] LLM评分失败，使用降级策略')
      llmResult = { score: 50, reason: 'LLM评分失败，使用默认分数' }
    }
    console.log(`[Scorer] LLM 得分: ${llmResult.score}, 原因: ${llmResult.reason}`)

    // 3. 计算加权总分（固定权重）
    const totalScore = Math.round(
      keywordResult.score * KEYWORD_WEIGHT +
      llmResult.score * LLM_WEIGHT
    )

    console.log(`[Scorer] 总分: ${totalScore} (关键词权重: ${KEYWORD_WEIGHT}, LLM权重: ${LLM_WEIGHT})`)

    const result: ScoreResult = {
      totalScore,
      keywordScore: keywordResult.score,
      llmScore: llmResult.score,
      llmReason: llmResult.reason,
      matchedKeywords: keywordResult.matchedKeywords,
      passed: totalScore >= passThreshold
    }

    return result
  } catch (error) {
    console.error('[Scorer] 评分失败:', error)
    return {
      totalScore: 0,
      keywordScore: 0,
      llmScore: 0,
      llmReason: '评分过程出错',
      matchedKeywords: [],
      passed: false
    }
  }
}

/**
 * 保存评分结果
 */
export async function saveScoreResult(
  ds: DataSource,
  candidate: InterviewCandidate,
  roundNumber: number,
  scoreResult: ScoreResult
): Promise<void> {
  try {
    // 更新问答记录的评分（包含新增字段）
    const qaRecords = await getInterviewQaRecordList(ds, candidate.id!)
    const roundRecord = qaRecords.find(r => r.roundNumber === roundNumber)

    if (roundRecord) {
      await saveInterviewQaRecord(ds, {
        id: roundRecord.id,
        keywordScore: scoreResult.keywordScore,
        llmScore: scoreResult.llmScore,
        llmReason: scoreResult.llmReason,
        totalScore: scoreResult.totalScore,
        matchedKeywords: JSON.stringify(scoreResult.matchedKeywords),
        scoredAt: new Date()
      })
    }

    // 更新候选人的总得分
    const allRecords = await getInterviewQaRecordList(ds, candidate.id!)
    const totalKeywordScore = allRecords.reduce((sum, r) => sum + (r.keywordScore || 0), 0)
    const totalLlmScore = allRecords.reduce((sum, r) => sum + (r.llmScore || 0), 0)
    const avgTotalScore = allRecords.length > 0
      ? Math.round((totalKeywordScore + totalLlmScore) / (allRecords.length * 2))
      : 0

    await updateInterviewCandidateStatus(ds, candidate.id!, candidate.status, {
      totalScore: avgTotalScore,
      keywordScore: Math.round(totalKeywordScore / allRecords.length) || 0,
      llmScore: Math.round(totalLlmScore / allRecords.length) || 0,
      llmReason: scoreResult.llmReason
    })

    console.log(`[Scorer] 评分结果已保存`)
  } catch (error) {
    console.error('[Scorer] 保存评分结果失败:', error)
  }
}

/**
 * 批量评分（用于测试）
 */
export async function batchScore(
  questions: string[],
  answers: string[],
  keywordsJsons: string[],
  llmPrompts?: string[]
): Promise<ScoreResult[]> {
  const results: ScoreResult[] = []

  for (let i = 0; i < questions.length; i++) {
    const keywordsJson = keywordsJsons[i] || '[]'
    const llmPrompt = llmPrompts?.[i]

    const keywordResult = calculateKeywordScore(answers[i], keywordsJson)
    const llmResult = await scoreWithLLM(questions[i], answers[i], llmPrompt)

    const totalScore = Math.round(
      keywordResult.score * 0.7 +
      llmResult.score * 0.3
    )

    results.push({
      totalScore,
      keywordScore: keywordResult.score,
      llmScore: llmResult.score,
      llmReason: llmResult.reason,
      matchedKeywords: keywordResult.matchedKeywords,
      passed: totalScore >= 60
    })
  }

  return results
}