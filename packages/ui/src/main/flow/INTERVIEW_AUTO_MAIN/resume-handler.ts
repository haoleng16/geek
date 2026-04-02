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
 * 检测候选人是否发送了简历卡片（带"同意"按钮）
 * 当候选人点击"同意发送简历"后，招聘方会收到一个带"同意"按钮的简历卡片
 * 按钮结构: <div class="message-card-buttons"><span class="card-btn">同意</span></div>
 */
export async function detectResumeCard(page: Page): Promise<{
  hasCard: boolean
  hasAcceptButton: boolean
}> {
  try {
    const result = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')

      // 查找 .message-card-buttons 容器（包含"同意"按钮）
      const buttonContainers = chatConversation?.querySelectorAll('.message-card-buttons')

      if (buttonContainers && buttonContainers.length > 0) {
        // 找到最新的按钮容器（最后一个，且非自己发送的）
        for (let i = buttonContainers.length - 1; i >= 0; i--) {
          const container = buttonContainers[i]

          // 检查是否是候选人发送的（非自己）
          const parentMessage = container.closest('.message-item') ||
                                 container.closest('.chat-item') ||
                                 container.closest('[class*="message"]')

          const isSelf = parentMessage?.classList.contains('self') ||
                        parentMessage?.classList.contains('is-self') ||
                        !!parentMessage?.closest('[class*="self"]')

          if (!isSelf) {
            // 找到"同意"按钮
            const buttons = container.querySelectorAll('.card-btn')
            for (const btn of buttons) {
              const btnText = btn.textContent?.trim() || ''
              if (btnText === '同意' || btnText.includes('同意')) {
                return {
                  hasCard: true,
                  hasAcceptButton: true
                }
              }
            }
          }
        }
      }

      // 备用：检查 Vue 组件数据
      if (chatConversation?.__vue__) {
        const vue = chatConversation.__vue__
        const listKey = Object.keys(vue).find(k =>
          Array.isArray(vue[k]) && vue[k].length > 0
        )

        if (listKey) {
          const messages = vue[listKey]
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            // 检查是否是简历卡片消息
            if (msg.type === 'resume_card' || msg.msgType === 'resume_card' ||
                msg.contentType === 'resume_card' || msg.needAccept) {
              const isSelf = msg.isSelf || msg.self || msg.fromSelf
              if (!isSelf) {
                return {
                  hasCard: true,
                  hasAcceptButton: msg.needAccept || msg.canAccept || false
                }
              }
            }
          }
        }
      }

      return { hasCard: false, hasAcceptButton: false }
    })

    console.log(`[ResumeHandler] 简历卡片检测: hasCard=${result.hasCard}, hasAcceptButton=${result.hasAcceptButton}`)
    return result
  } catch (error) {
    console.error('[ResumeHandler] 检测简历卡片失败:', error)
    return { hasCard: false, hasAcceptButton: false }
  }
}

/**
 * 点击简历卡片上的"同意/接收"按钮
 * 招聘方需要点击同意才能真正接收候选人发送的简历
 * 按钮结构: <div class="message-card-buttons"><span class="card-btn">同意</span></div>
 */
export async function clickResumeAcceptButton(page: Page): Promise<{
  success: boolean
  message?: string
}> {
  try {
    console.log('[ResumeHandler] 开始点击简历卡片上的同意按钮...')

    // 先等待按钮变为可点击状态（disabled class移除）
    console.log('[ResumeHandler] 等待按钮变为可点击状态...')
    await sleep(500)

    const result = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')

      // 查找简历卡片按钮容器: .message-card-buttons
      const buttonContainers = chatConversation?.querySelectorAll('.message-card-buttons')

      if (buttonContainers && buttonContainers.length > 0) {
        // 找到最新的按钮容器（最后一个，且非自己发送的）
        for (let i = buttonContainers.length - 1; i >= 0; i--) {
          const container = buttonContainers[i]

          // 检查是否是候选人发送的（非自己）
          const parentMessage = container.closest('.message-item') ||
                                 container.closest('.chat-item') ||
                                 container.closest('[class*="message"]')

          const isSelf = parentMessage?.classList.contains('self') ||
                        parentMessage?.classList.contains('is-self') ||
                        !!parentMessage?.closest('[class*="self"]')

          if (!isSelf) {
            // 找到"同意"按钮
            const buttons = container.querySelectorAll('.card-btn')
            for (const btn of buttons) {
              const btnText = btn.textContent?.trim() || ''
              if (btnText === '同意' || btnText.includes('同意')) {
                // 检查是否有 disabled class
                if (btn.classList.contains('disabled')) {
                  // 尝试移除 disabled class 或强制点击
                  btn.classList.remove('disabled')
                }

                // 点击按钮
                ;(btn as HTMLElement).click()
                console.log(`[ResumeHandler] 已点击"同意"按钮`)

                // 如果点击无效，尝试触发 Vue/React 事件
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

                return {
                  success: true,
                  message: `点击了"同意"按钮，原始class: ${btn.className}`
                }
              }
            }
          }
        }
      }

      // 备用方案：查找包含"同意"文字的 span.card-btn
      const allCardBtns = chatConversation?.querySelectorAll('.card-btn')
      if (allCardBtns) {
        for (const btn of allCardBtns) {
          const btnText = btn.textContent?.trim() || ''
          if (btnText === '同意' || btnText.includes('同意')) {
            // 强制移除 disabled
            btn.classList.remove('disabled')
            ;(btn as HTMLElement).click()
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            return {
              success: true,
              message: `备用方案：点击了"同意"按钮`
            }
          }
        }
      }

      return {
        success: false,
        message: '未找到 .message-card-buttons 或"同意"按钮'
      }
    })

    console.log(`[ResumeHandler] 点击同意按钮结果: success=${result.success}, ${result.message || ''}`)
    return result
  } catch (error) {
    console.error('[ResumeHandler] 点击同意按钮失败:', error)
    return { success: false, message: String(error) }
  }
}

/**
 * 从简历卡片下载简历
 * 点击同意后，简历卡片会出现在聊天界面，需要点击下载
 */
export async function downloadResumeFromCard(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate
): Promise<string | null> {
  try {
    console.log(`[ResumeHandler] 开始从简历卡片下载: ${candidate.geekName}`)

    const resumeDir = getResumeDirectory()
    const timestamp = new Date().toISOString().split('T')[0]
    const expectedFileName = `${candidate.geekName}_${candidate.jobName}_${timestamp}.pdf`

    // 设置下载路径
    const client = await page.target().createCDPSession()
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: resumeDir
    })

    // 在页面中点击简历卡片触发下载
    const downloadResult = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')

      // 查找简历卡片（已同意后的简历卡片）
      const resumeSelectors = [
        '[class*="resume-card"]',
        '[class*="resume-message"]',
        '[class*="resume"]',
        '[class*="attachment"]',
        '[class*="file-card"]'
      ]

      for (const selector of resumeSelectors) {
        const elements = chatConversation?.querySelectorAll(selector)
        if (elements && elements.length > 0) {
          // 找到最新的简历卡片
          const lastCard = elements[elements.length - 1] as HTMLElement

          // 检查是否包含简历相关内容
          if (lastCard.textContent?.includes('简历') ||
              lastCard.textContent?.includes('附件') ||
              lastCard.querySelector('a') ||
              lastCard.querySelector('[class*="download"]')) {

            // 查找下载链接或按钮
            const downloadBtn = lastCard.querySelector('[class*="download"]') ||
                               lastCard.querySelector('a') ||
                               lastCard.querySelector('button')

            if (downloadBtn) {
              (downloadBtn as HTMLElement).click()
              return { clicked: true, cardText: lastCard.textContent?.substring(0, 50) }
            }

            // 没有找到下载按钮，点击卡片本身
            lastCard.click()
            return { clicked: true, cardText: lastCard.textContent?.substring(0, 50) }
          }
        }
      }

      return { clicked: false, cardText: '' }
    })

    if (!downloadResult.clicked) {
      console.log('[ResumeHandler] 未找到可点击的简历卡片')
      return null
    }

    console.log(`[ResumeHandler] 已点击简历卡片: ${downloadResult.cardText}`)
    console.log('[ResumeHandler] 等待下载完成...')

    // 等待下载完成（最多等待10秒）
    await sleep(3000)

    // 检查下载的文件
    const files = fs.readdirSync(resumeDir)
    const downloadedFile = files.find(f =>
      f.includes(candidate.geekName) ||
      f.includes(timestamp) ||
      f.endsWith('.pdf') ||
      f.endsWith('.doc') ||
      f.endsWith('.docx')
    )

    if (downloadedFile) {
      const actualPath = path.join(resumeDir, downloadedFile)
      const fileStat = fs.statSync(actualPath)

      // 检查文件大小是否合理（至少1KB）
      if (fileStat.size < 1024) {
        console.log(`[ResumeHandler] 文件太小 (${fileStat.size} bytes)，可能下载未完成，等待更多时间...`)
        await sleep(3000)
      }

      // 保存简历记录
      await saveInterviewResume(ds, {
        candidateId: candidate.id,
        filePath: actualPath,
        fileName: downloadedFile,
        fileSize: fs.statSync(actualPath).size,
        downloadedAt: new Date()
      })

      // 更新候选人状态
      await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.RESUME_RECEIVED)

      // 记录操作日志
      await saveInterviewOperationLog(ds, {
        candidateId: candidate.id,
        action: 'resume_downloaded',
        detail: JSON.stringify({ fileName: downloadedFile, size: fs.statSync(actualPath).size })
      })

      console.log(`[ResumeHandler] ★★★ 简历下载成功: ${downloadedFile} (${fs.statSync(actualPath).size} bytes) ★★★`)
      return actualPath
    }

    console.log('[ResumeHandler] 未找到下载的简历文件')
    return null
  } catch (error) {
    console.error('[ResumeHandler] 从简历卡片下载失败:', error)
    return null
  }
}

/**
 * 检测候选人是否同意发送简历
 * 当候选人点击"同意"按钮后，聊天中会出现简历消息卡片
 */
export async function detectResumeAgreed(page: Page): Promise<{
  agreed: boolean
  resumeCardFound: boolean
}> {
  try {
    const result = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')

      // 检查是否有简历交换成功的消息卡片
      // 可能的选择器：简历消息卡片、简历附件、简历交换成功的提示
      const resumeCardSelectors = [
        '[class*="resume-card"]',
        '[class*="resume-message"]',
        '[class*="exchange-resume"]',
        '[class*="agree-resume"]',
        '.message-item [class*="resume"]',
        '.chat-record [class*="resume"]'
      ]

      for (const selector of resumeCardSelectors) {
        const elements = chatConversation?.querySelectorAll(selector)
        if (elements && elements.length > 0) {
          // 找到简历卡片
          return {
            agreed: true,
            resumeCardFound: true
          }
        }
      }

      // 检查Vue组件数据中的消息列表
      if (chatConversation?.__vue__) {
        const vue = chatConversation.__vue__
        const listKey = Object.keys(vue).find(k =>
          Array.isArray(vue[k]) && vue[k].length > 0
        )

        if (listKey) {
          const messages = vue[listKey]
          // 从后往前找最新消息
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            // 检查是否是简历相关消息
            // 消息类型可能是：resume, resume_exchange, resume_agree 等
            if (
              msg.type === 'resume' ||
              msg.msgType === 'resume' ||
              msg.msgType === 'resume_exchange' ||
              msg.msgType === 'resume_agree' ||
              msg.contentType === 'resume' ||
              (msg.text && msg.text.includes('简历')) ||
              (msg.content && msg.content.includes('简历'))
            ) {
              // 检查是否是候选人发送的简历消息（非自己发送）
              const isSelf = msg.isSelf || msg.self || msg.fromSelf || msg.sender === 'recruiter'
              if (!isSelf) {
                return {
                  agreed: true,
                  resumeCardFound: true
                }
              }
            }
          }
        }
      }

      // 检查聊天消息文本中是否有简历相关的提示
      const messageItems = chatConversation?.querySelectorAll('.message-item, .chat-item')
      if (messageItems && messageItems.length > 0) {
        // 从后往前检查最新消息
        for (let i = messageItems.length - 1; i >= 0; i--) {
          const item = messageItems[i]
          const textContent = item.textContent || ''

          // 检查是否包含简历交换成功的提示
          if (
            textContent.includes('已同意发送简历') ||
            textContent.includes('简历已发送') ||
            textContent.includes('发送了简历') ||
            textContent.includes('简历交换成功')
          ) {
            // 检查是否是候选人发送的消息（非自己）
            const isSelf = item.classList.contains('self') ||
                          item.classList.contains('is-self') ||
                          !!item.closest('[class*="self"]')

            if (!isSelf) {
              return {
                agreed: true,
                resumeCardFound: true
              }
            }
          }
        }
      }

      return { agreed: false, resumeCardFound: false }
    })

    console.log(`[ResumeHandler] 简历同意状态检测: agreed=${result.agreed}, resumeCardFound=${result.resumeCardFound}`)
    return result
  } catch (error) {
    console.error('[ResumeHandler] 检测简历同意状态失败:', error)
    return { agreed: false, resumeCardFound: false }
  }
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