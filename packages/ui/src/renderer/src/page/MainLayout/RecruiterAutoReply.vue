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

          <!-- 模版设置 -->
          <el-collapse-item title="模版设置" name="templates">
            <div class="template-section">
              <!-- 全局模版 -->
              <div class="template-group">
                <div class="group-title">全局模版</div>
                <div class="template-list">
                  <div
                    v-for="item in globalTemplates"
                    :key="item.id"
                    class="template-item"
                    @click="openTemplateEditor(item)"
                  >
                    <span class="template-name">{{ item.name }}</span>
                    <el-button type="primary" text size="small">编辑</el-button>
                  </div>
                </div>
              </div>

              <!-- 自定义模版 -->
              <div class="template-group">
                <div class="group-title">
                  自定义模版
                  <span class="limit-tip">(最多10个，当前{{ customTemplates.length }}/10)</span>
                </div>
                <div class="template-list">
                  <div
                    v-for="item in customTemplates"
                    :key="item.id"
                    class="template-item"
                  >
                    <span class="template-name" @click="openTemplateEditor(item)">{{ item.name }}</span>
                    <div class="template-actions">
                      <el-switch v-model="item.enabled" @change="saveTemplate(item)" />
                      <el-button type="danger" text size="small" @click="handleDeleteTemplate(item.id)">删除</el-button>
                    </div>
                  </div>
                </div>
                <el-button
                  v-if="customTemplates.length < 10"
                  type="primary"
                  plain
                  @click="addCustomTemplate"
                  class="add-template-btn"
                >
                  + 添加自定义模版
                </el-button>
              </div>

              <!-- 导入导出 -->
              <div class="template-actions-bar">
                <el-button size="small" @click="exportTemplates">导出模版</el-button>
                <el-upload
                  :show-file-list="false"
                  accept=".json"
                  :before-upload="importTemplates"
                >
                  <el-button size="small">导入模版</el-button>
                </el-upload>
              </div>
            </div>
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

    <!-- 模版编辑对话框 -->
    <el-dialog
      v-model="templateEditorVisible"
      :title="editingTemplate?.id ? '编辑模版' : '新建模版'"
      width="600px"
    >
      <el-form label-width="80px">
        <el-form-item label="模版名称">
          <el-input v-model="editingTemplate.name" placeholder="请输入模版名称" />
        </el-form-item>
        <el-form-item label="模版内容">
          <el-input
            v-model="editingTemplate.content"
            type="textarea"
            :rows="5"
            placeholder="请输入模版内容"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="可用变量">
          <div class="variable-tips">
            <el-tag size="small">{name}</el-tag> 候选人姓名（默认：您）
            <el-tag size="small" style="margin-left: 12px">{jobName}</el-tag> 职位名称（默认：本职位）
          </div>
        </el-form-item>
        <el-form-item label="预览效果">
          <div class="preview-box">
            {{ previewTemplateContent }}
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="templateEditorVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEditingTemplate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
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

interface RecruiterTemplate {
  id?: number
  encryptJobId?: string | null
  templateType: string
  name: string
  content: string
  enabled: boolean
  sortOrder: number
  createdAt?: Date
  updatedAt?: Date
}

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const runRecordId = ref<number | null>(null)
const runningOverlayRef = ref<any>(null)
const isStopButtonLoading = ref(false)
const activeCollapse = ref(['basic', 'quickReply', 'templates'])

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

// 模版相关状态
const templateList = ref<RecruiterTemplate[]>([])
const templateEditorVisible = ref(false)
const editingTemplate = ref<Partial<RecruiterTemplate>>({
  name: '',
  content: '',
  templateType: 'custom',
  enabled: true
})

// 启用的快捷回复列表
const enabledQuickReplyList = computed(() => {
  return formContent.value.quickReply.list.filter(item => item.enabled)
})

// 全局模版列表
const globalTemplates = computed(() => {
  return templateList.value.filter(t => !t.encryptJobId && ['initial', 'resume_received', 'reject'].includes(t.templateType))
})

// 自定义模版列表
const customTemplates = computed(() => {
  return templateList.value.filter(t => t.templateType === 'custom')
})

// 预览模版内容
const previewTemplateContent = computed(() => {
  return replaceTemplateVariables(editingTemplate.value.content || '')
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

// ==================== 模版相关函数 ====================

// 默认全局模版数据
const defaultGlobalTemplates = [
  {
    templateType: 'initial',
    name: '首次回复',
    content: '您好，感谢您对我们公司的关注！我们会尽快查看您的简历，如有合适岗位会及时联系您。',
    encryptJobId: null,
    enabled: true,
    sortOrder: 0
  },
  {
    templateType: 'resume_received',
    name: '收到简历',
    content: '您好，已收到您的简历，我们会尽快进行评估。如果您的经历符合岗位要求，我们会主动联系您安排面试。',
    encryptJobId: null,
    enabled: true,
    sortOrder: 1
  },
  {
    templateType: 'reject',
    name: '婉拒回复',
    content: '感谢您对本公司岗位的关注！经过综合评估，您的经历暂时不太符合该岗位的要求。我们会保留您的简历，有合适机会会主动联系您。',
    encryptJobId: null,
    enabled: true,
    sortOrder: 2
  }
]

// 初始化默认模版
const initDefaultTemplates = async () => {
  for (const template of defaultGlobalTemplates) {
    const existing = templateList.value.find(t => t.templateType === template.templateType && !t.encryptJobId)
    if (!existing) {
      await electron.ipcRenderer.invoke('recruiter-save-template', template)
    }
  }
}

// 加载模版列表
const loadTemplates = async () => {
  const result = await electron.ipcRenderer.invoke('recruiter-get-templates', {})
  templateList.value = result?.data || []

  // 初始化默认模版
  await initDefaultTemplates()

  // 重新加载以确保默认模版已添加
  const newResult = await electron.ipcRenderer.invoke('recruiter-get-templates', {})
  templateList.value = newResult?.data || []
}

// 变量替换
const replaceTemplateVariables = (content: string) => {
  return content
    .replace(/{name}/g, '您')
    .replace(/{jobName}/g, '本职位')
}

// 根据模版类型获取模版名称
const getTemplateNameByType = (type: string): string => {
  const nameMap: Record<string, string> = {
    initial: '首次回复',
    resume_received: '收到简历',
    reject: '婉拒回复'
  }
  return nameMap[type] || type
}

// 打开模版编辑器
const openTemplateEditor = (template?: RecruiterTemplate) => {
  if (template) {
    editingTemplate.value = { ...template }
  } else {
    editingTemplate.value = {
      name: '',
      content: '',
      templateType: 'custom',
      enabled: true,
      sortOrder: customTemplates.value.length
    }
  }
  templateEditorVisible.value = true
}

// 保存模版
const saveTemplate = async (template: Partial<RecruiterTemplate>) => {
  try {
    await electron.ipcRenderer.invoke('recruiter-save-template', template)
    await loadTemplates()
  } catch (err) {
    ElMessage.error('保存模版失败')
  }
}

// 删除模版
const handleDeleteTemplate = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定删除该模版？', '提示', {
      type: 'warning'
    })
    await electron.ipcRenderer.invoke('recruiter-delete-template', id)
    await loadTemplates()
    ElMessage.success('模版已删除')
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('删除模版失败')
    }
  }
}

// 添加自定义模版
const addCustomTemplate = () => {
  openTemplateEditor()
}

// 保存编辑中的模版
const saveEditingTemplate = async () => {
  if (!editingTemplate.value.name?.trim()) {
    ElMessage.error('请输入模版名称')
    return
  }
  if (!editingTemplate.value.content?.trim()) {
    ElMessage.error('请输入模版内容')
    return
  }

  await saveTemplate(editingTemplate.value)
  templateEditorVisible.value = false
  ElMessage.success('模版保存成功')
}

// 导出模版
const exportTemplates = () => {
  const data = {
    version: '1.0',
    globalTemplates: {
      initial: globalTemplates.value.find(t => t.templateType === 'initial')?.content || '',
      resumeReceived: globalTemplates.value.find(t => t.templateType === 'resume_received')?.content || '',
      reject: globalTemplates.value.find(t => t.templateType === 'reject')?.content || ''
    },
    customTemplates: customTemplates.value.map(t => ({
      name: t.name,
      content: t.content
    }))
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `recruiter-templates-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('模版导出成功')
}

// 导入模版
const importTemplates = async (file: File) => {
  try {
    const text = await file.text()
    const data = JSON.parse(text)

    // 导入全局模版
    if (data.globalTemplates) {
      for (const [type, content] of Object.entries(data.globalTemplates)) {
        if (content && typeof content === 'string') {
          const templateType = type === 'resumeReceived' ? 'resume_received' : type
          await electron.ipcRenderer.invoke('recruiter-save-template', {
            templateType,
            name: getTemplateNameByType(templateType),
            content,
            encryptJobId: null,
            enabled: true
          })
        }
      }
    }

    // 导入自定义模版
    if (data.customTemplates && Array.isArray(data.customTemplates)) {
      for (const custom of data.customTemplates) {
        if (custom.name && custom.content) {
          await electron.ipcRenderer.invoke('recruiter-save-template', {
            templateType: 'custom',
            name: custom.name,
            content: custom.content,
            enabled: true
          })
        }
      }
    }

    await loadTemplates()
    ElMessage.success('模版导入成功')
  } catch (err) {
    ElMessage.error('模版导入失败，请检查文件格式')
  }
  return false // 阻止upload默认行为
}

// 初始化加载模版
onMounted(() => {
  loadTemplates()
})
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

  // 模版设置样式
  .template-section {
    .template-group {
      margin-bottom: 20px;

      .group-title {
        font-weight: 500;
        margin-bottom: 12px;
        color: #303133;

        .limit-tip {
          font-size: 12px;
          color: #909399;
          font-weight: normal;
          margin-left: 8px;
        }
      }

      .template-list {
        .template-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          margin-bottom: 8px;
          background: #fafafa;
          border: 1px solid #e4e7ed;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;

          &:hover {
            border-color: #409eff;
            background: #f5f7fa;
          }

          .template-name {
            flex: 1;
            color: #303133;
          }

          .template-actions {
            display: flex;
            align-items: center;
            gap: 12px;
          }
        }
      }

      .add-template-btn {
        width: 100%;
        margin-top: 8px;
      }
    }

    .template-actions-bar {
      display: flex;
      gap: 12px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #e4e7ed;
    }
  }

  // 模版编辑对话框样式
  .variable-tips {
    font-size: 12px;
    color: #606266;

    .el-tag {
      margin-right: 4px;
    }
  }

  .preview-box {
    padding: 12px;
    background: #f5f7fa;
    border: 1px solid #e4e7ed;
    border-radius: 4px;
    min-height: 60px;
    white-space: pre-wrap;
    font-size: 14px;
    color: #303133;
  }
}
</style>