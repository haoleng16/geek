import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ElementHandle, Frame, Page } from 'puppeteer'
import { getTargetFrame } from './resume-handler'

const RESUME_CANVAS_SELECTORS = ['canvas#resume', '#resume canvas', 'div#resume canvas']

const HTML_RESUME_ROOT_SELECTORS = [
  '.resume-item-content',
  '.resume-content .resume-item-content',
  '.resume-preview .resume-item-content'
]

async function getResumeSnapshotContexts(
  page: Page,
  frameIndex?: number
): Promise<Array<Page | Frame>> {
  const preferred = getTargetFrame(page, frameIndex)
  const contexts: Array<Page | Frame> = preferred ? [preferred, page] : [page]
  for (const frame of page.frames()) {
    if (!contexts.includes(frame)) {
      contexts.push(frame)
    }
  }

  return contexts
}

async function findVisibleResumeCanvas(
  page: Page,
  frameIndex?: number
): Promise<{ context: Page | Frame; selector: string; element: ElementHandle<Element> } | null> {
  const contexts = await getResumeSnapshotContexts(page, frameIndex)
  console.log(
    '[DIAG findVisibleResumeCanvas] 搜索上下文数量:',
    contexts.length,
    'frameIndex:',
    frameIndex
  )

  // 阶段1：用特定选择器搜索
  for (let ci = 0; ci < contexts.length; ci++) {
    const context = contexts[ci]
    const ctxUrl = 'url' in context ? (context as any).url() : 'page'
    for (const selector of RESUME_CANVAS_SELECTORS) {
      const element = await context.$(selector).catch(() => null)
      if (!element) {
        continue
      }

      try {
        const visible = await element.evaluate((node) => {
          const el = node as HTMLElement
          const rect = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          return {
            isVisible:
              rect.width > 10 &&
              rect.height > 10 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0',
            width: rect.width,
            height: rect.height,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity
          }
        })

        console.log(
          '[DIAG findVisibleResumeCanvas] context[' + ci + ']:',
          ctxUrl,
          'selector:',
          selector,
          'visible:',
          visible
        )

        if (visible.isVisible) {
          return { context, selector, element }
        }
      } catch {
        // ignore detached element
      }

      await element.dispose().catch(() => undefined)
    }
  }

  // 阶段2：特定选择器全部未命中，全量扫描所有上下文中的 canvas 元素
  console.warn('[DIAG findVisibleResumeCanvas] 特定选择器未命中，开始全量canvas扫描')
  for (let ci = 0; ci < contexts.length; ci++) {
    const context = contexts[ci]
    const ctxUrl = 'url' in context ? (context as any).url() : 'page'
    const allCanvases = await context.$$('canvas').catch(() => [])
    if (allCanvases.length === 0) continue

    console.log(
      '[DIAG findVisibleResumeCanvas] 全量扫描 context[' + ci + ']:',
      ctxUrl.substring(0, 120),
      'canvas数量:',
      allCanvases.length
    )
    for (const canvasEl of allCanvases) {
      try {
        const info = await canvasEl.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          const canvas = el as HTMLCanvasElement
          return {
            id: el.id,
            className: el.className,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            cssWidth: rect.width,
            cssHeight: rect.height,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            parentTag: el.parentElement?.tagName || '',
            parentId: el.parentElement?.id || '',
            parentClass: el.parentElement?.className || ''
          }
        })
        console.log('[DIAG findVisibleResumeCanvas] canvas详情:', JSON.stringify(info))

        if (
          info.cssWidth > 100 &&
          info.cssHeight > 100 &&
          info.display !== 'none' &&
          info.visibility !== 'hidden' &&
          info.opacity !== '0'
        ) {
          const matchedSelector = info.id ? `canvas#${info.id}` : 'canvas'
          console.log('[DIAG findVisibleResumeCanvas] 全量扫描命中:', matchedSelector)
          return { context, selector: matchedSelector, element: canvasEl }
        }
      } catch {
        // ignore detached element
      }
      await canvasEl.dispose().catch(() => undefined)
    }
  }

  // 阶段3：扫描 page.frames() 中可能遗漏的动态 iframe（如 c-resume）
  console.warn('[DIAG findVisibleResumeCanvas] 全量扫描也未命中，尝试扫描动态iframe')
  for (const frame of page.frames()) {
    const frameUrl = frame.url()
    if (!frameUrl.includes('/frame/') && !frameUrl.includes('/resume')) continue
    if (contexts.includes(frame as any)) continue

    console.log('[DIAG findVisibleResumeCanvas] 发现未搜索的frame:', frameUrl.substring(0, 120))
    try {
      const canvases = await frame.$$('canvas')
      for (const canvasEl of canvases) {
        const info = await canvasEl.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          return {
            id: el.id,
            cssWidth: rect.width,
            cssHeight: rect.height,
            display: style.display,
            visibility: style.visibility
          }
        })
        console.log('[DIAG findVisibleResumeCanvas] 动态frame canvas:', JSON.stringify(info))
        if (info.cssWidth > 100 && info.cssHeight > 100 && info.display !== 'none') {
          return {
            context: frame,
            selector: info.id ? `canvas#${info.id}` : 'canvas',
            element: canvasEl
          }
        }
        await canvasEl.dispose().catch(() => undefined)
      }
    } catch {
      // frame可能不可访问
    }
  }

  console.warn('[DIAG findVisibleResumeCanvas] 所有上下文中均未找到可见canvas')
  return null
}

async function findVisibleHtmlResume(
  page: Page,
  frameIndex?: number
): Promise<{ context: Page | Frame; element: ElementHandle<Element> } | null> {
  const contexts = await getResumeSnapshotContexts(page, frameIndex)

  for (const context of contexts) {
    for (const selector of HTML_RESUME_ROOT_SELECTORS) {
      const element = await context.$(selector).catch(() => null)
      if (!element) continue

      try {
        const visible = await element.evaluate((node) => {
          const el = node as HTMLElement
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
          return { context, element }
        }
      } catch {
        // ignore detached element
      }

      await element.dispose().catch(() => undefined)
    }
  }

  console.warn('[DIAG findVisibleHtmlResume] 所有上下文中均未找到可见HTML简历节点')
  return null
}

function buildSnapshotFilePath(
  sessionId: string,
  encryptUserId: string,
  ext: 'jpg' | 'png'
): string {
  const dir = join(homedir(), '.geekgeekrun', 'storage', 'snapshots', 'recommend', sessionId)
  mkdirSync(dir, { recursive: true })
  return join(dir, `${encryptUserId}_resume_${Date.now()}.${ext}`)
}

export async function screenshotElement(
  targetElement: ElementHandle,
  sessionId: string,
  encryptUserId: string,
  suffix = 'resume'
): Promise<{ filePath: string; fileSize: number }> {
  const dir = join(homedir(), '.geekgeekrun', 'storage', 'snapshots', 'recommend', sessionId)
  mkdirSync(dir, { recursive: true })

  const fileName = `${encryptUserId}_${suffix}_${Date.now()}.jpg`
  const filePath = join(dir, fileName)

  const buffer = (await targetElement.screenshot({
    type: 'jpeg',
    quality: 80
  })) as Buffer

  writeFileSync(filePath, buffer)

  return { filePath, fileSize: buffer.length }
}

export async function screenshotResumeSnapshot(
  page: Page | null | undefined,
  sessionId: string,
  encryptUserId: string,
  frameIndex?: number
): Promise<{ filePath: string; fileSize: number }> {
  if (!page) {
    throw new Error('页面对象为空，无法生成简历快照')
  }

  // 诊断：输出 Puppeteer 可见的所有 frame 信息及每个 frame 中的 canvas 数量
  const allFrames = page.frames()
  console.log('[DIAG screenshotResumeSnapshot] Puppeteer page.frames() 数量:', allFrames.length)
  for (let fi = 0; fi < allFrames.length; fi++) {
    const f = allFrames[fi]
    const fUrl = f.url()
    let canvasCount = -1
    try {
      canvasCount = await f.evaluate(() => document.querySelectorAll('canvas').length)
    } catch {
      canvasCount = -1
    }
    console.log(
      '[DIAG screenshotResumeSnapshot] frame[' + fi + ']:',
      fUrl.substring(0, 150),
      'canvas数量:',
      canvasCount
    )
  }

  // 诊断：通过主页面 JS 检查所有 iframe（包括 Puppeteer 可能未追踪的）
  try {
    const iframeReport = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe'))
      return iframes.map((iframe) => ({
        src: iframe.src || iframe.getAttribute('src') || '',
        id: iframe.id,
        className: iframe.className,
        width: iframe.offsetWidth,
        height: iframe.offsetHeight,
        hasContentDocument: !!iframe.contentDocument
      }))
    })
    console.log('[DIAG screenshotResumeSnapshot] 主页面iframe:', JSON.stringify(iframeReport))
  } catch {
    console.warn('[DIAG screenshotResumeSnapshot] 主页面iframe检测失败')
  }

  // 阶段1：尝试 canvas 截图
  for (let attempt = 0; attempt < 20; attempt++) {
    const canvasTarget = await findVisibleResumeCanvas(page, frameIndex)
    if (!canvasTarget) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      continue
    }

    const { context, selector, element } = canvasTarget

    try {
      const base64 = await context
        .evaluate((canvasSelector) => {
          const canvas = document.querySelector(canvasSelector)
          if (!(canvas instanceof HTMLCanvasElement)) {
            return null
          }
          try {
            return canvas.toDataURL('image/jpeg', 0.9).split(',')[1] || null
          } catch {
            return null
          }
        }, selector)
        .catch(() => null)

      if (base64) {
        const filePath = buildSnapshotFilePath(sessionId, encryptUserId, 'jpg')
        const buffer = Buffer.from(base64, 'base64')
        writeFileSync(filePath, buffer)
        return { filePath, fileSize: buffer.length }
      }

      return await screenshotElement(element, sessionId, encryptUserId, 'resume')
    } finally {
      await element.dispose().catch(() => undefined)
    }
  }

  // 阶段2：canvas 未找到，回退到 HTML 简历节点截图
  console.log('[DIAG screenshotResumeSnapshot] canvas未找到，尝试HTML简历截图')
  for (let attempt = 0; attempt < 10; attempt++) {
    const htmlTarget = await findVisibleHtmlResume(page, frameIndex)
    if (!htmlTarget) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      continue
    }

    const { element } = htmlTarget
    try {
      return await screenshotElement(element, sessionId, encryptUserId, 'resume')
    } finally {
      await element.dispose().catch(() => undefined)
    }
  }

  throw new Error('未找到可截图的简历节点（canvas 和 HTML 均未命中）')
}

export async function screenshotCardElement(
  page: Page,
  cardElement: ElementHandle,
  sessionId: string,
  encryptUserId: string
): Promise<{ filePath: string; fileSize: number }> {
  return await screenshotElement(cardElement, sessionId, encryptUserId, 'card')
}

export function readScreenshotAsBase64(filePath: string): string {
  const buffer = readFileSync(filePath)
  return buffer.toString('base64')
}
