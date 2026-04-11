import type { ElementHandle, Frame, Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import type { CandidateCard } from './pre-filter'

export async function scrollAndExtractCards(page: Page): Promise<CandidateCard[]> {
  const frames = page.frames()
  const allCards: CandidateCard[] = []

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex]
    const extraction = await extractCardsFromFrame(frame, frameIndex)
    console.log(
      '[RecommendTalent Scanner] frame扫描结果:',
      JSON.stringify({
        frameIndex,
        url: frame.url(),
        ...extraction.stats
      })
    )
    allCards.push(...extraction.cards)
  }

  return allCards
}

async function extractCardsFromFrame(
  frame: Frame,
  frameIndex: number
): Promise<{ cards: CandidateCard[]; stats: Record<string, number> }> {
  return await frame.evaluate((runtimeFrameIndex) => {
    const CARD_KEY_ATTR = 'data-geekgeekrun-card-key'

    function textOf(node: Element | null | undefined): string {
      return node?.textContent?.replace(/\s+/g, ' ').trim() || ''
    }

    function hashText(input: string): string {
      let hash = 0
      for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0
      }
      return Math.abs(hash).toString(36)
    }

    function parseAge(parts: string[]): number | undefined {
      const ageText = parts.find((part) => /\d+\s*岁/.test(part))
      if (!ageText) return undefined
      const match = ageText.match(/(\d+)\s*岁/)
      return match ? Number(match[1]) : undefined
    }

    function parseWorkYears(parts: string[]): number {
      const workYearText = parts.find((part) => part.includes('应届生') || /\d+\s*年/.test(part)) || ''
      if (workYearText.includes('应届生')) {
        return 0
      }
      const match = workYearText.match(/(\d+)\s*年/)
      return match ? Number(match[1]) : 0
    }

    function parseDegree(parts: string[]): string {
      return parts.find((part) => /大专|本科|硕士|博士|MBA|EMBA|中专|高中/.test(part)) || ''
    }

    function parseActiveStatus(text: string): string {
      const patterns = [
        /刚刚活跃/,
        /刚刚在线/,
        /在线/,
        /\d+\s*分钟前活跃/,
        /\d+\s*小时前活跃/,
        /\d+\s*天前活跃/,
        /\d+\s*日内活跃/,
        /本周活跃/,
        /刚刚活跃/,
        /近一周活跃/,
        /近一月活跃/,
        /最近活跃/
      ]
      for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match?.[0]) {
          return match[0]
        }
      }
      return ''
    }

    function parseActiveDaysAgo(activeStatus: string): number {
      if (!activeStatus) return 99
      if (activeStatus.includes('在线') || activeStatus.includes('刚刚')) return 0
      if (activeStatus.includes('本周')) return 7
      if (activeStatus.includes('近一周')) return 7
      if (activeStatus.includes('近一月')) return 30
      const minuteMatch = activeStatus.match(/(\d+)\s*分钟/)
      if (minuteMatch) return 0
      const hourMatch = activeStatus.match(/(\d+)\s*小时/)
      if (hourMatch) return 1
      const dayMatch = activeStatus.match(/(\d+)\s*[天日]/)
      if (dayMatch) return Number(dayMatch[1])
      return 99
    }

    function parseExpectedSalaryText(text: string): string {
      const rangeMatch = text.match(/(\d+\s*-\s*\d+\s*[kK])/)
      if (rangeMatch?.[1]) {
        return rangeMatch[1].replace(/\s+/g, '')
      }
      const singleMatch = text.match(/(\d+\s*[kK])/)
      if (singleMatch?.[1]) {
        return singleMatch[1].replace(/\s+/g, '')
      }
      return ''
    }

    function collectCandidateElements(): { elements: Element[]; stats: Record<string, number> } {
      const baseInfoElements = Array.from(document.querySelectorAll('.join-text-wrap.base-info'))
      const cardsFromBaseInfo = baseInfoElements
        .map((baseInfo) => {
          let current: Element | null = baseInfo
          let fallback: Element | null = null

          for (let depth = 0; depth < 8 && current; depth += 1) {
            const text = textOf(current)
            const hasGreetButton = text.includes('打招呼')
            const hasSalary = /\d+\s*-\s*\d+\s*[kK]/.test(text)
            const hasBaseInfo = !!current.querySelector('.join-text-wrap.base-info')
            const box = current.getBoundingClientRect()
            const looksLikeCard = box.width > 500 && box.height > 120

            if (hasBaseInfo && looksLikeCard) {
              fallback = current
            }

            if (hasGreetButton && hasBaseInfo && hasSalary && looksLikeCard) {
              return current
            }

            current = current.parentElement
          }

          return fallback
        })
        .filter((el): el is Element => !!el)

      if (cardsFromBaseInfo.length > 0) {
        return {
          elements: Array.from(new Set(cardsFromBaseInfo)),
          stats: {
            baseInfoCount: baseInfoElements.length,
            directSelectorCount: 0,
            greetTriggerCount: 0,
            matchedCardCount: cardsFromBaseInfo.length
          }
        }
      }

      const directSelectors = [
        '[class*="card-list"] > *',
        '[class*="card-wrap"]',
        '[class*="card-item"]',
        '[class*="candidate-card"]',
        '[class*="geek-card"]',
        '[class*="recommend-card"]',
        '.card-inner'
      ]

      for (const selector of directSelectors) {
        const found = Array.from(document.querySelectorAll(selector)).filter((el) => {
          const text = textOf(el)
          return text.includes('打招呼') && (text.includes('岁') || !!el.querySelector('.base-info'))
        })
        if (found.length > 0) {
          return {
            elements: found,
            stats: {
              baseInfoCount: baseInfoElements.length,
              directSelectorCount: found.length,
              greetTriggerCount: 0,
              matchedCardCount: found.length
            }
          }
        }
      }

      const greetTriggers = Array.from(document.querySelectorAll('button, a, span, div')).filter((el) => {
        return textOf(el) === '打招呼'
      })

      const cards = greetTriggers
        .map((trigger) => {
          let current: Element | null = trigger
          for (let depth = 0; depth < 8 && current; depth += 1) {
            const text = textOf(current)
            const box = current.getBoundingClientRect()
            if (
              text.includes('岁') &&
              /\d+\s*-\s*\d+\s*[kK]/.test(text) &&
              box.width > 500 &&
              box.height > 120
            ) {
              return current
            }
            current = current.parentElement
          }
          return null
        })
        .filter((el): el is Element => !!el)

      return {
        elements: Array.from(new Set(cards)),
        stats: {
          baseInfoCount: baseInfoElements.length,
          directSelectorCount: 0,
          greetTriggerCount: greetTriggers.length,
          matchedCardCount: cards.length
        }
      }
    }

    function extractEncryptUserId(el: Element, fallbackKey: string): string {
      const attrNames = [
        'data-geek',
        'data-id',
        'data-user-id',
        'data-geek-id',
        'data-geekid',
        'data-encrypt-geek-id',
        'data-encrypt-user-id'
      ]

      for (const attr of attrNames) {
        const attrValue = el.getAttribute(attr)
        if (attrValue) {
          return attrValue
        }
      }

      const attrNodes = Array.from(el.querySelectorAll('[href], [data-geek], [data-id], [data-user-id], [data-geek-id], [data-encrypt-geek-id]'))
      for (const node of attrNodes) {
        const href = node.getAttribute('href') || ''
        const joined = `${href} ${node.getAttribute('data-geek') || ''} ${node.getAttribute('data-id') || ''} ${node.getAttribute('data-user-id') || ''} ${node.getAttribute('data-geek-id') || ''} ${node.getAttribute('data-encrypt-geek-id') || ''}`
        const explicitMatch = joined.match(/encryptGeekId=([^&\s]+)/i)
        if (explicitMatch?.[1]) return explicitMatch[1]
        const pathMatch = joined.match(/geek(?:\/|Id=)([A-Za-z0-9_-]+)/i)
        if (pathMatch?.[1]) return pathMatch[1]
      }

      return fallbackKey
    }

    const { elements: cardElements, stats } = collectCandidateElements()
    if (cardElements.length === 0) {
      return {
        cards: [],
        stats
      }
    }

    return {
      cards: cardElements.map((el, index) => {
      const textContent = textOf(el)
      const baseInfoTexts = Array.from(el.querySelectorAll('.join-text-wrap.base-info span'))
        .map((span) => textOf(span))
        .filter(Boolean)

      const fallbackKey = `recommend_f${runtimeFrameIndex}_${index}_${hashText(textContent.slice(0, 200))}`
      el.setAttribute(CARD_KEY_ATTR, fallbackKey)

      const vue = (el as any).__vue__
      const props = vue?._props || vue?.$props || {}
      const data = props.geek || props.item || props.candidate || props.data || {}

      const name =
        data.name ||
        data.geekName ||
        textOf(el.querySelector('.name')) ||
        textOf(el.querySelector('[class*="name"]')) ||
        textOf(el.querySelector('h3')) ||
        textOf(el.querySelector('h4'))

      const activeStatus =
        data.activeDesc ||
        data.activeStatus ||
        parseActiveStatus(textContent)

      const salaryText =
        textOf(el.querySelector('.salary-wrap span')) ||
        textOf(el.querySelector('[class*="salary-wrap"] span')) ||
        textOf(el.querySelector('[class*="salary"] span')) ||
        textOf(el.querySelector('[class*="salary"]')) ||
        parseExpectedSalaryText(textContent)

      const normalizedSalaryText =
        parseExpectedSalaryText(salaryText) ||
        parseExpectedSalaryText(textContent)

      const fallbackSalaryText =
        data.expectSalaryText ||
        (data.expectSalary ? `${data.expectSalary}K` : '')

      const cityCandidate =
        textOf(el.querySelector('[class*="city"]')) ||
        textOf(el.querySelector('[class*="location"]'))

      const currentCompany =
        data.company ||
        data.currentCompany ||
        textOf(el.querySelector('[class*="company"]'))

      const currentPosition =
        data.position ||
        data.currentPosition ||
        textOf(el.querySelector('[class*="position"]')) ||
        textOf(el.querySelector('[class*="job"]'))

      const cardKey = el.getAttribute(CARD_KEY_ATTR) || fallbackKey

      return {
        cardKey,
        frameIndex: runtimeFrameIndex,
        name,
        encryptUserId: data.encryptGeekId || data.encryptUserId || data.geekId || extractEncryptUserId(el, cardKey),
        avatar: data.avatar || '',
        age: parseAge(baseInfoTexts),
        degree: data.degree || parseDegree(baseInfoTexts),
        workYears: Number(data.workYear || data.workYears) || parseWorkYears(baseInfoTexts),
        city: data.city || cityCandidate || '',
        expectedSalary: String(normalizedSalaryText || fallbackSalaryText || '').trim(),
        currentCompany,
        currentPosition,
        activeDaysAgo: Number(data.activeDaysAgo) || parseActiveDaysAgo(activeStatus),
        activeStatus,
        isJobSeeking: data.isJobSeeking === true || data.jobStatus === '在看机会' || textContent.includes('在职-考虑机会'),
      }
    }).filter((card) => Boolean(card.encryptUserId && card.name)),
      stats
    }
  }, frameIndex)
}

export async function getCandidateCardElement(
  page: Page,
  cardKey: string,
  frameIndex?: number
): Promise<ElementHandle<Element> | null> {
  if (!cardKey) return null
  if (typeof frameIndex === 'number') {
    const targetFrame = page.frames()[frameIndex]
    if (targetFrame) {
      const inFrame = await targetFrame.$(`[data-geekgeekrun-card-key="${cardKey}"]`)
      if (inFrame) {
        return inFrame
      }
    }
  }

  for (const frame of page.frames()) {
    const inFrame = await frame.$(`[data-geekgeekrun-card-key="${cardKey}"]`)
    if (inFrame) {
      return inFrame
    }
  }

  return await page.$(`[data-geekgeekrun-card-key="${cardKey}"]`)
}

export async function scrollPage(page: Page): Promise<boolean> {
  // 随机滚动距离
  const scrollDelta = 200 + Math.random() * 200

  await page.mouse.wheel(0, scrollDelta)

  // 随机延迟 1-3 秒
  const delay = 1000 + Math.random() * 2000
  await sleep(delay)

  // 检查是否有新内容加载
  const hasNewContent = await page.evaluate(() => {
    return document.body.scrollHeight > window.innerHeight + window.scrollY
  })

  return hasNewContent
}

export async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(1000)
}
