<template>
  <div class="smart-reply__wrap">
    <div class="form-wrap">
      <el-form ref="formRef" :model="formContent" label-width="160px">
        <el-collapse v-model="activeCollapse">
          <!-- 基础设置 -->
          <el-collapse-item title="基础设置" name="basic">
            <el-form-item label="自动发送">
              <el-switch v-model="formContent.autoSend" />
            </el-form-item>
            <el-form-item label="发送前确认">
              <el-switch
                v-model="formContent.confirmBeforeSend"
                :disabled="formContent.autoSend"
              />
            </el-form-item>
            <el-form-item label="扫描间隔(秒)">
              <el-input-number
                v-model="formContent.scanIntervalSeconds"
                :min="1"
                :max="60"
              />
            </el-form-item>
            <el-form-item label="最大回复次数">
              <el-input-number
                v-model="formContent.maxReplyCount"
                :min="1"
                :max="10"
              />
              <div class="form-tip">每个候选人每个会话最多回复的次数</div>
            </el-form-item>
          </el-collapse-item>

          <!-- 公司信息 -->
          <el-collapse-item title="公司信息" name="company">
            <el-form-item label="公司简介">
              <el-input
                v-model="formContent.companyIntro"
                type="textarea"
                :rows="4"
                placeholder="请输入公司简介，用于LLM生成更精准的回复"
              />
            </el-form-item>
          </el-collapse-item>

          <!-- 岗位说明 -->
          <el-collapse-item title="岗位说明" name="job">
            <el-form-item label="岗位职责">
              <el-input
                v-model="formContent.jobDescription"
                type="textarea"
                :rows="4"
                placeholder="请输入岗位职责和要求，用于LLM生成更精准的回复"
              />
            </el-form-item>
          </el-collapse-item>

          <!-- 大模型提示词 -->
          <el-collapse-item title="大模型提示词" name="prompt">
            <el-form-item label="系统提示词模板">
              <el-input
                v-model="formContent.systemPrompt"
                type="textarea"
                :rows="8"
                placeholder="自定义系统提示词，留空使用默认模板"
              />
            </el-form-item>
            <el-button @click="resetPromptToDefault">重置为默认模板</el-button>
          </el-collapse-item>
        </el-collapse>

        <!-- 风险提示 -->
        <el-alert type="warning" :closable="false" class="risk-alert">
          <template #title>
            <span class="alert-title">使用提示</span>
          </template>
          <ul class="alert-list">
            <li>大模型回复可能不准确，建议开启「发送前确认」</li>
            <li>频繁自动回复可能触发平台风控</li>
            <li>请妥善保管API密钥</li>
          </ul>
        </el-alert>

        <!-- API 测试 -->
        <div class="api-test-section">
          <el-divider content-position="left">API 连接测试</el-divider>
          <div class="api-test-content">
            <el-button
              type="success"
              plain
              :loading="isTestingApi"
              @click="handleTestApiConnection"
            >
              {{ isTestingApi ? '测试中...' : '测试 API Key 连接' }}
            </el-button>
            <span v-if="apiTestResult" class="api-test-result" :class="apiTestResult.success ? 'success' : 'error'">
              {{ apiTestResult.message }}
            </span>
          </div>
          <p class="api-test-tip">点击按钮测试 LLM API 配置是否正确，确保可以正常调用大模型</p>
        </div>

        <!-- 操作按钮 -->
        <el-form-item class="last-form-item" flex>
          <el-button type="primary" @click="handleSubmit">保存并开始</el-button>
          <el-button @click="handleSaveOnly">仅保存配置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div
      class="running-overlay__wrap"
      :style="{
        pointerEvents: 'none'
      }"
    >
      <RunningOverlay
        ref="runningOverlayRef"
        worker-id="smartReplyMain"
        :run-record-id="runRecordId"
      >
        <template #op-buttons="{ currentRunningStatus }">
          <div>
            <template v-if="currentRunningStatus === RUNNING_STATUS_ENUM.RUNNING">
              <el-button
                type="danger"
                plain
                :loading="isStopButtonLoading"
                @click="handleStopButtonClick"
                >结束任务</el-button
              >
            </template>
            <template v-else>
              <el-button
                type="primary"
                @click="
                  () => {
                    runningOverlayRef?.hide?.()
                  }
                "
                >关闭</el-button
              >
            </template>
          </div>
        </template>
      </RunningOverlay>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElForm, ElMessage } from 'element-plus'
import RunningOverlay from '@renderer/features/RunningOverlay/index.vue'
import { RUNNING_STATUS_ENUM } from '../../../../common/enums/auto-start-chat'

// 默认系统提示词模板
const DEFAULT_SYSTEM_PROMPT = `你是一个专业的招聘助手，代表公司回答候选人的问题。

## 公司信息
{COMPANY_INTRO}

## 岗位说明
{JOB_DESCRIPTION}

## 回复规则
1. 回答要简洁专业，不超过200字
2. 请用中文回复
3. 如果不确定答案，请返回JSON格式：{"reply": "", "isClear": false}
4. 如果确定答案，请返回JSON格式：{"reply": "你的回复内容", "isClear": true}`

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const runRecordId = ref<number | null>(null)
const runningOverlayRef = ref<any>(null)
const isStopButtonLoading = ref(false)
const isTestingApi = ref(false)
const apiTestResult = ref<{ success: boolean; message: string } | null>(null)
const activeCollapse = ref(['basic', 'company', 'job'])

// 默认表单内容
const getDefaultFormContent = () => ({
  autoSend: false,
  confirmBeforeSend: true,
  scanIntervalSeconds: 5,
  maxReplyCount: 3,
  companyIntro: '',
  jobDescription: '',
  systemPrompt: ''
})

const formContent = ref(getDefaultFormContent())

// 加载配置
onMounted(() => {
  electron.ipcRenderer.invoke('fetch-config-file-content').then((res) => {
    const bossConfig = res.config['boss.json'] || {}

    if (bossConfig.smartReply) {
      formContent.value = {
        ...formContent.value,
        ...bossConfig.smartReply
      }
    }
  })
})

// 重置提示词为默认模板
const resetPromptToDefault = () => {
  formContent.value.systemPrompt = DEFAULT_SYSTEM_PROMPT
  ElMessage.success('已重置为默认模板')
}

// 保存配置
const saveConfig = async () => {
  await electron.ipcRenderer.invoke('save-config-file-from-ui', JSON.stringify({
    smartReply: formContent.value
  }))
}

// 仅保存配置
const handleSaveOnly = async () => {
  try {
    await saveConfig()
    ElMessage.success('配置已保存')
  } catch (err) {
    ElMessage.error('保存失败')
  }
}

// 保存并开始
const handleSubmit = async () => {
  // 验证配置
  if (!formContent.value.companyIntro && !formContent.value.jobDescription) {
    ElMessage.warning('请至少填写公司简介或岗位说明')
    return
  }

  try {
    await saveConfig()
    runningOverlayRef.value?.show()
    const { runRecordId: rrId } = await electron.ipcRenderer.invoke('run-smart-reply')
    runRecordId.value = rrId
  } catch (err) {
    console.error(err)
    ElMessage.error({
      message: '启动失败，请查看日志'
    })
  }
}

const handleStopButtonClick = async () => {
  isStopButtonLoading.value = true
  try {
    await electron.ipcRenderer.invoke('stop-smart-reply')
    runningOverlayRef.value?.hide()
  } finally {
    isStopButtonLoading.value = false
  }
}

// 测试 API 连接
const handleTestApiConnection = async () => {
  isTestingApi.value = true
  apiTestResult.value = null

  try {
    const result = await electron.ipcRenderer.invoke('test-smart-reply-api')
    apiTestResult.value = {
      success: result.success,
      message: result.success
        ? `连接成功！模型: ${result.model || '未知'}`
        : `连接失败: ${result.error || '未知错误'}`
    }

    if (result.success) {
      ElMessage.success('API 连接测试成功')
    } else {
      ElMessage.error(`API 连接测试失败: ${result.error}`)
    }
  } catch (err: any) {
    apiTestResult.value = {
      success: false,
      message: `测试失败: ${err.message || '未知错误'}`
    }
    ElMessage.error(`测试失败: ${err.message || '未知错误'}`)
  } finally {
    isTestingApi.value = false
  }
}
</script>

<style lang="scss">
.smart-reply__wrap {
  position: relative;

  .form-wrap {
    max-height: 100vh;
    overflow: auto;
    padding-left: 20px;
    padding-right: 20px;

    .el-form {
      margin: 0 auto;
      max-width: 1000px;
      padding-top: 8px;
    }

    .last-form-item {
      .el-form-item__content {
        margin-top: 0px;
        justify-content: flex-end;
      }
    }

    .form-tip {
      font-size: 12px;
      color: #909399;
      margin-top: 4px;
    }
  }

  .running-overlay__wrap {
    position: absolute;
    inset: 0;
  }

  .risk-alert {
    margin-top: 16px;

    .alert-title {
      font-weight: 500;
    }

    .alert-list {
      margin: 8px 0 0 0;
      padding-left: 20px;
      font-size: 13px;

      li {
        margin-bottom: 4px;
      }
    }
  }

  .api-test-section {
    margin-top: 20px;
    padding: 16px;
    background: #f5f7fa;
    border-radius: 4px;

    .api-test-content {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .api-test-result {
      font-size: 14px;

      &.success {
        color: #67c23a;
      }

      &.error {
        color: #f56c6c;
      }
    }

    .api-test-tip {
      margin: 12px 0 0 0;
      font-size: 12px;
      color: #909399;
    }
  }
}
</style>