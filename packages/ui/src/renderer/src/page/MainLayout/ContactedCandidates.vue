<template>
  <div class="page-wrap flex flex-col of-hidden">
    <div class="page-header">
      <h3>已回复联系人</h3>
      <div class="header-actions">
        <span class="stat-item">共 {{ pagination.totalItemCount }} 人</span>
        <ElButton size="small" @click="getCandidateList" :loading="isTableLoading">刷新</ElButton>
      </div>
    </div>

    <div v-loading="isTableLoading" class="flex-1 of-hidden">
      <div ref="tableContainerEl" class="h-100% of-hidden">
        <ElTable
          ref="tableRef"
          :max-height="tableMaxHeight"
          :data="tableData"
          row-key="id"
          size="small"
          table-layout="auto"
          highlight-current-row
        >
          <ElTableColumn prop="geekName" label="姓名" width="100" />
          <ElTableColumn prop="companyName" label="当前公司" min-width="120" />
          <ElTableColumn prop="position" label="当前职位" min-width="120" />
          <ElTableColumn prop="jobName" label="应聘职位" min-width="120" />
          <ElTableColumn prop="salary" label="期望薪资" width="100" />
          <ElTableColumn prop="city" label="城市" width="80" />
          <ElTableColumn prop="degree" label="学历" width="80" />
          <ElTableColumn
            label="工作年限"
            width="90"
            :formatter="(row) => row.workYears ? `${row.workYears}年` : '-'"
          />
          <ElTableColumn
            label="回复次数"
            width="90"
            prop="replyCount"
          />
          <ElTableColumn
            label="首次联系"
            width="120"
            :formatter="(row) => formatDate(row.firstContactAt)"
          />
          <ElTableColumn
            label="最后回复"
            width="120"
            :formatter="(row) => formatDate(row.lastReplyAt)"
          />
          <ElTableColumn label="操作" fixed="right" width="80">
            <template #default="{ row }">
              <ElButton
                link
                type="danger"
                size="small"
                @click="handleDelete(row)"
              >删除</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </div>

    <div class="flex flex-0 flex-justify-between pt10px pb10px">
      <div class="flex items-center gap-10px">
        <ElInput
          v-model="searchGeekName"
          placeholder="搜索姓名"
          size="small"
          clearable
          style="width: 150px"
          @keyup.enter="handleSearch"
        />
        <ElButton
          :loading="isTableLoading"
          size="small"
          @click="handleSearch"
        >搜索</ElButton>
      </div>
      <ElPagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :page-sizes="[20, 50, 100]"
        small
        :disabled="isTableLoading"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pagination.totalItemCount"
        @size-change="getCandidateList"
        @current-change="getCandidateList"
      />
      <div class="w100px" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, onActivated } from 'vue'
import { ElTable, ElTableColumn, ElButton, ElPagination, ElInput, ElMessage, ElMessageBox } from 'element-plus'

interface ContactedCandidate {
  id: number
  encryptGeekId: string
  encryptJobId: string
  jobName: string
  geekName: string
  companyName: string
  position: string
  salary: string
  city: string
  degree: string
  workYears: number
  avatarUrl: string
  replyCount: number
  lastReplyAt: Date
  firstContactAt: Date
  createdAt: Date
  updatedAt: Date
}

const tableData = ref<ContactedCandidate[]>([])
const searchGeekName = ref('')
const pagination = ref({
  page: 1,
  pageSize: 20,
  totalItemCount: 0
})
const tableRef = ref<InstanceType<typeof ElTable>>()
const isTableLoading = ref(false)

async function getCandidateList() {
  try {
    isTableLoading.value = true
    const { data: res } = await electron.ipcRenderer.invoke('recruiter-get-contacted-candidates', {
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
      geekName: searchGeekName.value || undefined
    })
    tableData.value = res?.data || []
    pagination.value = {
      ...pagination.value,
      totalItemCount: res?.total || 0
    }
  } catch (err) {
    console.error(err)
    tableData.value = []
  } finally {
    tableRef.value?.setScrollTop(0)
    isTableLoading.value = false
  }
}

function handleSearch() {
  pagination.value.page = 1
  getCandidateList()
}

async function handleDelete(row: ContactedCandidate) {
  try {
    await ElMessageBox.confirm(`确定删除联系人「${row.geekName || '未知'}」的记录吗？`, '提示', {
      type: 'warning'
    })
    await electron.ipcRenderer.invoke('recruiter-delete-contacted-candidate', row.id)
    ElMessage.success('删除成功')
    await getCandidateList()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

function formatDate(date: Date | string): string {
  if (!date) return '-'
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const tableMaxHeight = ref<number | undefined>(undefined)
const tableContainerEl = ref<HTMLElement>()

const setTableMaxHeight = () => {
  tableMaxHeight.value = tableContainerEl.value?.clientHeight ?? undefined
}

onMounted(() => {
  getCandidateList()
  setTableMaxHeight()
  const ro = new ResizeObserver(() => setTableMaxHeight())
  ro.observe(tableContainerEl.value!)
  onBeforeUnmount(() => {
    ro.disconnect()
  })
})

// 页面激活时自动刷新数据
onActivated(() => {
  getCandidateList()
})
</script>

<style scoped lang="scss">
.page-wrap {
  margin: 0 auto;
  max-width: 1200px;
  max-height: 100vh;
  overflow: hidden;
  padding-left: 20px;
  padding-top: 10px;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding-right: 20px;

    h3 {
      margin: 0;
      font-size: 16px;
      color: #303133;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 15px;

      .stat-item {
        font-size: 14px;
        color: #909399;
      }
    }
  }
}
</style>