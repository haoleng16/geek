import type { Frame, Page } from 'puppeteer'
import { getTargetFrame } from './resume-handler'

export interface ResumeDomSection {
  title: string
  content: string
}

export interface ResumeDomExtractResult {
  sections: ResumeDomSection[]
  plainText: string
}

const RESUME_ROOT_SELECTOR = '.resume-item-content'
const RESUME_SECTION_SELECTORS = ':scope > .resume-item, :scope > .resume-section'
const RESUME_STOP_TITLES = ['专业技能']

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

async function getExtractContext(page: Page, frameIndex?: number): Promise<Page | Frame> {
  const preferred = getTargetFrame(page, frameIndex)
  const contexts: Array<Page | Frame> = preferred ? [preferred, page] : [page]
  for (const frame of page.frames()) {
    if (!contexts.includes(frame)) {
      contexts.push(frame)
    }
  }

  for (const context of contexts) {
    const root = await context.$(RESUME_ROOT_SELECTOR).catch(() => null)
    if (root) {
      await root.dispose().catch(() => undefined)
      return context
    }
  }

  return preferred
}

export async function extractResumeDomText(
  page: Page | null | undefined,
  frameIndex?: number
): Promise<ResumeDomExtractResult | null> {
  if (!page) {
    return null
  }
  const context = await getExtractContext(page, frameIndex)

  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await context
      .evaluate(
        ({ rootSelector, sectionSelectors, stopTitles }) => {
          const normalize = (text: string): string =>
            text
              .replace(/\u00a0/g, ' ')
              .replace(/\r/g, '')
              .replace(/[ \t]+\n/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .replace(/[ \t]{2,}/g, ' ')
              .trim()

          const getVisibleElement = (selectors: string[]): HTMLElement | null => {
            for (const selector of selectors) {
              const element = document.querySelector(selector) as HTMLElement | null
              if (!element) continue
              const rect = element.getBoundingClientRect()
              const style = window.getComputedStyle(element)
              if (
                rect.width > 10 &&
                rect.height > 10 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0'
              ) {
                return element
              }
            }
            return null
          }

          const root = getVisibleElement([rootSelector])
          if (root) {
            const sections: Array<{ title: string; content: string }> = []
            const blocks = Array.from(root.querySelectorAll(sectionSelectors)) as HTMLElement[]

            for (const block of blocks) {
              const titleEl = block.querySelector('.title, .section-title')
              const title = normalize(titleEl?.textContent || '')
              if (!title) {
                continue
              }

              const clonedBlock = block.cloneNode(true) as HTMLElement
              clonedBlock
                .querySelectorAll(
                  '.resume-warning, .geek-recommend-card, [class*="close"], button, a[href]'
                )
                .forEach((node) => node.remove())

              clonedBlock.querySelector('.title, .section-title')?.remove()

              const content = normalize(clonedBlock.textContent || '')
              if (!content) {
                continue
              }

              sections.push({ title, content })

              if (stopTitles.some((stopTitle) => title.includes(stopTitle))) {
                break
              }
            }

            if (sections.length > 0) {
              return {
                sections,
                plainText: sections
                  .map((section) => `## ${section.title}\n${section.content}`)
                  .join('\n\n')
              }
            }
          }

          return null
        },
        {
          rootSelector: RESUME_ROOT_SELECTOR,
          sectionSelectors: RESUME_SECTION_SELECTORS,
          stopTitles: RESUME_STOP_TITLES
        }
      )
      .then((value) => value)
      .catch(() => null)

    if (result) {
      return {
        sections: result.sections.map((section) => ({
          title: normalizeText(section.title),
          content: normalizeText(section.content)
        })),
        plainText: normalizeText(result.plainText)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  return null
}
