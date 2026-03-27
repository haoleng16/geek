import minimist from 'minimist'
import { runCommon } from '../../features/run-common'
import { launchDaemon } from '../OPEN_SETTING_WINDOW/launch-daemon'
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
import { bootstrap, launchBoss } from './bootstrap'
import type { ChatListItem } from '../READ_NO_REPLY_AUTO_REMINDER_MAIN/types'
import { sendMessage } from '../READ_NO_REPLY_AUTO_REMINDER_MAIN/boss-operation'
import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { checkCookieListFormat } from '../../../common/utils/cookie'
import { loginWithCookieAssistant } from '../../features/login-with-cookie-assistant'
import type { Browser } from 'puppeteer'
import { startNewSession, getCurrentSessionId, getReplyCount, getOrCreateRecord, updateLastLlmReply } from './session-manager'
import { containsSensitiveWord, isMessageTooShort } from './sensitive-words'
import { generateSmartReply, type SmartReplyConfig } from './llm-reply'

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在退出')
  process.exit(0)
})

export const pageMapByName: {
  boss?: any | null
} = {}

let browser: null | Browser = null
let dataSource: DataSource | null = null

// 初始化数据库
const dbInitPromise = initDb(getPublicDbFilePath())

// 获取智能回复配置
function getSmartReplyConfig() {
  const raw = readConfigFile('boss.json')?.smartReply ?? {}
  const scanIntervalSeconds = Number(raw.scanIntervalSeconds)
  return {
    scanIntervalSeconds: Number.isFinite(scanIntervalSeconds) && scanIntervalSeconds > 0
      ? Math.min(60, Math.max(1, scanIntervalSeconds))
      : 5,
    autoSend: raw.autoSend === true,
    confirmBeforeSend: raw.confirmBeforeSend !== false,
    companyIntro: String(raw.companyIntro ?? '').trim(),
    jobDescription: String(raw.jobDescription ?? '').trim(),
    systemPrompt: String(raw.systemPrompt ?? '').trim(),
    maxReplyCount: Math.max(1, Math.min(10, Number(raw.maxReplyCount) || 3))
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
  console.log('[SmartReply MainLoop] 开始执行...')

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
  console.log('[SmartReply MainLoop] 正在启动浏览器...')
  browser = await bootstrap()
  console.log('[SmartReply MainLoop] 浏览器已启动')

  // 检查 cookie 是否存在
  let bossCookies = readStorageFile('boss-cookies.json')
  let cookieCheckResult = checkCookieListFormat(bossCookies)
  console.log('[SmartReply MainLoop] Cookie 检查结果:', cookieCheckResult)

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

  // 导航到 BOSS 直聘
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

  const cfg = getSmartReplyConfig()

  // 检查配置是否完整
  if (!cfg.companyIntro && !cfg.jobDescription) {
    await dialog.showMessageBox({
      type: 'warning',
      message: '配置不完整',
      detail: '请在设置中配置公司简介和岗位说明，否则无法生成智能回复。',
      buttons: ['退出']
    })
    process.exit(0)
  }

  // 启动新会话
  const sessionId = startNewSession()

  let cursorToContinueFind = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await pageMapByName.boss?.waitForFunction(() => {
      return Array.isArray(document.querySelector('.main-wrap .chat-user')?.__vue__?.list)
    })

    const friendListData = (await pageMapByName.boss!.evaluate(
      `
        document.querySelector('.main-wrap .chat-user')?.__vue__?.list
      `
    )) as Array<ChatListItem>

    console.log('[SmartReply MainLoop] 消息列表数量:', friendListData?.length)

    const toCheckItemAtIndex = friendListData.findIndex((it, index) => {
      const result = index >= cursorToContinueFind && !it.lastIsSelf && Number(it.unreadCount) > 0
      return result
    })

    console.log('[SmartReply MainLoop] toCheckItemAtIndex:', toCheckItemAtIndex, 'cursorToContinueFind:', cursorToContinueFind)

    if (toCheckItemAtIndex < 0) {
      const isFinished = await pageMapByName.boss!.evaluate(
        `(document.querySelector(
          '.main-wrap .chat-user .user-list-content div[role=tfoot] .finished'
          )?.textContent ?? '').includes('没有')`
      )
      if (isFinished) {
        console.log('[SmartReply MainLoop] 所有消息处理完毕，等待新消息...')
        cursorToContinueFind = 0
        await pageMapByName.boss?.evaluate(() => {
          ;(() => {
            document
              .querySelector('.chat-content .user-list .user-list-content')
              ?.__vue__.scrollToIndex(0)
          })()
        })
        await sleep(cfg.scanIntervalSeconds * 1000)
      } else {
        cursorToContinueFind = friendListData.length - 1
        await pageMapByName.boss?.evaluate(() => {
          ;(() => {
            document
              .querySelector('.chat-content .user-list .user-list-content')
              ?.__vue__.scrollToBottom()
          })()
        })
        await sleep(3000)
      }
      continue
    }

    cursorToContinueFind = toCheckItemAtIndex
    await pageMapByName.boss?.evaluate((toCheckItemAtIndex) => {
      ;(() => {
        document
          .querySelector('.chat-content .user-list .user-list-content')
          ?.__vue__.scrollToIndex(toCheckItemAtIndex)
      })()
    }, toCheckItemAtIndex)
    await sleep(1200)

    const targetChat = friendListData[toCheckItemAtIndex]
    console.log('[SmartReply MainLoop] targetChat:', JSON.stringify({
      name: targetChat.name,
      encryptGeekId: (targetChat as any).encryptGeekId,
      title: (targetChat as any).title
    }))

    const targetElProxy = await (async () => {
      const jsHandle = (
        await pageMapByName.boss?.evaluateHandle((source) => {
          const jobLiEls = document.querySelectorAll(
            '.main-wrap .chat-user .user-list-content ul[role=group] li[role=listitem]'
          )
          return (
            [...jobLiEls].find((it) => it.__vue__?.source?.encryptJobId === source.encryptJobId) ??
            [...jobLiEls].find((it) => it.__vue__?.source?.friendId === source.friendId)
          )
        }, targetChat)
      )?.asElement()
      return jsHandle
    })()

    await targetElProxy?.click()
    try {
      await pageMapByName.boss!.waitForResponse(
        (response) => {
          const url = response.url()
          return url.startsWith('https://www.zhipin.com/wapi/zpchat/') && url.includes('/historyMsg')
        },
        {
          timeout: 30 * 1000
        }
      )
    } catch {
      // ignore response wait timeout, try to continue with DOM data
    }

    await sleepWithRandomDelay(1000)

    const historyMessageList =
      (
        await pageMapByName.boss?.evaluate(() => {
          return document.querySelector('.message-content .chat-record')?.__vue__?.list$ ?? []
        })
      ) ?? []

    console.log('[SmartReply MainLoop] 历史消息数量:', historyMessageList?.length)
    if (historyMessageList?.length > 0) {
      console.log('[SmartReply MainLoop] 最后一条消息:', JSON.stringify(historyMessageList[historyMessageList.length - 1]))
    }

    const lastMsg = historyMessageList?.[historyMessageList.length - 1]
    if (!lastMsg || lastMsg.isSelf) {
      console.log('[SmartReply MainLoop] 没有消息或最后一条是自己发的，跳过')
      cursorToContinueFind += 1
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

    // 获取候选人信息
    const encryptGeekId = (targetChat as any).encryptGeekId || ''
    const encryptJobId = (targetChat as any).encryptJobId || ''
    // 兼容不同的消息格式：可能是 text 或 content
    const candidateMessage = lastMsg.text || lastMsg.content || ''

    console.log('[SmartReply MainLoop] 候选人消息:', candidateMessage.substring(0, 50))

    // 边界检查
    if (isMessageTooShort(candidateMessage)) {
      console.log('[SmartReply MainLoop] 消息过短，跳过')
      cursorToContinueFind += 1
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

    if (containsSensitiveWord(candidateMessage)) {
      console.log('[SmartReply MainLoop] 消息包含敏感词，跳过')
      cursorToContinueFind += 1
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

    // 检查是否是已读不回（候选人已读但没回复）
    const isReadNoReply = (lastMsg as any).status === 'read' && !lastMsg.isSelf
    if (isReadNoReply) {
      console.log('[SmartReply MainLoop] 已读不回消息，跳过')
      cursorToContinueFind += 1
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

    // 检查回复次数
    const replyCount = await getReplyCount(dataSource!, sessionId, encryptGeekId)
    console.log('[SmartReply MainLoop] 当前回复次数:', replyCount, '最大次数:', cfg.maxReplyCount)

    if (replyCount >= cfg.maxReplyCount) {
      console.log('[SmartReply MainLoop] 已达到最大回复次数，跳过')
      cursorToContinueFind += 1
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

    // 调用LLM生成回复
    const llmConfig: SmartReplyConfig = {
      companyIntro: cfg.companyIntro,
      jobDescription: cfg.jobDescription,
      systemPrompt: cfg.systemPrompt
    }

    const llmResult = await generateSmartReply(llmConfig, historyMessageList, candidateMessage)
    console.log('[SmartReply MainLoop] LLM响应:', llmResult)

    if (!llmResult.isClear || !llmResult.reply) {
      console.log('[SmartReply MainLoop] LLM无法生成明确回复，跳过')
      cursorToContinueFind += 1
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

    // 随机延迟 1-3秒
    await sleepWithRandomDelay(1000, 3000)

    // 发送或确认
    if (cfg.autoSend) {
      // 自动发送
      console.log('[SmartReply MainLoop] 自动发送回复:', llmResult.reply.substring(0, 50))
      await sendMessage(pageMapByName.boss!, llmResult.reply)
    } else {
      // 弹窗确认
      const res = await dialog.showMessageBox({
        type: 'question',
        message: `发现新消息：${targetChat?.name ?? '候选人'}`,
        detail: `智能回复建议：\n\n${llmResult.reply}\n\n是否发送此回复？`,
        buttons: ['发送', '跳过', '停止任务'],
        defaultId: 0,
        cancelId: 1
      })

      if (res.response === 2) {
        // 停止任务
        process.exit(0)
      }
      if (res.response === 1) {
        // 跳过
        cursorToContinueFind += 1
        await sleep(cfg.scanIntervalSeconds * 1000)
        continue
      }

      // 发送
      console.log('[SmartReply MainLoop] 用户确认发送回复')
      await sendMessage(pageMapByName.boss!, llmResult.reply)
    }

    // 保存回复记录
    console.log('[SmartReply MainLoop] 保存回复记录...')
    try {
      await getOrCreateRecord(dataSource!, sessionId, encryptGeekId, {
        geekName: targetChat.name,
        encryptJobId,
        jobName: (targetChat as any).title
      })
      await updateLastLlmReply(dataSource!, sessionId, encryptGeekId, llmResult.reply)
    } catch (saveErr) {
      console.error('[SmartReply MainLoop] 保存回复记录失败:', saveErr)
    }

    cursorToContinueFind += 1
    await sleep(cfg.scanIntervalSeconds * 1000)
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
  console.log('[SmartReply runEntry] 开始执行...')
  app.dock?.hide()
  await app.whenReady()
  console.log('[SmartReply runEntry] app ready')
  app.on('window-all-closed', (e) => {
    e.preventDefault()
  })
  initPublicIpc()
  await connectToDaemon()
  console.log('[SmartReply runEntry] 已连接到 daemon')
  await sendToDaemon(
    {
      type: 'ping'
    },
    {
      needCallback: true
    }
  )
  console.log('[SmartReply runEntry] daemon ping 成功')
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

  console.log('[SmartReply runEntry] 正在检查浏览器...')
  let puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  console.log('[SmartReply runEntry] 浏览器检查结果:', puppeteerExecutable ? puppeteerExecutable.executablePath : 'null')

  if (!puppeteerExecutable) {
    console.log('[SmartReply runEntry] 未找到浏览器，尝试自动配置...')
    try {
      await configWithBrowserAssistant({ autoFind: true })
      console.log('[SmartReply runEntry] 浏览器配置完成')
    } catch (e) {
      console.error('[SmartReply runEntry] 浏览器配置失败:', e)
    }
    puppeteerExecutable = await getLastUsedAndAvailableBrowser()
    console.log('[SmartReply runEntry] 再次检查浏览器:', puppeteerExecutable ? puppeteerExecutable.executablePath : 'null')
  }
  if (!puppeteerExecutable) {
    console.error('[SmartReply runEntry] 未找到可用的浏览器')
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
  console.log('[SmartReply runEntry] PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH)

  // 初始化数据库
  console.log('[SmartReply runEntry] 正在初始化数据库...')
  try {
    dataSource = await dbInitPromise
    console.log('[SmartReply runEntry] 数据库初始化成功')
  } catch (dbErr) {
    console.error('[SmartReply runEntry] 数据库初始化失败:', dbErr)
  }

  console.log('[SmartReply runEntry] 开始执行 mainLoop...')
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