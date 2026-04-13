import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const requireFromThisFile = createRequire(import.meta.url)

function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    stdio: ['inherit', 'inherit', 'inherit'],
    ...options
  })
  if (result.error) {
    throw result.error
  }
  return result
}

function resolvePackageFile(specifier, relativeFile = '', requireResolver = requireFromThisFile) {
  try {
    const packageJsonPath = requireResolver.resolve(`${specifier}/package.json`)
    return relativeFile ? path.join(path.dirname(packageJsonPath), relativeFile) : packageJsonPath
  } catch {
    return null
  }
}

function signNativeModuleIfNeeded(filePath) {
  if (process.platform !== 'darwin' || !filePath || !fs.existsSync(filePath)) {
    return
  }
  console.log(`[build-sqlite-plugin] Signing native module: ${filePath}`)
  const signResult = runCommand('codesign', ['--force', '--sign', '-', filePath])
  if (signResult.status !== 0) {
    throw new Error(`codesign failed for ${filePath}`)
  }
}

function signNativeModulesForMac() {
  if (process.platform !== 'darwin') {
    return
  }

  const candidateFiles = [
    resolvePackageFile('better-sqlite3', 'build/Release/better_sqlite3.node'),
    resolvePackageFile('better-sqlite3', 'build/Release/test_extension.node'),
    resolvePackageFile('iconv-corefoundation', 'lib/native.node'),
    resolvePackageFile('lzma-native', 'prebuilds/darwin-arm64/electron.napi.node'),
    resolvePackageFile('lzma-native', 'prebuilds/darwin-arm64/node.napi.node')
  ]

  const existingFiles = candidateFiles.filter(Boolean)
  for (const filePath of existingFiles) {
    try {
      signNativeModuleIfNeeded(filePath)
    } catch (error) {
      console.warn('[build-sqlite-plugin] Failed to sign native module:', filePath)
      console.warn(error)
    }
  }
}

function verifyBetterSqliteLoadsInElectron(uiPackageDirPath) {
  console.log('[build-sqlite-plugin] Verifying better-sqlite3 with Electron runtime...')
  const verifyProcess = runCommand(
    'pnpm',
    [
      'exec',
      'sh',
      '-c',
      'ELECTRON_RUN_AS_NODE=1 electron -e "try { const Database = require(\'better-sqlite3\'); const db = new Database(\':memory:\'); db.prepare(\'select 1\').get(); db.close(); console.log(\'better-sqlite3 verification ok\') } catch (error) { console.error(String(error && error.stack || error)); process.exit(1) }"'
    ],
    {
      cwd: uiPackageDirPath,
      shell: true
    }
  )
  if (verifyProcess.status !== 0) {
    throw new Error('better-sqlite3 failed to load in Electron runtime after rebuild')
  }
}

function rebuildBetterSqliteWithNodeGyp(rawCwd, electronVersion) {
  const betterSqliteDirPath = path.join(rawCwd, 'node_modules/better-sqlite3')
  const nodeGypCliPath = path.join(rawCwd, 'node_modules/node-gyp/bin/node-gyp.js')

  console.warn('[build-sqlite-plugin] Falling back to node-gyp rebuild for better-sqlite3...')
  const rebuildProcess = runCommand(
    process.execPath,
    [nodeGypCliPath, 'rebuild', '--release'],
    {
      cwd: betterSqliteDirPath,
      env: {
        ...process.env,
        npm_config_runtime: 'electron',
        npm_config_target: electronVersion,
        npm_config_disturl: 'https://electronjs.org/headers',
        npm_config_devdir: '/tmp/node-gyp-electron-headers'
      }
    }
  )

  if (rebuildProcess.status !== 0) {
    throw new Error(`node-gyp rebuild failed with exit code ${rebuildProcess.status}`)
  }
}

export default function buildSqlitePlugin() {
  const rawCwd = process.cwd()
  const sqlitePluginDirPath = path.join(__dirname, '../../../sqlite-plugin')
  const uiPackageDirPath = path.join(__dirname, '../../')
  const uiPackageJsonPath = path.join(__dirname, '../../package.json')
  const uiPackageJson = JSON.parse(fs.readFileSync(uiPackageJsonPath, 'utf8'))
  const electronVersion = String(uiPackageJson.devDependencies?.electron || '39.2.7').replace(
    /^[\^~]/,
    ''
  )
  const requireFromUiPackage = createRequire(uiPackageJsonPath)
  process.chdir(sqlitePluginDirPath)
  try {
    console.log('[build-sqlite-plugin] Building TypeScript...')
    const sqlitePluginBuildProcess = runCommand('pnpm', ['run', 'build'], {
      shell: true
    })
    if (sqlitePluginBuildProcess.status !== 0) {
      throw new Error(`Build failed with exit code ${sqlitePluginBuildProcess.status}`)
    }
  } catch (error) {
    process.chdir(rawCwd)
    console.error('[build-sqlite-plugin] Error building TypeScript:')
    console.error(error)
    process.exit(1)
  }

  process.chdir(rawCwd)
  try {
    console.log('[build-sqlite-plugin] Rebuilding native modules for Electron...')
    const localElectronRebuildCli = resolvePackageFile(
      'electron-rebuild',
      'lib/src/cli.js',
      requireFromUiPackage
    )
    if (localElectronRebuildCli) {
      console.log(`[build-sqlite-plugin] Using local electron-rebuild: ${localElectronRebuildCli}`)
    }
    const rebuildProcess = runCommand(
      'pnpm',
      ['exec', 'electron-rebuild', '-f', '-w', 'better-sqlite3', '--version', electronVersion],
      {
        cwd: uiPackageDirPath,
        shell: true
      }
    )

    if (rebuildProcess.status !== 0) {
      console.warn('[build-sqlite-plugin] electron-rebuild may have failed, but continuing...')
    }
  } catch (error) {
    console.warn('[build-sqlite-plugin] Error during electron-rebuild:', error)
    console.warn('[build-sqlite-plugin] Continuing with build...')
  }

  try {
    signNativeModulesForMac()
  } catch (error) {
    console.warn('[build-sqlite-plugin] Error while signing native modules:', error)
  }

  try {
    verifyBetterSqliteLoadsInElectron(uiPackageDirPath)
  } catch (error) {
    console.warn('[build-sqlite-plugin] Electron runtime verification failed after electron-rebuild:')
    console.warn(error)
    try {
      rebuildBetterSqliteWithNodeGyp(rawCwd, electronVersion)
      signNativeModulesForMac()
      verifyBetterSqliteLoadsInElectron(uiPackageDirPath)
    } catch (fallbackError) {
      console.error('[build-sqlite-plugin] Fallback rebuild failed:')
      console.error(fallbackError)
      process.exit(1)
    }
  }

  console.log('[build-sqlite-plugin] Build completed successfully')
}
