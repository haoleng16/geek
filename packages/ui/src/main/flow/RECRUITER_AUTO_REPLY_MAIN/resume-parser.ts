/**
 * 简历解析模块
 *
 * 用于解析候选人简历，支持PDF解析和LLM智能解析
 */

import { Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { completes } from '@geekgeekrun/utils/gpt-request.mjs'
import { readConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'

// ==================== 类型定义 ====================

/**
 * 解析后的简历数据
 */
export interface ParsedResume {
  name: string
  phone: string
  email: string
  degree: string
  school: string
  major: string
  workYears: number
  skills: string[]
  currentCompany: string
  currentPosition: string
  workExperience: WorkExperienceItem[]
  projectExperience: ProjectExperienceItem[]
  selfIntroduction: string
  rawText: string
}

export interface WorkExperienceItem {
  company: string
  position: string
  startTime: string
  endTime: string
  description: string
}

export interface ProjectExperienceItem {
  name: string
  role: string
  startTime: string
  endTime: string
  description: string
  achievement: string
}

// ==================== PDF 解析 ====================

/**
 * 检测页面中是否有PDF附件
 */
export async function detectPdfAttachment(page: Page): Promise<string | null> {
  try {
    const pdfUrl = await page.evaluate(() => {
      // 检查聊天消息中的PDF附件
      const pdfLinks = document.querySelectorAll(
        '.chat-conversation .message-item .file-link[href$=".pdf"], ' +
        '.chat-conversation .message-item a[href*=".pdf"], ' +
        '.chat-conversation .attachment-item[data-type="pdf"]'
      )

      for (const link of pdfLinks) {
        const href = link.getAttribute('href') || link.getAttribute('data-url')
        if (href && href.includes('.pdf')) {
          return href
        }
      }

      return null
    })

    return pdfUrl
  } catch (error) {
    console.error('检测PDF附件失败:', error)
    return null
  }
}

/**
 * 从页面下载PDF文件
 */
export async function downloadPdfFromChat(
  page: Page,
  pdfUrl: string
): Promise<Buffer | null> {
  try {
    const response = await page.goto(pdfUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    })

    if (!response) {
      return null
    }

    const buffer = await response.buffer()
    return buffer
  } catch (error) {
    console.error('下载PDF失败:', error)
    return null
  }
}

/**
 * 提取PDF文本内容
 * 注意: 此函数需要在主进程中使用，因为需要访问文件系统
 *
 * 实际使用时需要安装 pdf-parse 库:
 * pnpm add pdf-parse --filter @geekgeekrun/ui
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    // 动态导入 pdf-parse
    const pdfParse = await import('pdf-parse').then(m => m.default || m)
    const data = await pdfParse(buffer)
    return data.text || ''
  } catch (error) {
    console.error('PDF文本提取失败:', error)
    // 如果 pdf-parse 未安装，返回空字符串
    return ''
  }
}

// ==================== 规则解析 ====================

/**
 * 使用规则解析简历文本
 */
export function parseResumeByRules(text: string): Partial<ParsedResume> {
  const result: Partial<ParsedResume> = {
    skills: [],
    workExperience: [],
    projectExperience: []
  }

  if (!text) {
    return result
  }

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)

  // 解析姓名
  const namePatterns = [
    /^姓名[：:]\s*(.+)$/,
    /^([^\s]{2,4})\s*(?:的)?简历/
  ]
  for (const pattern of namePatterns) {
    const match = lines.find(line => pattern.test(line))
    if (match) {
      const result = match.match(pattern)
      if (result) {
        result.name = result[1]
        break
      }
    }
  }

  // 解析电话
  const phoneMatch = text.match(/(?:电话|手机|联系方式)[：:]\s*(1[3-9]\d{9})/)
  if (phoneMatch) {
    result.phone = phoneMatch[1]
  }

  // 解析邮箱
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
  if (emailMatch) {
    result.email = emailMatch[1]
  }

  // 解析学历
  const degreeKeywords = ['博士', '硕士', '研究生', '本科', '大专', '专科', '高中', '中专']
  for (const keyword of degreeKeywords) {
    if (text.includes(keyword)) {
      result.degree = keyword
      break
    }
  }

  // 解析学校
  const schoolMatch = text.match(/(?:毕业院校|学校)[：:]\s*(.+)/)
  if (schoolMatch) {
    result.school = schoolMatch[1].trim()
  }

  // 解析工作年限
  const workYearsMatch = text.match(/(\d+)\s*年\s*(?:工作经验|经历)/)
  if (workYearsMatch) {
    result.workYears = parseInt(workYearsMatch[1])
  }

  // 解析技能关键词
  const skillKeywords = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++',
    'React', 'Vue', 'Angular', 'Node.js', 'Spring', 'Django',
    'MySQL', 'PostgreSQL', 'MongoDB', 'Redis',
    'Docker', 'Kubernetes', 'AWS', 'Linux',
    'Git', 'Webpack', 'Vite'
  ]
  result.skills = skillKeywords.filter(skill =>
    text.toLowerCase().includes(skill.toLowerCase())
  )

  // 解析当前公司
  const currentCompanyMatch = text.match(/(?:当前公司|所在公司|就职于)[：:]\s*(.+)/)
  if (currentCompanyMatch) {
    result.currentCompany = currentCompanyMatch[1].trim()
  }

  // 解析当前职位
  const currentPositionMatch = text.match(/(?:当前职位|职位|岗位)[：:]\s*(.+)/)
  if (currentPositionMatch) {
    result.currentPosition = currentPositionMatch[1].trim()
  }

  result.rawText = text
  return result
}

// ==================== LLM 解析 ====================

/**
 * LLM 简历解析 Prompt
 */
const RESUME_PARSE_PROMPT = `你是一个专业的简历解析助手。请从以下简历文本中提取关键信息。

**核心要求：**
1. 准确提取姓名、联系方式、学历等基本信息
2. 识别技能标签和工作经验
3. 提取工作经历和项目经历
4. 忽略无关信息，只保留关键内容

**简历文本：**
\`\`\`
{RESUME_TEXT}
\`\`\`

请以JSON格式返回，格式如下：
\`\`\`json
{
  "name": "姓名",
  "phone": "电话",
  "email": "邮箱",
  "degree": "学历",
  "school": "学校",
  "major": "专业",
  "workYears": 工作年限(数字),
  "skills": ["技能1", "技能2"],
  "currentCompany": "当前公司",
  "currentPosition": "当前职位",
  "workExperience": [
    {
      "company": "公司名",
      "position": "职位",
      "startTime": "开始时间",
      "endTime": "结束时间",
      "description": "工作描述"
    }
  ],
  "projectExperience": [
    {
      "name": "项目名",
      "role": "角色",
      "startTime": "开始时间",
      "endTime": "结束时间",
      "description": "项目描述",
      "achievement": "项目业绩"
    }
  ],
  "selfIntroduction": "自我介绍"
}
\`\`\`

只返回JSON，不要包含其他内容。`

/**
 * 使用 LLM 解析简历
 */
export async function parseResumeByLLM(
  text: string,
  llmConfig?: any
): Promise<Partial<ParsedResume>> {
  try {
    // 获取 LLM 配置
    const llmConfigList = await readConfigFile('llm.json')
    if (!llmConfigList || llmConfigList.length === 0) {
      console.warn('未找到 LLM 配置')
      return {}
    }

    // 选择第一个启用的配置
    const config = llmConfig || llmConfigList.find((it: any) => it.enabled) || llmConfigList[0]

    const prompt = RESUME_PARSE_PROMPT.replace('{RESUME_TEXT}', text.substring(0, 8000))

    const messages = [
      { role: 'system', content: '你是一个专业的简历解析助手，擅长从简历文本中提取结构化信息。' },
      { role: 'user', content: prompt }
    ]

    const completion = await completes(
      {
        baseURL: config.providerCompleteApiUrl,
        apiKey: config.providerApiSecret,
        model: config.model
      },
      messages
    )

    const content = completion?.choices?.[0]?.message?.content
    if (!content) {
      return {}
    }

    // 解析JSON
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/)
    const jsonStr = jsonMatch ? jsonMatch[1] : content

    try {
      const parsed = JSON.parse(jsonStr)
      return {
        ...parsed,
        rawText: text
      }
    } catch (parseError) {
      console.error('解析LLM返回的JSON失败:', parseError)
      return {}
    }
  } catch (error) {
    console.error('LLM解析简历失败:', error)
    return {}
  }
}

// ==================== 综合解析 ====================

/**
 * 综合解析简历（规则 + LLM）
 */
export async function parseResume(
  text: string,
  options: {
    useLLM?: boolean
    llmConfig?: any
  } = {}
): Promise<Partial<ParsedResume>> {
  // 1. 先使用规则解析
  const ruleResult = parseResumeByRules(text)

  // 2. 如果启用LLM，使用LLM补充
  if (options.useLLM && text.length > 100) {
    try {
      const llmResult = await parseResumeByLLM(text, options.llmConfig)

      // 合并结果，LLM结果优先
      return {
        ...ruleResult,
        ...llmResult,
        skills: [...new Set([...(ruleResult.skills || []), ...(llmResult.skills || [])])]
      }
    } catch (error) {
      console.warn('LLM解析失败，使用规则解析结果:', error)
    }
  }

  return ruleResult
}

/**
 * 从聊天页面检测并解析简历
 */
export async function detectAndParseResume(
  page: Page,
  options: {
    useLLM?: boolean
    llmConfig?: any
  } = {}
): Promise<Partial<ParsedResume> | null> {
  try {
    // 1. 检测PDF附件
    const pdfUrl = await detectPdfAttachment(page)

    if (pdfUrl) {
      console.log('[简历解析] 发现PDF附件:', pdfUrl)

      // 2. 下载PDF
      const pdfBuffer = await downloadPdfFromChat(page, pdfUrl)

      if (pdfBuffer) {
        // 3. 提取文本
        const text = await extractTextFromPdf(pdfBuffer)

        if (text) {
          // 4. 解析简历
          return await parseResume(text, options)
        }
      }
    }

    // 5. 尝试从页面DOM获取简历信息
    const domResume = await extractResumeFromDOM(page)
    if (domResume && Object.keys(domResume).length > 0) {
      return domResume
    }

    return null
  } catch (error) {
    console.error('[简历解析] 解析失败:', error)
    return null
  }
}

/**
 * 从页面DOM提取简历信息
 */
async function extractResumeFromDOM(page: Page): Promise<Partial<ParsedResume>> {
  try {
    const resumeInfo = await page.evaluate(() => {
      const result: any = {}

      // 尝试从候选人信息面板获取
      const infoPanel = document.querySelector('.geek-info, .candidate-info, .right-box')
      if (infoPanel) {
        // 姓名
        const nameEl = infoPanel.querySelector('.name, .geek-name, .candidate-name')
        if (nameEl) result.name = nameEl.textContent?.trim()

        // 学历
        const degreeEl = infoPanel.querySelector('.degree, .education, [class*="degree"]')
        if (degreeEl) result.degree = degreeEl.textContent?.trim()

        // 工作年限
        const workYearsEl = infoPanel.querySelector('.work-year, .work-exp, [class*="work"]')
        if (workYearsEl) {
          const match = workYearsEl.textContent?.match(/(\d+)/)
          if (match) result.workYears = parseInt(match[1])
        }

        // 当前公司
        const companyEl = infoPanel.querySelector('.company, [class*="company"]')
        if (companyEl) result.currentCompany = companyEl.textContent?.trim()

        // 技能
        const skillEls = infoPanel.querySelectorAll('.skill-tag, .skill-list span, [class*="skill"] span')
        if (skillEls.length > 0) {
          result.skills = Array.from(skillEls)
            .map(el => el.textContent?.trim())
            .filter(Boolean)
        }
      }

      return result
    })

    return resumeInfo
  } catch (error) {
    console.error('从DOM提取简历信息失败:', error)
    return {}
  }
}

/**
 * 格式化简历摘要
 */
export function formatResumeSummary(resume: Partial<ParsedResume>): string {
  const parts: string[] = []

  if (resume.name) parts.push(resume.name)
  if (resume.degree) parts.push(resume.degree)
  if (resume.workYears) parts.push(`${resume.workYears}年经验`)
  if (resume.currentCompany) parts.push(resume.currentCompany)
  if (resume.currentPosition) parts.push(resume.currentPosition)

  return parts.join(' | ')
}