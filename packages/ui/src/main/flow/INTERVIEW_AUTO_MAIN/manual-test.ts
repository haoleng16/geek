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
import type { ChatListItem } from '../boss-chat-utils'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'
import { initPuppeteer } from '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
import { scoreAnswer, saveScoreResult } from './scorer'
import { mergeMessagesInWindow, isLatestMessageFromCandidate, getChatHistory, isSelfMessage } from './answer-collector'
import type { ScoreResult } from './scorer'

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
    console.log('[Interview ManualTest] 开始发送消息, 内容长度:', text.length)

    // 使用正确的输入框选择器
    const chatInputHandle = await page.$('.boss-chat-editor-input')

    if (!chatInputHandle) {
      console.error('[Interview ManualTest] 未找到聊天输入框')
      return false
    }

    console.log('[Interview ManualTest] 找到输入框')

    // 点击输入框获取焦点
    await chatInputHandle.click()
    await sleep(300)

    console.log('[Interview ManualTest] 尝试设置输入框内容...')

    // 方法1：使用 execCommand 设置内容（兼容 React/Vue）
    let setInputSuccess = false
    try {
      setInputSuccess = await page.evaluate((content) => {
        const input = document.querySelector('.boss-chat-editor-input') as HTMLTextAreaElement
        if (!input) return false

        input.focus()

        // 使用 document.execCommand 方式设置内容，更兼容 React/Vue
        // 先选中所有内容
        input.select()
        // 删除选中内容
        document.execCommand('delete', false)
        // 插入新内容
        document.execCommand('insertText', false, content)

        return input.value === content
      }, text)
      console.log('[Interview ManualTest] execCommand 设置结果:', setInputSuccess)
    } catch (evalError: any) {
      console.error('[Interview ManualTest] execCommand 执行失败:', evalError?.message)
    }

    // 如果 execCommand 失败，回退到 type 方法
    if (!setInputSuccess) {
      console.log('[Interview ManualTest] 使用 type 方法输入')
      try {
        await chatInputHandle.click()
        await sleep(200)

        // 清空
        await page.evaluate(() => {
          const input = document.querySelector('.boss-chat-editor-input') as HTMLTextAreaElement
          if (input) {
            input.value = ''
            input.dispatchEvent(new Event('input', { bubbles: true }))
          }
        })
        await sleep(100)

        // 使用 type 方法输入
        await chatInputHandle.type(text, { delay: 50 })
        console.log('[Interview ManualTest] type 方法输入完成')
      } catch (typeError: any) {
        console.error('[Interview ManualTest] type 方法失败:', typeError?.message)
      }
    }

    await sleep(500)

    // 验证输入
    const inputValue = await page.evaluate(() => {
      const input = document.querySelector('.boss-chat-editor-input') as HTMLTextAreaElement
      return input?.value || ''
    })
    console.log('[Interview ManualTest] 输入验证, 期望:', text.length, '实际:', inputValue.length)

    // 按 Enter 发送
    await chatInputHandle.press('Enter')
    console.log('[Interview ManualTest] 已按 Enter 发送')

    await sleep(1000)
    return true
  } catch (e: any) {
    console.error('[Interview ManualTest] 发送消息失败:', e?.message || e)
    return false
  }
}

interface QuestionRound {
  id: number
  roundNumber: number
  questionText: string
}

interface JobPosition {
  id: number
  name: string
  passThreshold: number
  isActive: boolean
  llmScoringPrompt: string       // LLM评分提示词（岗位级别）
  resumeInviteText: string       // 简历邀约话术
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
  lastQuestionAt?: Date | null     // 最后发送问题时间
  lastScoredAt?: Date | null       // 最后评分时间
  lastReplyAt?: Date | null        // 最后回复时间
  totalScore?: number | null       // 总得分
  llmReason?: string | null        // LLM评分理由
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

// 保存问答记录（避免重复）
async function saveQaRecord(ds: DataSource, data: {
  candidateId: number
  roundNumber: number
  questionText: string
}): Promise<void> {
  const qaRepo = ds.getRepository('InterviewQaRecord')

  // 【修复】先查询是否已存在该轮次的记录
  const existing = await qaRepo.findOne({
    where: { candidateId: data.candidateId, roundNumber: data.roundNumber }
  })

  if (existing) {
    // 已存在，只更新问题发送时间（如果需要）
    console.log(`[Interview ManualTest] 第${data.roundNumber}轮问答记录已存在(id=${existing.id})，跳过创建`)
    // 如果问题文本不同，更新问题文本
    if (existing.questionText !== data.questionText) {
      await qaRepo.update(existing.id!, {
        questionText: data.questionText,
        questionSentAt: new Date()
      })
      console.log(`[Interview ManualTest] 已更新第${data.roundNumber}轮问题文本`)
    }
    return
  }

  // 不存在，创建新记录
  await qaRepo.save(qaRepo.create({
    ...data,
    questionSentAt: new Date()
  }))
  console.log(`[Interview ManualTest] 创建第${data.roundNumber}轮问答记录`)
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

// 获取问题轮次配置
function getQuestionRound(position: JobPosition, roundNumber: number): QuestionRound | null {
  return position.questionRounds.find(r => r.roundNumber === roundNumber)
}

// 点击"求简历"按钮发送简历交换请求
async function clickResumeExchangeBtn(page: Page): Promise<boolean> {
  try {
    console.log('[Interview ManualTest] 尝试点击"求简历"按钮...')

    // 查找"求简历"按钮（BOSS直聘聊天框中的按钮）
    const resumeBtnSelectors = [
      '.chat-conversation .message-controls .btn-resume',
      '.chat-conversation .message-controls .resume-btn',
      '.chat-conversation .message-controls [class*="resume"]',
      '.chat-conversation .message-controls [class*="request-resume"]',
      '.boss-chat-editor-wrap .btn-resume',
      '.boss-chat-editor-wrap .resume-btn',
      '.boss-chat-editor-wrap [class*="resume"]',
      '.message-controls .btn-request-resume',
      '.message-controls .btn-ask-resume',
      '.chat-editor-box .btn-resume',
      '.chat-editor-box [class*="resume"]',
      '[class*="ask-resume"]',
      '[class*="request-resume"]'
    ]

    let resumeBtn = null
    for (const selector of resumeBtnSelectors) {
      resumeBtn = await page.$(selector)
      if (resumeBtn) {
        console.log(`[Interview ManualTest] 找到求简历按钮: ${selector}`)
        break
      }
    }

    if (!resumeBtn) {
      console.log('[Interview ManualTest] 未找到"求简历"按钮，尝试从DOM查找')
      // 尝试从DOM中查找包含"简历"文字的按钮
      const btnHandle = await page.evaluateHandle(() => {
        const buttons = document.querySelectorAll('.chat-conversation button, .message-controls button, .boss-chat-editor-wrap button')
        for (const btn of buttons) {
          if (btn.textContent?.includes('简历') || btn.textContent?.includes('求简历')) {
            return btn
          }
        }
        return null
      })
      resumeBtn = btnHandle.asElement()
    }

    if (!resumeBtn) {
      console.log('[Interview ManualTest] 仍未找到"求简历"按钮')
      return false
    }

    // 点击"求简历"按钮
    await resumeBtn.click()
    console.log('[Interview ManualTest] 已点击"求简历"按钮')
    await sleep(1000)

    // 可能会出现确认弹窗，需要点击确认
    const confirmBtnSelectors = [
      '.dialog-box .btn-confirm',
      '.dialog-box .confirm-btn',
      '.modal-box .btn-confirm',
      '[class*="dialog"] .btn-confirm',
      '[class*="modal"] .btn-confirm'
    ]

    for (const selector of confirmBtnSelectors) {
      const confirmBtn = await page.$(selector)
      if (confirmBtn) {
        console.log(`[Interview ManualTest] 找到确认按钮: ${selector}`)
        await confirmBtn.click()
        await sleep(500)
        break
      }
    }

    return true
  } catch (error) {
    console.error('[Interview ManualTest] 点击"求简历"按钮失败:', error)
    return false
  }
}

// 发送简历邀约话术
async function sendResumeInvite(page: Page, inviteText: string): Promise<boolean> {
  if (!inviteText) {
    // 使用默认话术
    inviteText = '您好！感谢您的回复。我们对您的背景很感兴趣，能否发送一份您的简历？'
  }
  console.log('[Interview ManualTest] 发送简历邀约话术...')
  return await sendChatMessage(page, inviteText)
}

// 获取下一轮等待状态
function getNextWaitingStatus(currentStatus: string): string {
  const roundMatch = currentStatus.match(/waiting_round_(\d+)/)
  if (!roundMatch) return 'waiting_round_1'

  const currentRound = parseInt(roundMatch[1])
  return `waiting_round_${currentRound + 1}`
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

  try {
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
    console.log('[Interview ManualTest] 浏览器检查结果:', puppeteerExecutable ? puppeteerExecutable.executablePath : '未找到')

    if (!puppeteerExecutable) {
      console.log('[Interview ManualTest] 未找到浏览器配置，尝试自动配置...')
      try {
        await configWithBrowserAssistant({ autoFind: true })
        puppeteerExecutable = await getLastUsedAndAvailableBrowser()
        console.log('[Interview ManualTest] 配置后浏览器:', puppeteerExecutable ? puppeteerExecutable.executablePath : '仍未找到')
      } catch (e: any) {
        console.error('[Interview ManualTest] 浏览器配置失败:', e?.message || e)
        if (e?.message === 'USER_CANCELLED_CONFIG_BROWSER') {
          await dialog.showMessageBox({
            type: 'info',
            message: '浏览器配置已取消',
            detail: '请手动配置浏览器后再运行面试自动化。',
            buttons: ['确定']
          })
          return
        }
      }
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
    console.log('[Interview ManualTest] 设置 PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH)

    // 启动浏览器
    console.log('[Interview ManualTest] 启动浏览器...')
    let browser: Browser
    let page: Page
    try {
      browser = await launchBrowser()
      page = (await browser.pages())[0]
      console.log('[Interview ManualTest] 浏览器启动成功')
    } catch (launchErr: any) {
      console.error('[Interview ManualTest] 浏览器启动失败:', launchErr?.message || launchErr)
      await dialog.showMessageBox({
        type: 'error',
        message: '浏览器启动失败',
        detail: `错误信息: ${launchErr?.message || '未知错误'}\n\n请检查浏览器配置是否正确。`,
        buttons: ['确定']
      })
      return
    }

  // 检查 cookie
    const bossCookies = readStorageFile('boss-cookies.json')
    const cookieValid = checkCookieListFormat(bossCookies)
    console.log('[Interview ManualTest] Cookie 有效:', cookieValid)

    // 加载页面
    console.log('[Interview ManualTest] 加载 BOSS 页面...')
    await loadBossPage(browser, page)
    await sleep(2000)

    // 检查登录状态
    const currentUrl = page.url() ?? ''
    console.log('[Interview ManualTest] 当前 URL:', currentUrl)
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
            // 关键：source 属性是 BOSS直聘聊天列表项的主要数据来源
            const source = vue?.source || {}
            const data = props.geek || props.item || props.message || props.user || props.data || props.row || source

            // encryptJobId 主要在 source.encryptJobId 中
            const encryptJobId = source.encryptJobId || data.encryptJobId || ''

            return {
              name: name || data.name || data.geekName || data.fromName || '',
              encryptGeekId: keyId || data.encryptGeekId || data.geekId || data.securityId || source.encryptGeekId || '',
              encryptJobId,
              unreadCount: unreadCount || data.unreadCount || data.newMsgCount || 0,
              jobName: jobName || data.jobName || source.jobName || '',
              _rawData: data,
              _source: source,
              _hasVue: !!vue,
              _vueSourceKeys: source ? Object.keys(source).slice(0, 20) : []
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
            encryptJobId: firstItem.encryptJobId || '(空)',
            jobName: firstItem.jobName,
            unreadCount: firstItem.unreadCount,
            hasVue: firstItem._hasVue,
            sourceKeys: firstItem._vueSourceKeys || [],
            rawDataKeys: firstItem._rawData ? Object.keys(firstItem._rawData).slice(0, 15) : [],
            sourcePreview: firstItem._source ? JSON.stringify(firstItem._source).substring(0, 300) : ''
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

        // 【修复】优先使用从聊天列表获取的信息（targetChat）
        let encryptGeekId = (targetChat as any).encryptGeekId || geekInfo?.encryptGeekId || ''
        let geekName = targetChat.name || geekInfo?.name || ''
        let encryptJobId = (targetChat as any).encryptJobId || geekInfo?.encryptJobId || ''
        let jobName = (targetChat as any).jobName || geekInfo?.jobName || ''

        // 【修复】如果 encryptJobId 为空，尝试从 URL 参数获取
        if (!encryptJobId) {
          try {
            const urlParams = new URL(page.url())
            const jobIdFromUrl = urlParams.searchParams.get('jobId') || urlParams.searchParams.get('encryptJobId')
            if (jobIdFromUrl) {
              encryptJobId = jobIdFromUrl
              console.log('[Interview ManualTest] 从URL获取到 encryptJobId:', encryptJobId.substring(0, 10))
            }
          } catch (urlErr) {
            console.log('[Interview ManualTest] 从URL获取encryptJobId失败:', urlErr)
          }
        }

        console.log('[Interview ManualTest] 候选人信息:', {
          geekName,
          jobName,
          encryptGeekId: encryptGeekId ? '已获取(' + encryptGeekId.substring(0, 10) + '...)' : '空',
          encryptJobId: encryptJobId ? '已获取(' + encryptJobId.substring(0, 10) + '...)' : '空',
          targetChatEncryptJobId: (targetChat as any).encryptJobId ? '有' : '无',
          geekInfoEncryptJobId: geekInfo?.encryptJobId ? '有' : '无',
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

      // 【修复】获取候选人状态（多种查询方式）
      let candidate: Candidate | null = null

      // 方式1：使用 encryptGeekId + encryptJobId 精确查询
      if (encryptGeekId && encryptJobId) {
        candidate = await getCandidate(dataSource!, encryptGeekId, encryptJobId)
        console.log('[Interview ManualTest] 查询候选人(方式1):', candidate ?
          `已存在，状态=${candidate.status}, 轮次=${candidate.currentRound}` : '不存在')
      }

      // 方式2：如果 encryptJobId 为空，尝试只用 encryptGeekId 查询（宽松匹配）
      if (!candidate && encryptGeekId && !encryptJobId) {
        const candRepo = dataSource!.getRepository('InterviewCandidate')
        const candidates = await candRepo.find({
          where: { encryptGeekId },
          order: { updatedAt: 'DESC' },
          take: 1
        })
        if (candidates.length > 0) {
          candidate = candidates[0] as Candidate
          console.log('[Interview ManualTest] 查询候选人(方式2-只用encryptGeekId):',
            `已存在，状态=${candidate.status}, 轮次=${candidate.currentRound}, encryptJobId=${candidate.encryptJobId || '空'}`)
          // 补充 encryptJobId
          if (!encryptJobId && candidate.encryptJobId) {
            encryptJobId = candidate.encryptJobId
            console.log('[Interview ManualTest] 从数据库补充encryptJobId:', encryptJobId.substring(0, 10))
          }
        }
      }

      // 【修复】处理状态异常
      const validStatuses = ['new', 'waiting_round_1', 'waiting_round_2', 'waiting_round_3', 'passed', 'rejected', 'resume_requested']
      let candidateStatus = candidate?.status || 'new'
      if (!validStatuses.includes(candidateStatus)) {
        console.warn('[Interview ManualTest] 候选人状态异常:', candidateStatus, '，重置为new')
        candidateStatus = 'new'
        // 如果数据库中有异常状态，更新为new
        if (candidate && encryptJobId) {
          const candRepo = dataSource!.getRepository('InterviewCandidate')
          await candRepo.update(candidate.id!, { status: 'new' })
          candidate.status = 'new'
        }
      }

      // === 分支1: 处理等待回复的候选人（评分流程） ===
      if (candidateStatus.startsWith('waiting_round_')) {
        console.log('[Interview ManualTest] 候选人状态:', candidateStatus, '检查是否有新回复...')

        // 1. 检查最新消息是否来自候选人
        const isFromCandidate = await isLatestMessageFromCandidate(page)
        if (!isFromCandidate) {
          console.log('[Interview ManualTest] 最新消息不是候选人发送的，跳过')
          cursorIndex += 1
          continue
        }

        // 2. 合并30秒窗口内的消息
        const { mergedText, messages, latestMessageTime } = await mergeMessagesInWindow(page, candidate!, 30)
        if (!mergedText) {
          console.log('[Interview ManualTest] 未找到候选人回复内容，跳过')
          cursorIndex += 1
          continue
        }

        console.log('[Interview ManualTest] 合并回复内容:', mergedText.substring(0, 100))

        // 3. 获取问题轮次配置
        const currentRound = candidate!.currentRound
        const questionRound = getQuestionRound(matchedPosition, currentRound)

        if (!questionRound) {
          console.log('[Interview ManualTest] 未找到当前轮次配置，跳过')
          cursorIndex += 1
          continue
        }

        // 4. 弹窗确认评分
        const scoreConfirmRes = await dialog.showMessageBox({
          type: 'question',
          message: `确认对第 ${currentRound} 轮回复进行评分`,
          detail: `候选人：${geekName}\n应聘岗位：${jobName}\n当前轮次：第 ${currentRound} 轮\n通过阈值：${matchedPosition.passThreshold}分\n\n回复内容：\n${mergedText.substring(0, 200)}${mergedText.length > 200 ? '...' : ''}\n\n点击「评分」开始AI评分。`,
          buttons: ['评分', '跳过', '退出'],
          defaultId: 0
        })

        if (scoreConfirmRes.response === 2) {
          break
        }
        if (scoreConfirmRes.response === 1) {
          cursorIndex += 1
          continue
        }

        // 5. 执行评分
        console.log('[Interview ManualTest] 开始评分...')
        const scoreResult: ScoreResult = await scoreAnswer(
          dataSource!,
          candidate!,
          questionRound.questionText,
          mergedText,
          matchedPosition as any
        )

        console.log('[Interview ManualTest] 评分结果:', JSON.stringify(scoreResult))

        // 6. 保存问答记录（含评分）
        if (encryptJobId && candidate) {
          try {
            const qaRepo = dataSource!.getRepository('InterviewQaRecord')
            // 查找当前轮次的问答记录
            const existingRecord = await qaRepo.findOne({
              where: { candidateId: candidate.id, roundNumber: currentRound }
            })

            if (existingRecord) {
              // 更新现有记录
              await qaRepo.update(existingRecord.id!, {
                answerText: mergedText,
                answeredAt: new Date(),
                llmScore: scoreResult.llmScore,
                totalScore: scoreResult.totalScore,
                llmReason: scoreResult.llmReason,
                scoredAt: new Date()
              })
            } else {
              // 创建新记录
              await qaRepo.save(qaRepo.create({
                candidateId: candidate.id,
                roundNumber: currentRound,
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

            // 更新候选人得分和已评分时间
            const candRepo = dataSource!.getRepository('InterviewCandidate')
            await candRepo.update(candidate.id!, {
              totalScore: scoreResult.totalScore,
              llmReason: scoreResult.llmReason,
              lastReplyAt: new Date(),
              lastScoredAt: latestMessageTime || new Date()  // 记录已评分的消息时间，避免重复评分
            })

            console.log('[Interview ManualTest] 评分记录已保存，已评分时间:', latestMessageTime?.toISOString())
          } catch (dbErr) {
            console.error('[Interview ManualTest] 保存评分记录失败:', dbErr)
          }
        }

        // 7. 判断是否通过
        if (scoreResult.passed) {
          console.log('[Interview ManualTest] 评分通过！')

          // 检查是否有下一轮
          const nextRoundNumber = currentRound + 1
          const nextRound = getQuestionRound(matchedPosition, nextRoundNumber)

          if (nextRound) {
            // 发送下一轮问题
            const nextRoundRes = await dialog.showMessageBox({
              type: 'question',
              message: `评分通过，发送第 ${nextRoundNumber} 轮问题`,
              detail: `候选人：${geekName}\n第 ${currentRound} 轮评分：${scoreResult.totalScore}分（通过）\n\n下一轮问题：\n${nextRound.questionText}`,
              buttons: ['发送', '跳过', '退出'],
              defaultId: 0
            })

            if (nextRoundRes.response === 0) {
              const sendSuccess = await sendChatMessage(page, nextRound.questionText)
              if (sendSuccess && encryptJobId && candidate) {
                // 保存下一轮问答记录
                await saveQaRecord(dataSource!, {
                  candidateId: candidate.id,
                  roundNumber: nextRoundNumber,
                  questionText: nextRound.questionText
                })
                // 更新候选人状态
                const candRepo = dataSource!.getRepository('InterviewCandidate')
                await candRepo.update(candidate.id!, {
                  status: `waiting_round_${nextRoundNumber}`,
                  currentRound: nextRoundNumber,
                  lastQuestionAt: new Date()
                })
                console.log('[Interview ManualTest] 已发送第', nextRoundNumber, '轮问题')
              }
            }
          } else {
            // 全部通过，发送简历邀约
            console.log('[Interview ManualTest] 所有轮次通过！')

            const inviteRes = await dialog.showMessageBox({
              type: 'question',
              message: `所有轮次通过，发送简历邀约`,
              detail: `候选人：${geekName}\n已完成所有 ${matchedPosition.questionRounds.length} 轮面试\n总评分：${scoreResult.totalScore}分\n\n简历邀约话术：\n${matchedPosition.resumeInviteText || '您好！感谢您的回复。我们对您的背景很感兴趣，能否发送一份您的简历？'}`,
              buttons: ['发送', '跳过', '退出'],
              defaultId: 0
            })

            if (inviteRes.response === 0) {
              // 【修复】根据用户配置：发送文字消息（而不是点击按钮）
              const inviteText = matchedPosition.resumeInviteText || '您好！感谢您的回复。我们对您的背景很感兴趣，能否发送一份您的简历？'
              console.log('[Interview ManualTest] 发送简历邀约文字消息...')
              const sendSuccess = await sendResumeInvite(page, inviteText)

              if (sendSuccess && encryptJobId && candidate) {
                const candRepo = dataSource!.getRepository('InterviewCandidate')
                await candRepo.update(candidate.id!, {
                  status: 'resume_requested'
                })
                console.log('[Interview ManualTest] 已发送简历邀约，状态更新为 resume_requested')
              }
            }
          }
        } else {
          // 未通过，标记为拒绝
          console.log('[Interview ManualTest] 评分未通过')

        const rejectRes = await dialog.showMessageBox({
          type: 'warning',
          message: `评分未通过`,
          detail: `候选人：${geekName}\n第 ${currentRound} 轮评分：${scoreResult.totalScore}分（未达到 ${matchedPosition.passThreshold} 分阈值）\n\n将标记为「已拒绝」状态。`,
          buttons: ['确认拒绝', '跳过', '退出'],
          defaultId: 0
        })

        if (rejectRes.response === 0 && encryptJobId && candidate) {
          const candRepo = dataSource!.getRepository('InterviewCandidate')
          await candRepo.update(candidate.id!, {
            status: 'rejected'
          })
          console.log('[Interview ManualTest] 候选人已标记为 rejected')
        }
      }

      // 分支1处理完毕，跳到下一个候选人
      processedCount++
      cursorIndex += 1
      await sleep(1000)
      continue
    }

    // === 分支2: 处理新候选人（发送问题流程） ===
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
        let sendSuccess = await sendChatMessage(page, questionData.questionText)
        console.log('[Interview ManualTest] 发送结果:', sendSuccess ? '成功' : '失败')

        // 【修复】发送失败重试一次
        if (!sendSuccess) {
          console.log('[Interview ManualTest] 发送失败，等待2秒后重试...')
          await sleep(2000)
          sendSuccess = await sendChatMessage(page, questionData.questionText)
          console.log('[Interview ManualTest] 重试结果:', sendSuccess ? '成功' : '失败')
        }

        if (!sendSuccess) {
          console.log('[Interview ManualTest] 发送失败，跳过该候选人')
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
          // 【修复】encryptJobId缺失时提示用户
          console.warn('[Interview ManualTest] 未获取到 encryptJobId，跳过数据库保存')
          // 尝试继续处理，但不保存数据库（至少发送了消息）
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
  } catch (topLevelErr: any) {
    console.error('[Interview ManualTest] 顶层错误:', topLevelErr?.message || topLevelErr)
    try {
      await dialog.showMessageBox({
        type: 'error',
        message: '面试自动化执行出错',
        detail: `错误信息: ${topLevelErr?.message || '未知错误'}\n\n请查看控制台日志获取详细信息。`,
        buttons: ['确定']
      })
    } catch {
      // dialog 可能也不可用
    }
  }
}