import type { Frame, Page } from 'puppeteer'

export interface PublishedJob {
  encryptJobId: string
  jobName: string
}

export interface SwitchResult {
  switched: boolean
  matchedText: string
  availableJobs: string[]
}

const JOB_ITEM_SELECTOR = '.job-list .job-item'

/**
 * 获取包含推荐牛人内容的 frame
 *
 * 优先匹配 /frame/recommend（内容 iframe），避免误返回主页面壳（/web/chat/recommend）。
 */
function getRecommendFrame(page: Page): Frame | null {
  let fallback: Frame | null = null
  const allFrameUrls: string[] = []
  for (const frame of page.frames()) {
    const url = frame.url()
    allFrameUrls.push(url.substring(0, 120))
    if (url.includes('/frame/recommend')) {
      console.log('[DIAG getRecommendFrame] 选中 /frame/recommend frame:', url.substring(0, 120))
      return frame
    }
    if (url.includes('/web/chat/recommend')) {
      fallback = frame
    }
  }
  console.log('[DIAG getRecommendFrame] 所有frame URLs:', JSON.stringify(allFrameUrls))
  console.log(
    '[DIAG getRecommendFrame] fallback:',
    fallback ? '使用 /web/chat/recommend frame' : 'null, 将使用 page'
  )
  return fallback
}

/**
 * 获取操作上下文（优先 frame，降级 page）
 */
function getExecutionContext(page: Page): Frame | Page {
  const frame = getRecommendFrame(page)
  return frame || page
}

/**
 * 从推荐牛人页面的 DOM 提取已发布职位列表
 */
export async function fetchPublishedJobs(page: Page): Promise<PublishedJob[]> {
  const jobs: PublishedJob[] = []
  const ctx = getExecutionContext(page)

  // 先展开下拉框
  const currItem = await ctx.$('li.job-item.curr')
  if (!currItem) {
    return jobs
  }

  await currItem.click()

  try {
    await ctx.waitForSelector('.job-selecter-options .job-list', { timeout: 5000 })
  } catch {
    return jobs
  }

  const items = await ctx.$$('.job-selecter-options .job-list .job-item')
  for (const item of items) {
    const value = await item.evaluate((el) => el.getAttribute('value') || '')
    const text = await item.evaluate((el) => {
      const label = el.querySelector('.label')
      return label?.textContent?.trim() || ''
    })
    if (value && text) {
      jobs.push({ encryptJobId: value, jobName: text })
    }
  }

  // 关闭下拉框：点击页面其他区域
  await ctx.evaluate(() => {
    document.body.click()
  })

  return jobs
}

/**
 * 切换到指定岗位
 *
 * 交互流程：等待页面加载 → 点击当前选中项展开下拉 → 遍历匹配 → 点击目标 → 等待候选人加载
 */
export async function switchToJob(page: Page, jobName: string): Promise<SwitchResult> {
  const ctx = getExecutionContext(page)
  const ctxType = 'url' in ctx ? (ctx as any).url?.()?.substring(0, 80) : 'page'
  console.log('[DIAG switchToJob] 目标岗位:', jobName, '上下文:', ctxType)

  // 0. 等待页面加载完成，确保岗位选择器已渲染
  console.log('[DIAG switchToJob] Step0: 等待 li.job-item...')
  try {
    await ctx.waitForSelector('li.job-item', { timeout: 30000 })
    console.log('[DIAG switchToJob] Step0: li.job-item 已出现')
  } catch (e) {
    console.error('[DIAG switchToJob] Step0 失败: li.job-item 等待超时')
    throw e
  }

  // 1. 点击当前选中项展开下拉框
  const currItem = await ctx.$('li.job-item.curr')
  console.log('[DIAG switchToJob] Step1: li.job-item.curr:', currItem ? '找到' : '未找到')
  if (!currItem) {
    const allItems = await ctx.$$('li.job-item')
    console.log('[DIAG switchToJob] Step1: 所有 li.job-item 数量:', allItems.length)
    for (let i = 0; i < Math.min(allItems.length, 5); i++) {
      const cls = await allItems[i].evaluate((el) => el.className)
      console.log('[DIAG switchToJob] Step1: item[' + i + '] class:', cls)
    }
    throw new Error('页面上未找到当前选中的岗位元素（li.job-item.curr），页面结构可能已变更')
  }

  // 使用 JS 原生 click 替代 Puppeteer 鼠标点击，避免 iframe 内坐标偏移导致点击失效
  await currItem.evaluate((el) => (el as HTMLElement).click())
  console.log('[DIAG switchToJob] Step1: 已点击 currItem')

  // 2. 等待下拉列表出现
  console.log('[DIAG switchToJob] Step2: 等待下拉列表...')
  try {
    await ctx.waitForSelector('.job-selecter-options .job-list', { timeout: 30000 })
    console.log('[DIAG switchToJob] Step2: 下拉列表已出现')
  } catch (e) {
    console.error('[DIAG switchToJob] Step2 失败: 下拉列表等待超时')
    const optionsEl = await ctx.$('.job-selecter-options')
    console.log('[DIAG switchToJob] Step2: .job-selecter-options:', optionsEl ? '存在' : '不存在')
    throw e
  }

  // 3. 获取所有岗位选项
  const items = await ctx.$$(JOB_ITEM_SELECTOR)
  console.log('[DIAG switchToJob] Step3: 岗位选项数量:', items.length)
  const availableTexts: string[] = []
  let matchedElement: any = null
  let matchedText = ''

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const text = await item.evaluate((el) => {
      const label = el.querySelector('.label')
      return label?.textContent?.trim() || ''
    })
    availableTexts.push(text)
    console.log('[DIAG switchToJob] Step3: item[' + i + ']:', JSON.stringify(text))

    if (!matchedElement) {
      const textPrefix = text.replace(/\s+/g, '').slice(0, 5)
      const jobNamePrefix = jobName.replace(/\s+/g, '').slice(0, 5)
      if (textPrefix && jobNamePrefix && textPrefix === jobNamePrefix) {
        matchedElement = item
        matchedText = text
        console.log('[DIAG switchToJob] Step3: 匹配成功! prefix:', JSON.stringify(textPrefix))
      }
    }
  }

  // 4. 无匹配
  if (!matchedElement) {
    console.log(
      '[DIAG switchToJob] Step4: 无匹配, 目标:',
      JSON.stringify(jobName),
      'normalizePrefix:',
      JSON.stringify(jobName.replace(/\s+/g, '').slice(0, 5))
    )
    return { switched: false, matchedText: '', availableJobs: availableTexts }
  }

  // 5. 已是当前选中
  const isAlreadySelected = await matchedElement.evaluate((el) => el.classList.contains('curr'))
  console.log('[DIAG switchToJob] Step5: 是否已选中:', isAlreadySelected)
  if (isAlreadySelected) {
    return { switched: true, matchedText, availableJobs: availableTexts }
  }

  // 6. 点击目标岗位 — 使用 JS 原生 click
  console.log('[DIAG switchToJob] Step6: 点击目标岗位:', matchedText)
  await matchedElement.evaluate((el) => (el as HTMLElement).click())
  console.log('[DIAG switchToJob] Step6: 点击完成')

  // 7. 等待候选人卡片出现（确认切换生效）
  try {
    await ctx.waitForFunction(
      () => {
        return !!document.querySelector('.join-text-wrap, .base-info, .card-inner')
      },
      { timeout: 10000 }
    )
    console.log('[DIAG switchToJob] Step7: 候选人卡片已出现')
  } catch {
    console.log('[DIAG switchToJob] Step7: 等待候选人卡片超时，继续执行')
  }

  return { switched: true, matchedText, availableJobs: availableTexts }
}
