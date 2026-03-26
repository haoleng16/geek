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
import { getCandidateResumeFromDOM } from './candidate-resume'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { RecruiterContactedCandidate } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterContactedCandidate'
import type { DataSource } from 'typeorm'

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
let dataSource: DataSource | null = null

// 初始化数据库
const dbInitPromise = initDb(getPublicDbFilePath())

// 当前所在的Tab
let currentTab: 'unread' | 'all' = 'all'

// 点击Tab切换
async function switchTab(page: any, tab: 'unread' | 'all'): Promise<void> {
  if (currentTab === tab) {
    console.log(`[switchTab] 已经在 ${tab} Tab，跳过切换`)
    return
  }

  console.log(`[switchTab] 切换到 ${tab} Tab`)

  const tabText = tab === 'unread' ? '未读' : '全部'

  const clicked = await page.evaluate((text) => {
    // 找到Tab元素
    const tabs = document.querySelectorAll('.chat-user .tabs-item, .tab-item, [role="tab"]')
    for (const tabEl of tabs) {
      if (tabEl.textContent?.trim() === text) {
        ;(tabEl as HTMLElement).click()
        return true
      }
    }
    return false
  }, tabText)

  console.log(`[switchTab] 点击结果: ${clicked}`)

  await sleep(1500)
  currentTab = tab

  // 验证当前Tab状态
  const currentTabState = await page.evaluate(() => {
    const tabs = document.querySelectorAll('.chat-user .tabs-item, .tab-item, [role="tab"]')
    const result: any = { tabs: [] }
    for (const tabEl of tabs) {
      result.tabs.push({
        text: tabEl.textContent?.trim(),
        className: tabEl.className,
        isActive: tabEl.className.includes('active') || tabEl.className.includes('selected')
      })
    }
    return result
  })
  console.log(`[switchTab] 当前Tab状态:`, JSON.stringify(currentTabState))
}

// 保存已回复联系人（兼容求职者端和招聘者端）
async function saveContactedCandidate(
  page: any,
  targetChat: any,
  jobName?: string
): Promise<void> {
  try {
    console.log('[saveContactedCandidate] 开始保存联系人, targetChat:', JSON.stringify(targetChat))

    const ds = await dbInitPromise
    const repo = ds.getRepository(RecruiterContactedCandidate)

    // 尝试从页面获取更多信息
    const candidateInfo = await getCandidateResumeFromDOM(page)
    console.log('[saveContactedCandidate] 从DOM获取的信息:', JSON.stringify(candidateInfo))

    // 从页面获取联系人ID（兼容招聘端和求职者端）
    const pageInfo = await page.evaluate(() => {
      const result: any = {}

      // 尝试从Vue组件获取
      const geekInfoVue = document.querySelector('.geek-info')?.__vue__
      const bossInfoVue = document.querySelector('.boss-info')?.__vue__
      const chatRecordVue = document.querySelector('.chat-conversation .chat-record')?.__vue__
      const chatUserVue = document.querySelector('.chat-user')?.__vue__

      console.log('geekInfoVue:', geekInfoVue)
      console.log('bossInfoVue:', bossInfoVue)
      console.log('chatRecordVue:', chatRecordVue)
      console.log('chatUserVue:', chatUserVue)

      // 招聘端：获取候选人信息
      if (geekInfoVue?.geek) {
        result.geek = geekInfoVue.geek
      }
      if (chatRecordVue?.geek) {
        result.geek = chatRecordVue.geek
      }

      // 求职者端：获取BOSS信息
      if (bossInfoVue?.boss) {
        result.boss = bossInfoVue.boss
      }
      if (chatRecordVue?.boss) {
        result.boss = chatRecordVue.boss
      }

      if (chatUserVue) {
        result.list = chatUserVue.list
      }

      // 尝试从右侧信息面板获取
      const rightBox = document.querySelector('.right-box')
      if (rightBox) {
        const nameEl = rightBox.querySelector('.name, .geek-name, .boss-name, [class*="name"]')
        const companyEl = rightBox.querySelector('.company, [class*="company"]')
        const positionEl = rightBox.querySelector('.position, [class*="job"]')
        const salaryEl = rightBox.querySelector('.salary, [class*="salary"]')

        if (nameEl) result.domName = nameEl.textContent?.trim()
        if (companyEl) result.domCompany = companyEl.textContent?.trim()
        if (positionEl) result.domPosition = positionEl.textContent?.trim()
        if (salaryEl) result.domSalary = salaryEl.textContent?.trim()
      }

      return result
    })

    console.log('[saveContactedCandidate] 从页面获取的完整信息:', JSON.stringify(pageInfo))

    // 判断是招聘端还是求职者端
    const isRecruiterMode = !!targetChat.encryptGeekId
    const isJobSeekerMode = !!targetChat.encryptBossId

    console.log('[saveContactedCandidate] 模式检测: isRecruiterMode=' + isRecruiterMode + ', isJobSeekerMode=' + isJobSeekerMode)

    // 根据模式获取正确的ID
    let encryptGeekId: string
    let encryptJobId: string
    let contactName: string
    let companyName: string
    let position: string

    if (isRecruiterMode) {
      // 招聘端：encryptGeekId是候选人ID
      encryptGeekId = pageInfo.geek?.encryptGeekId || candidateInfo.encryptGeekId || targetChat.encryptGeekId || ''
      encryptJobId = targetChat.encryptJobId || ''
      contactName = candidateInfo.name || pageInfo.domName || pageInfo.geek?.name || targetChat.name || ''
      companyName = candidateInfo.currentCompany || pageInfo.domCompany || pageInfo.geek?.company || targetChat.brandName || ''
      position = candidateInfo.currentJob || pageInfo.domPosition || pageInfo.geek?.position || ''
    } else {
      // 求职者端：encryptBossId是招聘者ID，使用friendId作为唯一标识
      encryptGeekId = pageInfo.boss?.encryptBossId || targetChat.encryptBossId || targetChat.friendId?.toString() || ''
      encryptJobId = targetChat.encryptJobId || ''
      contactName = pageInfo.domName || pageInfo.boss?.name || targetChat.name || ''
      companyName = pageInfo.domCompany || pageInfo.boss?.company || targetChat.brandName || ''
      position = pageInfo.domPosition || pageInfo.boss?.position || targetChat.title || ''
    }

    console.log('[saveContactedCandidate] encryptGeekId:', encryptGeekId, 'encryptJobId:', encryptJobId, 'contactName:', contactName)

    if (!encryptGeekId) {
      console.warn('[saveContactedCandidate] 缺少必要ID，跳过保存')
      return
    }

    // 检查是否已存在（使用encryptGeekId作为唯一标识）
    let entity = await repo.findOne({
      where: {
        encryptGeekId,
        encryptJobId: encryptJobId || ''
      }
    })

    if (entity) {
      // 更新已有记录
      entity.replyCount = (entity.replyCount || 0) + 1
      entity.lastReplyAt = new Date()
    } else {
      // 创建新记录
      entity = new RecruiterContactedCandidate()
      entity.encryptGeekId = encryptGeekId
      entity.encryptJobId = encryptJobId || ''
      entity.jobName = jobName || targetChat.title || ''
      entity.geekName = contactName
      entity.companyName = companyName
      entity.position = position
      entity.salary = candidateInfo.expectSalary || pageInfo.domSalary || pageInfo.geek?.expectSalary || ''
      entity.city = candidateInfo.expectCity || pageInfo.geek?.expectCity || ''
      entity.degree = candidateInfo.degree || pageInfo.geek?.degree || ''
      entity.workYears = candidateInfo.workYear || pageInfo.geek?.workYear || 0
      entity.avatarUrl = candidateInfo.avatar || pageInfo.geek?.avatar || targetChat.avatar || ''
      entity.replyCount = 1
      entity.firstContactAt = new Date()
      entity.lastReplyAt = new Date()
    }

    await repo.save(entity)
    console.log('[saveContactedCandidate] 已保存联系人:', entity.geekName, 'ID:', entity.id)
  } catch (err) {
    console.error('[saveContactedCandidate] 保存联系人失败:', err)
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

  // 先切换到未读Tab
  currentTab = 'all' // 强制初始化为all，确保第一次switchTab会执行
  await switchTab(pageMapByName.boss!, 'unread')

  // 等待列表数据刷新
  console.log('[mainLoop] 等待未读Tab数据刷新...')
  await sleep(2000)

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

    console.log('[mainLoop] 消息列表数量:', friendListData?.length)

    // 打印前3条消息的详细结构，帮助调试
    if (friendListData && friendListData.length > 0) {
      console.log('[mainLoop] 前3条消息的结构:')
      for (let i = 0; i < Math.min(3, friendListData.length); i++) {
        const item = friendListData[i]
        console.log(`[mainLoop] 消息[${i}]:`, JSON.stringify({
          name: item.name,
          encryptGeekId: (item as any).encryptGeekId,
          encryptBossId: (item as any).encryptBossId,
          friendId: (item as any).friendId,
          lastIsSelf: (item as any).lastIsSelf,
          unreadCount: (item as any).unreadCount,
          lastText: (item as any).lastText,
          title: (item as any).title,
          brandName: (item as any).brandName
        }))
      }
    }

    const toCheckItemAtIndex = friendListData.findIndex((it, index) => {
      const result = index >= cursorToContinueFind && !it.lastIsSelf && Number(it.unreadCount) > 0
      if (index < 5) {
        console.log(`[mainLoop] findIndex[${index}]: lastIsSelf=${(it as any).lastIsSelf}, unreadCount=${(it as any).unreadCount}, result=${result}`)
      }
      return result
    })

    console.log('[mainLoop] toCheckItemAtIndex:', toCheckItemAtIndex, 'cursorToContinueFind:', cursorToContinueFind)

    if (toCheckItemAtIndex < 0) {
      // 如果在未读Tab没有消息了，切换到全部Tab
      if (currentTab === 'unread') {
        console.log('[mainLoop] 未读Tab处理完毕，切换到全部Tab')
        await switchTab(pageMapByName.boss!, 'all')
        cursorToContinueFind = 0
        continue
      }

      const isFinished = await pageMapByName.boss!.evaluate(
        `(document.querySelector(
          '.main-wrap .chat-user .user-list-content div[role=tfoot] .finished'
          )?.textContent ?? '').includes('没有')`
      )
      if (isFinished) {
        console.log('[mainLoop] 所有消息处理完毕，等待新消息...')
        cursorToContinueFind = 0
        // 重新切换到未读Tab等待新消息
        await switchTab(pageMapByName.boss!, 'unread')
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
    console.log('[mainLoop] targetChat原始数据:', JSON.stringify(targetChat, null, 2))
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
    console.log('[mainLoop] 准备发送消息:', currentReplyContent?.substring(0, 50))
    await sendMessage(pageMapByName.boss!, currentReplyContent)
    console.log('[mainLoop] 消息发送完成')
    await sleepWithRandomDelay(1500)

    // 保存已回复联系人数据
    console.log('[mainLoop] 开始保存已回复联系人数据...')
    try {
      await saveContactedCandidate(pageMapByName.boss!, targetChat as any, targetChat.title)
      console.log('[mainLoop] 保存已回复联系人数据完成')
    } catch (saveErr) {
      console.error('[mainLoop] 保存已回复联系人数据失败:', saveErr)
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

  // 初始化数据库
  console.log('[runEntry] 正在初始化数据库...')
  try {
    dataSource = await dbInitPromise
    console.log('[runEntry] 数据库初始化成功')
  } catch (dbErr) {
    console.error('[runEntry] 数据库初始化失败:', dbErr)
  }

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

