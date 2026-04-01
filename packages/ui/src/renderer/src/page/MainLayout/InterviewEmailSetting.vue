<template>
  <div class="interview-email-setting__wrap">
    <el-card shadow="never">
      <template #header>
        <span>邮件设置</span>
      </template>

      <el-form ref="formRef" :model="emailForm" label-width="120px">
        <el-form-item label="SMTP服务器">
          <el-input v-model="emailForm.host" placeholder="例如：smtp.qq.com" />
        </el-form-item>

        <el-form-item label="端口">
          <el-input-number v-model="emailForm.port" :min="1" :max="65535" />
        </el-form-item>

        <el-form-item label="使用SSL">
          <el-switch v-model="emailForm.secure" />
          <span class="form-tip">465端口通常需要开启SSL</span>
        </el-form-item>

        <el-form-item label="用户名">
          <el-input v-model="emailForm.user" placeholder="邮箱地址" />
        </el-form-item>

        <el-form-item label="授权码">
          <el-input
            v-model="emailForm.password"
            type="password"
            placeholder="SMTP授权码（非邮箱密码）"
            show-password
          />
          <span class="form-tip">请使用邮箱的SMTP授权码，而非登录密码</span>
        </el-form-item>

        <el-form-item label="收件邮箱">
          <el-input v-model="emailForm.recipient" placeholder="接收简历的邮箱地址" />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleTestConnection" :loading="testing">
            {{ testing ? '测试中...' : '测试连接' }}
          </el-button>
          <el-button type="warning" @click="handleSendTestEmail" :loading="sendingEmail">
            {{ sendingEmail ? '发送中...' : '发送测试邮件' }}
          </el-button>
          <el-button type="success" @click="handleSaveConfig">保存配置</el-button>
        </el-form-item>
      </el-form>

      <!-- 测试结果 -->
      <el-alert
        v-if="testResult"
        :type="testResult.success ? 'success' : 'error'"
        :title="testResult.success ? '连接成功' : '连接失败'"
        :description="testResult.message"
        show-icon
        style="margin-top: 16px"
      />

      <!-- 发送测试邮件结果 -->
      <el-alert
        v-if="sendEmailResult"
        :type="sendEmailResult.success ? 'success' : 'error'"
        :title="sendEmailResult.success ? '发送成功' : '发送失败'"
        :description="sendEmailResult.message"
        show-icon
        style="margin-top: 16px"
      />
    </el-card>

    <!-- 使用说明 -->
    <el-card shadow="never" style="margin-top: 16px">
      <template #header>
        <span>使用说明</span>
      </template>

      <el-collapse>
        <el-collapse-item title="QQ邮箱设置" name="qq">
          <ol>
            <li>登录QQ邮箱 → 设置 → 账户</li>
            <li>开启 POP3/SMTP 服务</li>
            <li>获取授权码</li>
            <li>SMTP服务器：smtp.qq.com</li>
            <li>端口：465（SSL）或 587</li>
          </ol>
        </el-collapse-item>

        <el-collapse-item title="163邮箱设置" name="163">
          <ol>
            <li>登录163邮箱 → 设置 → POP3/SMTP/IMAP</li>
            <li>开启 SMTP 服务</li>
            <li>获取授权码</li>
            <li>SMTP服务器：smtp.163.com</li>
            <li>端口：465（SSL）或 25</li>
          </ol>
        </el-collapse-item>

        <el-collapse-item title="企业邮箱设置" name="enterprise">
          <p>请咨询您的IT管理员获取SMTP服务器地址和授权信息。</p>
          <p>常见配置：</p>
          <ul>
            <li>阿里企业邮箱：smtp.qiye.aliyun.com</li>
            <li>腾讯企业邮箱：smtp.exmail.qq.com</li>
          </ul>
        </el-collapse-item>
      </el-collapse>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElForm, ElMessage } from 'element-plus'

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const testing = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)
const sendingEmail = ref(false)
const sendEmailResult = ref<{ success: boolean; message: string } | null>(null)

const emailForm = reactive({
  host: '',
  port: 465,
  secure: true,
  user: '',
  password: '',
  recipient: ''
})

onMounted(async () => {
  await loadConfig()
})

async function loadConfig() {
  try {
    const result = await electron.ipcRenderer.invoke('interview-get-config', 'smtp_config')
    if (result.success && result.data) {
      const config = JSON.parse(result.data)
      Object.assign(emailForm, config)
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

async function handleTestConnection() {
  if (!emailForm.host || !emailForm.user || !emailForm.password) {
    ElMessage.warning('请填写完整的SMTP配置')
    return
  }

  testing.value = true
  testResult.value = null

  try {
    // 使用 JSON 序列化来移除 reactive 代理，避免 IPC 克隆错误
    const config = JSON.parse(JSON.stringify(emailForm))
    const result = await electron.ipcRenderer.invoke('interview-test-smtp', config)
    testResult.value = {
      success: result.data?.success,
      message: result.data?.success ? 'SMTP连接测试成功！' : (result.data?.error || result.error || '连接失败')
    }

    if (result.data?.success) {
      ElMessage.success('SMTP连接测试成功')
    } else {
      ElMessage.error('SMTP连接测试失败')
    }
  } catch (error: any) {
    testResult.value = {
      success: false,
      message: error?.message || '测试失败'
    }
    ElMessage.error('测试失败')
  } finally {
    testing.value = false
  }
}

async function handleSendTestEmail() {
  if (!emailForm.host || !emailForm.user || !emailForm.password || !emailForm.recipient) {
    ElMessage.warning('请填写完整的SMTP配置和收件邮箱')
    return
  }

  sendingEmail.value = true
  sendEmailResult.value = null

  try {
    // 使用 JSON 序列化来移除 reactive 代理，避免 IPC 克隆错误
    const config = JSON.parse(JSON.stringify(emailForm))
    const result = await electron.ipcRenderer.invoke('interview-send-test-email', config)
    sendEmailResult.value = {
      success: result.data?.success,
      message: result.data?.success
        ? `测试邮件已发送至 ${emailForm.recipient}，请查收`
        : (result.data?.error || result.error || '发送失败')
    }

    if (result.data?.success) {
      ElMessage.success('测试邮件发送成功')
    } else {
      ElMessage.error('测试邮件发送失败')
    }
  } catch (error: any) {
    sendEmailResult.value = {
      success: false,
      message: error?.message || '发送失败'
    }
    ElMessage.error('发送失败')
  } finally {
    sendingEmail.value = false
  }
}

async function handleSaveConfig() {
  try {
    // 使用 JSON 序列化来移除 reactive 代理，避免 IPC 克隆错误
    const config = JSON.parse(JSON.stringify(emailForm))
    const result = await electron.ipcRenderer.invoke('interview-save-email-config', config)
    if (result.success) {
      ElMessage.success('配置保存成功')
    } else {
      ElMessage.error(result.error || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败')
  }
}
</script>

<style lang="scss">
.interview-email-setting__wrap {
  padding: 16px;

  .form-tip {
    font-size: 12px;
    color: #909399;
    margin-left: 8px;
  }

  ol, ul {
    margin: 0;
    padding-left: 20px;
  }

  li {
    margin-bottom: 4px;
  }
}
</style>