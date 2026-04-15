/**
 * 面试自动化 - IPC 处理模块
 *
 * 处理渲染进程和主进程之间的 IPC 通信
 */

import type { DataSource } from 'typeorm'
import { ipcMain } from 'electron'
import {
  saveInterviewJobPosition,
  getInterviewJobPositionList,
  getInterviewJobPositionWithDetails,
  deleteInterviewJobPosition,
  saveInterviewQuestionRound,
  deleteInterviewQuestionRound,
  getInterviewCandidateList,
  getInterviewCandidate,
  saveInterviewCandidate,
  updateInterviewCandidateStatus,
  getInterviewQaRecordList,
  saveInterviewQaRecord,
  getInterviewResume,
  saveInterviewResume,
  getInterviewSystemConfig,
  saveInterviewSystemConfig,
  getAllInterviewSystemConfig,
  getInterviewOperationLogList,
  saveInterviewOperationLog,
  countInterviewCandidatesByStatus
} from '@geekgeekrun/sqlite-plugin/handlers'
import { testSmtpConnection } from './email-sender'
import { testLlmConnection } from '../SMART_REPLY_MAIN/llm-reply'
import { exportCandidatesToExcel } from './excel-export'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { formatQaRecordsForDisplay } from './answer-collector'

let dataSource: DataSource
let dataSourceInitPromise: Promise<DataSource> | null = null

/**
 * 获取 DataSource（懒加载）
 */
async function getDataSource(): Promise<DataSource> {
  if (dataSource) return dataSource
  if (!dataSourceInitPromise) {
    const dbPath = getPublicDbFilePath()
    dataSourceInitPromise = initDb(dbPath)
  }
  try {
    dataSource = await dataSourceInitPromise
  } catch (e) {
    dataSourceInitPromise = null
    throw e
  }
  return dataSource
}

/**
 * 初始化 IPC 处理器（传统方式，需要先初始化数据库）
 */
export function initInterviewIpcHandlers(ds: DataSource) {
  dataSource = ds

  // ==================== 岗位配置 ====================

  // 获取岗位配置列表
  ipcMain.handle('interview-get-job-list', async () => {
    try {
      const list = await getInterviewJobPositionList(dataSource)
      return { success: true, data: list }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 获取岗位配置详情
  ipcMain.handle('interview-get-job-detail', async (_, id: number) => {
    try {
      const data = await getInterviewJobPositionWithDetails(dataSource, id)
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 保存岗位配置
  ipcMain.handle('interview-save-job', async (_, data: any) => {
    try {
      console.log('[Interview IPC] 保存岗位配置, data:', JSON.stringify(data).substring(0, 500))
      const result = await saveInterviewJobPosition(dataSource, data)
      console.log('[Interview IPC] 岗位保存结果, id:', result.id)

      // 先删除该岗位的所有旧问题轮次，再保存新的
      // 这样可以确保删除操作生效
      const existingRounds = await dataSource.query(
        `SELECT id FROM interview_question_round WHERE jobPositionId = ?`,
        [result.id]
      )
      console.log('[Interview IPC] 找到现有轮次数量:', existingRounds.length)

      for (const round of existingRounds) {
        console.log('[Interview IPC] 删除旧轮次, id:', round.id)
        await deleteInterviewQuestionRound(dataSource, round.id)
      }

      // 保存问题轮次
      if (data.questionRounds) {
        console.log('[Interview IPC] 保存新轮次数量:', data.questionRounds.length)
        for (const round of data.questionRounds) {
          await saveInterviewQuestionRound(dataSource, {
            ...round,
            jobPositionId: result.id
          })
        }
      }

      console.log('[Interview IPC] 保存完成')
      return { success: true, data: result }
    } catch (error: any) {
      console.error('[Interview IPC] 保存失败:', error)
      return { success: false, error: error?.message }
    }
  })

  // 删除岗位配置
  ipcMain.handle('interview-delete-job', async (_, id: number) => {
    try {
      await deleteInterviewJobPosition(dataSource, id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== 问题轮次 ====================

  // 保存问题轮次
  ipcMain.handle('interview-save-question-round', async (_, data: any) => {
    try {
      const result = await saveInterviewQuestionRound(dataSource, data)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 删除问题轮次
  ipcMain.handle('interview-delete-question-round', async (_, id: number) => {
    try {
      await deleteInterviewQuestionRound(dataSource, id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== 候选人 ====================

  // 获取候选人列表
  ipcMain.handle('interview-get-candidates', async (_, params: any) => {
    try {
      const result = await getInterviewCandidateList(dataSource, params)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 获取候选人详情
  ipcMain.handle('interview-get-candidate-detail', async (_, id: number) => {
    try {
      const candidate = await getInterviewCandidate(dataSource, id)
      const rawQaRecords = await getInterviewQaRecordList(dataSource, id)
      const resume = await getInterviewResume(dataSource, id)

      // 【新增】格式化问答记录用于展示：最多3条，过滤无关内容
      const qaRecords = formatQaRecordsForDisplay(rawQaRecords, 3)

      return {
        success: true,
        data: {
          candidate,
          qaRecords,
          resume
        }
      }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 更新候选人状态
  ipcMain.handle(
    'interview-update-candidate-status',
    async (_, id: number, status: string, extraData?: any) => {
      try {
        const result = await updateInterviewCandidateStatus(dataSource, id, status, extraData)
        return { success: true, data: result }
      } catch (error: any) {
        return { success: false, error: error?.message }
      }
    }
  )

  // 获取候选人统计数据
  ipcMain.handle('interview-get-candidate-stats', async () => {
    try {
      const stats = await countInterviewCandidatesByStatus(dataSource)
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 导出候选人Excel
  ipcMain.handle(
    'interview-export-candidates-excel',
    async (_, params: { status?: string; jobPositionId?: number }) => {
      try {
        const filePath = await exportCandidatesToExcel(dataSource, params)
        return { success: true, data: filePath }
      } catch (error: any) {
        console.error('[Interview IPC] 导出Excel失败:', error)
        return { success: false, error: error?.message }
      }
    }
  )

  // ==================== 系统配置 ====================

  // 获取系统配置
  ipcMain.handle('interview-get-config', async (_, key: string) => {
    try {
      const value = await getInterviewSystemConfig(dataSource, key)
      return { success: true, data: value }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 获取所有系统配置
  ipcMain.handle('interview-get-all-config', async () => {
    try {
      const config = await getAllInterviewSystemConfig(dataSource)
      return { success: true, data: config }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 保存系统配置
  ipcMain.handle('interview-save-config', async (_, key: string, value: string) => {
    try {
      await saveInterviewSystemConfig(dataSource, key, value)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== 邮件设置 ====================

  // 测试 SMTP 连接
  ipcMain.handle('interview-test-smtp', async (_, config: any) => {
    try {
      const result = await testSmtpConnection(config)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // 保存邮件配置
  ipcMain.handle('interview-save-email-config', async (_, config: any) => {
    try {
      await saveInterviewSystemConfig(dataSource, 'smtp_config', JSON.stringify(config), true)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== 操作日志 ====================

  // 获取操作日志
  ipcMain.handle('interview-get-logs', async (_, params: any) => {
    try {
      const result = await getInterviewOperationLogList(dataSource, params)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== LLM 测试 ====================

  // 测试 LLM 连接
  ipcMain.handle('interview-test-llm', async () => {
    try {
      const result = await testLlmConnection()
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  console.log('[Interview IPC] IPC handlers initialized')
}

/**
 * 移除 IPC 处理器
 */
export function removeInterviewIpcHandlers() {
  const channels = [
    'interview-get-job-list',
    'interview-get-job-detail',
    'interview-save-job',
    'interview-delete-job',
    'interview-save-question-round',
    'interview-delete-question-round',
    'interview-get-candidates',
    'interview-get-candidate-detail',
    'interview-update-candidate-status',
    'interview-get-candidate-stats',
    'interview-export-candidates-excel',
    'interview-get-config',
    'interview-get-all-config',
    'interview-save-config',
    'interview-test-smtp',
    'interview-save-email-config',
    'interview-get-logs',
    'interview-test-llm'
  ]

  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }
}

/**
 * 懒加载初始化 IPC 处理器（无需预先初始化数据库）
 * 用于 UI 设置窗口，handlers 立即注册，数据库在首次调用时初始化
 */
export function initInterviewIpcHandlersLazy() {
  // ==================== 岗位配置 ====================

  ipcMain.handle('interview-get-job-list', async () => {
    try {
      const ds = await getDataSource()
      const list = await getInterviewJobPositionList(ds)
      return { success: true, data: list }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-get-job-detail', async (_, id: number) => {
    try {
      const ds = await getDataSource()
      const data = await getInterviewJobPositionWithDetails(ds, id)
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-save-job', async (_, data: any) => {
    try {
      const ds = await getDataSource()
      const result = await saveInterviewJobPosition(ds, data)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-delete-job', async (_, id: number) => {
    try {
      const ds = await getDataSource()
      await deleteInterviewJobPosition(ds, id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== 问题轮次 ====================

  ipcMain.handle('interview-save-question-round', async (_, data: any) => {
    try {
      const ds = await getDataSource()
      const result = await saveInterviewQuestionRound(ds, data)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-delete-question-round', async (_, id: number) => {
    try {
      const ds = await getDataSource()
      await deleteInterviewQuestionRound(ds, id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== 候选人 ====================

  ipcMain.handle('interview-get-candidates', async (_, params: any) => {
    try {
      const ds = await getDataSource()
      const result = await getInterviewCandidateList(ds, params)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-get-candidate-detail', async (_, id: number) => {
    try {
      const ds = await getDataSource()
      const candidate = await getInterviewCandidate(ds, id)
      const rawQaRecords = await getInterviewQaRecordList(ds, id)
      // 【新增】格式化问答记录用于展示：最多3条，过滤无关内容
      const qaRecords = formatQaRecordsForDisplay(rawQaRecords, 3)
      return { success: true, data: { candidate, qaRecords } }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-update-candidate-status', async (_, id: number, status: string) => {
    try {
      const ds = await getDataSource()
      await updateInterviewCandidateStatus(ds, id, status)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-get-candidate-stats', async () => {
    try {
      const ds = await getDataSource()
      const stats = await countInterviewCandidatesByStatus(ds)
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== 导出 Excel ====================

  ipcMain.handle(
    'interview-export-candidates-excel',
    async (_, params: { status?: string; jobPositionId?: number }) => {
      try {
        const ds = await getDataSource()
        const filePath = await exportCandidatesToExcel(ds, params)
        return { success: true, data: { filePath } }
      } catch (error: any) {
        return { success: false, error: error?.message }
      }
    }
  )

  // ==================== 系统配置 ====================

  ipcMain.handle('interview-get-config', async (_, key: string) => {
    try {
      const ds = await getDataSource()
      const config = await getInterviewSystemConfig(ds, key)
      return { success: true, data: config }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-get-all-config', async () => {
    try {
      const ds = await getDataSource()
      const configs = await getAllInterviewSystemConfig(ds)
      return { success: true, data: configs }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-save-config', async (_, key: string, value: any) => {
    try {
      const ds = await getDataSource()
      await saveInterviewSystemConfig(ds, key, value)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== SMTP 测试 ====================

  ipcMain.handle('interview-test-smtp', async (_, config: any) => {
    try {
      const result = await testSmtpConnection(config)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  ipcMain.handle('interview-save-email-config', async (_, config: any) => {
    try {
      const ds = await getDataSource()
      await saveInterviewSystemConfig(ds, 'emailConfig', config)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== 操作日志 ====================

  ipcMain.handle('interview-get-logs', async (_, params: any) => {
    try {
      const ds = await getDataSource()
      const result = await getInterviewOperationLogList(ds, params)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  // ==================== LLM 测试 ====================

  ipcMain.handle('interview-test-llm', async (_, config: any) => {
    try {
      const result = await testLlmConnection(config)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message }
    }
  })

  console.log('[Interview IPC] 懒加载 IPC handlers 已注册')
}
