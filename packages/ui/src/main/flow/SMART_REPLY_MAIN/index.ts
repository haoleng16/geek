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
import type { Browser } from 'puppeteer'
import type { ChatListItem } from '../boss-chat-utils'
import { sendMessage } from '../boss-chat-utils'
import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { checkCookieListFormat } from '../../../common/utils/cookie'
import { loginWithCookieAssistant } from '../../features/login-with-cookie-assistant'
import type { Browser } from 'puppeteer'
import { startNewSession, getCurrentSessionId, getReplyCount, getOrCreateRecord, updateLastLlmReply } from './session-manager'
import { containsSensitiveWord, isMessageTooShort } from './sensitive-words'
import { generateSmartReply, type SmartReplyConfig } from './llm-reply'
import { getCurrentChatGeekInfo } from '../RECRUITER_AUTO_REPLY_MAIN/quick-reply'

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

  // 招聘端：点击左侧聊天菜单，确保进入聊天页面
  console.log('[SmartReply MainLoop] 尝试点击聊天菜单...')
  try {
    const chatMenuClicked = await pageMapByName.boss!.evaluate(() => {
      // 查找聊天菜单并点击
      const chatMenu = document.querySelector('.menu-chat') as HTMLElement
      if (chatMenu) {
        chatMenu.click()
        return true
      }
      return false
    })
    console.log('[SmartReply MainLoop] 聊天菜单点击结果:', chatMenuClicked)
    if (chatMenuClicked) {
      await sleep(2000) // 等待聊天列表加载
    }
  } catch (e) {
    console.log('[SmartReply MainLoop] 点击聊天菜单失败:', e)
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

  // 等待页面完全加载
  console.log('[SmartReply MainLoop] 等待页面完全加载...')
  await sleep(3000)

  // 等待页面内容加载完成（检查 body 长度）
  console.log('[SmartReply MainLoop] 等待页面内容渲染...')
  let bodyLength = 0
  let waitCount = 0
  while (bodyLength < 50000 && waitCount < 30) {
    bodyLength = await pageMapByName.boss!.evaluate(() => document.body.innerHTML.length)
    console.log('[SmartReply MainLoop] 页面内容长度:', bodyLength, '等待次数:', waitCount)
    if (bodyLength < 50000) {
      await sleep(2000)
      waitCount++
    }
  }

  if (bodyLength < 50000) {
    console.log('[SmartReply MainLoop] 页面内容加载不完整，但继续执行')
  } else {
    console.log('[SmartReply MainLoop] 页面内容已加载完成')
  }

  // 等待网络请求完成
  try {
    await pageMapByName.boss!.waitForNetworkIdle({ idleTime: 2000, timeout: 15000 })
    console.log('[SmartReply MainLoop] 网络请求已完成')
  } catch (e) {
    console.log('[SmartReply MainLoop] 等待网络空闲超时，继续执行')
  }

  // 检查并等待遮罩层消失
  console.log('[SmartReply MainLoop] 检查遮罩层...')
  let hasOverlay = true
  let overlayCheckCount = 0
  while (hasOverlay && overlayCheckCount < 5) {
    const overlayCheck = await pageMapByName.boss!.evaluate(() => {
      const overlays = [...document.querySelectorAll('div')].filter(el => {
        const style = el.getAttribute('style') || ''
        return style.includes('position:fixed') &&
               style.includes('z-index') &&
               parseInt(style.match(/z-index:\s*(\d+)/)?.[1] || '0') >= 1000 &&
               !style.includes('pointer-events:none')
      })
      return {
        hasBlockingOverlay: overlays.length > 0,
        overlayCount: overlays.length,
        firstOverlayStyle: overlays[0]?.getAttribute('style')?.substring(0, 150) || null
      }
    })
    console.log('[SmartReply MainLoop] 遮罩层检查:', JSON.stringify(overlayCheck))
    hasOverlay = overlayCheck.hasBlockingOverlay
    if (hasOverlay) {
      overlayCheckCount++
      await sleep(2000)
      console.log('[SmartReply MainLoop] 等待遮罩层消失...', overlayCheckCount)
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 先检查页面状态，帮助调试
    console.log('[SmartReply MainLoop] 检查页面状态...')
    try {
      const pageState = await pageMapByName.boss!.evaluate(() => {
        const result: any = {
          url: location.href,
          hasChatUser: !!document.querySelector('.chat-user'),
          hasItemFriend: !!document.querySelector('.item-friend'),
          itemFriendCount: document.querySelectorAll('.item-friend').length,
          bodyLength: document.body.innerHTML.length
        }
        return result
      })
      console.log('[SmartReply MainLoop] 页面状态:', JSON.stringify(pageState))
    } catch (e) {
      console.error('[SmartReply MainLoop] 检查页面状态失败:', e)
    }

    // 招聘端：等待聊天列表元素出现（无限等待，不自动退出）
    console.log('[SmartReply MainLoop] 等待聊天列表元素...')
    while (true) {
      const pageDebugInfo = await pageMapByName.boss!.evaluate(() => {
        // 检查 .user-list 内的真正的聊天项元素
        const geekItems = document.querySelectorAll('.geek-item, .geek-item-wrap, [role="listitem"]')

        const geekItemsDebug = [...geekItems].slice(0, 20).map(el => {
          // 找到 .geek-item 元素（可能是 el 本身或其子元素）
          const geekItem = el.classList.contains('geek-item') ? el : el.querySelector('.geek-item') || el
          const geekItemWrap = el.classList.contains('geek-item-wrap') ? el : el.querySelector('.geek-item-wrap') || el.closest('.geek-item-wrap')

          return {
            className: el.className,
            role: el.getAttribute('role'),
            keyAttr: el.getAttribute('key') || geekItem?.getAttribute('data-id'),
            hasVue: !!el.__vue__,
            hasGeekItemVue: !!geekItem?.__vue__,
            textPreview: geekItem?.innerText?.substring(0, 100) || el.innerText?.substring(0, 100) || null,
            // 检查 Vue props
            vueProps: geekItem?.__vue__ ? Object.keys(geekItem.__vue__._props || geekItem.__vue__.$props || {}).slice(0, 15) : []
          }
        })

        // 检查 [role="group"] 内部结构（这是虚拟滚动的容器）
        const roleGroup = document.querySelector('[role="group"]')
        const roleGroupDebug = roleGroup ? {
          childCount: roleGroup.children.length,
          children: [...roleGroup.children].slice(0, 10).map(el => ({
            className: el.className,
            role: el.getAttribute('role'),
            keyAttr: el.getAttribute('key'),
            textPreview: el.innerText?.substring(0, 80) || null
          }))
        } : null

        return {
          geekItemsCount: geekItems.length,
          geekItemsDebug,
          roleGroupDebug,
          url: location.href
        }
      })
      console.log('[SmartReply MainLoop] 页面调试信息:', JSON.stringify(pageDebugInfo, null, 2))

      // 检查是否有聊天项
      if (pageDebugInfo.geekItemsCount > 0) {
        console.log('[SmartReply MainLoop] 找到聊天项元素，数量:', pageDebugInfo.geekItemsCount)
        break
      }

      await sleep(3000)
      console.log('[SmartReply MainLoop] 继续等待...')
    }

    // 招聘端：从 .geek-item 获取聊天列表数据
    const friendListData = (await pageMapByName.boss!.evaluate(() => {
      // 获取所有聊天项（只取 role="listitem" 的元素，避免重复）
      const geekItems = document.querySelectorAll('[role="listitem"]')

      console.log('[SmartReply] 找到聊天项数量:', geekItems.length)

      return [...geekItems].map(el => {
        // 找到 .geek-item 元素
        const geekItem = el.querySelector('.geek-item') || el

        // 从 DOM 文本提取信息
        const textContent = geekItem?.innerText || el.innerText || ''
        const textLines = textContent.split('\n').filter(line => line.trim())

        // 解析文本格式
        // 格式1（有未读数）: "1\n11:24\n刘毛印\nAI自动化开发程序员\n您好..."
        // 格式2（无未读数）: "09:53\n张博翔\nAI自动化开发程序员\n您好..."
        let name = ''
        let time = ''
        let lastText = ''
        let unreadCount = 0
        let jobName = ''

        if (textLines.length >= 4) {
          const firstLine = textLines[0]
          const secondLine = textLines[1]

          // 判断第一行是否是未读数（纯数字）
          if (/^\d+$/.test(firstLine) && textLines.length >= 5) {
            // 格式1：有未读数
            unreadCount = parseInt(firstLine) || 0
            time = secondLine || ''
            name = textLines[2] || ''
            jobName = textLines[3] || ''
            lastText = textLines.slice(4).join('\n') || ''
          } else {
            // 格式2：无未读数
            time = firstLine || ''
            name = textLines[1] || ''
            jobName = textLines[2] || ''
            lastText = textLines.slice(3).join('\n') || ''
          }
        }

        // 从 key/data-id 属性获取 ID
        const keyId = el.getAttribute('key') || geekItem?.getAttribute('data-id') || ''

        // 尝试从 Vue 组件获取数据
        const vue = geekItem.__vue__ || el.__vue__
        const props = vue?._props || vue?.$props || vue?.props || {}
        const data = props.geek || props.item || props.message || props.user || props.data || props.row || {}

        // 从 DOM 结构提取头像
        const avatarEl = geekItem?.querySelector('.figure img, .avatar img, img')

        return {
          name: name || data.name || data.geekName || data.fromName || '',
          encryptGeekId: keyId || data.encryptGeekId || data.geekId || data.securityId || '',
          encryptBossId: data.bossId || data.encryptBossId || '',
          unreadCount: unreadCount || data.unreadCount || data.newMsgCount || 0,
          lastIsSelf: data.isSelf === true || data.lastIsSelf === true,
          lastText: lastText || data.lastText || data.text || '',
          avatar: data.avatar || data.fromAvatar || avatarEl?.src || '',
          time: time || data.time || '',
          jobName: jobName || data.jobName || '',
          mid: data.mid || '',
          _rawData: data,
          _className: el.className,
          _textContent: textContent.substring(0, 200)
        }
      })
    })) as Array<ChatListItem>

    console.log('[SmartReply MainLoop] 消息列表数量:', friendListData?.length)

    const toCheckItemAtIndex = friendListData.findIndex((it, index) => {
      const result = index >= cursorToContinueFind && !it.lastIsSelf && Number(it.unreadCount) > 0
      return result
    })

    console.log('[SmartReply MainLoop] toCheckItemAtIndex:', toCheckItemAtIndex, 'cursorToContinueFind:', cursorToContinueFind)

    if (toCheckItemAtIndex < 0) {
      // 招聘端：暂时简化处理，等待新消息
      console.log('[SmartReply MainLoop] 所有消息处理完毕，等待新消息...')
      cursorToContinueFind = 0
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

    cursorToContinueFind = toCheckItemAtIndex

    const targetChat = friendListData[toCheckItemAtIndex]
    console.log('[SmartReply MainLoop] targetChat:', JSON.stringify({
      name: targetChat.name,
      encryptGeekId: (targetChat as any).encryptGeekId,
      lastText: (targetChat as any).lastText
    }))

    // 招聘端：点击对应的聊天项
    console.log('[SmartReply MainLoop] 准备点击聊天项，index:', toCheckItemAtIndex)
    const clickResult = await pageMapByName.boss?.evaluate((index) => {
      const items = document.querySelectorAll('[role="listitem"]')
      console.log('[SmartReply] 找到聊天项数量:', items.length, '准备点击 index:', index)
      if (items[index]) {
        // 先检查元素是否可见
        const rect = items[index].getBoundingClientRect()
        console.log('[SmartReply] 元素位置:', rect.x, rect.y, rect.width, rect.height)

        // 找到 .geek-item 元素并点击
        const geekItem = items[index].querySelector('.geek-item')
        if (geekItem) {
          console.log('[SmartReply] 找到 .geek-item，点击它')
          ;(geekItem as HTMLElement).click()
          return { clicked: true, target: 'geek-item', text: geekItem.textContent?.substring(0, 50) }
        }

        ;(items[index] as HTMLElement).click()
        return { clicked: true, target: 'listitem', text: items[index].textContent?.substring(0, 50) }
      }
      return { clicked: false }
    }, toCheckItemAtIndex)
    console.log('[SmartReply MainLoop] 点击结果:', JSON.stringify(clickResult))

    // 等待聊天数据加载
    console.log('[SmartReply MainLoop] 等待聊天数据加载...')
    await sleep(2000)

    // 等待 conversation-no-data 消失或消息列表出现
    let waitCount = 0
    while (waitCount < 10) {
      const dataLoaded = await pageMapByName.boss?.evaluate(() => {
        const noData = document.querySelector('.conversation-no-data')
        const chatConversation = document.querySelector('.chat-conversation')
        const hasMessages = chatConversation?.innerHTML?.includes('您好') ||
                           chatConversation?.innerHTML?.includes('你好') ||
                           chatConversation?.innerHTML?.includes('沟通')

        return {
          hasNoData: !!noData,
          hasMessages,
          conversationHTMLLength: chatConversation?.innerHTML?.length || 0
        }
      })

      console.log('[SmartReply MainLoop] 数据加载状态:', JSON.stringify(dataLoaded))

      if (!dataLoaded?.hasNoData || dataLoaded?.hasMessages) {
        console.log('[SmartReply MainLoop] 聊天数据已加载')
        break
      }

      waitCount++
      await sleep(1000)
    }

    // 检查右侧聊天区域状态
    const chatAreaDebug = await pageMapByName.boss?.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')
      if (!chatConversation || !chatConversation.__vue__) {
        return { found: false }
      }

      const vue = chatConversation.__vue__

      // 检查 list$ 的内容
      const list$ = vue.list$
      console.log('[SmartReply] list$ 类型:', typeof list$, '是否数组:', Array.isArray(list$), '长度:', list$?.length)

      // 打印 list$ 的第一项（如果有）
      if (Array.isArray(list$) && list$.length > 0) {
        console.log('[SmartReply] list$[0]:', JSON.stringify(list$[0]))
        return {
          found: true,
          listLength: list$.length,
          firstItem: list$[0],
          listKeys: list$.length > 0 ? Object.keys(list$[0]) : []
        }
      }

      // 如果 list$ 不是数组或者是空的，检查其他属性
      const allKeys = Object.keys(vue).filter(k => !k.startsWith('_') && !k.startsWith('$') && !k.startsWith('handle'))
      console.log('[SmartReply] Vue 所有属性:', allKeys)

      // 检查 $data
      if (vue.$data) {
        const dataKeys = Object.keys(vue.$data)
        console.log('[SmartReply] $data 属性:', dataKeys)

        for (const key of dataKeys) {
          const val = vue.$data[key]
          if (Array.isArray(val) && val.length > 0) {
            console.log('[SmartReply] 在 $data.' + key + ' 找到数组，长度:', val.length, '第一项:', JSON.stringify(val[0]).substring(0, 200))
          }
        }
      }

      // 检查 innerHTML 中是否有消息内容
      const innerHTML = chatConversation.innerHTML
      const hasMessageContent = innerHTML.includes('您好') || innerHTML.includes('你好') || innerHTML.includes('沟通')
      console.log('[SmartReply] innerHTML 是否包含消息内容:', hasMessageContent)
      console.log('[SmartReply] innerHTML 预览:', innerHTML.substring(0, 500))

      return {
        found: true,
        listLength: Array.isArray(list$) ? list$.length : 0,
        allKeys,
        hasMessageContent,
        innerHTMLPreview: innerHTML.substring(0, 500)
      }
    })
    console.log('[SmartReply MainLoop] 聊天区域调试:', JSON.stringify(chatAreaDebug, null, 2))

    try {
      await pageMapByName.boss!.waitForResponse(
        (response) => {
          const url = response.url()
          return url.startsWith('https://www.zhipin.com/wapi/zpchat/') && url.includes('/historyMsg')
        },
        {
          timeout: 15 * 1000
        }
      )
      console.log('[SmartReply MainLoop] 收到 historyMsg 响应')
    } catch (e) {
      console.log('[SmartReply MainLoop] 等待 historyMsg 响应超时')
    }

    await sleepWithRandomDelay(1000)

    // 招聘端：获取聊天记录（适配招聘端的选择器）
    const historyMessageList =
      (
        await pageMapByName.boss?.evaluate(() => {
          // 直接检查 .chat-conversation 的 Vue 组件
          const chatConversation = document.querySelector('.chat-conversation')
          if (chatConversation?.__vue__) {
            const vue = chatConversation.__vue__
            console.log('[SmartReply] .chat-conversation Vue keys:', Object.keys(vue).filter(k => !k.startsWith('_') && !k.startsWith('$')))

            // 尝试获取消息列表
            const possibleListKeys = ['list$', 'list', 'messages', 'messageList', 'data', 'items', 'records', 'chatList']
            for (const key of possibleListKeys) {
              if (vue[key] && Array.isArray(vue[key]) && vue[key].length > 0) {
                console.log('[SmartReply] 找到消息列表:', key, '长度:', vue[key].length)
                return vue[key]
              }
            }

            // 检查 $data 里的属性
            if (vue.$data) {
              console.log('[SmartReply] Vue $data keys:', Object.keys(vue.$data))
              for (const key of Object.keys(vue.$data)) {
                if (Array.isArray(vue.$data[key]) && vue.$data[key].length > 0) {
                  const firstItem = vue.$data[key][0]
                  if (firstItem && (firstItem.text || firstItem.content || firstItem.message)) {
                    console.log('[SmartReply] 在 $data 找到可能的消息列表:', key, '长度:', vue.$data[key].length)
                    return vue.$data[key]
                  }
                }
              }
            }
          }

          // 检查 .chat-conversation 内部的消息元素
          const messageEls = chatConversation?.querySelectorAll('[class*="message"], [class*="msg"], [class*="chat-item"]')
          console.log('[SmartReply] .chat-conversation 内消息元素数量:', messageEls?.length)

          if (messageEls && messageEls.length > 0) {
            return [...messageEls].map(el => ({
              text: el.textContent || '',
              isSelf: el.classList.contains('self') || el.classList.contains('is-self') || !!el.closest('[class*="self"]'),
              className: el.className
            }))
          }

          // 打印 .chat-conversation 的 innerHTML 前 1000 字符
          console.log('[SmartReply] .chat-conversation innerHTML 预览:', chatConversation?.innerHTML?.substring(0, 1000))

          return []
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
    const geekInfo = await getCurrentChatGeekInfo(pageMapByName.boss!)
    const encryptGeekId = geekInfo?.encryptGeekId || (targetChat as any).encryptGeekId || ''
    const geekName = geekInfo?.name || targetChat.name || ''
    const encryptJobId = geekInfo?.encryptJobId || (targetChat as any).encryptJobId || ''
    const jobName = (targetChat as any).jobName || (targetChat as any).title || ''
    // 兼容不同的消息格式：可能是 text 或 content
    const candidateMessage = lastMsg.text || lastMsg.content || ''

    console.log('[SmartReply MainLoop] 候选人信息:', {
      encryptGeekId,
      geekName,
      message: candidateMessage.substring(0, 50)
    })

    // 如果获取不到 encryptGeekId，跳过
    if (!encryptGeekId) {
      console.log('[SmartReply MainLoop] 无法获取候选人ID，跳过')
      cursorToContinueFind += 1
      await sleep(cfg.scanIntervalSeconds * 1000)
      continue
    }

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
        geekName,
        encryptJobId,
        jobName
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