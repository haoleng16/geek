import type { ElementHandle, Frame, Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'

const HTML_RESUME_ROOT_SELECTORS = [
  '.resume-item-content',
  '.resume-content .resume-item-content',
  '.resume-preview .resume-item-content'
]

const CANVAS_RESUME_SELECTORS = ['canvas#resume', '#resume canvas', 'div#resume canvas']

const RESUME_CLOSE_SELECTORS = [
  '.boss-popup__close',
  '.boss-popup__close .icon-close',
  '.resume-dialog [class*="close"]',
  '.resume-wrap [class*="close"]',
  '[class*="resume"] [class*="close"]',
  '.icon-close',
  '[class*="close-btn"]'
]

const RESUME_POPUP_READY_SELECTORS = [
  ...CANVAS_RESUME_SELECTORS,
  ...HTML_RESUME_ROOT_SELECTORS,
  '.boss-popup__close',
  '.boss-popup__close .icon-close'
]

/**
 * 获取目标 frame（优先用 frameIndex，降级遍历）
 */
export function getTargetFrame(
  page: Page | null | undefined,
  frameIndex?: number
): Frame | Page | null {
  if (!page) {
    return null
  }
  if (typeof frameIndex === 'number') {
    const frames = page.frames()
    if (frames[frameIndex]) return frames[frameIndex]
  }
  // 降级：找包含推荐内容的 frame
  for (const frame of page.frames()) {
    if (frame.url().includes('/frame/recommend') || frame.url().includes('/web/chat/recommend')) {
      return frame
    }
  }
  return page
}

async function safe$(
  context: Page | Frame | null | undefined,
  selector: string
): Promise<ElementHandle<Element> | null> {
  if (!context) {
    return null
  }
  try {
    return await context.$(selector)
  } catch {
    return null
  }
}

function getSearchContexts(
  page: Page | null | undefined,
  frameIndex?: number
): Array<Page | Frame> {
  if (!page) {
    return []
  }
  const preferred = getTargetFrame(page, frameIndex)
  const contexts: Array<Page | Frame> = preferred ? [preferred, page] : [page]
  for (const frame of page.frames()) {
    if (!contexts.includes(frame)) {
      contexts.push(frame)
    }
  }
  return contexts
}

async function findResumeRoot(
  page: Page,
  frameIndex?: number
): Promise<ElementHandle<Element> | null> {
  return await findVisibleElement(page, frameIndex, [
    ...CANVAS_RESUME_SELECTORS,
    ...HTML_RESUME_ROOT_SELECTORS
  ])
}

async function findResumePopupIndicator(
  page: Page,
  frameIndex?: number
): Promise<ElementHandle<Element> | null> {
  return await findVisibleElement(page, frameIndex, RESUME_POPUP_READY_SELECTORS)
}

async function findVisibleElement(
  page: Page,
  frameIndex: number | undefined,
  selectors: string[]
): Promise<ElementHandle<Element> | null> {
  const contexts = getSearchContexts(page, frameIndex)
  for (const context of contexts) {
    for (const selector of selectors) {
      const element = await safe$(context, selector)
      if (element) {
        try {
          const visible = await element.evaluate((el) => {
            const rect = el.getBoundingClientRect()
            const style = window.getComputedStyle(el)
            return (
              rect.width > 10 &&
              rect.height > 10 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0'
            )
          })
          if (visible) {
            return element
          }
        } catch {
          // ignore detached handle
        }
        await element.dispose().catch(() => undefined)
      }
    }
  }
  return null
}

async function waitForResumeClosed(page: Page, frameIndex?: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const popupIndicator = await findResumePopupIndicator(page, frameIndex)
    if (!popupIndicator) {
      return true
    }
    await popupIndicator.dispose().catch(() => undefined)
    await sleep(200)
  }
  return false
}

/**
 * 通过 data-geek / data-geekid 查找卡片
 */
async function findCard(
  page: Page,
  cardKey: string,
  encryptUserId: string,
  frameIndex?: number
): Promise<ElementHandle<Element> | null> {
  const ctx = getTargetFrame(page, frameIndex)
  if (!ctx) {
    return null
  }

  // 优先 cardKey
  if (cardKey) {
    const el = await safe$(ctx, `[data-geekgeekrun-card-key="${cardKey}"]`)
    if (el) return el
  }

  // data-geek / data-geekid
  if (encryptUserId) {
    let el = await safe$(ctx, `[data-geek="${encryptUserId}"]`)
    if (el) return el
    el = await safe$(ctx, `[data-geekid="${encryptUserId}"]`)
    if (el) return el
  }

  return null
}

/**
 * 打开候选人在线简历
 *
 * 推荐牛人页面：点击卡片后展示同页简历弹窗。
 * 目前优先识别真实简历载体 canvas#resume，其次兼容 HTML 简历结构。
 */
export async function openCandidateResume(
  page: Page | null | undefined,
  cardKey: string,
  frameIndex?: number,
  encryptUserId?: string
): Promise<ElementHandle<Element> | null> {
  if (!page) {
    console.warn('[RecommendTalent Resume] 页面对象为空，无法打开简历')
    return null
  }
  const uid = encryptUserId || ''

  // 同页弹窗场景下，如果上一份简历还没关掉，先收口再继续。
  await closeCandidateResume(page, frameIndex).catch(() => undefined)
  await sleep(200)

  const cardElement = await findCard(page, cardKey, uid, frameIndex)
  if (!cardElement) {
    console.warn('[RecommendTalent Resume] 未找到卡片, uid:', uid)
    return null
  }

  // 滚动到卡片可见
  try {
    await cardElement.evaluate((el) => {
      el.scrollIntoView({ behavior: 'instant', block: 'center' })
    })
    await sleep(500)
  } catch {
    console.warn('[RecommendTalent Resume] 滚动失败')
    return null
  }

  // 点击卡片打开简历
  try {
    await cardElement.click({ delay: 50 })
    console.log('[RecommendTalent Resume] 已点击卡片')
  } catch {
    try {
      const box = await cardElement.boundingBox()
      if (box) {
        await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3)
        console.log('[RecommendTalent Resume] 坐标点击卡片')
      }
    } catch {
      return null
    }
  }

  // 等待 HTML 简历弹窗渲染完成
  const popupReadyTarget = await waitForResumePopupReady(page, frameIndex)
  if (popupReadyTarget) {
    const resumeRoot = await findResumeRoot(page, frameIndex)
    if (resumeRoot) {
      await popupReadyTarget.dispose().catch(() => undefined)
      console.log('[RecommendTalent Resume] 简历正文已就绪')
      return resumeRoot
    }
    console.log('[RecommendTalent Resume] 简历弹窗已就绪')
    return popupReadyTarget
  }

  console.warn('[RecommendTalent Resume] 未检测到简历弹窗')
  return null
}

/**
 * 等待简历弹窗渲染完成
 */
async function waitForResumePopupReady(
  page: Page | null | undefined,
  frameIndex?: number
): Promise<ElementHandle<Element> | null> {
  if (!page) {
    return null
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const resumeTarget = await findVisibleElement(page, frameIndex, RESUME_POPUP_READY_SELECTORS)
    if (resumeTarget) {
      return resumeTarget
    }
    await sleep(500)
  }

  return null
}

/**
 * 关闭候选人简历
 */
export async function closeCandidateResume(
  page: Page | null | undefined,
  frameIndex?: number
): Promise<void> {
  if (!page) {
    return
  }
  let popupIndicator = await findResumePopupIndicator(page, frameIndex)
  if (!popupIndicator) {
    return
  }
  await popupIndicator.dispose().catch(() => undefined)

  const contexts = getSearchContexts(page, frameIndex)
  for (const context of contexts) {
    for (const selector of RESUME_CLOSE_SELECTORS) {
      const closeButton = await safe$(context, selector)
      if (!closeButton) continue
      try {
        await closeButton.evaluate((el) => {
          ;(el as HTMLElement).click()
        })
        const closed = await waitForResumeClosed(page, frameIndex)
        if (closed) {
          console.log('[RecommendTalent Resume] 点击弹窗关闭按钮关闭简历')
          return
        }
      } catch {
        try {
          const box = await closeButton.boundingBox()
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
            const closed = await waitForResumeClosed(page, frameIndex)
            if (closed) {
              console.log('[RecommendTalent Resume] 坐标点击关闭按钮关闭简历')
              return
            }
          }
        } catch {
          // try next selector
        }
      } finally {
        await closeButton.dispose().catch(() => undefined)
      }
    }
  }

  await page.keyboard.press('Escape').catch(() => undefined)
  const closedByEscape = await waitForResumeClosed(page, frameIndex)
  if (closedByEscape) {
    console.log('[RecommendTalent Resume] 通过 Escape 关闭简历')
    return
  }

  const targetContext = getTargetFrame(page, frameIndex)
  if (!targetContext) {
    return
  }
  try {
    await targetContext.evaluate(() => window.history.back())
    const closedByHistory = await waitForResumeClosed(page, frameIndex)
    if (closedByHistory) {
      console.log('[RecommendTalent Resume] history.back() 关闭简历')
    }
  } catch {
    // ignore
  }
  await sleep(500)
}
