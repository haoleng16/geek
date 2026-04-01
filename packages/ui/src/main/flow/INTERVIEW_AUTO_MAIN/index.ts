/**
 * 面试自动化系统 - 主入口
 *
 * 实现多轮面试自动化流程
 */

import minimist from 'minimist'
import { app, dialog } from 'electron'
import initPublicIpc from '../../utils/initPublicIpc'
import { connectToDaemon, sendToDaemon } from '../OPEN_SETTING_WINDOW/connect-to-daemon'
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
import { sendInterviewQuestion, sendResumeRequest, sendRejectionMessage } from './question-sender'
import { getLatestCandidateAnswer, saveCandidateAnswer, mergeMessagesInWindow, isLatestMessageFromCandidate } from './answer-collector'
import { scoreAnswer, saveScoreResult } from './scorer'
import { detectResumeSent, downloadResume } from './resume-handler'
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

      // 获取聊天列表
      const friendListData = await getChatList(pageMapByName.boss!)
      console.log('[Interview MainLoop] 聊天列表数量:', friendListData?.length)

      if (!friendListData || friendListData.length === 0) {
        console.log('[Interview MainLoop] 没有聊天项，等待...')
        await sleep(cfg.scanIntervalSeconds * 1000)
        continue
      }

      // 处理每个候选人
      for (let i = 0; i < friendListData.length; i++) {
        const targetChat = friendListData[i]

        // 检查是否有未读消息
        if (Number(targetChat.unreadCount) <= 0) {
          continue
        }

        // 检查最后一条是否是自己发的
        if (targetChat.lastIsSelf) {
          continue
        }

        console.log('[Interview MainLoop] 处理候选人:', targetChat.name)

        // 点击聊天项
        await clickChatItem(pageMapByName.boss!, i)
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
      // 检查最新消息是否来自候选人
      const isFromCandidate = await isLatestMessageFromCandidate(page)
      if (!isFromCandidate) {
        console.log('[Interview MainLoop] 最新消息不是候选人发送的，跳过')
        break
      }

      // 合并30秒窗口内的消息
      const { mergedText } = await mergeMessagesInWindow(page, candidate, 30)
      if (!mergedText) {
        console.log('[Interview MainLoop] 未找到候选人回复内容')
        break
      }

      console.log('[Interview MainLoop] 合并回复:', mergedText.substring(0, 100))

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

      // 保存问答记录（含评分）
      const qaRepo = ds.getRepository('InterviewQaRecord')
      const existingRecord = await qaRepo.findOne({
        where: { candidateId: candidate.id, roundNumber: candidate.currentRound }
      })

      if (existingRecord) {
        await qaRepo.update(existingRecord.id!, {
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

      // 更新候选人得分
      const candRepo = ds.getRepository('InterviewCandidate')
      await candRepo.update(candidate.id!, {
        totalScore: scoreResult.totalScore,
        keywordScore: scoreResult.keywordScore,
        llmScore: scoreResult.llmScore,
        llmReason: scoreResult.llmReason,
        lastReplyAt: new Date()
      })

      console.log(`[Interview MainLoop] 评分结果: ${scoreResult.totalScore}分, 通过: ${scoreResult.passed}`)

      if (scoreResult.passed) {
        // 检查是否有下一轮
        const { hasNext, nextRound } = await shouldSendNextRound(ds, candidate)

        if (hasNext && nextRound) {
          // 发送下一轮问题
          await sendInterviewQuestion(ds, page, candidate, nextRound)
        } else {
          // 全部通过，发送简历邀请（使用自定义话术）
          const inviteText = jobPosition.resumeInviteText || '您好！感谢您的回复。我们对您的背景很感兴趣，能否发送一份您的简历？'
          await sendResumeRequest(ds, page, candidate, inviteText)
        }
      } else {
        // 未通过，发送拒绝消息
        await sendRejectionMessage(ds, page, candidate)
        await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.REJECTED)
      }
      break

    case InterviewCandidateStatus.RESUME_REQUESTED:
      // 检查是否发送了简历
      const resumeDetection = await detectResumeSent(page)
      if (resumeDetection.hasResume && resumeDetection.resumeUrl) {
        // 下载简历
        const resumePath = await downloadResume(ds, page, candidate, resumeDetection.resumeUrl)
        if (resumePath) {
          // 发送邮件
          await sendResumeEmail(ds, candidate, resumePath)
        }
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