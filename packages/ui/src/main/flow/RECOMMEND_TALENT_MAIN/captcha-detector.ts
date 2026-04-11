import type { Page } from 'puppeteer'

const CAPTCHA_SELECTORS = [
  '.captcha-container',
  '#captcha',
  '.verify-wrap',
  'iframe[src*="captcha"]',
  '.geetest_holder'
]

const CAPTCHA_URL_PATTERNS = ['captcha', 'verify', 'security-check']

export async function detectCaptcha(page: Page): Promise<boolean> {
  for (const selector of CAPTCHA_SELECTORS) {
    const element = await page.$(selector)
    if (element) {
      console.log('[RecommendTalent Captcha] 检测到验证码元素:', selector)
      return true
    }
  }

  const url = page.url()
  for (const pattern of CAPTCHA_URL_PATTERNS) {
    if (url.includes(pattern)) {
      console.log('[RecommendTalent Captcha] 检测到验证码URL:', url)
      return true
    }
  }

  return false
}
