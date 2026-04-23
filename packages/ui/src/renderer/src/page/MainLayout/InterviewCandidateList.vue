<template>
  <div class="interview-candidate-list__wrap">
    <!-- 筛选区域 -->
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="filterForm">
        <el-form-item label="状态">
          <el-select
            v-model="filterForm.status"
            placeholder="全部状态"
            clearable
            @change="handleFilterChange"
          >
            <el-option label="等待回复" value="waiting_round_1" />
            <el-option label="等待第2轮回复" value="waiting_round_2" />
            <el-option label="回复提取失败" value="reply_extraction_failed" />
            <el-option label="已通过" value="passed" />
            <el-option label="已拒绝" value="rejected" />
            <el-option label="已发送简历邀请" value="resume_requested" />
            <el-option label="已收到简历" value="resume_received" />
            <el-option label="已发送邮件" value="emailed" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间">
          <div class="time-filter-group">
            <el-dropdown trigger="click" @command="handleTimeFilterCommand">
              <el-button :type="hasActiveTimeFilter ? 'primary' : undefined">
                {{ timeFilterButtonLabel }}
                <el-icon class="el-icon--right"><arrow-down /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="today">{{ todayOptionLabel }}</el-dropdown-item>
                  <el-dropdown-item command="yesterday">昨天</el-dropdown-item>
                  <el-dropdown-item command="custom">更多</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button v-if="hasActiveTimeFilter" link @click="clearTimeFilter">清除</el-button>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleFilterChange">刷新</el-button>
          <el-button type="success" :loading="sendingEmail" @click="handleSendSummaryEmail">
            {{ sendingEmail ? '发送中...' : '发送邮件' }}
          </el-button>
          <el-button @click="handleExportExcel">导出Excel</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stats-row">
      <el-col v-for="(count, status) in statusStats" :key="status" :span="4">
        <el-card shadow="never" class="stats-card" @click="handleStatsClick(status)">
          <div class="stats-value">{{ count }}</div>
          <div class="stats-label">{{ getStatusLabel(status as string) }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 候选人列表 -->
    <el-card shadow="never" class="table-card">
      <el-table
        v-loading="loading"
        :data="candidateList"
        style="width: 100%"
        @row-click="handleRowClick"
      >
        <el-table-column prop="geekName" label="姓名" width="120" />
        <el-table-column prop="education" label="学历" width="100">
          <template #default="{ row }">
            <span>{{ row.education || '--' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="jobName" label="应聘岗位" min-width="150" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusTagType(row.status)" size="small">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="currentRound" label="当前轮次" width="100">
          <template #default="{ row }">
            {{ row.currentRound > 0 ? `第${row.currentRound}轮` : '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="totalScore" label="得分" width="100">
          <template #default="{ row }">
            <span
              v-if="row.totalScore"
              :class="{ 'text-success': row.totalScore >= 60, 'text-danger': row.totalScore < 60 }"
            >
              {{ row.totalScore }}分
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="160">
          <template #default="{ row }">
            {{ formatDate(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="问答详情" width="120">
          <template #default="{ row }">
            <el-dropdown
              trigger="click"
              placement="bottom-start"
              @command="(cmd) => handleDropdownClick(cmd, row)"
            >
              <el-button type="primary" link size="small">
                查看<el-icon class="el-icon--right"><arrow-down /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <template v-if="row.qaRecords && row.qaRecords.length > 0">
                    <el-dropdown-item
                      v-for="qa in row.qaRecords"
                      :key="qa.id"
                      :command="'detail'"
                      disabled
                    >
                      <div class="qa-dropdown-item">
                        <div class="qa-round-label">第{{ qa.roundNumber }}轮</div>
                        <div class="qa-question">
                          <strong>问：</strong>{{ truncateText(qa.questionText, 50) }}
                        </div>
                        <div class="qa-answer">
                          <strong>答：</strong>{{ truncateText(qa.answerText, 50) }}
                        </div>
                        <div v-if="qa.totalScore" class="qa-score">
                          <strong>得分：</strong>
                          <span
                            :class="{
                              'text-success': qa.totalScore >= 60,
                              'text-danger': qa.totalScore < 60
                            }"
                          >
                            {{ qa.totalScore }}分
                          </span>
                        </div>
                      </div>
                    </el-dropdown-item>
                  </template>
                  <el-dropdown-item v-else disabled>
                    <span style="color: #909399">暂无问答记录</span>
                  </el-dropdown-item>
                  <el-dropdown-item divided :command="'fullDetail'">
                    <el-button type="primary" link size="small">完整详情</el-button>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        style="margin-top: 16px; justify-content: flex-end"
        @size-change="loadCandidates"
        @current-change="loadCandidates"
      />
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailDialogVisible" title="候选人详情" width="700px" destroy-on-close>
      <template v-if="currentCandidate">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ currentCandidate.geekName }}</el-descriptions-item>
          <el-descriptions-item label="学历">{{
            currentCandidate.education || '--'
          }}</el-descriptions-item>
          <el-descriptions-item label="应聘岗位">{{
            currentCandidate.jobName
          }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusTagType(currentCandidate.status)">
              {{ getStatusLabel(currentCandidate.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前轮次">
            {{ currentCandidate.currentRound > 0 ? `第${currentCandidate.currentRound}轮` : '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="总得分">
            <span
              :class="{
                'text-success': currentCandidate.totalScore >= 60,
                'text-danger': currentCandidate.totalScore < 60
              }"
            >
              {{ currentCandidate.totalScore || '-' }}分
            </span>
          </el-descriptions-item>
          <el-descriptions-item v-if="currentCandidate.school" label="毕业院校">{{
            currentCandidate.school
          }}</el-descriptions-item>
          <el-descriptions-item v-if="currentCandidate.major" label="专业">{{
            currentCandidate.major
          }}</el-descriptions-item>
          <el-descriptions-item label="AI评分理由" :span="2">
            {{ currentCandidate.llmReason || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 问答记录 -->
        <el-divider content-position="left">问答记录</el-divider>

        <el-timeline v-if="qaRecords.length > 0">
          <el-timeline-item
            v-for="qa in qaRecords"
            :key="qa.id"
            :timestamp="formatDate(qa.createdAt)"
            placement="top"
          >
            <el-card shadow="never">
              <p><strong>问题：</strong>{{ qa.questionText }}</p>
              <p><strong>回答：</strong>{{ qa.answerText || '（未回答）' }}</p>
              <p v-if="qa.llmScore || qa.totalScore">
                <strong>AI评分：</strong>
                {{ qa.llmScore || qa.totalScore || 0 }}分
              </p>
              <p v-if="qa.llmReason"><strong>AI理由：</strong>{{ qa.llmReason }}</p>
            </el-card>
          </el-timeline-item>
        </el-timeline>

        <el-empty v-else description="暂无问答记录" />
      </template>
    </el-dialog>

    <el-dialog
      v-model="customDateDialogVisible"
      title="选择时间范围"
      width="460px"
      destroy-on-close
    >
      <el-date-picker
        v-model="customDateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        unlink-panels
        style="width: 100%"
        :disabled-date="disableFutureDate"
      />
      <template #footer>
        <el-button @click="customDateDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCustomDateFilter">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'

type TimeFilterMode = '' | 'today' | 'yesterday' | 'custom'

interface CandidateQaRecord {
  id: number | string
  roundNumber: number
  questionText: string
  answerText: string
  totalScore?: number | null
  llmScore?: number | null
  llmReason?: string | null
  createdAt?: string | Date | null
}

interface CandidateRow {
  id: number
  geekName?: string | null
  education?: string | null
  jobName?: string | null
  status: string
  currentRound: number
  totalScore?: number | null
  updatedAt?: string | Date | null
  school?: string | null
  major?: string | null
  llmReason?: string | null
  qaRecords?: CandidateQaRecord[]
}

interface SmtpConfig {
  recipient?: string
}

const loading = ref(false)
const candidateList = ref<CandidateRow[]>([])
const statusStats = ref<Record<string, number>>({})
const detailDialogVisible = ref(false)
const currentCandidate = ref<CandidateRow | null>(null)
const qaRecords = ref<CandidateQaRecord[]>([])
const sendingEmail = ref(false)
const timeFilterMode = ref<TimeFilterMode>('')
const customDateDialogVisible = ref(false)
const customDateRange = ref<Date[]>([])
const now = ref(new Date())
let timeTickTimer: ReturnType<typeof setInterval> | null = null

const filterForm = reactive({
  status: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const hasActiveTimeFilter = computed(() => timeFilterMode.value !== '')
const todayOptionLabel = computed(() => `今天（${formatMonthDay(now.value)}）`)
const timeFilterButtonLabel = computed(() => {
  if (timeFilterMode.value === 'today') return todayOptionLabel.value
  if (timeFilterMode.value === 'yesterday') return '昨天'
  if (timeFilterMode.value === 'custom' && customDateRange.value.length === 2) {
    return `${formatMonthDay(customDateRange.value[0])} - ${formatMonthDay(customDateRange.value[1])}`
  }
  return '筛选时间'
})

onMounted(() => {
  loadCandidates()
  loadStats()
  timeTickTimer = setInterval(() => {
    now.value = new Date()
  }, 60 * 1000)
})

onUnmounted(() => {
  if (timeTickTimer) {
    clearInterval(timeTickTimer)
    timeTickTimer = null
  }
})

async function loadCandidates() {
  loading.value = true
  try {
    const result = await electron.ipcRenderer.invoke(
      'interview-get-candidates',
      buildCandidateQueryParams()
    )

    if (result.success) {
      // 获取候选人列表
      const candidates: CandidateRow[] = result.data.list || []
      pagination.total = result.data.total || 0

      // 为每个候选人获取问答记录（用于下拉显示）
      const candidatesWithQa = await Promise.all(
        candidates.map(async (candidate: CandidateRow) => {
          try {
            const detailResult = await electron.ipcRenderer.invoke(
              'interview-get-candidate-detail',
              candidate.id
            )
            if (detailResult.success) {
              return {
                ...candidate,
                qaRecords: (detailResult.data.qaRecords || []) as CandidateQaRecord[]
              }
            }
            return { ...candidate, qaRecords: [] }
          } catch {
            return { ...candidate, qaRecords: [] }
          }
        })
      )

      candidateList.value = candidatesWithQa
    }
  } catch (error) {
    console.error('加载候选人列表失败:', error)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const result = await electron.ipcRenderer.invoke(
      'interview-get-candidate-stats',
      buildTimeFilterParams()
    )
    if (result.success) {
      statusStats.value = result.data || {}
    }
  } catch (error) {
    console.error('加载统计数据失败:', error)
  }
}

function handleFilterChange() {
  pagination.page = 1
  loadCandidates()
  loadStats()
}

async function handleViewDetail(row: CandidateRow) {
  try {
    const result = await electron.ipcRenderer.invoke('interview-get-candidate-detail', row.id)
    if (result.success) {
      currentCandidate.value = result.data.candidate as CandidateRow
      qaRecords.value = (result.data.qaRecords || []) as CandidateQaRecord[]
      detailDialogVisible.value = true
    }
  } catch (error) {
    console.error('加载候选人详情失败:', error)
  }
}

function handleRowClick(row: CandidateRow) {
  handleViewDetail(row)
}

function handleStatsClick(status: string) {
  filterForm.status = status
  handleFilterChange()
}

async function handleExportExcel() {
  try {
    const result = await electron.ipcRenderer.invoke(
      'interview-export-candidates-excel',
      buildCandidateQueryParams()
    )
    if (result.success) {
      ElMessage.success('已保存在桌面')
    } else {
      ElMessage.error(result.error || '导出失败')
    }
  } catch (error) {
    console.error('导出Excel失败:', error)
    ElMessage.error('导出失败')
  }
}

async function handleSendSummaryEmail() {
  if (pagination.total === 0) {
    ElMessage.warning('当前筛选结果没有可发送的候选人')
    return
  }

  let recipient = ''
  try {
    const configResult = await electron.ipcRenderer.invoke('interview-get-config', 'smtp_config')
    if (configResult.success && configResult.data) {
      const config = JSON.parse(configResult.data) as SmtpConfig
      recipient = config.recipient || ''
    }
  } catch (error) {
    console.error('读取邮件配置失败:', error)
  }

  if (!recipient) {
    ElMessage.warning('请先在邮件设置中配置收件邮箱')
    return
  }

  const confirmMessage = [
    `收件邮箱：${recipient}`,
    `筛选时间：${hasActiveTimeFilter.value ? timeFilterButtonLabel.value : '全部时间'}`,
    `状态筛选：${filterForm.status ? getStatusLabel(filterForm.status) : '全部状态'}`,
    `候选人数：${pagination.total}`
  ].join('\n')

  try {
    await ElMessageBox.confirm(confirmMessage, '确认发送候选人汇总邮件', {
      confirmButtonText: '发送',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  sendingEmail.value = true
  try {
    const result = await electron.ipcRenderer.invoke(
      'interview-send-candidate-summary-email',
      buildCandidateQueryParams()
    )
    if (result.success) {
      ElMessage.success(`已发送至 ${result.data.recipient}，共 ${result.data.count} 位候选人`)
      await loadCandidates()
      await loadStats()
    } else {
      ElMessage.error(result.error || '发送失败')
    }
  } catch (error) {
    console.error('发送候选人汇总邮件失败:', error)
    ElMessage.error('发送失败')
  } finally {
    sendingEmail.value = false
  }
}

function handleTimeFilterCommand(command: string) {
  if (command === 'today' || command === 'yesterday') {
    timeFilterMode.value = command
    handleFilterChange()
    return
  }

  if (command === 'custom') {
    customDateDialogVisible.value = true
  }
}

function confirmCustomDateFilter() {
  if (customDateRange.value.length !== 2) {
    ElMessage.warning('请选择开始和结束日期')
    return
  }

  timeFilterMode.value = 'custom'
  customDateDialogVisible.value = false
  handleFilterChange()
}

function clearTimeFilter() {
  timeFilterMode.value = ''
  customDateRange.value = []
  handleFilterChange()
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: '待发送首轮',
    waiting_round_1: '等待第1轮',
    waiting_round_2: '等待第2轮',
    waiting_round_n: '等待回复中',
    reply_extraction_failed: '回复提取失败',
    passed: '已通过',
    rejected: '已拒绝',
    resume_requested: '已邀请简历',
    resume_received: '已收到简历',
    emailed: '已发送邮件',
    error: '处理出错'
  }
  return labels[status] || status
}

function getStatusTagType(status: string): string {
  const types: Record<string, string> = {
    new: 'warning',
    waiting_round_1: 'warning',
    waiting_round_2: 'warning',
    waiting_round_n: 'warning',
    reply_extraction_failed: 'danger',
    passed: 'success',
    rejected: 'danger',
    resume_requested: 'primary',
    resume_received: 'success',
    emailed: 'success',
    error: 'danger'
  }
  return types[status] || 'info'
}

function formatDate(date: string | Date): string {
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

function truncateText(text: string, maxLength: number): string {
  if (!text) return '(无)'
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

function handleDropdownClick(command: string, row: CandidateRow) {
  if (command === 'fullDetail') {
    handleViewDetail(row)
  }
}

function buildCandidateQueryParams() {
  return {
    status: filterForm.status || undefined,
    page: pagination.page,
    pageSize: pagination.pageSize,
    ...buildTimeFilterParams()
  }
}

function buildTimeFilterParams() {
  if (timeFilterMode.value === 'today') {
    return buildDayRangeParams(0)
  }

  if (timeFilterMode.value === 'yesterday') {
    return buildDayRangeParams(-1)
  }

  if (timeFilterMode.value === 'custom' && customDateRange.value.length === 2) {
    const [startDate, endDate] = customDateRange.value
    return {
      updatedAtStart: toSqliteDateTime(startOfDay(startDate)),
      updatedAtEnd: toSqliteDateTime(addDays(startOfDay(endDate), 1))
    }
  }

  return {}
}

function buildDayRangeParams(offset: number) {
  const start = startOfDay(addDays(now.value, offset))
  return {
    updatedAtStart: toSqliteDateTime(start),
    updatedAtEnd: toSqliteDateTime(addDays(start, 1))
  }
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toSqliteDateTime(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function formatMonthDay(date: Date) {
  return `${date.getMonth() + 1}.${date.getDate()}`
}

function disableFutureDate(date: Date) {
  return startOfDay(date).getTime() > startOfDay(now.value).getTime()
}
</script>

<style lang="scss">
.interview-candidate-list__wrap {
  padding: 16px;

  .filter-card {
    margin-bottom: 16px;

    .time-filter-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .stats-row {
    margin-bottom: 16px;

    .stats-card {
      cursor: pointer;
      text-align: center;
      transition: all 0.3s;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .stats-value {
        font-size: 28px;
        font-weight: bold;
        color: #409eff;
      }

      .stats-label {
        font-size: 12px;
        color: #909399;
        margin-top: 4px;
      }
    }
  }

  .text-success {
    color: #67c23a;
  }

  .text-danger {
    color: #f56c6c;
  }

  // 下拉菜单样式
  .qa-dropdown-item {
    padding: 4px 0;
    min-width: 300px;
    font-size: 13px;
    line-height: 1.6;

    .qa-round-label {
      font-weight: bold;
      color: #409eff;
      margin-bottom: 4px;
    }

    .qa-question,
    .qa-answer {
      color: #606266;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .qa-score {
      margin-top: 4px;
      color: #909399;
    }
  }
}
</style>
