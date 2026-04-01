/**
 * 面试自动化 - 邮件发送模块
 *
 * 负责通过 SMTP 发送简历邮件
 */

import type { DataSource } from 'typeorm'
import * as fs from 'fs'
import * as path from 'path'
import {
  getInterviewResume,
  getInterviewQaRecordList,
  updateInterviewCandidateStatus,
  saveInterviewOperationLog,
  getInterviewSystemConfig,
  saveInterviewResume
} from '@geekgeekrun/sqlite-plugin/handlers'
import { InterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'

// 动态导入 nodemailer（避免在非 Node 环境报错）
let nodemailer: any = null

async function getNodemailer() {
  if (!nodemailer) {
    nodemailer = await import('nodemailer')
  }
  return nodemailer
}

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  recipient: string
}

/**
 * 获取 SMTP 配置
 */
export async function getSmtpConfig(ds: DataSource): Promise<SmtpConfig | null> {
  try {
    const config = await getInterviewSystemConfig(ds, 'smtp_config')
    if (config) {
      return JSON.parse(config)
    }
    return null
  } catch (error) {
    console.error('[EmailSender] 获取 SMTP 配置失败:', error)
    return null
  }
}

/**
 * 测试 SMTP 连接
 */
export async function testSmtpConnection(config: SmtpConfig): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const mailer = await getNodemailer()

    const transporter = mailer.createTransport({
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

    await transporter.verify()
    console.log('[EmailSender] SMTP 连接测试成功')

    return { success: true }
  } catch (error: any) {
    console.error('[EmailSender] SMTP 连接测试失败:', error)
    return {
      success: false,
      error: error?.message || '连接失败'
    }
  }
}

/**
 * 生成邮件内容
 */
function generateEmailContent(
  candidate: InterviewCandidate,
  qaRecords: any[]
): { subject: string; text: string; html: string } {
  const subject = `【候选人简历】${candidate.geekName} - ${candidate.jobName}`

  // 生成问答记录文本
  let qaText = ''
  for (const qa of qaRecords) {
    qaText += `
第${qa.roundNumber}轮：
问题：${qa.questionText}
回答：${qa.answerText || '（未回答）'}
评分：${qa.totalScore || qa.keywordScore || 0}分
`
  }

  const text = `您好，

收到一份候选人简历，详情如下：

【基本信息】
姓名：${candidate.geekName}
应聘岗位：${candidate.jobName}
处理时间：${new Date().toLocaleDateString()}

【评分结果】
总评分：${candidate.totalScore || 0}/100
- 关键词得分：${candidate.keywordScore || 0}/100
- AI评分：${candidate.llmScore || 0}/100
- 评分理由：${candidate.llmReason || '无'}

【问答记录】
${qaText}

附件：候选人简历

此邮件由智能招聘系统自动发送。`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .section { margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; }
    .section h3 { margin-top: 0; color: #1890ff; }
    .score { font-size: 24px; font-weight: bold; color: #52c41a; }
    .qa-item { margin-bottom: 15px; padding: 10px; background: white; border-radius: 4px; }
    .qa-item p { margin: 5px 0; }
    .footer { margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="section">
      <h3>📋 基本信息</h3>
      <p><strong>姓名：</strong>${candidate.geekName}</p>
      <p><strong>应聘岗位：</strong>${candidate.jobName}</p>
      <p><strong>处理时间：</strong>${new Date().toLocaleDateString()}</p>
    </div>

    <div class="section">
      <h3>📊 评分结果</h3>
      <p class="score">总评分：${candidate.totalScore || 0}/100</p>
      <p>关键词得分：${candidate.keywordScore || 0}/100</p>
      <p>AI评分：${candidate.llmScore || 0}/100</p>
      <p>评分理由：${candidate.llmReason || '无'}</p>
    </div>

    <div class="section">
      <h3>💬 问答记录</h3>
      ${qaRecords.map(qa => `
        <div class="qa-item">
          <p><strong>第${qa.roundNumber}轮：</strong></p>
          <p><strong>问题：</strong>${qa.questionText}</p>
          <p><strong>回答：</strong>${qa.answerText || '（未回答）'}</p>
          <p><strong>评分：</strong>${qa.totalScore || qa.keywordScore || 0}分</p>
        </div>
      `).join('')}
    </div>

    <div class="footer">
      此邮件由智能招聘系统自动发送。
    </div>
  </div>
</body>
</html>
`

  return { subject, text, html }
}

/**
 * 发送简历邮件
 */
export async function sendResumeEmail(
  ds: DataSource,
  candidate: InterviewCandidate,
  resumePath: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    console.log(`[EmailSender] 开始发送邮件给: ${candidate.geekName}`)

    // 获取 SMTP 配置
    const smtpConfig = await getSmtpConfig(ds)
    if (!smtpConfig) {
      return { success: false, error: '未配置SMTP' }
    }

    // 检查简历文件是否存在
    if (!fs.existsSync(resumePath)) {
      return { success: false, error: '简历文件不存在' }
    }

    // 获取问答记录
    const qaRecords = await getInterviewQaRecordList(ds, candidate.id!)

    // 生成邮件内容
    const { subject, text, html } = generateEmailContent(candidate, qaRecords)

    // 创建邮件传输器
    const mailer = await getNodemailer()
    const transporter = mailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.password
      }
    })

    // 发送邮件
    const info = await transporter.sendMail({
      from: smtpConfig.user,
      to: smtpConfig.recipient,
      subject,
      text,
      html,
      attachments: [
        {
          filename: path.basename(resumePath),
          path: resumePath
        }
      ]
    })

    console.log(`[EmailSender] 邮件发送成功: ${info.messageId}`)

    // 更新简历记录
    await saveInterviewResume(ds, {
      candidateId: candidate.id,
      emailedAt: new Date(),
      emailRecipient: smtpConfig.recipient
    })

    // 更新候选人状态
    await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.EMAILED)

    // 记录操作日志
    await saveInterviewOperationLog(ds, {
      candidateId: candidate.id,
      action: 'email_sent',
      detail: JSON.stringify({
        recipient: smtpConfig.recipient,
        subject,
        messageId: info.messageId
      })
    })

    return { success: true }
  } catch (error: any) {
    console.error('[EmailSender] 发送邮件失败:', error)

    // 记录错误日志
    await saveInterviewOperationLog(ds, {
      candidateId: candidate.id,
      action: 'email_failed',
      errorMessage: error?.message || '未知错误'
    })

    return {
      success: false,
      error: error?.message || '发送失败'
    }
  }
}

/**
 * 批量发送邮件
 */
export async function batchSendEmails(
  ds: DataSource,
  candidates: InterviewCandidate[]
): Promise<{
  success: number
  failed: number
  errors: Array<{ candidateId: number; error: string }>
}> {
  const result = {
    success: 0,
    failed: 0,
    errors: [] as Array<{ candidateId: number; error: string }>
  }

  for (const candidate of candidates) {
    const resume = await getInterviewResume(ds, candidate.id!)

    if (!resume?.filePath) {
      result.failed++
      result.errors.push({ candidateId: candidate.id!, error: '未找到简历' })
      continue
    }

    const sendResult = await sendResumeEmail(ds, candidate, resume.filePath)

    if (sendResult.success) {
      result.success++
    } else {
      result.failed++
      result.errors.push({ candidateId: candidate.id!, error: sendResult.error || '发送失败' })
    }

    // 添加延迟，避免发送过快
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return result
}