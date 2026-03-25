/**
 * LLM 智能回复模块（招聘端专用）
 *
 * 用于生成招聘者对求职者的智能回复
 */

import { completes } from '@geekgeekrun/utils/gpt-request.mjs'
import { readConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'

// ==================== 类型定义 ====================

/**
 * 聊天消息
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
  isSelf?: boolean
}

/**
 * LLM 配置
 */
export interface LlmConfig {
  id: string
  providerCompleteApiUrl: string
  providerApiSecret: string
  model: string
  enabled?: boolean
  serveWeight?: number
}

/**
 * 招聘者回复配置
 */
export interface RecruiterReplyConfig {
  tone: 'professional' | 'friendly' | 'casual'  // 语气风格
  maxLength: number                              // 最大回复长度
  includeCompanyInfo: boolean                    // 是否包含公司信息
  guideToInterview: boolean                      // 是否引导面试
  language: 'zh' | 'en'                          // 语言
}

/**
 * 默认回复配置
 */
export const DEFAULT_REPLY_CONFIG: RecruiterReplyConfig = {
  tone: 'professional',
  maxLength: 80,
  includeCompanyInfo: false,
  guideToInterview: true,
  language: 'zh'
}

// ==================== Prompt 模板 ====================

/**
 * 招聘端系统提示词
 */
const RECRUITER_SYSTEM_PROMPT = `你是一位专业的招聘助手，正在代表招聘方与求职者进行沟通。

**核心要求：**
1. 保持礼貌、专业的语气
2. 回复简洁明了，控制在{MAX_LENGTH}字以内
3. 根据求职者的回复内容生成针对性的回复
4. 引导求职者提供更多信息或安排面试
5. 不要过度承诺薪资、福利等敏感信息

**回复风格：**
- 专业但不过于正式
- 积极回应求职者的问题
- 适时引导话题，推动招聘流程

**注意：**
- 不要编造公司或职位信息
- 遇到无法回答的问题，引导求职者联系HR或稍后回复
- 保持一致的态度和专业性`

/**
 * 首次回复模板
 */
const FIRST_REPLY_PROMPT = `求职者 "{CANDIDATE_NAME}" 对职位 "{JOB_NAME}" 表达了意向。

请生成一条友好的首次回复消息，内容包括：
1. 感谢求职者的关注
2. 简要介绍招聘流程
3. 询问求职者的相关问题（如期望薪资、到岗时间等）

请直接返回回复内容，不要包含其他解释。`

/**
 * 后续回复模板
 */
const FOLLOW_UP_PROMPT = `**对话历史：**
{CHAT_HISTORY}

**求职者最新消息：**
{CANDIDATE_MESSAGE}

请根据上下文生成一条合适的回复。要求：
1. 回应求职者的问题或关注点
2. 推动对话继续进行
3. 控制在{MAX_LENGTH}字以内

请以JSON格式返回：{"response": "回复内容"}`

/**
 * 面试邀约模板
 */
const INTERVIEW_INVITATION_PROMPT = `求职者 "{CANDIDATE_NAME}" 已通过初步筛选。

请生成一条面试邀约消息，内容包括：
1. 表达对求职者的认可
2. 询问方便面试的时间
3. 说明面试形式（电话/视频/现场）

请直接返回回复内容，不要包含其他解释。`

// ==================== 核心函数 ====================

/**
 * 获取招聘端 LLM 配置
 */
export async function getRecruiterLlmConfig(): Promise<LlmConfig | null> {
  try {
    const llmConfigList = await readConfigFile('llm.json')

    if (!llmConfigList || llmConfigList.length === 0) {
      console.warn('[LLM回复] 未找到LLM配置')
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
    console.error('[LLM回复] 获取LLM配置失败:', error)
    return null
  }
}

/**
 * 选择 LLM 配置（支持权重）
 */
export function pickLlmConfig(
  llmConfigList: LlmConfig[],
  excludeIds: Set<string> = new Set()
): LlmConfig | null {
  // 过滤可用配置
  const availableConfigs = llmConfigList.filter(
    config => config.enabled && !excludeIds.has(config.id)
  )

  if (availableConfigs.length === 0) {
    return null
  }

  // 单个配置直接返回
  if (availableConfigs.length === 1) {
    return availableConfigs[0]
  }

  // 权重选择
  const pool: string[] = []
  for (const config of availableConfigs) {
    const weight = Math.max(1, Math.min(100, config.serveWeight || 1))
    for (let i = 0; i < weight; i++) {
      pool.push(config.id)
    }
  }

  const selectedId = pool[Math.floor(Math.random() * pool.length)]
  return availableConfigs.find(config => config.id === selectedId) || availableConfigs[0]
}

/**
 * 生成智能回复
 */
export async function generateRecruiterReply(
  chatHistory: ChatMessage[],
  candidateMessage: string,
  options: {
    llmConfig?: LlmConfig
    replyConfig?: Partial<RecruiterReplyConfig>
    candidateName?: string
    jobName?: string
  } = {}
): Promise<string> {
  try {
    // 获取配置
    const llmConfig = options.llmConfig || await getRecruiterLlmConfig()
    if (!llmConfig) {
      console.warn('[LLM回复] 无可用LLM配置')
      return ''
    }

    const replyConfig = { ...DEFAULT_REPLY_CONFIG, ...options.replyConfig }

    // 构建消息列表
    const systemPrompt = RECRUITER_SYSTEM_PROMPT.replace(
      '{MAX_LENGTH}',
      String(replyConfig.maxLength)
    )

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt }
    ]

    // 添加对话历史（最近10轮）
    const recentHistory = chatHistory.slice(-10)
    for (const msg of recentHistory) {
      // 跳过系统消息
      if (msg.role === 'system') continue

      // 转换角色
      const role = msg.isSelf ? 'assistant' : 'user'
      messages.push({
        role,
        content: msg.content
      })
    }

    // 构建用户提示词
    const userPrompt = FOLLOW_UP_PROMPT
      .replace('{CHAT_HISTORY}', formatChatHistory(chatHistory))
      .replace('{CANDIDATE_MESSAGE}', candidateMessage)
      .replace('{MAX_LENGTH}', String(replyConfig.maxLength))

    messages.push({ role: 'user', content: userPrompt })

    // 调用 LLM
    const completion = await completes(
      {
        baseURL: llmConfig.providerCompleteApiUrl,
        apiKey: llmConfig.providerApiSecret,
        model: llmConfig.model
      },
      messages
    )

    const rawContent = completion?.choices?.[0]?.message?.content
    if (!rawContent) {
      console.warn('[LLM回复] LLM返回空内容')
      return ''
    }

    // 解析回复
    return parseLlmResponse(rawContent)
  } catch (error) {
    console.error('[LLM回复] 生成回复失败:', error)
    return ''
  }
}

/**
 * 生成首次回复
 */
export async function generateFirstReply(
  options: {
    llmConfig?: LlmConfig
    candidateName: string
    jobName: string
    replyConfig?: Partial<RecruiterReplyConfig>
  }
): Promise<string> {
  try {
    const llmConfig = options.llmConfig || await getRecruiterLlmConfig()
    if (!llmConfig) {
      return '您好，感谢您对我们职位的关注，我们会尽快查看您的简历。'
    }

    const userPrompt = FIRST_REPLY_PROMPT
      .replace('{CANDIDATE_NAME}', options.candidateName || '求职者')
      .replace('{JOB_NAME}', options.jobName || '这个职位')

    const messages: ChatMessage[] = [
      { role: 'system', content: RECRUITER_SYSTEM_PROMPT.replace('{MAX_LENGTH}', '80') },
      { role: 'user', content: userPrompt }
    ]

    const completion = await completes(
      {
        baseURL: llmConfig.providerCompleteApiUrl,
        apiKey: llmConfig.providerApiSecret,
        model: llmConfig.model
      },
      messages
    )

    const content = completion?.choices?.[0]?.message?.content
    return content || '您好，感谢您对我们职位的关注，我们会尽快查看您的简历。'
  } catch (error) {
    console.error('[LLM回复] 生成首次回复失败:', error)
    return '您好，感谢您对我们职位的关注，我们会尽快查看您的简历。'
  }
}

/**
 * 生成面试邀约
 */
export async function generateInterviewInvitation(
  options: {
    llmConfig?: LlmConfig
    candidateName: string
  }
): Promise<string> {
  try {
    const llmConfig = options.llmConfig || await getRecruiterLlmConfig()
    if (!llmConfig) {
      return '您好，您的简历已通过初步筛选，方便安排面试吗？请问您什么时间方便？'
    }

    const userPrompt = INTERVIEW_INVITATION_PROMPT
      .replace('{CANDIDATE_NAME}', options.candidateName || '求职者')

    const messages: ChatMessage[] = [
      { role: 'system', content: RECRUITER_SYSTEM_PROMPT.replace('{MAX_LENGTH}', '100') },
      { role: 'user', content: userPrompt }
    ]

    const completion = await completes(
      {
        baseURL: llmConfig.providerCompleteApiUrl,
        apiKey: llmConfig.providerApiSecret,
        model: llmConfig.model
      },
      messages
    )

    const content = completion?.choices?.[0]?.message?.content
    return content || '您好，您的简历已通过初步筛选，方便安排面试吗？请问您什么时间方便？'
  } catch (error) {
    console.error('[LLM回复] 生成面试邀约失败:', error)
    return '您好，您的简历已通过初步筛选，方便安排面试吗？请问您什么时间方便？'
  }
}

/**
 * 生成婉拒消息
 */
export async function generateRejectMessage(
  options: {
    llmConfig?: LlmConfig
    candidateName?: string
    reason?: string
  }
): Promise<string> {
  // 婉拒消息使用模板，不需要LLM
  const templates = [
    '感谢您的投递，经过评估，您的背景与职位需求不太匹配，我们会将您的简历保留在人才库中。',
    '感谢您对我们公司的关注，经过综合评估，暂时无法为您提供面试机会，祝您求职顺利！',
    '您好，感谢您的应聘。经慎重考虑，我们已选择其他更匹配的候选人，感谢您的理解。'
  ]

  return templates[Math.floor(Math.random() * templates.length)]
}

// ==================== 辅助函数 ====================

/**
 * 格式化对话历史
 */
function formatChatHistory(history: ChatMessage[]): string {
  if (!history || history.length === 0) {
    return '（无历史消息）'
  }

  return history
    .slice(-6) // 最近6条
    .map(msg => {
      const role = msg.isSelf ? '招聘者' : '求职者'
      return `${role}: ${msg.content}`
    })
    .join('\n')
}

/**
 * 解析 LLM 响应
 */
function parseLlmResponse(content: string): string {
  // 尝试解析 JSON
  try {
    // 检查是否是 JSON 格式
    if (content.includes('{') && content.includes('}')) {
      const jsonMatch = content.match(/\{[\s\S]*"response"[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.response) {
          return parsed.response.trim()
        }
      }
    }
  } catch (error) {
    // JSON 解析失败，继续使用原始内容
  }

  // 直接返回内容（去除markdown格式）
  return content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()
}

/**
 * 验证回复内容
 */
export function validateReplyContent(content: string): {
  valid: boolean
  reason?: string
} {
  if (!content || content.trim().length === 0) {
    return { valid: false, reason: '回复内容为空' }
  }

  if (content.length > 500) {
    return { valid: false, reason: '回复内容过长' }
  }

  // 检查是否包含敏感词（示例）
  const sensitiveWords = ['薪资具体', '确定薪资', '保证']
  for (const word of sensitiveWords) {
    if (content.includes(word)) {
      return { valid: false, reason: `包含敏感词: ${word}` }
    }
  }

  return { valid: true }
}