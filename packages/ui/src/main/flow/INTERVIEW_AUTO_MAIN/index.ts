/**
 * 面试自动化系统 - 主入口
 *
 * 实现多轮面试自动化流程
 */

import minimist from 'minimist'
import { app, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import initPublicIpc from '../../utils/initPublicIpc'
import { connectToDaemon, sendToDaemon } from '../OPEN_SETTING_WINDOW/connect-to-daemon'
import { initInterviewIpcHandlers } from './ipc-handlers'
import { checkShouldExit } from '../../utils/worker'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { configWithBrowserAssistant } from '../../features/config-with-browser-assistant'
import { writeStorageFile, readStorageFile, readConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../../common/enums/auto-start-chat'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import type { DataSource } from 'typeorm'
import { bootstrap, launchBoss, storeStorage } from './bootstrap'
import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { checkCookieListFormat } from '../../../common/utils/cookie'
import { loginWithCookieAssistant } from '../../features/login-with-cookie-assistant'
import type { Browser, Page } from 'puppeteer'
import type { ChatListItem } from '../READ_NO_REPLY_AUTO_REMINDER_MAIN/types'
import { getCurrentChatGeekInfo } from '../RECRUITER_AUTO_REPLY_MAIN/quick-reply'
import { sendMessage } from '../READ_NO_REPLY_AUTO_REMINDER_MAIN/boss-operation'

// 导入面试模块
import { matchJobPositionByName, matchJobPositionById } from './job-matcher'
import { sendInterviewQuestion, sendResumeRequest, sendResumeExchangeRequest, sendRejectionMessage } from './question-sender'
import { getLatestCandidateAnswer, saveCandidateAnswer, mergeMessagesInWindow, isLatestMessageFromCandidate, deduplicateSentencesInText, isDuplicateAnswer } from './answer-collector'
import { scoreAnswer, saveScoreResult } from './scorer'
import { detectResumeSent, downloadResume, detectResumeCard, clickResumeAcceptButton, downloadResumeFromCard } from './resume-handler'
import { sendResumeEmail, startEmailScheduler, getCandidatesByStatus } from './email-sender'
import { isAnswerTimeout, shouldSendNextRound } from './status-manager'
import { randomDelay, canSendMessage, recordMessageSent, getRiskControlConfig, isWithinWorkHours } from './risk-control'
import {
  saveInterviewCandidate,
  getInterviewCandidate,
  getInterviewJobPositionWithDetails,
  updateInterviewCandidateStatus,
  getInterviewQaRecordList,
  saveInterviewOperationLog,
  getPendingInterviewCandidates
} from '@geekgeekrun/sqlite-plugin/handlers'
import { InterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在退出')
  process.exit(0)
})

export const pageMapByName: {
  boss?: Page | null
} = {}

let browser: Browser | null = null
let dataSource: DataSource | null = null

// 初始化数据库
const dbInitPromise = initDb(getPublicDbFilePath())

// 获取面试配置
function getInterviewConfig() {
  const raw = readConfigFile('boss.json')?.interview ?? {}
  return {
    scanIntervalSeconds: Number(raw.scanIntervalSeconds) || 10,
    autoSend: raw.autoSend === true,
    maxRounds: Number(raw.maxRounds) || 3,
    defaultTimeoutMinutes: Number(raw.defaultTimeoutMinutes) || 60
  }
}

const mainLoop = async () => {
  console.log('[Interview MainLoop] 开始执行...')

  if (browser) {
    try {
      const cp = browser.process()
      cp?.kill('SIGKILL')
    } catch {
      //
    } finally {
      browser = null
    }
  }

  // 启动浏览器
  console.log('[Interview MainLoop] 正在启动浏览器...')
  browser = await bootstrap()
  console.log('[Interview MainLoop] 浏览器已启动')

  // 检查 cookie
  let bossCookies = readStorageFile('boss-cookies.json')
  let cookieCheckResult = checkCookieListFormat(bossCookies)
  console.log('[Interview MainLoop] Cookie 检查结果:', cookieCheckResult)

  if (!cookieCheckResult) {
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: { id: 'basic-cookie-check', status: 'pending' },
        runRecordId
      }
    })
  } else {
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: { id: 'basic-cookie-check', status: 'fulfilled' },
        runRecordId
      }
    })
  }

  // 导航到 BOSS 直聘
  await launchBoss(browser!)

  await sleep(1000)
  pageMapByName.boss!.bringToFront()
  await sleep(2000)

  // 检查当前页面 URL
  const currentPageUrl = pageMapByName.boss!.url() ?? ''

  // 登录状态检查
  if (currentPageUrl.startsWith('https://www.zhipin.com/web/user/') || !cookieCheckResult) {
    writeStorageFile('boss-cookies.json', [])

    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: { id: 'login-status-check', status: 'pending' },
        runRecordId
      }
    })

    try {
      await loginWithCookieAssistant()
      const newCookies = readStorageFile('boss-cookies.json')
      const newLocalStorage = readStorageFile('boss-local-storage.json')

      for (const cookie of newCookies) {
        await pageMapByName.boss!.setCookie(cookie)
      }

      await pageMapByName.boss!.reload({ waitUntil: 'networkidle2' })
      await sleep(2000)

      const newPageUrl = pageMapByName.boss!.url() ?? ''
      if (newPageUrl.startsWith('https://www.zhipin.com/web/user/')) {
        throw new Error('LOGIN_STATUS_INVALID')
      }
    } catch (e: any) {
      if (e?.message === 'USER_CANCELLED_LOGIN') {
        await dialog.showMessageBox({
          type: 'error',
          message: '登录已取消',
          detail: '请重新运行任务并完成登录'
        })
      }
      sendToDaemon({
        type: 'worker-to-gui-message',
        data: {
          type: 'prerequisite-step-by-step-checkstep-by-step-check',
          step: { id: 'login-status-check', status: 'rejected' },
          runRecordId
        }
      })
      throw new Error('LOGIN_STATUS_INVALID')
    }
  }

  sendToDaemon({
    type: 'worker-to-gui-message',
    data: {
      type: 'prerequisite-step-by-step-checkstep-by-step-check',
      step: { id: 'login-status-check', status: 'fulfilled' },
      runRecordId
    }
  })

  // 点击聊天菜单
  console.log('[Interview MainLoop] 尝试点击聊天菜单...')
  try {
    const chatMenuClicked = await pageMapByName.boss!.evaluate(() => {
      const chatMenu = document.querySelector('.menu-chat') as HTMLElement
      if (chatMenu) {
        chatMenu.click()
        return true
      }
      return false
    })
    if (chatMenuClicked) {
      await sleep(2000)
    }
  } catch (e) {
    console.log('[Interview MainLoop] 点击聊天菜单失败:', e)
  }

  const cfg = getInterviewConfig()
  const riskConfig = await getRiskControlConfig(dataSource!)

  // 主循环
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // 检查工作时间
      if (!isWithinWorkHours(riskConfig)) {
        console.log('[Interview MainLoop] 不在工作时间，等待...')
        await sleep(60000)
        continue
      }

      // 【新增】主动点击未读tab筛选
      console.log('[Interview MainLoop] 尝试点击未读tab...')
      const unreadTabClicked = await clickUnreadTab(pageMapByName.boss!)
      if (unreadTabClicked) {
        console.log('[Interview MainLoop] 已切换到未读消息列表')

        // 【新增】滚动加载全部未读消息
        await scrollToLoadAllUnread(pageMapByName.boss!)
      } else {
        console.log('[Interview MainLoop] 未找到未读tab，继续使用当前列表')
      }

      // 获取聊天列表
      let friendListData = await getChatList(pageMapByName.boss!)
      console.log('[Interview MainLoop] 聊天列表数量:', friendListData?.length)

      // 【修改】筛选出有红色角标（未读消息）的聊天项
      let unreadItems = friendListData?.filter(item => Number(item.unreadCount) > 0) || []
      console.log('[Interview MainLoop] 当前未读消息数量:', unreadItems.length)

      // 【修改】如果当前没有未读消息，滚动到底部寻找更多
      if (unreadItems.length === 0) {
        console.log('[Interview MainLoop] 当前无未读消息，滚动到底部寻找...')

        let lastItemCount = friendListData?.length || 0
        let scrollAttempts = 0
        const maxScrollAttempts = 10 // 最大滚动次数

        while (scrollAttempts < maxScrollAttempts) {
          // 滚动到底部（向下滚动）
          await pageMapByName.boss!.evaluate(() => {
            const chatList = document.querySelector('.chat-list') ||
                            document.querySelector('[class*="chat-list"]') ||
                            document.querySelector('[role="list"]')
            if (chatList) {
              // 向下滚动到底部
              chatList.scrollTop = chatList.scrollHeight
            }
          })

          await sleep(800) // 等待加载

          // 再次获取聊天列表
          const newListData = await getChatList(pageMapByName.boss!)

          // 检查是否有新的聊天项出现
          const newItemCount = newListData?.length || 0
          console.log(`[Interview MainLoop] 滚动后列表数量: ${newItemCount}, 之前: ${lastItemCount}`)

          // 如果滚动后没有新项出现，停止寻找
          if (newItemCount <= lastItemCount) {
            console.log('[Interview MainLoop] 滚动后无新项出现，停止寻找')
            break
          }

          // 更新列表并检查是否有未读消息
          friendListData = newListData
          unreadItems = newListData?.filter(item => Number(item.unreadCount) > 0) || []

          // 如果找到未读消息，停止滚动
          if (unreadItems.length > 0) {
            console.log('[Interview MainLoop] 滚动后发现未读消息，数量:', unreadItems.length)
            break
          }

          lastItemCount = newItemCount
          scrollAttempts++
          console.log(`[Interview MainLoop] 滚动尝试 ${scrollAttempts}/${maxScrollAttempts}`)
        }

        // 如果滚动后仍无未读消息，等待下一个周期
        if (unreadItems.length === 0) {
          console.log('[Interview MainLoop] 滚动后仍未发现未读消息，等待下一周期...')
          await sleep(cfg.scanIntervalSeconds * 1000)
          continue
        }
      }

      // 【修改】只处理有红色角标的聊天项
      for (const targetChat of unreadItems) {
        // 检查最后一条是否是自己发的
        if (targetChat.lastIsSelf) {
          continue
        }

        console.log('[Interview MainLoop] 处理候选人:', targetChat.name)

        // 【修改】通过聊天项的标识点击
        await clickChatItemByIdentifier(pageMapByName.boss!, targetChat)
        await sleep(2000)

        // 获取候选人信息
        const geekInfo = await getCurrentChatGeekInfo(pageMapByName.boss!)
        const encryptGeekId = geekInfo?.encryptGeekId || targetChat.encryptGeekId || ''
        const geekName = geekInfo?.name || targetChat.name || ''
        const encryptJobId = targetChat.encryptJobId || ''

        if (!encryptGeekId) {
          console.log('[Interview MainLoop] 无法获取候选人ID，跳过')
          continue
        }

        // 匹配岗位
        const matchResult = await matchJobPositionByName(dataSource!, targetChat.jobName || '')
        if (!matchResult.matched || !matchResult.jobPosition) {
          console.log('[Interview MainLoop] 岗位不匹配:', matchResult.reason)
          continue
        }

        const jobPosition = matchResult.jobPosition

        // 获取或创建候选人记录
        let candidate = await getInterviewCandidate(dataSource!, encryptGeekId, encryptJobId)

        if (!candidate) {
          candidate = await saveInterviewCandidate(dataSource!, {
            encryptGeekId,
            geekName,
            encryptJobId,
            jobName: targetChat.jobName,
            jobPositionId: jobPosition.id,
            status: InterviewCandidateStatus.NEW,
            firstContactAt: new Date()
          })
          console.log('[Interview MainLoop] 创建候选人记录:', candidate.id)
        }

        // 根据状态处理
        await handleCandidateByStatus(dataSource!, pageMapByName.boss!, candidate, jobPosition, cfg)

        // 风控延迟
        await randomDelay()
      }

      // 【新增】处理完未读消息后，遍历已请求简历的候选人检查简历
      console.log('[Interview MainLoop] ========================================')
      console.log('[Interview MainLoop] 处理完未读消息，开始检查待下载简历...')
      console.log('[Interview MainLoop] ========================================')
      await checkAndDownloadPendingResumes(dataSource!, pageMapByName.boss!)
      console.log('[Interview MainLoop] 简历检查完成')

      // 【关键修复】主动检查等待回复的候选人（不依赖未读角标）
      // 解决问题：如果未读角标被清除，候选人不会出现在 unreadItems 中，导致回答不被收集
      console.log('[Interview MainLoop] ========================================')
      console.log('[Interview MainLoop] 开始主动检查等待回复的候选人...')
      console.log('[Interview MainLoop] ========================================')
      await checkWaitingCandidatesForReply(dataSource!, pageMapByName.boss!, cfg)
      console.log('[Interview MainLoop] 等待回复候选人检查完成，等待下一轮扫描...')

      // 等待下一轮扫描
      await sleep(cfg.scanIntervalSeconds * 1000)

    } catch (error) {
      console.error('[Interview MainLoop] 处理出错:', error)
      await saveInterviewOperationLog(dataSource!, {
        action: 'main_loop_error',
        errorMessage: String(error)
      })
      await sleep(5000)
    }
  }
}

/**
 * 根据状态处理候选人
 * 新逻辑：
 * 1. 使用问题轮次的 keywords 和 llmPrompt 配置
 * 2. 30秒时间窗口合并消息
 * 3. 固定权重评分（关键词 0.7 + LLM 0.3）
 */
async function handleCandidateByStatus(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate,
  jobPosition: any,
  config: any
) {
  const status = candidate.status

  switch (status) {
    case InterviewCandidateStatus.NEW:
      // 发送第一轮问题
      await sendFirstRoundQuestion(ds, page, candidate, jobPosition)
      break

    case InterviewCandidateStatus.WAITING_ROUND_1:
    case InterviewCandidateStatus.WAITING_ROUND_2:
    case InterviewCandidateStatus.WAITING_ROUND_N:
      // 【关键修复1】先检查候选人是否刚被评分过，避免重复进入评分流程
      // 如果 lastScoredAt 在最近30秒内，说明刚评分过，跳过
      if (candidate.lastScoredAt) {
        const lastScoredTime = new Date(candidate.lastScoredAt).getTime()
        const now = Date.now()
        const thirtySecondsAgo = now - 30 * 1000
        if (lastScoredTime >= thirtySecondsAgo) {
          console.log(`[Interview MainLoop] 候选人刚在 ${Math.round((now - lastScoredTime) / 1000)} 秒前被评分过，跳过`)
          break
        }
      }

      // 检查最新消息是否来自候选人
      const isFromCandidate = await isLatestMessageFromCandidate(page)
      if (!isFromCandidate) {
        console.log('[Interview MainLoop] 最新消息不是候选人发送的，跳过')
        break
      }

      // 【关键修复2】检查问答记录是否已评分，避免重复评分
      const qaRepoCheck = ds.getRepository('InterviewQaRecord')
      const existingQARecord = await qaRepoCheck.findOne({
        where: { candidateId: candidate.id, roundNumber: candidate.currentRound }
      })

      // 如果记录已存在且已评分（scoredAt不为空），跳过本轮评分
      if (existingQARecord && existingQARecord.scoredAt) {
        console.log(`[Interview MainLoop] 第${candidate.currentRound}轮已评分（scoredAt: ${existingQARecord.scoredAt}），跳过重复评分`)
        break
      }

      // 合并30秒窗口内的消息
      const { mergedText: rawMergedText } = await mergeMessagesInWindow(page, candidate, 30)
      if (!rawMergedText) {
        console.log('[Interview MainLoop] 未找到候选人回复内容')
        break
      }

      // 【新增】对回答文本内部重复句子进行去重
      const mergedText = deduplicateSentencesInText(rawMergedText)
      console.log('[Interview MainLoop] 合并回复(去重后):', mergedText.substring(0, 100))

      // 【新增】检查是否与已有记录重复（同一问题相同回答）
      const isDup = await isDuplicateAnswer(ds, candidate.id!, candidate.currentRound, mergedText)
      if (isDup) {
        console.log('[Interview MainLoop] 回答内容与已有记录重复，跳过评分和保存')
        break
      }

      // 获取问题轮次配置
      const questionRound = jobPosition.questionRounds?.find((r: any) => r.roundNumber === candidate.currentRound)
      if (!questionRound) {
        console.log('[Interview MainLoop] 未找到当前轮次配置')
        break
      }

      // 评分（使用新的评分逻辑）
      const scoreResult = await scoreAnswer(
        ds,
        candidate,
        questionRound.questionText,
        mergedText,
        questionRound,
        jobPosition.passThreshold
      )

      // 保存问答记录（含评分）- 复用之前的查询结果 existingQARecord
      const qaRepo = ds.getRepository('InterviewQaRecord')

      if (existingQARecord) {
        // 记录已存在，更新评分信息
        await qaRepo.update(existingQARecord.id!, {
          answerText: mergedText,
          answeredAt: new Date(),
          keywordScore: scoreResult.keywordScore,
          llmScore: scoreResult.llmScore,
          totalScore: scoreResult.totalScore,
          llmReason: scoreResult.llmReason,
          matchedKeywords: JSON.stringify(scoreResult.matchedKeywords),
          scoredAt: new Date()
        })
      } else {
        // 记录不存在，创建新记录（使用 upsert 确保唯一性）
        await qaRepo.save(qaRepo.create({
          candidateId: candidate.id,
          roundNumber: candidate.currentRound,
          questionText: questionRound.questionText,
          answerText: mergedText,
          answeredAt: new Date(),
          questionSentAt: candidate.lastQuestionAt,
          keywordScore: scoreResult.keywordScore,
          llmScore: scoreResult.llmScore,
          totalScore: scoreResult.totalScore,
          llmReason: scoreResult.llmReason,
          matchedKeywords: JSON.stringify(scoreResult.matchedKeywords),
          scoredAt: new Date()
        }))
      }

      // 更新候选人得分和已评分时间（关键：避免重复评分同一条消息）
      const candRepo = ds.getRepository('InterviewCandidate')
      await candRepo.update(candidate.id!, {
        totalScore: scoreResult.totalScore,
        keywordScore: scoreResult.keywordScore,
        llmScore: scoreResult.llmScore,
        llmReason: scoreResult.llmReason,
        lastReplyAt: new Date(),
        lastScoredAt: new Date()  // 记录已评分时间，避免重复评分
      })

      console.log(`[Interview MainLoop] 评分结果: ${scoreResult.totalScore}分, 通过: ${scoreResult.passed}`)

      if (scoreResult.passed) {
        // 检查是否有下一轮
        const { hasNext, nextRound } = await shouldSendNextRound(ds, candidate)

        if (hasNext && nextRound) {
          // 发送下一轮问题
          await sendInterviewQuestion(ds, page, candidate, nextRound)
        } else {
          // 全部通过，发送简历交换请求（点击"求简历"按钮）
          const resumeExchangeSuccess = await sendResumeExchangeRequest(ds, page, candidate)
          if (!resumeExchangeSuccess) {
            // 如果点击按钮失败，回退到发送文本消息方式
            console.log('[Interview MainLoop] 点击"求简历"按钮失败，回退到发送文本消息')
            const inviteText = jobPosition.resumeInviteText || '您好！感谢您的回复。我们对您的背景很感兴趣，能否发送一份您的简历？'
            await sendResumeRequest(ds, page, candidate, inviteText)
          }
        }
      } else {
        // 未通过，发送拒绝消息
        await sendRejectionMessage(ds, page, candidate)
        await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.REJECTED)
      }
      break

    case InterviewCandidateStatus.RESUME_REQUESTED:
      // 检查候选人是否发送了简历卡片（带"同意"按钮）
      console.log('[Interview MainLoop] 检查候选人是否发送简历卡片...')
      const resumeCardResult = await detectResumeCard(page)

      if (resumeCardResult.hasCard) {
        console.log('[Interview MainLoop] 发现候选人发送的简历卡片，准备点击同意按钮...')

        // 点击简历卡片上的"同意"按钮
        const acceptResult = await clickResumeAcceptButton(page)

        if (acceptResult.success) {
          console.log('[Interview MainLoop] 已点击同意按钮，等待简历卡片出现...')
          // 等待1秒让简历卡片出现在聊天界面
          await sleep(1000)

          // 更新状态为 RESUME_AGREED
          await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.RESUME_AGREED, {
            lastReplyAt: new Date()
          })
          console.log('[Interview MainLoop] 状态更新为 RESUME_AGREED')

          // 继续处理：尝试下载简历
          console.log('[Interview MainLoop] 检查简历是否可下载...')
          const resumeDetection = await detectResumeSent(page)
          if (resumeDetection.hasResume) {
            console.log('[Interview MainLoop] 简历卡片已出现，开始下载...')
            const resumePath = await downloadResumeFromCard(ds, page, candidate)
            if (resumePath) {
              console.log('[Interview MainLoop] ★★★ 简历下载成功:', resumePath)
              // 发送邮件
              await sendResumeEmail(ds, candidate, resumePath)
            } else {
              console.log('[Interview MainLoop] 简历下载失败，将在下一轮继续尝试')
            }
          }
        } else {
          console.log('[Interview MainLoop] 点击同意按钮失败:', acceptResult.message)
        }
      } else {
        console.log('[Interview MainLoop] 候选人尚未发送简历卡片，继续等待')
      }
      break

    case InterviewCandidateStatus.RESUME_AGREED:
      // 已点击同意，检查简历是否可下载
      console.log('[Interview MainLoop] 检查简历下载状态...')
      const resumeDownloadCheck = await detectResumeSent(page)
      if (resumeDownloadCheck.hasResume) {
        const resumePath = await downloadResumeFromCard(ds, page, candidate)
        if (resumePath) {
          console.log('[Interview MainLoop] ★★★ 简历下载成功:', resumePath)
          // 发送邮件
          await sendResumeEmail(ds, candidate, resumePath)
        }
      } else {
        console.log('[Interview MainLoop] 简历尚未可下载，继续等待')
      }
      break

    default:
      console.log('[Interview MainLoop] 候选人状态:', status)
  }
}

/**
 * 发送第一轮问题
 */
async function sendFirstRoundQuestion(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate,
  jobPosition: any
) {
  const firstRound = jobPosition.questionRounds?.find((r: any) => r.roundNumber === 1)
  if (!firstRound) {
    console.log('[Interview MainLoop] 没有配置第一轮问题')
    return
  }

  // 检查是否可以发送消息
  const canSend = await canSendMessage(ds)
  if (!canSend.allowed) {
    console.log('[Interview MainLoop] 发送消息受限:', canSend.reason)
    return
  }

  const success = await sendInterviewQuestion(ds, page, candidate, firstRound)
  if (success) {
    recordMessageSent()
  }
}

/**
 * 获取聊天列表
 */
async function getChatList(page: Page): Promise<ChatListItem[]> {
  try {
    const friendListData = await page.evaluate(() => {
      const geekItems = document.querySelectorAll('[role="listitem"]')

      return [...geekItems].map(el => {
        const geekItem = el.querySelector('.geek-item') || el
        const textContent = geekItem?.innerText || el.innerText || ''
        const textLines = textContent.split('\n').filter(line => line.trim())

        let name = ''
        let time = ''
        let lastText = ''
        let unreadCount = 0
        let jobName = ''

        if (textLines.length >= 4) {
          const firstLine = textLines[0]
          const secondLine = textLines[1]

          if (/^\d+$/.test(firstLine) && textLines.length >= 5) {
            unreadCount = parseInt(firstLine) || 0
            time = secondLine || ''
            name = textLines[2] || ''
            jobName = textLines[3] || ''
            lastText = textLines.slice(4).join('\n') || ''
          } else {
            time = firstLine || ''
            name = textLines[1] || ''
            jobName = textLines[2] || ''
            lastText = textLines.slice(3).join('\n') || ''
          }
        }

        const keyId = el.getAttribute('key') || geekItem?.getAttribute('data-id') || ''

        const vue = geekItem.__vue__ || el.__vue__
        const props = vue?._props || vue?.$props || vue?.props || {}
        const data = props.geek || props.item || props.message || props.user || props.data || props.row || {}

        return {
          name: name || data.name || data.geekName || '',
          encryptGeekId: keyId || data.encryptGeekId || '',
          unreadCount: unreadCount || data.unreadCount || data.newMsgCount || 0,
          lastIsSelf: data.isSelf === true || data.lastIsSelf === true,
          lastText: lastText || data.lastText || '',
          time: time || data.time || '',
          jobName: jobName || data.jobName || '',
          encryptJobId: data.encryptJobId || ''
        }
      })
    })

    return friendListData
  } catch (error) {
    console.error('[Interview MainLoop] 获取聊天列表失败:', error)
    return []
  }
}

/**
 * 点击聊天项
 */
async function clickChatItem(page: Page, index: number) {
  try {
    await page.evaluate((idx) => {
      const items = document.querySelectorAll('[role="listitem"]')
      if (items[idx]) {
        const geekItem = items[idx].querySelector('.geek-item')
        if (geekItem) {
          ;(geekItem as HTMLElement).click()
        } else {
          ;(items[idx] as HTMLElement).click()
        }
      }
    }, index)
  } catch (error) {
    console.error('[Interview MainLoop] 点击聊天项失败:', error)
  }
}

/**
 * 【新增】通过标识点击聊天项
 * 根据候选人名称或ID定位并点击聊天项
 */
async function clickChatItemByIdentifier(page: Page, chatItem: any) {
  try {
    const clicked = await page.evaluate((item) => {
      const items = document.querySelectorAll('[role="listitem"]')

      for (const el of items) {
        const geekItem = el.querySelector('.geek-item') || el
        const textContent = geekItem?.textContent || ''

        // 通过名称匹配
        if (item.name && textContent.includes(item.name)) {
          ;(geekItem as HTMLElement).click()
          return true
        }

        // 通过Vue组件数据匹配
        const vue = (geekItem as any).__vue__ || (el as any).__vue__
        const props = vue?._props || vue?.$props || vue?.props || {}
        const data = props.geek || props.item || props.message || props.user || props.data || {}

        if (item.encryptGeekId && data.encryptGeekId === item.encryptGeekId) {
          ;(geekItem as HTMLElement).click()
          return true
        }
      }

      return false
    }, chatItem)

    if (!clicked) {
      console.log('[Interview MainLoop] 未找到匹配的聊天项，尝试点击第一个有未读角标的项')
      // 备用方案：点击第一个有未读角标的项
      await page.evaluate(() => {
        const items = document.querySelectorAll('[role="listitem"]')
        for (const el of items) {
          const geekItem = el.querySelector('.geek-item') || el
          // 检查是否有未读角标
          const badge = geekItem.querySelector('[class*="unread"]') ||
                        geekItem.querySelector('[class*="badge"]') ||
                        geekItem.querySelector('[class*="dot"]')
          if (badge) {
            ;(geekItem as HTMLElement).click()
            return
          }
        }
      })
    }
  } catch (error) {
    console.error('[Interview MainLoop] 通过标识点击聊天项失败:', error)
  }
}

/**
 * 点击"未读"筛选tab
 * 主动切换到未读消息列表
 */
async function clickUnreadTab(page: Page): Promise<boolean> {
  try {
    const clicked = await page.evaluate(() => {
      // 尝试多种可能的选择器
      const selectors = [
        '.unread-tab',
        '[class*="unread"]',
        'li[data-tab="unread"]',
        'div[data-type="unread"]',
        '.tab-item[data-key="unread"]',
        'span[class*="unread"]',
        'button[class*="unread"]'
      ]

      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (el && (el as HTMLElement).click) {
          ;(el as HTMLElement).click()
          console.log('[Interview MainLoop] 成功点击未读tab:', selector)
          return true
        }
      }

      // 尝试通过文本内容查找
      const allTabs = document.querySelectorAll('li, span, div, button')
      for (const tab of allTabs) {
        const text = tab.textContent?.trim()
        if (text === '未读' || text === '未读消息' || text.includes('未读')) {
          ;(tab as HTMLElement).click()
          console.log('[Interview MainLoop] 通过文本找到未读tab')
          return true
        }
      }

      return false
    })

    if (clicked) {
      await sleep(1500) // 等待列表刷新
    }

    return clicked
  } catch (error) {
    console.error('[Interview MainLoop] 点击未读tab失败:', error)
    return false
  }
}

/**
 * 滚动加载全部未读消息
 * 持续滚动直到所有未读消息都加载出来
 */
async function scrollToLoadAllUnread(page: Page): Promise<void> {
  try {
    let lastCount = 0
    let scrollAttempts = 0
    const maxScrollAttempts = 10 // 最大滚动次数，避免无限滚动

    while (scrollAttempts < maxScrollAttempts) {
      // 获取当前聊天列表数量
      const currentCount = await page.evaluate(() => {
        const items = document.querySelectorAll('[role="listitem"]')
        return items.length
      })

      console.log(`[Interview MainLoop] 当前聊天项数量: ${currentCount}`)

      // 如果数量不再增加，说明已加载全部
      if (currentCount === lastCount) {
        console.log('[Interview MainLoop] 已加载全部未读消息')
        break
      }

      lastCount = currentCount

      // 滚动聊天列表
      await page.evaluate(() => {
        const chatList = document.querySelector('.chat-list') ||
                        document.querySelector('[class*="chat-list"]') ||
                        document.querySelector('[role="list"]')

        if (chatList) {
          chatList.scrollTop = chatList.scrollHeight
        }
      })

      await sleep(500) // 等待加载
      scrollAttempts++
    }

    console.log(`[Interview MainLoop] 滚动加载完成，共滚动 ${scrollAttempts} 次`)
  } catch (error) {
    console.error('[Interview MainLoop] 滚动加载失败:', error)
  }
}

const rerunInterval = (() => {
  let v = Number(process.env.MAIN_BOSSGEEKGO_RERUN_INTERVAL)
  if (isNaN(v)) {
    v = 3000
  }
  return v
})()

const runRecordId = minimist(process.argv.slice(2))['run-record-id'] ?? null

export async function runEntry() {
  console.log('[Interview runEntry] 开始执行...')
  app.dock?.hide()
  await app.whenReady()
  console.log('[Interview runEntry] app ready')
  app.on('window-all-closed', (e) => {
    e.preventDefault()
  })
  initPublicIpc()
  await connectToDaemon()
  console.log('[Interview runEntry] 已连接到 daemon')

  sendToDaemon({
    type: 'worker-to-gui-message',
    data: {
      type: 'prerequisite-step-by-step-checkstep-by-step-check',
      step: { id: 'worker-launch', status: 'fulfilled' },
      runRecordId
    }
  })

  console.log('[Interview runEntry] 正在检查浏览器...')
  let puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  console.log('[Interview runEntry] 浏览器检查结果:', puppeteerExecutable ? puppeteerExecutable.executablePath : 'null')

  if (!puppeteerExecutable) {
    try {
      await configWithBrowserAssistant({ autoFind: true })
    } catch (e) {
      console.error('[Interview runEntry] 浏览器配置失败:', e)
    }
    puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  }

  if (!puppeteerExecutable) {
    await dialog.showMessageBox({
      type: 'error',
      message: '未找到可用的浏览器',
      detail: '请重新运行本程序，按照提示安装、配置浏览器'
    })
    throw new Error('PUPPETEER_IS_NOT_EXECUTABLE')
  }

  process.env.PUPPETEER_EXECUTABLE_PATH = puppeteerExecutable.executablePath

  // 初始化数据库
  console.log('[Interview runEntry] 正在初始化数据库...')
  try {
    dataSource = await dbInitPromise
    console.log('[Interview runEntry] 数据库初始化成功')
    // 初始化面试 IPC handlers
    initInterviewIpcHandlers(dataSource)
    console.log('[Interview runEntry] IPC handlers 已初始化')
  } catch (dbErr) {
    console.error('[Interview runEntry] 数据库初始化失败:', dbErr)
  }

  console.log('[Interview runEntry] 开始执行 mainLoop...')
  while (true) {
    try {
      await mainLoop()
    } catch (err) {
      console.error(err)
      try {
        await pageMapByName['boss']?.close()
      } catch {
        //
      }

      const shouldExit = await checkShouldExit()
      if (shouldExit) {
        app.exit()
        return
      }

      if (err instanceof Error) {
        if (err.message.includes('LOGIN_STATUS_INVALID')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_INVALID)
          break
        }
        if (err.message.includes('ERR_INTERNET_DISCONNECTED')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ERR_INTERNET_DISCONNECTED)
          break
        }
      }
    } finally {
      pageMapByName['boss'] = null
      await sleep(rerunInterval)
    }
  }

  process.exit(0)
}

/**
 * 【新增】检查并下载待处理的简历
 * 遍历已请求简历的候选人（RESUME_REQUESTED 或 RESUME_AGREED 状态）
 * 检查本地文件是否已有简历，如果没有则尝试下载
 */
async function checkAndDownloadPendingResumes(
  ds: DataSource,
  page: Page
): Promise<void> {
  try {
    console.log('[ResumeCheck] ========================================')
    console.log('[ResumeCheck] 开始查询待处理简历的候选人...')
    console.log('[ResumeCheck] 查询条件: status = RESUME_REQUESTED 或 RESUME_AGREED')

    // 查询状态为 RESUME_REQUESTED 或 RESUME_AGREED 的候选人
    const candidateRepo = ds.getRepository('InterviewCandidate')
    const pendingCandidates = await candidateRepo.find({
      where: [
        { status: InterviewCandidateStatus.RESUME_REQUESTED },
        { status: InterviewCandidateStatus.RESUME_AGREED }
      ],
      order: { updatedAt: 'ASC' }
    })

    if (!pendingCandidates || pendingCandidates.length === 0) {
      console.log('[ResumeCheck] 查询结果: 没有待处理简历的候选人')
      console.log('[ResumeCheck] ========================================')
      return
    }

    console.log(`[ResumeCheck] 查询结果: 找到 ${pendingCandidates.length} 个待处理简历的候选人`)
    pendingCandidates.forEach((c, i) => {
      console.log(`[ResumeCheck]   ${i + 1}. ${c.geekName} (状态: ${c.status})`)
    })
    console.log('[ResumeCheck] ========================================')

    // 获取简历存储目录
    const resumeDir = path.join(app.getPath('userData'), 'interview-resumes')
    console.log(`[ResumeCheck] 简历存储目录: ${resumeDir}`)

    for (const candidate of pendingCandidates) {
      console.log(`[ResumeCheck] ----------------------------------------`)
      console.log(`[ResumeCheck] 处理候选人: ${candidate.geekName} (ID: ${candidate.encryptGeekId})`)
      console.log(`[ResumeCheck] 当前状态: ${candidate.status}`)

      // 检查本地文件是否已有简历
      const existingFiles = fs.readdirSync(resumeDir).filter(f =>
        f.includes(candidate.geekName) ||
        (candidate.encryptGeekId && f.includes(candidate.encryptGeekId))
      )

      if (existingFiles.length > 0) {
        console.log(`[ResumeCheck] 本地已有简历文件: ${existingFiles.join(', ')}`)
        console.log(`[ResumeCheck] 跳过下载，继续下一个候选人`)
        continue
      }

      console.log(`[ResumeCheck] 本地无简历文件，开始查找聊天...`)

      // 在聊天列表中找到该候选人
      console.log(`[ResumeCheck] 正在获取聊天列表...`)
      const chatList = await getChatList(page)
      console.log(`[ResumeCheck] 聊天列表数量: ${chatList?.length || 0}`)

      const targetChat = chatList?.find(item =>
        item.name === candidate.geekName ||
        (candidate.encryptGeekId && item.encryptGeekId === candidate.encryptGeekId)
      )

      if (!targetChat) {
        console.log(`[ResumeCheck] 未在聊天列表中找到候选人 ${candidate.geekName}`)
        console.log(`[ResumeCheck] 可能原因: 聊天列表未加载完全或候选人不在列表中`)
        continue
      }

      console.log(`[ResumeCheck] 找到聊天项，准备点击进入...`)

      // 点击进入聊天
      await clickChatItemByIdentifier(page, targetChat)
      await sleep(2000)

      console.log(`[ResumeCheck] 已进入聊天，检测简历消息...`)

      // 检测是否有简历消息
      const resumeDetection = await detectResumeSent(page)
      console.log(`[ResumeCheck] 简历检测结果: hasResume=${resumeDetection.hasResume}, resumeUrl=${resumeDetection.resumeUrl ? '有' : '无'}`)

      if (resumeDetection.hasResume) {
        console.log(`[ResumeCheck] ★★★ 检测到简历消息！开始下载... ★★★`)

        if (resumeDetection.resumeUrl) {
          // 下载简历
          console.log(`[ResumeCheck] 使用URL下载简历...`)
          const resumePath = await downloadResume(ds, page, candidate, resumeDetection.resumeUrl)
          if (resumePath) {
            console.log(`[ResumeCheck] ★★★ 简历下载成功: ${resumePath} ★★★`)
          } else {
            console.log(`[ResumeCheck] 简历下载失败`)
          }
        } else {
          // 没有直接的下载链接，尝试点击简历卡片下载
          console.log(`[ResumeCheck] 没有直接URL，尝试点击简历卡片下载...`)
          const downloaded = await tryDownloadResumeFromCard(page, candidate, ds)
          if (downloaded) {
            console.log(`[ResumeCheck] ★★★ 通过点击简历卡片下载成功 ★★★`)
          } else {
            console.log(`[ResumeCheck] 点击简历卡片下载失败`)
          }
        }
      } else {
        console.log(`[ResumeCheck] 候选人尚未发送简历，继续等待...`)
      }

      // 风控延迟
      console.log(`[ResumeCheck] 等待风控延迟...`)
      await randomDelay()
    }

    console.log('[ResumeCheck] ========================================')
    console.log('[ResumeCheck] 所有待处理简历检查完成')
    console.log('[ResumeCheck] ========================================')
  } catch (error) {
    console.error('[ResumeCheck] 检查待处理简历失败:', error)
  }
}

/**
 * 【关键修复】主动检查等待回复的候选人
 * 不依赖未读角标机制，直接查询数据库中的 WAITING 状态候选人
 * 解决问题：如果未读角标被清除，候选人不会出现在 unreadItems 中，导致回答不被收集
 */
async function checkWaitingCandidatesForReply(
  ds: DataSource,
  page: Page,
  config: any
): Promise<void> {
  try {
    console.log('[WaitingCheck] 查询状态为 WAITING 的候选人...')

    // 查询状态为 WAITING 的候选人
    const waitingCandidates = await getPendingInterviewCandidates(ds, [
      InterviewCandidateStatus.WAITING_ROUND_1,
      InterviewCandidateStatus.WAITING_ROUND_2,
      InterviewCandidateStatus.WAITING_ROUND_N
    ])

    if (!waitingCandidates || waitingCandidates.length === 0) {
      console.log('[WaitingCheck] 查询结果: 没有等待回复的候选人')
      console.log('[WaitingCheck] ========================================')
      return
    }

    console.log(`[WaitingCheck] 查询结果: 找到 ${waitingCandidates.length} 个等待回复的候选人`)
    waitingCandidates.forEach((c, i) => {
      console.log(`[WaitingCheck]   ${i + 1}. ${c.geekName} (状态: ${c.status}, 当前轮次: ${c.currentRound})`)
    })
    console.log('[WaitingCheck] ========================================')

    // 获取聊天列表
    console.log('[WaitingCheck] 正在获取聊天列表...')
    const chatList = await getChatList(page)
    console.log(`[WaitingCheck] 聊天列表数量: ${chatList?.length || 0}`)

    for (const candidate of waitingCandidates) {
      console.log(`[WaitingCheck] ----------------------------------------`)
      console.log(`[WaitingCheck] 处理候选人: ${candidate.geekName} (ID: ${candidate.encryptGeekId})`)
      console.log(`[WaitingCheck] 当前状态: ${candidate.status}, 当前轮次: ${candidate.currentRound}`)

      // 检查候选人是否刚被评分过，避免重复处理（30秒内评分过的跳过）
      if (candidate.lastScoredAt) {
        const lastScoredTime = new Date(candidate.lastScoredAt).getTime()
        const now = Date.now()
        const thirtySecondsAgo = now - 30 * 1000
        if (lastScoredTime >= thirtySecondsAgo) {
          console.log(`[WaitingCheck] 候选人刚在 ${Math.round((now - lastScoredTime) / 1000)} 秒前被评分过，跳过`)
          continue
        }
      }

      // 在聊天列表中查找该候选人
      const targetChat = chatList?.find(item =>
        item.name === candidate.geekName ||
        (candidate.encryptGeekId && item.encryptGeekId === candidate.encryptGeekId)
      )

      if (!targetChat) {
        console.log(`[WaitingCheck] 未在聊天列表中找到候选人 ${candidate.geekName}`)
        // 尝试滚动加载更多聊天项
        continue
      }

      console.log(`[WaitingCheck] 找到聊天项，准备点击进入...`)

      // 点击进入聊天
      await clickChatItemByIdentifier(page, targetChat)
      await sleep(2000)

      // 获取岗位配置
      const jobPosition = await getInterviewJobPositionWithDetails(ds, candidate.jobPositionId)
      if (!jobPosition) {
        console.log(`[WaitingCheck] 未找到岗位配置 (jobPositionId: ${candidate.jobPositionId})，跳过`)
        continue
      }

      // 调用 handleCandidateByStatus 检查是否有新回复
      console.log(`[WaitingCheck] 调用 handleCandidateByStatus 检查回复...`)
      await handleCandidateByStatus(ds, page, candidate, jobPosition, config)

      // 风控延迟
      console.log(`[WaitingCheck] 等待风控延迟...`)
      await randomDelay()
    }

    console.log('[WaitingCheck] ========================================')
    console.log('[WaitingCheck] 所有等待回复候选人检查完成')
    console.log('[WaitingCheck] ========================================')
  } catch (error) {
    console.error('[WaitingCheck] 检查等待回复候选人失败:', error)
  }
}

/**
 * 尝试通过点击简历卡片下载简历
 */
async function tryDownloadResumeFromCard(
  page: Page,
  candidate: any,
  ds: DataSource
): Promise<boolean> {
  try {
    console.log(`[ResumeCard] 尝试点击简历卡片下载...`)

    const clicked = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')

      // 查找简历卡片
      const resumeCardSelectors = [
        '[class*="resume-card"]',
        '[class*="resume-message"]',
        '[class*="attachment"]',
        '[class*="file-card"]'
      ]

      for (const selector of resumeCardSelectors) {
        const elements = chatConversation?.querySelectorAll(selector)
        if (elements && elements.length > 0) {
          // 点击最后一个（最新的）简历卡片
          const lastElement = elements[elements.length - 1] as HTMLElement
          lastElement.click()
          return true
        }
      }

      return false
    })

    if (clicked) {
      console.log(`[ResumeCard] 已点击简历卡片，等待下载...`)
      await sleep(3000)

      // 检查是否有下载的文件
      const resumeDir = path.join(app.getPath('userData'), 'interview-resumes')
      const files = fs.readdirSync(resumeDir).filter(f =>
        f.includes(candidate.geekName) ||
        f.endsWith('.pdf') ||
        f.endsWith('.doc') ||
        f.endsWith('.docx')
      )

      if (files.length > 0) {
        console.log(`[ResumeCard] 检测到下载的文件: ${files.join(', ')}`)
        // 更新候选人状态
        await updateInterviewCandidateStatus(ds, candidate.id, InterviewCandidateStatus.RESUME_RECEIVED)
        console.log(`[ResumeCard] 已更新候选人状态为 RESUME_RECEIVED`)
        return true
      } else {
        console.log(`[ResumeCard] 未检测到下载的文件`)
      }
    } else {
      console.log(`[ResumeCard] 未找到可点击的简历卡片`)
    }

    return false
  } catch (error) {
    console.error('[ResumeCard] 点击简历卡片失败:', error)
    return false
  }
}

process.once('uncaughtException', (error) => {
  console.error('uncaughtException', error)
  process.exit(1)
})

process.once('unhandledRejection', (error) => {
  console.log('unhandledRejection', error)
  process.exit(1)
})

process.once('disconnect', () => {
  process.exit(0)
})