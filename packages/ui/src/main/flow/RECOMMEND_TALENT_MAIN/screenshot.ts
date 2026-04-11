import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ElementHandle, Frame, Page } from 'puppeteer'
import { getTargetFrame } from './resume-handler'

const RESUME_CANVAS_SELECTORS = ['canvas#resume', '#resume canvas', 'div#resume canvas']

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

  for (const context of contexts) {
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
          return (
            rect.width > 10 &&
            rect.height > 10 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          )
        })

        if (visible) {
          return { context, selector, element }
        }
      } catch {
        // ignore detached element
      }

      await element.dispose().catch(() => undefined)
    }
  }

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

  throw new Error('未找到可截图的简历 canvas 节点')
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
