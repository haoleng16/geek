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
 */
function getRecommendFrame(page: Page): Frame | null {
  for (const frame of page.frames()) {
    if (frame.url().includes('/frame/recommend') || frame.url().includes('/web/chat/recommend')) {
      return frame
    }
  }
  return null
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
    const value = await item.evaluate(el => el.getAttribute('value') || '')
    const text = await item.evaluate(el => {
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

  // 0. 等待页面加载完成，确保岗位选择器已渲染
  await ctx.waitForSelector('li.job-item', { timeout: 30000 })

  // 1. 点击当前选中项展开下拉框
  const currItem = await ctx.$('li.job-item.curr')
  if (!currItem) {
    throw new Error('页面上未找到当前选中的岗位元素（li.job-item.curr），页面结构可能已变更')
  }

  await currItem.click()

  // 2. 等待下拉列表出现
  await ctx.waitForSelector('.job-selecter-options .job-list', { timeout: 30000 })

  // 3. 获取所有岗位选项
  const items = await ctx.$$(JOB_ITEM_SELECTOR)
  const availableTexts: string[] = []
  let matchedElement: any = null
  let matchedText = ''

  for (const item of items) {
    const text = await item.evaluate(el => {
      const label = el.querySelector('.label')
      return label?.textContent?.trim() || ''
    })
    availableTexts.push(text)

    if (!matchedElement) {
      // 双向包含匹配
      if (text.includes(jobName) || jobName.includes(text)) {
        matchedElement = item
        matchedText = text
      }
    }
  }

  // 4. 无匹配
  if (!matchedElement) {
    return { switched: false, matchedText: '', availableJobs: availableTexts }
  }

  // 5. 已是当前选中
  const isAlreadySelected = await matchedElement.evaluate(
    el => el.classList.contains('curr')
  )
  if (isAlreadySelected) {
    return { switched: true, matchedText, availableJobs: availableTexts }
  }

  // 6. 点击目标岗位
  await matchedElement.click()

  // 7. 等待候选人卡片出现（确认切换生效）
  try {
    await ctx.waitForFunction(
      () => {
        return !!document.querySelector('.join-text-wrap, .base-info, .card-inner')
      },
      { timeout: 10000 }
    )
  } catch {
    // 等待超时不阻断流程，候选人扫描环节有自己的重试逻辑
    console.log('[switchToJob] 等待候选人卡片超时，继续执行')
  }

  return { switched: true, matchedText, availableJobs: availableTexts }
}
