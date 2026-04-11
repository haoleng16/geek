/**
 * 面试自动化系统 - 主入口
 *
 * 实现多轮面试自动化流程
 */

import minimist from 'minimist'
import { app, dialog } from 'electron'
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
import type { ChatListItem } from '../boss-chat-utils'
import { getCurrentChatGeekInfo, getGeekEducationInfo, getGeekExperienceInfo } from '../RECRUITER_AUTO_REPLY_MAIN/quick-reply'
import { sendMessage } from '../boss-chat-utils'

// 导入面试模块
import { matchJobPositionByName } from './job-matcher'
import { sendInterviewQuestion, sendResumeRequest, sendResumeExchangeRequest } from './question-sender'
import {
  getLatestCandidateAnswer,
  mergeMessagesInWindow,
  deduplicateSentencesInText,
  isDuplicateAnswer,
  isLatestMessageFromCandidate
} from './answer-collector'
import { scoreAnswer } from './scorer'
import { detectResumeSent, detectResumeCard, clickResumeAcceptButton, downloadResumeFromCard } from './resume-handler'
import { sendResumeEmail } from './email-sender'
import { shouldSendNextRound } from './status-manager'
import { randomDelay, canSendMessage, recordMessageSent, getRiskControlConfig, isWithinWorkHours } from './risk-control'
import {
  saveInterviewCandidate,
  getInterviewCandidate,
  getInterviewJobPositionWithDetails,
  getPendingInterviewCandidates,
  updateInterviewCandidateStatus,
  getInterviewQaRecordList,
  saveInterviewOperationLog
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
          const handledCurrentChat = await processCurrentOpenChatWhenNoUnread(
            dataSource!,
            pageMapByName.boss!,
            cfg
          )
          console.log(
            '[Interview MainLoop] 滚动后仍未发现未读消息，当前会话兜底检查结果:',
            handledCurrentChat ? '已处理' : '无新回复'
          )
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

        // 【新增】获取候选人教育信息和经验信息
        const educationInfo = await getGeekEducationInfo(pageMapByName.boss!)
        const experienceInfo = await getGeekExperienceInfo(pageMapByName.boss!)

        // 【新增】候选人筛选检查
        const filterResult = checkCandidateFilter(jobPosition, educationInfo, experienceInfo)
        if (!filterResult.passed) {
          console.log('[Interview MainLoop] 候选人不符合筛选条件:', filterResult.reason)
          // 记录筛选日志
          await saveInterviewOperationLog(dataSource!, {
            action: 'candidate_filtered',
            detail: JSON.stringify({
              geekName,
              jobName: targetChat.jobName,
              education: educationInfo?.education,
              experience: experienceInfo?.experience,
              filterReason: filterResult.reason
            })
          })
          continue // 跳过该候选人
        }

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
            firstContactAt: new Date(),
            // 【新增】保存教育和经验信息
            education: educationInfo?.education || undefined,
            school: educationInfo?.school || undefined,
            major: educationInfo?.major || undefined
          })
          console.log('[Interview MainLoop] 创建候选人记录:', candidate.id)
        } else if (educationInfo?.education && !candidate.education) {
          // 如果候选人已存在但没有教育信息，更新教育信息
          await saveInterviewCandidate(dataSource!, {
            id: candidate.id,
            education: educationInfo.education,
            school: educationInfo.school,
            major: educationInfo.major
          })
          candidate.education = educationInfo.education
          candidate.school = educationInfo.school
          candidate.major = educationInfo.major
          console.log('[Interview MainLoop] 更新候选人教育信息:', educationInfo)
        }

        // 根据状态处理
        await handleCandidateByStatus(dataSource!, pageMapByName.boss!, candidate, jobPosition, cfg)

        // 风控延迟
        await randomDelay()
      }

      console.log('[Interview MainLoop] 当前未读消息处理完成，等待下一轮扫描...')
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

async function processCurrentOpenChatWhenNoUnread(
  ds: DataSource,
  page: Page,
  config: any
): Promise<boolean> {
  try {
    const trackedStatuses = [
      InterviewCandidateStatus.WAITING_ROUND_1,
      InterviewCandidateStatus.WAITING_ROUND_2,
      InterviewCandidateStatus.WAITING_ROUND_N,
      InterviewCandidateStatus.REPLY_EXTRACTION_FAILED,
      InterviewCandidateStatus.RESUME_REQUESTED,
      InterviewCandidateStatus.RESUME_AGREED
    ]
    const pendingCandidates = await getPendingInterviewCandidates(ds, trackedStatuses)

    const candidate = await resolveCurrentOpenCandidate(ds, page, pendingCandidates)
    if (candidate) {
      const handledCurrent = await processFallbackCandidate(ds, page, candidate, config)
      if (handledCurrent) {
        return true
      }
    }

    const friendListData = await getChatList(page)
    for (const pendingCandidate of pendingCandidates) {
      if (
        candidate?.id &&
        pendingCandidate.id === candidate.id
      ) {
        continue
      }

      const matchedChat = friendListData.find((item) => {
        if (pendingCandidate.encryptGeekId && item.encryptGeekId) {
          return item.encryptGeekId === pendingCandidate.encryptGeekId
        }
        return !!pendingCandidate.geekName && pendingCandidate.geekName === item.name
      })

      if (!matchedChat) {
        continue
      }

      await clickChatItemByIdentifier(page, {
        name: matchedChat.name || pendingCandidate.geekName,
        encryptGeekId: matchedChat.encryptGeekId || pendingCandidate.encryptGeekId
      })
      await sleep(1500)

      const handledVisiblePending = await processFallbackCandidate(
        ds,
        page,
        pendingCandidate,
        config
      )
      if (handledVisiblePending) {
        return true
      }
    }

    return false
  } catch (error) {
    console.error('[Interview MainLoop] 当前会话兜底检查失败:', error)
    return false
  }
}

async function resolveCurrentOpenCandidate(
  ds: DataSource,
  page: Page,
  pendingCandidates: InterviewCandidate[]
): Promise<InterviewCandidate | null> {
  const currentGeekInfo = await getCurrentChatGeekInfo(page)
  if (!currentGeekInfo) {
    return null
  }

  if (currentGeekInfo.encryptGeekId) {
    const matchedById = await getInterviewCandidate(
      ds,
      currentGeekInfo.encryptGeekId,
      currentGeekInfo.encryptJobId || ''
    )
    if (matchedById) {
      return matchedById
    }
  }

  if (currentGeekInfo.name) {
    const matchedByName = pendingCandidates.find((item) => item.geekName === currentGeekInfo.name)
    if (matchedByName) {
      return matchedByName
    }
  }

  return null
}

async function processFallbackCandidate(
  ds: DataSource,
  page: Page,
  candidate: InterviewCandidate,
  config: any
): Promise<boolean> {
  try {
    const waitingStatuses = new Set([
      InterviewCandidateStatus.WAITING_ROUND_1,
      InterviewCandidateStatus.WAITING_ROUND_2,
      InterviewCandidateStatus.WAITING_ROUND_N,
      InterviewCandidateStatus.REPLY_EXTRACTION_FAILED
    ])
    const resumeStatuses = new Set([
      InterviewCandidateStatus.RESUME_REQUESTED,
      InterviewCandidateStatus.RESUME_AGREED
    ])

    if (!waitingStatuses.has(candidate.status) && !resumeStatuses.has(candidate.status)) {
      return false
    }

    if (waitingStatuses.has(candidate.status)) {
      const latestIsCandidate = await isLatestMessageFromCandidate(page)
      if (!latestIsCandidate) {
        return false
      }
    }

    let jobPosition: any = null
    if (candidate.jobPositionId) {
      jobPosition = await getInterviewJobPositionWithDetails(ds, candidate.jobPositionId)
    }

    if (waitingStatuses.has(candidate.status) && !jobPosition) {
      console.log('[Interview MainLoop] 当前会话兜底检查跳过：未找到岗位配置', candidate.id)
      return false
    }

    console.log('[Interview MainLoop] 未读为空，兜底处理候选人:', candidate.geekName, candidate.status)
    await handleCandidateByStatus(ds, page, candidate, jobPosition, config)
    return true
  } catch (error) {
    console.error('[Interview MainLoop] 兜底处理候选人失败:', error)
    return false
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
    case InterviewCandidateStatus.REPLY_EXTRACTION_FAILED:
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
      let { mergedText } = await mergeMessagesInWindow(page, candidate, 30)
      if (!mergedText) {
        console.log('[Interview MainLoop] 30秒窗口未提取到有效回复，尝试回退到最新一条候选人消息')

        const latestAnswer = await getLatestCandidateAnswer(page, candidate)
        if (latestAnswer?.text) {
          mergedText = latestAnswer.text
          console.log('[Interview MainLoop] 已使用最新一条候选人消息作为评分输入:', mergedText.substring(0, 100))
        }
      }

      if (!mergedText) {
        console.log('[Interview MainLoop] 未找到候选人回复内容，保留等待状态，等待下次轮询')
        if (candidate.status !== InterviewCandidateStatus.REPLY_EXTRACTION_FAILED) {
          await updateInterviewCandidateStatus(
            ds,
            candidate.id!,
            InterviewCandidateStatus.REPLY_EXTRACTION_FAILED
          )
        }
        await saveInterviewOperationLog(ds, {
          candidateId: candidate.id,
          action: 'reply_detected_but_not_extracted',
          detail: JSON.stringify({
            currentRound: candidate.currentRound,
            lastQuestionAt: candidate.lastQuestionAt,
            lastScoredAt: candidate.lastScoredAt
          })
        })
        break
      }

      // 【新增】对回答文本内部重复句子进行去重
      mergedText = deduplicateSentencesInText(mergedText)
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

      // 评分（使用纯LLM评分）
      const scoreResult = await scoreAnswer(
        ds,
        candidate,
        questionRound.questionText,
        mergedText,
        jobPosition
      )

      // 保存问答记录（含评分）- 复用之前的查询结果 existingQARecord
      const qaRepo = ds.getRepository('InterviewQaRecord')

      if (existingQARecord) {
        // 记录已存在，更新评分信息
        await qaRepo.update(existingQARecord.id!, {
          answerText: mergedText,
          answeredAt: new Date(),
          llmScore: scoreResult.llmScore,
          totalScore: scoreResult.totalScore,
          llmReason: scoreResult.llmReason,
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
          llmScore: scoreResult.llmScore,
          totalScore: scoreResult.totalScore,
          llmReason: scoreResult.llmReason,
          scoredAt: new Date()
        }))
      }

      // 更新候选人得分和已评分时间（关键：避免重复评分同一条消息）
      const candRepo = ds.getRepository('InterviewCandidate')
      await candRepo.update(candidate.id!, {
        totalScore: scoreResult.totalScore,
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
        // 未通过，静默标记为已拒绝，不发送消息
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
 * 【新增】检查候选人是否符合筛选条件
 * @param jobPosition 岗位配置
 * @param educationInfo 教育信息
 * @param experienceInfo 经验信息
 * @returns 筛选结果
 */
function checkCandidateFilter(
  jobPosition: any,
  educationInfo: { education: string; school: string; major: string } | null,
  experienceInfo: { experience: string; isFreshGraduate: boolean; graduateYear: string | null } | null
): { passed: boolean; reason: string } {
  // 解析筛选配置
  let educationFilter: string[] = []
  let experienceFilter: string[] = []

  try {
    if (jobPosition.educationFilter) {
      educationFilter = JSON.parse(jobPosition.educationFilter)
    }
    if (jobPosition.experienceFilter) {
      experienceFilter = JSON.parse(jobPosition.experienceFilter)
    }
  } catch (e) {
    console.error('[Filter] 解析筛选配置失败:', e)
  }

  // 如果没有设置筛选条件，直接通过
  if (educationFilter.length === 0 && experienceFilter.length === 0) {
    return { passed: true, reason: '' }
  }

  // 学历筛选
  if (educationFilter.length > 0) {
    const candidateEdu = educationInfo?.education || ''

    // 如果候选人没有学历信息，跳过筛选（继续处理）
    if (!candidateEdu) {
      console.log('[Filter] 候选人无学历信息，跳过学历筛选')
    } else {
      // 学历匹配逻辑
      const eduPassed = matchEducation(candidateEdu, educationFilter)
      if (!eduPassed) {
        return {
          passed: false,
          reason: `学历不符合: 候选人学历"${candidateEdu}", 要求${educationFilter.join('/')}`
        }
      }
    }
  }

  // 经验筛选
  if (experienceFilter.length > 0) {
    const candidateExp = experienceInfo?.experience || ''
    const isFreshGraduate = experienceInfo?.isFreshGraduate || false
    const graduateYear = experienceInfo?.graduateYear || null

    // 如果候选人没有经验信息，跳过筛选（继续处理）
    if (!candidateExp && !isFreshGraduate) {
      console.log('[Filter] 候选人无经验信息，跳过经验筛选')
    } else {
      // 经验匹配逻辑
      const expPassed = matchExperience(candidateExp, isFreshGraduate, graduateYear, experienceFilter)
      if (!expPassed) {
        return {
          passed: false,
          reason: `经验不符合: 候选人经验"${candidateExp || (isFreshGraduate ? (graduateYear || '') + '届应届生' : '未知')}", 要求${experienceFilter.join('/')}`
        }
      }
    }
  }

  return { passed: true, reason: '' }
}

/**
 * 学历匹配
 */
function matchEducation(candidateEdu: string, filterList: string[]): boolean {
  for (const filter of filterList) {
    // 大专及以下：匹配高中、中专、技校、大专
    if (filter === '大专及以下') {
      if (['高中', '中专', '技校', '大专'].includes(candidateEdu)) {
        return true
      }
    }
    // 硕士/研究生
    else if (filter === '硕士/研究生') {
      if (candidateEdu === '硕士' || candidateEdu === '研究生') {
        return true
      }
    }
    // 其他精确匹配
    else if (candidateEdu === filter) {
      return true
    }
  }

  return false
}

/**
 * 经验匹配
 */
function matchExperience(
  candidateExp: string,
  isFreshGraduate: boolean,
  graduateYear: string | null,
  filterList: string[]
): boolean {
  // 如果是应届生
  if (isFreshGraduate && graduateYear) {
    // 检查是否匹配应届生筛选
    if (filterList.includes('25届应届生') && graduateYear === '25') {
      return true
    }
    if (filterList.includes('26届应届生') && graduateYear === '26') {
      return true
    }
    // 如果筛选条件里没有应届生选项，但不代表不通过
    // 继续检查其他经验选项
  }

  // 解析候选人的工作年限
  const expMatch = candidateExp.match(/^(\d+)年$|^(\d+)年以上$/)
  const years = expMatch ? parseInt(expMatch[1] || expMatch[2]) : 0

  for (const filter of filterList) {
    // 应届生选项已在上面处理
    if (filter.includes('应届生')) continue

    if (filter === '1年及以下') {
      if (years <= 1) return true
    }
    else if (filter === '2年') {
      if (years === 2) return true
    }
    else if (filter === '3年') {
      if (years === 3) return true
    }
    else if (filter === '3年以上') {
      if (years >= 3) return true
    }
  }

  return false
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
