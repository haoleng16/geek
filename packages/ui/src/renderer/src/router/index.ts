import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'
import BootstrapSplash from '@renderer/page/BootstrapSplash/index.vue'
import { gtagRenderer } from '@renderer/utils/gtag'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/first-run-readme',
    component: () => import('@renderer/page/FirstRunReadme/index.vue'),
    meta: {
      title: '初次使用必读'
    }
  },
  {
    path: '/cookieAssistant',
    component: () => import('@renderer/page/CookieAssistant/index.vue'),
    meta: {
      title: 'BOSS登录助手'
    }
  },
  {
    path: '/browserAssistant',
    component: () => import('@renderer/page/BrowserAssistant/index.vue'),
    meta: {
      title: '浏览器助手'
    }
  },
  {
    path: '/browserAutoFind',
    component: () => import('@renderer/page/BrowserAutoFind/index.vue'),
    meta: {
      title: '浏览器助手 - 自动查找浏览器'
    }
  },
  {
    path: '/browserDownloadProgress',
    component: () => import('@renderer/page/BrowserDownloadProgress/index.vue'),
    meta: {
      title: '正在下载浏览器'
    }
  },
  {
    path: '/llmConfig',
    component: () => import('@renderer/page/LlmConfig/index.vue'),
    meta: {
      title: '大语言模型设置'
    }
  },
  {
    path: '/resumeEditor',
    component: () => import('@renderer/page/ResumeEditor/index.vue'),
    meta: {
      title: '简历编辑'
    }
  },
  {
    path: '/commonJobConditionConfig',
    component: () => import('@renderer/page/CommonJobConditionConfig/index.vue'),
    meta: {
      title: '公共职位筛选条件'
    }
  },
  {
    path: '/main-layout',
    component: () => import('@renderer/page/MainLayout/index.vue'),
    redirect: '/main-layout/SmartReply',
    children: [
      {
        path: 'taskManager',
        component: () => import('@renderer/page/MainLayout/TaskManager.vue'),
        meta: {
          title: '任务管理'
        }
      },
      {
        path: 'SmartReply',
        component: () => import('@renderer/page/MainLayout/SmartReply.vue'),
        meta: {
          title: '智能回复'
        }
      },
      {
        path: 'SmartReplyData',
        component: () => import('@renderer/page/MainLayout/SmartReplyData.vue'),
        meta: {
          title: '智能回复数据'
        }
      },
      {
        path: 'InterviewConfig',
        component: () => import('@renderer/page/MainLayout/InterviewConfig.vue'),
        meta: {
          title: '面试自动化配置'
        }
      },
      {
        path: 'InterviewCandidateList',
        component: () => import('@renderer/page/MainLayout/InterviewCandidateList.vue'),
        meta: {
          title: '候选人看板'
        }
      },
      {
        path: 'InterviewEmailSetting',
        component: () => import('@renderer/page/MainLayout/InterviewEmailSetting.vue'),
        meta: {
          title: '邮件设置'
        }
      }
    ]
  },
  {
    path: '/',
    component: BootstrapSplash,
    meta: {
      title: '你的职场大机密'
    }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.afterEach((to, from) => {
  if (to.meta?.title) {
    document.title = `${to.meta.title} - GeekGeekRun 牛人快跑`
  } else {
    document.title = `GeekGeekRun 牛人快跑`
  }
  gtagRenderer('router_path_changed', {
    from_path: from.fullPath,
    to_path: to.fullPath
  })
  gtagRenderer('page_view', {
    page_location: location.href,
    page_title: document.title
  })
})

export default router
