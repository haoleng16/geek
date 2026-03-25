/**
 * 候选人筛选模块
 *
 * 用于根据配置条件筛选候选人简历
 */

import { CandidateResume, RecruiterChatListItem } from './candidate-resume'

// ==================== 配置类型定义 ====================

/**
 * 候选人筛选配置
 */
export interface CandidateFilterConfig {
  enabled: boolean                  // 是否启用筛选

  // 学历筛选
  degreeList: string[]              // 接受的学历列表，如 ["本科", "硕士", "博士"]
  degreeMatchMode: 'include' | 'exclude'  // include: 包含这些学历; exclude: 排除这些学历

  // 工作年限筛选
  minWorkYears: number              // 最小工作年限
  maxWorkYears: number              // 最大工作年限（0表示不限）
  workYearsCheckEnabled: boolean    // 是否启用工作年限检查

  // 年龄筛选（可选）
  minAge: number                    // 最小年龄
  maxAge: number                    // 最大年龄（0表示不限）
  ageCheckEnabled: boolean          // 是否启用年龄检查

  // 期望职位关键词
  expectJobKeywords: string[]       // 期望职位包含的关键词
  expectJobMatchMode: 'any' | 'all' // any: 满足任一; all: 满足全部
  expectJobCheckEnabled: boolean    // 是否启用期望职位检查

  // 技能关键词
  skillKeywords: string[]           // 技能包含的关键词
  skillMatchMode: 'any' | 'all'     // any: 满足任一; all: 满足全部
  skillCheckEnabled: boolean        // 是否启用技能检查

  // 当前公司
  companyKeywords: string[]         // 当前公司包含的关键词
  companyMatchMode: 'include' | 'exclude'  // include: 包含; exclude: 排除
  companyCheckEnabled: boolean      // 是否启用公司检查

  // 屏蔽关键词
  blockKeywords: string[]           // 屏蔽关键词，简历中包含则直接排除

  // 期望薪资范围（可选）
  minSalary: number                 // 最低期望薪资（单位：K）
  maxSalary: number                 // 最高期望薪资（单位：K，0表示不限）
  salaryCheckEnabled: boolean       // 是否启用薪资检查

  // 求职状态
  jobStatusList: string[]           // 接受的求职状态
  jobStatusCheckEnabled: boolean    // 是否启用求职状态检查
}

/**
 * 筛选结果
 */
export interface FilterResult {
  matched: boolean                  // 是否匹配
  score: number                     // 匹配得分（0-100）
  reasons: string[]                 // 匹配/不匹配的原因
  warnings: string[]                // 警告信息（如数据缺失）
}

/**
 * 默认筛选配置
 */
export const DEFAULT_FILTER_CONFIG: CandidateFilterConfig = {
  enabled: true,
  degreeList: ['本科', '硕士', '博士'],
  degreeMatchMode: 'include',
  minWorkYears: 0,
  maxWorkYears: 0,
  workYearsCheckEnabled: false,
  minAge: 0,
  maxAge: 0,
  ageCheckEnabled: false,
  expectJobKeywords: [],
  expectJobMatchMode: 'any',
  expectJobCheckEnabled: false,
  skillKeywords: [],
  skillMatchMode: 'any',
  skillCheckEnabled: false,
  companyKeywords: [],
  companyMatchMode: 'include',
  companyCheckEnabled: false,
  blockKeywords: [],
  minSalary: 0,
  maxSalary: 0,
  salaryCheckEnabled: false,
  jobStatusList: [],
  jobStatusCheckEnabled: false
}

// ==================== 学历常量 ====================

/**
 * 学历等级映射（用于比较）
 */
const DEGREE_LEVEL: Record<string, number> = {
  '初中及以下': 1,
  '高中': 2,
  '中专': 2,
  '大专': 3,
  '本科': 4,
  '硕士': 5,
  '博士': 6,
  'MBA': 5,
  'EMBA': 5
}

/**
 * 学历别名映射
 */
const DEGREE_ALIAS: Record<string, string> = {
  '大学本科': '本科',
  '大学专科': '大专',
  '研究生': '硕士',
  '硕士研究生': '硕士',
  '博士研究生': '博士',
  '大专及以上': '本科',
  '本科及以上': '硕士'
}

// ==================== 核心筛选函数 ====================

/**
 * 筛选候选人
 */
export function filterCandidate(
  resume: CandidateResume,
  config: CandidateFilterConfig
): FilterResult {
  const result: FilterResult = {
    matched: true,
    score: 100,
    reasons: [],
    warnings: []
  }

  // 如果筛选未启用，直接返回匹配
  if (!config.enabled) {
    result.reasons.push('筛选未启用，自动通过')
    return result
  }

  // 执行各项检查
  const checks: Array<{ passed: boolean; score: number; reason: string }> = []

  // 1. 屏蔽关键词检查（优先级最高）
  const blockCheck = checkBlockKeywords(resume, config)
  if (!blockCheck.passed) {
    result.matched = false
    result.reasons.push(blockCheck.reason)
    result.score = 0
    return result
  }

  // 2. 学历检查
  if (config.degreeList.length > 0) {
    const degreeCheck = checkDegree(resume, config)
    checks.push(degreeCheck)
    if (!degreeCheck.passed) {
      result.matched = false
      result.reasons.push(degreeCheck.reason)
    }
  }

  // 3. 工作年限检查
  if (config.workYearsCheckEnabled && (config.minWorkYears > 0 || config.maxWorkYears > 0)) {
    const workYearsCheck = checkWorkYears(resume, config)
    checks.push(workYearsCheck)
    if (!workYearsCheck.passed) {
      result.matched = false
      result.reasons.push(workYearsCheck.reason)
    }
  }

  // 4. 年龄检查
  if (config.ageCheckEnabled && (config.minAge > 0 || config.maxAge > 0)) {
    const ageCheck = checkAge(resume, config)
    checks.push(ageCheck)
    if (!ageCheck.passed) {
      result.matched = false
      result.reasons.push(ageCheck.reason)
    }
  }

  // 5. 期望职位检查
  if (config.expectJobCheckEnabled && config.expectJobKeywords.length > 0) {
    const jobCheck = checkExpectJob(resume, config)
    checks.push(jobCheck)
    if (!jobCheck.passed) {
      result.matched = false
      result.reasons.push(jobCheck.reason)
    }
  }

  // 6. 技能检查
  if (config.skillCheckEnabled && config.skillKeywords.length > 0) {
    const skillCheck = checkSkills(resume, config)
    checks.push(skillCheck)
    if (!skillCheck.passed) {
      result.matched = false
      result.reasons.push(skillCheck.reason)
    }
  }

  // 7. 公司检查
  if (config.companyCheckEnabled && config.companyKeywords.length > 0) {
    const companyCheck = checkCompany(resume, config)
    checks.push(companyCheck)
    if (!companyCheck.passed) {
      result.matched = false
      result.reasons.push(companyCheck.reason)
    }
  }

  // 8. 薪资检查
  if (config.salaryCheckEnabled) {
    const salaryCheck = checkSalary(resume, config)
    checks.push(salaryCheck)
    if (!salaryCheck.passed) {
      result.matched = false
      result.reasons.push(salaryCheck.reason)
    }
  }

  // 9. 求职状态检查
  if (config.jobStatusCheckEnabled && config.jobStatusList.length > 0) {
    const statusCheck = checkJobStatus(resume, config)
    checks.push(statusCheck)
    if (!statusCheck.passed) {
      result.matched = false
      result.reasons.push(statusCheck.reason)
    }
  }

  // 计算综合得分
  if (checks.length > 0) {
    const totalScore = checks.reduce((sum, check) => sum + check.score, 0)
    result.score = Math.round(totalScore / checks.length)
  }

  // 添加警告信息
  if (!resume.degree) {
    result.warnings.push('学历信息缺失')
  }
  if (resume.workYear === 0) {
    result.warnings.push('工作年限信息缺失')
  }

  return result
}

// ==================== 各项检查函数 ====================

/**
 * 检查屏蔽关键词
 */
function checkBlockKeywords(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  if (config.blockKeywords.length === 0) {
    return { passed: true, score: 100, reason: '' }
  }

  // 合并所有文本进行匹配
  const allText = [
    resume.name,
    resume.currentCompany,
    resume.currentJob,
    resume.expectJob,
    resume.advantage,
    ...resume.skills,
    ...resume.workExperiences.map(e => `${e.company} ${e.position} ${e.description}`)
  ].filter(Boolean).join(' ')

  for (const keyword of config.blockKeywords) {
    if (allText.includes(keyword)) {
      return {
        passed: false,
        score: 0,
        reason: `命中屏蔽关键词: "${keyword}"`
      }
    }
  }

  return { passed: true, score: 100, reason: '' }
}

/**
 * 检查学历
 */
function checkDegree(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  if (!resume.degree) {
    return { passed: true, score: 50, reason: '学历信息缺失，默认通过' }
  }

  // 处理学历别名
  const normalizedDegree = DEGREE_ALIAS[resume.degree] || resume.degree
  const resumeLevel = DEGREE_LEVEL[normalizedDegree] || 0

  if (config.degreeMatchMode === 'include') {
    // 包含模式：学历必须在列表中
    const isMatch = config.degreeList.some(degree => {
      const normalizedConfig = DEGREE_ALIAS[degree] || degree
      return normalizedConfig === normalizedDegree ||
             DEGREE_LEVEL[normalizedConfig] === resumeLevel
    })

    if (!isMatch) {
      return {
        passed: false,
        score: 0,
        reason: `学历不匹配: ${resume.degree}，要求: ${config.degreeList.join('、')}`
      }
    }
  } else {
    // 排除模式：学历不能在列表中
    const isExcluded = config.degreeList.some(degree => {
      const normalizedConfig = DEGREE_ALIAS[degree] || degree
      return normalizedConfig === normalizedDegree
    })

    if (isExcluded) {
      return {
        passed: false,
        score: 0,
        reason: `学历被排除: ${resume.degree}`
      }
    }
  }

  return { passed: true, score: 100, reason: '' }
}

/**
 * 检查工作年限
 */
function checkWorkYears(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  const years = resume.workYear

  if (years === 0) {
    return { passed: true, score: 50, reason: '工作年限信息缺失，默认通过' }
  }

  if (config.minWorkYears > 0 && years < config.minWorkYears) {
    return {
      passed: false,
      score: 0,
      reason: `工作年限不足: ${years}年，要求至少${config.minWorkYears}年`
    }
  }

  if (config.maxWorkYears > 0 && years > config.maxWorkYears) {
    return {
      passed: false,
      score: 0,
      reason: `工作年限超标: ${years}年，要求不超过${config.maxWorkYears}年`
    }
  }

  return { passed: true, score: 100, reason: '' }
}

/**
 * 检查年龄
 */
function checkAge(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  const age = resume.age

  if (age === 0) {
    return { passed: true, score: 50, reason: '年龄信息缺失，默认通过' }
  }

  if (config.minAge > 0 && age < config.minAge) {
    return {
      passed: false,
      score: 0,
      reason: `年龄不足: ${age}岁，要求至少${config.minAge}岁`
    }
  }

  if (config.maxAge > 0 && age > config.maxAge) {
    return {
      passed: false,
      score: 0,
      reason: `年龄超标: ${age}岁，要求不超过${config.maxAge}岁`
    }
  }

  return { passed: true, score: 100, reason: '' }
}

/**
 * 检查期望职位
 */
function checkExpectJob(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  const expectJob = resume.expectJob

  if (!expectJob) {
    return { passed: true, score: 50, reason: '期望职位信息缺失，默认通过' }
  }

  const matchedKeywords = config.expectJobKeywords.filter(kw =>
    expectJob.toLowerCase().includes(kw.toLowerCase())
  )

  if (config.expectJobMatchMode === 'all') {
    if (matchedKeywords.length < config.expectJobKeywords.length) {
      const missing = config.expectJobKeywords.filter(kw => !matchedKeywords.includes(kw))
      return {
        passed: false,
        score: Math.round((matchedKeywords.length / config.expectJobKeywords.length) * 100),
        reason: `期望职位缺少关键词: ${missing.join('、')}`
      }
    }
  } else {
    if (matchedKeywords.length === 0) {
      return {
        passed: false,
        score: 0,
        reason: `期望职位不匹配: ${expectJob}，期望包含: ${config.expectJobKeywords.join('、')}`
      }
    }
  }

  return { passed: true, score: 100, reason: '' }
}

/**
 * 检查技能
 */
function checkSkills(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  const skills = resume.skills

  if (!skills || skills.length === 0) {
    return { passed: true, score: 50, reason: '技能信息缺失，默认通过' }
  }

  const allSkillText = skills.join(' ').toLowerCase()
  const matchedKeywords = config.skillKeywords.filter(kw =>
    allSkillText.includes(kw.toLowerCase())
  )

  if (config.skillMatchMode === 'all') {
    if (matchedKeywords.length < config.skillKeywords.length) {
      const missing = config.skillKeywords.filter(kw => !matchedKeywords.includes(kw))
      return {
        passed: false,
        score: Math.round((matchedKeywords.length / config.skillKeywords.length) * 100),
        reason: `技能缺少关键词: ${missing.join('、')}`
      }
    }
  } else {
    if (matchedKeywords.length === 0) {
      return {
        passed: false,
        score: 0,
        reason: `技能不匹配，期望包含: ${config.skillKeywords.join('、')}`
      }
    }
  }

  return { passed: true, score: 100, reason: '' }
}

/**
 * 检查公司
 */
function checkCompany(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  const company = resume.currentCompany

  if (!company) {
    return { passed: true, score: 50, reason: '公司信息缺失，默认通过' }
  }

  const isMatch = config.companyKeywords.some(kw =>
    company.toLowerCase().includes(kw.toLowerCase())
  )

  if (config.companyMatchMode === 'include') {
    if (!isMatch) {
      return {
        passed: false,
        score: 0,
        reason: `公司不匹配: ${company}，期望包含: ${config.companyKeywords.join('、')}`
      }
    }
  } else {
    if (isMatch) {
      return {
        passed: false,
        score: 0,
        reason: `公司被排除: ${company}`
      }
    }
  }

  return { passed: true, score: 100, reason: '' }
}

/**
 * 检查期望薪资
 */
function checkSalary(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  const salary = resume.expectSalary

  if (!salary) {
    return { passed: true, score: 50, reason: '期望薪资信息缺失，默认通过' }
  }

  // 解析薪资范围，如 "15-20K" 或 "15-20"
  const match = salary.match(/(\d+)\s*[-~]\s*(\d+)/)
  if (!match) {
    return { passed: true, score: 50, reason: '无法解析期望薪资，默认通过' }
  }

  const minSal = parseInt(match[1])
  const maxSal = parseInt(match[2])

  if (config.minSalary > 0 && maxSal < config.minSalary) {
    return {
      passed: false,
      score: 0,
      reason: `期望薪资过低: ${salary}，要求至少${config.minSalary}K`
    }
  }

  if (config.maxSalary > 0 && minSal > config.maxSalary) {
    return {
      passed: false,
      score: 0,
      reason: `期望薪资过高: ${salary}，要求不超过${config.maxSalary}K`
    }
  }

  return { passed: true, score: 100, reason: '' }
}

/**
 * 检查求职状态
 */
function checkJobStatus(
  resume: CandidateResume,
  config: CandidateFilterConfig
): { passed: boolean; score: number; reason: string } {
  const status = resume.jobStatus

  if (!status) {
    return { passed: true, score: 50, reason: '求职状态信息缺失，默认通过' }
  }

  if (!config.jobStatusList.includes(status)) {
    return {
      passed: false,
      score: 0,
      reason: `求职状态不匹配: ${status}，期望: ${config.jobStatusList.join('、')}`
    }
  }

  return { passed: true, score: 100, reason: '' }
}

// ==================== 工具函数 ====================

/**
 * 快速筛选（只检查最常用的条件）
 */
export function quickFilter(
  resume: CandidateResume,
  options: {
    degreeList?: string[]
    minWorkYears?: number
    maxWorkYears?: number
    keywords?: string[]
  }
): boolean {
  // 学历检查
  if (options.degreeList && options.degreeList.length > 0 && resume.degree) {
    const normalized = DEGREE_ALIAS[resume.degree] || resume.degree
    if (!options.degreeList.includes(normalized) && !options.degreeList.includes(resume.degree)) {
      return false
    }
  }

  // 工作年限检查
  if (options.minWorkYears !== undefined && resume.workYear < options.minWorkYears) {
    return false
  }
  if (options.maxWorkYears !== undefined && resume.workYear > options.maxWorkYears) {
    return false
  }

  // 关键词检查
  if (options.keywords && options.keywords.length > 0) {
    const text = `${resume.expectJob} ${resume.skills.join(' ')} ${resume.currentJob}`.toLowerCase()
    const hasMatch = options.keywords.some(kw => text.includes(kw.toLowerCase()))
    if (!hasMatch) {
      return false
    }
  }

  return true
}

/**
 * 从配置文件读取筛选配置
 */
export function parseFilterConfigFromJson(json: any): CandidateFilterConfig {
  const filterConfig = json?.candidateFilter || {}

  return {
    enabled: filterConfig.enabled ?? true,
    degreeList: filterConfig.degreeList || [],
    degreeMatchMode: filterConfig.degreeMatchMode || 'include',
    minWorkYears: filterConfig.minWorkYears || 0,
    maxWorkYears: filterConfig.maxWorkYears || 0,
    workYearsCheckEnabled: filterConfig.workYearsCheckEnabled ?? false,
    minAge: filterConfig.minAge || 0,
    maxAge: filterConfig.maxAge || 0,
    ageCheckEnabled: filterConfig.ageCheckEnabled ?? false,
    expectJobKeywords: filterConfig.expectJobKeywords || [],
    expectJobMatchMode: filterConfig.expectJobMatchMode || 'any',
    expectJobCheckEnabled: filterConfig.expectJobCheckEnabled ?? false,
    skillKeywords: filterConfig.skillKeywords || [],
    skillMatchMode: filterConfig.skillMatchMode || 'any',
    skillCheckEnabled: filterConfig.skillCheckEnabled ?? false,
    companyKeywords: filterConfig.companyKeywords || [],
    companyMatchMode: filterConfig.companyMatchMode || 'include',
    companyCheckEnabled: filterConfig.companyCheckEnabled ?? false,
    blockKeywords: filterConfig.blockKeywords || [],
    minSalary: filterConfig.minSalary || 0,
    maxSalary: filterConfig.maxSalary || 0,
    salaryCheckEnabled: filterConfig.salaryCheckEnabled ?? false,
    jobStatusList: filterConfig.jobStatusList || [],
    jobStatusCheckEnabled: filterConfig.jobStatusCheckEnabled ?? false
  }
}