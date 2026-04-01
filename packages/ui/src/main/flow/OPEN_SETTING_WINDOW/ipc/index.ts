import { ipcMain, shell, app, dialog, BrowserWindow } from 'electron'
import path from 'path'
import * as childProcess from 'node:child_process'
import {
  readConfigFile,
  writeConfigFile,
  readStorageFile,
  storageFilePath
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { ChildProcess } from 'child_process'
import * as JSONStream from 'JSONStream'
import { checkCookieListFormat } from '../../../../common/utils/cookie'
import { getAnyAvailablePuppeteerExecutable } from '../../DOWNLOAD_DEPENDENCIES/utils/puppeteer-executable/index'
import { mainWindow } from '../../../window/mainWindow'
import {
  getAutoStartChatRecord,
  getJobLibrary,
  getJobHistoryByEncryptId,
  getMarkAsNotSuitRecord
} from '../utils/db/index'
import { PageReq } from '../../../../common/types/pagination'
import { pipeWriteRegardlessError } from '../../utils/pipe'
import { WriteStream } from 'node:fs'
// eslint-disable-next-line vue/prefer-import-from-vue
import { hasOwn } from '@vue/shared'
import { createLlmConfigWindow, llmConfigWindow } from '../../../window/llmConfigWindow'
import { createResumeEditorWindow, resumeEditorWindow } from '../../../window/resumeEditorWindow'
import {
  getValidTemplate,
  requestNewMessageContent
} from '../../READ_NO_REPLY_AUTO_REMINDER_MAIN/boss-operation'
import {
  defaultPromptMap,
  writeDefaultAutoRemindPrompt
} from '../../READ_NO_REPLY_AUTO_REMINDER_MAIN/boss-operation'
import {
  checkIsResumeContentValid,
  resumeContentEnoughDetect
} from '../../../../common/utils/resume'
import {
  createReadNoReplyReminderLlmMockWindow,
  readNoReplyReminderLlmMockWindow
} from '../../../window/readNoReplyReminderLlmMockWindow'
import { RequestSceneEnum } from '../../../features/llm-request-log'
import { checkUpdateForUi } from '../../../features/updater'
import gtag from '../../../utils/gtag'
import { daemonEE, sendToDaemon } from '../connect-to-daemon'
import { runCommon } from '../../../features/run-common'
import { loginWithCookieAssistant } from '../../../features/login-with-cookie-assistant'
import { configWithBrowserAssistant } from '../../../features/config-with-browser-assistant'
import {
  createFirstLaunchNoticeApproveFlag,
  isFirstLaunchNoticeApproveFlagExist,
  waitForUserApproveAgreement
} from '../../../features/first-launch-notice-window'
import { getLastUsedAndAvailableBrowser } from '../../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { waitForCommonJobConditionDone } from '../../../features/common-job-condition'
import { ensureConfigFileExist } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'

export default function initIpc() {
  ipcMain.handle('save-config-file-from-ui', async (ev, payload) => {
    payload = JSON.parse(payload)
    ensureConfigFileExist()

    const promiseArr: Array<Promise<unknown>> = []

    const dingtalkConfig = readConfigFile('dingtalk.json')
    if (hasOwn(payload, 'dingtalkRobotAccessToken')) {
      dingtalkConfig.groupRobotAccessToken = payload.dingtalkRobotAccessToken
    }
    promiseArr.push(writeConfigFile('dingtalk.json', dingtalkConfig))

    const bossConfig = readConfigFile('boss.json')
    if (hasOwn(payload, 'anyCombineRecommendJobFilter')) {
      bossConfig.anyCombineRecommendJobFilter = payload.anyCombineRecommendJobFilter
    }
    delete bossConfig.expectJobRegExpStr
    if (hasOwn(payload, 'expectJobNameRegExpStr')) {
      bossConfig.expectJobNameRegExpStr = payload.expectJobNameRegExpStr
    }
    if (hasOwn(payload, 'expectJobTypeRegExpStr')) {
      bossConfig.expectJobTypeRegExpStr = payload.expectJobTypeRegExpStr
    }
    if (hasOwn(payload, 'expectJobDescRegExpStr')) {
      bossConfig.expectJobDescRegExpStr = payload.expectJobDescRegExpStr
    }
    if (hasOwn(payload, 'jobNotMatchStrategy')) {
      bossConfig.jobNotMatchStrategy = payload.jobNotMatchStrategy
    }
    if (hasOwn(payload, 'markAsNotActiveSelectedTimeRange')) {
      bossConfig.markAsNotActiveSelectedTimeRange = payload.markAsNotActiveSelectedTimeRange
    }
    if (hasOwn(payload, 'jobNotActiveStrategy')) {
      bossConfig.jobNotActiveStrategy = payload.jobNotActiveStrategy
    }
    if (hasOwn(payload, 'autoReminder')) {
      bossConfig.autoReminder = payload.autoReminder
    }

    // city
    if (hasOwn(payload, 'expectCityList')) {
      bossConfig.expectCityList = payload.expectCityList
    }
    if (hasOwn(payload, 'expectCityNotMatchStrategy')) {
      bossConfig.expectCityNotMatchStrategy = payload.expectCityNotMatchStrategy
    }
    if (hasOwn(payload, 'strategyScopeOptionWhenMarkJobCityNotMatch')) {
      bossConfig.strategyScopeOptionWhenMarkJobCityNotMatch =
        payload.strategyScopeOptionWhenMarkJobCityNotMatch
    }

    // salary
    if (hasOwn(payload, 'expectSalaryCalculateWay')) {
      bossConfig.expectSalaryCalculateWay = payload.expectSalaryCalculateWay
    }
    if (hasOwn(payload, 'expectSalaryNotMatchStrategy')) {
      bossConfig.expectSalaryNotMatchStrategy = payload.expectSalaryNotMatchStrategy
    }
    if (hasOwn(payload, 'strategyScopeOptionWhenMarkSalaryNotMatch')) {
      bossConfig.strategyScopeOptionWhenMarkSalaryNotMatch =
        payload.strategyScopeOptionWhenMarkSalaryNotMatch
    }
    if (hasOwn(payload, 'expectSalaryLow')) {
      bossConfig.expectSalaryLow = payload.expectSalaryLow
    }
    if (hasOwn(payload, 'expectSalaryHigh')) {
      bossConfig.expectSalaryHigh = payload.expectSalaryHigh
    }

    // work exp
    if (hasOwn(payload, 'expectWorkExpList')) {
      bossConfig.expectWorkExpList = payload.expectWorkExpList
    }
    if (hasOwn(payload, 'expectWorkExpNotMatchStrategy')) {
      bossConfig.expectWorkExpNotMatchStrategy = payload.expectWorkExpNotMatchStrategy
    }
    if (hasOwn(payload, 'strategyScopeOptionWhenMarkJobWorkExpNotMatch')) {
      bossConfig.strategyScopeOptionWhenMarkJobWorkExpNotMatch =
        payload.strategyScopeOptionWhenMarkJobWorkExpNotMatch
    }
    if (hasOwn(payload, 'jobDetailRegExpMatchLogic')) {
      bossConfig.jobDetailRegExpMatchLogic = payload.jobDetailRegExpMatchLogic
    }
    if (hasOwn(payload, 'isSkipEmptyConditionForCombineRecommendJobFilter')) {
      bossConfig.isSkipEmptyConditionForCombineRecommendJobFilter =
        payload.isSkipEmptyConditionForCombineRecommendJobFilter
    }
    if (hasOwn(payload, 'jobSourceList')) {
      bossConfig.jobSourceList = payload.jobSourceList
    }
    if (hasOwn(payload, 'combineRecommendJobFilterType')) {
      bossConfig.combineRecommendJobFilterType = payload.combineRecommendJobFilterType
    }
    if (hasOwn(payload, 'staticCombineRecommendJobFilterConditions')) {
      bossConfig.staticCombineRecommendJobFilterConditions =
        payload.staticCombineRecommendJobFilterConditions
    }
    if (hasOwn(payload, 'isSageTimeEnabled')) {
      bossConfig.isSageTimeEnabled = payload.isSageTimeEnabled
    }
    if (hasOwn(payload, 'sageTimeOpTimes')) {
      bossConfig.sageTimeOpTimes = payload.sageTimeOpTimes
    }
    if (hasOwn(payload, 'sageTimePauseMinute')) {
      bossConfig.sageTimePauseMinute = payload.sageTimePauseMinute
    }
    if (hasOwn(payload, 'blockCompanyNameRegExpStr')) {
      bossConfig.blockCompanyNameRegExpStr = payload.blockCompanyNameRegExpStr
    }
    if (hasOwn(payload, 'blockCompanyNameRegMatchStrategy')) {
      bossConfig.blockCompanyNameRegMatchStrategy = payload.blockCompanyNameRegMatchStrategy
    }
    if (hasOwn(payload, 'fieldsForUseCommonConfig')) {
      bossConfig.fieldsForUseCommonConfig = payload.fieldsForUseCommonConfig
    }

    // 招聘端自动回复相关配置
    if (hasOwn(payload, 'recruiterAutoReply')) {
      bossConfig.recruiterAutoReply = payload.recruiterAutoReply
    }
    if (hasOwn(payload, 'candidateFilter')) {
      bossConfig.candidateFilter = payload.candidateFilter
    }
    if (hasOwn(payload, 'quickReply')) {
      bossConfig.quickReply = payload.quickReply
    }
    if (hasOwn(payload, 'replyStrategy')) {
      bossConfig.replyStrategy = payload.replyStrategy
    }

    // 智能回复相关配置
    if (hasOwn(payload, 'smartReply')) {
      bossConfig.smartReply = payload.smartReply
    }

    promiseArr.push(writeConfigFile('boss.json', bossConfig))

    if (hasOwn(payload, 'expectCompanies')) {
      promiseArr.push(
        writeConfigFile('target-company-list.json', payload.expectCompanies?.split(',') ?? [])
      )
    }

    return await Promise.all(promiseArr)
  })

  ipcMain.handle('run-geek-auto-start-chat-with-boss', async (ev) => {
    const mode = 'geekAutoStartWithBossMain'
    const { runRecordId } = await runCommon({ mode })
    daemonEE.on('message', function handler(message) {
      if (message.workerId !== mode) {
        return
      }
      if (message.type === 'worker-exited') {
        mainWindow?.webContents.send('worker-exited', message)
      }
    })
    return { runRecordId }
  })

  ipcMain.handle('run-read-no-reply-auto-reminder', async () => {
    const mode = 'readNoReplyAutoReminderMain'
    const { runRecordId } = await runCommon({ mode })
    daemonEE.on('message', function handler(message) {
      if (message.workerId !== mode) {
        return
      }
      if (message.type === 'worker-exited') {
        mainWindow?.webContents.send('worker-exited', message)
      }
    })
    return { runRecordId }
  })

  ipcMain.handle('stop-geek-auto-start-chat-with-boss', async () => {
    mainWindow?.webContents.send('geek-auto-start-chat-with-boss-stopping')
    const p = new Promise((resolve) => {
      daemonEE.on('message', function handler(message) {
        if (message.workerId !== 'geekAutoStartWithBossMain') {
          return
        }
        if (message.type === 'worker-exited') {
          daemonEE.off('message', handler)
          resolve(undefined)
        }
      })
    })
    await sendToDaemon(
      {
        type: 'stop-worker',
        workerId: 'geekAutoStartWithBossMain'
      },
      {
        needCallback: true
      }
    )

    await p
    mainWindow?.webContents.send('geek-auto-start-chat-with-boss-stopped')
  })

  ipcMain.handle('stop-read-no-reply-auto-reminder', async () => {
    mainWindow?.webContents.send('read-no-reply-auto-reminder-stopping')
    const p = new Promise((resolve) => {
      daemonEE.on('message', function handler(message) {
        if (message.workerId !== 'readNoReplyAutoReminderMain') {
          return
        }
        if (message.type === 'worker-exited') {
          daemonEE.off('message', handler)
          resolve(undefined)
        }
      })
    })
    await sendToDaemon(
      {
        type: 'stop-worker',
        workerId: 'readNoReplyAutoReminderMain'
      },
      {
        needCallback: true
      }
    )

    await p
    mainWindow?.webContents.send('read-no-reply-auto-reminder-stopped')
  })

  ipcMain.handle('get-task-manager-list', async () => {
    const result = await sendToDaemon(
      {
        type: 'get-status'
      },
      {
        needCallback: true
      }
    )
    return result
  })

  // IPC处理：停止工具进程
  ipcMain.handle('stop-task', async (_, workerId) => {
    await sendToDaemon(
      {
        type: 'stop-worker',
        workerId
      },
      {
        needCallback: true
      }
    )
  })

  ipcMain.handle('check-boss-zhipin-cookie-file', () => {
    const cookies = readStorageFile('boss-cookies.json')
    return checkCookieListFormat(cookies)
  })

  ipcMain.handle('get-auto-start-chat-record', async (ev, payload: PageReq) => {
    const a = await getAutoStartChatRecord(payload)
    return a
  })
  ipcMain.handle('get-mark-as-not-suit-record', async (ev, payload: PageReq) => {
    const a = await getMarkAsNotSuitRecord(payload)
    return a
  })
  ipcMain.handle('get-job-library', async (ev, payload: PageReq) => {
    const a = await getJobLibrary(payload)
    return a
  })

  let subProcessOfOpenBossSiteDefer: null | PromiseWithResolvers<ChildProcess> = null
  let subProcessOfOpenBossSite: null | ChildProcess = null
  ipcMain.handle('open-site-with-boss-cookie', async (ev, data) => {
    const url = data.url
    if (
      !subProcessOfOpenBossSiteDefer ||
      !subProcessOfOpenBossSite ||
      subProcessOfOpenBossSite.killed
    ) {
      subProcessOfOpenBossSiteDefer = Promise.withResolvers()
      let puppeteerExecutable = await getLastUsedAndAvailableBrowser()
      if (!puppeteerExecutable) {
        try {
          const parent = BrowserWindow.fromWebContents(ev.sender) || undefined
          await configWithBrowserAssistant({
            autoFind: true,
            windowOption: {
              parent,
              modal: !!parent,
              show: true
            }
          })
          puppeteerExecutable = await getLastUsedAndAvailableBrowser()
        } catch (error) {
          //
        }
      }
      if (!puppeteerExecutable) {
        await dialog.showMessageBox({
          type: `error`,
          message: `未找到可用的浏览器`,
          detail: `请重新运行本程序，按照提示安装、配置浏览器`
        })
        return
      }
      const subProcessEnv = {
        ...process.env,
        PUPPETEER_EXECUTABLE_PATH: puppeteerExecutable!.executablePath
      }
      subProcessOfOpenBossSite = childProcess.spawn(
        process.argv[0],
        process.env.NODE_ENV === 'development'
          ? [process.argv[1], `--mode=launchBossSite`]
          : [`--mode=launchBossSite`],
        {
          env: subProcessEnv,
          stdio: ['inherit', 'inherit', 'inherit', 'pipe']
        }
      )
      subProcessOfOpenBossSite.once('exit', () => {
        subProcessOfOpenBossSiteDefer = null
      })
      subProcessOfOpenBossSite.stdio[3]!.pipe(JSONStream.parse()).on(
        'data',
        async function handler(data) {
          switch (data?.type) {
            case 'SUB_PROCESS_OF_OPEN_BOSS_SITE_READY': {
              subProcessOfOpenBossSiteDefer!.resolve(subProcessOfOpenBossSite as ChildProcess)
              break
            }
            case 'SUB_PROCESS_OF_OPEN_BOSS_SITE_CAN_BE_KILLED': {
              try {
                subProcessOfOpenBossSite &&
                  !subProcessOfOpenBossSite.killed &&
                  subProcessOfOpenBossSite.pid &&
                  process.kill(subProcessOfOpenBossSite.pid)
              } catch {
                //
              } finally {
                subProcessOfOpenBossSiteDefer = null
                subProcessOfOpenBossSite = null
              }
              break
            }
          }
        }
      )
    }

    await subProcessOfOpenBossSiteDefer.promise

    pipeWriteRegardlessError(
      subProcessOfOpenBossSite!.stdio[3]! as WriteStream,
      JSON.stringify({
        type: 'NEW_WINDOW',
        url: url ?? 'about:blank'
      })
    )
  })

  ipcMain.handle('get-job-history-by-encrypt-id', async (_, encryptJobId) => {
    return await getJobHistoryByEncryptId(encryptJobId)
  })

  ipcMain.handle('llm-config', async () => {
    createLlmConfigWindow({
      parent: mainWindow!,
      modal: true,
      show: true
    })
    const defer = Promise.withResolvers()
    async function saveLlmConfigHandler(_, configToSave) {
      await writeConfigFile('llm.json', configToSave)
      defer.resolve()
      ipcMain.removeHandler('save-llm-config')
      llmConfigWindow?.close()
    }
    ipcMain.handle('save-llm-config', saveLlmConfigHandler)
    llmConfigWindow?.once('closed', () => {
      ipcMain.removeHandler('save-llm-config')
      defer.reject(new Error('cancel'))
    })
    return defer.promise
  })
  ipcMain.on('close-llm-config', () => llmConfigWindow?.close())

  ipcMain.handle('resume-edit', async () => {
    createResumeEditorWindow({
      parent: mainWindow!,
      modal: true,
      show: true
    })
    const defer = Promise.withResolvers()
    async function saveResumeHandler(_, resumeContent) {
      await writeConfigFile('resumes.json', [
        {
          name: '默认简历',
          updateTime: Number(new Date()),
          content: resumeContent
        }
      ])
      defer.resolve()
      resumeEditorWindow?.close()
    }
    ipcMain.handle('save-resume-content', saveResumeHandler)
    resumeEditorWindow?.once('closed', () => {
      ipcMain.removeHandler('save-resume-content')
      defer.reject(new Error('cancel'))
    })

    return defer.promise
  })
  ipcMain.handle('fetch-resume-content', async () => {
    const res = (await readConfigFile('resumes.json'))?.[0]
    return res?.content ?? null
  })
  ipcMain.on('no-reply-reminder-prompt-edit', async (_, { type }) => {
    const template = await readStorageFile(defaultPromptMap[type].fileName, {
      isJson: false
    })
    if (!template) {
      await writeDefaultAutoRemindPrompt({ type })
    }
    const filePath = path.join(storageFilePath, defaultPromptMap[type].fileName)
    shell.openPath(filePath)
  })
  ipcMain.on('close-resume-editor', () => resumeEditorWindow?.close())
  ipcMain.handle('check-if-auto-remind-prompt-valid', async (_, { type }) => {
    await getValidTemplate({ type })
  })
  ipcMain.handle('check-is-resume-content-valid', async () => {
    const res = (await readConfigFile('resumes.json'))?.[0]
    return checkIsResumeContentValid(res)
  })
  ipcMain.handle('resume-content-enough-detect', async () => {
    const res = (await readConfigFile('resumes.json'))?.[0]
    return resumeContentEnoughDetect(res)
  })
  ipcMain.handle('overwrite-auto-remind-prompt-with-default', async (_, { type }) => {
    await writeDefaultAutoRemindPrompt({ type })
  })
  ipcMain.handle('check-if-llm-config-list-valid', async () => {
    const llmConfigList = await readConfigFile('llm.json')
    if (!Array.isArray(llmConfigList) || !llmConfigList?.length) {
      throw new Error('CANNOT_FIND_VALID_CONFIG')
    }
    if (llmConfigList.some((it) => !/^http(s)?:\/\//.test(it.providerCompleteApiUrl))) {
      throw new Error('CANNOT_FIND_VALID_CONFIG')
    }
    if (llmConfigList.length > 1) {
      const firstEnabledModel = llmConfigList.find((it) => it.enabled)
      if (!firstEnabledModel) {
        throw new Error('CANNOT_FIND_VALID_CONFIG')
      }
    }
  })
  ipcMain.on('test-llm-config-effect', (_, { autoReminderConfig } = {}) => {
    createReadNoReplyReminderLlmMockWindow(
      {
        parent: mainWindow!,
        modal: true,
        show: true
      },
      {
        autoReminderConfig
      }
    )
    async function requestLlm(_, requestPayload) {
      return await requestNewMessageContent(requestPayload.messageList, {
        requestScene: RequestSceneEnum.testing,
        llmConfigIdForPick: requestPayload.llmConfigIdForPick ?? null
      })
    }
    ipcMain.handle('request-llm-for-test', requestLlm)
    readNoReplyReminderLlmMockWindow?.once('closed', () => {
      ipcMain.removeHandler('request-llm-for-test')
    })
    async function getLlmConfigList() {
      return await readConfigFile('llm.json')
    }
    ipcMain.handle('get-llm-config-for-test', getLlmConfigList)
    readNoReplyReminderLlmMockWindow?.once('closed', () => {
      ipcMain.removeHandler('get-llm-config-for-test')
    })
  })
  ipcMain.on('close-read-no-reply-reminder-llm-mock-window', () => {
    readNoReplyReminderLlmMockWindow?.close()
    gtag('mock_chat_window_closed')
  })
  ipcMain.handle('check-update', async () => {
    const newRelease = await checkUpdateForUi()
    return newRelease
  })
  ipcMain.handle('login-with-cookie-assistant', async () => {
    return await loginWithCookieAssistant({
      windowOption: {
        parent: mainWindow!,
        modal: true,
        show: true
      }
    })
  })
  ipcMain.handle('config-with-browser-assistant', async () => {
    return await configWithBrowserAssistant({
      windowOption: {
        parent: mainWindow!,
        modal: true,
        show: true
      }
    })
  })

  ipcMain.handle('pre-enter-setting-ui', async () => {
    if (!isFirstLaunchNoticeApproveFlagExist()) {
      try {
        await waitForUserApproveAgreement({
          windowOption: {
            parent: mainWindow!,
            modal: true,
            show: true
          }
        })
        createFirstLaunchNoticeApproveFlag()
      } catch {
        app.exit(0)
        return
      }
    }
    const puppeteerExecutable = await getAnyAvailablePuppeteerExecutable()
    if (!puppeteerExecutable) {
      const lastBrowser = await getLastUsedAndAvailableBrowser()
      if (!lastBrowser) {
        try {
          await configWithBrowserAssistant({
            windowOption: {
              parent: mainWindow!,
              modal: true,
              show: true
            },
            autoFind: true
          })
        } catch (err) {
          void err
        }
      }
    }
  })
  ipcMain.handle('common-job-condition-config', async () => {
    await waitForCommonJobConditionDone()
    mainWindow?.webContents.send('common-job-condition-config-updated', {
      config: await readConfigFile('common-job-condition-config.json')
    })
  })

  ipcMain.handle('exit-app-immediately', () => {
    app.exit(0)
  })

  // ==================== 招聘端自动回复 IPC ====================

  // 启动招聘端自动回复任务
  ipcMain.handle('run-recruiter-auto-reply', async () => {
    const mode = 'recruiterAutoReplyMain'
    const { runRecordId } = await runCommon({ mode })
    daemonEE.on('message', function handler(message) {
      if (message.workerId !== mode) {
        return
      }
      if (message.type === 'worker-exited') {
        mainWindow?.webContents.send('worker-exited', message)
      }
    })
    return { runRecordId }
  })

  // 停止招聘端自动回复任务
  ipcMain.handle('stop-recruiter-auto-reply', async () => {
    mainWindow?.webContents.send('recruiter-auto-reply-stopping')
    const p = new Promise((resolve) => {
      daemonEE.on('message', function handler(message) {
        if (message.workerId !== 'recruiterAutoReplyMain') {
          return
        }
        if (message.type === 'worker-exited') {
          daemonEE.off('message', handler)
          resolve(undefined)
        }
      })
    })
    await sendToDaemon(
      {
        type: 'stop-worker',
        workerId: 'recruiterAutoReplyMain'
      },
      {
        needCallback: true
      }
    )
    await p
    mainWindow?.webContents.send('recruiter-auto-reply-stopped')
  })

  // 获取招聘者职位配置列表
  ipcMain.handle('recruiter-get-job-config-list', async () => {
    const { getRecruiterJobConfigList } = await import('../utils/db/index')
    return await getRecruiterJobConfigList()
  })

  // 保存招聘者职位配置
  ipcMain.handle('recruiter-save-job-config', async (_, config) => {
    const { saveRecruiterJobConfig } = await import('../utils/db/index')
    return await saveRecruiterJobConfig(config)
  })

  // 删除招聘者职位配置
  ipcMain.handle('recruiter-delete-job-config', async (_, id) => {
    const { deleteRecruiterJobConfig } = await import('../utils/db/index')
    return await deleteRecruiterJobConfig(id)
  })

  // 获取候选人列表
  ipcMain.handle('recruiter-get-candidates', async (_, params) => {
    const { getCandidateConversationList } = await import('../utils/db/index')
    return await getCandidateConversationList(params)
  })

  // 获取每日统计
  ipcMain.handle('recruiter-get-daily-stats', async (_, date, encryptJobId) => {
    const { getRecruiterDailyStats } = await import('../utils/db/index')
    return await getRecruiterDailyStats(date, encryptJobId)
  })

  // 获取处理日志
  ipcMain.handle('recruiter-get-process-logs', async (_, params) => {
    const { getRecruiterProcessLogList } = await import('../utils/db/index')
    return await getRecruiterProcessLogList(params)
  })

  // 保存招聘者每日统计
  ipcMain.handle('recruiter-save-daily-stats', async (_, stats) => {
    const { saveRecruiterDailyStats } = await import('../utils/db/index')
    return await saveRecruiterDailyStats(stats)
  })

  // 获取招聘者配置
  ipcMain.handle('recruiter-get-config', async () => {
    const config = readConfigFile('boss.json')
    return config?.recruiterAutoReply || {}
  })

  // 保存招聘者配置
  ipcMain.handle('recruiter-save-config', async (_, config) => {
    const bossConfig = readConfigFile('boss.json')
    bossConfig.recruiterAutoReply = config
    await writeConfigFile('boss.json', bossConfig)
    return true
  })

  // ==================== 招聘者模版 IPC ====================

  // 获取模版列表
  ipcMain.handle('recruiter-get-templates', async (_, params) => {
    const { getRecruiterTemplateList } = await import('../utils/db/index')
    return await getRecruiterTemplateList(params)
  })

  // 保存模版
  ipcMain.handle('recruiter-save-template', async (_, template) => {
    const { saveRecruiterTemplate } = await import('../utils/db/index')
    return await saveRecruiterTemplate(template)
  })

  // 删除模版
  ipcMain.handle('recruiter-delete-template', async (_, id) => {
    const { deleteRecruiterTemplate } = await import('../utils/db/index')
    return await deleteRecruiterTemplate(id)
  })

  // 获取单个模版
  ipcMain.handle('recruiter-get-template', async (_, id) => {
    const { getRecruiterTemplateById } = await import('../utils/db/index')
    return await getRecruiterTemplateById(id)
  })

  // ==================== 招聘端已回复联系人 IPC ====================

  // 获取已回复联系人列表
  ipcMain.handle('recruiter-get-contacted-candidates', async (_, params) => {
    const { getContactedCandidateList } = await import('../utils/db/index')
    return await getContactedCandidateList(params)
  })

  // 保存已回复联系人
  ipcMain.handle('recruiter-save-contacted-candidate', async (_, candidate) => {
    const { saveContactedCandidate } = await import('../utils/db/index')
    return await saveContactedCandidate(candidate)
  })

  // 删除已回复联系人
  ipcMain.handle('recruiter-delete-contacted-candidate', async (_, id) => {
    const { deleteContactedCandidate } = await import('../utils/db/index')
    return await deleteContactedCandidate(id)
  })

  // 获取已回复联系人数量
  ipcMain.handle('recruiter-get-contacted-candidate-count', async (_, params) => {
    const { getContactedCandidateCount } = await import('../utils/db/index')
    return await getContactedCandidateCount(params)
  })

  // ==================== 智能回复 IPC ====================

  // 启动智能回复任务
  ipcMain.handle('run-smart-reply', async () => {
    const mode = 'smartReplyMain'
    const { runRecordId } = await runCommon({ mode })
    daemonEE.on('message', function handler(message) {
      if (message.workerId !== mode) {
        return
      }
      if (message.type === 'worker-exited') {
        mainWindow?.webContents.send('worker-exited', message)
      }
    })
    return { runRecordId }
  })

  // 停止智能回复任务
  ipcMain.handle('stop-smart-reply', async () => {
    mainWindow?.webContents.send('smart-reply-stopping')
    const p = new Promise((resolve) => {
      daemonEE.on('message', function handler(message) {
        if (message.workerId !== 'smartReplyMain') {
          return
        }
        if (message.type === 'worker-exited') {
          daemonEE.off('message', handler)
          resolve(undefined)
        }
      })
    })
    await sendToDaemon(
      {
        type: 'stop-worker',
        workerId: 'smartReplyMain'
      },
      {
        needCallback: true
      }
    )
    await p
    mainWindow?.webContents.send('smart-reply-stopped')
  })

  // 获取智能回复数据
  ipcMain.handle('get-smart-reply-records', async (_, params) => {
    const { getSmartReplyRecords } = await import('../utils/db/index')
    return await getSmartReplyRecords(params)
  })

  // 获取智能回复会话列表
  ipcMain.handle('get-smart-reply-sessions', async () => {
    const { getSmartReplySessions } = await import('../utils/db/index')
    return await getSmartReplySessions()
  })

  // 测试智能回复 API 连接
  ipcMain.handle('test-smart-reply-api', async () => {
    const { testLlmConnection } = await import('../../SMART_REPLY_MAIN/llm-reply')
    return await testLlmConnection()
  })

  // ==================== 面试自动化 IPC ====================

  // 获取面试岗位配置列表
  ipcMain.handle('interview-get-job-list', async () => {
    const { getInterviewJobPositionList } = await import('../utils/db/index')
    const result = await getInterviewJobPositionList()
    // result is { data: actualArray } from worker wrapper, extract actual data
    return { success: true, data: result?.data || [] }
  })

  // 获取面试岗位配置详情
  ipcMain.handle('interview-get-job-detail', async (_, id: number) => {
    const { getInterviewJobPositionWithDetails } = await import('../utils/db/index')
    const result = await getInterviewJobPositionWithDetails(id)
    return { success: true, data: result?.data }
  })

  // 保存面试岗位配置
  ipcMain.handle('interview-save-job', async (_, data: any) => {
    try {
      const {
        saveInterviewJobPosition,
        saveInterviewQuestionRound
      } = await import('../utils/db/index')

      const result = await saveInterviewJobPosition(data)
      // result is { data: savedEntity } from worker wrapper
      const savedJob = result?.data

      // 保存问题轮次
      if (savedJob?.id && data.questionRounds) {
        for (const round of data.questionRounds) {
          await saveInterviewQuestionRound({
            ...round,
            jobPositionId: savedJob.id
          })
        }
      }

      return { success: true, data: savedJob }
    } catch (error: any) {
      console.error('interview-save-job error:', error)
      return { success: false, error: error?.message }
    }
  })

  // 删除面试岗位配置
  ipcMain.handle('interview-delete-job', async (_, id: number) => {
    const { deleteInterviewJobPosition } = await import('../utils/db/index')
    await deleteInterviewJobPosition(id)
    return { success: true }
  })

  // 获取候选人列表
  ipcMain.handle('interview-get-candidates', async (_, params: any) => {
    const { getInterviewCandidateList } = await import('../utils/db/index')
    const result = await getInterviewCandidateList(params)
    // result?.data is { data: array, total: number, page, pageSize } from worker
    const actualData = result?.data || {}
    return {
      success: true,
      data: {
        list: actualData.data || [],
        total: actualData.total || 0,
        page: actualData.page,
        pageSize: actualData.pageSize
      }
    }
  })

  // 获取候选人详情
  ipcMain.handle('interview-get-candidate-detail', async (_, id: number) => {
    const {
      getInterviewCandidate,
      getInterviewQaRecordList,
      getInterviewResume
    } = await import('../utils/db/index')

    const candidateResult = await getInterviewCandidate(id)
    const qaResult = await getInterviewQaRecordList(id)
    const resumeResult = await getInterviewResume(id)

    return {
      success: true,
      data: {
        candidate: candidateResult?.data,
        qaRecords: qaResult?.data,
        resume: resumeResult?.data
      }
    }
  })

  // 获取候选人统计数据
  ipcMain.handle('interview-get-candidate-stats', async () => {
    const { countInterviewCandidatesByStatus } = await import('../utils/db/index')
    const result = await countInterviewCandidatesByStatus()
    return { success: true, data: result?.data }
  })

  // 获取系统配置
  ipcMain.handle('interview-get-config', async (_, key: string) => {
    const { getInterviewSystemConfig } = await import('../utils/db/index')
    const result = await getInterviewSystemConfig(key)
    return { success: true, data: result?.data }
  })

  // 获取所有系统配置
  ipcMain.handle('interview-get-all-config', async () => {
    const { getAllInterviewSystemConfig } = await import('../utils/db/index')
    const result = await getAllInterviewSystemConfig()
    return { success: true, data: result?.data }
  })

  // 保存系统配置
  ipcMain.handle('interview-save-config', async (_, key: string, value: string) => {
    const { saveInterviewSystemConfig } = await import('../utils/db/index')
    await saveInterviewSystemConfig(key, value)
    return { success: true }
  })

  // 测试 SMTP 连接
  ipcMain.handle('interview-test-smtp', async (_, config: any) => {
    try {
      const nodemailer = await import('nodemailer')
      const transporter = nodemailer.default.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        connectionTimeout: 10000,
        socketTimeout: 10000
      })
      await transporter.verify()
      return { success: true, data: { success: true } }
    } catch (error: any) {
      return { success: true, data: { success: false, error: error?.message } }
    }
  })

  // 保存邮件配置
  ipcMain.handle('interview-save-email-config', async (_, config: any) => {
    try {
      const { saveInterviewSystemConfig } = await import('../utils/db/index')
      await saveInterviewSystemConfig('smtp_config', JSON.stringify(config), true)
      return { success: true }
    } catch (error: any) {
      console.error('interview-save-email-config error:', error)
      return { success: false, error: error?.message }
    }
  })

  // 发送测试邮件
  ipcMain.handle('interview-send-test-email', async (_, config: any) => {
    try {
      const nodemailer = await import('nodemailer')
      const transporter = nodemailer.default.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        connectionTimeout: 10000,
        socketTimeout: 10000
      })

      // 发送测试邮件
      await transporter.sendMail({
        from: config.user,
        to: config.recipient,
        subject: '【面试自动化】测试邮件',
        text: '这是一封测试邮件，来自面试自动化系统。如果您收到此邮件，说明SMTP配置正确。',
        html: `
          <div style="padding: 20px; background: #f5f5f5; border-radius: 8px;">
            <h2 style="color: #409eff;">面试自动化系统</h2>
            <p>这是一封测试邮件。</p>
            <p>如果您收到此邮件，说明SMTP配置正确，邮件发送功能正常工作。</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
            <p style="color: #999; font-size: 12px;">发送时间：${new Date().toLocaleString('zh-CN')}</p>
          </div>
        `
      })

      return { success: true, data: { success: true } }
    } catch (error: any) {
      console.error('interview-send-test-email error:', error)
      return { success: true, data: { success: false, error: error?.message } }
    }
  })

  // 面试手动测试
  ipcMain.handle('interview-manual-test', async () => {
    try {
      const { runManualTest } = await import('../../INTERVIEW_AUTO_MAIN/manual-test')
      // 异步执行，不阻塞
      runManualTest().catch(err => {
        console.error('interview-manual-test error:', err)
      })
      return { success: true }
    } catch (error: any) {
      console.error('interview-manual-test error:', error)
      return { success: false, error: error?.message }
    }
  })

  // 启动面试自动化任务
  ipcMain.handle('run-interview-auto', async () => {
    const mode = 'interviewAutoMain'
    const { runRecordId } = await runCommon({ mode })
    daemonEE.on('message', function handler(message) {
      if (message.workerId !== mode) {
        return
      }
      if (message.type === 'worker-exited') {
        mainWindow?.webContents.send('worker-exited', message)
      }
    })
    return { runRecordId }
  })

  // 停止面试自动化任务
  ipcMain.handle('stop-interview-auto', async () => {
    mainWindow?.webContents.send('interview-auto-stopping')
    const p = new Promise((resolve) => {
      daemonEE.on('message', function handler(message) {
        if (message.workerId !== 'interviewAutoMain') {
          return
        }
        if (message.type === 'worker-exited') {
          daemonEE.off('message', handler)
          resolve(undefined)
        }
      })
    })
    await sendToDaemon(
      { type: 'stop-worker', workerId: 'interviewAutoMain' },
      { needCallback: true }
    )
    await p
    mainWindow?.webContents.send('interview-auto-stopped')
  })
}
