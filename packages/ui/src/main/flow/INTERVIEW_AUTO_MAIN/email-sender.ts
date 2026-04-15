/**
 * 面试自动化 - 邮件配置模块
 *
 * 负责SMTP连接测试和邮件配置管理
 */

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

/**
 * 测试 SMTP 连接
 */
export async function testSmtpConnection(config: SmtpConfig): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const nodemailer = await import('nodemailer')

    const transporter = nodemailer.createTransport({
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
