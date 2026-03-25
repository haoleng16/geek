/**
 * 招聘端自动回复 - 类型定义
 */

// ==================== 职位配置 ====================

/**
 * 招聘者职位配置
 */
export interface RecruiterJobConfig {
  id: number
  encryptJobId: string           // BOSS直聘职位ID
  jobName: string                // 职位名称
  templateFirstMessage: string   // 首次回复模版
  templateRejectMessage: string  // 婉拒模版
  filterConfig: FilterConfig     // 筛选配置
  dailyLimit: number             // 每日处理上限
  enabled: boolean               // 是否启用
  createdAt: Date
  updatedAt: Date
}

/**
 * 筛选配置
 */
export interface FilterConfig {
  degreeList: string[]           // 接受的学历列表
  minWorkYears: number           // 最小工作年限
  maxWorkYears: number           // 最大工作年限
  skillKeywords: string[]        // 技能关键词
  expectJobKeywords?: string[]   // 期望职位关键词
  blockKeywords?: string[]       // 屏蔽关键词
  companyKeywords?: string[]     // 公司关键词
  minSalary?: number             // 最低期望薪资
  maxSalary?: number             // 最高期望薪资
}

// ==================== 候选人 ====================

/**
 * 候选人对话状态
 */
export type CandidateStatus = 'pending' | 'matched' | 'rejected' | 'handover'

/**
 * 候选人列表项
 */
export interface CandidateListItem {
  encryptGeekId: string
  name: string
  degree: string
  workYears: number
  status: CandidateStatus
  roundCount: number
  lastContactAt: Date | null
  currentCompany?: string
  currentJob?: string
  expectJob?: string
  skills?: string[]
}

/**
 * 候选人对话记录
 */
export interface CandidateConversationRecord {
  id: number
  encryptGeekId: string
  encryptJobId: string
  roundCount: number
  status: CandidateStatus
  firstContactAt: Date | null
  lastReplyAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * 候选人简历记录
 */
export interface CandidateResumeRecord {
  id: number
  encryptGeekId: string
  name: string | null
  phone: string | null
  degree: string | null
  school: string | null
  workYears: number | null
  skills: string[] | null
  workExperience: string | null      // JSON
  projectExperience: string | null   // JSON
  rawResumeData: string | null       // 原始简历数据
  createdAt: Date
}

// ==================== 日志与统计 ====================

/**
 * 处理日志
 */
export interface RecruiterProcessLogRecord {
  id: number
  encryptGeekId: string
  encryptJobId: string
  action: 'reply' | 'reject' | 'parse_resume' | 'skip'
  roundNumber: number | null
  messageContent: string | null
  filterResult: string | null        // JSON
  errorMessage: string | null
  createdAt: Date
}

/**
 * 每日统计
 */
export interface DailyStats {
  id: number
  date: string                        // YYYY-MM-DD
  encryptJobId: string | null         // NULL 表示总计
  totalProcessed: number
  totalMatched: number
  totalRejected: number
  totalHandover: number
  totalResumeParsed: number
}

// ==================== 快捷回复 ====================

/**
 * 快捷回复项
 */
export interface QuickReplyItem {
  id: string | number
  name: string
  content: string
  enabled: boolean
  order: number
  shortcut?: string
}

/**
 * 快捷回复配置
 */
export interface QuickReplyConfig {
  list: QuickReplyItem[]
  defaultReplyIndex: number
}

// ==================== 回复策略 ====================

/**
 * 回复策略配置
 */
export interface ReplyStrategyConfig {
  matchReplyMode: 'constant' | 'first_quick_reply' | 'random_quick_reply' | 'llm'
  matchReplyContent: string
  matchQuickReplyId: string | number | null
  notMatchAction: 'skip' | 'mark_not_suitable' | 'reply'
  notMatchReplyContent: string
}

// ==================== LLM 回复 ====================

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
  tone: 'professional' | 'friendly' | 'casual'
  maxLength: number
  includeCompanyInfo: boolean
  guideToInterview: boolean
  language: 'zh' | 'en'
}

// ==================== 反检测 ====================

/**
 * 反检测配置
 */
export interface AntiDetectionConfig {
  minDelay: number
  maxDelay: number
  perMinuteLimit: number
  perHourLimit: number
  dailyLimit: number
  simulateTyping: boolean
  simulateMouseMovement: boolean
  randomScroll: boolean
  workHourStart: number
  workHourEnd: number
  respectWorkHours: boolean
}

// ==================== 对话管理 ====================

/**
 * 对话管理配置
 */
export interface ConversationManagerConfig {
  maxRounds: number
  handoverKeywords: string[]
  autoHandoverOnComplex: boolean
}

// ==================== 主配置 ====================

/**
 * 招聘端自动回复主配置
 */
export interface RecruiterAutoReplyConfig {
  // 基础设置
  chatUiUrl: string
  scanIntervalSeconds: number
  autoSend: boolean
  confirmBeforeSend: boolean
  constantReplyContent: string

  // 候选人筛选
  candidateFilter: FilterConfig

  // 快捷回复
  quickReply: QuickReplyConfig

  // 回复策略
  replyStrategy: ReplyStrategyConfig

  // 对话管理
  conversation: ConversationManagerConfig

  // 反检测
  antiDetection: AntiDetectionConfig

  // LLM 回复
  llmReply: {
    enabled: boolean
    config: RecruiterReplyConfig
  }
}

// ==================== 分页 ====================

/**
 * 分页请求参数
 */
export interface PageParams {
  page?: number
  pageSize?: number
}

/**
 * 分页响应
 */
export interface PagedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}