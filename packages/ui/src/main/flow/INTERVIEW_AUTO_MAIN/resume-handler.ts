/**
 * 面试自动化 - 简历处理模块
 *
 * 负责简历下载和管理
 */

import type { Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import type { DataSource } from 'typeorm'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import {
  saveInterviewResume,
  getInterviewResume,
  updateInterviewCandidateStatus,
  saveInterviewOperationLog
} from '@geekgeekrun/sqlite-plugin/handlers'
import { InterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'

/**
 * 获取简历保存目录
 */
function getResumeDirectory(): string {
  const userDataPath = app.getPath('userData')
  const resumeDir = path.join(userDataPath, 'interview-resumes')

  if (!fs.existsSync(resumeDir)) {
    fs.mkdirSync(resumeDir, { recursive: true })
  }

  return resumeDir
}

/**
 * 检测候选人是否发送了简历
 */
export async function detectResumeSent(page: Page): Promise<{
  hasResume: boolean
  resumeUrl?: string
  resumeName?: string
}> {
  try {
    const result = await page.evaluate(() => {
      // 检查聊天记录中是否有简历消息
      const chatConversation = document.querySelector('.chat-conversation')

      // 检查是否有简历附件
      const resumeElements = chatConversation?.querySelectorAll(
        '[class*="resume"], [class*="attachment"], [class*="file-card"]'
      )

      if (resumeElements && resumeElements.length > 0) {
        // 查找简历下载链接
        for (const el of resumeElements) {
          const link = el.querySelector('a[href*="resume"], a[href*="download"]')
          if (link) {
            return {
              hasResume: true,
              resumeUrl: link.getAttribute('href') || undefined,
              resumeName: link.textContent?.trim() || '简历'
            }
          }

          // 检查是否是简历卡片
          if (el.textContent?.includes('简历') || el.textContent?.includes('附件')) {
            return {
              hasResume: true,
              resumeUrl: undefined,
              resumeName: el.textContent?.trim() || '简历'
            }
          }
        }
      }

      // 检查 Vue 组件数据
      if (chatConversation?.__vue__) {
        const vue = chatConversation.__vue__
        const listKey = Object.keys(vue).find(k =>
          Array.isArray(vue[k]) && vue[k].length > 0
        )

        if (listKey) {
          const messages = vue[listKey]
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            // 检查是否是简历消息
            if (msg.type === 'resume' || msg.msgType === 'resume' ||
                msg.attachment || msg.file) {
              return {
                hasResume: true,
                resumeUrl: msg.url || msg.attachment?.url || msg.file?.url,
                resumeName: msg.fileName || msg.attachment?.name || '简历'
              }
            }
          }
        }
      }

      return { hasResume: false }
    })

    return result
  } catch (error) {
    console.error('[ResumeHandler] 检测简历失败:', error)
    return { hasResume: false }
  }
}

/**
 * 下载简历
 */
export async function downloadResume(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate,
  resumeUrl: string
): Promise<string | null> {
  try {
    console.log(`[ResumeHandler] 开始下载简历: ${candidate.geekName}`)

    const resumeDir = getResumeDirectory()
    const timestamp = new Date().toISOString().split('T')[0]
    const fileName = `${candidate.geekName}_${candidate.jobName}_${timestamp}.pdf`
    const filePath = path.join(resumeDir, fileName)

    // 使用页面下载
    const cookies = await page.cookies()
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // 发起下载请求
    const response = await page.evaluate(async (url, cookies) => {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Cookie': cookies
        }
      })
      const blob = await res.blob()
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type'),
        size: blob.size
      }
    }, resumeUrl, cookieString)

    if (!response.ok) {
      console.error('[ResumeHandler] 简历下载失败:', response.status)
      return null
    }

    // 通过 CDP 下载文件
    const client = await page.target().createCDPSession()
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: resumeDir
    })

    // 触发下载
    await page.evaluate((url) => {
      const a = document.createElement('a')
      a.href = url
      a.download = ''
      a.click()
    }, resumeUrl)

    // 等待下载完成
    await sleep(3000)

    // 检查文件是否存在
    const files = fs.readdirSync(resumeDir)
    const downloadedFile = files.find(f =>
      f.includes(candidate.geekName) ||
      f.includes(timestamp) ||
      f.endsWith('.pdf')
    )

    if (downloadedFile) {
      const actualPath = path.join(resumeDir, downloadedFile)

      // 保存简历记录
      await saveInterviewResume(ds, {
        candidateId: candidate.id,
        filePath: actualPath,
        fileName: downloadedFile,
        fileSize: fs.statSync(actualPath).size,
        downloadedAt: new Date(),
        downloadUrl: resumeUrl
      })

      // 更新候选人状态
      await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.RESUME_RECEIVED)

      // 记录操作日志
      await saveInterviewOperationLog(ds, {
        candidateId: candidate.id,
        action: 'resume_downloaded',
        detail: JSON.stringify({ fileName: downloadedFile, size: fs.statSync(actualPath).size })
      })

      console.log(`[ResumeHandler] 简历下载成功: ${downloadedFile}`)
      return actualPath
    }

    console.error('[ResumeHandler] 未找到下载的简历文件')
    return null
  } catch (error) {
    console.error('[ResumeHandler] 下载简历失败:', error)
    return null
  }
}

/**
 * 获取候选人简历路径
 */
export async function getCandidateResumePath(
  ds: DataSource,
  candidateId: number
): Promise<string | null> {
  try {
    const resume = await getInterviewResume(ds, candidateId)
    if (resume && resume.filePath && fs.existsSync(resume.filePath)) {
      return resume.filePath
    }
    return null
  } catch (error) {
    console.error('[ResumeHandler] 获取简历路径失败:', error)
    return null
  }
}

/**
 * 删除简历文件
 */
export async function deleteResumeFile(
  ds: DataSource,
  candidateId: number
): Promise<boolean> {
  try {
    const resume = await getInterviewResume(ds, candidateId)
    if (resume?.filePath && fs.existsSync(resume.filePath)) {
      fs.unlinkSync(resume.filePath)
      console.log(`[ResumeHandler] 简历文件已删除: ${resume.filePath}`)
      return true
    }
    return false
  } catch (error) {
    console.error('[ResumeHandler] 删除简历文件失败:', error)
    return false
  }
}

/**
 * 获取简历统计信息
 */
export async function getResumeStats(ds: DataSource): Promise<{
  total: number
  emailed: number
  pending: number
}> {
  try {
    const resumeDir = getResumeDirectory()
    const files = fs.readdirSync(resumeDir).filter(f =>
      f.endsWith('.pdf') || f.endsWith('.doc') || f.endsWith('.docx')
    )

    return {
      total: files.length,
      emailed: 0, // 需要从数据库查询
      pending: files.length
    }
  } catch (error) {
    console.error('[ResumeHandler] 获取简历统计失败:', error)
    return { total: 0, emailed: 0, pending: 0 }
  }
}