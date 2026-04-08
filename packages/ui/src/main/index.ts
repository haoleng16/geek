import overrideConsole from './utils/overrideConsole'
import minimist from 'minimist'
import { launchDaemon } from './flow/OPEN_SETTING_WINDOW/launch-daemon'

const isUiDev = process.env.NODE_ENV === 'development'
const enableLogToFile = process.env.GEEKGEEKRUN_ENABLE_LOG_TO_FILE === String(1)
if (isUiDev || enableLogToFile) {
  overrideConsole()
}
console.log('NODE_ENV:', process.env.NODE_ENV)

// 捕获未处理的异常，记录日志而不崩溃（防止闪退）
process.on('uncaughtException', (err) => {
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') {
    return
  }
  console.error('[uncaughtException]', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

console.log('argv:', process.argv)
const commandlineArgs = minimist(isUiDev ? process.argv.slice(2) : process.argv.slice(1))
console.log('parsed commandline args:', commandlineArgs)

const runMode = commandlineArgs['mode']

;(async () => {
  switch (runMode) {
    // #region internal use
    case 'downloadDependenciesForInit': {
      const { downloadDependenciesForInit } = await import('./flow/DOWNLOAD_DEPENDENCIES/index')
      downloadDependenciesForInit()
      break
    }
    case 'launchBossZhipinLoginPageWithPreloadExtension': {
      const { launchBossZhipinLoginPageWithPreloadExtension } = await import(
        './flow/LAUNCH_BOSS_ZHIPIN_LOGIN_PAGE_WITH_PRELOAD_EXTENSION'
      )
      launchBossZhipinLoginPageWithPreloadExtension()
      break
    }
    case 'launchBossSite': {
      const { launchBossSite } = await import('./flow/LAUNCH_BOSS_SITE')
      launchBossSite()
      break
    }
    case 'recruiterAutoReplyMain': {
      const { runEntry } = await import('./flow/RECRUITER_AUTO_REPLY_MAIN/index')
      runEntry()
      break
    }
    case 'smartReplyMain': {
      const { runEntry } = await import('./flow/SMART_REPLY_MAIN/index')
      runEntry()
      break
    }
    case 'interviewAutoMain': {
      const { runEntry } = await import('./flow/INTERVIEW_AUTO_MAIN/index')
      runEntry()
      break
    }
    case 'launchDaemon': {
      await import('./flow/LAUNCH_DAEMON')
      break
    }
    // #endregion

    default: {
      globalThis.GEEKGEEKRUN_PROCESS_ROLE = 'ui'
      await launchDaemon()
      const { openSettingWindow } = await import('./flow/OPEN_SETTING_WINDOW/index')
      openSettingWindow()
      break
    }
    // #region
  }
})()
