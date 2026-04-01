/**
 * LLM 智能回复模块（智能回复专用）
 *
 * 用于根据公司信息和岗位说明生成智能回复
 */

import { completes } from '@geekgeekrun/utils/gpt-request.mjs'
import { readConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import type { ChatMessage } from '../RECRUITER_AUTO_REPLY_MAIN/llm-reply'

// ==================== 类型定义 ====================

export interface SmartReplyConfig {
  companyIntro: string //公司介绍
  jobDescription: string //职位描述
  systemPrompt?: string//系统提示词
}

export interface LlmResponse {
  reply: string   //大模型的回复
  isClear: boolean //大模型是否清楚该回答
}

export interface LlmConfig {
  id: string //标识符
  providerCompleteApiUrl: string //baseURl
  providerApiSecret: string //API密钥
  model: string //模型名称
  enabled?: boolean //是否可选
}

// ==================== 默认提示词 ====================

export const DEFAULT_SYSTEM_PROMPT = `你是一个专业的招聘助手，代表公司回答候选人的问题。

## 公司信息
{COMPANY_INTRO}

## 岗位说明
{JOB_DESCRIPTION}

## 回复规则
1. 回答要简洁专业，不超过200字
2. 请用中文回复
3. 如果不确定答案，请返回JSON格式：{"reply": "", "isClear": false}
4. 如果确定答案，请返回JSON格式：{"reply": "你的回复内容", "isClear": true}`

// ==================== 核心函数 ====================

/**
 * 获取 LLM 配置
 */
export async function getLlmConfig(): Promise<LlmConfig | null> {
  try {
    const llmConfigList = await readConfigFile('llm.json')

    if (!llmConfigList || llmConfigList.length === 0) {
      console.warn('[SmartReply] 未找到LLM配置')
      return null
    }

    // 优先选择启用的配置
    const enabledConfig = llmConfigList.find((it: LlmConfig) => it.enabled)
    if (enabledConfig) {
      return enabledConfig
    }

    // 否则返回第一个配置
    return llmConfigList[0]
  } catch (error) {
    console.error('[SmartReply] 获取LLM配置失败:', error)
    return null
  }
}

/**
 * 生成智能回复
 */
export async function generateSmartReply(
  config: SmartReplyConfig,
  historyMessages: any[],  // 使用 any 类型，因为从页面获取的消息格式可能不同
  candidateMessage: string
): Promise<LlmResponse> {
  try {
    console.log('[SmartReply] generateSmartReply 开始执行')
    console.log('[SmartReply] 配置:', {
      hasCompanyIntro: !!config.companyIntro,
      hasJobDescription: !!config.jobDescription,
      hasSystemPrompt: !!config.systemPrompt
    })
    console.log('[SmartReply] 历史消息数量:', historyMessages?.length)
    console.log('[SmartReply] 当前消息:', candidateMessage?.substring(0, 50))

    const llmConfig = await getLlmConfig()
    if (!llmConfig) {
      console.warn('[SmartReply] 未找到LLM配置')
      return { reply: '', isClear: false }
    }

    console.log('[SmartReply] LLM配置:', {
      providerCompleteApiUrl: llmConfig.providerCompleteApiUrl,
      model: llmConfig.model,
      hasApiKey: !!llmConfig.providerApiSecret
    })

    // 构建系统提示词
    const systemPrompt = (config.systemPrompt || DEFAULT_SYSTEM_PROMPT)
      .replace('{COMPANY_INTRO}', config.companyIntro || '（未配置）')
      .replace('{JOB_DESCRIPTION}', config.jobDescription || '（未配置）')

    // 构建消息列表
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt }
    ]

    // 添加最近5条历史消息
    const recentHistory = historyMessages.slice(-5)
    for (const msg of recentHistory) {
      // 兼容不同的消息格式：可能是 {content, isSelf} 或 {text, isSelf}
      const content = msg.content || msg.text || ''
      const isSelf = msg.isSelf || msg.self || false
      const role = isSelf ? 'assistant' : 'user'
      messages.push({ role, content })
    }

    // 添加当前消息
    messages.push({ role: 'user', content: candidateMessage })

    console.log('[SmartReply] 调用LLM, 消息数量:', messages.length)
    console.log('[SmartReply] 消息列表:', messages.map(m => ({ role: m.role, content: m.content?.substring(0, 30) })))

    // 调用LLM
    console.log('[SmartReply] 正在调用 completes 函数...')
    const completion = await completes(
      {
        baseURL: llmConfig.providerCompleteApiUrl,
        apiKey: llmConfig.providerApiSecret,
        model: llmConfig.model
      },
      messages
    )

    console.log('[SmartReply] completes 返回:', completion)

    const rawContent = completion?.choices?.[0]?.message?.content
    if (!rawContent) {
      console.warn('[SmartReply] LLM返回空内容, completion:', JSON.stringify(completion))
      return { reply: '', isClear: false }
    }

    console.log('[SmartReply] LLM返回内容:', rawContent.substring(0, 100))

    // 解析JSON响应
    return parseLlmResponse(rawContent)
  } catch (error) {
    console.error('[SmartReply] 生成回复失败:', error)
    return { reply: '', isClear: false }
  }
}

/**
 * 解析 LLM 响应
 */
function parseLlmResponse(content: string): LlmResponse {
  try {
    // 尝试提取JSON
    const jsonMatch = content.match(/\{[\s\S]*"reply"[\s\S]*"isClear"[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        reply: parsed.reply || '',
        isClear: parsed.isClear === true
      }
    }
  } catch (error) {
    // JSON解析失败
    console.warn('[SmartReply] JSON解析失败，尝试直接使用内容')
  }

  // 无法解析为JSON，尝试直接使用内容
  return {
    reply: content.trim().substring(0, 200),
    isClear: content.length > 0
  }
}

/**
 * 测试 LLM API 连接
 */
export async function testLlmConnection(): Promise<{
  success: boolean
  error?: string
  model?: string
}> {
  try {
    console.log('[SmartReply] 开始测试 API 连接...')

    const llmConfigList = await readConfigFile('llm.json')
    console.log('[SmartReply] LLM 配置列表:', llmConfigList?.length || 0, '个')

    if (!llmConfigList || llmConfigList.length === 0) {
      console.warn('[SmartReply] 未找到LLM配置')
      return {
        success: false,
        error: '未找到LLM配置，请先在「大语言模型设置」中配置API'
      }
    }

    // 优先选择启用的配置
    let llmConfig = llmConfigList.find((it: LlmConfig) => it.enabled)
    if (!llmConfig) {
      llmConfig = llmConfigList[0]
    }

    console.log('[SmartReply] 使用配置:', {
      providerCompleteApiUrl: llmConfig.providerCompleteApiUrl,
      model: llmConfig.model,
      hasApiKey: !!llmConfig.providerApiSecret
    })

    if (!llmConfig.providerCompleteApiUrl) {
      return {
        success: false,
        error: 'API URL 未配置'
      }
    }

    if (!llmConfig.providerApiSecret) {
      return {
        success: false,
        error: 'API Key 未配置'
      }
    }

    if (!llmConfig.model) {
      return {
        success: false,
        error: '模型名称未配置'
      }
    }

    // 发送简单的测试消息
    const testMessages: ChatMessage[] = [
      { role: 'user', content: '请回复"OK"两个字' }
    ]

    console.log('[SmartReply] 正在调用 API...')

    const completion = await completes(
      {
        baseURL: llmConfig.providerCompleteApiUrl,
        apiKey: llmConfig.providerApiSecret,
        model: llmConfig.model
      },
      testMessages
    )

    console.log('[SmartReply] API 响应:', completion)

    const content = completion?.choices?.[0]?.message?.content
    if (content) {
      console.log('[SmartReply] API 测试成功，返回内容:', content)
      return {
        success: true,
        model: llmConfig.model
      }
    }

    console.warn('[SmartReply] API 返回空响应:', completion)
    return {
      success: false,
      error: 'API 返回空响应，请检查模型配置'
    }
  } catch (error: any) {
    console.error('[SmartReply] API 测试失败:', error)

    let errorMessage = '未知错误'
    if (error?.message) {
      errorMessage = error.message
      // 处理常见错误
      if (errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('invalid_api_key')) {
        errorMessage = 'API Key 无效或已过期'
      } else if (errorMessage.includes('404') || errorMessage.includes('not_found')) {
        errorMessage = 'API URL 不正确或模型不存在'
      } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
        errorMessage = '网络连接失败，请检查网络或代理设置'
      } else if (errorMessage.includes('insufficient_quota') || errorMessage.includes('429') || errorMessage.includes('rate_limit')) {
        errorMessage = 'API 配额不足或请求过于频繁'
      } else if (errorMessage.includes('model')) {
        errorMessage = '模型不存在或不可用: ' + errorMessage
      }
    }

    return {
      success: false,
      error: errorMessage
    }
  }
}