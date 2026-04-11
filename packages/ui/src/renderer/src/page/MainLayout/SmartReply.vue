<template>
  <div class="smart-reply__wrap">
    <div class="form-wrap">
      <el-form ref="formRef" :model="formContent" label-width="160px">
        <el-collapse v-model="activeCollapse">
          <el-collapse-item title="基础设置" name="basic">
            <el-form-item label="自动发送">
              <el-switch v-model="formContent.autoSend" />
            </el-form-item>
            <el-form-item label="发送前确认">
              <el-switch v-model="formContent.confirmBeforeSend" :disabled="formContent.autoSend" />
            </el-form-item>
            <el-form-item label="扫描间隔(秒)">
              <el-input-number v-model="formContent.scanIntervalSeconds" :min="1" :max="60" />
            </el-form-item>
            <el-form-item label="最大回复次数">
              <el-input-number v-model="formContent.maxReplyCount" :min="1" :max="10" />
              <div class="form-tip">每个候选人每个会话最多回复的次数</div>
            </el-form-item>
          </el-collapse-item>

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

          <el-collapse-item title="岗位配置" name="jobs">
            <div class="job-actions">
              <el-button type="primary" size="small" @click="handleAddJob">新增岗位</el-button>
            </div>
            <el-table :data="formContent.jobConfigs" stripe style="width: 100%">
              <el-table-column prop="jobName" label="岗位名称" min-width="160" />
              <el-table-column label="岗位描述" min-width="260">
                <template #default="{ row }">
                  <span class="job-description-preview">
                    {{ row.jobDescription?.trim() || '未填写岗位描述' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="筛选条件摘要" min-width="220">
                <template #default="{ row }">
                  <span class="filter-summary">{{ buildFilterSummary(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="160" fixed="right">
                <template #default="{ row, $index }">
                  <el-button type="primary" link size="small" @click="handleEditJob(row, $index)"
                    >编辑</el-button
                  >
                  <el-button type="danger" link size="small" @click="handleDeleteJob($index)"
                    >删除</el-button
                  >
                </template>
              </el-table-column>
            </el-table>
            <div v-if="formContent.jobConfigs.length === 0" class="form-tip job-empty-tip">
              请先添加岗位。只有已添加的岗位，且满足对应学历和经验筛选的候选人，才会触发智能回复。
            </div>
          </el-collapse-item>

          <el-collapse-item title="大模型提示词" name="prompt">
            <el-form-item label="系统提示词模板">
              <el-input
                v-model="formContent.systemPrompt"
                type="textarea"
                :rows="8"
                placeholder="自定义系统提示词，留空使用默认模板"
              />
              <div class="form-tip">
                可使用占位符：{COMPANY_INTRO}、{JOB_NAME}、{JOB_DESCRIPTION}
              </div>
            </el-form-item>
            <div class="prompt-actions">
              <el-button type="primary" @click="handleSavePrompt">保存提示词</el-button>
              <el-button @click="resetPromptToDefault">重置为默认模板</el-button>
            </div>
          </el-collapse-item>
        </el-collapse>

        <el-alert type="warning" :closable="false" class="risk-alert">
          <template #title>
            <span class="alert-title">使用提示</span>
          </template>
          <ul class="alert-list">
            <li>仅对已配置岗位，且满足岗位学历/经验筛选的候选人进行智能回复</li>
            <li>大模型回复可能不准确，建议开启「发送前确认」</li>
            <li>频繁自动回复可能触发平台风控</li>
          </ul>
        </el-alert>

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
            <span
              v-if="apiTestResult"
              class="api-test-result"
              :class="apiTestResult.success ? 'success' : 'error'"
            >
              {{ apiTestResult.message }}
            </span>
          </div>
          <p class="api-test-tip">点击按钮测试 LLM API 配置是否正确，确保可以正常调用大模型</p>
        </div>

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
              >
                结束任务
              </el-button>
            </template>
            <template v-else>
              <el-button
                type="primary"
                @click="
                  () => {
                    runningOverlayRef?.hide?.()
                  }
                "
              >
                关闭
              </el-button>
            </template>
          </div>
        </template>
      </RunningOverlay>
    </div>

    <el-dialog
      v-model="jobDialogVisible"
      :title="isEditingJob ? '编辑岗位' : '新增岗位'"
      width="640px"
      :close-on-click-modal="false"
    >
      <el-form :model="jobForm" label-width="120px">
        <el-form-item label="岗位名称" required>
          <el-input
            v-model="jobForm.jobName"
            placeholder="请输入岗位名称，需与聊天中的岗位名称匹配"
          />
        </el-form-item>
        <el-form-item label="岗位描述">
          <el-input
            v-model="jobForm.jobDescription"
            type="textarea"
            :rows="5"
            placeholder="请输入岗位描述，后续会作为该岗位的大模型上下文"
          />
        </el-form-item>
        <el-form-item label="学历筛选">
          <el-checkbox-group v-model="jobForm.educationFilter">
            <el-checkbox v-for="option in EDUCATION_OPTIONS" :key="option" :label="option">
              {{ option }}
            </el-checkbox>
          </el-checkbox-group>
          <div class="form-tip">多选满足任一项即可，不选则不筛选学历</div>
        </el-form-item>
        <el-form-item label="经验筛选">
          <el-checkbox-group v-model="jobForm.experienceFilter">
            <el-checkbox v-for="option in EXPERIENCE_OPTIONS" :key="option" :label="option">
              {{ option }}
            </el-checkbox>
          </el-checkbox-group>
          <div class="form-tip">
            多选满足任一项即可，"3年以上"包含 3 年及以上经验，不选则不筛选经验
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="jobDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveJob">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElForm, ElMessage } from 'element-plus'
import RunningOverlay from '@renderer/features/RunningOverlay/index.vue'
import { RUNNING_STATUS_ENUM } from '../../../../common/enums/auto-start-chat'

type SmartReplyJobConfig = {
  localId: string
  jobName: string
  jobDescription: string
  educationFilter: string[]
  experienceFilter: string[]
}

const EDUCATION_OPTIONS = ['大专及以下', '本科', '硕士/研究生', '博士']
const EXPERIENCE_OPTIONS = ['1年及以下', '2年', '3年', '3年以上', '25届应届生', '26届应届生']

const DEFAULT_SYSTEM_PROMPT = `你是一个专业的招聘助手，代表公司回答候选人的问题。

## 公司信息
{COMPANY_INTRO}

## 当前岗位
{JOB_NAME}

## 岗位描述
{JOB_DESCRIPTION}

## 回复规则
1. 回答要简洁专业，不超过200字
2. 请用中文回复
3. 如果不确定答案，请返回JSON格式：{"reply": "", "isClear": false}
4. 如果确定答案，请返回JSON格式：{"reply": "你的回复内容", "isClear": true}`

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const runRecordId = ref<number | undefined>(undefined)
const runningOverlayRef = ref<any>(null)
const isStopButtonLoading = ref(false)
const isTestingApi = ref(false)
const apiTestResult = ref<{ success: boolean; message: string } | null>(null)
const activeCollapse = ref(['basic', 'company', 'jobs', 'prompt'])
const jobDialogVisible = ref(false)
const isEditingJob = ref(false)
const editingJobIndex = ref(-1)

const createJobConfig = (): SmartReplyJobConfig => ({
  localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  jobName: '',
  jobDescription: '',
  educationFilter: [],
  experienceFilter: []
})

const normalizeJobConfigs = (jobConfigs: unknown): SmartReplyJobConfig[] => {
  if (!Array.isArray(jobConfigs)) {
    return []
  }

  return jobConfigs.map((item) => {
    const current = item as Partial<SmartReplyJobConfig>
    return {
      localId: current.localId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      jobName: String(current.jobName || ''),
      jobDescription: String((current as { jobDescription?: string }).jobDescription || ''),
      educationFilter: Array.isArray(current.educationFilter)
        ? current.educationFilter.filter((option): option is string => typeof option === 'string')
        : [],
      experienceFilter: Array.isArray(current.experienceFilter)
        ? current.experienceFilter.filter((option): option is string => typeof option === 'string')
        : []
    }
  })
}

const getDefaultFormContent = () => ({
  autoSend: false,
  confirmBeforeSend: true,
  scanIntervalSeconds: 5,
  maxReplyCount: 3,
  companyIntro: '',
  systemPrompt: '',
  jobConfigs: [] as SmartReplyJobConfig[]
})

const getDefaultJobForm = () => ({
  localId: '',
  jobName: '',
  jobDescription: '',
  educationFilter: [] as string[],
  experienceFilter: [] as string[]
})

const formContent = ref(getDefaultFormContent())
const jobForm = ref(getDefaultJobForm())

const getValidJobConfigs = () =>
  formContent.value.jobConfigs
    .map((jobConfig) => ({
      localId: jobConfig.localId,
      jobName: jobConfig.jobName.trim(),
      jobDescription: jobConfig.jobDescription.trim(),
      educationFilter: jobConfig.educationFilter,
      experienceFilter: jobConfig.experienceFilter
    }))
    .filter((jobConfig) => jobConfig.jobName)

const saveConfig = async () => {
  await electron.ipcRenderer.invoke(
    'save-config-file-from-ui',
    JSON.stringify({
      smartReply: {
        autoSend: formContent.value.autoSend,
        confirmBeforeSend: formContent.value.confirmBeforeSend,
        scanIntervalSeconds: formContent.value.scanIntervalSeconds,
        maxReplyCount: formContent.value.maxReplyCount,
        companyIntro: formContent.value.companyIntro,
        systemPrompt: formContent.value.systemPrompt,
        jobConfigs: getValidJobConfigs()
      }
    })
  )
}

const buildFilterSummary = (jobConfig: SmartReplyJobConfig) => {
  const parts: string[] = []
  if (jobConfig.educationFilter.length > 0) {
    parts.push(`学历:${jobConfig.educationFilter.join('/')}`)
  }
  if (jobConfig.experienceFilter.length > 0) {
    parts.push(`经验:${jobConfig.experienceFilter.join('/')}`)
  }
  return parts.length > 0 ? parts.join(' | ') : '无额外筛选'
}

const handleAddJob = () => {
  isEditingJob.value = false
  editingJobIndex.value = -1
  jobForm.value = getDefaultJobForm()
  jobDialogVisible.value = true
}

const handleEditJob = (row: SmartReplyJobConfig, index: number) => {
  isEditingJob.value = true
  editingJobIndex.value = index
  jobForm.value = {
    localId: row.localId,
    jobName: row.jobName,
    jobDescription: row.jobDescription,
    educationFilter: [...row.educationFilter],
    experienceFilter: [...row.experienceFilter]
  }
  jobDialogVisible.value = true
}

const handleDeleteJob = (index: number) => {
  formContent.value.jobConfigs.splice(index, 1)
}

const handleSaveJob = () => {
  if (!jobForm.value.jobName.trim()) {
    ElMessage.warning('请填写岗位名称')
    return
  }

  const normalizedConfig: SmartReplyJobConfig = {
    localId: jobForm.value.localId || createJobConfig().localId,
    jobName: jobForm.value.jobName.trim(),
    jobDescription: jobForm.value.jobDescription.trim(),
    educationFilter: [...jobForm.value.educationFilter],
    experienceFilter: [...jobForm.value.experienceFilter]
  }

  if (isEditingJob.value && editingJobIndex.value >= 0) {
    formContent.value.jobConfigs[editingJobIndex.value] = normalizedConfig
  } else {
    formContent.value.jobConfigs.unshift(normalizedConfig)
  }

  jobDialogVisible.value = false
  ElMessage.success(isEditingJob.value ? '已更新岗位' : '已添加岗位')
}

const resetPromptToDefault = () => {
  formContent.value.systemPrompt = DEFAULT_SYSTEM_PROMPT
  ElMessage.success('已重置为默认模板')
}

const handleSavePrompt = async () => {
  try {
    await saveConfig()
    ElMessage.success('提示词已保存')
  } catch {
    ElMessage.error('保存失败')
  }
}

const handleSaveOnly = async () => {
  try {
    await saveConfig()
    ElMessage.success('配置已保存')
  } catch {
    ElMessage.error('保存失败')
  }
}

const handleSubmit = async () => {
  if (getValidJobConfigs().length === 0) {
    ElMessage.warning('请至少添加一个岗位配置并填写岗位名称')
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

onMounted(() => {
  electron.ipcRenderer.invoke('fetch-config-file-content').then((res) => {
    const bossConfig = res.config['boss.json'] || {}
    const smartReply = bossConfig.smartReply || {}

    formContent.value = {
      ...getDefaultFormContent(),
      ...smartReply,
      jobConfigs: normalizeJobConfigs(smartReply.jobConfigs)
    }
  })
})

const handleStopButtonClick = async () => {
  isStopButtonLoading.value = true
  try {
    await electron.ipcRenderer.invoke('stop-smart-reply')
    runningOverlayRef.value?.hide()
  } finally {
    isStopButtonLoading.value = false
  }
}

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
        margin-top: 0;
        justify-content: flex-end;
      }
    }

    .form-tip {
      font-size: 12px;
      color: #909399;
      margin-top: 4px;
    }

    .prompt-actions {
      display: flex;
      gap: 12px;
      margin-top: 8px;
    }

    .job-actions {
      margin-bottom: 12px;
    }

    .filter-summary {
      font-size: 12px;
      color: #606266;
    }

    .job-description-preview {
      display: -webkit-box;
      overflow: hidden;
      color: #606266;
      line-height: 1.6;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
    }

    .job-empty-tip {
      margin-top: 12px;
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
