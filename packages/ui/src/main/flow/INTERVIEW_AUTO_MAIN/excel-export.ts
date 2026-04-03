/**
 * 候选人Excel导出模块
 */

import { app } from 'electron'
import ExcelJS from 'exceljs'
import type { DataSource } from 'typeorm'
import { getInterviewCandidateList } from '@geekgeekrun/sqlite-plugin/handlers'

// 状态映射
const STATUS_LABELS: Record<string, string> = {
  new: '新候选人',
  waiting_round_1: '等待第1轮',
  waiting_round_2: '等待第2轮',
  waiting_round_n: '等待回复中',
  passed: '已通过',
  rejected: '已拒绝',
  resume_requested: '已邀请简历',
  resume_received: '已收到简历',
  emailed: '已发送邮件',
  error: '处理出错'
}

function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = new Date(date)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatValue(value: any): string {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

export async function exportCandidatesToExcel(
  ds: DataSource,
  params: { status?: string; jobPositionId?: number }
): Promise<string> {
  // 获取所有候选人数据（不分页）
  const result = await getInterviewCandidateList(ds, {
    ...params,
    page: 1,
    pageSize: 10000 // 获取所有数据
  })

  const candidates = result.list

  // 创建工作簿
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('候选人列表')

  // 设置表头
  worksheet.columns = [
    { header: '姓名', key: 'geekName', width: 12 },
    { header: '应聘岗位', key: 'jobName', width: 20 },
    { header: '状态', key: 'status', width: 12 },
    { header: '学历', key: 'education', width: 10 },
    { header: '院校', key: 'school', width: 20 },
    { header: '专业', key: 'major', width: 15 },
    { header: '当前轮次', key: 'currentRound', width: 10 },
    { header: '总得分', key: 'totalScore', width: 10 },
    { header: '关键词得分', key: 'keywordScore', width: 12 },
    { header: 'AI得分', key: 'llmScore', width: 10 },
    { header: '评分理由', key: 'llmReason', width: 40 },
    { header: '创建时间', key: 'createdAt', width: 18 },
    { header: '更新时间', key: 'updatedAt', width: 18 }
  ]

  // 设置表头样式
  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  }

  // 添加数据行
  for (const candidate of candidates) {
    worksheet.addRow({
      geekName: formatValue(candidate.geekName),
      jobName: formatValue(candidate.jobName),
      status: getStatusLabel(candidate.status),
      education: formatValue(candidate.education),
      school: formatValue(candidate.school),
      major: formatValue(candidate.major),
      currentRound: candidate.currentRound > 0 ? `第${candidate.currentRound}轮` : '-',
      totalScore: formatValue(candidate.totalScore),
      keywordScore: formatValue(candidate.keywordScore),
      llmScore: formatValue(candidate.llmScore),
      llmReason: formatValue(candidate.llmReason),
      createdAt: formatDate(candidate.createdAt),
      updatedAt: formatDate(candidate.updatedAt)
    })
  }

  // 生成文件名
  const now = new Date()
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/\//g, '-')

  const fileName = `候选人列表_${dateStr}.xlsx`

  // 获取桌面路径
  const desktopPath = app.getPath('desktop')
  const filePath = `${desktopPath}/${fileName}`

  // 写入文件
  await workbook.xlsx.writeFile(filePath)

  return filePath
}