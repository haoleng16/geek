/**
 * 面试自动化 - 手动测试模块
 *
 * 打开浏览器，遍历未读消息，根据岗位配置和候选人状态弹窗确认发送问题
 */

import { Browser, Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { checkCookieListFormat } from '../../../common/utils/cookie'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { getPublicDbFilePath, readStorageFile, writeStorageFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import type { DataSource } from 'typeorm'
import { app, dialog } from 'electron'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { configWithBrowserAssistant } from '../../features/config-with-browser-assistant'
import type { ChatListItem } from '../READ_NO_REPLY_AUTO_REMINDER_MAIN/types'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'
import { initPuppeteer } from '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'

let dataSource: DataSource | null = null
const dbInitPromise = initDb(getPublicDbFilePath())

// 滚动聊天列表以加载更多消息
async function scrollChatList(page: Page): Promise<boolean> {
  try {
    const result = await page.evaluate(() => {
      // BOSS直聘使用虚拟滚动，需要找到正确的滚动容器
      const possibleContainers = [
        '[role="group"]',
        '.user-list',
        '.chat-list',
        '.geek-list',
        '[class*="list"]'
      ]

      let scrolled = false
      for (const selector of possibleContainers) {
        const container = document.querySelector(selector)
        if (container && container.scrollHeight > container.clientHeight) {
          const oldScrollTop = container.scrollTop
          container.scrollTop = container.scrollHeight
          scrolled = oldScrollTop !== container.scrollTop
          if (scrolled) {
            console.log('[scrollChatList] 滚动容器:', selector)
            break
          }
        }
      }

      return { scrolled }
    })

    return result.scrolled
  } catch (e) {
    console.log('[Interview ManualTest] 滚动失败:', e)
    return false
  }
}

// 发送消息
async function sendChatMessage(page: Page, text: string): Promise<boolean> {
  try {
    console.log('[Interview ManualTest] 开始发送消息...')

    // 使用正确的输入框选择器
    const chatInputHandle = await page.$('.boss-chat-editor-input')

    if (!chatInputHandle) {
      console.error('[Interview ManualTest] 未找到聊天输入框')
      return false
    }

    // 点击输入框获取焦点
    await chatInputHandle.click()
    await sleep(300)

    // 清空现有内容
    await page.evaluate(() => {
      const input = document.querySelector('.boss-chat-editor-input') as HTMLTextAreaElement
      if (input) {
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    // 输入文本
    await chatInputHandle.type(text, { delay: 30 })
    await sleep(500)

    // 按 Enter 发送
    await chatInputHandle.press('Enter')
    console.log('[Interview ManualTest] 已按 Enter 发送')

    await sleep(1000)
    return true
  } catch (e) {
    console.error('[Interview ManualTest] 发送消息失败:', e)
    return false
  }
}

interface QuestionRound {
  id: number
  roundNumber: number
  questionText: string
  waitTimeoutMinutes: number
  keywords: string
}

interface JobPosition {
  id: number
  name: string
  description: string
  passThreshold: number
  isActive: boolean
  questionRounds: QuestionRound[]
}

interface Candidate {
  id: number
  encryptGeekId: string
  geekName: string
  encryptJobId: string
  jobName: string
  jobPositionId: number | null
  status: string
  currentRound: number
}

// 从数据库获取岗位配置列表
async function getJobPositions(ds: DataSource): Promise<JobPosition[]> {
  const positionRepo = ds.getRepository('InterviewJobPosition')
  const roundRepo = ds.getRepository('InterviewQuestionRound')

  const positions = await positionRepo.find({ where: { isActive: true } })

  const result = await Promise.all((positions as any[]).map(async (pos) => {
    const rounds = await roundRepo.find({
      where: { jobPositionId: pos.id },
      order: { roundNumber: 'ASC' }
    })
    return {
      ...pos,
      questionRounds: rounds as QuestionRound[]
    }
  }))

  return result
}

// 获取候选人信息
async function getCandidate(ds: DataSource, encryptGeekId: string, encryptJobId: string): Promise<Candidate | null> {
  const repo = ds.getRepository('InterviewCandidate')
  return await repo.findOne({
    where: { encryptGeekId, encryptJobId }
  }) as Candidate | null
}

// 创建或更新候选人
async function saveCandidate(ds: DataSource, data: Partial<Candidate>): Promise<Candidate> {
  const repo = ds.getRepository('InterviewCandidate')
  let entity = await repo.findOne({
    where: { encryptGeekId: data.encryptGeekId, encryptJobId: data.encryptJobId }
  })

  if (!entity) {
    entity = repo.create({
      encryptGeekId: data.encryptGeekId,
      geekName: data.geekName,
      encryptJobId: data.encryptJobId,
      jobName: data.jobName,
      jobPositionId: data.jobPositionId,
      status: 'new',
      currentRound: 0
    })
  }

  // 更新部分字段
  if (data.jobPositionId !== undefined) {
    (entity as any).jobPositionId = data.jobPositionId
  }
  if (data.geekName) {
    (entity as any).geekName = data.geekName
  }
  if (data.jobName) {
    (entity as any).jobName = data.jobName
  }

  return await repo.save(entity) as Candidate
}

// 保存问答记录
async function saveQaRecord(ds: DataSource, data: {
  candidateId: number
  roundNumber: number
  questionText: string
}): Promise<void> {
  const repo = ds.getRepository('InterviewQaRecord')
  await repo.save(repo.create({
    ...data,
    questionSentAt: new Date()
  }))
}

// 根据岗位名称匹配
function matchJobPosition(jobName: string, positions: JobPosition[]): JobPosition | null {
  if (!jobName) return null

  for (const pos of positions) {
    // 精确匹配
    if (jobName.includes(pos.name) || pos.name.includes(jobName)) {
      return pos
    }
  }
  return null
}

// 获取要发送的问题
function getQuestionToSend(candidate: Candidate | null, position: JobPosition): { roundNumber: number; questionText: string } | null {
  const rounds = position.questionRounds
  if (!rounds || rounds.length === 0) return null

  // 如果是新候选人，发送第一轮问题
  if (!candidate || candidate.status === 'new') {
    return {
      roundNumber: 1,
      questionText: rounds[0].questionText
    }
  }

  // 根据当前轮次判断下一轮
  const currentRound = candidate.currentRound || 0
  const nextRound = currentRound + 1

  // 检查是否还有下一轮
  if (nextRound > rounds.length) {
    return null // 已经完成所有轮次
  }

  const nextRoundData = rounds.find(r => r.roundNumber === nextRound)
  if (!nextRoundData) return null

  return {
    roundNumber: nextRound,
    questionText: nextRoundData.questionText
  }
}

// 更新候选人状态
async function updateCandidateStatus(ds: DataSource, candidateId: number, roundNumber: number): Promise<void> {
  const repo = ds.getRepository('InterviewCandidate')
  await repo.update(candidateId, {
    status: `waiting_round_${roundNumber}`,
    currentRound: roundNumber,
    lastQuestionAt: new Date()
  })
}

async function storeStorage(page: Page) {
  const [cookies, localStorage] = await Promise.all([
    page.cookies(),
    page.evaluate(() => JSON.stringify(window.localStorage)).then(res => JSON.parse(res))
  ])
  await Promise.all([
    writeStorageFile('boss-cookies.json', cookies),
    writeStorageFile('boss-local-storage.json', localStorage)
  ])
}

const localStoragePageUrl = `https://www.zhipin.com/desktop/`
const defaultChatUiUrl = `https://www.zhipin.com/web/chat/index`

// 启动浏览器
async function launchBrowser(): Promise<Browser> {
  console.log('[Interview ManualTest] 正在初始化 Puppeteer...')
  const { puppeteer } = await initPuppeteer()
  console.log('[Interview ManualTest] Puppeteer 初始化完成')

  const browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    defaultViewport: {
      width: 1440,
      height: 800
    },
    devtools: process.env.NODE_ENV === 'development'
  })

  console.log('[Interview ManualTest] 浏览器已启动')
  return browser
}

// 加载 BOSS 页面
async function loadBossPage(browser: Browser, page: Page): Promise<void> {
  const bossCookies = readStorageFile('boss-cookies.json')
  const bossLocalStorage = readStorageFile('boss-local-storage.json')

  if (bossCookies && bossCookies.length > 0) {
    console.log('[Interview ManualTest] 设置 cookies, 数量:', bossCookies.length)
    for (const cookie of bossCookies) {
      await page.setCookie(cookie)
    }
  }

  if (bossLocalStorage && Object.keys(bossLocalStorage).length > 0) {
    console.log('[Interview ManualTest] 设置 localStorage')
    await setDomainLocalStorage(browser, localStoragePageUrl, bossLocalStorage)
  }

  console.log('[Interview ManualTest] 正在导航到:', defaultChatUiUrl)
  await page.goto(defaultChatUiUrl, { timeout: 120 * 1000, waitUntil: 'domcontentloaded' })
  console.log('[Interview ManualTest] 页面加载完成')
}

/**
 * 获取当前聊天候选人的完整信息（包括应聘岗位ID）
 */
async function getFullGeekInfo(page: Page): Promise<{
  name: string
  encryptGeekId: string
  encryptJobId: string
  jobName: string
} | null> {
  try {
    const info = await page.evaluate(() => {
      // 方法1: 从Vue组件获取
      const chatRecordVue = document.querySelector('.chat-conversation .chat-record')?.__vue__
      if (chatRecordVue) {
        const geek = chatRecordVue.geek || chatRecordVue.boss || chatRecordVue.$props?.geek || {}
        const job = chatRecordVue.job || chatRecordVue.$props?.job || {}

        if (geek.encryptGeekId || geek.encryptBossId) {
          return {
            name: geek.name || geek.geekName || '',
            encryptGeekId: geek.encryptGeekId || geek.encryptBossId || geek.securityId || '',
            encryptJobId: geek.encryptJobId || job.encryptJobId || job.securityId || '',
            jobName: geek.jobName || job.name || job.jobName || ''
          }
        }
      }

      // 方法2: 从聊天头部信息获取
      const headerEl = document.querySelector('.chat-conversation .chat-header, .conversation-header')
      if (headerEl) {
        const vue = (headerEl as any).__vue__
        if (vue) {
          const geek = vue.geek || vue.boss || vue.$props?.geek || {}
          const job = vue.job || vue.$props?.job || {}
          return {
            name: geek.name || geek.geekName || '',
            encryptGeekId: geek.encryptGeekId || geek.encryptBossId || geek.securityId || '',
            encryptJobId: geek.encryptJobId || job.encryptJobId || job.securityId || '',
            jobName: geek.jobName || job.name || job.jobName || ''
          }
        }
      }

      // 方法3: 从DOM获取
      const nameEl = document.querySelector('.chat-conversation .user-name, .geek-name, .chat-header .name')
      const jobEl = document.querySelector('.chat-conversation .job-name, .geek-job, .chat-header .job')

      const name = nameEl?.textContent?.trim() || ''
      const jobName = jobEl?.textContent?.trim() || ''

      // 尝试从URL获取
      const urlMatch = window.location.href.match(/geekId=([a-f0-9]+)/)
      const encryptGeekId = urlMatch ? urlMatch[1] : ''

      return { name, encryptGeekId, encryptJobId: '', jobName }
    })

    return info
  } catch (e) {
    console.error('[Interview ManualTest] getFullGeekInfo error:', e)
    return null
  }
}

// 滚动并等待新消息加载
async function scrollAndWaitForNewMessages(page: Page, currentCount: number, maxAttempts: number = 5): Promise<number> {
  let attempts = 0
  let newCount = currentCount

  while (attempts < maxAttempts) {
    const scrolled = await scrollChatList(page)
    if (!scrolled) {
      console.log('[Interview ManualTest] 无法继续滚动')
      break
    }

    await sleep(1000)

    // 获取新的聊天项数量
    const count = await page.evaluate(() => {
      return document.querySelectorAll('[role="listitem"]').length
    })

    if (count > newCount) {
      console.log('[Interview ManualTest] 滚动后聊天项数量:', count, '(增加', count - newCount, '个)')
      newCount = count
    }

    attempts++
  }

  return newCount
}

export async function runManualTest() {
  console.log('[Interview ManualTest] 开始执行...')

  // 初始化数据库
  dataSource = await dbInitPromise
  console.log('[Interview ManualTest] 数据库初始化完成')

  // 获取岗位配置
  const jobPositions = await getJobPositions(dataSource!)
  console.log('[Interview ManualTest] 岗位配置数量:', jobPositions.length)

  if (jobPositions.length === 0) {
    await dialog.showMessageBox({
      type: 'warning',
      message: '没有可用的岗位配置',
      detail: '请先在"面试自动化"页面添加岗位配置。',
      buttons: ['确定']
    })
    return
  }

  // 检查浏览器
  let puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  if (!puppeteerExecutable) {
    try {
      await configWithBrowserAssistant({ autoFind: true })
    } catch (e) {
      console.error('[Interview ManualTest] 浏览器配置失败:', e)
    }
    puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  }

  if (!puppeteerExecutable) {
    await dialog.showMessageBox({
      type: 'error',
      message: '未找到可用的浏览器',
      detail: '请先配置浏览器。',
      buttons: ['确定']
    })
    return
  }

  process.env.PUPPETEER_EXECUTABLE_PATH = puppeteerExecutable.executablePath

  // 启动浏览器
  console.log('[Interview ManualTest] 启动浏览器...')
  const browser = await launchBrowser()
  const page = (await browser.pages())[0]

  // 检查 cookie
  const bossCookies = readStorageFile('boss-cookies.json')
  const cookieValid = checkCookieListFormat(bossCookies)

  // 加载页面
  await loadBossPage(browser, page)
  await sleep(2000)

  // 检查登录状态
  const currentUrl = page.url() ?? ''
  if (currentUrl.startsWith('https://www.zhipin.com/web/user/')) {
    await dialog.showMessageBox({
      type: 'warning',
      message: '需要登录',
      detail: '请在浏览器中登录BOSS直聘后重试。',
      buttons: ['确定']
    })
    const cp = browser.process()
    cp?.kill('SIGKILL')
    return
  }

  // 点击聊天菜单
  try {
    await page.evaluate(() => {
      const chatMenu = document.querySelector('.menu-chat') as HTMLElement
      if (chatMenu) chatMenu.click()
    })
    await sleep(2000)
  } catch (e) {
    console.log('[Interview ManualTest] 点击聊天菜单失败:', e)
  }

  // 等待页面加载
  console.log('[Interview ManualTest] 等待页面加载...')
  await sleep(3000)

  // 主循环
  let cursorIndex = 0
  let processedCount = 0

  while (true) {
    try {
      // 检查页面是否仍然有效
      if (page.isClosed()) {
        console.log('[Interview ManualTest] 页面已关闭，退出')
        break
      }

      // 获取聊天列表
      const friendListData = await page.evaluate(() => {
        // 获取所有聊天项（只取 role="listitem" 的元素，避免重复）
        const items = document.querySelectorAll('[role="listitem"]')

        console.log('[Interview ManualTest] 找到聊天项数量:', items.length)

        return [...items].map(el => {
          // 找到 .geek-item 元素
          const geekItemEl = el.querySelector('.geek-item') || el

          // 从 DOM 文本提取信息 - cast to HTMLElement for innerText
          const textContent = (geekItemEl as HTMLElement)?.innerText || (el as HTMLElement)?.innerText || ''
          const textLines = textContent.split('\n').filter(line => line.trim())

          // 解析文本格式
          // 格式1（有未读数）: "1\n11:24\n刘毛印\nAI自动化开发程序员\n您好..."
          // 格式2（无未读数）: "09:53\n张博翔\nAI自动化开发程序员\n您好..."
          let name = ''
          let unreadCount = 0
          let jobName = ''

          if (textLines.length >= 4) {
            const firstLine = textLines[0]

            // 判断第一行是否是未读数（纯数字）
            if (/^\d+$/.test(firstLine) && textLines.length >= 5) {
              // 格式1：有未读数
              unreadCount = parseInt(firstLine) || 0
              name = textLines[2] || ''
              jobName = textLines[3] || ''
            } else {
              // 格式2：无未读数
              name = textLines[1] || ''
              jobName = textLines[2] || ''
            }
          }

          // 从 key/data-id 属性获取 ID
          const keyId = el.getAttribute('key') || geekItemEl?.getAttribute('data-id') || ''

          // 尝试从 Vue 组件获取数据（与 SMART_REPLY_MAIN 相同的方式）
          const vue = (geekItemEl as any).__vue__ || (el as any).__vue__
          const props = vue?._props || vue?.$props || vue?.props || {}
          const data = props.geek || props.item || props.message || props.user || props.data || props.row || {}

          return {
            name: name || data.name || data.geekName || data.fromName || '',
            encryptGeekId: keyId || data.encryptGeekId || data.geekId || data.securityId || '',
            encryptJobId: data.encryptJobId || '',
            unreadCount: unreadCount || data.unreadCount || data.newMsgCount || 0,
            jobName: jobName || data.jobName || '',
            _rawData: data,
            _hasVue: !!vue
          }
        })
      }) as unknown as ChatListItem[]

    console.log('[Interview ManualTest] 聊天列表数量:', friendListData.length)
    if (friendListData.length > 0) {
      // 打印第一个聊天项的详细信息，帮助调试
      const firstItem = friendListData[0] as any
      console.log('[Interview ManualTest] 第一个聊天项调试信息:', {
        name: firstItem.name,
        encryptGeekId: firstItem.encryptGeekId,
        encryptJobId: firstItem.encryptJobId,
        jobName: firstItem.jobName,
        unreadCount: firstItem.unreadCount,
        hasVue: firstItem._hasVue,
        rawDataKeys: firstItem._rawData ? Object.keys(firstItem._rawData) : [],
        rawDataPreview: firstItem._rawData ? JSON.stringify(firstItem._rawData).substring(0, 200) : ''
      })
    }

    // 查找下一个有未读消息的项
    const nextIndex = friendListData.findIndex((it, index) => {
      return index >= cursorIndex && Number(it.unreadCount) > 0
    })

    if (nextIndex < 0) {
      // 当前列表没有未读消息，尝试滚动加载更多
      console.log('[Interview ManualTest] 当前列表无未读消息，尝试滚动加载更多...')

      let scrollAttempts = 0
      let foundNew = false

      while (scrollAttempts < 5 && !foundNew) {
        const scrolled = await scrollChatList(page)
        if (!scrolled) {
          console.log('[Interview ManualTest] 无法继续滚动')
          break
        }

        await sleep(1500)

        // 重新获取聊天列表
        const newListData = await page.evaluate(() => {
          const items = document.querySelectorAll('[role="listitem"]')
          return [...items].map(el => {
            const geekItemEl = el.querySelector('.geek-item') || el
            const textContent = (geekItemEl as HTMLElement)?.innerText || (el as HTMLElement)?.innerText || ''
            const textLines = textContent.split('\n').filter(line => line.trim())
            let unreadCount = 0
            if (textLines.length >= 4) {
              const firstLine = textLines[0]
              if (/^\d+$/.test(firstLine) && textLines.length >= 5) {
                unreadCount = parseInt(firstLine) || 0
              }
            }
            return { unreadCount }
          })
        })

        // 检查是否有未读消息
        const hasUnread = newListData.some((it: any) => it.unreadCount > 0)
        if (hasUnread) {
          console.log('[Interview ManualTest] 滚动后发现未读消息')
          foundNew = true
          break
        }

        scrollAttempts++
      }

      if (!foundNew) {
        // 多次滚动都没有未读消息
        const res = await dialog.showMessageBox({
          type: 'info',
          message: '处理完成',
          detail: `已处理 ${processedCount} 条未读消息。\n\n当前列表共 ${friendListData.length} 个聊天项，未发现更多未读消息。\n\n是否继续检查新消息？`,
          buttons: ['继续检查', '退出'],
          defaultId: 0
        })

        if (res.response === 1) {
          break
        }
        cursorIndex = 0
        await sleep(5000)
      }
      continue
    }

    cursorIndex = nextIndex
    const targetChat = friendListData[nextIndex]

    console.log('[Interview ManualTest] 处理聊天:', targetChat.name, '未读:', targetChat.unreadCount)

    // 点击聊天项
    await page.evaluate((index) => {
      const items = document.querySelectorAll('[role="listitem"]')
      const geekItem = items[index]?.querySelector('.geek-item')
      if (geekItem) {
        (geekItem as HTMLElement).click()
      } else if (items[index]) {
        (items[index] as HTMLElement).click()
      }
    }, nextIndex)

    // 等待聊天数据加载
    console.log('[Interview ManualTest] 等待聊天数据加载...')
    await sleep(2000)

    // 打印聊天区域的完整结构，帮助调试
    const chatAreaDebug = await page.evaluate(() => {
      const chatConversation = document.querySelector('.chat-conversation')
      if (!chatConversation) {
        return { found: false }
      }

      // 查找所有可能的输入框和发送按钮
      const allInputs = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')
      const allButtons = document.querySelectorAll('button, [class*="btn"], [class*="send"]')

      // 查找 message-controls 的各种可能选择器
      const possibleContainers = [
        '.message-controls',
        '.chat-controls',
        '.input-area',
        '.reply-box',
        '.chat-input-box',
        '[class*="control"]',
        '[class*="input"]'
      ]

      const foundContainers = possibleContainers.map(selector => ({
        selector,
        count: document.querySelectorAll(selector).length
      })).filter(item => item.count > 0)

      return {
        found: true,
        conversationHTMLLength: chatConversation.innerHTML.length,
        inputCount: allInputs.length,
        inputClasses: [...allInputs].slice(0, 3).map(el => el.className),
        buttonCount: allButtons.length,
        buttonClasses: [...allButtons].slice(0, 5).map(el => el.className),
        foundContainers
      }
    })
    console.log('[Interview ManualTest] 聊天区域结构:', JSON.stringify(chatAreaDebug, null, 2))

    // 等待聊天区域加载完成
    let waitCount = 0
    while (waitCount < 10) {
      const dataLoaded = await page.evaluate(() => {
        const noData = document.querySelector('.conversation-no-data')
        const chatConversation = document.querySelector('.chat-conversation')
        // 使用正确的输入框选择器
        const chatInput = document.querySelector('.boss-chat-editor-input') ||
                         document.querySelector('.chat-conversation .message-controls .chat-input')

        return {
          hasNoData: !!noData,
          hasChatInput: !!chatInput,
          conversationHTMLLength: chatConversation?.innerHTML?.length || 0
        }
      })

      console.log('[Interview ManualTest] 数据加载状态:', JSON.stringify(dataLoaded))

      if (dataLoaded.hasChatInput) {
        console.log('[Interview ManualTest] 聊天区域已加载')
        break
      }

      if (dataLoaded.hasNoData) {
        console.log('[Interview ManualTest] 无聊天数据')
        break
      }

      waitCount++
      await sleep(1000)
    }

    if (waitCount >= 10) {
      console.log('[Interview ManualTest] 等待超时，跳过')
      cursorIndex += 1
      continue
    }

    // 获取候选人详细信息 - 优先使用从聊天列表获取的数据
    const geekInfo = await getFullGeekInfo(page)
    // 优先使用从聊天列表获取的信息（targetChat），而不是右侧聊天区域（geekInfo）
    // 因为右侧聊天区域可能还没刷新完成
    const encryptGeekId = (targetChat as any).encryptGeekId || geekInfo?.encryptGeekId || ''
    const geekName = targetChat.name || geekInfo?.name || ''
    const encryptJobId = (targetChat as any).encryptJobId || geekInfo?.encryptJobId || ''
    const jobName = (targetChat as any).jobName || geekInfo?.jobName || ''

    console.log('[Interview ManualTest] 候选人信息:', {
      geekName,
      jobName,
      encryptGeekId: encryptGeekId ? '已获取' : '空',
      encryptJobId: encryptJobId ? '已获取' : '空',
      targetChatName: targetChat.name,
      geekInfoName: geekInfo?.name || '无'
    })

    if (!encryptGeekId) {
      console.log('[Interview ManualTest] 无法获取候选人ID，跳过')
      cursorIndex += 1
      continue
    }

    // 匹配岗位配置
    const matchedPosition = matchJobPosition(jobName, jobPositions)

    if (!matchedPosition) {
      console.log('[Interview ManualTest] 未匹配到岗位配置:', jobName)
      const res = await dialog.showMessageBox({
        type: 'warning',
        message: `未匹配到岗位配置`,
        detail: `候选人：${geekName}\n应聘岗位：${jobName}\n\n无法确定要发送的问题，是否跳过？`,
        buttons: ['跳过', '退出'],
        defaultId: 0
      })

      if (res.response === 1) break
      cursorIndex += 1
      continue
    }

    // 获取候选人状态（仅当有 encryptJobId 时才能查询）
    let candidate: Candidate | null = null
    if (encryptJobId) {
      candidate = await getCandidate(dataSource!, encryptGeekId, encryptJobId)
    }

    // 获取要发送的问题
    const questionData = getQuestionToSend(candidate, matchedPosition)

    if (!questionData) {
      console.log('[Interview ManualTest] 该候选人已完成所有轮次')
      const res = await dialog.showMessageBox({
        type: 'info',
        message: `候选人已完成所有面试轮次`,
        detail: `候选人：${geekName}\n当前状态：第 ${(candidate?.currentRound || 0)} 轮\n\n是否跳过？`,
        buttons: ['跳过', '退出'],
        defaultId: 0
      })

      if (res.response === 1) break
      cursorIndex += 1
      continue
    }

    // 弹窗确认
    const res = await dialog.showMessageBox({
      type: 'question',
      message: `确认发送第 ${questionData.roundNumber} 轮问题`,
      detail: `候选人：${geekName}\n应聘岗位：${jobName}\n匹配配置：${matchedPosition.name}\n当前轮次：第 ${(candidate?.currentRound || 0) + 1} 轮\n\n问题内容：\n${questionData.questionText}`,
      buttons: ['发送', '跳过', '退出'],
      defaultId: 0
    })

    if (res.response === 2) {
      // 退出
      break
    }
    if (res.response === 1) {
      // 跳过
      console.log('[Interview ManualTest] 用户选择跳过')
      cursorIndex += 1
      continue
    }

    // 发送问题
    console.log('[Interview ManualTest] 开始发送问题:', questionData.questionText.substring(0, 50))
    const sendSuccess = await sendChatMessage(page, questionData.questionText)
    console.log('[Interview ManualTest] 发送结果:', sendSuccess ? '成功' : '失败')

    if (!sendSuccess) {
      console.log('[Interview ManualTest] 发送失败，跳过')
      cursorIndex += 1
      continue
    }

    // 保存/更新候选人（仅当有 encryptJobId 时）
    if (encryptJobId) {
      try {
        if (!candidate) {
          candidate = await saveCandidate(dataSource!, {
            encryptGeekId,
            geekName,
            encryptJobId,
            jobName,
            jobPositionId: matchedPosition.id
          })
        }

        // 保存问答记录
        await saveQaRecord(dataSource!, {
          candidateId: candidate.id,
          roundNumber: questionData.roundNumber,
          questionText: questionData.questionText
        })

        // 更新候选人状态
        await updateCandidateStatus(dataSource!, candidate.id, questionData.roundNumber)
      } catch (dbErr) {
        console.error('[Interview ManualTest] 保存数据库失败:', dbErr)
      }
    } else {
      console.log('[Interview ManualTest] 未获取到 encryptJobId，跳过数据库保存')
    }

    processedCount++
    cursorIndex += 1

    // 短暂延迟
    await sleep(1000)
    } catch (loopErr: any) {
      console.error('[Interview ManualTest] 循环错误:', loopErr?.message || loopErr)

      // 检查是否是页面关闭导致的错误
      if (loopErr?.message?.includes('detached') || loopErr?.message?.includes('closed')) {
        console.log('[Interview ManualTest] 页面已分离或关闭，退出循环')
        break
      }

      // 继续下一个
      cursorIndex += 1
      await sleep(2000)
    }
  }

  // 关闭浏览器
  try {
    const cp = browser.process()
    cp?.kill('SIGKILL')
  } catch {
    //
  }

  console.log('[Interview ManualTest] 结束')
}