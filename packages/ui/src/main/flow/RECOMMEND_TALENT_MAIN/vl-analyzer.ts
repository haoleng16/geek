import { completes } from '@geekgeekrun/utils/gpt-request.mjs'
import { getLlmConfig } from '../SMART_REPLY_MAIN/llm-reply'
import { readScreenshotAsBase64 } from './screenshot'

export interface VLAnalysisResult {
  workMatch: number
  skillMatch: number
  projectQuality: number
  overallQuality: number
  totalScore: number
  recommend: boolean
  reason: string
  keyStrengths: string[]
  concerns: string[]
}

const MAX_EXTRA_RESUME_TEXT_LENGTH = 12000

export async function analyzeWithVL(
  screenshotPath: string | null | undefined,
  scoringPrompt: string,
  extraResumeText?: string
): Promise<{
  result: VLAnalysisResult | null
  rawResponse: string
  tokens: { request: number; response: number }
  durationMs: number
}> {
  const startTime = Date.now()

  const llmConfig = await getLlmConfig()
  if (!llmConfig) {
    throw new Error('未找到LLM配置')
  }

  const normalizedExtraResumeText = extraResumeText?.trim()
    ? extraResumeText.trim().slice(0, MAX_EXTRA_RESUME_TEXT_LENGTH)
    : ''

  const textPrompt = normalizedExtraResumeText
    ? `${scoringPrompt}\n\n以下是从页面/API提取并整理的简历文本，优先将其作为文字内容参考，再结合截图综合分析：\n${normalizedExtraResumeText}`
    : scoringPrompt

  const content: Array<
    { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string }
  > = []

  if (screenshotPath) {
    const imageBase64 = readScreenshotAsBase64(screenshotPath)
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
    })
    console.log('[RecommendTalent VL] 调用VL模型，截图大小:', imageBase64.length, '字符')
  } else {
    console.log('[RecommendTalent VL] 调用VL模型，使用纯文本简历分析')
  }

  content.push({ type: 'text', text: textPrompt })

  const messages = [
    {
      role: 'user' as const,
      content
    }
  ]

  const completion = await completes(
    {
      baseURL: llmConfig.providerCompleteApiUrl,
      apiKey: llmConfig.providerApiSecret,
      model: llmConfig.model,
      maxTokens: 1000
    },
    messages
  )

  const durationMs = Date.now() - startTime
  const rawContent = completion?.choices?.[0]?.message?.content || ''
  const requestTokens = completion?.usage?.prompt_tokens || 0
  const responseTokens = completion?.usage?.completion_tokens || 0

  console.log('[RecommendTalent VL] VL响应:', rawContent.substring(0, 200))
  console.log(
    '[RecommendTalent VL] 耗时:',
    durationMs,
    'ms, tokens:',
    requestTokens,
    '+',
    responseTokens
  )

  const result = parseVLResponse(rawContent)

  return {
    result,
    rawResponse: rawContent,
    tokens: { request: requestTokens, response: responseTokens },
    durationMs
  }
}

function parseVLResponse(content: string): VLAnalysisResult | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    return {
      workMatch: Number(parsed.workMatch) || 0,
      skillMatch: Number(parsed.skillMatch) || 0,
      projectQuality: Number(parsed.projectQuality) || 0,
      overallQuality: Number(parsed.overallQuality) || 0,
      totalScore: Number(parsed.totalScore) || 0,
      recommend: parsed.recommend === true,
      reason: String(parsed.reason || ''),
      keyStrengths: Array.isArray(parsed.keyStrengths) ? parsed.keyStrengths : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : []
    }
  } catch (e) {
    console.error('[RecommendTalent VL] 解析VL响应失败:', e)
    return null
  }
}
