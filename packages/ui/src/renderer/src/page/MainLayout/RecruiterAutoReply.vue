<template>
  <div class="recruiter-auto-reply__wrap">
    <div class="form-wrap">
      <el-form ref="formRef" :model="formContent" label-width="160px">
        <!-- 基础设置 -->
        <el-collapse v-model="activeCollapse">
          <el-collapse-item title="基础设置" name="basic">
            <el-form-item label="聊天页URL">
              <el-input
                v-model="formContent.recruiterAutoReply.chatUiUrl"
                placeholder="留空使用默认值"
              />
            </el-form-item>
            <el-form-item label="扫描间隔(秒)">
              <el-input-number
                v-model="formContent.recruiterAutoReply.scanIntervalSeconds"
                :min="1"
                :max="60"
              />
            </el-form-item>
            <el-form-item label="自动发送">
              <el-switch v-model="formContent.recruiterAutoReply.autoSend" />
            </el-form-item>
            <el-form-item label="发送前确认">
              <el-switch
                v-model="formContent.recruiterAutoReply.confirmBeforeSend"
                :disabled="formContent.recruiterAutoReply.autoSend"
              />
            </el-form-item>
          </el-collapse-item>

          <!-- 候选人筛选 -->
          <el-collapse-item title="候选人筛选" name="filter">
            <el-form-item label="启用筛选">
              <el-switch v-model="formContent.candidateFilter.enabled" />
            </el-form-item>

            <template v-if="formContent.candidateFilter.enabled">
              <el-form-item label="学历要求">
                <el-checkbox-group v-model="formContent.candidateFilter.degreeList">
                  <el-checkbox label="大专">大专</el-checkbox>
                  <el-checkbox label="本科">本科</el-checkbox>
                  <el-checkbox label="硕士">硕士</el-checkbox>
                  <el-checkbox label="博士">博士</el-checkbox>
                </el-checkbox-group>
              </el-form-item>

              <el-form-item label="工作年限">
                <div class="work-years-range">
                  <el-input-number
                    v-model="formContent.candidateFilter.minWorkYears"
                    :min="0"
                    :max="30"
                    placeholder="最小"
                  />
                  <span class="separator">-</span>
                  <el-input-number
                    v-model="formContent.candidateFilter.maxWorkYears"
                    :min="0"
                    :max="30"
                    placeholder="最大"
                  />
                  <span>年</span>
                </div>
              </el-form-item>

              <el-form-item label="期望职位关键词">
                <el-select
                  v-model="formContent.candidateFilter.expectJobKeywords"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="输入关键词后回车添加"
                >
                </el-select>
              </el-form-item>

              <el-form-item label="技能关键词">
                <el-select
                  v-model="formContent.candidateFilter.skillKeywords"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="输入关键词后回车添加"
                >
                </el-select>
              </el-form-item>

              <el-form-item label="屏蔽关键词">
                <el-select
                  v-model="formContent.candidateFilter.blockKeywords"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="包含这些关键词的简历将被排除"
                >
                </el-select>
              </el-form-item>
            </template>
          </el-collapse-item>

          <!-- 快捷回复列表 -->
          <el-collapse-item title="快捷回复列表" name="quickReply">
            <div class="quick-reply-list">
              <div
                v-for="(item, index) in formContent.quickReply.list"
                :key="item.id"
                class="quick-reply-item"
              >
                <div class="quick-reply-header">
                  <el-input
                    v-model="item.name"
                    placeholder="回复名称"
                    class="name-input"
                  />
                  <el-switch v-model="item.enabled" />
                  <el-button
                    type="danger"
                    text
                    @click="removeQuickReply(index)"
                  >
                    删除
                  </el-button>
                </div>
                <el-input
                  v-model="item.content"
                  type="textarea"
                  :rows="2"
                  placeholder="回复内容"
                />
              </div>

              <el-button
                type="primary"
                plain
                @click="addQuickReply"
                class="add-reply-btn"
              >
                + 添加快捷回复
              </el-button>
            </div>
          </el-collapse-item>

          <!-- 回复策略 -->
          <el-collapse-item title="回复策略" name="strategy">
            <el-form-item label="匹配时回复">
              <el-radio-group v-model="formContent.replyStrategy.matchReplyMode">
                <el-radio label="constant">固定内容</el-radio>
                <el-radio label="first_quick_reply">第一条快捷回复</el-radio>
                <el-radio label="random_quick_reply">随机快捷回复</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item
              v-if="formContent.replyStrategy.matchReplyMode === 'constant'"
              label="回复内容"
            >
              <el-input
                v-model="formContent.replyStrategy.matchReplyContent"
                type="textarea"
                :rows="3"
                placeholder="匹配成功时发送的内容"
              />
            </el-form-item>

            <el-divider />

            <el-form-item label="不匹配时操作">
              <el-radio-group v-model="formContent.replyStrategy.notMatchAction">
                <el-radio label="skip">跳过</el-radio>
                <el-radio label="mark_not_suitable">标记不合适</el-radio>
                <el-radio label="reply">回复后跳过</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item
              v-if="formContent.replyStrategy.notMatchAction === 'reply'"
              label="不匹配回复内容"
            >
              <el-input
                v-model="formContent.replyStrategy.notMatchReplyContent"
                type="textarea"
                :rows="2"
                placeholder="不匹配时发送的内容"
              />
            </el-form-item>
          </el-collapse-item>
        </el-collapse>

        <!-- 一键发送区域 -->
        <div class="quick-send-section">
          <el-divider content-position="left">一键发送</el-divider>
          <div class="quick-send-buttons">
            <el-button
              v-for="item in enabledQuickReplyList"
              :key="item.id"
              type="primary"
              plain
              @click="handleQuickSend(item)"
            >
              {{ item.name }}
            </el-button>
          </div>
          <p class="quick-send-tip">
            点击上方按钮可向当前选中的候选人快速发送预设消息（需先打开Boss直聘聊天页面）
          </p>
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
        worker-id="recruiterAutoReplyMain"
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
import { ref, computed } from 'vue'
import { ElForm, ElMessage, ElMessageBox } from 'element-plus'
import RunningOverlay from '@renderer/features/RunningOverlay/index.vue'
import { RUNNING_STATUS_ENUM } from '../../../../common/enums/auto-start-chat'

// 类型定义
interface QuickReplyItem {
  id: string | number
  name: string
  content: string
  enabled: boolean
  order: number
}

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const runRecordId = ref<number | null>(null)
const runningOverlayRef = ref<any>(null)
const isStopButtonLoading = ref(false)
const activeCollapse = ref(['basic', 'quickReply'])

// 默认表单内容
const getDefaultFormContent = () => ({
  recruiterAutoReply: {
    chatUiUrl: '',
    scanIntervalSeconds: 5,
    autoSend: false,
    confirmBeforeSend: true,
    constantReplyContent: '您好，收到您的消息，我会尽快回复您。'
  },
  candidateFilter: {
    enabled: false,
    degreeList: [] as string[],
    minWorkYears: 0,
    maxWorkYears: 0,
    expectJobKeywords: [] as string[],
    skillKeywords: [] as string[],
    blockKeywords: [] as string[]
  },
  quickReply: {
    list: [
      {
        id: 1,
        name: '收到简历',
        content: '您好，收到您的简历，我们会尽快查看并给您回复，谢谢！',
        enabled: true,
        order: 1
      },
      {
        id: 2,
        name: '邀请面试',
        content: '您好，您的简历已通过初步筛选，方便安排面试吗？请问您什么时间方便？',
        enabled: true,
        order: 2
      },
      {
        id: 3,
        name: '索要简历',
        content: '您好，能发一份详细的简历吗？我们想进一步了解您的背景。',
        enabled: true,
        order: 3
      },
      {
        id: 4,
        name: '询问期望薪资',
        content: '您好，请问您的期望薪资是多少？我们这边好评估一下。',
        enabled: true,
        order: 4
      }
    ] as QuickReplyItem[]
  },
  replyStrategy: {
    matchReplyMode: 'constant',
    matchReplyContent: '您好，您的简历很符合我们的要求，方便发一份详细简历吗？',
    notMatchAction: 'skip',
    notMatchReplyContent: ''
  }
})

const formContent = ref(getDefaultFormContent())

// 启用的快捷回复列表
const enabledQuickReplyList = computed(() => {
  return formContent.value.quickReply.list.filter(item => item.enabled)
})

// 加载配置
electron.ipcRenderer.invoke('fetch-config-file-content').then((res) => {
  const bossConfig = res.config['boss.json'] || {}

  // recruiterAutoReply
  if (bossConfig.recruiterAutoReply) {
    formContent.value.recruiterAutoReply = {
      ...formContent.value.recruiterAutoReply,
      ...bossConfig.recruiterAutoReply
    }
  }

  // candidateFilter
  if (bossConfig.candidateFilter) {
    formContent.value.candidateFilter = {
      ...formContent.value.candidateFilter,
      ...bossConfig.candidateFilter
    }
  }

  // quickReply
  if (bossConfig.quickReply?.list) {
    formContent.value.quickReply.list = bossConfig.quickReply.list
  }

  // replyStrategy
  if (bossConfig.replyStrategy) {
    formContent.value.replyStrategy = {
      ...formContent.value.replyStrategy,
      ...bossConfig.replyStrategy
    }
  }
})

// 添加快捷回复
const addQuickReply = () => {
  const newId = Date.now()
  formContent.value.quickReply.list.push({
    id: newId,
    name: `快捷回复 ${formContent.value.quickReply.list.length + 1}`,
    content: '',
    enabled: true,
    order: formContent.value.quickReply.list.length
  })
}

// 删除快捷回复
const removeQuickReply = (index: number) => {
  formContent.value.quickReply.list.splice(index, 1)
}

// 一键发送
const handleQuickSend = async (item: QuickReplyItem) => {
  try {
    // 先检查是否有正在运行的任务
    const status = await electron.ipcRenderer.invoke('get-running-status', 'recruiterAutoReplyMain')

    if (!status?.running) {
      ElMessage.warning('请先点击"保存并开始"启动任务，然后才能使用一键发送功能')
      return
    }

    const result = await electron.ipcRenderer.invoke('quick-send-message', {
      content: item.content,
      name: item.name
    })

    if (result.success) {
      ElMessage.success(`已发送: ${item.name}`)
    } else {
      ElMessage.error(result.message || '发送失败')
    }
  } catch (err: any) {
    ElMessage.error(err.message || '发送失败，请确保已打开Boss直聘聊天页面')
  }
}

// 保存配置
const saveConfig = async () => {
  await electron.ipcRenderer.invoke('save-config-file-from-ui', JSON.stringify({
    recruiterAutoReply: formContent.value.recruiterAutoReply,
    candidateFilter: formContent.value.candidateFilter,
    quickReply: formContent.value.quickReply,
    replyStrategy: formContent.value.replyStrategy
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
  await formRef.value?.validate?.()

  // 验证快捷回复
  const invalidReply = formContent.value.quickReply.list.find(
    item => item.enabled && !item.content.trim()
  )
  if (invalidReply) {
    ElMessage.error(`快捷回复 "${invalidReply.name}" 的内容不能为空`)
    return
  }

  try {
    await saveConfig()
    runningOverlayRef.value?.show()
    const { runRecordId: rrId } = await electron.ipcRenderer.invoke('run-recruiter-auto-reply')
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
    electron.ipcRenderer.invoke('stop-recruiter-auto-reply')
    runningOverlayRef.value?.hide()
  } finally {
    isStopButtonLoading.value = false
  }
}
</script>

<style lang="scss">
.recruiter-auto-reply__wrap {
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
  }

  .running-overlay__wrap {
    position: absolute;
    inset: 0;
  }

  .work-years-range {
    display: flex;
    align-items: center;
    gap: 8px;

    .separator {
      color: #909399;
    }
  }

  .quick-reply-list {
    .quick-reply-item {
      margin-bottom: 16px;
      padding: 12px;
      border: 1px solid #e4e7ed;
      border-radius: 4px;
      background: #fafafa;

      .quick-reply-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;

        .name-input {
          width: 200px;
        }
      }
    }

    .add-reply-btn {
      width: 100%;
      margin-top: 8px;
    }
  }

  .quick-send-section {
    margin-top: 24px;
    padding: 16px;
    background: #f5f7fa;
    border-radius: 4px;

    .quick-send-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }

    .quick-send-tip {
      font-size: 12px;
      color: #909399;
      margin: 0;
    }
  }
}
</style>