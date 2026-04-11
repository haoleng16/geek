# 招聘端自动回复功能技术规范文档

## 1. 项目概述

### 1.1 背景
基于现有 `geekgeekrun` 项目（求职者视角的BOSS直聘自动化工具），开发面向招聘者（HR）视角的自动化功能模块。

### 1.2 核心目标
- 实现招聘者登录后自动监控并处理求职者消息
- 支持智能筛选求职者并自动回复模版消息
- 自动解析并存储求职者简历信息

### 1.3 技术栈复用
| 组件 | 现有技术 | 复用情况 |
|------|----------|----------|
| 框架 | Electron + Vue 3 + TypeScript | 完全复用 |
| 自动化 | Puppeteer + Stealth 插件 | 完全复用 |
| 存储 | SQLite (TypeORM) | 新建独立表 |
| UI | Element Plus | 完全复用 |
| LLM | Gemini (可配置) | 独立配置 |

---

## 2. 功能需求

### 2.1 核心功能模块

```
┌─────────────────────────────────────────────────────────────┐
│                      招聘端功能架构                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  消息监控    │  │  候选人筛选  │  │  简历处理    │      │
│  │  模块        │──│  模块        │──│  模块        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  模版管理    │  │  自动回复    │  │  数据存储    │      │
│  │  模块        │  │  模块        │  │  模块        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 功能列表

#### 2.2.1 登录与状态管理
- 复用现有 BOSS 直聘登录机制（Cookie 持久化）
- 登录状态检测与自动重连
- 启动/停止按钮与状态监控

#### 2.2.2 消息监控
- 持续监控消息列表，检测新消息（未读状态）
- 实时获取求职者发来的消息内容
- 支持处理聊天中发送的 PDF 附件简历

#### 2.2.3 候选人筛选
| 筛选维度 | 类型 | 说明 |
|----------|------|------|
| 学历要求 | 多选 | 大专/本科/硕士/博士 |
| 工作年限 | 范围 | 最小年限 - 最大年限 |
| 技能关键词 | 多选 | 匹配简历中的技能标签 |

- 筛选时机：首次接触时（求职者发送第一条消息/简历）
- 不匹配处理：发送固定婉拒模版消息

#### 2.2.4 自动回复
- 按职位区分不同模版配置
- 支持多轮对话（最多3轮）
  - 轮次定义：按求职者发送消息次数
  - 回复内容：LLM 智能生成（根据求职者回复动态生成）
  - 超过3轮后：停止自动回复，转人工处理

#### 2.2.5 简历处理
- 格式支持：PDF 附件
- 解析方式：规则匹配 + LLM 结合
- 存储内容：
  - 基本信息：姓名、联系方式、期望薪资
  - 教育背景：学历、毕业院校、专业
  - 工作经历：公司、职位、时间
  - 技能与项目：技能标签、项目经历
- 存储方式：结构化数据存入数据库（不保存原始文件）

---

## 2.3 模版设置功能

### 2.3.1 功能概述

模版设置是招聘端自动回复的核心配置模块，支持全局模版和职位级别模版的配置与管理。

### 2.3.2 模版类型

| 类型 | 触发条件 | 说明 |
|------|----------|------|
| 初始信息 | 求职者首次发消息时 | 自动发送的首条回复消息 |
| 收到简历回复 | 检测到简历附件或关键词时 | 确认收到简历的回复 |
| 拒绝信息 | 候选人不符合筛选条件时 | 自动发送的婉拒消息 |
| 自定义模版 | 用户手动触发 | 最多支持10个自定义模版 |

### 2.3.3 模版层级与优先级

```
┌─────────────────────────────────────────────┐
│               模版优先级关系                  │
├─────────────────────────────────────────────┤
│                                              │
│   职位模版（高优先级）                        │
│        ↓                                     │
│   全局默认模版（低优先级）                    │
│                                              │
│   规则：职位模版优先，若职位未配置某类型模版   │
│        则回退使用全局默认模版                 │
│                                              │
└─────────────────────────────────────────────┘
```

### 2.3.4 模版变量

| 变量名 | 说明 | 数据来源 | 默认值（缺失时） |
|--------|------|----------|------------------|
| `{name}` | 候选人姓名 | BOSS页面解析 | 您 |
| `{jobName}` | 职位名称 | 聊天界面解析 | 本职位 |

**变量处理逻辑：**
1. 从BOSS直聘页面DOM解析候选人姓名
2. 从聊天界面解析应聘职位名称
3. 若变量无法解析，替换为固定默认值
4. 变量格式统一使用 `{变量名}`

### 2.3.5 触发机制

#### 初始信息触发
```
求职者发送消息
       │
       ▼
┌──────────────────┐     是      ┌──────────────────┐
│ 是否为首次消息？   │────────────▶│ 发送初始信息模版  │
└────────┬─────────┘              └──────────────────┘
         │ 否
         ▼
   跳过初始信息
```

#### 收到简历回复触发
```
检测消息内容
       │
       ├─────────────────┐
       ▼                 ▼
┌──────────────┐   ┌──────────────┐
│ 检测PDF附件   │   │ 关键词识别    │
│ 图标/链接     │   │ "已发送简历"  │
└──────┬───────┘   │ "发简历了"   │
       │           └──────┬───────┘
       └────────┬─────────┘
                ▼
         发送收到简历回复模版
```

#### 拒绝信息触发
```
候选人筛选
       │
       ▼
┌──────────────────┐     否      ┌──────────────────┐
│ 是否符合筛选条件？ │────────────▶│ 发送拒绝信息模版  │
└────────┬─────────┘              └──────────────────┘
         │ 是                              │
         ▼                                 ▼
   继续后续流程                     连续拒绝计数+1
                                          │
                                          ▼
                               ┌──────────────────┐
                               │连续拒绝>=10个？   │
                               └────────┬─────────┘
                                        │ 是
                                        ▼
                               ┌──────────────────┐
                               │ 自动暂停5分钟     │
                               │ 防止风控          │
                               └──────────────────┘
```

### 2.3.6 手动发送交互流程

```
用户点击模版按钮
       │
       ▼
┌──────────────────┐
│ 弹出预览确认框    │
│ - 显示变量替换后 │
│   的实际内容      │
│ - 显示目标候选人 │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     取消    ┌──────────────────┐
│ 用户确认发送？    │───────────▶│ 关闭预览框        │
└────────┬─────────┘             └──────────────────┘
         │ 确认
         ▼
   发送消息到当前选中的候选人
```

### 2.3.7 反检测策略

| 策略 | 参数 | 说明 |
|------|------|------|
| 自动拒绝冷却 | 连续拒绝10个后暂停5分钟 | 防止被识别为机器人 |
| 消息字数限制 | 最多500字 | 符合BOSS直聘限制 |
| 随机延迟 | 3-10秒 | 模拟人工操作 |

### 2.3.8 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 职位不匹配任何已配置职位 | 使用全局默认模版 |
| 任务中断恢复 | 从数据库恢复模版状态，继续执行 |
| 重复消息去重 | 记录已处理消息ID，避免重复回复 |
| 模版内容为空 | 前端验证，不允许保存空模版 |
| 网络异常 | 记录错误日志，等待重试 |
| 变量解析失败 | 使用默认值替换 |

### 2.3.9 数据存储

| 数据类型 | 存储位置 | 说明 |
|----------|----------|------|
| 全局模版 | boss.json | 配置文件，便于版本管理 |
| 职位模版 | SQLite数据库 | recruiter_job_config表 |
| 自定义模版 | SQLite数据库 | 新建recruiter_template表 |

### 2.3.10 模版导入导出

- 支持JSON格式导入导出
- 便于多设备同步和团队共享
- 导出格式示例：
```json
{
  "version": "1.0",
  "globalTemplates": {
    "initial": "您好，感谢您对我们公司的关注...",
    "resumeReceived": "收到您的简历，我们会尽快查看...",
    "reject": "感谢您的投递，但您的经历..."
  },
  "customTemplates": [
    {
      "name": "邀请面试",
      "content": "您好，您的简历已通过初步筛选..."
    }
  ]
}
```

### 2.3.11 UI设计

**模版设置区块布局：**
```
┌─────────────────────────────────────────────────────────┐
│  模版设置 (Collapse)                                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐    │
│  │  全局模版                                         │    │
│  │  ├── 初始信息    [编辑按钮]                        │    │
│  │  ├── 收到简历回复 [编辑按钮]                        │    │
│  │  └── 拒绝信息    [编辑按钮]                        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  自定义模版 (最多10个)                            │    │
│  │  ├── 邀请面试    [编辑] [删除]                     │    │
│  │  ├── 索要简历    [编辑] [删除]                     │    │
│  │  └── [+ 添加自定义模版]                           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  导入/导出                                        │    │
│  │  [导入模版] [导出模版]                            │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  编辑面板 (侧边详情面板)                                  │
├─────────────────────────────────────────────────────────┤
│  模版名称: [___________________]                         │
│                                                          │
│  模版内容:                                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │ {name}您好，感谢您对我们公司的关注...              │    │
│  │                                                   │    │
│  │                                                   │    │
│  └─────────────────────────────────────────────────┘    │
│  可用变量: {name} {jobName}                              │
│  字数统计: 45/500                                        │
│                                                          │
│  预览效果:                                               │
│  "您您好，感谢您对我们公司的关注..."                       │
│                                                          │
│  [保存] [取消]                                           │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 数据库设计

### 3.1 新增数据表

#### 3.1.1 招聘者职位配置表 `recruiter_job_config`
```sql
CREATE TABLE recruiter_job_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_job_id VARCHAR(64) NOT NULL UNIQUE,  -- BOSS直聘职位ID
  job_name VARCHAR(128),                        -- 职位名称
  template_first_message TEXT,                  -- 首次回复模版
  template_reject_message TEXT,                 -- 婉拒模版
  filter_min_degree VARCHAR(32),                -- 最低学历要求
  filter_max_degree VARCHAR(32),                -- 最高学历要求
  filter_min_work_years INTEGER DEFAULT 0,      -- 最小工作年限
  filter_max_work_years INTEGER DEFAULT 99,     -- 最大工作年限
  filter_skill_keywords TEXT,                   -- 技能关键词JSON数组
  daily_limit INTEGER DEFAULT 100,              -- 每日处理上限
  enabled BOOLEAN DEFAULT 1,                    -- 是否启用
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 3.1.2 求职者信息表 `candidate_info`
```sql
CREATE TABLE candidate_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_user_id VARCHAR(64) NOT NULL UNIQUE,  -- BOSS直聘用户ID
  name VARCHAR(64),                             -- 姓名
  phone VARCHAR(32),                            -- 联系方式
  email VARCHAR(128),                           -- 邮箱
  expect_salary VARCHAR(64),                    -- 期望薪资
  degree VARCHAR(32),                           -- 最高学历
  school VARCHAR(128),                          -- 毕业院校
  major VARCHAR(128),                           -- 专业
  work_years INTEGER,                           -- 工作年限
  skills TEXT,                                  -- 技能标签JSON数组
  work_experience TEXT,                         -- 工作经历JSON
  project_experience TEXT,                      -- 项目经历JSON
  source VARCHAR(32),                           -- 来源：chat_resume/chat_input
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 3.1.3 对话记录表 `candidate_conversation`
```sql
CREATE TABLE candidate_conversation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_user_id VARCHAR(64) NOT NULL,         -- 求职者ID
  encrypt_job_id VARCHAR(64) NOT NULL,          -- 职位ID
  round_count INTEGER DEFAULT 0,                -- 当前对话轮次
  status VARCHAR(32) DEFAULT 'pending',         -- pending/matched/rejected/handover
  first_contact_at DATETIME,                    -- 首次接触时间
  last_reply_at DATETIME,                       -- 最后回复时间
  handed_over_at DATETIME,                      -- 转人工时间
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(encrypt_user_id, encrypt_job_id)
);
```

#### 3.1.4 处理日志表 `recruiter_process_log`
```sql
CREATE TABLE recruiter_process_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_user_id VARCHAR(64) NOT NULL,         -- 求职者ID
  encrypt_job_id VARCHAR(64) NOT NULL,          -- 职位ID
  action VARCHAR(32) NOT NULL,                  -- 动作：reply/reject/parse_resume/skip
  round_number INTEGER,                         -- 轮次
  message_content TEXT,                         -- 发送的消息内容
  filter_result TEXT,                           -- 筛选结果JSON
  error_message TEXT,                           -- 错误信息
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 3.1.5 每日统计表 `recruiter_daily_stats`
```sql
CREATE TABLE recruiter_daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL,                           -- 日期
  encrypt_job_id VARCHAR(64),                   -- 职位ID（NULL表示总计）
  total_processed INTEGER DEFAULT 0,            -- 总处理数
  total_matched INTEGER DEFAULT 0,              -- 匹配成功数
  total_rejected INTEGER DEFAULT 0,             -- 婉拒数
  total_handover INTEGER DEFAULT 0,             -- 转人工数
  total_resume_parsed INTEGER DEFAULT 0,        -- 简历解析数
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, encrypt_job_id)
);
```

#### 3.1.6 自定义模版表 `recruiter_template`
```sql
CREATE TABLE recruiter_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_job_id VARCHAR(64),                   -- 职位ID（NULL表示全局模版）
  template_type VARCHAR(32) NOT NULL,           -- 模版类型：initial/resume_received/reject/custom
  name VARCHAR(128) NOT NULL,                   -- 模版名称
  content TEXT NOT NULL,                        -- 模版内容
  enabled BOOLEAN DEFAULT 1,                    -- 是否启用
  sort_order INTEGER DEFAULT 0,                 -- 排序顺序
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_recruiter_template_job_id ON recruiter_template(encrypt_job_id);
CREATE INDEX idx_recruiter_template_type ON recruiter_template(template_type);
```

---

## 4. 核心流程设计

### 4.1 主流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          主流程                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │  启动    │───▶│  登录    │───▶│  监控    │───▶│  检测    │      │
│  │  任务    │    │  验证    │    │  消息    │    │  未读    │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │
│                                                       │              │
│                                                       ▼              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │  更新    │◀───│  记录    │◀───│  执行    │◀───│  判断    │      │
│  │  统计    │    │  日志    │    │  动作    │    │  流程    │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 消息处理流程

```
检测到未读消息
       │
       ▼
┌──────────────────┐
│ 获取求职者信息    │
│ - 用户ID          │
│ - 应聘职位        │
│ - 历史对话        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     是      ┌──────────────────┐
│ 是否已处理过？    │────────────▶│ 跳过，等待新消息  │
└────────┬─────────┘              └──────────────────┘
         │ 否
         ▼
┌──────────────────┐
│ 检查简历附件      │
│ - 解析PDF内容     │
│ - 提取结构化信息   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 执行筛选逻辑      │
│ - 学历匹配        │
│ - 工作年限匹配    │
│ - 技能关键词匹配  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐             ┌──────────────────┐
│ 是否匹配？        │──── 否 ───▶│ 发送婉拒模版     │
└────────┬─────────┘             │ 标记为rejected   │
         │ 是                    └──────────────────┘
         ▼
┌──────────────────┐
│ 检查对话轮次      │
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 < 3轮      >= 3轮
    │         │
    ▼         ▼
┌─────────┐ ┌──────────────────┐
│ LLM生成 │ │ 停止自动回复      │
│ 智能回复 │ │ 标记为handover   │
└─────────┘ └──────────────────┘
```

---

## 5. 接口设计

### 5.1 IPC 通信接口

#### 5.1.1 任务控制
```typescript
// 启动招聘端任务
ipcMain.handle('run-recruiter-auto-reply'): Promise<{ runRecordId: number }>

// 停止任务
ipcMain.handle('stop-recruiter-auto-reply'): Promise<void>

// 获取运行状态
ipcMain.handle('get-running-status', workerId: string): Promise<{
  running: boolean,
  processed: number,
  errors: number
}>
```

#### 5.1.2 职位配置管理
```typescript
// 获取职位列表
ipcMain.handle('recruiter-get-job-list'): Promise<RecruiterJobConfig[]>

// 保存职位配置
ipcMain.handle('recruiter-save-job-config', config: RecruiterJobConfig): Promise<void>

// 删除职位配置
ipcMain.handle('recruiter-delete-job-config', jobId: number): Promise<void>
```

#### 5.1.3 数据查询
```typescript
// 获取候选人列表
ipcMain.handle('recruiter-get-candidates', params: {
  jobId?: string,
  status?: string,
  dateRange?: [Date, Date],
  page: number,
  pageSize: number
}): Promise<{ list: CandidateInfo[], total: number }>

// 获取每日统计
ipcMain.handle('recruiter-get-daily-stats', date: string): Promise<DailyStats>

// 获取处理日志
ipcMain.handle('recruiter-get-process-logs', params: {
  userId?: string,
  dateRange?: [Date, Date],
  page: number,
  pageSize: number
}): Promise<{ list: ProcessLog[], total: number }>
```

#### 5.1.4 模版管理
```typescript
// 获取模版列表
ipcMain.handle('recruiter-get-templates', params: {
  encryptJobId?: string    // 不传则获取全局模版
}): Promise<RecruiterTemplate[]>

// 保存模版
ipcMain.handle('recruiter-save-template', template: RecruiterTemplate): Promise<RecruiterTemplate>

// 删除模版
ipcMain.handle('recruiter-delete-template', id: number): Promise<void>

// 导出模版
ipcMain.handle('recruiter-export-templates'): Promise<TemplateExportFormat>

// 导入模版
ipcMain.handle('recruiter-import-templates', data: TemplateExportFormat): Promise<void>

// 手动发送模版（预览后确认）
ipcMain.handle('recruiter-preview-template', params: {
  templateId: number,
  candidateId: string
}): Promise<{
  previewContent: string,    // 变量替换后的预览内容
  candidateName: string      // 目标候选人名称
}>

// 确认发送模版
ipcMain.handle('recruiter-send-template', params: {
  templateId: number,
  candidateId: string
}): Promise<{ success: boolean, message?: string }>
```

### 5.2 配置文件结构

#### 5.2.1 招聘端配置 `recruiter.json`
```json
{
  "llm": {
    "provider": "gemini",
    "model": "gemini-1.5-flash",
    "apiKey": "${GEMINI_API_KEY}",
    "baseUrl": "https://generativelanguage.googleapis.com"
  },
  "behavior": {
    "scanIntervalSeconds": 5,
    "replyDelayMin": 3,
    "replyDelayMax": 10,
    "dailyProcessLimit": 100,
    "maxConversationRounds": 3
  },
  "antiDetection": {
    "randomDelay": true,
    "simulateHumanBehavior": true,
    "frequencyLimit": {
      "perMinute": 10,
      "perHour": 50
    }
  },
  "jobs": [
    {
      "encryptJobId": "xxx",
      "templateFirstMessage": "您好，感谢您对我们公司的关注...",
      "templateRejectMessage": "感谢您的投递，但您的经历与岗位要求不太匹配...",
      "filter": {
        "degrees": ["本科", "硕士"],
        "minWorkYears": 2,
        "maxWorkYears": 5,
        "skillKeywords": ["Vue", "TypeScript", "Node.js"]
      }
    }
  ]
}
```

---

## 6. 反检测策略

### 6.1 策略列表

| 策略 | 实现 | 说明 |
|------|------|------|
| Stealth 插件 | 复用现有 | 基础浏览器指纹伪装 |
| 随机延迟 | 新增 | 发送间隔 3-10 秒随机 |
| 人类行为模拟 | 新增 | 发送前随机滚动、点击 |
| 频率限制 | 新增 | 每分钟≤10次，每小时≤50次 |
| 每日上限 | 新增 | 每日≤100次（可配置） |

### 6.2 延迟策略实现
```typescript
// 随机延迟发送
async function sendMessageWithDelay(page: Page, content: string) {
  // 模拟人类行为：随机滚动
  if (Math.random() > 0.5) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.random() * 100 - 50);
    });
  }

  // 随机延迟 3-10 秒
  const delay = 3000 + Math.random() * 7000;
  await sleep(delay);

  // 发送消息
  await sendMessage(page, content);
}
```

---

## 7. 错误处理

### 7.1 错误类型与处理策略

| 错误类型 | 处理策略 | 用户感知 |
|----------|----------|----------|
| 登录状态失效 | 自动重新登录 | 状态栏提示 |
| 页面加载失败 | 跳过当前，记录错误 | 日志记录 |
| 元素定位失败 | 重试3次后跳过 | 日志记录 |
| 网络异常 | 等待后重试 | 状态栏提示 |
| LLM 调用失败 | 使用备用模版 | 日志记录 |
| 简历解析失败 | 标记待人工处理 | 日志记录 |

### 7.2 错误恢复机制
```typescript
// 错误恢复流程
async function handleProcessError(error: Error, context: ProcessContext) {
  // 记录错误日志
  await logError(error, context);

  // 判断是否需要重试
  if (isRetryable(error)) {
    const retryCount = context.retryCount + 1;
    if (retryCount < 3) {
      await sleep(5000);
      return retry(context);
    }
  }

  // 跳过当前求职者
  await markAsSkipped(context.userId);
  return nextCandidate();
}
```

---

## 8. UI 设计

### 8.1 页面结构
```
招聘端自动回复页面
├── 基础设置（Collapse）
│   ├── 聊天页URL（可选）
│   ├── 扫描间隔
│   ├── 自动发送开关
│   └── 发送前确认开关
├── 职位配置（Collapse）
│   ├── 职位列表（Table）
│   │   ├── 职位名称
│   │   ├── 模版配置
│   │   ├── 筛选条件
│   │   └── 操作按钮
│   └── 添加职位按钮
├── 筛选条件（Collapse）
│   ├── 学历要求
│   ├── 工作年限范围
│   └── 技能关键词
├── 运行状态面板
│   ├── 当前状态
│   ├── 今日统计
│   ├── 当前处理进度
│   └── 操作按钮（启动/停止）
└── 历史记录（Collapse）
    └── 候选人列表（Table）
```

### 8.2 状态展示
- 运行状态：运行中 / 已停止 / 异常
- 今日处理数：X / Y（上限）
- 匹配成功数：X
- 婉拒数：X
- 转人工数：X

---

## 9. 开发计划

### 9.1 分阶段开发

#### 第一阶段：基础功能（预计 5-7 天）
- [ ] 数据库表设计与迁移
- [✅] 登录状态管理与自动重连
- [ ] 消息列表监控
- [ ] 基础模版发送功能
- [✅] 简单的启动/停止控制

#### 第二阶段：筛选与婉拒（预计 3-5 天）
- [ ] 候选人筛选逻辑
- [ ] 婉拒模版发送
- [ ] 处理日志记录
- [ ] 去重机制

#### 第三阶段：简历处理（预计 5-7 天）
- [ ] PDF 简历下载
- [ ] 规则解析器
- [ ] LLM 解析集成
- [ ] 结构化数据存储

#### 第四阶段：多轮对话（预计 3-5 天）
- [ ] 轮次计数逻辑
- [ ] LLM 智能回复
- [ ] 转人工处理

#### 第五阶段：统计与优化（预计 2-3 天）
- [ ] 每日统计
- [ ] 历史记录查询
- [ ] 性能优化
- [ ] 反检测策略完善

---

## 10. 风险评估

### 10.1 技术风险

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| BOSS直聘页面结构变更 | 高 | 抽象选择器，快速适配机制 |
| 反检测策略失效 | 中 | 持续更新 Stealth 插件，行为模拟 |
| LLM 解析准确率低 | 中 | 规则+LLM 结合，人工校验 |
| PDF 解析兼容性 | 中 | 多种解析库兜底 |

### 10.2 业务风险

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 平台风控封号 | 高 | 频率限制、随机延迟、每日上限 |
| 回复内容不当 | 中 | 模版审核、LLM Prompt 约束 |
| 简历信息泄露 | 中 | 本地存储，无云端同步 |

---

## 11. 附录

### 11.1 相关文件路径
```
packages/ui/
├── src/
│   ├── main/
│   │   └── flow/
│   │       └── RECRUITER_AUTO_REPLY_MAIN/    # 主流程目录
│   │           ├── index.ts                  # 入口
│   │           ├── bootstrap.ts              # 启动逻辑
│   │           ├── message-monitor.ts        # 消息监控
│   │           ├── candidate-filter.ts       # 筛选逻辑
│   │           ├── resume-parser.ts          # 简历解析
│   │           └── auto-reply.ts             # 自动回复
│   ├── renderer/
│   │   └── src/
│   │       └── page/
│   │           └── MainLayout/
│   │               └── RecruiterAutoReply.vue # UI 页面
│   └── common/
│       └── types/
│           └── recruiter.ts                  # 类型定义
└── ...
```

### 11.2 类型定义
```typescript
// 模版类型
type TemplateType = 'initial' | 'resume_received' | 'reject' | 'custom';

// 模版配置
interface RecruiterTemplate {
  id: number;
  encryptJobId: string | null;        // NULL表示全局模版
  templateType: TemplateType;
  name: string;
  content: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

// 全局模版配置（存储在boss.json）
interface GlobalTemplates {
  initial: string;                    // 初始信息模版
  resumeReceived: string;             // 收到简历回复模版
  reject: string;                     // 拒绝信息模版
}

// 模版变量上下文
interface TemplateContext {
  name: string;                       // 候选人姓名
  jobName: string;                    // 职位名称
}

// 招聘者职位配置
interface RecruiterJobConfig {
  id: number;
  encryptJobId: string;
  jobName: string;
  templateFirstMessage: string;
  templateRejectMessage: string;
  filterMinDegree: string;
  filterMaxDegree: string;
  filterMinWorkYears: number;
  filterMaxWorkYears: number;
  filterSkillKeywords: string[];
  dailyLimit: number;
  enabled: boolean;
  templates?: RecruiterTemplate[];    // 职位级别模版
}

// 候选人信息
interface CandidateInfo {
  id: number;
  encryptUserId: string;
  name: string;
  phone: string;
  email: string;
  expectSalary: string;
  degree: string;
  school: string;
  major: string;
  workYears: number;
  skills: string[];
  workExperience: WorkExperience[];
  projectExperience: ProjectExperience[];
  source: 'chat_resume' | 'chat_input';
}

// 对话状态
type ConversationStatus = 'pending' | 'matched' | 'rejected' | 'handover';

// 处理动作
type ProcessAction = 'reply' | 'reject' | 'parse_resume' | 'skip';

// 模版导入导出格式
interface TemplateExportFormat {
  version: string;
  globalTemplates: GlobalTemplates;
  customTemplates: Array<{
    name: string;
    content: string;
  }>;
}
```

---

## 3. 消息处理流程规范

### 3.1 消息类型与处理场景

| 场景 | 触发条件 | 处理方式 |
|------|----------|----------|
| 未读新消息 | 候选人首次发消息 | 使用初始模版自动回复 |
| 未读继续沟通 | 已沟通候选人发新消息 | LLM智能回复（最多3轮） |
| 已回复继续跟进 | 已回复候选人发新消息 | LLM智能回复 |
| 超过轮次限制 | 对话超过3轮 | 停止自动回复，转人工 |

### 3.2 Tab 切换逻辑

BOSS直聘招聘端聊天页面Tab结构：**全部、未读、新招呼、更多**

```
┌─────────────────────────────────────────────┐
│  [全部]  [未读]  [新招呼]  [更多]           │
├─────────────────────────────────────────────┤
│                  消息列表                    │
└─────────────────────────────────────────────┘
```

**处理流程**：
1. **优先处理「未读」Tab**
   - 点击 Tab 元素（text为"未读"）
   - 处理该 Tab 下的所有未读消息
   - 直至「未读」Tab 为空

2. **切换到「全部」Tab**
   - 当「未读」Tab 无消息时
   - 在「全部」Tab 中筛选 `lastIsSelf=false` 的消息
   - 继续处理剩余未回复消息

3. **不处理「新招呼」Tab**
   - 该 Tab 的消息已在「未读」Tab 中处理

### 3.3 未读消息判断

```typescript
interface ChatListItem {
  name: string;              // 候选人姓名
  avatar: string;            // 头像URL
  encryptBossId: string;     // 候选人唯一标识（注意：招聘端用此字段）
  encryptJobId: string;      // 应聘职位ID
  brandName: string;         // 公司相关字段
  title: string;             // 职位标题
  unreadCount: number;       // 未读消息数量
  lastIsSelf: boolean;       // 最后一条消息是否自己发送
  lastText: string;          // 最后一条消息内容
  lastTS: number;            // 最后消息时间戳
  friendId: number;          // 好友ID
}

// 未读判断逻辑
function isUnreadMessage(item: ChatListItem): boolean {
  return item.lastIsSelf === false && item.unreadCount > 0;
}
```

### 3.4 消息优先级

**未读消息优先**：按 unreadCount 降序排列，优先处理未读数量多的消息。

### 3.5 频率限制与重试机制

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 每分钟回复上限 | 10条 | 避免触发风控 |
| 发送失败重试次数 | 3次 | 重试间隔递增 |
| 连续失败停止阈值 | 3次 | 连续失败3次自动停止任务 |

```typescript
const RATE_LIMIT = {
  maxRepliesPerMinute: 10,
  retryCount: 3,
  retryDelays: [1000, 3000, 5000], // 递增重试间隔
  consecutiveFailureThreshold: 3
};
```

### 3.6 动态扫描间隔

根据未读数量动态调整扫描频率：

| 未读数量 | 扫描间隔 | 说明 |
|----------|----------|------|
| > 10条 | 3秒 | 高频扫描 |
| 5-10条 | 5秒 | 正常扫描 |
| 1-5条 | 8秒 | 低频扫描 |
| 0条 | 30秒 | 休眠状态 |

```typescript
function getScanInterval(unreadCount: number): number {
  if (unreadCount > 10) return 3000;
  if (unreadCount > 5) return 5000;
  if (unreadCount > 0) return 8000;
  return 30000;
}
```

### 3.7 任务停止条件

| 条件 | 触发方式 | 说明 |
|------|----------|------|
| 手动停止 | 用户点击停止按钮 | 立即停止 |
| 连续失败 | 发送失败3次 | 自动停止并提示 |
| 账号受限 | 检测到风控页面 | 自动停止并提示 |

---

## 4. 已回复联系人数据收集

### 4.1 功能概述

在招聘端自动回复过程中，自动收集并保存已回复联系人的信息，便于后续跟进和统计分析。

### 4.2 数据来源

**从消息列表项获取**：
- 姓名：`name` 字段
- 候选人ID：`encryptBossId` 字段
- 职位ID：`encryptJobId` 字段

**从右侧详情面板获取**（DOM解析）：
- 公司名称
- 当前职位
- 期望薪资
- 城市/地点
- 学历
- 工作年限

### 4.3 数据库实体

```typescript
@Entity()
@Index(['encryptGeekId', 'encryptJobId'], { unique: true })
export class RecruiterContactedCandidate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  encryptGeekId: string;     // 对应 encryptBossId

  @Column()
  encryptJobId: string;

  @Column({ nullable: true })
  jobName: string;           // 应聘职位名称

  @Column({ nullable: true })
  geekName: string;          // 候选人姓名

  @Column({ nullable: true })
  companyName: string;       // 当前公司

  @Column({ nullable: true })
  position: string;          // 当前职位

  @Column({ nullable: true })
  salary: string;            // 期望薪资

  @Column({ nullable: true })
  city: string;              // 城市

  @Column({ nullable: true })
  degree: string;            // 学历

  @Column({ nullable: true, type: 'integer' })
  workYears: number;         // 工作年限

  @Column({ nullable: true, type: 'text' })
  avatarUrl: string;         // 头像URL

  @Column({ default: 0 })
  replyCount: number;        // 回复次数

  @Column({ nullable: true })
  lastReplyAt: Date;         // 最后回复时间

  @Column({ nullable: true })
  firstContactAt: Date;      // 首次联系时间

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 4.4 数据保存时机

**发送成功后保存**：消息发送成功后立即保存到数据库。

```typescript
// 发送消息
await sendMessage(page, replyContent);

// 保存已回复联系人数据
await saveContactedCandidate(page, targetChat);
```

### 4.5 DOM 数据获取

```typescript
async function getCandidateInfoFromDOM(page: Page): Promise<Partial<CandidateInfo>> {
  return await page.evaluate(() => {
    const result: any = {};

    // 从Vue组件获取
    const geekInfoVue = document.querySelector('.geek-info')?.__vue__;
    if (geekInfoVue?.geek) {
      result.name = geekInfoVue.geek.name;
      result.company = geekInfoVue.geek.company;
      result.position = geekInfoVue.geek.position;
      result.expectSalary = geekInfoVue.geek.expectSalary;
      result.city = geekInfoVue.geek.city;
      result.degree = geekInfoVue.geek.degree;
      result.workYear = geekInfoVue.geek.workYear;
    }

    return result;
  });
}
```

### 4.6 页面展示

**位置**：运行数据 > 已回复

**统计信息**：
- 今日回复数量
- LLM回复占比

**列表字段**：
| 字段 | 说明 |
|------|------|
| 姓名 | 候选人姓名 |
| 当前公司 | 候选人当前公司 |
| 当前职位 | 候选人当前职位 |
| 应聘职位 | 应聘的职位名称 |
| 期望薪资 | 候选人期望薪资 |
| 城市 | 候选人所在城市 |
| 学历 | 候选人学历 |
| 工作年限 | 候选人工作年限 |
| 回复次数 | 已回复次数 |
| 首次联系 | 首次联系时间 |
| 最后回复 | 最后回复时间 |

---

## 5. 注意事项与已知问题

### 5.1 字段映射注意事项

| 招聘端字段 | 说明 | 注意 |
|------------|------|------|
| `encryptBossId` | 候选人ID | **招聘端使用此字段**，非 encryptGeekId |
| `name` | 候选人姓名 | 从消息列表项直接获取 |
| `brandName` | 公司相关 | 可能不是候选人当前公司，需从详情面板获取 |
| `title` | 职位标题 | 可能是应聘职位名称 |

### 5.2 已知问题修复

1. **名字显示"全部"**
   - 原因：选择了错误的对象，将Tab名称误认为候选人姓名
   - 修复：确保从 `targetChat.name` 获取，而非其他字段

2. **消息列表循环问题**
   - 原因：未正确处理Tab切换
   - 修复：先处理「未读」Tab，再处理「全部」Tab

---

**文档版本**: v1.3
**创建日期**: 2026-03-25
**最后更新**: 2026-03-26

## 更新日志

### v1.2 (2026-03-26)
- 新增「已回复联系人」数据收集功能
- 新增消息处理流程规范
- 新增 Tab 切换逻辑
- 新增频率限制与重试机制
- 新增动态扫描间隔设计
- 修复候选人姓名字段获取问题

### v1.1 (2026-03-26)
- 新增「模版设置」功能详细设计
- 新增 `recruiter_template` 数据库表
- 新增模版管理 IPC 接口
- 新增模版类型定义
- 新增模版变量支持 `{name}` 和 `{jobName}`
- 新增反检测策略（自动拒绝冷却机制）
- 新增模版导入导出功能设计

---

## 6. 发送前确认模版选择功能

### 6.1 功能概述

当用户开启「发送前确认」选项时，在发送消息前弹出确认对话框，用户可选择不同的回复模版进行发送。

### 6.2 模版类型

| 模版类型 | templateType | 说明 |
|----------|--------------|------|
| 首次回复 | `initial` | 候选人首次发消息时的回复 |
| 收到简历 | `resume_received` | 确认收到候选人简历 |
| 婉拒回复 | `reject` | 婉拒候选人的回复 |

### 6.3 交互设计

#### 6.3.1 对话框形式

使用 Electron 原生对话框 `dialog.showMessageBox`，以按钮形式展示模版选项。

**按钮布局**：
```
┌─────────────────────────────────────────────────────────┐
│  选择回复模版                                            │
├─────────────────────────────────────────────────────────┤
│  是否发送快捷回复？                                       │
│                                                          │
│  {第一个模版内容预览}                                     │
├─────────────────────────────────────────────────────────┤
│  [首次回复]  [收到简历]  [婉拒回复]  [跳过]  [停止任务]   │
└─────────────────────────────────────────────────────────┘
```

#### 6.3.2 交互流程

```
检测到未读消息
       │
       ▼
┌──────────────────┐
│ 弹出确认对话框    │
│ 显示模版选择按钮  │
└────────┬─────────┘
         │
    ┌────┴────┬────────┬────────┬────────┐
    ▼         ▼        ▼        ▼        ▼
[首次回复] [收到简历] [婉拒回复] [跳过] [停止任务]
    │         │        │        │        │
    ▼         ▼        ▼        ▼        ▼
 发送模版   发送模版  发送模版  跳过当前  停止任务
    │         │        │        │
    └────────┴────────┴────────┴┘
                │
                ▼
         保存已回复联系人
```

#### 6.3.3 快捷键支持

| 快捷键 | 功能 |
|--------|------|
| Tab | 切换模版选项 |
| Enter | 确认发送当前选中的模版 |
| Esc | 取消对话框（等同于跳过） |

**注意**：由于使用 Electron 原生对话框，快捷键由系统原生支持，Tab 可在按钮间切换焦点，Enter 可激活当前焦点按钮。

### 6.4 模版数据来源

#### 6.4.1 存储位置

使用 `recruiter_template` 数据库表，通过 `templateType` 字段区分类型。

```sql
-- 查询全局模版
SELECT * FROM recruiter_template
WHERE encryptJobId IS NULL
AND templateType IN ('initial', 'resume_received', 'reject');
```

#### 6.4.2 模版优先级

当前版本仅支持**全局模版**，暂不支持职位级别模版。

### 6.5 默认值与初始状态

#### 6.5.1 默认模版内容

| 模版类型 | 默认内容 |
|----------|----------|
| 首次回复 | 你好呀，方便发一份简历吗 |
| 收到简历 | 收到您的简历了，我们会尽快查看，有结果会第一时间通知您。 |
| 婉拒回复 | 感谢您的投递，但您的经历与该职位要求不太匹配，希望您能找到更适合的机会。 |

#### 6.5.2 首次使用行为

用户首次使用时，系统自动插入以上默认模版内容到数据库。

### 6.6 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 某个模版未配置内容 | 按钮仍显示，点击后发送空内容 |
| 三个模版都未配置 | 显示提示信息，要求用户先配置模版 |
| 获取不到候选人姓名 | 对话框标题显示通用文本"发现新消息" |
| 发送失败 | 弹出错误提示，用户可重试 |
| 自动发送模式(autoSend=true) | 使用默认模版（首次回复）直接发送，不弹窗 |

### 6.7 内容限制

| 限制项 | 值 | 说明 |
|--------|-----|------|
| 模版内容长度 | 200字 | 符合BOSS直聘消息长度限制 |
| 超出处理 | 截断 | 超出部分自动截断 |

### 6.8 按钮顺序

固定顺序，从左到右：
1. 首次回复
2. 收到简历
3. 婉拒回复
4. 跳过
5. 停止任务

### 6.9 预览内容

对话框 `detail` 字段显示**第一个有内容的模版**的内容预览，帮助用户了解将发送的内容。

### 6.10 技术实现要点

#### 6.10.1 获取模版列表

```typescript
async function getGlobalTemplates(): Promise<Map<TemplateType, string>> {
  const templates = await db.getRepository(RecruiterTemplate)
    .find({
      where: {
        encryptJobId: IsNull(),
        templateType: In(['initial', 'resume_received', 'reject'])
      }
    });

  const map = new Map();
  for (const t of templates) {
    map.set(t.templateType, t.content);
  }
  return map;
}
```

#### 6.10.2 构建对话框按钮

```typescript
async function buildConfirmDialog(templates: Map<TemplateType, string>) {
  const buttons: string[] = [];

  // 按固定顺序添加模版按钮
  const templateOrder: TemplateType[] = ['initial', 'resume_received', 'reject'];
  const templateNames: Record<TemplateType, string> = {
    'initial': '首次回复',
    'resume_received': '收到简历',
    'reject': '婉拒回复'
  };

  // 添加模版按钮
  for (const type of templateOrder) {
    buttons.push(templateNames[type]);
  }

  // 添加操作按钮
  buttons.push('跳过', '停止任务');

  // 获取预览内容（第一个有内容的模版）
  let previewContent = '';
  for (const type of templateOrder) {
    const content = templates.get(type);
    if (content) {
      previewContent = content;
      break;
    }
  }

  return {
    type: 'question' as const,
    message: '发现新消息',
    detail: `是否发送快捷回复？\n\n${previewContent}`,
    buttons,
    defaultId: 0,  // 默认选中"首次回复"
    cancelId: 3    // ESC键对应"跳过"
  };
}
```

#### 6.10.3 处理用户选择

```typescript
async function handleDialogResponse(
  response: number,
  templates: Map<TemplateType, string>
): Promise<{ action: string; content?: string }> {
  const templateOrder: TemplateType[] = ['initial', 'resume_received', 'reject'];

  if (response < 3) {
    // 用户选择了模版按钮
    const templateType = templateOrder[response];
    return {
      action: 'send',
      content: templates.get(templateType) || ''
    };
  } else if (response === 3) {
    // 跳过
    return { action: 'skip' };
  } else {
    // 停止任务
    return { action: 'stop' };
  }
}
```

### 6.11 自动模式行为

当 `autoSend = true` 时：
- 不弹出确认对话框
- 直接使用默认模版（首次回复）发送
- 若默认模版为空，使用第一个有内容的模版

```typescript
if (cfg.autoSend) {
  // 自动模式：使用默认模版直接发送
  const content = templates.get('initial') || getFirstAvailableTemplate(templates);
  if (content) {
    await sendMessage(page, content);
  }
} else if (cfg.confirmBeforeSend) {
  // 确认模式：弹出对话框让用户选择
  const result = await showTemplateSelectDialog(templates);
  // ...
}
```

### 6.12 后续迭代计划

| 版本 | 功能 |
|------|------|
| v1.1 | 支持职位级别模版优先 |
| v1.2 | 支持自定义模版在确认对话框中显示 |
| v1.3 | 支持模版变量替换 |

---

**文档版本**: v1.3
**创建日期**: 2026-03-25
**最后更新**: 2026-03-26

## 更新日志

### v1.3 (2026-03-26)
- 新增「发送前确认模版选择」功能详细设计
- 新增三种模版类型（首次回复、收到简历、婉拒回复）
- 新增对话框交互设计（按钮即模版）
- 新增快捷键支持说明
- 新增边界情况处理规范
- 新增默认模版内容
- 新增自动模式行为说明

---

## 7. 智能回复功能

### 7.1 功能概述

智能回复是一个独立于招聘端自动回复的功能模块，通过大语言模型自动分析候选人消息并生成精准回复。该功能根据用户配置的公司简介和岗位说明，智能回答候选人关于公司、职位的问题。

### 7.2 功能定位

- **独立模块**：与招聘端自动回复独立，单独运行
- **登录方式**：复用现有 BOSS Cookie 登录机制
- **职位选择**：自动选择第一个发布的职位进行监控

### 7.3 导航结构调整

#### 7.3.1 新增导航项

在左侧导航栏「逛BOSS」分组中新增「智能回复」入口，位于「招聘端自动回复」之后。

```
逛BOSS
├── 自动开聊
├── 已读不回自动复聊
├── 招聘端自动回复
├── 智能回复  ← 新增
├── 编辑登录凭据
└── 手动逛
```

#### 7.3.2 运行数据导航调整

在「运行数据」分组中新增「智能回复数据」入口。

```
运行数据
├── 开聊记录
├── 标记不合适记录
├── 职位库
├── 已回复
└── 智能回复数据  ← 新增
```

### 7.4 智能回复配置页面

#### 7.4.1 页面结构

```
智能回复配置页面
├── 基础设置（Collapse）
│   ├── 自动发送开关
│   ├── 发送前确认开关
│   └── 扫描间隔设置
├── 公司信息配置（Collapse）
│   ├── 公司简介（textarea）
│   └── 公司文化/福利说明（textarea，可选）
├── 岗位说明配置（Collapse）
│   ├── 岗位名称（自动获取/手动填写）
│   ├── 岗位职责（textarea）
│   └── 任职要求（textarea）
├── 大模型配置（Collapse）
│   ├── 系统提示词模板（textarea，可修改）
│   └── 重置为默认模板按钮
├── 风险提示（Alert）
│   ├── 大模型回复可能不准确
│   ├── 频繁自动回复可能触发平台风控
│   └── API密钥安全提示
└── 操作按钮
    └── 保存配置并运行
```

#### 7.4.2 配置项详情

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| 自动发送 | boolean | false | 自动发送大模型回复 |
| 发送前确认 | boolean | true | 弹窗确认后发送 |
| 扫描间隔 | number | 5 | 单位：秒 |
| 公司简介 | string | "" | 公司基本介绍 |
| 岗位说明 | string | "" | 职位详细说明 |
| 系统提示词 | string | 见7.4.3 | 可自定义修改 |

#### 7.4.3 默认系统提示词模板

```
你是一个专业的招聘助手，代表公司回答候选人的问题。

## 公司信息
{公司简介}

## 岗位说明
{岗位说明}

## 回复规则
1. 回答要简洁专业，不超过200字
2. 请用中文回复
3. 如果不确定答案，请返回JSON格式：{"reply": "", "isClear": false}
4. 如果确定答案，请返回JSON格式：{"reply": "你的回复内容", "isClear": true}
```

#### 7.4.4 配置存储

配置存储在 `boss.json` 文件中，新增 `smartReply` 字段：

```json
{
  "smartReply": {
    "autoSend": false,
    "confirmBeforeSend": true,
    "scanIntervalSeconds": 5,
    "companyIntro": "公司简介内容...",
    "jobDescription": "岗位说明内容...",
    "systemPrompt": "自定义提示词..."
  }
}
```

### 7.5 核心处理流程

#### 7.5.1 主流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        智能回复主流程                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │  启动    │───▶│  Cookie  │───▶│  监控    │───▶│  检测    │      │
│  │  任务    │    │  登录    │    │  消息    │    │  未读    │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │
│                                                       │              │
│                                                       ▼              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │  下一个  │◀───│  记录    │◀───│  发送    │◀───│  判断    │      │
│  │  候选人  │    │  数据    │    │  回复    │    │  流程    │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.5.2 消息处理流程

```
检测到未读消息
       │
       ▼
┌──────────────────┐     是      ┌──────────────────┐
│ 消息长度 < 5字符？ │────────────▶│ 跳过，不回复      │
└────────┬─────────┘              └──────────────────┘
         │ 否
         ▼
┌──────────────────┐     是      ┌──────────────────┐
│ 包含敏感词？      │────────────▶│ 跳过，不回复      │
└────────┬─────────┘              └──────────────────┘
         │ 否
         ▼
┌──────────────────┐     是      ┌──────────────────┐
│ 已读不回？        │────────────▶│ 跳过，不回复      │
└────────┬─────────┘              └──────────────────┘
         │ 否
         ▼
┌──────────────────┐
│ 检查回复次数      │
│ (当前会话)        │
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  < 3次     >= 3次
    │         │
    ▼         ▼
┌─────────┐ ┌──────────────────┐
│ 调用LLM │ │ 跳过，不回复      │
│ 生成回复 │ └──────────────────┘
└────┬────┘
     │
     ▼
┌──────────────────┐     否      ┌──────────────────┐
│ isClear = true？  │────────────▶│ 跳过，不回复      │
└────────┬─────────┘              └──────────────────┘
         │ 是
         ▼
┌──────────────────┐
│ 随机延迟 1-3秒   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     是      ┌──────────────────┐
│ 自动发送模式？    │────────────▶│ 直接发送          │
└────────┬─────────┘              └──────────────────┘
         │ 否
         ▼
┌──────────────────┐
│ 弹窗确认          │
│ 用户选择发送/跳过 │
└────────┬─────────┘
         │ 发送
         ▼
┌──────────────────┐
│ 发送回复消息      │
│ 记录到数据库      │
└──────────────────┘
```

### 7.6 关键规则

#### 7.6.1 回复次数限制

- **限制次数**：每个候选人每个会话最多回复 3 次
- **会话定义**：每次启动智能回复任务为一个新会话
- **计数维度**：按候选人独立计数，不区分职位

#### 7.6.2 不触发回复的条件

| 条件 | 说明 |
|------|------|
| 消息长度 < 5 字符 | 过短消息不回复 |
| 包含敏感词 | 预设敏感词列表（政治/脏话） |
| 已读不回 | 候选人已读但未回复 |
| 回复次数 >= 3 | 当前会话已回复超过3次 |
| isClear = false | 大模型判断不清楚用户问题 |

#### 7.6.3 大模型调用规范

**输入内容**：
- 系统提示词（包含公司简介、岗位说明）
- 最近 5 条历史消息

**返回格式**：
```json
{
  "reply": "回复内容",
  "isClear": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| reply | string | 大模型生成的回复内容 |
| isClear | boolean | 是否清楚用户问题 |

**示例**：
```json
// 清楚用户问题
{
  "reply": "我们公司主要做电商业务，技术栈使用Vue3和Node.js，团队规模在50人左右。",
  "isClear": true
}

// 不清楚用户问题
{
  "reply": "",
  "isClear": false
}
```

#### 7.6.4 回复延迟

- **延迟范围**：1-3 秒随机
- **目的**：模拟人工回复，降低风控风险

#### 7.6.5 失败处理

| 失败类型 | 处理方式 |
|----------|----------|
| 大模型调用失败 | 重试 1 次后跳过 |
| 网络错误 | 重试 1 次后跳过 |
| 发送失败 | 记录日志，跳过继续下一个 |

### 7.7 数据存储

#### 7.7.1 数据库表设计

**智能回复记录表 `smart_reply_record`**：

```sql
CREATE TABLE smart_reply_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id VARCHAR(64) NOT NULL,            -- 会话ID（启动任务时生成）
  encrypt_geek_id VARCHAR(64) NOT NULL,       -- 候选人ID
  geek_name VARCHAR(64),                       -- 候选人姓名
  encrypt_job_id VARCHAR(64),                  -- 职位ID
  job_name VARCHAR(128),                       -- 职位名称
  degree VARCHAR(32),                          -- 学历
  work_years INTEGER,                          -- 工作年限
  reply_count INTEGER DEFAULT 0,               -- 智能体回复次数
  last_llm_reply TEXT,                         -- 最后一次大模型回复内容
  conversation_history TEXT,                   -- 对话历史JSON
  first_reply_at DATETIME,                     -- 首次回复时间
  last_reply_at DATETIME,                      -- 最后回复时间
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, encrypt_geek_id)
);
```

#### 7.7.2 数据存储内容

| 字段 | 说明 |
|------|------|
| 候选人基本信息 | 姓名、应聘岗位、学历、工作经验 |
| 智能体回复次数 | 当前会话内的回复次数 |
| 最后一次大模型回复内容 | 最近一次 LLM 生成的回复 |
| 对话历史 | 完整的对话记录 JSON |

### 7.8 智能回复数据页面

#### 7.8.1 列表字段

| 字段 | 说明 |
|------|------|
| 姓名 | 候选人姓名 |
| 应聘岗位 | 应聘的职位名称 |
| 学历 | 候选人学历 |
| 工作经验 | 候选人工作年限 |
| 智能体回复次数 | 当前会话的回复次数 |
| 最后一次大模型回复 | 最近一次 LLM 回复内容摘要 |
| 最后回复时间 | 最后回复的时间 |

#### 7.8.2 筛选条件

- 会话选择（按启动任务时间）
- 候选人姓名搜索
- 回复次数筛选

### 7.9 弹窗确认交互

#### 7.9.1 对话框结构

```
┌─────────────────────────────────────────────────────────┐
│  智能回复建议                                            │
├─────────────────────────────────────────────────────────┤
│  候选人：{姓名}                                          │
│  消息：{候选人消息内容}                                   │
├─────────────────────────────────────────────────────────┤
│  建议回复：                                              │
│  {大模型生成的回复内容}                                   │
├─────────────────────────────────────────────────────────┤
│  [发送]  [跳过]  [停止任务]                              │
└─────────────────────────────────────────────────────────┘
```

#### 7.9.2 按钮说明

| 按钮 | 功能 |
|------|------|
| 发送 | 发送建议回复内容 |
| 跳过 | 不回复，处理下一个候选人 |
| 停止任务 | 停止智能回复任务 |

### 7.10 敏感词列表

预设敏感词类别：
- 政治敏感词
- 脏话/侮辱性词汇
- 违法违规词汇

敏感词列表存储在配置文件中，可后续扩展。

### 7.11 风险提示

在智能回复配置页面顶部显示以下风险提示：

1. **回复准确性提示**：大模型回复可能不准确，建议开启「发送前确认」进行人工审核
2. **平台风控提示**：频繁自动回复可能触发平台风控机制，导致账号受限
3. **API密钥安全提示**：请妥善保管大模型 API 密钥，避免泄露

### 7.12 技术实现要点

#### 7.12.1 子程序入口

创建独立子程序入口文件：
```
packages/ui/src/main/flow/SMART_REPLY_MAIN/
├── index.ts              # 主流程入口
├── bootstrap.ts          # 启动逻辑（复用招聘端）
├── message-monitor.ts    # 消息监控
├── llm-reply.ts          # 大模型回复生成
└── sensitive-words.ts    # 敏感词检测
```

#### 7.12.2 大模型调用

复用现有 LLM 配置（`llm.json`），调用对话补全 API。

```typescript
async function generateReply(
  companyIntro: string,
  jobDescription: string,
  historyMessages: Message[],
  candidateMessage: string
): Promise<{ reply: string; isClear: boolean }> {
  const systemPrompt = buildSystemPrompt(companyIntro, jobDescription);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...historyMessages.slice(-5), // 最近5条历史消息
    { role: 'user', content: candidateMessage }
  ];

  const response = await callLLM(messages);
  return JSON.parse(response);
}
```

#### 7.12.3 敏感词检测

```typescript
const SENSITIVE_WORDS = [
  // 政治敏感词
  // 脏话
  // ...
];

function containsSensitiveWord(text: string): boolean {
  const lowerText = text.toLowerCase();
  return SENSITIVE_WORDS.some(word => lowerText.includes(word.toLowerCase()));
}
```

### 7.13 后续迭代计划

| 版本 | 功能 |
|------|------|
| v1.1 | 支持多职位监控 |
| v1.2 | 支持自定义敏感词列表 |
| v1.3 | 支持对话历史详情查看 |
| v1.4 | 支持导出智能回复数据 |

---

## 8. 推荐牛人简历分析收藏

### 8.1 功能概述

利用 BOSS 直聘招聘端「推荐牛人」页面，自动浏览平台推荐的候选人简历卡片，通过截图 + Qwen3-VL 视觉模型进行智能分析评分，自动收藏符合岗位要求的高分候选人。

### 8.2 功能定位

- **独立模块**：与招聘端自动回复、智能回复独立，单独运行
- **登录方式**：复用现有 BOSS Cookie 登录机制
- **分析模型**：Qwen3-VL（视觉语言模型），分析简历截图
- **核心价值**：批量自动筛选平台推荐候选人，减少人工浏览成本

### 8.3 导航结构调整

#### 8.3.1 新增导航项

在左侧导航栏「逛BOSS」分组中新增「推荐牛人」入口，位于「智能回复」之后。

```
逛BOSS
├── 自动开聊
├── 已读不回自动复聊
├── 招聘端自动回复
├── 智能回复
├── 推荐牛人  ← 新增
├── 编辑登录凭据
└── 手动逛
```

#### 8.3.2 运行数据导航调整

在「运行数据」分组中新增「推荐牛人数据」入口。

```
运行数据
├── 开聊记录
├── 标记不合适记录
├── 职位库
├── 已回复
├── 智能回复数据
└── 推荐牛人数据  ← 新增
```

### 8.4 两级筛选架构

采用「规则预筛选 + VL 深度分析」两级筛选，减少大模型调用次数，提升处理效率。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        两级筛选架构                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  第一级：规则预筛选（零成本）                                   │   │
│  │  ├── 活跃度过滤：最近活跃时间 <= 配置阈值                       │     │
│  │  ├── 求职意向过滤：是否在看机会                                 │     │
│  │  └── 快速属性匹配：薪资范围、城市、学历（从卡片DOM直接获取）     │   │
│  └──────────────────────┬───────────────────────────────────────┘   │
│                         │ 通过                                       │
│                         ▼                                            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  第二级：VL 深度分析（Qwen3-VL）                                │   │
│  │  ├── 截图简历卡片                                               │   │
│  │  ├── 视觉模型分析工作经历、项目经验、技能栈                      │   │
│  │  ├── 岗位级评分提示词自动生成评分标准                            │   │
│  │  └── 输出：评分 + 是否推荐 + 推荐理由                           │   │
│  └──────────────────────┬───────────────────────────────────────┘   │
│                         │ 评分 >= 阈值                               │
│                         ▼                                            │
│                  收藏候选人                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.5 核心处理流程

#### 8.5.1 主流程图

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  启动    │───▶│  Cookie  │───▶│  选择    │───▶│  进入    │
│  任务    │    │  登录    │    │  职位    │    │  推荐    │
└──────────┘    └──────────┘    └──────────┘    │  牛人页  │
                                                 └────┬─────┘
                                                      │
                                                      ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  收藏    │◀───│  VL深度  │◀───│  规则    │◀───│  滚动    │
│  候选人  │    │  分析    │    │  预筛选  │    │  加载    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                      │
                                                      ▼
                                              ┌──────────┐
                                              │  下一页  │
                                              │  或结束  │
                                              └──────────┘
```

#### 8.5.2 单个候选人处理流程

```
滚动加载候选人卡片
       │
       ▼
┌──────────────────┐
│ 获取卡片DOM数据    │
│ - 姓名/活跃时间   │
│ - 求职意向状态    │
│ - 薪资/城市/学历  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     不通过    ┌──────────────────┐
│ 规则预筛选         │────────────▶│ 跳过，记录日志    │
│ - 活跃度检查      │              └──────────────────┘
│ - 薪资范围匹配    │
│ - 城市匹配        │
│ - 学历匹配        │
└────────┬─────────┘
         │ 通过
         ▼
┌──────────────────┐     是      ┌──────────────────┐
│ 检测验证码？       │───────────▶│ 暂停任务          │
└────────┬─────────┘             │ 通知用户介入      │
         │ 否                     └──────────────────┘
         ▼
┌──────────────────┐
│ 截图候选人卡片    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Qwen3-VL 分析    │
│ - 工作经历评估    │
│ - 技能匹配度      │
│ - 项目经验评估    │
│ - 综合评分        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     否      ┌──────────────────┐
│ 评分 >= 阈值？    │───────────▶│ 记录分析结果      │
└────────┬─────────┘             │ 跳过收藏          │
         │ 是                    └──────────────────┘
         ▼
┌──────────────────┐
│ 点击收藏按钮      │
│ 保存分析数据      │
│ 保存断点信息      │
└──────────────────┘
```

### 8.6 岗位自动切换

#### 8.6.1 功能概述

启动推荐牛人分析任务时，自动将 Boss 直聘推荐牛人页面上的岗位下拉框切换到用户配置的目标岗位，确保扫描的候选人对应正确的岗位。

#### 8.6.2 交互流程

```
启动任务 → 加载岗位配置 → 打开推荐牛人页面
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ 点击当前选中岗位   │
                              │ 展开下拉列表       │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ 遍历所有 li.job-item │
                              │ 提取文本并匹配     │
                              └────────┬─────────┘
                                       │
                              ┌────────┴─────────┐
                              │                   │
                         匹配成功              匹配失败
                              │                   │
                              ▼                   ▼
                    ┌──────────────────┐  ┌──────────────────┐
                    │ 点击目标岗位      │  │ 弹窗报错         │
                    │ 等待候选人加载    │  │ 显示可用岗位列表  │
                    │ 继续分析流程      │  │ 终止任务          │
                    └──────────────────┘  └──────────────────┘
```

#### 8.6.3 Boss 页面下拉框 DOM 结构

```html
<div class="job-selecter-options">
  <ul class="job-list">
    <li value="xxx" class="job-item curr">           <!-- curr = 当前选中 -->
      <span class="label">AI自动化开发程序员 _ 深圳  6-10K</span>
    </li>
    <li value="yyy" class="job-item">
      <span class="label">硬件项目经理 _ 深圳  10-12K</span>
    </li>
  </ul>
</div>
```

- 点击 `li.job-item.curr` 展开下拉列表
- 目标选项文本格式：`岗位名 _ 城市  薪资`
- 切换后 URL 不变，页面内容异步刷新

#### 8.6.4 匹配策略

| 策略 | 说明 |
|------|------|
| 双向包含匹配 | `配置名.contains(选项文本) || 选项文本.contains(配置名)` |
| 匹配结果 | 取第一个匹配到的选项 |
| 已选中判断 | 如果目标选项已有 `curr` 类，跳过点击 |

#### 8.6.5 实现细节

**切换时机**：在 mainLoop 的 `for (const jobConfig of matchedJobConfigs)` 循环内，checkpoint 加载之前执行。

**文件位置**：`packages/ui/src/main/flow/RECOMMEND_TALENT_MAIN/job-fetcher.ts` → `switchToJob(page, jobName)`

**等待策略**：切换后轮询候选人卡片 DOM 出现（超时10秒），确认页面已刷新。

**错误处理**：

| 场景 | 处理方式 |
|------|----------|
| 页面无 `li.job-item.curr` 元素 | 抛出错误，弹窗提示页面结构可能已变更 |
| 配置的岗位名不在下拉列表中 | 弹窗显示可用岗位列表，终止任务 |
| 切换后候选人未加载 | 记录日志，继续执行（扫描环节有重试逻辑） |

#### 8.6.6 UI 变更

岗位选择从多选（checkbox）改为单选（radio），每次启动只分析一个岗位。

### 8.7 岗位级评分提示词自动生成

#### 8.7.1 设计思路

根据用户配置的岗位信息（岗位职责 + 任职要求），自动生成针对性的 VL 分析提示词，使评分标准与岗位需求精准匹配。

#### 8.7.2 提示词模板

```
你是一个专业的招聘分析师，请根据以下岗位要求分析候选人简历截图。

## 岗位信息
- 职位名称：{jobName}
- 岗位职责：{jobResponsibilities}
- 任职要求：{jobRequirements}

## 分析维度与评分规则
请从以下维度逐一评估，每项 1-10 分：

1. **工作经历匹配度**（权重30%）
   - 行业经验是否相关
   - 公司规模/类型是否匹配
   - 岗位层级是否合适

2. **技术技能匹配度**（权重30%）
   - 核心技能覆盖程度
   - 技术栈与岗位要求一致性
   - 技能深度评估

3. **项目经验质量**（权重20%）
   - 项目复杂度和规模
   - 项目与岗位相关性
   - 项目成果/业绩

4. **综合素质**（权重20%）
   - 学历背景
   - 职业发展轨迹
   - 稳定性评估

## 输出格式
请严格返回以下JSON格式：
```json
{
  "workMatch": 8,
  "skillMatch": 7,
  "projectQuality": 6,
  "overallQuality": 8,
  "totalScore": 7.4,
  "recommend": true,
  "reason": "简要推荐/不推荐理由，50字以内",
  "keyStrengths": ["优势1", "优势2"],
  "concerns": ["顾虑1"]
}
```

## 评分说明
- totalScore = workMatch * 0.3 + skillMatch * 0.3 + projectQuality * 0.2 + overallQuality * 0.2
- recommend = true 当 totalScore >= {scoreThreshold}
- reason 控制在 50 字以内
- keyStrengths 最多 3 条
- concerns 最多 2 条
```

#### 8.7.3 提示词生成逻辑

```typescript
function buildScoringPrompt(jobConfig: RecommendJobConfig): string {
  const template = SCORE_PROMPT_TEMPLATE;
  return template
    .replace('{jobName}', jobConfig.jobName)
    .replace('{jobResponsibilities}', jobConfig.jobResponsibilities)
    .replace('{jobRequirements}', jobConfig.jobRequirements)
    .replace('{scoreThreshold}', String(jobConfig.scoreThreshold));
}
```

### 8.8 规则预筛选设计

#### 8.8.1 预筛选项

| 筛选维度 | 配置字段 | 数据来源 | 说明 |
|----------|----------|----------|------|
| 最近活跃 | `activeWithinDays` | 卡片DOM | 最近N天内活跃 |
| 求职状态 | `requireJobSeeking` | 卡片DOM | 是否在看机会 |
| 最低学历 | `minDegree` | 卡片DOM | 学历枚举值 |
| 薪资范围 | `salaryMin` / `salaryMax` | 卡片DOM | 期望薪资区间 |
| 城市 | `targetCities` | 卡片DOM | 目标城市列表 |
| 工作年限 | `minWorkYears` / `maxWorkYears` | 卡片DOM | 年限范围 |

#### 8.8.2 预筛选逻辑

```typescript
function preFilterCandidate(card: CandidateCard, config: RecommendJobConfig): boolean {
  // 活跃度检查
  if (card.activeDaysAgo > config.activeWithinDays) return false;

  // 求职状态检查
  if (config.requireJobSeeking && !card.isJobSeeking) return false;

  // 学历检查
  if (config.minDegree && degreeOrder(card.degree) < degreeOrder(config.minDegree)) return false;

  // 薪资范围检查
  if (config.salaryMin && card.expectedSalary < config.salaryMin) return false;
  if (config.salaryMax && card.expectedSalary > config.salaryMax) return false;

  // 城市检查
  if (config.targetCities.length > 0 && !config.targetCities.includes(card.city)) return false;

  // 工作年限检查
  if (config.minWorkYears && card.workYears < config.minWorkYears) return false;
  if (config.maxWorkYears && card.workYears > config.maxWorkYears) return false;

  return true;
}
```

### 8.9 断点续传机制

#### 8.9.1 设计思路

推荐牛人列表可能包含大量候选人，任务可能因网络中断、验证码、手动停止等原因中断。断点续传机制确保任务恢复后不重复处理已分析的候选人。

#### 8.9.2 断点数据结构

每次成功处理一个候选人后保存断点：

```typescript
interface RunCheckpoint {
  id: number;
  sessionId: string;            // 本次运行唯一ID
  encryptJobId: string;         // 当前处理的职位ID
  currentPage: number;          // 当前页码
  currentPageOffset: number;    // 当前页内处理偏移量
  processedCount: number;       // 已处理总数
  matchedCount: number;         // 匹配成功数
  skippedCount: number;         // 预筛选跳过数
  lastProcessedUserId: string;  // 最后处理的候选人ID（去重依据）
  status: 'running' | 'paused' | 'completed' | 'error';
  errorMessage: string | null;
  updatedAt: Date;
}
```

#### 8.9.3 恢复逻辑

```
任务启动
       │
       ▼
┌──────────────────┐     存在     ┌──────────────────┐
│ 检查断点记录？    │────────────▶│ 加载断点数据      │
└────────┬─────────┘             └────────┬─────────┘
         │ 不存在                         │
         ▼                                ▼
┌──────────────────┐             ┌──────────────────┐
│ 从首页开始        │             │ 跳转到断点页码    │
│ 创建新断点        │             │ 跳过已处理候选人  │
└──────────────────┘             └──────────────────┘
                                          │
                                          ▼
                                   继续处理后续候选人
```

#### 8.9.4 去重机制

使用 `lastProcessedUserId` + 数据库已处理记录双重去重：
1. 断点恢复时，跳过 `lastProcessedUserId` 及之前的候选人
2. 每个候选人处理前查询数据库，确认该 `encryptUserId` 在当前 `sessionId` 下未被处理

### 8.10 验证码异常检测与处理

#### 8.10.1 检测方式

```typescript
async function detectCaptcha(page: Page): Promise<boolean> {
  // 检测常见验证码元素
  const captchaSelectors = [
    '.captcha-container',
    '#captcha',
    '.verify-wrap',
    'iframe[src*="captcha"]',
    '.geetest_holder'
  ];

  for (const selector of captchaSelectors) {
    const element = await page.$(selector);
    if (element) return true;
  }

  // 检测页面URL变化（跳转到验证页面）
  const url = page.url();
  if (url.includes('captcha') || url.includes('verify') || url.includes('security-check')) {
    return true;
  }

  return false;
}
```

#### 8.10.2 处理流程

```
检测到验证码
       │
       ▼
┌──────────────────┐
│ 保存断点          │
│ 暂停任务          │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 弹出通知（Electron Notification）│
│ 标题：需要手动处理验证码          │
│ 正文：请前往浏览器手动完成验证    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 等待用户确认      │
│ 用户完成验证后    │
│ 点击「继续运行」  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 加载断点恢复任务  │
└──────────────────┘
```

### 8.11 数据库设计

#### 8.11.1 推荐牛人岗位配置表 `recommend_job_config`

```sql
CREATE TABLE recommend_job_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_job_id VARCHAR(64) NOT NULL UNIQUE,   -- BOSS直聘职位ID
  job_name VARCHAR(128) NOT NULL,               -- 职位名称
  job_responsibilities TEXT,                     -- 岗位职责
  job_requirements TEXT,                         -- 任职要求
  score_threshold DECIMAL(3,1) DEFAULT 7.0,      -- 推荐评分阈值（1-10）
  active_within_days INTEGER DEFAULT 30,         -- 最近活跃天数
  require_job_seeking BOOLEAN DEFAULT 1,         -- 是否要求在看机会
  min_degree VARCHAR(32),                        -- 最低学历
  salary_min INTEGER,                            -- 最低期望薪资（K/月）
  salary_max INTEGER,                            -- 最高期望薪资（K/月）
  target_cities TEXT,                            -- 目标城市JSON数组
  min_work_years INTEGER DEFAULT 0,              -- 最小工作年限
  max_work_years INTEGER DEFAULT 99,             -- 最大工作年限
  max_collect_per_job INTEGER DEFAULT 20,        -- 每职位最大收藏数
  enabled BOOLEAN DEFAULT 1,                     -- 是否启用
  scoring_prompt TEXT,                           -- 自定义评分提示词（为空则自动生成）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 8.11.2 推荐候选人表 `recommend_candidate`

```sql
CREATE TABLE recommend_candidate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id VARCHAR(64) NOT NULL,               -- 运行会话ID
  encrypt_user_id VARCHAR(64) NOT NULL,          -- 候选人ID
  encrypt_job_id VARCHAR(64) NOT NULL,           -- 职位ID
  job_name VARCHAR(128),                         -- 职位名称
  geek_name VARCHAR(64),                         -- 候选人姓名
  avatar_url TEXT,                               -- 头像URL
  degree VARCHAR(32),                            -- 学历
  work_years INTEGER,                            -- 工作年限
  city VARCHAR(64),                              -- 城市
  expected_salary VARCHAR(64),                   -- 期望薪资
  current_company VARCHAR(128),                  -- 当前公司
  current_position VARCHAR(128),                 -- 当前职位
  active_status VARCHAR(32),                     -- 活跃状态文本
  is_job_seeking BOOLEAN,                        -- 是否在看机会
  total_score DECIMAL(3,1),                      -- 综合评分
  work_match_score DECIMAL(3,1),                 -- 工作经历匹配分
  skill_match_score DECIMAL(3,1),                -- 技能匹配分
  project_quality_score DECIMAL(3,1),            -- 项目经验质量分
  overall_quality_score DECIMAL(3,1),            -- 综合素质分
  recommend BOOLEAN,                             -- 是否推荐
  reason TEXT,                                   -- 推荐/不推荐理由
  key_strengths TEXT,                            -- 优势JSON数组
  concerns TEXT,                                 -- 顾虑JSON数组
  is_collected BOOLEAN DEFAULT 0,                -- 是否已收藏
  snapshot_id INTEGER,                           -- 关联截图记录ID
  pre_filter_passed BOOLEAN DEFAULT 1,           -- 是否通过预筛选
  pre_filter_fail_reason VARCHAR(256),           -- 预筛选未通过原因
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, encrypt_user_id, encrypt_job_id)
);

CREATE INDEX idx_recommend_candidate_session ON recommend_candidate(session_id);
CREATE INDEX idx_recommend_candidate_job ON recommend_candidate(encrypt_job_id);
CREATE INDEX idx_recommend_candidate_score ON recommend_candidate(total_score DESC);
```

#### 8.11.3 简历截图记录表 `recommend_resume_snapshot`

```sql
CREATE TABLE recommend_resume_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,                 -- 关联候选人记录ID
  encrypt_user_id VARCHAR(64) NOT NULL,          -- 候选人ID
  snapshot_path TEXT NOT NULL,                   -- 截图文件本地路径
  snapshot_size INTEGER,                         -- 截图文件大小（字节）
  vl_raw_response TEXT,                          -- VL模型原始返回内容
  vl_request_tokens INTEGER,                     -- 请求token数
  vl_response_tokens INTEGER,                    -- 响应token数
  vl_duration_ms INTEGER,                        -- VL调用耗时（毫秒）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES recommend_candidate(id)
);

CREATE INDEX idx_snapshot_candidate ON recommend_resume_snapshot(encrypt_user_id);
```

#### 8.11.4 运行断点表 `recommend_run_checkpoint`

```sql
CREATE TABLE recommend_run_checkpoint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id VARCHAR(64) NOT NULL UNIQUE,        -- 运行会话ID
  encrypt_job_id VARCHAR(64) NOT NULL,           -- 当前处理职位ID
  current_page INTEGER DEFAULT 1,                -- 当前页码
  current_page_offset INTEGER DEFAULT 0,         -- 当前页内偏移
  processed_count INTEGER DEFAULT 0,             -- 已处理总数
  matched_count INTEGER DEFAULT 0,               -- 匹配成功数
  skipped_count INTEGER DEFAULT 0,               -- 预筛选跳过数
  collected_count INTEGER DEFAULT 0,             -- 已收藏数
  last_processed_user_id VARCHAR(64),            -- 最后处理的候选人ID
  status VARCHAR(32) DEFAULT 'running',          -- running/paused/completed/error
  error_message TEXT,                            -- 错误信息
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 启动时间
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 8.12 配置存储

#### 8.12.1 boss.json 新增字段

```json
{
  "recommendTalent": {
    "scanIntervalSeconds": 3,
    "scrollDelayMin": 1000,
    "scrollDelayMax": 3000,
    "vlModel": "qwen-vl-max",
    "vlApiTimeout": 30000,
    "snapshotDir": "snapshots/recommend",
    "autoCollectThreshold": 7.0,
    "maxCollectPerRun": 50,
    "pauseOnCaptcha": true,
    "notifyOnCaptcha": true
  }
}
```

### 8.13 子程序入口

```
packages/ui/src/main/flow/RECOMMEND_TALENT_MAIN/
├── index.ts              # 主流程入口
├── bootstrap.ts          # 启动逻辑（Cookie登录、页面初始化）
├── page-scanner.ts       # 页面滚动扫描、卡片DOM数据提取
├── pre-filter.ts         # 规则预筛选
├── job-fetcher.ts        # 岗位切换（DOM交互、匹配、切换）
├── screenshot.ts         # 截图管理（截取、存储、清理）
├── vl-analyzer.ts        # Qwen3-VL 视觉模型调用与分析
├── prompt-builder.ts     # 岗位级评分提示词自动生成
├── checkpoint.ts         # 断点续传管理
├── captcha-detector.ts   # 验证码检测
└── collector.ts          # 收藏操作
```

### 8.14 IPC 通信接口

```typescript
// 启动推荐牛人分析任务
ipcMain.handle('run-recommend-talent', params: {
  encryptJobIds: string[]     // 要分析的职位ID列表
}): Promise<{ sessionId: string }>

// 停止任务
ipcMain.handle('stop-recommend-talent'): Promise<void>

// 获取运行状态
ipcMain.handle('get-recommend-talent-status', sessionId: string): Promise<{
  status: string
  processedCount: number
  matchedCount: number
  collectedCount: number
  skippedCount: number
  currentPage: number
}>

// 继续运行（验证码处理后）
ipcMain.handle('resume-recommend-talent', sessionId: string): Promise<void>

// 获取岗位配置列表
ipcMain.handle('recommend-get-job-configs'): Promise<RecommendJobConfig[]>

// 保存岗位配置
ipcMain.handle('recommend-save-job-config', config: RecommendJobConfig): Promise<void>

// 删除岗位配置
ipcMain.handle('recommend-delete-job-config', id: number): Promise<void>

// 获取推荐候选人列表
ipcMain.handle('recommend-get-candidates', params: {
  sessionId?: string
  encryptJobId?: string
  minScore?: number
  recommendOnly?: boolean
  page: number
  pageSize: number
}): Promise<{ list: RecommendCandidate[]; total: number }>

// 获取截图详情
ipcMain.handle('recommend-get-snapshot', snapshotId: number): Promise<{
  imagePath: string
  vlAnalysis: string
}>

// 导出推荐数据
ipcMain.handle('recommend-export-candidates', params: {
  sessionId: string
  format: 'json' | 'csv'
}): Promise<string>
```

### 8.15 类型定义

```typescript
// 推荐牛人岗位配置
interface RecommendJobConfig {
  id: number;
  encryptJobId: string;
  jobName: string;
  jobResponsibilities: string;
  jobRequirements: string;
  scoreThreshold: number;
  activeWithinDays: number;
  requireJobSeeking: boolean;
  minDegree: string;
  salaryMin: number | null;
  salaryMax: number | null;
  targetCities: string[];
  minWorkYears: number;
  maxWorkYears: number;
  maxCollectPerJob: number;
  enabled: boolean;
  scoringPrompt: string | null;
}

// 推荐候选人
interface RecommendCandidate {
  id: number;
  sessionId: string;
  encryptUserId: string;
  encryptJobId: string;
  jobName: string;
  geekName: string;
  avatarUrl: string;
  degree: string;
  workYears: number;
  city: string;
  expectedSalary: string;
  currentCompany: string;
  currentPosition: string;
  activeStatus: string;
  isJobSeeking: boolean;
  totalScore: number;
  workMatchScore: number;
  skillMatchScore: number;
  projectQualityScore: number;
  overallQualityScore: number;
  recommend: boolean;
  reason: string;
  keyStrengths: string[];
  concerns: string[];
  isCollected: boolean;
  snapshotId: number | null;
  preFilterPassed: boolean;
  preFilterFailReason: string | null;
}

// VL分析结果
interface VLAnalysisResult {
  workMatch: number;
  skillMatch: number;
  projectQuality: number;
  overallQuality: number;
  totalScore: number;
  recommend: boolean;
  reason: string;
  keyStrengths: string[];
  concerns: string[];
}

// 候选人卡片DOM数据
interface CandidateCard {
  name: string;
  encryptUserId: string;
  avatar: string;
  degree: string;
  workYears: number;
  city: string;
  expectedSalary: number;
  currentCompany: string;
  currentPosition: string;
  activeDaysAgo: number;
  isJobSeeking: boolean;
}
```

### 8.16 推荐牛人配置页面

```
推荐牛人配置页面
├── 岗位配置（Collapse）
│   ├── 岗位列表（Table）
│   │   ├── 职位名称
│   │   ├── 评分阈值
│   │   ├── 预筛条件摘要
│   │   ├── 启用状态
│   │   └── 操作（编辑/删除）
│   └── 添加岗位按钮
├── 预筛条件（Collapse，在岗位编辑内）
│   ├── 最近活跃天数
│   ├── 是否要求在看机会
│   ├── 最低学历
│   ├── 薪资范围
│   ├── 目标城市
│   └── 工作年限范围
├── 岗位说明（Collapse，在岗位编辑内）
│   ├── 岗位职责（textarea）
│   ├── 任职要求（textarea）
│   ├── 评分阈值滑块（1-10，默认7）
│   └── 每职位最大收藏数
├── 大模型配置（Collapse）
│   ├── 评分提示词预览（只读textarea）
│   └── 重置为自动生成按钮
├── 运行控制面板
│   ├── 选择要分析的职位（单选）
│   ├── 启动/停止按钮
│   ├── 运行状态
│   └── 进度条
└── 风险提示（Alert）
    ├── VL模型分析可能不准确的提示
    ├── 频繁操作可能触发验证码的提示
    └── 截图存储占用磁盘空间的提示
```

### 8.17 推荐牛人数据页面

#### 8.17.1 页面结构

```
推荐牛人数据页面
├── 筛选条件
│   ├── 会话选择（按运行时间）
│   ├── 职位筛选
│   ├── 评分范围滑块
│   ├── 仅显示已推荐开关
│   └── 搜索候选人姓名
├── 统计概览
│   ├── 本次运行已分析数
│   ├── 匹配成功数
│   ├── 已收藏数
│   ├── 平均评分
│   └── 预筛选通过率
├── 候选人列表（Table）
│   ├── 姓名 + 头像
│   ├── 学历
│   ├── 工作年限
│   ├── 当前公司/职位
│   ├── 期望薪资
│   ├── 综合评分（带颜色标识）
│   ├── 是否推荐
│   ├── 推荐理由
│   ├── 是否已收藏
│   └── 操作（查看截图/查看详情）
└── 详情侧边面板
    ├── 候选人基本信息
    ├── 评分明细（雷达图或条形图）
    ├── 优势列表
    ├── 顾虑列表
    ├── VL分析原始返回
    └── 简历截图预览
```

#### 8.17.2 评分颜色标识

| 评分范围 | 颜色 | 说明 |
|----------|------|------|
| 8.0 - 10.0 | 绿色 | 强烈推荐 |
| 7.0 - 7.9 | 蓝色 | 推荐收藏 |
| 5.0 - 6.9 | 橙色 | 待定 |
| 0.0 - 4.9 | 红色 | 不推荐 |

### 8.18 反检测策略

| 策略 | 参数 | 说明 |
|------|------|------|
| 滚动延迟 | 1-3秒随机 | 模拟人工浏览 |
| 翻页延迟 | 3-5秒随机 | 模拟阅读耗时 |
| 每小时上限 | 最多处理100个候选人 | 防止异常流量 |
| 收藏间隔 | 5-10秒随机 | 模拟人工操作 |
| 每日上限 | 最多收藏50人/职位 | 可配置 |

### 8.19 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 职位无推荐牛人 | 提示用户，跳过该职位 |
| VL模型调用超时 | 重试1次后跳过，记录错误 |
| VL返回格式异常 | 解析失败记录原始响应，跳过该候选人 |
| 截图失败 | 重试1次后跳过 |
| 收藏按钮不存在 | 跳过收藏，仅记录分析数据 |
| 已达最大收藏数 | 停止该职位的分析任务 |
| 页面结构变化（DOM更新） | 记录错误日志，提示用户更新选择器 |
| 磁盘空间不足（截图） | 清理旧截图，提示用户 |

### 8.20 开发计划

#### 第一阶段：基础框架（预计 3-5 天）
- [ ] 数据库表创建与迁移
- [ ] 子程序入口文件搭建
- [ ] Cookie登录与页面初始化
- [ ] 推荐牛人页面导航

#### 第二阶段：扫描与预筛选（预计 3-5 天）
- [ ] 页面滚动加载逻辑
- [ ] 卡片DOM数据提取
- [ ] 规则预筛选实现
- [ ] 断点续传机制

#### 第三阶段：VL分析（预计 5-7 天）
- [ ] 截图功能实现
- [ ] Qwen3-VL 模型集成
- [ ] 岗位级评分提示词生成
- [ ] VL结果解析与评分计算

#### 第四阶段：收藏与数据（预计 3-5 天）
- [ ] 自动收藏操作实现
- [ ] 验证码检测与处理
- [ ] 数据存储完善
- [ ] 运行状态实时更新

#### 第五阶段：UI与优化（预计 3-5 天）
- [ ] 配置页面开发
- [ ] 数据展示页面开发
- [ ] 详情面板与截图预览
- [ ] 反检测策略完善
- [ ] 性能优化

---

**文档版本**: v1.6
**创建日期**: 2026-03-25
**最后更新**: 2026-04-11

## 更新日志

### v1.6 (2026-04-11)
- 新增「岗位自动切换」功能设计（8.6节）
- 推荐牛人岗位选择从多选改为单选
- 新增 Boss 推荐牛人页面下拉框 DOM 结构文档
- 新增双向包含匹配策略说明
- 新增岗位切换失败时的错误处理规范
- 更新子程序入口文件列表，新增 job-fetcher.ts

### v1.5 (2026-04-09)
- 新增「推荐牛人简历分析收藏」完整功能设计（第8章）
- 新增推荐牛人数据库表设计（RecommendJobConfig / RecommendCandidate / RecommendResumeSnapshot / RecommendRunCheckpoint）
- 新增 Qwen3-VL 简历截图分析流程设计
- 新增岗位级评分提示词自动生成机制
- 新增规则预筛选 + VL 深度分析两级筛选架构
- 新增断点续传机制设计
- 新增验证码异常检测与用户介入处理
- 新增推荐牛人数据展示页面设计

### v1.4 (2026-03-27)
- 新增「智能回复」功能详细设计
- 新增导航结构调整说明
- 新增智能回复配置页面设计
- 新增大模型调用规范
- 新增回复次数限制规则
- 新增不触发回复条件
- 新增智能回复数据页面设计
- 新增敏感词检测机制
- 新增风险提示说明