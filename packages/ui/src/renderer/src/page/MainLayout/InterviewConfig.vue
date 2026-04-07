<template>
  <div class="interview-config__wrap">
    <div class="form-wrap">
      <el-form ref="formRef" :model="formContent" label-width="140px">
        <!-- 岗位列表 -->
        <el-card class="box-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span>岗位配置</span>
              <el-button type="primary" size="small" @click="handleAddJob">添加岗位</el-button>
            </div>
          </template>

          <el-table :data="jobList" style="width: 100%" v-loading="loading">
            <el-table-column prop="name" label="岗位名称" min-width="150" />
            <el-table-column prop="passThreshold" label="通过阈值" width="100">
              <template #default="{ row }">{{ row.passThreshold }}分</template>
            </el-table-column>
            <el-table-column prop="isActive" label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="row.isActive ? 'success' : 'info'" size="small">
                  {{ row.isActive ? '启用' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="问题轮次" width="100">
              <template #default="{ row }">
                {{ row.questionRounds?.length || 0 }}轮
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="handleEditJob(row)">编辑</el-button>
                <el-button type="danger" link size="small" @click="handleDeleteJob(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 岗位编辑对话框 -->
        <el-dialog
          v-model="dialogVisible"
          :title="editingJob?.id ? '编辑岗位' : '添加岗位'"
          width="700px"
          destroy-on-close
        >
          <el-form :model="jobForm" label-width="100px">
            <el-form-item label="岗位名称" required>
              <el-input v-model="jobForm.name" placeholder="请输入岗位名称" />
            </el-form-item>

            <el-form-item label="岗位描述">
              <el-input
                v-model="jobForm.description"
                type="textarea"
                :rows="3"
                placeholder="请输入岗位描述（可选）"
              />
            </el-form-item>

            <el-form-item label="通过阈值">
              <el-input-number v-model="jobForm.passThreshold" :min="0" :max="100" />
              <span class="form-tip">候选人总分达到此阈值才算通过</span>
            </el-form-item>

            <el-form-item label="启用状态">
              <el-switch v-model="jobForm.isActive" />
            </el-form-item>

            <!-- 候选人筛选条件 -->
            <el-divider content-position="left">候选人筛选</el-divider>

            <el-form-item label="学历筛选">
              <el-checkbox-group v-model="jobForm.educationFilter">
                <el-checkbox label="大专及以下">大专及以下</el-checkbox>
                <el-checkbox label="本科">本科</el-checkbox>
                <el-checkbox label="硕士/研究生">硕士/研究生</el-checkbox>
                <el-checkbox label="博士">博士</el-checkbox>
              </el-checkbox-group>
              <div class="form-tip">多选时满足任一条件即可（OR逻辑），不选则不筛选学历</div>
            </el-form-item>

            <el-form-item label="经验筛选">
              <el-checkbox-group v-model="jobForm.experienceFilter">
                <el-checkbox label="1年及以下">1年及以下</el-checkbox>
                <el-checkbox label="2年">2年</el-checkbox>
                <el-checkbox label="3年">3年</el-checkbox>
                <el-checkbox label="3年以上">3年以上</el-checkbox>
                <el-checkbox label="25届应届生">25届应届生</el-checkbox>
                <el-checkbox label="26届应届生">26届应届生</el-checkbox>
              </el-checkbox-group>
              <div class="form-tip">多选时满足任一条件即可（OR逻辑），"3年以上"包含3年及以上所有经验，不选则不筛选经验</div>
            </el-form-item>

            <!-- 问题轮次配置 -->
            <el-divider content-position="left">问题轮次</el-divider>

            <div v-for="(round, index) in jobForm.questionRounds" :key="index" class="question-round-item">
              <el-card shadow="never">
                <template #header>
                  <div class="card-header">
                    <span>第 {{ index + 1 }} 轮</span>
                    <el-button type="danger" link size="small" @click="removeQuestionRound(index)">删除</el-button>
                  </div>
                </template>

                <el-form-item label="问题内容">
                  <el-input
                    v-model="round.questionText"
                    type="textarea"
                    :rows="2"
                    placeholder="请输入面试问题"
                  />
                </el-form-item>

                <el-form-item label="超时时间">
                  <el-input-number v-model="round.waitTimeoutMinutes" :min="10" :max="1440" />
                  <span class="form-tip">分钟</span>
                </el-form-item>

                <el-form-item label="评分关键词">
                  <el-select
                    v-model="round.keywords"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    placeholder="输入关键词后回车添加"
                    style="width: 100%"
                  />
                </el-form-item>

                <el-form-item label="否定词">
                  <el-select
                    v-model="round.negationWords"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    placeholder="输入否定词后回车添加（如：没有、没、无）"
                    style="width: 100%"
                  />
                  <div class="form-tip">当这些词出现在关键词前面时，视为否定该关键词，评分不通过</div>
                </el-form-item>

                <el-form-item label="关键词权重">
                  <el-input-number v-model="round.keywordScore" :min="0" :max="100" />
                  <span class="form-tip">%</span>
                </el-form-item>

                <el-form-item label="AI评分权重">
                  <el-input-number v-model="round.llmScore" :min="0" :max="100" />
                  <span class="form-tip">%</span>
                </el-form-item>
              </el-card>
            </div>

            <el-button type="primary" plain @click="addQuestionRound" style="width: 100%">
              + 添加问题轮次
            </el-button>
          </el-form>

          <template #footer>
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="handleSaveJob">保存</el-button>
          </template>
        </el-dialog>

        <!-- 基础设置 -->
        <el-card class="box-card" shadow="never" style="margin-top: 16px">
          <template #header>
            <span>基础设置</span>
          </template>

          <el-form-item label="扫描间隔">
            <el-input-number v-model="formContent.scanIntervalSeconds" :min="5" :max="60" />
            <span class="form-tip">秒</span>
          </el-form-item>

          <el-form-item label="最大轮次">
            <el-input-number v-model="formContent.maxRounds" :min="1" :max="10" />
          </el-form-item>

          <el-form-item label="回复超时">
            <el-input-number v-model="formContent.defaultTimeoutMinutes" :min="10" :max="1440" />
            <span class="form-tip">分钟</span>
          </el-form-item>
        </el-card>

        <!-- 操作按钮 -->
        <el-form-item class="last-form-item" style="margin-top: 16px">
          <el-button type="primary" @click="handleSaveConfig">保存配置</el-button>
          <el-button type="warning" @click="handleManualTest">手动测试</el-button>
          <el-button type="success" @click="handleStartInterview">开始面试自动化</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 运行状态覆盖层 -->
    <div class="running-overlay__wrap">
      <RunningOverlay
        ref="runningOverlayRef"
        worker-id="interviewAutoMain"
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
              >结束任务</el-button>
            </template>
            <template v-else>
              <el-button
                type="primary"
                @click="runningOverlayRef?.hide?.()"
              >关闭</el-button>
            </template>
          </div>
        </template>
      </RunningOverlay>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElForm, ElMessage, ElMessageBox } from 'element-plus'
import RunningOverlay from '@renderer/features/RunningOverlay/index.vue'
import { RUNNING_STATUS_ENUM } from '../../../../common/enums/auto-start-chat'

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const runRecordId = ref<number | null>(null)
const runningOverlayRef = ref<any>(null)
const isStopButtonLoading = ref(false)
const loading = ref(false)
const dialogVisible = ref(false)
const jobList = ref<any[]>([])
const editingJob = ref<any>(null)

const getDefaultFormContent = () => ({
  scanIntervalSeconds: 10,
  maxRounds: 3,
  defaultTimeoutMinutes: 60
})

const formContent = ref(getDefaultFormContent())

const getDefaultJobForm = () => ({
  name: '',
  description: '',
  passThreshold: 60,
  isActive: true,
  educationFilter: [],
  experienceFilter: [],
  questionRounds: [
    {
      roundNumber: 1,
      questionText: '',
      waitTimeoutMinutes: 60,
      keywords: [],
      negationWords: [],
      keywordScore: 50,
      llmScore: 50
    }
  ]
})

const jobForm = ref(getDefaultJobForm())

// 加载配置
onMounted(async () => {
  await loadJobList()
  await loadConfig()
})

async function loadJobList() {
  loading.value = true
  try {
    const result = await electron.ipcRenderer.invoke('interview-get-job-list')
    if (result.success) {
      jobList.value = result.data || []
    }
  } catch (error) {
    console.error('加载岗位列表失败:', error)
  } finally {
    loading.value = false
  }
}

async function loadConfig() {
  try {
    const configResult = await electron.ipcRenderer.invoke('interview-get-all-config')
    if (configResult.success && configResult.data) {
      formContent.value = {
        ...formContent.value,
        ...configResult.data
      }
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

function handleAddJob() {
  editingJob.value = null
  jobForm.value = getDefaultJobForm()
  dialogVisible.value = true
}

function handleEditJob(row: any) {
  editingJob.value = row

  // 解析筛选条件
  let educationFilter: string[] = []
  let experienceFilter: string[] = []
  try {
    if (row.educationFilter) {
      educationFilter = JSON.parse(row.educationFilter)
    }
    if (row.experienceFilter) {
      experienceFilter = JSON.parse(row.experienceFilter)
    }
  } catch (e) {
    console.error('解析筛选条件失败:', e)
  }

  jobForm.value = {
    ...row,
    educationFilter,
    experienceFilter,
    questionRounds: row.questionRounds?.map((r: any) => ({
      ...r,
      keywords: r.keywords ? JSON.parse(r.keywords) : [],
      negationWords: r.negationWords ? JSON.parse(r.negationWords) : []
    })) || []
  }
  dialogVisible.value = true
}

async function handleDeleteJob(row: any) {
  try {
    await ElMessageBox.confirm('确定要删除此岗位配置吗？', '确认删除', {
      type: 'warning'
    })

    const result = await electron.ipcRenderer.invoke('interview-delete-job', row.id)
    if (result.success) {
      ElMessage.success('删除成功')
      await loadJobList()
    } else {
      ElMessage.error(result.error || '删除失败')
    }
  } catch (error) {
    // 用户取消
  }
}

function addQuestionRound() {
  const nextRound = jobForm.value.questionRounds.length + 1
  jobForm.value.questionRounds.push({
    roundNumber: nextRound,
    questionText: '',
    waitTimeoutMinutes: 60,
    keywords: [],
    negationWords: [],
    keywordScore: 50,
    llmScore: 50
  })
}

function removeQuestionRound(index: number) {
  jobForm.value.questionRounds.splice(index, 1)
  // 重新编号
  jobForm.value.questionRounds.forEach((r, i) => {
    r.roundNumber = i + 1
  })
}

async function handleSaveJob() {
  if (!jobForm.value.name) {
    ElMessage.warning('请输入岗位名称')
    return
  }

  // 检查问题轮次
  const validRounds = jobForm.value.questionRounds.filter(r => r.questionText)
  if (validRounds.length === 0) {
    ElMessage.warning('请至少配置一个问题轮次')
    return
  }

  try {
    const data = {
      ...jobForm.value,
      educationFilter: JSON.stringify(jobForm.value.educationFilter || []),
      experienceFilter: JSON.stringify(jobForm.value.experienceFilter || []),
      questionRounds: jobForm.value.questionRounds.map(r => ({
        ...r,
        keywords: JSON.stringify(r.keywords || []),
        negationWords: JSON.stringify(r.negationWords || [])
      }))
    }

    const result = await electron.ipcRenderer.invoke('interview-save-job', data)
    if (result.success) {
      ElMessage.success('保存成功')
      dialogVisible.value = false
      await loadJobList()
    } else {
      ElMessage.error(result.error || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败')
  }
}

async function handleSaveConfig() {
  try {
    await electron.ipcRenderer.invoke('interview-save-config', 'interview_settings', JSON.stringify(formContent.value))
    ElMessage.success('配置已保存')
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败')
  }
}

async function handleStartInterview() {
  if (jobList.value.length === 0) {
    ElMessage.warning('请先添加岗位配置')
    return
  }

  try {
    await handleSaveConfig()
    runningOverlayRef.value?.show()
    const { runRecordId: rrId } = await electron.ipcRenderer.invoke('run-interview-auto')
    runRecordId.value = rrId
  } catch (error: any) {
    ElMessage.error(error?.message || '启动失败')
  }
}

async function handleStopButtonClick() {
  isStopButtonLoading.value = true
  try {
    await electron.ipcRenderer.invoke('stop-interview-auto')
    runningOverlayRef.value?.hide()
  } finally {
    isStopButtonLoading.value = false
  }
}

async function handleManualTest() {
  if (jobList.value.length === 0) {
    ElMessage.warning('请先添加岗位配置')
    return
  }

  try {
    const result = await electron.ipcRenderer.invoke('interview-manual-test')
    if (result.success) {
      ElMessage.success('手动测试已启动，请在浏览器中操作')
    } else {
      ElMessage.error(result.error || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '启动失败')
  }
}
</script>

<style lang="scss">
.interview-config__wrap {
  position: relative;
  padding: 16px;

  .form-wrap {
    max-height: 100vh;
    overflow: auto;

    .el-form {
      max-width: 1000px;
      margin: 0 auto;
    }
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .question-round-item {
    margin-bottom: 16px;
  }

  .form-tip {
    font-size: 12px;
    color: #909399;
    margin-left: 8px;
  }

  .last-form-item {
    .el-form-item__content {
      justify-content: flex-end;
    }
  }

  .running-overlay__wrap {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
}
</style>