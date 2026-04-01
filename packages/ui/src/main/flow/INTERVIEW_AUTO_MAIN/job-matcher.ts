/**
 * 面试自动化 - 岗位匹配模块
 *
 * 根据候选人消息和职位名称匹配面试岗位配置
 */

import type { DataSource } from 'typeorm'
import { getInterviewJobPositionList } from '@geekgeekrun/sqlite-plugin/handlers'
import type { InterviewJobPosition } from '@geekgeekrun/sqlite-plugin/entity/InterviewJobPosition'

export interface JobMatchResult {
  matched: boolean
  jobPosition?: InterviewJobPosition
  reason?: string
}

/**
 * 根据职位名称匹配岗位配置
 */
export async function matchJobPositionByName(
  ds: DataSource,
  jobName: string
): Promise<JobMatchResult> {
  try {
    const jobPositions = await getInterviewJobPositionList(ds)

    if (!jobPositions || jobPositions.length === 0) {
      return { matched: false, reason: '没有配置面试岗位' }
    }

    // 精确匹配
    const exactMatch = jobPositions.find(
      jp => jp.name.toLowerCase() === jobName.toLowerCase()
    )
    if (exactMatch) {
      return { matched: true, jobPosition: exactMatch }
    }

    // 模糊匹配（包含关系）
    const fuzzyMatch = jobPositions.find(
      jp => jobName.toLowerCase().includes(jp.name.toLowerCase()) ||
           jp.name.toLowerCase().includes(jobName.toLowerCase())
    )
    if (fuzzyMatch) {
      return { matched: true, jobPosition: fuzzyMatch }
    }

    // 关键词匹配
    const keywordMatch = jobPositions.find(jp => {
      const keywords = jp.name.split(/[\s,，、]+/)
      return keywords.some(kw =>
        jobName.toLowerCase().includes(kw.toLowerCase())
      )
    })
    if (keywordMatch) {
      return { matched: true, jobPosition: keywordMatch }
    }

    return { matched: false, reason: '未找到匹配的岗位配置' }
  } catch (error) {
    console.error('[JobMatcher] 匹配失败:', error)
    return { matched: false, reason: '匹配过程出错' }
  }
}

/**
 * 根据职位ID匹配岗位配置
 */
export async function matchJobPositionById(
  ds: DataSource,
  encryptJobId: string
): Promise<JobMatchResult> {
  try {
    const jobPositions = await getInterviewJobPositionList(ds)

    const match = jobPositions.find(jp => jp.encryptJobId === encryptJobId)
    if (match) {
      return { matched: true, jobPosition: match }
    }

    return { matched: false, reason: '未找到匹配的岗位配置' }
  } catch (error) {
    console.error('[JobMatcher] 匹配失败:', error)
    return { matched: false, reason: '匹配过程出错' }
  }
}

/**
 * 获取所有活跃岗位名称列表
 */
export async function getActiveJobNames(ds: DataSource): Promise<string[]> {
  try {
    const jobPositions = await getInterviewJobPositionList(ds)
    return jobPositions.map(jp => jp.name)
  } catch (error) {
    console.error('[JobMatcher] 获取岗位名称失败:', error)
    return []
  }
}