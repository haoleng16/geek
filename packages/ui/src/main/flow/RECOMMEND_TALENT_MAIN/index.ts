import minimist from 'minimist'
import { app, dialog } from 'electron'
import initPublicIpc from '../../utils/initPublicIpc'
import { connectToDaemon, sendToDaemon } from '../OPEN_SETTING_WINDOW/connect-to-daemon'
import { checkShouldExit } from '../../utils/worker'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { configWithBrowserAssistant } from '../../features/config-with-browser-assistant'
import {
  writeStorageFile,
  readStorageFile,
  readConfigFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../../common/enums/auto-start-chat'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import type { DataSource } from 'typeorm'
import { bootstrap, launchBoss } from './bootstrap'
import type { Browser } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { checkCookieListFormat } from '../../../common/utils/cookie'
import { loginWithCookieAssistant } from '../../features/login-with-cookie-assistant'
import { randomUUID } from 'node:crypto'
import { getCandidateCardElement, scrollAndExtractCards, scrollPage } from './page-scanner'
import { preFilterCandidate, type PreFilterConfig } from './pre-filter'
import { buildScoringPrompt } from './prompt-builder'
import { switchToJob } from './job-fetcher'
import {
  createCheckpoint,
  loadActiveCheckpoint,
  updateCheckpoint,
  markCheckpointCompleted,
  markCheckpointError
} from './checkpoint'
import { detectCaptcha } from './captcha-detector'
import { RecommendJobConfig } from '@geekgeekrun/sqlite-plugin/dist/entity/RecommendJobConfig'
import { RecommendCandidate } from '@geekgeekrun/sqlite-plugin/dist/entity/RecommendCandidate'
import { RecommendResumeSnapshot } from '@geekgeekrun/sqlite-plugin/dist/entity/RecommendResumeSnapshot'
import { openCandidateResume, closeCandidateResume } from './resume-handler'
import { extractResumeDomText } from './resume-dom-extractor'
import { screenshotResumeSnapshot } from './screenshot'
import { analyzeWithVL } from './vl-analyzer'
import { collectCandidate } from './collector'
import {
  buildResumeAnalysisSections,
  formatResumeForAnalysis,
  getCandidateResumeFromDOM,
  waitForCandidateResumeByApi
} from '../RECRUITER_AUTO_REPLY_MAIN/candidate-resume'

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在退出')
  process.exit(0)
})

export const pageMapByName: {
  boss?: any | null
} = {}

let browser: null | Browser = null
let dataSource: DataSource | null = null

const WORK_YEAR_OPTION_VALUES = [
  'fresh_graduate',
  '1_year',
  '2_years',
  '3_years',
  '3_plus_years'
] as const

function parseWorkYearOptions(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        const options = parsed.filter(
          (item): item is string =>
            typeof item === 'string' &&
            (WORK_YEAR_OPTION_VALUES as readonly string[]).includes(item)
        )
        return options.length > 0 ? options : undefined
      }
    } catch {
      return undefined
    }
  }
  return undefined
}

function convertLegacyWorkYearRange(
  minWorkYears?: number | null,
  maxWorkYears?: number | null
): string[] | undefined {
  const min = Number(minWorkYears ?? 0)
  const max = Number(maxWorkYears ?? 0)
  const upperBound = max > 0 ? max : Number.POSITIVE_INFINITY

  if (min <= 0 && (max <= 0 || max >= 99 || !Number.isFinite(upperBound))) {
    return undefined
  }

  const options: string[] = []
  if (min <= 1 && upperBound >= 1) options.push('1_year')
  if (min <= 2 && upperBound >= 2) options.push('2_years')
  if (min <= 3 && upperBound >= 3) options.push('3_years')
  if (upperBound > 3) {
    if (min <= 3 || min > 3) {
      options.push('3_plus_years')
    }
  }

  return options.length > 0 ? options : undefined
}

function buildJobIdentifier(jobConfig: RecommendJobConfig): string {
  if (jobConfig.encryptJobId) return jobConfig.encryptJobId
  if (jobConfig.id) return `recommend_job_config_${jobConfig.id}`
  return `recommend_job_${String(jobConfig.jobName || 'default')
    .toLowerCase()
    .replace(/[·•｜|_/\\()\[\]\-—\s]+/g, '')
    .trim()}`
}

function getSelectedRecommendJobConfigsFromEnv(): Array<{ id?: number; jobName?: string }> {
  const raw = process.env.GEEKGEEKRUN_RECOMMEND_JOB_SELECTION
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && (item.id || item.jobName))
      .map((item) => ({
        id: typeof item.id === 'number' ? item.id : undefined,
        jobName: typeof item.jobName === 'string' ? item.jobName : undefined
      }))
  } catch (error) {
    console.warn('[RecommendTalent MainLoop] 解析选中岗位配置失败:', error)
    return []
  }
}

// 初始化数据库
const dbInitPromise = initDb(getPublicDbFilePath())

// 获取推荐牛人配置
function getRecommendTalentConfig() {
  const raw = readConfigFile('boss.json')?.recommendTalent ?? {}
  return {
    scanIntervalSeconds: Math.max(1, Math.min(60, Number(raw.scanIntervalSeconds) || 3)),
    scrollDelayMin: Number(raw.scrollDelayMin) || 1000,
    scrollDelayMax: Number(raw.scrollDelayMax) || 3000,
    maxCollectPerRun: Math.max(1, Math.min(200, Number(raw.maxCollectPerRun) || 50)),
    pauseOnCaptcha: raw.pauseOnCaptcha !== false,
    notifyOnCaptcha: raw.notifyOnCaptcha !== false
  }
}

async function storeStorage(page) {
  const [cookies, localStorage] = await Promise.all([
    page.cookies(),
    page
      .evaluate(() => {
        return JSON.stringify(window.localStorage)
      })
      .then((res) => JSON.parse(res))
  ])
  return Promise.all([
    writeStorageFile('boss-cookies.json', cookies),
    writeStorageFile('boss-local-storage.json', localStorage)
  ])
}

const mainLoop = async () => {
  console.log('[RecommendTalent MainLoop] 开始执行...')

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

  // 先启动浏览器
  console.log('[RecommendTalent MainLoop] 正在启动浏览器...')
  browser = await bootstrap()
  console.log('[RecommendTalent MainLoop] 浏览器已启动')

  // 检查 cookie 是否存在
  let bossCookies = readStorageFile('boss-cookies.json')
  let cookieCheckResult = checkCookieListFormat(bossCookies)
  console.log('[RecommendTalent MainLoop] Cookie 检查结果:', cookieCheckResult)

  // 如果 cookie 无效，设置空的 cookie 让浏览器跳转到登录页面
  if (!cookieCheckResult) {
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: {
          id: 'basic-cookie-check',
          status: 'pending'
        },
        runRecordId
      }
    })
  } else {
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: {
          id: 'basic-cookie-check',
          status: 'fulfilled'
        },
        runRecordId
      }
    })
  }

  // 导航到 BOSS 直聘推荐牛人页面
  await launchBoss(browser!)

  await sleep(1000)
  pageMapByName.boss!.bringToFront()
  await sleep(2000)

  // 检查当前页面 URL，判断登录状态
  const currentPageUrl = pageMapByName.boss!.url() ?? ''

  // #region login status check
  // 如果在登录页面或 cookie 无效，弹出登录窗口
  if (currentPageUrl.startsWith('https://www.zhipin.com/web/user/') || !cookieCheckResult) {
    // 清除无效的 cookie
    writeStorageFile('boss-cookies.json', [])

    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: {
          id: 'login-status-check',
          status: 'pending'
        },
        runRecordId
      }
    })

    try {
      await loginWithCookieAssistant()
      // 登录成功后，重新加载页面
      const newCookies = readStorageFile('boss-cookies.json')
      const newLocalStorage = readStorageFile('boss-local-storage.json')

      // 设置新的 cookie
      for (const cookie of newCookies) {
        await pageMapByName.boss!.setCookie(cookie)
      }

      // 刷新页面
      await pageMapByName.boss!.reload({ waitUntil: 'networkidle2' })
      await sleep(2000)

      // 再次检查登录状态
      const newPageUrl = pageMapByName.boss!.url() ?? ''
      if (newPageUrl.startsWith('https://www.zhipin.com/web/user/')) {
        throw new Error('LOGIN_STATUS_INVALID')
      }
    } catch (e: any) {
      if (e?.message === 'USER_CANCELLED_LOGIN') {
        await dialog.showMessageBox({
          type: `error`,
          message: `登录已取消`,
          detail: `请重新运行任务并完成登录`
        })
      }
      sendToDaemon({
        type: 'worker-to-gui-message',
        data: {
          type: 'prerequisite-step-by-step-checkstep-by-step-check',
          step: {
            id: 'login-status-check',
            status: 'rejected'
          },
          runRecordId
        }
      })
      throw new Error('LOGIN_STATUS_INVALID')
    }
  }
  if (
    currentPageUrl.startsWith('https://www.zhipin.com/web/common/403.html') ||
    currentPageUrl.startsWith('https://www.zhipin.com/web/common/error.html')
  ) {
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: {
          id: 'login-status-check',
          status: 'rejected'
        },
        runRecordId
      }
    })
    throw new Error('ACCESS_IS_DENIED')
  }
  if (currentPageUrl.startsWith('https://www.zhipin.com/web/user/safe/verify-slider')) {
    const validateRes: any = await pageMapByName
      .boss!.waitForResponse(
        (response) => {
          if (
            response.url().startsWith('https://www.zhipin.com/wapi/zpAntispam/v2/geetest/validate')
          ) {
            return true
          }
          return false
        },
        {
          timeout: 0
        }
      )
      .then((res) => {
        return res.json()
      })
    if (validateRes.code === 0) {
      await storeStorage(pageMapByName.boss)
      sendToDaemon({
        type: 'worker-to-gui-message',
        data: {
          type: 'prerequisite-step-by-step-checkstep-by-step-check',
          step: {
            id: 'login-status-check',
            status: 'rejected'
          },
          runRecordId
        }
      })
      throw new Error('CAPTCHA_PASSED_AND_NEED_RESTART')
    }
  }
  sendToDaemon({
    type: 'worker-to-gui-message',
    data: {
      type: 'prerequisite-step-by-step-checkstep-by-step-check',
      step: {
        id: 'login-status-check',
        status: 'fulfilled'
      },
      runRecordId
    }
  })
  // #endregion

  // close security question tip modal if exists
  let setSecurityQuestionTipModelProxy = await pageMapByName.boss!.$(
    '.dialog-wrap.dialog-account-safe'
  )
  if (setSecurityQuestionTipModelProxy) {
    await sleep(1000)
    setSecurityQuestionTipModelProxy = await pageMapByName.boss!.$(
      '.dialog-wrap.dialog-account-safe'
    )
    const closeButtonProxy = await setSecurityQuestionTipModelProxy?.$('.close')

    if (setSecurityQuestionTipModelProxy && closeButtonProxy) {
      await closeButtonProxy.click()
    }
  }

  // 等待页面完全加载
  console.log('[RecommendTalent MainLoop] 等待页面完全加载...')
  await sleep(3000)

  // 获取配置
  const cfg = getRecommendTalentConfig()

  // 获取所有已启用的岗位配置（用于按名称匹配）
  const jobConfigRepo = dataSource!.getRepository(RecommendJobConfig)
  const jobConfigs = await jobConfigRepo.find({ where: { enabled: true } })

  if (jobConfigs.length === 0) {
    await dialog.showMessageBox({
      type: 'warning',
      message: '未配置岗位',
      detail: '请在设置中添加并启用至少一个岗位配置。',
      buttons: ['退出']
    })
    process.exit(0)
  }

  const selectedJobConfigsFromEnv = getSelectedRecommendJobConfigsFromEnv()
  console.log(
    '[RecommendTalent MainLoop] 启动时接收到的岗位配置选择数:',
    selectedJobConfigsFromEnv.length
  )
  const matchedJobConfigs =
    selectedJobConfigsFromEnv.length > 0
      ? jobConfigs.filter((config) =>
          selectedJobConfigsFromEnv.some(
            (selected) =>
              (selected.id && config.id === selected.id) ||
              (selected.jobName && config.jobName === selected.jobName)
          )
        )
      : jobConfigs

  console.log('[RecommendTalent MainLoop] 本次实际使用的岗位配置数量:', matchedJobConfigs.length)

  if (matchedJobConfigs.length === 0) {
    await dialog.showMessageBox({
      type: 'warning',
      message: '未找到相关岗位',
      detail: '未找到你在设置页勾选的岗位配置，请确认这些岗位仍处于启用状态并已保存。',
      buttons: ['退出']
    })
    process.exit(0)
  }

  for (const jobConfig of matchedJobConfigs) {
    const jobIdentifier = buildJobIdentifier(jobConfig)
    console.log('[RecommendTalent MainLoop] 当前页面匹配到配置:', jobConfig.jobName, jobIdentifier)

    // 切换到配置的岗位
    while (true) {
      try {
        const switchResult = await switchToJob(pageMapByName.boss!, jobConfig.jobName!)
        if (!switchResult.switched) {
          throw new Error(`JOB_SWITCH_FAILED: 可用岗位: ${switchResult.availableJobs.join(' | ')}`)
        }
        console.log('[RecommendTalent MainLoop] 已切换到岗位:', switchResult.matchedText)
        break
      } catch (switchErr: any) {
        console.error('[RecommendTalent MainLoop] 岗位切换失败:', switchErr)
        const { response } = await dialog.showMessageBox({
          type: 'error',
          message: '岗位切换失败',
          detail: `未能将页面切换到岗位「${jobConfig.jobName}」。\n${switchErr.message}\n\n你可以手动在浏览器中切换到正确岗位后点击「继续检查」。`,
          buttons: ['继续检查', '退出'],
          defaultId: 0,
          cancelId: 1,
          noLink: true
        })
        if (response === 1) {
          throw switchErr
        }
        // response === 0: 继续检查，重新尝试 switchToJob
      }
    }

    // 检查是否有未完成的断点
    let checkpoint = await loadActiveCheckpoint(dataSource!, jobIdentifier)
    let sessionId: string

    if (checkpoint) {
      sessionId = checkpoint.sessionId
      console.log('[RecommendTalent MainLoop] 恢复断点:', sessionId)
    } else {
      sessionId = randomUUID()
      checkpoint = await createCheckpoint(dataSource!, sessionId, jobIdentifier)
      console.log('[RecommendTalent MainLoop] 新建会话:', sessionId)
    }

    const scoringPrompt = buildScoringPrompt(jobConfig)
    const candidateRepo = dataSource!.getRepository(RecommendCandidate)
    const snapshotRepo = dataSource!.getRepository(RecommendResumeSnapshot)

    const filterConfig: PreFilterConfig = {
      minDegree: jobConfig.minDegree || undefined,
      workYearOptions:
        parseWorkYearOptions((jobConfig as any).workYearOptions) ??
        convertLegacyWorkYearRange(jobConfig.minWorkYears, jobConfig.maxWorkYears)
    }

    try {
      // 滚动并处理候选人
      let hasMore = true
      let emptyCardRounds = 0
      while (hasMore && (checkpoint.collectedCount ?? 0) < (jobConfig.maxCollectPerJob ?? 20)) {
        // 检测验证码
        if (await detectCaptcha(pageMapByName.boss!)) {
          if (cfg.pauseOnCaptcha) {
            await updateCheckpoint(dataSource!, sessionId, { status: 'paused' })
            await dialog.showMessageBox({
              type: 'warning',
              message: '检测到验证码',
              detail: '请手动完成验证后点击确定继续。',
              buttons: ['已验证，继续']
            })
            await updateCheckpoint(dataSource!, sessionId, { status: 'running' })
          } else {
            throw new Error('CAPTCHA_DETECTED')
          }
        }

        const cards = await scrollAndExtractCards(pageMapByName.boss!)
        console.log('[RecommendTalent MainLoop] 提取到卡片数量:', cards.length)

        if (cards.length === 0) {
          emptyCardRounds += 1
          console.log('[RecommendTalent MainLoop] 当前未提取到卡片，重试轮次:', emptyCardRounds)
          if (emptyCardRounds < 5) {
            await sleep(1500)
            hasMore = true
            continue
          }
          hasMore = await scrollPage(pageMapByName.boss!)
          continue
        }

        emptyCardRounds = 0

        for (const card of cards) {
          // 去重检查
          const existing = await candidateRepo.findOne({
            where: { sessionId, encryptUserId: card.encryptUserId, encryptJobId: jobIdentifier }
          })
          if (existing) continue

          // 预筛选
          const filterResult = preFilterCandidate(card, filterConfig)

          if (!filterResult.pass) {
            // 记录预筛选未通过的候选人
            const skippedCandidate = new RecommendCandidate()
            Object.assign(skippedCandidate, {
              sessionId,
              encryptUserId: card.encryptUserId,
              encryptJobId: jobIdentifier,
              jobName: jobConfig.jobName,
              geekName: card.name,
              avatarUrl: card.avatar,
              degree: card.degree,
              workYears: card.workYears,
              city: card.city,
              expectedSalary: card.expectedSalary,
              currentCompany: card.currentCompany,
              currentPosition: card.currentPosition,
              activeStatus: card.activeStatus || '',
              isJobSeeking: card.isJobSeeking,
              preFilterPassed: false,
              preFilterFailReason: filterResult.reason
            })
            await candidateRepo.save(skippedCandidate)

            await updateCheckpoint(dataSource!, sessionId, {
              processedCount: (checkpoint.processedCount ?? 0) + 1,
              skippedCount: (checkpoint.skippedCount ?? 0) + 1,
              lastProcessedUserId: card.encryptUserId
            })
            checkpoint.processedCount = (checkpoint.processedCount ?? 0) + 1
            checkpoint.skippedCount = (checkpoint.skippedCount ?? 0) + 1
            continue
          }

          const candidate = new RecommendCandidate()
          Object.assign(candidate, {
            sessionId,
            encryptUserId: card.encryptUserId,
            encryptJobId: jobIdentifier,
            jobName: jobConfig.jobName,
            geekName: card.name,
            avatarUrl: card.avatar,
            degree: card.degree,
            workYears: card.workYears,
            city: card.city,
            expectedSalary: card.expectedSalary,
            currentCompany: card.currentCompany,
            currentPosition: card.currentPosition,
            activeStatus: card.activeStatus || '',
            isJobSeeking: card.isJobSeeking,
            preFilterPassed: true
          })
          await candidateRepo.save(candidate)

          let resumePanel = null
          let snapshot: RecommendResumeSnapshot | null = null
          try {
            const apiResumePromise = pageMapByName.boss
              ? waitForCandidateResumeByApi(pageMapByName.boss, card.encryptUserId, 12000).catch(
                  () => null
                )
              : Promise.resolve(null)

            resumePanel = await openCandidateResume(
              pageMapByName.boss!,
              card.cardKey || '',
              card.frameIndex,
              card.encryptUserId
            )
            const [domResume, apiResume, resumeInfo] = await Promise.all([
              extractResumeDomText(pageMapByName.boss!, card.frameIndex).catch(() => null),
              apiResumePromise,
              getCandidateResumeFromDOM(pageMapByName.boss!).catch(() => ({}))
            ])

            const structuredResume = apiResume || resumeInfo
            const structuredSections = buildResumeAnalysisSections(structuredResume)
            const structuredResumeText = formatResumeForAnalysis(structuredResume)
            const finalResumeText = domResume?.plainText || structuredResumeText
            const finalResumeSections =
              domResume?.sections || structuredSections.map((section) => ({ ...section }))
            const resumeTextSource = domResume?.plainText
              ? 'html-dom'
              : structuredResumeText
                ? apiResume
                  ? 'resume-api'
                  : 'basic-fields'
                : 'none'

            console.log(
              '[RecommendTalent MainLoop] 简历文本来源:',
              card.name,
              resumeTextSource,
              '长度:',
              finalResumeText.length
            )
            const hasResumeContent = Boolean(
              finalResumeText ||
                apiResume ||
                resumePanel ||
                resumeInfo?.degree ||
                resumeInfo?.currentCompany ||
                resumeInfo?.currentJob ||
                resumeInfo?.expectCity ||
                resumeInfo?.advantage ||
                (Array.isArray(resumeInfo?.skills) && resumeInfo.skills.length > 0)
            )

            if (!hasResumeContent) {
              candidate.recommend = false
              candidate.reason = '未获取到简历内容'
              await candidateRepo.save(candidate)
            } else {
              const profileForCandidate = apiResume || resumeInfo

              if (profileForCandidate?.degree && !candidate.degree) {
                candidate.degree = profileForCandidate.degree
              }
              if (profileForCandidate?.currentCompany && !candidate.currentCompany) {
                candidate.currentCompany = profileForCandidate.currentCompany
              }
              if (profileForCandidate?.currentJob && !candidate.currentPosition) {
                candidate.currentPosition = profileForCandidate.currentJob
              }

              let filePath = ''
              let fileSize = 0
              try {
                const screenshotResult = await screenshotResumeSnapshot(
                  pageMapByName.boss!,
                  sessionId,
                  card.encryptUserId,
                  card.frameIndex
                )
                filePath = screenshotResult.filePath
                fileSize = screenshotResult.fileSize
              } catch (screenshotErr) {
                console.warn(
                  '[RecommendTalent MainLoop] 简历快照生成失败，回退到纯文本简历分析:',
                  card.name,
                  screenshotErr
                )
              }

              snapshot = new RecommendResumeSnapshot()
              Object.assign(snapshot, {
                candidateId: candidate.id,
                encryptUserId: card.encryptUserId,
                snapshotPath: filePath,
                snapshotSize: fileSize,
                domText: finalResumeText || '',
                domSectionsJson:
                  finalResumeSections.length > 0 ? JSON.stringify(finalResumeSections) : '[]'
              })
              await snapshotRepo.save(snapshot)
              candidate.snapshotId = snapshot.id
              await candidateRepo.save(candidate)

              if (!filePath && !finalResumeText) {
                throw new Error('未获取到可分析的简历文本，且简历快照生成失败')
              }

              const vlResult = await analyzeWithVL(filePath || null, scoringPrompt, finalResumeText)

              snapshot.vlRawResponse = vlResult.rawResponse
              snapshot.vlRequestTokens = vlResult.tokens.request
              snapshot.vlResponseTokens = vlResult.tokens.response
              snapshot.vlDurationMs = vlResult.durationMs
              await snapshotRepo.save(snapshot)

              candidate.totalScore = vlResult.result?.totalScore || 0
              candidate.workMatchScore = vlResult.result?.workMatch || 0
              candidate.skillMatchScore = vlResult.result?.skillMatch || 0
              candidate.projectQualityScore = vlResult.result?.projectQuality || 0
              candidate.overallQualityScore = vlResult.result?.overallQuality || 0
              candidate.recommend = vlResult.result?.recommend === true
              candidate.reason = vlResult.result?.reason || 'VL未返回可用结论'
              candidate.keyStrengths = JSON.stringify(vlResult.result?.keyStrengths || [])
              candidate.concerns = JSON.stringify(vlResult.result?.concerns || [])

              if (candidate.recommend) {
                const cardElement = await getCandidateCardElement(
                  pageMapByName.boss!,
                  card.cardKey || '',
                  card.frameIndex
                )
                if (cardElement) {
                  candidate.isCollected = await collectCandidate(pageMapByName.boss!, cardElement)
                }
                if (candidate.isCollected) {
                  checkpoint.collectedCount = (checkpoint.collectedCount ?? 0) + 1
                }
              }

              await candidateRepo.save(candidate)
            }
          } catch (analysisErr) {
            console.error('[RecommendTalent MainLoop] 在线简历分析失败:', card.name, analysisErr)
            candidate.recommend = false
            candidate.reason = `在线简历分析失败: ${String(analysisErr)}`
            await candidateRepo.save(candidate)
          } finally {
            await closeCandidateResume(pageMapByName.boss!, card.frameIndex).catch(() => undefined)
          }

          await updateCheckpoint(dataSource!, sessionId, {
            processedCount: (checkpoint.processedCount ?? 0) + 1,
            matchedCount: (checkpoint.matchedCount ?? 0) + 1,
            collectedCount: checkpoint.collectedCount ?? 0,
            lastProcessedUserId: card.encryptUserId
          })
          checkpoint.processedCount = (checkpoint.processedCount ?? 0) + 1
          checkpoint.matchedCount = (checkpoint.matchedCount ?? 0) + 1

          // 检查是否达到上限
          if ((checkpoint.collectedCount ?? 0) >= (jobConfig.maxCollectPerJob ?? 20)) {
            break
          }
        }

        hasMore = await scrollPage(pageMapByName.boss!)
      }

      await markCheckpointCompleted(dataSource!, sessionId)
      console.log('[RecommendTalent MainLoop] 岗位处理完成:', jobConfig.jobName)
    } catch (err) {
      console.error('[RecommendTalent MainLoop] 岗位处理失败:', jobConfig.jobName, err)
      await markCheckpointError(dataSource!, sessionId, String(err))
    }
  }

  console.log('[RecommendTalent MainLoop] 所有岗位处理完成')
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
  console.log('[RecommendTalent runEntry] 开始执行...')
  app.dock?.hide()
  await app.whenReady()
  console.log('[RecommendTalent runEntry] app ready')
  app.on('window-all-closed', (e) => {
    e.preventDefault()
  })
  initPublicIpc()
  await connectToDaemon()
  console.log('[RecommendTalent runEntry] 已连接到 daemon')
  await sendToDaemon(
    {
      type: 'ping'
    },
    {
      needCallback: true
    }
  )
  console.log('[RecommendTalent runEntry] daemon ping 成功')
  sendToDaemon({
    type: 'worker-to-gui-message',
    data: {
      type: 'prerequisite-step-by-step-checkstep-by-step-check',
      step: {
        id: 'worker-launch',
        status: 'fulfilled'
      },
      runRecordId
    }
  })

  console.log('[RecommendTalent runEntry] 正在检查浏览器...')
  let puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  console.log(
    '[RecommendTalent runEntry] 浏览器检查结果:',
    puppeteerExecutable ? puppeteerExecutable.executablePath : 'null'
  )

  if (!puppeteerExecutable) {
    console.log('[RecommendTalent runEntry] 未找到浏览器，尝试自动配置...')
    try {
      await configWithBrowserAssistant({ autoFind: true })
      console.log('[RecommendTalent runEntry] 浏览器配置完成')
    } catch (e) {
      console.error('[RecommendTalent runEntry] 浏览器配置失败:', e)
    }
    puppeteerExecutable = await getLastUsedAndAvailableBrowser()
    console.log(
      '[RecommendTalent runEntry] 再次检查浏览器:',
      puppeteerExecutable ? puppeteerExecutable.executablePath : 'null'
    )
  }
  if (!puppeteerExecutable) {
    console.error('[RecommendTalent runEntry] 未找到可用的浏览器')
    await dialog.showMessageBox({
      type: `error`,
      message: `未找到可用的浏览器`,
      detail: `请重新运行本程序，按照提示安装、配置浏览器`
    })
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: {
          id: 'puppeteer-executable-check',
          status: 'rejected'
        },
        runRecordId
      }
    })
    throw new Error(`PUPPETEER_IS_NOT_EXECUTABLE`)
  }
  sendToDaemon({
    type: 'worker-to-gui-message',
    data: {
      type: 'prerequisite-step-by-step-checkstep-by-step-check',
      step: {
        id: 'puppeteer-executable-check',
        status: 'fulfilled'
      },
      runRecordId
    }
  })
  process.env.PUPPETEER_EXECUTABLE_PATH = puppeteerExecutable.executablePath
  console.log(
    '[RecommendTalent runEntry] PUPPETEER_EXECUTABLE_PATH:',
    process.env.PUPPETEER_EXECUTABLE_PATH
  )

  // 初始化数据库
  console.log('[RecommendTalent runEntry] 正在初始化数据库...')
  try {
    dataSource = await dbInitPromise
    console.log('[RecommendTalent runEntry] 数据库初始化成功')
  } catch (dbErr) {
    console.error('[RecommendTalent runEntry] 数据库初始化失败:', dbErr)
  }

  console.log('[RecommendTalent runEntry] 开始执行 mainLoop...')
  while (true) {
    try {
      await mainLoop()
      // mainLoop 完成后退出（不是无限循环，处理完所有岗位就结束）
      break
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
        if (err.message.includes('ACCESS_IS_DENIED')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ACCESS_IS_DENIED)
          break
        }
        if (
          err.message.includes(`PUPPETEER_IS_NOT_EXECUTABLE`) ||
          err.message.includes(`Could not find Chrome`) ||
          err.message.includes(`no executable was found`)
        ) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.PUPPETEER_IS_NOT_EXECUTABLE)
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
