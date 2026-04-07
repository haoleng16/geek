/**
 * 面试自动化 - 评分模块
 *
 * 纯LLM评分机制
 */

import type { DataSource } from 'typeorm'
import { completes } from '@geekgeekrun/utils/gpt-request.mjs'
import { readConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { saveInterviewQaRecord, getInterviewQaRecordList, updateInterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/handlers'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewJobPosition } from '@geekgeekrun/sqlite-plugin/entity/InterviewJobPosition'
import type { ChatMessage } from '../RECRUITER_AUTO_REPLY_MAIN/llm-reply'

export interface ScoreResult {
  totalScore: number
  llmScore: number
  llmReason: string
  passed: boolean
}

export interface LlmConfig {
  id: string
  providerCompleteApiUrl: string
  providerApiSecret: string
  model: string
  enabled?: boolean
}

// 默认LLM评分提示词
const DEFAULT_LLM_SCORING_PROMPT = `你是一个专业的招聘面试评分助手。请根据候选人的回答进行评分。

## 问题
{question}

## 候选人回答
{answer}

## 评分标准
请根据以下标准评分（0-100分）：
- 60分：候选人提到有相关经验，但描述较简单
- 70分：候选人描述了具体细节，有一定深度
- 80分及以上：候选人描述丰富，展现了深入理解和实际经验

评分时请考虑：
1. 回答是否切题
2. 是否有具体细节
3. 是否展现了相关经验

请以JSON格式返回评分结果：
{
  "score": <0-100的分数>,
  "reason": "<简要说明评分依据>"
}

只返回JSON，不要其他内容。`

/**
 * 获取 LLM 配置（使用全局配置）
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
      console.warn('[Scorer] 未配置LLM')
      return { score: 0, reason: '未配置LLM' }
    }

    // 替换提示词中的变量
    const prompt = (customPrompt || DEFAULT_LLM_SCORING_PROMPT)
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
        maxTokens: 500
      },
      messages
    )

    const rawContent = completion?.choices?.[0]?.message?.content
    if (!rawContent) {
      return { score: 0, reason: 'LLM 返回空内容' }
    }

    console.log('[Scorer] LLM原始返回:', rawContent.substring(0, 200))

    // 容错解析JSON
    return parseLlmScoringResponse(rawContent)
  } catch (error) {
    console.error('[Scorer] LLM 评分失败:', error)
    return { score: 0, reason: 'LLM 评分失败' }
  }
}

/**
 * 容错解析LLM评分响应
 */
function parseLlmScoringResponse(content: string): { score: number; reason: string } {
  try {
    // 方式1：直接解析完整JSON
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed.score === 'number') {
        return {
          score: Math.min(100, Math.max(0, parsed.score)),
          reason: parsed.reason || '无评分理由'
        }
      }
    } catch (e) {
      // 不是完整JSON，尝试其他方式
    }

    // 方式2：正则提取JSON对象
    const jsonMatch = content.match(/\{[\s\S]*?"score"[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          score: Math.min(100, Math.max(0, Number(parsed.score) || 0)),
          reason: parsed.reason || '无评分理由'
        }
      } catch (e) {
        // JSON解析失败，继续尝试其他方式
      }
    }

    // 方式3：正则提取score字段
    const scoreMatch = content.match(/"score"\s*:\s*(\d+)/)
    if (scoreMatch) {
      const reasonMatch = content.match(/"reason"\s*:\s*"([^"]*)"/)
      return {
        score: Math.min(100, Math.max(0, Number(scoreMatch[1]))),
        reason: reasonMatch ? reasonMatch[1] : '无法提取评分理由'
      }
    }

    // 方式4：提取纯数字分数
    const numMatch = content.match(/\b(\d{1,3})\b/)
    if (numMatch) {
      const score = Number(numMatch[1])
      if (score >= 0 && score <= 100) {
        return {
          score,
          reason: '从响应中提取数字分数'
        }
      }
    }

    console.warn('[Scorer] 无法解析评分结果:', content)
    return { score: 0, reason: '无法解析评分结果' }
  } catch (error) {
    console.warn('[Scorer] 解析失败:', error)
    return { score: 0, reason: '解析评分结果失败' }
  }
}

/**
 * 纯LLM评分
 * 使用岗位级别的提示词配置
 */
export async function scoreAnswer(
  ds: DataSource,
  candidate: InterviewCandidate,
  question: string,
  answer: string,
  jobPosition: InterviewJobPosition
): Promise<ScoreResult> {
  try {
    console.log(`[Scorer] 开始LLM评分，候选人: ${candidate.geekName}`)
    console.log(`[Scorer] 问题: ${question}`)
    console.log(`[Scorer] 回答: ${answer}`)

    // 使用岗位级别的提示词
    const customPrompt = jobPosition.llmScoringPrompt || DEFAULT_LLM_SCORING_PROMPT

    // 调用LLM评分
    const llmResult = await scoreWithLLM(question, answer, customPrompt)

    // 强制约束分数到0-100范围
    const constrainedScore = Math.min(100, Math.max(0, llmResult.score))

    console.log(`[Scorer] LLM得分: ${constrainedScore}, 原因: ${llmResult.reason}`)

    // 判断是否通过（>= 阈值）
    const passed = constrainedScore >= jobPosition.passThreshold

    return {
      totalScore: constrainedScore,
      llmScore: constrainedScore,
      llmReason: llmResult.reason,
      passed
    }
  } catch (error) {
    console.error('[Scorer] LLM评分失败:', error)
    // 失败默认0分
    return {
      totalScore: 0,
      llmScore: 0,
      llmReason: 'LLM评分失败',
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
    // 更新问答记录的评分
    const qaRecords = await getInterviewQaRecordList(ds, candidate.id!)
    const roundRecord = qaRecords.find(r => r.roundNumber === roundNumber)

    if (roundRecord) {
      await saveInterviewQaRecord(ds, {
        id: roundRecord.id,
        llmScore: scoreResult.llmScore,
        llmReason: scoreResult.llmReason,
        totalScore: scoreResult.totalScore,
        scoredAt: new Date()
      })
    }

    // 更新候选人的总得分
    const allRecords = await getInterviewQaRecordList(ds, candidate.id!)
    const avgTotalScore = allRecords.length > 0
      ? Math.round(allRecords.reduce((sum, r) => sum + (r.totalScore || 0), 0) / allRecords.length)
      : 0

    await updateInterviewCandidateStatus(ds, candidate.id!, candidate.status, {
      totalScore: avgTotalScore,
      llmReason: scoreResult.llmReason,
      lastScoredAt: new Date()
    })

    console.log(`[Scorer] 评分结果已保存，平均分: ${avgTotalScore}`)
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
  customPrompt?: string
): Promise<ScoreResult[]> {
  const results: ScoreResult[] = []

  for (let i = 0; i < questions.length; i++) {
    const llmResult = await scoreWithLLM(questions[i], answers[i], customPrompt)

    results.push({
      totalScore: llmResult.score,
      llmScore: llmResult.score,
      llmReason: llmResult.reason,
      passed: llmResult.score >= 60
    })
  }

  return results
}