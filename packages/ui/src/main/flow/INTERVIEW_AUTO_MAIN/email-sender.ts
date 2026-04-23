/**
 * 面试自动化 - 邮件配置模块
 *
 * 负责 SMTP 连接测试和候选人汇总邮件发送
 */

interface EmailCandidateQaRecord {
  roundNumber: number
  questionText?: string | null
  answerText?: string | null
  totalScore?: number | null
}

export interface EmailCandidateSummary {
  id: number
  geekName?: string | null
  education?: string | null
  jobName?: string | null
  status: string
  currentRound: number
  totalScore?: number | null
  updatedAt?: string | Date | null
  qaRecords: EmailCandidateQaRecord[]
}

/**
 * SMTP配置接口
 */
export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  recipient: string
}

const STATUS_LABELS: Record<string, string> = {
  new: '待发送首轮',
  waiting_round_1: '等待第1轮',
  waiting_round_2: '等待第2轮',
  waiting_round_n: '等待回复中',
  reply_extraction_failed: '回复提取失败',
  passed: '已通过',
  rejected: '已拒绝',
  resume_requested: '已发送简历邀请',
  resume_received: '已收到简历',
  emailed: '已发送邮件',
  error: '处理出错'
}

async function createTransporter(config: SmtpConfig) {
  const nodemailer = await import('nodemailer')

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password
    },
    connectionTimeout: 10000,
    socketTimeout: 10000
  })
}

/**
 * 测试 SMTP 连接
 */
export async function testSmtpConnection(config: SmtpConfig): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const transporter = await createTransporter(config)
    await transporter.verify()
    console.log('[EmailSender] SMTP 连接测试成功')

    return { success: true }
  } catch (error: unknown) {
    console.error('[EmailSender] SMTP 连接测试失败:', error)
    return {
      success: false,
      error: getErrorMessage(error, '连接失败')
    }
  }
}

export async function sendCandidateSummaryEmail(params: {
  config: SmtpConfig
  candidates: EmailCandidateSummary[]
  subject?: string
}): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const { config, candidates, subject } = params
    const transporter = await createTransporter(config)

    await transporter.sendMail({
      from: config.user,
      to: config.recipient,
      subject:
        subject ||
        `【候选人看板】候选人汇总 ${formatDateForSubject(new Date())} (${candidates.length}人)`,
      text: buildCandidateSummaryText(candidates),
      html: buildCandidateSummaryHtml(candidates)
    })

    console.log('[EmailSender] 候选人汇总邮件发送成功, count=', candidates.length)
    return { success: true }
  } catch (error: unknown) {
    console.error('[EmailSender] 候选人汇总邮件发送失败:', error)
    return {
      success: false,
      error: getErrorMessage(error, '发送失败')
    }
  }
}

function buildCandidateSummaryText(candidates: EmailCandidateSummary[]) {
  return candidates
    .map((candidate, index) => {
      const header = [
        `【候选人 ${index + 1}】`,
        `姓名：${candidate.geekName || '--'}`,
        `学历：${candidate.education || '--'}`,
        `应聘岗位：${candidate.jobName || '--'}`,
        `状态：${getStatusLabel(candidate.status)}`,
        `当前轮次：${candidate.currentRound > 0 ? `第${candidate.currentRound}轮` : '-'}`,
        `得分：${formatScore(candidate.totalScore)}`,
        `更新时间：${formatDateTime(candidate.updatedAt)}`
      ]

      const rounds =
        candidate.qaRecords.length > 0
          ? candidate.qaRecords.map((qa) =>
              [
                `第${qa.roundNumber}轮：`,
                `问题：${qa.questionText || '(无)'}`,
                `回答：${qa.answerText || '（未回答）'}`,
                `得分：${formatScore(qa.totalScore)}`
              ].join('\n')
            )
          : ['问答详情：暂无问答记录']

      return [...header, '', ...rounds].join('\n')
    })
    .join('\n\n--------------------------------\n\n')
}

function buildCandidateSummaryHtml(candidates: EmailCandidateSummary[]) {
  const cards = candidates
    .map((candidate, index) => {
      const qaHtml =
        candidate.qaRecords.length > 0
          ? candidate.qaRecords
              .map(
                (qa) => `
        <div style="margin-top: 12px; padding: 12px; background: #f8fafc; border-radius: 8px;">
          <div style="font-weight: 600; color: #1f2937; margin-bottom: 8px;">第${qa.roundNumber}轮</div>
          <div style="margin-bottom: 6px;"><strong>问题：</strong>${escapeHtml(qa.questionText || '(无)')}</div>
          <div style="margin-bottom: 6px;"><strong>回答：</strong>${escapeHtml(qa.answerText || '（未回答）')}</div>
          <div><strong>得分：</strong>${escapeHtml(formatScore(qa.totalScore))}</div>
        </div>
      `
              )
              .join('')
          : '<div style="margin-top: 12px; color: #6b7280;">暂无问答记录</div>'

      return `
      <div style="margin-bottom: 16px; padding: 16px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
        <div style="font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 12px;">候选人 ${index + 1}</div>
        <div style="line-height: 1.8; color: #374151;">
          <div><strong>姓名：</strong>${escapeHtml(candidate.geekName || '--')}</div>
          <div><strong>学历：</strong>${escapeHtml(candidate.education || '--')}</div>
          <div><strong>应聘岗位：</strong>${escapeHtml(candidate.jobName || '--')}</div>
          <div><strong>状态：</strong>${escapeHtml(getStatusLabel(candidate.status))}</div>
          <div><strong>当前轮次：</strong>${escapeHtml(candidate.currentRound > 0 ? `第${candidate.currentRound}轮` : '-')}</div>
          <div><strong>得分：</strong>${escapeHtml(formatScore(candidate.totalScore))}</div>
          <div><strong>更新时间：</strong>${escapeHtml(formatDateTime(candidate.updatedAt))}</div>
        </div>
        ${qaHtml}
      </div>
    `
    })
    .join('')

  return `
    <div style="padding: 24px; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <h2 style="margin: 0 0 16px; color: #111827;">候选人汇总</h2>
      <div style="margin-bottom: 16px; color: #4b5563;">共 ${candidates.length} 位候选人</div>
      ${cards}
      <div style="margin-top: 16px; font-size: 12px; color: #6b7280;">
        发送时间：${escapeHtml(formatDateTime(new Date()))}
      </div>
    </div>
  `
}

function getStatusLabel(status: string) {
  return STATUS_LABELS[status] || status
}

function formatScore(score?: number | null) {
  return typeof score === 'number' ? `${score}分` : '-'
}

function formatDateTime(date?: string | Date | null) {
  if (!date) return '-'
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDateForSubject(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('\n', '<br/>')
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
