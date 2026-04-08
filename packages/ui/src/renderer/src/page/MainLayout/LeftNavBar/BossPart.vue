<template>
  <div class="group-item">
    <div class="group-title">逛BOSS</div>
    <div flex flex-col class="link-list">
      <RouterLink to="./SmartReply">
        智能回复
        <el-tooltip placement="right" :enterable="false">
          <template #content>
            <div w-480px>
              <div>通过大语言模型智能回复候选人消息</div>
              <br />
              <div>核心功能</div>
              <ul m0 pl2em>
                <li>根据公司简介、岗位说明智能回复</li>
                <li>每个候选人每会话最多回复3次</li>
                <li>支持自动发送/弹窗确认模式</li>
                <li>敏感词检测，自动过滤不合适内容</li>
              </ul>
            </div>
          </template>
          <QuestionFilled w-1em h-1em mr10px />
        </el-tooltip>
      </RouterLink>
      <RouterLink to="./InterviewConfig">
        面试自动化
        <el-tooltip placement="right" :enterable="false">
          <template #content>
            <div w-480px>
              <div>多轮面试自动化系统，自动筛选候选人</div>
              <br />
              <div>核心功能</div>
              <ul m0 pl2em>
                <li>配置多轮面试问题和评分规则</li>
                <li>自动发送问题、收集回复、评分</li>
                <li>关键词+AI双重评分机制</li>
                <li>通过后自动发送简历邀请</li>
                <li>简历下载并自动发送邮件</li>
              </ul>
            </div>
          </template>
          <QuestionFilled w-1em h-1em mr10px />
        </el-tooltip>
      </RouterLink>
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
      <RouterLink to="./InterviewEmailSetting">
        邮件设置
        <el-tooltip placement="right" :enterable="false">
          <template #content>
            <div w-480px>
              <div>配置SMTP邮件发送，用于自动发送候选人简历</div>
              <br />
              <div>功能</div>
              <ul m0 pl2em>
                <li>配置SMTP服务器和授权码</li>
                <li>测试邮件连接</li>
                <li>设置收件邮箱地址</li>
              </ul>
            </div>
          </template>
          <QuestionFilled w-1em h-1em mr10px />
        </el-tooltip>
      </RouterLink>
      <a href="javascript:void(0)" @click="handleClickLaunchBossLogin">
        编辑登录凭据<TopRight w-1em h-1em mr10px />
      </a>
      <a href="javascript:void(0)" @click="handleLaunchBossSite">
        手动逛<TopRight w-1em h-1em mr10px />
      </a>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { gtagRenderer } from '@renderer/utils/gtag'
import { debounce } from 'lodash'
import { ElMessage } from 'element-plus'
import { TopRight, QuestionFilled } from '@element-plus/icons-vue'

const handleClickLaunchBossLogin = async () => {
  gtagRenderer('launch_login_clicked')
  try {
    await electron.ipcRenderer.invoke('login-with-cookie-assistant')
    ElMessage({
      type: 'success',
      message: '登录凭据保存成功'
    })
  } catch {
    //
  }
}

const handleLaunchBossSite = debounce(
  async () => {
    gtagRenderer('launch_boss_site_clicked')
    return await electron.ipcRenderer.invoke('open-site-with-boss-cookie', {
      url: `https://www.zhipin.com/`
    })
  },
  1000,
  { leading: true, trailing: false }
)
</script>

<style scoped lang="scss" src="./style.scss"></style>