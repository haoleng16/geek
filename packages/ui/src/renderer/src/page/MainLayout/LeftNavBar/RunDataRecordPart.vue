<template>
  <div class="group-item">
    <div class="group-title">运行数据</div>
    <div flex flex-col class="link-list">
      <RouterLink to="./SmartReplyData">智能回复数据</RouterLink>
      <RouterLink to="./InterviewCandidateList">
        候选人看板
        <el-tooltip placement="right" :enterable="false">
          <template #content>
            <div w-480px>
              <div>查看面试自动化处理的候选人状态</div>
              <br />
              <div>功能</div>
              <ul m0 pl2em>
                <li>查看候选人状态和得分</li>
                <li>查看问答记录详情</li>
                <li>导出候选人数据</li>
              </ul>
            </div>
          </template>
          <QuestionFilled w-1em h-1em mr10px />
        </el-tooltip>
      </RouterLink>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { QuestionFilled } from '@element-plus/icons-vue'
</script>

<style scoped lang="scss" src="./style.scss"></style>
