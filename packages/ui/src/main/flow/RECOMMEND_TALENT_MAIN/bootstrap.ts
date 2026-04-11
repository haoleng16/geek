import { Browser } from 'puppeteer'
import { initPuppeteer } from '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
import { pageMapByName } from './index'

import {
  readConfigFile,
  readStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'

const localStoragePageUrl = `https://www.zhipin.com/desktop/`
const legacyRecommendTalentUrl = `https://www.zhipin.com/web/recruit/recommend/geek`
const defaultRecommendTalentUrl = `https://www.zhipin.com/web/chat/recommend`

function getRecommendTalentPageUrl() {
  const configuredUrl = String(readConfigFile('boss.json')?.recommendTalent?.pageUrl ?? '')
    .trim()
  if (configuredUrl) {
    if (configuredUrl === legacyRecommendTalentUrl) {
      return defaultRecommendTalentUrl
    }
    return configuredUrl
  }
  return defaultRecommendTalentUrl
}

export async function bootstrap() {
  console.log('[RecommendTalent Bootstrap] 正在初始化 Puppeteer...')
  const { puppeteer } = await initPuppeteer()
  console.log('[RecommendTalent Bootstrap] Puppeteer 初始化完成')

  console.log('[RecommendTalent Bootstrap] 正在启动浏览器...')
  console.log('[RecommendTalent Bootstrap] PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH)

  const browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    defaultViewport: {
      width: 1440,
      height: 800
    },
    devtools: process.env.NODE_ENV === 'development'
  })

  console.log('[RecommendTalent Bootstrap] 浏览器已启动')
  return browser
}

export async function launchBoss(browser: Browser, skipCookies = false) {
  console.log('[RecommendTalent LaunchBoss] 正在准备页面...')
  const page = (await browser.pages())[0]

  if (!skipCookies) {
    const bossCookies = readStorageFile('boss-cookies.json')
    const bossLocalStorage = readStorageFile('boss-local-storage.json')
    // set cookies only if we have valid cookies
    if (bossCookies && bossCookies.length > 0) {
      console.log('[RecommendTalent LaunchBoss] 设置 cookies, 数量:', bossCookies.length)
      for (let i = 0; i < bossCookies.length; i++) {
        await page.setCookie(bossCookies[i])
      }
    } else {
      console.log('[RecommendTalent LaunchBoss] 没有有效的 cookies')
    }
    if (bossLocalStorage && Object.keys(bossLocalStorage).length > 0) {
      console.log('[RecommendTalent LaunchBoss] 设置 localStorage')
      await setDomainLocalStorage(browser, localStoragePageUrl, bossLocalStorage)
    }
  }

  const url = getRecommendTalentPageUrl()
  console.log('[RecommendTalent LaunchBoss] 正在导航到:', url)

  try {
    await page.goto(url, { timeout: 120 * 1000, waitUntil: 'domcontentloaded' })
    console.log('[RecommendTalent LaunchBoss] 页面加载完成')
  } catch (error: any) {
    console.error('[RecommendTalent LaunchBoss] 导航失败:', error)
    if (error?.message?.startsWith('net::ERR_INTERNET_DISCONNECTED')) {
      throw new Error('ERR_INTERNET_DISCONNECTED')
    }
    throw error
  }
  pageMapByName['boss'] = page
  page.once('close', () => {
    pageMapByName['boss'] = null
    const cp = browser.process()
    cp?.kill()
  })
  return page
}
