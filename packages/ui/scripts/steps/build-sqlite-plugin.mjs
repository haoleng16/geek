import childProcess from 'node:child_process'
import path from 'node:path'
import url from 'node:url'

export default function buildSqlitePlugin() {
  const rawCwd = process.cwd()
  const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

  const sqlitePluginDirPath = path.join(__dirname, '../../../sqlite-plugin')

  // Step 1: Build TypeScript
  process.chdir(sqlitePluginDirPath)
  try {
    console.log('[build-sqlite-plugin] Building TypeScript...')
    const sqlitePluginBuildProcess = childProcess.spawnSync('pnpm run build', {
      stdio: ['inherit', 'inherit', 'inherit'],
      shell: true
    })
    if (sqlitePluginBuildProcess.error) {
      throw sqlitePluginBuildProcess.error
    }
    if (sqlitePluginBuildProcess.status !== 0) {
      throw new Error(`Build failed with exit code ${sqlitePluginBuildProcess.status}`)
    }
  } catch (error) {
    process.chdir(rawCwd)
    console.error('[build-sqlite-plugin] Error building TypeScript:')
    console.error(error)
    process.exit(1)
  }

  // Step 2: Rebuild native modules for Electron ABI
  // This is critical for Windows - better-sqlite3 must be compiled for Electron's ABI, not Node's
  process.chdir(rawCwd)
  try {
    console.log('[build-sqlite-plugin] Rebuilding native modules for Electron...')
    const electronVersion = process.env.npm_package_devDependencies_electron || '39.2.7'
    const rebuildProcess = childProcess.spawnSync(
      `npx electron-rebuild -f -w better-sqlite3 --electron-version ${electronVersion.replace(/^[\^~]/, '')}`,
      {
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: true,
        cwd: sqlitePluginDirPath
      }
    )
    if (rebuildProcess.status !== 0) {
      console.warn('[build-sqlite-plugin] electron-rebuild may have failed, but continuing...')
    }
  } catch (error) {
    console.warn('[build-sqlite-plugin] Error during electron-rebuild:', error)
    console.warn('[build-sqlite-plugin] Continuing with build...')
  }

  console.log('[build-sqlite-plugin] Build completed successfully')
}
