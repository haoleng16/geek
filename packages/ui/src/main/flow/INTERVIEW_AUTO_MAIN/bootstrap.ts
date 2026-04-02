/**
 * 面试自动化 - Puppeteer 初始化模块
 *
 * 复用 SMART_REPLY_MAIN 的初始化模式
 */

import { Browser } from 'puppeteer'
import { initPuppeteer } from '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
import { pageMapByName } from './index'
import {
  readStorageFile,
  readConfigFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'

const localStoragePageUrl = `https://www.zhipin.com/desktop/`
const defaultChatUiUrl = `https://www.zhipin.com/web/chat/index`

function getChatUiUrl() {
  const configuredUrl = String(readConfigFile('boss.json')?.interview?.chatUiUrl ?? '')
    .trim()
  if (configuredUrl) {
    return configuredUrl
  }
  return defaultChatUiUrl
}

export async function bootstrap() {
  console.log('[Interview Bootstrap] 正在初始化 Puppeteer...')
  const { puppeteer } = await initPuppeteer()
  console.log('[Interview Bootstrap] Puppeteer 初始化完成')

  console.log('[Interview Bootstrap] 正在启动浏览器...')
  console.log('[Interview Bootstrap] PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH)

  // 确保 executablePath 被正确传入
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (!executablePath) {
    console.error('[Interview Bootstrap] 未设置 PUPPETEER_EXECUTABLE_PATH')
    throw new Error('PUPPETEER_EXECUTABLE_PATH_NOT_SET')
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath,
    ignoreHTTPSErrors: true,
    defaultViewport: {
      width: 1440,
      height: 800
    },
    devtools: process.env.NODE_ENV === 'development'
  })

  console.log('[Interview Bootstrap] 浏览器已启动')
  return browser
}

export async function launchBoss(browser: Browser, skipCookies = false) {
  console.log('[Interview LaunchBoss] 正在准备页面...')
  const page = (await browser.pages())[0]

  if (!skipCookies) {
    const bossCookies = readStorageFile('boss-cookies.json')
    const bossLocalStorage = readStorageFile('boss-local-storage.json')
    if (bossCookies && bossCookies.length > 0) {
      console.log('[Interview LaunchBoss] 设置 cookies, 数量:', bossCookies.length)
      for (let i = 0; i < bossCookies.length; i++) {
        await page.setCookie(bossCookies[i])
      }
    } else {
      console.log('[Interview LaunchBoss] 没有有效的 cookies')
    }
    if (bossLocalStorage && Object.keys(bossLocalStorage).length > 0) {
      console.log('[Interview LaunchBoss] 设置 localStorage')
      await setDomainLocalStorage(browser, localStoragePageUrl, bossLocalStorage)
    }
  }

  const url = getChatUiUrl()
  console.log('[Interview LaunchBoss] 正在导航到:', url)

  try {
    await page.goto(url, { timeout: 120 * 1000, waitUntil: 'domcontentloaded' })
    console.log('[Interview LaunchBoss] 页面加载完成')
  } catch (error: any) {
    console.error('[Interview LaunchBoss] 导航失败:', error)
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

export async function storeStorage(page) {
  const [cookies, localStorage] = await Promise.all([
    page.cookies(),
    page
      .evaluate(() => {
        return JSON.stringify(window.localStorage)
      })
      .then((res) => JSON.parse(res))
  ])
  const { writeStorageFile } = await import('@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs')
  return Promise.all([
    writeStorageFile('boss-cookies.json', cookies),
    writeStorageFile('boss-local-storage.json', localStorage)
  ])
}