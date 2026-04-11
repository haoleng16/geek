import type { ElementHandle, Page } from 'puppeteer'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'

const COLLECT_BUTTON_SELECTORS = [
  '.collect-btn',
  '.follow-btn',
  '[class*="collect"]',
  '[class*="follow"]',
  'button',
  'span',
  'button[ka*="collect"]',
  'button[ka*="follow"]'
]

export async function collectCandidate(
  page: Page,
  cardElement: ElementHandle
): Promise<boolean> {
  // 随机延迟 5-10 秒
  const delay = 5000 + Math.random() * 5000
  await sleep(delay)

  for (const selector of COLLECT_BUTTON_SELECTORS) {
    const btn = await cardElement.$(selector)
    if (btn) {
      const text = await btn.evaluate((el) => el.textContent?.trim() || '')
      if (
        text &&
        !text.includes('收藏') &&
        !text.includes('感兴趣') &&
        !text.includes('人才库') &&
        !selector.includes('collect') &&
        !selector.includes('follow')
      ) {
        continue
      }
      const box = await btn.boundingBox()
      if (box) {
        await btn.click()
        console.log('[RecommendTalent Collector] 点击收藏按钮:', selector)
        return true
      }
    }
  }

  // 尝试在卡片父级查找
  for (const selector of COLLECT_BUTTON_SELECTORS) {
    const btn = await page.$(selector)
    if (btn) {
      const text = await btn.evaluate((el) => el.textContent?.trim() || '')
      if (
        text &&
        !text.includes('收藏') &&
        !text.includes('感兴趣') &&
        !text.includes('人才库') &&
        !selector.includes('collect') &&
        !selector.includes('follow')
      ) {
        continue
      }
      const box = await btn.boundingBox()
      if (box) {
        await btn.click()
        console.log('[RecommendTalent Collector] 在页面级别点击收藏按钮:', selector)
        return true
      }
    }
  }

  console.log('[RecommendTalent Collector] 未找到收藏按钮')
  return false
}
