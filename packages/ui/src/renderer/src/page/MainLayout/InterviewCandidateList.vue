<template>
  <div class="interview-candidate-list__wrap">
    <!-- 筛选区域 -->
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="filterForm">
        <el-form-item label="状态">
          <el-select v-model="filterForm.status" placeholder="全部状态" clearable @change="handleFilterChange">
            <el-option label="新候选人" value="new" />
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
        <el-form-item>
          <el-button type="primary" @click="handleFilterChange">刷新</el-button>
          <el-button @click="handleExportExcel">导出Excel</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stats-row">
      <el-col :span="4" v-for="(count, status) in statusStats" :key="status">
        <el-card shadow="never" class="stats-card" @click="handleStatsClick(status)">
          <div class="stats-value">{{ count }}</div>
          <div class="stats-label">{{ getStatusLabel(status as string) }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 候选人列表 -->
    <el-card shadow="never" class="table-card">
      <el-table
        :data="candidateList"
        style="width: 100%"
        v-loading="loading"
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
            <span v-if="row.totalScore" :class="{ 'text-success': row.totalScore >= 60, 'text-danger': row.totalScore < 60 }">
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
            <el-dropdown trigger="click" @command="(cmd) => handleDropdownClick(cmd, row)" placement="bottom-start">
              <el-button type="primary" link size="small">
                查看<el-icon class="el-icon--right"><arrow-down /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <template v-if="row.qaRecords && row.qaRecords.length > 0">
                    <el-dropdown-item v-for="qa in row.qaRecords" :key="qa.id" :command="'detail'" disabled>
                      <div class="qa-dropdown-item">
                        <div class="qa-round-label">第{{ qa.roundNumber }}轮</div>
                        <div class="qa-question"><strong>问：</strong>{{ truncateText(qa.questionText, 50) }}</div>
                        <div class="qa-answer"><strong>答：</strong>{{ truncateText(qa.answerText, 50) }}</div>
                        <div class="qa-score" v-if="qa.totalScore">
                          <strong>得分：</strong>
                          <span :class="{ 'text-success': qa.totalScore >= 60, 'text-danger': qa.totalScore < 60 }">
                            {{ qa.totalScore }}分
                          </span>
                        </div>
                      </div>
                    </el-dropdown-item>
                  </template>
                  <el-dropdown-item v-else disabled>
                    <span style="color: #909399;">暂无问答记录</span>
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
        @size-change="loadCandidates"
        @current-change="loadCandidates"
        style="margin-top: 16px; justify-content: flex-end"
      />
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailDialogVisible" title="候选人详情" width="700px" destroy-on-close>
      <template v-if="currentCandidate">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ currentCandidate.geekName }}</el-descriptions-item>
          <el-descriptions-item label="学历">{{ currentCandidate.education || '--' }}</el-descriptions-item>
          <el-descriptions-item label="应聘岗位">{{ currentCandidate.jobName }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusTagType(currentCandidate.status)">
              {{ getStatusLabel(currentCandidate.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前轮次">
            {{ currentCandidate.currentRound > 0 ? `第${currentCandidate.currentRound}轮` : '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="总得分">
            <span :class="{ 'text-success': currentCandidate.totalScore >= 60, 'text-danger': currentCandidate.totalScore < 60 }">
              {{ currentCandidate.totalScore || '-' }}分
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="毕业院校" v-if="currentCandidate.school">{{ currentCandidate.school }}</el-descriptions-item>
          <el-descriptions-item label="专业" v-if="currentCandidate.major">{{ currentCandidate.major }}</el-descriptions-item>
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
              <p v-if="qa.keywordScore || qa.llmScore">
                <strong>评分：</strong>
                关键词 {{ qa.keywordScore || 0 }}分 +
                AI {{ qa.llmScore || 0 }}分
              </p>
              <p v-if="qa.llmReason"><strong>AI理由：</strong>{{ qa.llmReason }}</p>
            </el-card>
          </el-timeline-item>
        </el-timeline>

        <el-empty v-else description="暂无问答记录" />
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'

const loading = ref(false)
const candidateList = ref<any[]>([])
const statusStats = ref<Record<string, number>>({})
const detailDialogVisible = ref(false)
const currentCandidate = ref<any>(null)
const qaRecords = ref<any[]>([])

const filterForm = reactive({
  status: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

onMounted(() => {
  loadCandidates()
  loadStats()
})

async function loadCandidates() {
  loading.value = true
  try {
    const result = await electron.ipcRenderer.invoke('interview-get-candidates', {
      status: filterForm.status || undefined,
      page: pagination.page,
      pageSize: pagination.pageSize
    })

    if (result.success) {
      // 获取候选人列表
      const candidates = result.data.list || []
      pagination.total = result.data.total || 0

      // 为每个候选人获取问答记录（用于下拉显示）
      const candidatesWithQa = await Promise.all(candidates.map(async (candidate) => {
        try {
          const detailResult = await electron.ipcRenderer.invoke('interview-get-candidate-detail', candidate.id)
          if (detailResult.success) {
            return {
              ...candidate,
              qaRecords: detailResult.data.qaRecords || []
            }
          }
          return { ...candidate, qaRecords: [] }
        } catch {
          return { ...candidate, qaRecords: [] }
        }
      }))

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
    const result = await electron.ipcRenderer.invoke('interview-get-candidate-stats')
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

async function handleViewDetail(row: any) {
  try {
    const result = await electron.ipcRenderer.invoke('interview-get-candidate-detail', row.id)
    if (result.success) {
      currentCandidate.value = result.data.candidate
      qaRecords.value = result.data.qaRecords || []
      detailDialogVisible.value = true
    }
  } catch (error) {
    console.error('加载候选人详情失败:', error)
  }
}

function handleRowClick(row: any) {
  handleViewDetail(row)
}

function handleStatsClick(status: string) {
  filterForm.status = status
  handleFilterChange()
}

async function handleExportExcel() {
  try {
    const result = await electron.ipcRenderer.invoke('interview-export-candidates-excel', {
      status: filterForm.status || undefined
    })
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

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: '新候选人',
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
    new: 'info',
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

function handleDropdownClick(command: string, row: any) {
  if (command === 'fullDetail') {
    handleViewDetail(row)
  }
}
</script>

<style lang="scss">
.interview-candidate-list__wrap {
  padding: 16px;

  .filter-card {
    margin-bottom: 16px;
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
