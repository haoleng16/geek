/**
 * 候选人简历信息获取模块
 *
 * 用于招聘者端自动获取求职者的简历信息
 */

import { Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'

// ==================== 类型定义 ====================

/**
 * 招聘者端 - 聊天列表中的候选人信息
 */
export interface RecruiterChatListItem {
  name: string // 候选人姓名
  avatar: string // 头像URL
  encryptGeekId: string // 候选人加密ID
  securityId: string // 安全ID
  encryptJobId: string // 应聘职位的加密ID
  brandName: string // 公司名称（候选人当前公司）
  friendSource: number // 来源类型
  friendId: number // 好友ID
  uniqueId: string // 唯一标识
  isTop: number // 是否置顶
  isFiltered: boolean // 是否被过滤
  relationType: number // 关系类型
  sourceTitle: string // 来源标题
  goldGeekStatus: number // 牛人状态
  lastText: string // 最后一条消息
  lastMessageId: string // 最后消息ID
  unreadCount: number // 未读消息数
  lastMsgStatus: number // 最后消息状态
  lastTS: number // 最后消息时间戳
  updateTime: number // 更新时间
  title: string // 职位标题
  lastIsSelf: boolean // 最后一条是否自己发送
}

/**
 * 候选人简历基本信息
 */
export interface CandidateResume {
  // 基本信息
  encryptGeekId: string // 候选人ID
  name: string // 姓名
  avatar: string // 头像
  degree: string // 学历
  workYear: number // 工作年限
  age: number // 年龄
  gender: string // 性别

  // 求职意向
  expectJob: string // 期望职位
  expectSalary: string // 期望薪资
  expectCity: string // 期望城市

  // 当前状态
  currentCompany: string // 当前公司
  currentJob: string // 当前职位
  jobStatus: string // 求职状态（离职/在职等）

  // 技能标签
  skills: string[] // 技能标签列表

  // 工作经历
  workExperiences: WorkExperience[]

  // 项目经历
  projectExperiences: ProjectExperience[]

  // 教育经历
  educationExperiences: EducationExperience[]

  // 个人优势/自我评价
  advantage: string

  // 原始数据（用于调试）
  _raw?: any
}

export interface WorkExperience {
  company: string // 公司名称
  position: string // 职位
  startTime: string // 开始时间
  endTime: string // 结束时间
  duration: string // 时长
  description: string // 工作描述
  skills: string[] // 使用技能
}

export interface ProjectExperience {
  name: string // 项目名称
  role: string // 角色
  startTime: string // 开始时间
  endTime: string // 结束时间
  description: string // 项目描述
  achievement: string // 项目业绩
  skills: string[] // 使用技能
}

export interface EducationExperience {
  school: string // 学校
  major: string // 专业
  degree: string // 学历
  startTime: string // 开始时间
  endTime: string // 结束时间
}

export interface ResumeAnalysisSection {
  title: string
  content: string
}

/**
 * 简历API响应结构
 */
interface ResumeApiResponse {
  code: number
  message: string
  zpData: {
    geekBaseInfo: {
      encryptGeekId: string
      name: string
      avatar: string
      degree: string
      workYear: number
      age: number
      gender: number
      expectJob: string
      expectSalary: string
      expectCity: string
      currentCompany: string
      currentJob: string
      jobStatus: number
      advantage: string
    }
    skillTags: string[]
    workExperiences: any[]
    projectExperiences: any[]
    educationExperiences: any[]
  }
}

// ==================== API 常量 ====================

// 简历详情API（招聘者查看候选人简历）
const RESUME_DETAIL_API = 'https://www.zhipin.com/wapi/zpchat/boss/geek/resume'

// 历史消息API（招聘者端）
const BOSS_HISTORY_MSG_API = 'https://www.zhipin.com/wapi/zpchat/boss/historyMsg'

// ==================== 核心函数 ====================

/**
 * 获取聊天列表（招聘者端 - 候选人列表）
 */
export async function getChatList(page: Page): Promise<RecruiterChatListItem[]> {
  await page.waitForFunction(
    () => {
      return Array.isArray(document.querySelector('.main-wrap .chat-user')?.__vue__?.list)
    },
    { timeout: 30000 }
  )

  const chatList = await page.evaluate(() => {
    const vueComponent = document.querySelector('.main-wrap .chat-user')?.__vue__
    return vueComponent?.list || []
  })

  return chatList as RecruiterChatListItem[]
}

/**
 * 点击聊天项，进入聊天详情
 */
export async function clickChatItem(page: Page, chatItem: RecruiterChatListItem): Promise<void> {
  // 滚动到目标项
  await page.evaluate((item) => {
    const listEl = document.querySelector('.chat-content .user-list .user-list-content')
    if (listEl && listEl.__vue__?.scrollToIndex) {
      // 找到该项在列表中的索引
      const vueList = document.querySelector('.main-wrap .chat-user')?.__vue__?.list || []
      const index = vueList.findIndex(
        (it: any) => it.encryptGeekId === item.encryptGeekId || it.friendId === item.friendId
      )
      if (index >= 0) {
        listEl.__vue__.scrollToIndex(index)
      }
    }
  }, chatItem)

  await sleep(1000)

  // 点击聊天项
  const chatItemEl = await page.evaluateHandle((item) => {
    const items = document.querySelectorAll(
      '.main-wrap .chat-user .user-list-content ul[role=group] li[role=listitem]'
    )
    for (const el of items) {
      const vueData = (el as any).__vue__?.source
      if (vueData?.encryptGeekId === item.encryptGeekId || vueData?.friendId === item.friendId) {
        return el
      }
    }
    return null
  }, chatItem)

  if (chatItemEl) {
    await (chatItemEl as any).click()
    await sleep(1500)
  } else {
    throw new Error(`无法找到聊天项: ${chatItem.name}`)
  }
}

/**
 * 等待历史消息加载完成
 */
export async function waitForHistoryMsg(page: Page): Promise<any> {
  try {
    const response = await page.waitForResponse(
      (response) => {
        const url = response.url()
        return url.includes('/wapi/zpchat/') && url.includes('/historyMsg')
      },
      { timeout: 30000 }
    )
    return await response.json()
  } catch (error) {
    console.warn('等待历史消息超时，尝试继续...')
    return null
  }
}

/**
 * 获取候选人简历信息 - 通过API
 *
 * 这是最可靠的方式，直接调用Boss直聘的简历API
 */
export async function getCandidateResumeByApi(
  page: Page,
  encryptGeekId: string
): Promise<CandidateResume | null> {
  // 监听简历API响应
  const responsePromise = waitForCandidateResumeByApi(page, encryptGeekId)

  // 如果没有触发API，尝试点击查看简历按钮
  const viewResumeBtn = await page.$(
    '.candidate-info .view-resume-btn, ' +
      '.geek-info .resume-btn, ' +
      '.right-box .resume-link, ' +
      '[class*="resume"]'
  )

  if (viewResumeBtn) {
    await viewResumeBtn.click()
    await sleep(1000)
  }

  try {
    return await responsePromise
  } catch (error) {
    console.warn('通过API获取简历失败:', error)
  }

  return null
}

/**
 * 仅等待已触发的简历 API 响应，不主动点击页面元素。
 *
 * 推荐牛人页面更适合在点击卡片前先挂监听，再由卡片点击触发请求。
 */
export async function waitForCandidateResumeByApi(
  page: Page,
  encryptGeekId?: string,
  timeout = 15000
): Promise<CandidateResume | null> {
  return await new Promise((resolve) => {
    let settled = false

    const cleanup = (result: CandidateResume | null) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      page.off('response', handleResponse)
      resolve(result)
    }

    const handleResponse = async (response: any) => {
      const url = response.url()
      const isResumeResponse =
        url.includes('/wapi/zpchat/boss/geek/') ||
        url.includes('/wapi/zpgeek/resume/') ||
        url.includes('/geekInfo') ||
        url.includes('/geek/info')

      if (!isResumeResponse) {
        return
      }

      try {
        const data = await response.json()
        const parsed = parseResumeApiResponse(data)
        if (!parsed) {
          return
        }

        if (encryptGeekId && parsed.encryptGeekId && parsed.encryptGeekId !== encryptGeekId) {
          console.warn(
            '[CandidateResume] 捕获到的简历响应与当前候选人不一致:',
            encryptGeekId,
            parsed.encryptGeekId
          )
          return
        }

        cleanup(parsed)
      } catch (error) {
        console.warn('解析简历API响应失败:', error)
      }
    }

    const timer = setTimeout(() => cleanup(null), timeout)
    page.on('response', handleResponse)
  })
}

/**
 * 获取候选人简历信息 - 通过DOM解析
 *
 * 从聊天详情页面DOM中提取候选人信息
 */
export async function getCandidateResumeFromDOM(page: Page): Promise<Partial<CandidateResume>> {
  const candidateInfo = await page.evaluate(() => {
    // 尝试多种选择器，适配不同版本的页面
    const selectors = {
      // 聊天详情右侧的候选人信息
      infoPanel:
        '.right-box .geek-info, .candidate-panel, .geek-detail, .resume-item-content .item-base, .resume-item-content',
      // 头部信息
      header: '.geek-header, .candidate-header, .user-info, .resume-item-content .geekBaseInfo',
      // 详情区域
      detail: '.geek-detail-content, .resume-content, .resume-item-content'
    }

    const result: any = {}
    const textOf = (el: Element | null | undefined): string =>
      el?.textContent?.replace(/\s+/g, ' ').trim() || ''
    const infoPanel =
      document.querySelector(selectors.infoPanel) ||
      document.querySelector(selectors.detail) ||
      document.querySelector('.resume-item-content')

    // 从Vue组件数据中获取
    const geekInfoVue = document.querySelector('.geek-info')?.__vue__
    const chatRecordVue = document.querySelector('.chat-conversation .chat-record')?.__vue__

    if (geekInfoVue?.geek || chatRecordVue?.geek) {
      const geekData = geekInfoVue?.geek || chatRecordVue?.geek || {}

      result.encryptGeekId = geekData.encryptGeekId || geekData.geekId
      result.name = geekData.name
      result.avatar = geekData.avatar
      result.degree = geekData.degree || geekData.education
      result.workYear = parseInt(geekData.workYear || geekData.workExp || '0')
      result.currentCompany = geekData.company || geekData.currentCompany
      result.currentJob = geekData.position || geekData.jobTitle
      result.expectJob = geekData.expectJob
      result.expectSalary = geekData.expectSalary
      result.expectCity = geekData.expectCity || geekData.city
      result.skills = geekData.skillTags || geekData.skills || []
    }

    // 尝试从DOM文本中提取
    if (!result.name) {
      const nameEl = document.querySelector(
        '.geek-info .name, .candidate-name, .user-name, .resume-item-content .geek-name, .resume-item-content .name, [class*="name"]'
      )
      result.name = textOf(nameEl)
    }

    if (!result.degree) {
      const degreeEl =
        document.querySelector('.resume-item-content .fz-degree')?.parentElement ||
        document.querySelector(
          '.geek-info .degree, .education, [class*="degree"], [class*="education"]'
        )
      result.degree = textOf(degreeEl)
    }

    if (!result.workYear) {
      const workYearEl =
        document.querySelector('.resume-item-content .fz-experience')?.parentElement ||
        document.querySelector(
          '.geek-info .work-year, .work-exp, [class*="work-year"], [class*="workExp"]'
        )
      const workYearText = textOf(workYearEl)
      const match = workYearText.match(/(\d+)/)
      result.workYear = workYearText.includes('应届') ? 0 : match ? parseInt(match[1]) : 0
    }

    if (!result.age) {
      const ageEl = document.querySelector('.resume-item-content .fz-age')?.parentElement
      const ageText = textOf(ageEl)
      const match = ageText.match(/(\d+)/)
      result.age = match ? parseInt(match[1]) : 0
    }

    if (!result.jobStatus) {
      const statusEl = document.querySelector('.resume-item-content .fz-status')?.parentElement
      result.jobStatus = textOf(statusEl)
    }

    if (!result.currentCompany) {
      const workCompanyEl =
        document.querySelector('.resume-item-content .resume-item .history-item .name span') ||
        document.querySelector('.geek-info .company, .current-company, [class*="company"]')
      result.currentCompany = textOf(workCompanyEl)
    }

    if (!result.currentJob) {
      const workJobEl =
        document.querySelector(
          '.resume-item-content .resume-item .history-item .name span + em + span'
        ) || document.querySelector('.geek-info .position, .job-title, [class*="position"]')
      result.currentJob = textOf(workJobEl)
    }

    // 提取技能标签
    if (!result.skills || result.skills.length === 0) {
      const skillEls = document.querySelectorAll(
        '.geek-info .skill-tag, .skill-list .tag, .resume-item-content .professionalSkill .section-content, [class*="skill"] span'
      )
      result.skills = Array.from(skillEls)
        .flatMap((el) => {
          const text = textOf(el)
          if (!text) return []
          if (el.classList.contains('section-content')) {
            return text
              .split(/[;,，、]/)
              .map((item) => item.trim())
              .filter(Boolean)
          }
          return [text]
        })
        .filter(Boolean)
    }

    // 提取城市/地点
    if (!result.expectCity) {
      const cityEl =
        document.querySelector('.resume-item-content .resume-item .label-text') ||
        document.querySelector('.geek-info .city, .location, [class*="city"], [class*="location"]')
      result.expectCity = textOf(cityEl)
    }

    if (!result.advantage) {
      const advantageEl = infoPanel?.querySelector('.selfDescription')
      result.advantage = textOf(advantageEl)
    }

    return result
  })

  return candidateInfo
}

/**
 * 获取候选人简历信息 - 综合方法
 *
 * 优先使用API，失败时回退到DOM解析
 */
export async function getCandidateResume(
  page: Page,
  chatItem: RecruiterChatListItem
): Promise<CandidateResume | null> {
  // 1. 首先尝试从DOM获取基础信息
  const domInfo = await getCandidateResumeFromDOM(page)

  // 2. 尝试通过API获取完整信息
  const apiInfo = await getCandidateResumeByApi(page, chatItem.encryptGeekId)

  // 3. 合并信息
  if (apiInfo) {
    return apiInfo
  }

  // 4. 如果API失败，返回DOM解析的信息
  if (domInfo && Object.keys(domInfo).length > 0) {
    return {
      encryptGeekId: domInfo.encryptGeekId || chatItem.encryptGeekId,
      name: domInfo.name || chatItem.name,
      avatar: domInfo.avatar || chatItem.avatar,
      degree: domInfo.degree || '',
      workYear: domInfo.workYear || 0,
      age: domInfo.age || 0,
      gender: domInfo.gender || '',
      expectJob: domInfo.expectJob || '',
      expectSalary: domInfo.expectSalary || '',
      expectCity: domInfo.expectCity || '',
      currentCompany: domInfo.currentCompany || '',
      currentJob: domInfo.currentJob || '',
      jobStatus: domInfo.jobStatus || '',
      skills: domInfo.skills || [],
      workExperiences: domInfo.workExperiences || [],
      projectExperiences: domInfo.projectExperiences || [],
      educationExperiences: domInfo.educationExperiences || [],
      advantage: domInfo.advantage || '',
      _raw: domInfo
    }
  }

  // 5. 最后使用聊天列表中的基础信息
  return {
    encryptGeekId: chatItem.encryptGeekId,
    name: chatItem.name,
    avatar: chatItem.avatar,
    degree: '',
    workYear: 0,
    age: 0,
    gender: '',
    expectJob: chatItem.title || '',
    expectSalary: '',
    expectCity: '',
    currentCompany: chatItem.brandName || '',
    currentJob: '',
    jobStatus: '',
    skills: [],
    workExperiences: [],
    projectExperiences: [],
    educationExperiences: [],
    advantage: '',
    _raw: chatItem
  }
}

/**
 * 解析简历API响应
 */
function parseResumeApiResponse(data: any): CandidateResume | null {
  try {
    if (data.code !== 0 && data.code !== 200) {
      console.warn('简历API返回错误:', data.message)
      return null
    }

    const resumeData = data.zpData || data.data || data

    // 解析基本信息
    const baseInfo = resumeData.geekBaseInfo || resumeData.baseInfo || resumeData

    // 解析工作经历
    const workExperiences: WorkExperience[] = (resumeData.workExperiences || []).map(
      (exp: any) => ({
        company: exp.company || exp.companyName || '',
        position: exp.position || exp.jobTitle || '',
        startTime: exp.startTime || exp.startDate || '',
        endTime: exp.endTime || exp.endDate || '',
        duration: exp.duration || '',
        description: exp.description || exp.workContent || '',
        skills: exp.skills || exp.skillTags || []
      })
    )

    // 解析项目经历
    const projectExperiences: ProjectExperience[] = (resumeData.projectExperiences || []).map(
      (exp: any) => ({
        name: exp.name || exp.projectName || '',
        role: exp.role || exp.projectRole || '',
        startTime: exp.startTime || exp.startDate || '',
        endTime: exp.endTime || exp.endDate || '',
        description: exp.description || exp.projectContent || '',
        achievement: exp.achievement || exp.projectAchievement || '',
        skills: exp.skills || exp.skillTags || []
      })
    )

    // 解析教育经历
    const educationExperiences: EducationExperience[] = (resumeData.educationExperiences || []).map(
      (exp: any) => ({
        school: exp.school || exp.schoolName || '',
        major: exp.major || exp.majorName || '',
        degree: exp.degree || exp.education || '',
        startTime: exp.startTime || exp.startDate || '',
        endTime: exp.endTime || exp.endDate || ''
      })
    )

    return {
      encryptGeekId: baseInfo.encryptGeekId || baseInfo.geekId || '',
      name: baseInfo.name || '',
      avatar: baseInfo.avatar || baseInfo.headUrl || '',
      degree: baseInfo.degree || baseInfo.education || '',
      workYear: parseInt(baseInfo.workYear || baseInfo.workExp || '0'),
      age: parseInt(baseInfo.age || '0'),
      gender: baseInfo.gender === 1 ? '男' : baseInfo.gender === 2 ? '女' : '',
      expectJob: baseInfo.expectJob || baseInfo.expectPosition || '',
      expectSalary: baseInfo.expectSalary || '',
      expectCity: baseInfo.expectCity || baseInfo.expectCityName || '',
      currentCompany: baseInfo.currentCompany || baseInfo.company || '',
      currentJob: baseInfo.currentJob || baseInfo.position || '',
      jobStatus: parseJobStatus(baseInfo.jobStatus),
      skills: resumeData.skillTags || baseInfo.skills || [],
      workExperiences,
      projectExperiences,
      educationExperiences,
      advantage: baseInfo.advantage || baseInfo.selfEvaluation || '',
      _raw: data
    }
  } catch (error) {
    console.error('解析简历数据失败:', error)
    return null
  }
}

/**
 * 解析求职状态
 */
function parseJobStatus(status: number): string {
  const statusMap: Record<number, string> = {
    1: '离职-随时到岗',
    2: '在职-暂不考虑',
    3: '在职-月内到岗',
    4: '在职-考虑机会',
    5: '在职-暂无想法'
  }
  return statusMap[status] || ''
}

// ==================== 工具函数 ====================

/**
 * 打印候选人信息（调试用）
 */
export function printCandidateInfo(resume: CandidateResume): void {
  console.log('========== 候选人信息 ==========')
  console.log(`姓名: ${resume.name}`)
  console.log(`学历: ${resume.degree}`)
  console.log(`工作年限: ${resume.workYear}年`)
  console.log(`期望职位: ${resume.expectJob}`)
  console.log(`期望薪资: ${resume.expectSalary}`)
  console.log(`当前公司: ${resume.currentCompany}`)
  console.log(`技能标签: ${resume.skills.join(', ')}`)
  console.log('================================')
}

/**
 * 格式化候选人信息为简短摘要
 */
export function formatCandidateSummary(resume: CandidateResume): string {
  const parts: string[] = []

  if (resume.degree) parts.push(resume.degree)
  if (resume.workYear) parts.push(`${resume.workYear}年经验`)
  if (resume.currentCompany) parts.push(resume.currentCompany)
  if (resume.expectJob) parts.push(`期望: ${resume.expectJob}`)

  return parts.join(' | ')
}

function normalizeResumeLine(value: string | null | undefined): string {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function dedupeCompactLines(lines: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const line of lines) {
    const normalized = normalizeResumeLine(line)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function buildResumeAnalysisSections(
  resume: Partial<CandidateResume> | null | undefined
): ResumeAnalysisSection[] {
  if (!resume) {
    return []
  }

  const sections: ResumeAnalysisSection[] = []

  const basicInfoLines = dedupeCompactLines([
    resume.name ? `姓名：${resume.name}` : '',
    resume.gender ? `性别：${resume.gender}` : '',
    typeof resume.age === 'number' && resume.age > 0 ? `年龄：${resume.age}岁` : '',
    resume.degree ? `学历：${resume.degree}` : '',
    typeof resume.workYear === 'number'
      ? `工作年限：${resume.workYear === 0 ? '应届/暂无年限' : `${resume.workYear}年`}`
      : '',
    resume.currentCompany ? `当前公司：${resume.currentCompany}` : '',
    resume.currentJob ? `当前职位：${resume.currentJob}` : '',
    resume.jobStatus ? `求职状态：${resume.jobStatus}` : ''
  ])
  if (basicInfoLines.length > 0) {
    sections.push({ title: '基本信息', content: basicInfoLines.join('\n') })
  }

  const intentLines = dedupeCompactLines([
    resume.expectJob ? `期望职位：${resume.expectJob}` : '',
    resume.expectCity ? `期望城市：${resume.expectCity}` : '',
    resume.expectSalary ? `期望薪资：${resume.expectSalary}` : ''
  ])
  if (intentLines.length > 0) {
    sections.push({ title: '求职意向', content: intentLines.join('\n') })
  }

  const advantage = normalizeResumeLine(resume.advantage)
  if (advantage) {
    sections.push({ title: '个人优势', content: advantage })
  }

  const skills = Array.isArray(resume.skills)
    ? dedupeCompactLines(resume.skills.map((skill) => String(skill)))
    : []
  if (skills.length > 0) {
    sections.push({ title: '技能标签', content: skills.join('、') })
  }

  const workExperienceBlocks = Array.isArray(resume.workExperiences)
    ? resume.workExperiences
        .map((item, index) =>
          dedupeCompactLines([
            item.company ? `${index + 1}. 公司：${item.company}` : `${index + 1}. 工作经历`,
            item.position ? `职位：${item.position}` : '',
            item.startTime || item.endTime
              ? `时间：${normalizeResumeLine(
                  `${item.startTime || ''}${item.startTime || item.endTime ? ' - ' : ''}${item.endTime || ''}`
                )}`
              : '',
            item.duration ? `时长：${item.duration}` : '',
            item.description ? `内容：${item.description}` : '',
            Array.isArray(item.skills) && item.skills.length > 0
              ? `技能：${item.skills.join('、')}`
              : ''
          ]).join('\n')
        )
        .filter(Boolean)
    : []
  if (workExperienceBlocks.length > 0) {
    sections.push({ title: '工作经历', content: workExperienceBlocks.join('\n\n') })
  }

  const projectBlocks = Array.isArray(resume.projectExperiences)
    ? resume.projectExperiences
        .map((item, index) =>
          dedupeCompactLines([
            item.name ? `${index + 1}. 项目：${item.name}` : `${index + 1}. 项目经历`,
            item.role ? `角色：${item.role}` : '',
            item.startTime || item.endTime
              ? `时间：${normalizeResumeLine(
                  `${item.startTime || ''}${item.startTime || item.endTime ? ' - ' : ''}${item.endTime || ''}`
                )}`
              : '',
            item.achievement ? `业绩：${item.achievement}` : '',
            item.description ? `内容：${item.description}` : '',
            Array.isArray(item.skills) && item.skills.length > 0
              ? `技能：${item.skills.join('、')}`
              : ''
          ]).join('\n')
        )
        .filter(Boolean)
    : []
  if (projectBlocks.length > 0) {
    sections.push({ title: '项目经历', content: projectBlocks.join('\n\n') })
  }

  const educationBlocks = Array.isArray(resume.educationExperiences)
    ? resume.educationExperiences
        .map((item, index) =>
          dedupeCompactLines([
            item.school ? `${index + 1}. 学校：${item.school}` : `${index + 1}. 教育经历`,
            item.major ? `专业：${item.major}` : '',
            item.degree ? `学历：${item.degree}` : '',
            item.startTime || item.endTime
              ? `时间：${normalizeResumeLine(
                  `${item.startTime || ''}${item.startTime || item.endTime ? ' - ' : ''}${item.endTime || ''}`
                )}`
              : ''
          ]).join('\n')
        )
        .filter(Boolean)
    : []
  if (educationBlocks.length > 0) {
    sections.push({ title: '教育经历', content: educationBlocks.join('\n\n') })
  }

  return sections
}

export function formatResumeForAnalysis(
  resume: Partial<CandidateResume> | null | undefined
): string {
  return buildResumeAnalysisSections(resume)
    .map((section) => `## ${section.title}\n${section.content}`)
    .join('\n\n')
    .trim()
}
