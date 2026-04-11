<template>
  <div class="recommend-talent__wrap">
    <div class="form-wrap">
      <el-form ref="formRef" :model="formContent" label-width="160px">
        <el-collapse v-model="activeCollapse">
          <!-- 岗位配置 -->
          <el-collapse-item title="岗位配置" name="jobs">
            <div class="job-actions">
              <el-button type="primary" size="small" @click="handleAddJob">新增岗位</el-button>
            </div>
            <el-table :data="formContent.jobConfigs" stripe style="width: 100%">
              <el-table-column prop="jobName" label="职位名称" min-width="140" />
              <el-table-column prop="scoreThreshold" label="评分阈值" width="100" />
              <el-table-column label="预筛条件摘要" min-width="200">
                <template #default="{ row }">
                  <span class="filter-summary">{{ buildFilterSummary(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="启用状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.enabled ? 'success' : 'info'">
                    {{ row.enabled ? '已启用' : '已禁用' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="160" fixed="right">
                <template #default="{ row, $index }">
                  <el-button type="primary" link size="small" @click="handleEditJob(row, $index)">编辑</el-button>
                  <el-button type="danger" link size="small" @click="handleDeleteJob($index)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>

          <!-- VL模型配置 -->
          <el-collapse-item title="VL模型配置" name="vlModel">
            <el-form-item label="评分提示词">
              <el-input
                v-model="formContent.scoringPrompt"
                type="textarea"
                :rows="14"
                placeholder="评分提示词将用于 VL 模型分析候选人简历"
              />
            </el-form-item>
            <div class="prompt-actions">
              <el-button type="primary" @click="handleSavePrompt">保存提示词</el-button>
              <el-button @click="handleResetPrompt">重置为默认</el-button>
              <el-button :loading="isTestingVl" @click="handleTestVlModel">测试VL模型</el-button>
            </div>
          </el-collapse-item>

          <!-- 运行控制面板 -->
          <el-collapse-item title="运行控制面板" name="runControl">
            <el-form-item label="选择分析岗位">
              <el-radio-group v-model="selectedJobIndex">
                <el-radio
                  v-for="(job, index) in formContent.jobConfigs"
                  :key="index"
                  :label="index"
                  :disabled="!job.enabled"
                >
                  {{ job.jobName || `岗位 ${index + 1}` }}
                </el-radio>
              </el-radio-group>
              <div v-if="formContent.jobConfigs.length === 0" class="form-tip">请先在「岗位配置」中添加岗位</div>
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="isStarting"
                :disabled="selectedJobIndex === null"
                @click="handleStart"
              >开始分析</el-button>
              <el-button
                type="danger"
                plain
                :loading="isStopButtonLoading"
                @click="handleStopButtonClick"
              >停止任务</el-button>
            </el-form-item>
          </el-collapse-item>
        </el-collapse>

        <!-- 风险提示 -->
        <el-alert type="warning" :closable="false" class="risk-alert">
          <template #title>
            <span class="alert-title">风险提示</span>
          </template>
          <ul class="alert-list">
            <li>VL模型分析结果可能不准确，评分仅供参考</li>
            <li>频繁操作可能触发平台验证码</li>
            <li>截图会占用磁盘空间，请定期清理</li>
          </ul>
        </el-alert>

        <!-- 操作按钮 -->
        <el-form-item class="last-form-item" flex>
          <el-button type="primary" @click="handleSaveOnly">保存配置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 岗位编辑弹窗 -->
    <el-dialog
      v-model="jobDialogVisible"
      :title="isEditingJob ? '编辑岗位' : '新增岗位'"
      width="640px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="jobFormRef"
        :model="jobForm"
        label-width="140px"
      >
        <el-form-item label="职位名称" required>
          <el-input v-model="jobForm.jobName" placeholder="请输入职位名称（需与BOSS直聘上的职位名称一致）" />
        </el-form-item>
        <el-form-item label="岗位职责">
          <el-input
            v-model="jobForm.jobDescription"
            type="textarea"
            :rows="4"
            placeholder="请输入岗位职责"
          />
        </el-form-item>
        <el-form-item label="任职要求">
          <el-input
            v-model="jobForm.jobRequirements"
            type="textarea"
            :rows="4"
            placeholder="请输入任职要求"
          />
        </el-form-item>
        <el-form-item label="评分阈值">
          <el-slider
            v-model="jobForm.scoreThreshold"
            :min="1"
            :max="10"
            :step="0.5"
            show-input
          />
        </el-form-item>
        <el-form-item label="最近活跃天数">
          <el-input-number v-model="jobForm.activeDays" :min="1" :max="365" />
        </el-form-item>
        <el-form-item label="最低学历">
          <el-select v-model="jobForm.minDegree" placeholder="请选择" clearable>
            <el-option label="大专" value="大专" />
            <el-option label="本科" value="本科" />
            <el-option label="硕士" value="硕士" />
            <el-option label="博士" value="博士" />
          </el-select>
        </el-form-item>
        <el-form-item label="薪资范围(K)">
          <div class="range-inputs">
            <el-input-number v-model="jobForm.salaryMin" :min="0" placeholder="最低" />
            <span class="range-separator">-</span>
            <el-input-number v-model="jobForm.salaryMax" :min="0" placeholder="最高" />
          </div>
        </el-form-item>
        <el-form-item label="工作年限范围">
          <el-checkbox-group v-model="jobForm.workYearOptions">
            <el-checkbox
              v-for="option in workYearOptions"
              :key="option.value"
              :label="option.value"
            >
              {{ option.label }}
            </el-checkbox>
          </el-checkbox-group>
          <div class="form-tip">可多选，命中任一项即通过</div>
        </el-form-item>
        <el-form-item label="每职位最大收藏数">
          <el-input-number v-model="jobForm.maxCollectCount" :min="1" :max="200" />
        </el-form-item>
        <el-form-item label="自定义评分提示词">
          <el-input
            v-model="jobForm.customScoringPrompt"
            type="textarea"
            :rows="4"
            placeholder="留空则根据岗位信息自动生成"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="jobDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveJob">确定</el-button>
      </template>
    </el-dialog>

    <div
      class="running-overlay__wrap"
      :style="{
        pointerEvents: 'none'
      }"
    >
      <RunningOverlay
        ref="runningOverlayRef"
        worker-id="recommendTalentMain"
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

const DEGREE_ORDER = ['大专', '本科', '硕士', '博士']

const workYearOptions = [
  { label: '1年', value: '1_year' },
  { label: '2年', value: '2_years' },
  { label: '3年', value: '3_years' },
  { label: '3年以上', value: '3_plus_years' },
  { label: '应届生', value: 'fresh_graduate' }
] as const

const workYearOptionLabels = Object.fromEntries(workYearOptions.map((option) => [option.value, option.label])) as Record<string, string>

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const jobFormRef = ref<InstanceType<typeof ElForm> | null>(null)
const runRecordId = ref<number | null>(null)
const runningOverlayRef = ref<any>(null)
const isStopButtonLoading = ref(false)
const isTestingVl = ref(false)
const isStarting = ref(false)
const activeCollapse = ref(['jobs', 'vlModel', 'runControl'])
const jobDialogVisible = ref(false)
const isEditingJob = ref(false)
const editingJobIndex = ref(-1)
const selectedJobIndex = ref<number | null>(null)

const getDefaultJobConfig = () => ({
  id: undefined as number | undefined,
  encryptJobId: '',
  jobName: '',
  jobDescription: '',
  jobRequirements: '',
  scoreThreshold: 7,
  activeDays: 30,
  minDegree: '',
  salaryMin: 0,
  salaryMax: 0,
  workYearOptions: [] as string[],
  maxCollectCount: 20,
  customScoringPrompt: '',
  enabled: true
})

const getDefaultJobForm = () => ({
  jobName: '',
  jobDescription: '',
  jobRequirements: '',
  scoreThreshold: 7,
  activeDays: 30,
  minDegree: '',
  salaryMin: 0,
  salaryMax: 0,
  workYearOptions: [] as string[],
  maxCollectCount: 20,
  customScoringPrompt: ''
})

const jobForm = ref(getDefaultJobForm())

const getDefaultFormContent = () => ({
  jobConfigs: [] as ReturnType<typeof getDefaultJobConfig>[],
  scoringPrompt: '',
  vlModel: ''
})

const formContent = ref(getDefaultFormContent())

const DEFAULT_SCORING_PROMPT = `你是一个专业的招聘分析师，请根据以下岗位要求分析候选人简历截图。

## 分析维度与评分规则
请从以下维度逐一评估，每项 1-10 分：

1. **工作经历匹配度**（权重30%）
   - 行业经验是否相关
   - 公司规模/类型是否匹配
   - 岗位层级是否合适

2. **技术技能匹配度**（权重30%）
   - 核心技能覆盖程度
   - 技术栈与岗位要求一致性
   - 技能深度评估

3. **项目经验质量**（权重20%）
   - 项目复杂度和规模
   - 项目与岗位相关性
   - 项目成果/业绩

4. **综合素质**（权重20%）
   - 学历背景
   - 职业发展轨迹
   - 稳定性评估

## 输出格式
请严格返回以下JSON格式：
{"workMatch":8,"skillMatch":7,"projectQuality":6,"overallQuality":8,"totalScore":7.4,"recommend":true,"reason":"简要推荐/不推荐理由，50字以内","keyStrengths":["优势1","优势2"],"concerns":["顾虑1"]}

## 评分说明
- totalScore = workMatch * 0.3 + skillMatch * 0.3 + projectQuality * 0.2 + overallQuality * 0.2
- recommend = true 当 totalScore >= 评分阈值
- reason 控制在 50 字以内
- keyStrengths 最多 3 条
- concerns 最多 2 条`

const normalizeWorkYearOptions = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((option): option is string => typeof option === 'string' && option in workYearOptionLabels)
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((option): option is string => typeof option === 'string' && option in workYearOptionLabels)
        : []
    } catch {
      return []
    }
  }
  return []
}

const convertLegacyWorkYearRangeToOptions = (minWorkYears: unknown, maxWorkYears: unknown): string[] => {
  const min = Number(minWorkYears ?? 0)
  const max = Number(maxWorkYears ?? 0)
  const upperBound = max > 0 ? max : Number.POSITIVE_INFINITY

  if (min <= 0 && (max <= 0 || max >= 99 || !Number.isFinite(upperBound))) {
    return []
  }

  const options: string[] = []
  if (min <= 1 && upperBound >= 1) options.push('1_year')
  if (min <= 2 && upperBound >= 2) options.push('2_years')
  if (min <= 3 && upperBound >= 3) options.push('3_years')
  if (upperBound > 3) options.push('3_plus_years')
  return options
}

const mapDbJobConfigToForm = (config: any) => ({
  ...getDefaultJobConfig(),
  id: config?.id,
  encryptJobId: config?.encryptJobId || '',
  jobName: config?.jobName || '',
  jobDescription: config?.jobResponsibilities || '',
  jobRequirements: config?.jobRequirements || '',
  scoreThreshold: Number(config?.scoreThreshold ?? 7),
  activeDays: Number(config?.activeWithinDays ?? 30),
  minDegree: config?.minDegree || '',
  salaryMin: Number(config?.salaryMin ?? 0),
  salaryMax: Number(config?.salaryMax ?? 0),
  workYearOptions: normalizeWorkYearOptions(config?.workYearOptions).length > 0
    ? normalizeWorkYearOptions(config?.workYearOptions)
    : convertLegacyWorkYearRangeToOptions(config?.minWorkYears, config?.maxWorkYears),
  maxCollectCount: Number(config?.maxCollectPerJob ?? 20),
  customScoringPrompt: config?.scoringPrompt || '',
  enabled: config?.enabled !== false
})

const mapFormJobToDbConfig = (config: ReturnType<typeof getDefaultJobConfig>) => ({
  id: config.id,
  encryptJobId: config.encryptJobId || undefined,
  jobName: config.jobName.trim(),
  jobResponsibilities: config.jobDescription?.trim() || '',
  jobRequirements: config.jobRequirements?.trim() || '',
  scoreThreshold: Number(config.scoreThreshold ?? 7),
  activeWithinDays: Number(config.activeDays ?? 30),
  requireJobSeeking: false,
  minDegree: config.minDegree || '',
  salaryMin: Number(config.salaryMin ?? 0),
  salaryMax: Number(config.salaryMax ?? 0),
  targetCities: JSON.stringify([]),
  minWorkYears: 0,
  maxWorkYears: 0,
  workYearOptions: JSON.stringify(normalizeWorkYearOptions(config.workYearOptions)),
  maxCollectPerJob: Number(config.maxCollectCount ?? 20),
  scoringPrompt: config.customScoringPrompt?.trim() || '',
  enabled: config.enabled !== false
})

// 构建预筛条件摘要
const buildFilterSummary = (job: ReturnType<typeof getDefaultJobConfig>) => {
  const parts: string[] = []
  if (job.minDegree) {
    parts.push(`学历>=${job.minDegree}`)
  }
  if (job.workYearOptions.length > 0) {
    parts.push(`年限${job.workYearOptions.map((option) => workYearOptionLabels[option] || option).join('/')}`)
  }
  if (job.activeDays !== 30) {
    parts.push(`活跃<=${job.activeDays}天`)
  }
  return parts.length > 0 ? parts.join(' | ') : '无额外筛选'
}

// 加载配置
onMounted(async () => {
  try {
    // 加载岗位配置列表
    const configs = await electron.ipcRenderer.invoke('recommend-get-job-configs')
    if (Array.isArray(configs) && configs.length > 0) {
      formContent.value.jobConfigs = configs.map((c: any) => mapDbJobConfigToForm(c))
    }

    // 加载 boss.json 中的 recommendTalent 配置
    const res = await electron.ipcRenderer.invoke('fetch-config-file-content')
    const bossConfig = res.config['boss.json'] || {}
    if (bossConfig.recommendTalent) {
      const rtConfig = bossConfig.recommendTalent
      formContent.value.scoringPrompt = rtConfig.scoringPrompt || DEFAULT_SCORING_PROMPT
      formContent.value.vlModel = rtConfig.vlModel || ''
    } else {
      formContent.value.scoringPrompt = DEFAULT_SCORING_PROMPT
    }
  } catch (err) {
    console.error('加载配置失败:', err)
  }
})

// 新增岗位
const handleAddJob = () => {
  isEditingJob.value = false
  editingJobIndex.value = -1
  jobForm.value = getDefaultJobForm()
  jobDialogVisible.value = true
}

// 编辑岗位
const handleEditJob = (row: ReturnType<typeof getDefaultJobConfig>, index: number) => {
  isEditingJob.value = true
  editingJobIndex.value = index
  jobForm.value = {
    jobName: row.jobName,
    jobDescription: row.jobDescription,
    jobRequirements: row.jobRequirements,
    scoreThreshold: row.scoreThreshold,
    activeDays: row.activeDays,
    minDegree: row.minDegree,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    workYearOptions: [...row.workYearOptions],
    maxCollectCount: row.maxCollectCount,
    customScoringPrompt: row.customScoringPrompt
  }
  jobDialogVisible.value = true
}

// 删除岗位
const handleDeleteJob = async (index: number) => {
  try {
    const targetJob = formContent.value.jobConfigs[index]
    if (targetJob?.id) {
      await electron.ipcRenderer.invoke('recommend-delete-job-config', { id: targetJob.id })
    }
    formContent.value.jobConfigs.splice(index, 1)
    // 清理选中索引
    selectedJobIndex.value = null
    ElMessage.success('已删除')
  } catch (err) {
    console.error('删除失败:', err)
    ElMessage.error('删除失败')
  }
}

// 保存岗位（新增或编辑）
const handleSaveJob = async () => {
  if (!jobForm.value.jobName) {
    ElMessage.warning('请填写职位名称')
    return
  }

  try {
    const currentJobConfig = isEditingJob.value
      ? formContent.value.jobConfigs[editingJobIndex.value]
      : getDefaultJobConfig()
    const configData = {
      ...currentJobConfig,
      ...jobForm.value
    }
    const savedConfigRaw = await electron.ipcRenderer.invoke('recommend-save-job-config', {
      index: isEditingJob.value ? editingJobIndex.value : -1,
      config: mapFormJobToDbConfig(configData)
    })
    const savedConfig = savedConfigRaw?.data ?? savedConfigRaw

    const normalizedSavedConfig = mapDbJobConfigToForm(savedConfig)

    if (isEditingJob.value) {
      formContent.value.jobConfigs[editingJobIndex.value] = normalizedSavedConfig
    } else {
      formContent.value.jobConfigs.unshift(normalizedSavedConfig)
    }

    jobDialogVisible.value = false
    ElMessage.success(isEditingJob.value ? '已更新' : '已添加')
  } catch (err) {
    console.error('保存岗位失败:', err)
    ElMessage.error('保存失败')
  }
}

// 重置评分提示词
const handleResetPrompt = () => {
  formContent.value.scoringPrompt = DEFAULT_SCORING_PROMPT
  ElMessage.success('已重置为默认提示词')
}

// 保存提示词到 boss.json
const handleSavePrompt = async () => {
  try {
    await electron.ipcRenderer.invoke('save-config-file-from-ui', JSON.stringify({
      recommendTalent: {
        scoringPrompt: formContent.value.scoringPrompt,
        vlModel: formContent.value.vlModel
      }
    }))
    ElMessage.success('提示词已保存')
  } catch (err) {
    console.error('保存提示词失败:', err)
    ElMessage.error('保存失败')
  }
}

// 测试VL模型连接
const handleTestVlModel = async () => {
  isTestingVl.value = true
  try {
    const res = await electron.ipcRenderer.invoke('test-vl-model')
    if (res.success) {
      ElMessage.success(`VL模型连接成功 (${res.model}): ${res.response}`)
    } else {
      ElMessage.error(`连接失败: ${res.error}`)
    }
  } catch (err: any) {
    ElMessage.error('测试失败: ' + (err?.message || '未知错误'))
  } finally {
    isTestingVl.value = false
  }
}

// 保存配置到 boss.json
const saveConfig = async () => {
  await electron.ipcRenderer.invoke('save-config-file-from-ui', JSON.stringify({
    recommendTalent: {
      scoringPrompt: formContent.value.scoringPrompt,
      vlModel: formContent.value.vlModel
    }
  }))
}

// 仅保存配置
const handleSaveOnly = async () => {
  try {
    await saveConfig()
    ElMessage.success('配置已保存')
  } catch (err) {
    console.error('保存失败:', err)
    ElMessage.error('保存失败')
  }
}

// 开始分析
const handleStart = async () => {
  if (selectedJobIndex.value === null) {
    ElMessage.warning('请选择一个岗位')
    return
  }

  isStarting.value = true
  try {
    await saveConfig()
    const job = formContent.value.jobConfigs[selectedJobIndex.value]
    if (!job) {
      ElMessage.error('岗位配置不存在')
      return
    }
    const selectedJobConfigs = [{ id: job.id, jobName: job.jobName }]
    const { runRecordId: rrId } = await electron.ipcRenderer.invoke('run-recommend-talent', {
      selectedJobConfigs
    })
    runRecordId.value = rrId
    runningOverlayRef.value?.show()
  } catch (err) {
    console.error('启动失败:', err)
    ElMessage.error({
      message: err?.message || '启动失败，请查看日志'
    })
    runningOverlayRef.value?.hide?.()
  } finally {
    isStarting.value = false
  }
}

// 停止任务
const handleStopButtonClick = async () => {
  isStopButtonLoading.value = true
  try {
    await electron.ipcRenderer.invoke('stop-recommend-talent')
    runningOverlayRef.value?.hide()
  } finally {
    isStopButtonLoading.value = false
  }
}
</script>

<style lang="scss">
.recommend-talent__wrap {
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

    .range-inputs {
      display: flex;
      align-items: center;
      gap: 8px;

      .range-separator {
        color: #909399;
      }
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
}
</style>
