<template>
  <div class="recommend-talent-data__wrap">
    <!-- 筛选区域 -->
    <div class="filter-section">
      <el-form :inline="true">
        <el-form-item label="会话">
          <el-select
            v-model="filters.sessionId"
            placeholder="选择会话"
            clearable
            @change="handleSearch"
          >
            <el-option
              v-for="s in sessions"
              :key="s.sessionId"
              :label="s.sessionName"
              :value="s.sessionId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="岗位">
          <el-select
            v-model="filters.jobName"
            placeholder="选择岗位"
            clearable
            @change="handleSearch"
          >
            <el-option v-for="j in jobOptions" :key="j" :label="j" :value="j" />
          </el-select>
        </el-form-item>
        <el-form-item label="评分范围">
          <el-slider
            v-model="filters.scoreRange"
            range
            :min="0"
            :max="10"
            :step="0.5"
            style="width: 200px"
            @change="handleSearch"
          />
        </el-form-item>
        <el-form-item label="仅推荐">
          <el-switch v-model="filters.recommendOnly" @change="handleSearch" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input
            v-model="filters.name"
            placeholder="候选人姓名"
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button @click="handleRefresh">刷新</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-section">
      <div class="stat-card">
        <div class="stat-value">{{ stats.analyzedCount }}</div>
        <div class="stat-label">已分析</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-value--success">{{ stats.matchedCount }}</div>
        <div class="stat-label">已匹配</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-value--primary">{{ stats.collectedCount }}</div>
        <div class="stat-label">已收藏</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.avgScore }}</div>
        <div class="stat-label">平均评分</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.preFilterPassRate }}%</div>
        <div class="stat-label">预筛通过率</div>
      </div>
    </div>

    <!-- 空数据提示 -->
    <el-empty
      v-if="!loading && tableData.length === 0"
      description="暂无数据，请先运行推荐人才功能"
    />

    <!-- 数据表格 -->
    <el-table v-else :data="tableData" v-loading="loading" stripe style="width: 100%">
      <el-table-column prop="name" label="姓名" width="100" />
      <el-table-column prop="degree" label="学历" width="80" />
      <el-table-column prop="workYears" label="工作年限" width="90">
        <template #default="{ row }">
          {{ row.workYears ? `${row.workYears}年` : '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="expectedSalary" label="期望薪资" width="110">
        <template #default="{ row }">
          {{ row.expectedSalary || '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="score" label="综合评分" width="100">
        <template #default="{ row }">
          <span
            v-if="row.score != null"
            class="score-value"
            :style="{ color: getScoreColor(row.score) }"
          >
            {{ row.score }}
          </span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="是否推荐" width="90">
        <template #default="{ row }">
          <el-tag :type="row.recommended ? 'success' : 'info'" size="small">
            {{ row.recommended ? '推荐' : '不推荐' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="是否已收藏" width="100">
        <template #default="{ row }">
          <el-tag :type="row.collected ? 'success' : 'warning'" size="small">
            {{ row.collected ? '已收藏' : '未收藏' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="handleViewDetail(row)"
            >查看详情</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div v-if="tableData.length > 0" class="pagination-wrap">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 详情抽屉 -->
    <el-drawer v-model="drawerVisible" title="候选人详情" size="520px">
      <div v-if="currentCandidate" class="detail-content">
        <!-- 基本信息 -->
        <div class="detail-section">
          <h4>基本信息</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">姓名：</span>
              <span>{{ currentCandidate.name || '-' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">学历：</span>
              <span>{{ currentCandidate.degree || '-' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">工作年限：</span>
              <span>{{
                currentCandidate.workYears ? `${currentCandidate.workYears}年` : '-'
              }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">期望薪资：</span>
              <span>{{ currentCandidate.expectedSalary || '-' }}</span>
            </div>
          </div>
        </div>

        <!-- 综合评分 -->
        <div class="detail-section">
          <h4>综合评分</h4>
          <div class="score-display">
            <span class="score-big" :style="{ color: getScoreColor(currentCandidate.score) }">
              {{ currentCandidate.score != null ? currentCandidate.score : '-' }}
            </span>
            <el-tag
              :type="currentCandidate.recommended ? 'success' : 'danger'"
              style="margin-left: 12px"
            >
              {{ currentCandidate.recommended ? '推荐' : '不推荐' }}
            </el-tag>
            <el-tag
              :type="currentCandidate.collected ? 'success' : 'warning'"
              style="margin-left: 8px"
            >
              {{ currentCandidate.collected ? '已收藏' : '未收藏' }}
            </el-tag>
          </div>
        </div>

        <div class="detail-section">
          <h4>筛选结论</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">预筛结果：</span>
              <span>{{ currentCandidate.preFilterPassed ? '通过' : '未通过' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">结论说明：</span>
              <span>{{ currentCandidate.conclusion || '-' }}</span>
            </div>
          </div>
        </div>

        <!-- 评分明细 -->
        <div v-if="currentCandidate.scoreBreakdown" class="detail-section">
          <h4>评分明细</h4>
          <div class="score-breakdown">
            <div
              v-for="(item, idx) in currentCandidate.scoreBreakdown"
              :key="idx"
              class="score-breakdown-item"
            >
              <span class="breakdown-label">{{ item.label }}</span>
              <el-progress
                :percentage="item.percentage"
                :color="getScoreColor(item.score)"
                :stroke-width="16"
                :text-inside="true"
                :format="() => `${item.score}`"
              />
            </div>
          </div>
        </div>

        <!-- 优势 -->
        <div
          v-if="currentCandidate.strengths && currentCandidate.strengths.length > 0"
          class="detail-section"
        >
          <h4>优势</h4>
          <ul class="detail-list">
            <li v-for="(s, idx) in currentCandidate.strengths" :key="idx">{{ s }}</li>
          </ul>
        </div>

        <!-- 顾虑 -->
        <div
          v-if="currentCandidate.concerns && currentCandidate.concerns.length > 0"
          class="detail-section"
        >
          <h4>顾虑</h4>
          <ul class="detail-list detail-list--warning">
            <li v-for="(c, idx) in currentCandidate.concerns" :key="idx">{{ c }}</li>
          </ul>
        </div>

        <!-- VL 原始响应 -->
        <div v-if="currentCandidate.vlRawResponse" class="detail-section">
          <h4>VL 原始分析</h4>
          <pre class="raw-response">{{ currentCandidate.vlRawResponse }}</pre>
        </div>

        <div v-if="currentCandidate.domText" class="detail-section">
          <h4>简历文本</h4>
          <pre class="raw-response">{{ currentCandidate.domText }}</pre>
        </div>

        <!-- 截图预览 -->
        <div class="detail-section">
          <h4>截图预览</h4>
          <img
            v-if="currentCandidate.snapshotData"
            :src="currentCandidate.snapshotData"
            class="snapshot-preview"
            alt="候选人截图"
          />
          <div v-else class="snapshot-empty">
            {{ currentCandidate.snapshotMissingReason || '暂无截图' }}
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

interface Candidate {
  id: number
  sessionId: string
  name: string
  degree: string
  workYears: number
  expectedSalary: string
  score: number | null
  recommended: boolean
  collected: boolean
  jobName: string
  scoreBreakdown: Array<{ label: string; score: number; percentage: number }>
  strengths: string[]
  concerns: string[]
  vlRawResponse: string
  domText: string
  snapshotData: string
  conclusion: string
  preFilterPassed: boolean
  preFilterFailReason: string
  snapshotMissingReason: string
  createdAt: string
  updatedAt: string
}

interface Session {
  sessionId: string
  sessionName: string
  count: number
}

const normalizeCandidate = (raw: any): Candidate => ({
  id: raw?.id,
  sessionId: raw?.sessionId || '',
  name: raw?.name || raw?.geekName || '',
  degree: raw?.degree || '',
  workYears: Number(raw?.workYears || 0),
  expectedSalary: raw?.expectedSalary || '',
  score: raw?.score ?? raw?.totalScore ?? null,
  recommended: Boolean(raw?.recommended ?? raw?.recommend),
  collected: Boolean(raw?.collected ?? raw?.isCollected),
  jobName: raw?.jobName || '',
  scoreBreakdown: [
    {
      label: '工作经历匹配度',
      score: Number(raw?.workMatchScore || 0),
      percentage: Number(raw?.workMatchScore || 0) * 10
    },
    {
      label: '技能匹配度',
      score: Number(raw?.skillMatchScore || 0),
      percentage: Number(raw?.skillMatchScore || 0) * 10
    },
    {
      label: '项目经验质量',
      score: Number(raw?.projectQualityScore || 0),
      percentage: Number(raw?.projectQualityScore || 0) * 10
    },
    {
      label: '综合素质',
      score: Number(raw?.overallQualityScore || 0),
      percentage: Number(raw?.overallQualityScore || 0) * 10
    }
  ],
  strengths: (() => {
    try {
      return Array.isArray(raw?.strengths) ? raw.strengths : JSON.parse(raw?.keyStrengths || '[]')
    } catch {
      return []
    }
  })(),
  concerns: (() => {
    try {
      return Array.isArray(raw?.concerns) ? raw.concerns : JSON.parse(raw?.concerns || '[]')
    } catch {
      return []
    }
  })(),
  vlRawResponse: raw?.vlRawResponse || '',
  domText: raw?.domText || '',
  snapshotData: raw?.snapshotDataUrl || raw?.snapshotData || '',
  conclusion: raw?.reason || raw?.preFilterFailReason || '',
  preFilterPassed: raw?.preFilterPassed !== false,
  preFilterFailReason: raw?.preFilterFailReason || '',
  snapshotMissingReason:
    raw?.preFilterPassed === false
      ? `未生成截图：预筛未通过（${raw?.preFilterFailReason || '未提供原因'}）`
      : raw?.reason
        ? `未生成截图：${raw.reason}`
        : '未生成截图：未拉取到在线简历快照',
  createdAt: raw?.createdAt || '',
  updatedAt: raw?.updatedAt || ''
})

function getScoreColor(score: number) {
  if (score >= 8) return '#67C23A'
  if (score >= 7) return '#409EFF'
  if (score >= 5) return '#E6A23C'
  return '#F56C6C'
}

const loading = ref(false)
const tableData = ref<Candidate[]>([])
const sessions = ref<Session[]>([])
const jobOptions = ref<string[]>([])
const drawerVisible = ref(false)
const currentCandidate = ref<Candidate | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | null = null

const filters = reactive({
  sessionId: '',
  jobName: '',
  scoreRange: [0, 10] as number[],
  recommendOnly: false,
  name: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const stats = reactive({
  analyzedCount: 0,
  matchedCount: 0,
  collectedCount: 0,
  avgScore: '-',
  preFilterPassRate: '-'
})

// 获取会话列表
const fetchSessions = async () => {
  try {
    const sessionsRes = await electron.ipcRenderer.invoke('recommend-get-sessions')
    const res = sessionsRes?.data ?? sessionsRes
    sessions.value = res || []
    // 提取岗位选项
    const jobSet = new Set<string>()
    sessions.value.forEach((s: any) => {
      if (s.jobName) jobSet.add(s.jobName)
    })
    jobOptions.value = Array.from(jobSet)
  } catch (err) {
    console.error('获取会话列表失败:', err)
  }
}

// 获取数据
const fetchData = async () => {
  loading.value = true
  try {
    const minScore = filters.scoreRange[0] > 0 ? filters.scoreRange[0] : undefined
    const maxScore = filters.scoreRange[1] < 10 ? filters.scoreRange[1] : undefined
    const response = await electron.ipcRenderer.invoke('recommend-get-candidates', {
      sessionId: filters.sessionId,
      minScore,
      maxScore,
      recommendOnly: filters.recommendOnly,
      geekName: filters.name,
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    const res = Array.isArray(response)
      ? { data: response, total: response.length }
      : response && Array.isArray(response.data)
        ? response
        : { data: [], total: 0 }

    tableData.value = (res?.data || []).map((item: any) => normalizeCandidate(item))
    pagination.total = res?.total || 0
    const analyzedCount = tableData.value.length
    const matchedRows = tableData.value.filter((item) => item.recommended)
    const collectedRows = tableData.value.filter((item) => item.collected)
    const scoredRows = tableData.value.filter((item) => item.score != null)
    const preFilterPassRows = Array.isArray(res?.data)
      ? res.data.filter((item: any) => item.preFilterPassed !== false)
      : []

    stats.analyzedCount = analyzedCount
    stats.matchedCount = matchedRows.length
    stats.collectedCount = collectedRows.length
    stats.avgScore =
      scoredRows.length > 0
        ? (
            scoredRows.reduce((sum, item) => sum + Number(item.score || 0), 0) / scoredRows.length
          ).toFixed(1)
        : '-'
    stats.preFilterPassRate =
      analyzedCount > 0 ? ((preFilterPassRows.length / analyzedCount) * 100).toFixed(1) : '-'
  } catch (err) {
    console.error('获取数据失败:', err)
    ElMessage.error('获取数据失败')
  } finally {
    loading.value = false
  }
}

// 查看详情
const handleViewDetail = async (row: Candidate) => {
  try {
    const candidateRes = await electron.ipcRenderer.invoke('recommend-get-candidate-by-id', {
      id: row.id
    })
    const res = candidateRes?.data ?? candidateRes
    currentCandidate.value = res ? normalizeCandidate(res) : row
    // 加载截图
    if (currentCandidate.value && currentCandidate.value.id) {
      try {
        const snapshotResponse = await electron.ipcRenderer.invoke('recommend-get-snapshot', {
          candidateId: currentCandidate.value.id
        })
        const snapshotRes = snapshotResponse?.data ?? snapshotResponse
        if (snapshotRes) {
          currentCandidate.value.snapshotData = snapshotRes.snapshotDataUrl || ''
          currentCandidate.value.vlRawResponse =
            snapshotRes.vlRawResponse || currentCandidate.value.vlRawResponse
          currentCandidate.value.domText = snapshotRes.domText || currentCandidate.value.domText
        }
      } catch {
        // 截图加载失败不影响详情展示
      }
    }
    drawerVisible.value = true
  } catch (err) {
    console.error('获取候选人详情失败:', err)
    ElMessage.error('获取详情失败')
  }
}

// 搜索
const handleSearch = () => {
  pagination.page = 1
  fetchData()
}

// 重置
const handleReset = () => {
  filters.sessionId = ''
  filters.jobName = ''
  filters.scoreRange = [0, 10]
  filters.recommendOnly = false
  filters.name = ''
  pagination.page = 1
  fetchData()
}

// 手动刷新
const handleRefresh = () => {
  fetchSessions()
  fetchData()
}

// 分页大小改变
const handleSizeChange = () => {
  pagination.page = 1
  fetchData()
}

// 页码改变
const handlePageChange = () => {
  fetchData()
}

// 初始化
onMounted(() => {
  fetchSessions()
  fetchData()
  // 每5秒自动刷新数据
  refreshTimer = setInterval(() => {
    fetchData()
    fetchSessions()
  }, 5000)
})

// 清理定时器
onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})
</script>

<style lang="scss">
.recommend-talent-data__wrap {
  padding: 20px;

  .filter-section {
    margin-bottom: 20px;
    background: #fff;
    padding: 16px;
    border-radius: 4px;
  }

  .stats-section {
    display: flex;
    gap: 16px;
    margin-bottom: 20px;

    .stat-card {
      flex: 1;
      background: #fff;
      padding: 16px;
      border-radius: 4px;
      text-align: center;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);

      .stat-value {
        font-size: 28px;
        font-weight: 600;
        color: #303133;

        &--success {
          color: #67c23a;
        }

        &--primary {
          color: #409eff;
        }
      }

      .stat-label {
        font-size: 13px;
        color: #909399;
        margin-top: 4px;
      }
    }
  }

  .score-value {
    font-weight: 600;
    font-size: 14px;
  }

  .pagination-wrap {
    margin-top: 20px;
    display: flex;
    justify-content: flex-end;
  }

  .detail-content {
    .detail-section {
      margin-bottom: 24px;

      h4 {
        margin: 0 0 12px 0;
        font-size: 15px;
        color: #303133;
        border-bottom: 1px solid #ebeef5;
        padding-bottom: 8px;
      }
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;

      .detail-item {
        font-size: 13px;
        color: #606266;

        .detail-label {
          color: #909399;
        }
      }
    }

    .score-display {
      display: flex;
      align-items: center;

      .score-big {
        font-size: 36px;
        font-weight: 700;
      }
    }

    .score-breakdown {
      .score-breakdown-item {
        display: flex;
        align-items: center;
        margin-bottom: 8px;

        .breakdown-label {
          width: 100px;
          font-size: 13px;
          color: #606266;
          flex-shrink: 0;
        }

        .el-progress {
          flex: 1;
        }
      }
    }

    .detail-list {
      margin: 0;
      padding-left: 20px;
      font-size: 13px;
      color: #606266;

      li {
        margin-bottom: 4px;
      }

      &--warning {
        color: #e6a23c;
      }
    }

    .raw-response {
      background: #f5f7fa;
      padding: 12px;
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 300px;
      overflow-y: auto;
      margin: 0;
    }

    .snapshot-preview {
      max-width: 100%;
      border-radius: 4px;
      border: 1px solid #ebeef5;
    }

    .snapshot-empty {
      font-size: 13px;
      color: #909399;
      padding: 12px 0;
    }
  }
}
</style>
