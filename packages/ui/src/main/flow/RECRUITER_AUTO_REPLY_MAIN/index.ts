import { bootstrap, launchBoss } from './bootstrap'
import type { ChatListItem } from '../READ_NO_REPLY_AUTO_REMINDER_MAIN/types'
import type { Browser } from 'puppeteer'
import { sendMessage } from '../READ_NO_REPLY_AUTO_REMINDER_MAIN/boss-operation'
import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { app, dialog } from 'electron'
import minimist from 'minimist'
import { checkCookieListFormat } from '../../../common/utils/cookie'
import { loginWithCookieAssistant } from '../../features/login-with-cookie-assistant'
import initPublicIpc from '../../utils/initPublicIpc'
import { connectToDaemon, sendToDaemon } from '../OPEN_SETTING_WINDOW/connect-to-daemon'
import { checkShouldExit } from '../../utils/worker'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { configWithBrowserAssistant } from '../../features/config-with-browser-assistant'
import { writeStorageFile, readStorageFile, readConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../../common/enums/auto-start-chat'

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在退出')
  process.exit(0)
})

export const pageMapByName: {
  boss?: any | null
} = {}

function getRecruiterAutoReplyConfig() {
  const raw = readConfigFile('boss.json')?.recruiterAutoReply ?? {}
  const scanIntervalSeconds = Number(raw.scanIntervalSeconds)
  return {
    scanIntervalSeconds: Number.isFinite(scanIntervalSeconds) && scanIntervalSeconds > 0
      ? Math.min(60, Math.max(1, scanIntervalSeconds))
      : 5,
    autoSend: raw.autoSend === true,
    confirmBeforeSend: raw.confirmBeforeSend !== false,
    constantReplyContent: String(raw.constantReplyContent ?? '').trim()
  }
}

function getReplyContent(): string {
  const bossConfig = readConfigFile('boss.json') ?? {}
  const replyStrategy = bossConfig.replyStrategy ?? {}
  const quickReply = bossConfig.quickReply ?? { list: [] }

  // 根据回复策略获取回复内容
  switch (replyStrategy.matchReplyMode) {
    case 'first_quick_reply': {
      const firstEnabled = (quickReply.list ?? []).find((item: any) => item.enabled)
      return firstEnabled?.content ?? ''
    }
    case 'random_quick_reply': {
      const enabledList = (quickReply.list ?? []).filter((item: any) => item.enabled)
      if (enabledList.length === 0) return ''
      const randomItem = enabledList[Math.floor(Math.random() * enabledList.length)]
      return randomItem?.content ?? ''
    }
    case 'constant':
    default:
      return String(replyStrategy.matchReplyContent ?? '').trim()
  }
}

let browser: null | Browser = null

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
  console.log('[mainLoop] 开始执行...')

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
  console.log('[mainLoop] 正在启动浏览器...')
  browser = await bootstrap()
  console.log('[mainLoop] 浏览器已启动')

  // 检查 cookie 是否存在
  let bossCookies = readStorageFile('boss-cookies.json')
  let cookieCheckResult = checkCookieListFormat(bossCookies)
  console.log('[mainLoop] Cookie 检查结果:', cookieCheckResult)

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

  const cfg = getRecruiterAutoReplyConfig()
  const replyContent = getReplyContent()
  if (!replyContent && (cfg.autoSend || cfg.confirmBeforeSend)) {
    await dialog.showMessageBox({
      type: 'warning',
      message: '快捷回复内容为空',
      detail: '请在设置中配置“回复策略”或添加“快捷回复”，否则无法发送消息。',
      buttons: ['退出']
    })
    process.exit(0)
  }

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

    const toCheckItemAtIndex = friendListData.findIndex((it, index) => {
      return index >= cursorToContinueFind && !it.lastIsSelf && Number(it.unreadCount) > 0
    })

    if (toCheckItemAtIndex < 0) {
      const isFinished = await pageMapByName.boss!.evaluate(
        `(document.querySelector(
          '.main-wrap .chat-user .user-list-content div[role=tfoot] .finished'
          )?.textContent ?? '').includes('没有')`
      )
      if (isFinished) {
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

    const lastMsg = historyMessageList?.[historyMessageList.length - 1]
    if (!lastMsg || lastMsg.isSelf) {
      cursorToContinueFind += 1
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

    if (!cfg.autoSend) {
      if (cfg.confirmBeforeSend) {
        const previewReplyContent = getReplyContent()
        const res = await dialog.showMessageBox({
          type: 'question',
          message: `发现新消息：${targetChat?.name ?? ''}`,
          detail: `是否发送快捷回复？\n\n${previewReplyContent}`,
          buttons: ['发送', '跳过', '停止任务'],
          defaultId: 0,
          cancelId: 1
        })
        if (res.response === 2) {
          process.exit(0)
        }
        if (res.response !== 0) {
          cursorToContinueFind += 1
          await sleep(cfg.scanIntervalSeconds * 1000)
          continue
        }
      } else {
        // assist mode without sending; give user a little time to reply manually
        await sleep(15 * 1000)
        cursorToContinueFind += 1
        continue
      }
    }

    const currentReplyContent = getReplyContent()
    await sendMessage(pageMapByName.boss!, currentReplyContent)
    await sleepWithRandomDelay(1500)

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
  console.log('[runEntry] 开始执行...')
  app.dock?.hide()
  await app.whenReady()
  console.log('[runEntry] app ready')
  app.on('window-all-closed', (e) => {
    e.preventDefault()
  })
  initPublicIpc()
  await connectToDaemon()
  console.log('[runEntry] 已连接到 daemon')
  await sendToDaemon(
    {
      type: 'ping'
    },
    {
      needCallback: true
    }
  )
  console.log('[runEntry] daemon ping 成功')
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

  console.log('[runEntry] 正在检查浏览器...')
  let puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  console.log('[runEntry] 浏览器检查结果:', puppeteerExecutable ? puppeteerExecutable.executablePath : 'null')

  if (!puppeteerExecutable) {
    console.log('[runEntry] 未找到浏览器，尝试自动配置...')
    try {
      await configWithBrowserAssistant({ autoFind: true })
      console.log('[runEntry] 浏览器配置完成')
    } catch (e) {
      console.error('[runEntry] 浏览器配置失败:', e)
    }
    puppeteerExecutable = await getLastUsedAndAvailableBrowser()
    console.log('[runEntry] 再次检查浏览器:', puppeteerExecutable ? puppeteerExecutable.executablePath : 'null')
  }
  if (!puppeteerExecutable) {
    console.error('[runEntry] 未找到可用的浏览器')
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
  console.log('[runEntry] PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH)

  console.log('[runEntry] 开始执行 mainLoop...')
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

