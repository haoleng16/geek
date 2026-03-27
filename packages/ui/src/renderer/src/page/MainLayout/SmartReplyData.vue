<template>
  <div class="smart-reply-data__wrap">
    <!-- 筛选区域 -->
    <div class="filter-section">
      <el-form :inline="true">
        <el-form-item label="会话ID">
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
        <el-form-item label="姓名">
          <el-input
            v-model="filters.geekName"
            placeholder="候选人姓名"
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 数据表格 -->
    <el-table
      :data="tableData"
      v-loading="loading"
      stripe
      style="width: 100%"
    >
      <el-table-column prop="geekName" label="姓名" width="120" />
      <el-table-column prop="jobName" label="应聘岗位" width="150" />
      <el-table-column prop="degree" label="学历" width="100" />
      <el-table-column prop="workYears" label="工作经验" width="100">
        <template #default="{ row }">
          {{ row.workYears ? `${row.workYears}年` : '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="replyCount" label="回复次数" width="100">
        <template #default="{ row }">
          <el-tag :type="row.replyCount >= 3 ? 'danger' : 'success'">
            {{ row.replyCount }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="lastLlmReply" label="最后一次回复" min-width="200">
        <template #default="{ row }">
          <el-tooltip :content="row.lastLlmReply" placement="top" :disabled="!row.lastLlmReply || row.lastLlmReply.length <= 30">
            <span class="reply-preview">
              {{ row.lastLlmReply ? (row.lastLlmReply.length > 30 ? row.lastLlmReply.substring(0, 30) + '...' : row.lastLlmReply) : '-' }}
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="lastReplyAt" label="最后回复时间" width="180">
        <template #default="{ row }">
          {{ formatTime(row.lastReplyAt) }}
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatTime(row.createdAt) }}
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-wrap">
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

interface SmartReplyRecord {
  id: number
  sessionId: string
  encryptGeekId: string
  geekName: string
  encryptJobId: string
  jobName: string
  degree: string
  workYears: number
  replyCount: number
  lastLlmReply: string
  conversationHistory: string
  firstReplyAt: string
  lastReplyAt: string
  createdAt: string
  updatedAt: string
}

interface Session {
  sessionId: string
  sessionName: string
  count: number
}

const loading = ref(false)
const tableData = ref<SmartReplyRecord[]>([])
const sessions = ref<Session[]>([])

const filters = reactive({
  sessionId: '',
  geekName: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

// 格式化时间
const formatTime = (time: string) => {
  if (!time) return '-'
  try {
    const date = new Date(time)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return time
  }
}

// 获取会话列表
const fetchSessions = async () => {
  try {
    const result = await electron.ipcRenderer.invoke('get-smart-reply-sessions')
    sessions.value = result || []
  } catch (err) {
    console.error('获取会话列表失败:', err)
  }
}

// 获取数据
const fetchData = async () => {
  loading.value = true
  try {
    const result = await electron.ipcRenderer.invoke('get-smart-reply-records', {
      sessionId: filters.sessionId,
      geekName: filters.geekName,
      page: pagination.page,
      pageSize: pagination.pageSize
    })

    tableData.value = result?.data || []
    pagination.total = result?.total || 0
  } catch (err) {
    console.error('获取数据失败:', err)
    ElMessage.error('获取数据失败')
  } finally {
    loading.value = false
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
  filters.geekName = ''
  pagination.page = 1
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
})
</script>

<style lang="scss">
.smart-reply-data__wrap {
  padding: 20px;

  .filter-section {
    margin-bottom: 20px;
    background: #fff;
    padding: 16px;
    border-radius: 4px;
  }

  .reply-preview {
    color: #606266;
  }

  .pagination-wrap {
    margin-top: 20px;
    display: flex;
    justify-content: flex-end;
  }
}
</style>