# 智能招聘面试自动化系统 - 技术规范文档

## 1. 项目概述

### 1.1 功能目标
实现一个基于 Electron + Vue.js 的智能招聘面试自动化系统，用于 BOSS直聘招聘端的候选人筛选。系统通过多轮问答自动化筛选候选人，结合关键词匹配和 LLM 语义评分，自动完成候选人评估、简历收集和邮件通知。

### 1.2 核心流程
```
候选人发消息 → 识别岗位 → 发送问题 → 收集回复 → 评分 → 通过/拒绝 → 发送简历邀请 → 下载简历 → 发送邮件
```

### 1.3 技术栈
- **前端**: Vue 3 + TypeScript + Element Plus
- **后端**: Electron + Node.js
- **数据库**: SQLite (typeorm)
- **浏览器自动化**: Puppeteer
- **LLM**: DeepSeek API
- **邮件**: SMTP 协议

---

## 2. 系统架构

### 2.1 整体架构图
```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron Application                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Vue UI     │  │   IPC Bridge │  │   Main Process       │  │
│  │  (Renderer)  │◄─►│  (Electron)  │◄─►│  (Node.js)           │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                │                 │
│                    ┌───────────────────────────┼───────────────┐ │
│                    │                           │               │ │
│                    ▼                           ▼               ▼ │
│           ┌──────────────┐          ┌──────────────┐  ┌──────┐ │
│           │   SQLite     │          │  Puppeteer   │  │ LLM  │ │
│           │  (TypeORM)   │          │  (BOSS自动化) │  │ API  │ │
│           └──────────────┘          └──────────────┘  └──────┘ │
│                                                    │           │
│                                                    ▼           │
│                                           ┌──────────────┐    │
│                                           │  SMTP 邮件   │    │
│                                           └──────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流向
```
BOSS直聘页面 ──► Puppeteer抓取 ──► 候选人识别 ──► 岗位匹配
                                                          │
                                                          ▼
邮件发送 ◄── 简历下载 ◄── 简历邀请 ◄── 评分通过 ◄── 问答评估
     │
     ▼
 SQLite存储 ◄── 状态记录
```

---

## 3. 数据库设计

### 3.1 ER 图
```
┌─────────────────┐       ┌─────────────────┐
│   job_position  │       │   question_     │
│   (岗位配置表)   │───1:N─│   round         │
└─────────────────┘       │   (问题轮次表)   │
        │                 └─────────────────┘
        │                         │
        │1:N                      │1:N
        ▼                         ▼
┌─────────────────┐       ┌─────────────────┐
│  score_rule     │       │  candidate      │
│  (评分规则表)    │       │  (候选人表)      │
└─────────────────┘       └─────────────────┘
                                 │
                                 │1:N
                                 ▼
                          ┌─────────────────┐
                          │  resume         │
                          │  (简历表)        │
                          └─────────────────┘
```

### 3.2 表结构定义

#### 3.2.1 岗位配置表 (job_position)
```sql
CREATE TABLE job_position (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL,           -- 岗位名称
  description TEXT,                      -- 岗位描述
  pass_threshold INTEGER DEFAULT 60,     -- 全局通过阈值（分数）
  resume_invite_text TEXT,               -- 简历邀约话术（通过后发送）
  is_active BOOLEAN DEFAULT 1,           -- 是否启用
  education_filter TEXT,                 -- 学历筛选（JSON数组）
  experience_filter TEXT,                -- 经验筛选（JSON数组）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**筛选字段说明**：
- `education_filter`: 学历筛选条件，JSON数组格式
  - 可选值：`["大专及以下", "本科", "硕士/研究生", "博士"]`
  - 多选时OR逻辑，满足任一即可
  - 空数组表示不筛选
- `experience_filter`: 经验筛选条件，JSON数组格式
  - 可选值：`["1年及以下", "2年", "3年", "3年以上", "25届应届生", "26届应届生"]`
  - 多选时OR逻辑，满足任一即可
  - "3年以上"包含所有3年及以上经验
  - 空数组表示不筛选

#### 3.2.2 问题轮次表 (question_round)
```sql
CREATE TABLE question_round (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_position_id INTEGER NOT NULL,      -- 关联岗位
  round_number INTEGER NOT NULL,         -- 轮次序号（1,2,3...）
  question_text TEXT NOT NULL,           -- 问题内容
  keywords TEXT,                         -- 关键词配置（JSON数组，带权重）
  llm_prompt TEXT,                       -- LLM评分提示词（用户自定义）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_position_id) REFERENCES job_position(id)
);
-- 注意：删除 wait_timeout_minutes 字段，不做超时处理
```

#### 3.2.3 评分规则表 (score_rule) -- 已合并到 question_round
```sql
-- 评分规则已合并到 question_round 表的 keywords 和 llm_prompt 字段
-- 此表不再单独使用，可删除
```

#### 3.2.4 候选人表 (candidate)
```sql
CREATE TABLE candidate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  geek_id VARCHAR(50) NOT NULL UNIQUE,   -- BOSS直聘候选人ID
  geek_name VARCHAR(100),                -- 候选人姓名
  job_position_id INTEGER,               -- 应聘岗位
  job_name VARCHAR(100),                 -- 岗位名称（冗余存储）
  status VARCHAR(50) NOT NULL,           -- 状态
  current_round INTEGER DEFAULT 0,       -- 当前轮次
  total_score DECIMAL(5,2),              -- 总得分
  keyword_score DECIMAL(5,2),            -- 关键词得分
  llm_score DECIMAL(5,2),                -- LLM得分
  llm_reason TEXT,                       -- LLM评分理由
  education VARCHAR(50),                 -- 最高学历（大专/本科/硕士/博士等）
  school VARCHAR(100),                   -- 毕业院校
  major VARCHAR(100),                    -- 专业
  education_detail TEXT,                 -- 完整教育经历JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_position_id) REFERENCES job_position(id)
);
```

**学历字段说明**：
- `education`: 从BOSS直聘聊天界面右侧候选人资料区抓取
- 可选值：大专、本科、硕士、博士、高中及以下等
- 无法抓取时显示 `"--"`
- 在首次处理候选人时抓取并存储

#### 3.2.5 候选人状态枚举
```typescript
enum CandidateStatus {
  NEW = 'new',                           // 新候选人（尚未发送问题）
  WAITING_ROUND_1 = 'waiting_round_1',   // 已发送第1轮问题，等待回复
  WAITING_ROUND_2 = 'waiting_round_2',   // 已发送第2轮问题，等待回复
  WAITING_ROUND_N = 'waiting_round_n',   // 已发送第N轮问题，等待回复
  SCORED_ROUND_1 = 'scored_round_1',     // 第1轮评分完成（中间状态，用于调试）
  SCORED_ROUND_2 = 'scored_round_2',     // 第2轮评分完成（中间状态，用于调试）
  PASSED = 'passed',                     // 所有轮次通过（待发送简历邀约）
  REJECTED = 'rejected',                 // 某轮未通过，已拒绝
  RESUME_REQUESTED = 'resume_requested', // 已发送简历邀请
  RESUME_RECEIVED = 'resume_received',   // 已收到简历（待发送邮件）
  EMAILED = 'emailed',                   // 已发送邮件通知
  ERROR = 'error'                        // 处理出错（等待人工处理）
}
```

#### 3.2.6 状态流转说明
```
new
  │ 发送第1轮问题
  ▼
waiting_round_1
  │ 收到回复 → 评分
  ▼
  ├─ 未通过 (score < threshold) → rejected [终止]
  │
  └─ 通过 → 发送第2轮问题 → waiting_round_2
              │ 收到回复 → 评分
              ▼
              ├─ 未通过 → rejected [终止]
              │
              └─ 通过 → ... → waiting_round_n
                          │ 收到回复 → 评分
                          ▼
                          ├─ 未通过 → rejected [终止]
                          │
                          └─ 所有轮次通过 → 发送简历邀约 → resume_requested
                                            │ 检测简历
                                            ▼
                                            resume_received
                                            │ 定时汇总发送邮件
                                            ▼
                                            emailed [完成]
```

**关键规则**:
- 评分完成后立即更新候选人状态和分数到数据库
- 任意一轮未通过直接拒绝，不再发送后续问题
- 招聘者主动发送消息不影响评分流程

#### 3.2.6 简历表 (resume)
```sql
CREATE TABLE resume (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,         -- 关联候选人
  file_path VARCHAR(500) NOT NULL,       -- 本地存储路径
  file_name VARCHAR(200),                -- 原始文件名
  file_size INTEGER,                     -- 文件大小（字节）
  downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  emailed_at DATETIME,                   -- 邮件发送时间
  email_recipient VARCHAR(200),          -- 收件人邮箱
  FOREIGN KEY (candidate_id) REFERENCES candidate(id)
);
```

#### 3.2.7 问答记录表 (qa_record)
```sql
CREATE TABLE qa_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,         -- 关联候选人
  round_number INTEGER NOT NULL,         -- 轮次
  question_text TEXT NOT NULL,           -- 发送的问题
  answer_text TEXT,                      -- 候选人回复（合并后的完整答案）
  answered_at DATETIME,                  -- 回复时间
  keyword_score DECIMAL(5,2),            -- 关键词得分（0-100）
  llm_score DECIMAL(5,2),                -- LLM得分（0-100）
  total_score DECIMAL(5,2),              -- 总得分（加权计算后）
  llm_reason TEXT,                       -- LLM评分理由
  matched_keywords TEXT,                 -- 匹配到的关键词（JSON数组，记录贡献度）
  scored_at DATETIME,                    -- 评分时间
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidate(id)
);
```

#### 3.2.8 系统配置表 (system_config)
```sql
CREATE TABLE system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key VARCHAR(100) NOT NULL UNIQUE,
  config_value TEXT,                     -- JSON格式存储
  is_encrypted BOOLEAN DEFAULT 0,        -- 是否加密存储
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- 预置配置项：
-- smtp_host: SMTP服务器地址
-- smtp_port: SMTP端口
-- smtp_user: SMTP用户名
-- smtp_password: SMTP密码（加密存储）
-- email_recipient: 默认收件邮箱
-- daily_limit: 每日处理上限
-- scan_interval: 扫描间隔（秒），建议 120-300 秒（2-5分钟）
-- email_summary_time: 邮件汇总发送时间，格式 "HH:MM"，如 "09:00" 或 "18:00"
-- message_merge_window: 消息合并时间窗口（秒），默认 30 秒
-- keyword_weight: 关键词评分权重，默认 0.7
-- llm_weight: LLM评分权重，默认 0.3
```

#### 3.2.9 操作日志表 (operation_log)
```sql
CREATE TABLE operation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER,                  -- 关联候选人（可选）
  action VARCHAR(100) NOT NULL,          -- 操作类型
  detail TEXT,                           -- 详细信息（JSON）
  error_message TEXT,                    -- 错误信息（如果有）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidate(id)
);
-- 操作类型 (action)：
-- 'send_question': 发送问题
-- 'receive_answer': 收到回复
-- 'merge_messages': 合并多条消息
-- 'score_keyword': 关键词评分
-- 'score_llm': LLM评分
-- 'score_complete': 评分完成
-- 'status_update': 状态更新
-- 'send_resume_invite': 发送简历邀约
-- 'detect_resume': 检测简历
-- 'download_resume': 下载简历
-- 'send_email': 发送邮件
-- 'error': 处理出错
-- 'candidate_filtered': 候选人被筛选跳过
```

---

## 4. 核心功能模块

### 4.0 候选人筛选模块

#### 4.0.1 功能描述
在发送面试问题前，根据岗位配置的筛选条件过滤候选人，不符合条件的候选人将被静默跳过。

#### 4.0.2 筛选时机
- **触发位置**: 点击进入候选人聊天后、创建候选人记录前
- **数据来源**: 从BOSS直聘聊天界面右侧 `.base-info-single-detial` 容器抓取
- **信息内容**: 学历（本科/硕士等）、工作经验（3年/10年以上/26届应届生等）

#### 4.0.3 学历筛选选项
| 选项 | 匹配规则 |
|------|---------|
| 大专及以下 | 匹配高中、中专、技校、大专 |
| 本科 | 精确匹配"本科" |
| 硕士/研究生 | 匹配"硕士"或"研究生" |
| 博士 | 精确匹配"博士" |

#### 4.0.4 经验筛选选项
| 选项 | 匹配规则 |
|------|---------|
| 1年及以下 | 工作年限 ≤ 1年 |
| 2年 | 工作年限 = 2年 |
| 3年 | 工作年限 = 3年 |
| 3年以上 | 工作年限 ≥ 3年（含10年以上） |
| 25届应届生 | 显示"25届应届生" |
| 26届应届生 | 显示"26届应届生" |

#### 4.0.5 筛选逻辑
```
1. 获取岗位的筛选配置（educationFilter, experienceFilter）
2. 如果两个筛选条件都为空，跳过筛选，继续处理
3. 获取候选人的学历和经验信息
4. 如果信息缺失，跳过该项筛选，继续处理
5. 多选时采用OR逻辑，满足任一条件即可
6. 不符合条件时，记录筛选日志，静默跳过
```

#### 4.0.6 界面原型
```
┌─────────────────────────────────────────────────────────────┐
│  候选人筛选                                                  │
├─────────────────────────────────────────────────────────────┤
│  学历筛选：                                                  │
│  ☐ 大专及以下  ☑ 本科  ☑ 硕士/研究生  ☐ 博士               │
│  提示：多选时满足任一条件即可（OR逻辑），不选则不筛选学历    │
│                                                              │
│  经验筛选：                                                  │
│  ☐ 1年及以下  ☐ 2年  ☐ 3年  ☑ 3年以上                      │
│  ☐ 25届应届生  ☑ 26届应届生                                 │
│  提示："3年以上"包含所有3年及以上经验                       │
└─────────────────────────────────────────────────────────────┘
```

#### 4.0.7 边界情况处理
| 情况 | 处理方式 |
|------|---------|
| 未设置任何筛选条件 | 不过滤，所有候选人都处理 |
| 候选人无学历信息 | 跳过学历筛选，继续处理 |
| 候选人无经验信息 | 跳过经验筛选，继续处理 |
| 不符合筛选条件 | 记录日志，静默跳过 |

### 4.1 岗位配置管理模块

#### 4.1.1 功能描述
- 添加/编辑/删除岗位
- 为每个岗位配置多轮问题
- 配置评分规则（关键词）

#### 4.1.2 界面原型
```
┌─────────────────────────────────────────────────────────────┐
│  岗位配置                                                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 岗位列表                      [+ 添加岗位]           │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ○ Java开发工程师        3轮问题      通过阈值:60    │   │
│  │ ○ 前端开发工程师        2轮问题      通过阈值:70    │   │
│  │ ○ 产品经理              2轮问题      通过阈值:65    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  岗位详情：Java开发工程师                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 第1轮问题：                                          │   │
│  │ ┌─────────────────────────────────────────────┐     │   │
│  │ │ 请介绍一下您的Java开发经验，包括使用过的框架   │     │   │
│  │ └─────────────────────────────────────────────┘     │   │
│  │ 关键词：Spring, MyBatis, 微服务                      │   │
│  │                                                      │   │
│  │ 第2轮问题：                                          │   │
│  │ ┌─────────────────────────────────────────────┐     │   │
│  │ │ 您在项目中遇到过哪些技术难点，是如何解决的     │     │   │
│  │ └─────────────────────────────────────────────┘     │   │
│  │ 关键词：性能优化, 并发, 分布式                       │   │
│  │                                        [+ 添加轮次]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [保存] [取消]                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 评分规则配置模块

#### 4.2.1 评分时机与触发条件
- **触发时机**: 每次轮询读取未读消息时触发评分（低频轮询，2-5 分钟间隔）
- **消息合并策略**: 候选人在同一轮次的 **30 秒时间窗口**内发送的多条消息合并为一条完整答案
- **候选人处理模式**: 串行处理（一个候选人处理完成后再处理下一个）
- **已回复识别**: 通过检查聊天记录中最新消息的发送者来判断（最新消息来自候选人而非招聘者）

#### 4.2.2 评分公式
```
总分 = 关键词分 × 0.7 + LLM语义分 × 0.3
```

#### 4.2.3 关键词评分规则
- **匹配方式**: 包含匹配（回答中包含任意关键词即得满分 100 分）
- **关键词配置格式**: 带权重的 JSON 数组，如 `[{"keyword": "redis", "weight": 10}, {"keyword": "Spring", "weight": 20}]`
- **权重作用**: 权重仅用于记录贡献度，不影响最终分数（匹配任意关键词即满分）
- **大小写**: 不区分大小写
- **计算公式**: `关键词分 = 匹配到任意关键词 ? 100 : 0`

#### 4.2.4 通过阈值与失败处理
- **通过阈值**: 全局统一阈值（在岗位配置中设置，如 60 分）
- **未通过处理**: 直接标记为 `rejected` 状态，不再发送任何消息
- **超时处理**: **不做超时处理**，不设置等待回复超时时间

#### 4.2.5 LLM 评分配置
- **提示词模板**: 用户完全自定义（在岗位配置中设置）
- **返回格式**: JSON 格式 `{"score": <0-100>, "reason": "<评分理由>"}`
- **异常处理**: LLM API 调用失败时降级为只使用关键词评分，继续流程
- **评分一致性**: 建议使用较低的 temperature（如 0.3）保证评分一致性

#### 4.2.6 LLM 评分提示词模板示例
```
你是一个专业的招聘助手，请根据候选人的回答进行评分。

## 问题
{question}

## 候选人回答
{answer}

## 评分标准
1. 回答是否切题
2. 回答是否有深度
3. 是否展现了相关经验

请以JSON格式返回评分结果：
{
  "score": <0-100的分数>,
  "reason": "<评分理由，简要说明为什么给这个分数>"
}

只返回JSON，不要其他内容。
```

#### 4.2.4 DeepSeek API 调用
```typescript
interface LLMScoringResult {
  score: number;      // 0-100
  reason: string;     // 评分理由
}

async function scoreWithLLM(question: string, answer: string): Promise<LLMScoringResult> {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'user', content: buildPrompt(question, answer) }
      ],
      temperature: 0.3  // 低温度保证评分一致性
    })
  });

  const result = await response.json();
  return JSON.parse(result.choices[0].message.content);
}
```

### 4.3 简历与邮件处理模块

#### 4.3.1 简历检测与下载
- **检测方式**: 自动检测 BOSS 直聘页面中的简历状态（通过 Puppeteer 监控页面元素）
- **下载处理**: 自动下载简历 PDF 并保存到本地/数据库
- **文件命名**: `{候选人姓名}_{岗位名称}_{日期}.pdf`

#### 4.3.2 邮件发送策略
- **发送时机**: 定时汇总发送（不立即发送单封邮件）
- **汇总时间**: 用户可配置，格式 "HH:MM"，如每天早上 9:00 或晚上 18:00
- **邮件内容**: 包含候选人信息、评分结果、问答记录、简历附件

#### 4.3.3 界面原型
```
┌─────────────────────────────────────────────────────────────┐
│  邮件设置                                                    │
├─────────────────────────────────────────────────────────────┤
│  SMTP服务器: [smtp.qq.com              ]                    │
│  端口:       [465                      ]                    │
│  用户名:     [your@qq.com              ]                    │
│  授权码:     [••••••••                 ] [显示]             │
│                                                             │
│  收件邮箱:   [hr@company.com           ]                    │
│  汇总时间:   [09:00                    ] (每天定时发送)      │
│                                                             │
│  [测试连接]                              [保存]             │
└─────────────────────────────────────────────────────────────┘
```

#### 4.3.4 邮件内容模板
```
标题：【候选人简历汇总】{日期}

正文：
您好，

以下为今日收到的候选人简历汇总：

【候选人 {序号}】
姓名：{候选人姓名}
应聘岗位：{岗位名称}
处理时间：{处理日期}

【评分结果】
总评分：{总分}/100
- 关键词得分：{关键词分}/100 (权重 70%)
- AI评分：{LLM分}/100 (权重 30%)

【问答记录】
第1轮：
问题：{问题1}
回答：{回答1}
评分：{得分1}分

第2轮：
问题：{问题2}
回答：{回答2}
评分：{得分2}分

...

附件：{简历文件名}

---

此邮件由智能招聘系统自动发送。
```

---

## 4.4 异常处理与恢复机制

#### 4.4.1 界面原型
```
┌───────────────────────────────────────────────────────────────────────────────┐
│  候选人列表                                    [导出Excel]                     │
├───────────────────────────────────────────────────────────────────────────────┤
│  筛选：[全部状态 ▼] [全部岗位 ▼]                                              │
├───────────────────────────────────────────────────────────────────────────────┤
│  姓名  │ 学历 │ 岗位          │ 状态    │ 当前轮次 │ 得分 │ 操作              │
├───────────────────────────────────────────────────────────────────────────────┤
│  张三  │ 本科 │ Java开发      │ 等待回复 │ 第2轮   │ --   │ [展开问答 ▼]      │
│  李四  │ 硕士 │ 前端开发      │ 已通过   │ 第3轮   │ 85   │ [展开问答 ▼]      │
│  王五  │ --   │ 产品经理      │ 已拒绝   │ 第1轮   │ 35   │ [展开问答 ▼]      │
│  赵六  │ 本科 │ Java开发      │ 已发邮件 │ 第3轮   │ 92   │ [展开问答 ▼]      │
└───────────────────────────────────────────────────────────────────────────────┘
```

#### 4.4.2 操作列下拉展示
```
点击 [展开问答 ▼] 后，在操作列下方展开显示问答记录：

┌───────────────────────────────────────────────────────────────────────────────┐
│  姓名  │ 学历 │ 岗位          │ 状态    │ 当前轮次 │ 得分 │ 操作              │
├───────────────────────────────────────────────────────────────────────────────┤
│  张三  │ 本科 │ Java开发      │ 等待回复 │ 第2轮   │ --   │ [收起问答 ▲]      │
│        │      │               │         │         │      │ ┌────────────────┐ │
│        │      │               │         │         │      │ │ 第1轮           │ │
│        │      │               │         │         │      │ │ Q: 你的Java经验 │ │
│        │      │               │         │         │      │ │ A: 3年Spring... │ │
│        │      │               │         │         │      │ │ 评分: 75分      │ │
│        │      │               │         │         │      │ │                 │ │
│        │      │               │         │         │      │ │ 第2轮           │ │
│        │      │               │         │         │      │ │ Q: 技术难点...  │ │
│        │      │               │         │         │      │ │ （等待回复）    │ │
│        │      │               │         │         │      │ └────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

**下拉展示规则**：
- 按轮次升序排列（第1轮在上面）
- 显示：问题文本、回答文本、评分（关键词分+AI分）
- 无问答记录时显示"暂无问答记录"
- 下拉宽度适应操作列

### 4.4 异常处理与恢复机制

#### 4.4.1 评分异常处理
| 异常类型 | 处理策略 |
|---------|---------|
| LLM API 调用失败 | 降级为只使用关键词评分（关键词分 × 0.7 + 默认LLM分50 × 0.3） |
| LLM 返回格式错误 | 尝试解析数字，失败则降级为关键词评分 |
| 关键词配置为空 | 只使用 LLM 评分 |
| 数据库写入失败 | 标记候选人状态为 `error`，等待人工处理 |

#### 4.4.2 错误恢复机制
- 候选人状态为 `error` 时，不自动重试，等待人工处理
- 人工处理后可手动重置状态继续流程
- 记录完整操作日志便于问题排查

---

## 5. 核心流程设计

### 5.1 主处理流程
```typescript
async function mainProcess() {
  while (isRunning) {
    // 1. 获取未读会话列表
    const sessions = await getUnreadSessions();

    // 2. 串行处理每个候选人（一个处理完成后再处理下一个）
    for (const session of sessions) {
      try {
        // 3. 识别岗位
        const jobPosition = matchJobPosition(session.jobName);
        if (!jobPosition) continue;

        // 4. 获取/创建候选人记录
        const candidate = await getOrCreateCandidate(session, jobPosition);

        // 5. 根据状态处理
        await handleCandidateByStatus(candidate, session);

        // 6. 风控延迟（3-8秒随机）
        await randomDelay(3000, 8000);

      } catch (error) {
        // 7. 标记错误状态，不重试，等待人工处理
        await updateStatus(candidate, CandidateStatus.ERROR);
        logError(session, error);
        continue; // 跳过当前候选人，继续处理下一个
      }
    }

    // 8. 等待下一轮扫描（2-5分钟）
    await sleep(SCAN_INTERVAL);
  }
}
```

### 5.2 状态处理逻辑（评分核心流程）
```typescript
async function handleCandidateByStatus(candidate: Candidate, session: Session) {
  switch (candidate.status) {
    case CandidateStatus.NEW:
      // 发送第1轮问题
      await sendQuestion(candidate, 1);
      await updateStatus(candidate, CandidateStatus.WAITING_ROUND_1);
      await logOperation(candidate, 'send_question', { round: 1 });
      break;

    case CandidateStatus.WAITING_ROUND_1:
    case CandidateStatus.WAITING_ROUND_2:
    case CandidateStatus.WAITING_ROUND_N:
      // 检查是否有回复（检查最新消息发送者是否为候选人）
      const latestMessage = await getLatestMessage(session);
      if (!latestMessage || latestMessage.sender !== 'candidate') break;

      // 合并30秒窗口内的多条消息
      const mergedAnswer = await mergeMessagesInWindow(session, 30);

      // 评分流程
      const round = candidate.currentRound;
      const questionRound = await getQuestionRound(candidate.jobPositionId, round);

      // 1. 关键词评分
      const keywordResult = scoreWithKeywords(mergedAnswer, questionRound.keywords);
      await logOperation(candidate, 'score_keyword', keywordResult);

      // 2. LLM评分（失败则降级）
      let llmResult;
      try {
        llmResult = await scoreWithLLM(questionRound.questionText, mergedAnswer, questionRound.llmPrompt);
      } catch (error) {
        llmResult = { score: 50, reason: 'LLM评分失败，使用默认分数' };
      }
      await logOperation(candidate, 'score_llm', llmResult);

      // 3. 计算总分
      const totalScore = keywordResult.score * 0.7 + llmResult.score * 0.3;
      await logOperation(candidate, 'score_complete', { totalScore, keywordScore: keywordResult.score, llmScore: llmResult.score });

      // 4. 保存问答记录
      await saveQaRecord(candidate, {
        roundNumber: round,
        questionText: questionRound.questionText,
        answerText: mergedAnswer,
        keywordScore: keywordResult.score,
        llmScore: llmResult.score,
        totalScore,
        llmReason: llmResult.reason,
        matchedKeywords: keywordResult.matchedKeywords
      });

      // 5. 更新候选人状态（立即更新）
      await updateCandidateScore(candidate, totalScore);

      // 6. 判断是否通过
      if (totalScore >= candidate.jobPosition.passThreshold) {
        // 有下一轮？发送下一轮问题
        if (hasNextRound(candidate)) {
          await sendQuestion(candidate, round + 1);
          await updateStatus(candidate, getNextWaitingStatus(candidate));
        } else {
          // 全部通过，发送简历邀请
          await sendResumeRequest(candidate, candidate.jobPosition.resumeInviteText);
          await updateStatus(candidate, CandidateStatus.RESUME_REQUESTED);
        }
      } else {
        // 不通过，直接拒绝（不发送婉拒消息）
        await updateStatus(candidate, CandidateStatus.REJECTED);
      }
      break;

    case CandidateStatus.RESUME_REQUESTED:
      // 自动检测是否发送了简历
      const resumeDetected = await detectResume(session);
      if (resumeDetected) {
        await downloadResume(candidate, resumeDetected);
        await updateStatus(candidate, CandidateStatus.RESUME_RECEIVED);
        await logOperation(candidate, 'download_resume', { filePath: resumeDetected.filePath });
      }
      break;

    case CandidateStatus.RESUME_RECEIVED:
      // 等待定时汇总发送邮件（不在此处处理）
      break;

    case CandidateStatus.ERROR:
      // 错误状态，等待人工处理
      break;
  }
}
```

### 5.3 关键词评分实现
```typescript
interface KeywordConfig {
  keyword: string;
  weight: number;  // 权重仅用于记录贡献度
}

interface KeywordScoringResult {
  score: number;           // 0 或 100
  matchedKeywords: string[]; // 匹配到的关键词列表
}

function scoreWithKeywords(answer: string, keywords: KeywordConfig[]): KeywordScoringResult {
  if (!keywords || keywords.length === 0) {
    return { score: 0, matchedKeywords: [] };
  }

  const matchedKeywords: string[] = [];
  const answerLower = answer.toLowerCase();

  for (const kw of keywords) {
    if (answerLower.includes(kw.keyword.toLowerCase())) {
      matchedKeywords.push(kw.keyword);
    }
  }

  // 包含任意关键词即满分
  const score = matchedKeywords.length > 0 ? 100 : 0;

  return { score, matchedKeywords };
}
```

### 5.4 定时邮件汇总发送
```typescript
// 每天在配置的时间点发送邮件汇总
async function scheduleEmailSummary() {
  const configTime = await getSystemConfig('email_summary_time'); // "09:00"
  const [hour, minute] = configTime.split(':').map(Number);

  // 设置定时任务
  cron.schedule(`${minute} ${hour} * * *`, async () => {
    // 获取所有待发送邮件的候选人（状态为 resume_received）
    const candidates = await getCandidatesByStatus(CandidateStatus.RESUME_RECEIVED);

    if (candidates.length === 0) return;

    // 发送汇总邮件
    await sendSummaryEmail(candidates);

    // 更新状态
    for (const candidate of candidates) {
      await updateStatus(candidate, CandidateStatus.EMAILED);
      await logOperation(candidate, 'send_email', { recipient: config.emailRecipient });
    }
  });
}
```

---

## 6. 风控策略

### 6.1 风控措施
1. **随机延迟**: 每次操作间隔 3-8 秒随机
2. **每日上限**: 可配置每日处理候选人数量上限
3. **消息限流**: 每分钟发送消息数量限制
4. **低频轮询**: 扫描间隔 2-5 分钟，避免高频请求
5. **模拟人类行为**:
   - 随机滚动页面
   - 随机停留时间
   - 不在固定时间操作

### 6.2 风控配置
```typescript
interface RiskControlConfig {
  minDelayMs: number;        // 最小延迟 3000ms
  maxDelayMs: number;        // 最大延迟 8000ms
  dailyLimit: number;        // 每日上限 100
  messagePerMinute: number;  // 每分钟消息上限 5
  scanIntervalMs: number;    // 扫描间隔 120000-300000ms (2-5分钟)
  workHoursOnly: boolean;    // 仅工作时间运行
  workHoursStart: number;    // 工作时间开始 9
  workHoursEnd: number;      // 工作时间结束 18
}
```

---

## 7. 异常处理

### 7.1 断点续传
- 每个候选人的状态和进度实时保存到数据库
- 程序重启后，根据状态恢复处理
- 支持「处理中」状态的候选人重新处理

### 7.2 错误处理策略
| 错误类型 | 处理策略 |
|---------|---------|
| LLM API 超时/失败 | 降级为只使用关键词评分，继续流程 |
| LLM 返回格式错误 | 尝试解析数字，失败则使用默认 50 分 |
| 网络异常 | 记录日志，跳过当前候选人 |
| 页面加载失败 | 刷新页面重试 |
| 简历下载失败 | 标记为 `error` 状态，等待人工处理 |
| 邮件发送失败 | 重试 3 次，失败则标记 `error` 状态 |
| 数据库写入失败 | 标记候选人状态为 `error`，等待人工处理 |

### 7.3 错误恢复机制
- 候选人状态为 `error` 时，不自动重试
- 等待人工处理后可手动重置状态继续流程
- 记录完整操作日志便于问题排查

### 7.4 日志记录
- **完整操作日志**: 记录每个关键操作（发送问题、收到回复、评分、状态更新等）
- **数据库日志**: 记录操作历史，支持查询和排查
- **界面实时日志**: 显示当前处理进度
- **文件日志**: 记录详细操作日志到文件

---

## 8. 安全设计

### 8.1 敏感信息加密
- SMTP 授权码使用 AES 加密存储
- 加密密钥存储在系统密钥链（macOS Keychain / Windows Credential Manager）

### 8.2 数据保护
- 候选人信息仅存储在本地
- 简历文件存储在应用目录
- 不上传任何数据到云端

---

## 9. 与现有功能的关系

### 9.1 功能互斥
- 面试自动化功能与「智能回复」功能**互斥运行**
- 同一时间只能运行一个功能
- 开启面试自动化时，智能回复功能自动禁用
- 界面上提供切换选项

### 9.2 招聘者消息处理
- 招聘者主动发送消息**不影响评分流程**
- 系统继续按原流程处理候选人
- 检查候选人回复时只看消息发送者是否为候选人

### 9.3 数据共享
- 共享 BOSS直聘 cookies
- 共享浏览器实例
- 共享日志系统

---

## 10. 实现优先级

### Phase 1: 核心框架 (Week 1)
- [ ] 数据库表设计与迁移
- [ ] 岗位配置管理界面
- [ ] 问题轮次配置界面

### Phase 2: 核心流程 (Week 2)
- [ ] 候选人识别与岗位匹配
- [ ] 问题发送流程
- [ ] 回复检测与合并

### Phase 3: 评分系统 (Week 3)
- [ ] 关键词评分实现
- [ ] DeepSeek API 集成
- [ ] 评分结果存储

### Phase 4: 简历与邮件 (Week 4)
- [ ] 简历检测与下载
- [ ] SMTP 邮件发送
- [ ] 候选人摘要生成

### Phase 5: 完善与测试 (Week 5)
- [ ] 状态看板界面
- [ ] 错误处理与日志
- [ ] 风控策略实现
- [ ] 功能测试

---

## 11. 技术风险与应对

| 风险 | 影响 | 应对措施 |
|-----|------|---------|
| BOSS直聘页面改版 | DOM选择器失效 | 使用多种选择器策略，定期维护 |
| DeepSeek API 不稳定 | 评分失败 | 超时重试，失败跳过 |
| 风控检测 | 账号被封 | 严格限流，模拟人类行为 |
| 简历格式变化 | 下载失败 | 支持多种格式，错误处理 |

---

## 12. 附录

### 12.1 文件命名规则
- **简历**: `{候选人姓名}_{岗位名称}_{日期}.pdf`
  - 示例: `张三_Java开发工程师_2024-03-31.pdf`

### 12.2 邮件标题格式
- **格式**: `【候选人简历】{候选人姓名} - {岗位名称}`
- **示例**: `【候选人简历】张三 - Java开发工程师`

### 12.3 状态流转图
```
┌─────────────────────────────────────────────────────────────────────────┐
│                           面试自动化完整流程                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   new ──► waiting_round_1 ──► 评分 ──► 通过?                            │
│                                        │                                │
│                    ┌───────────────────┼───────────────────┐            │
│                    │ YES               │ NO                │            │
│                    ▼                   ▼                   │            │
│               有下一轮?             rejected               │            │
│                    │                 [终止]                 │            │
│            ┌───────┴───────┐                               │            │
│            │ YES           │ NO                            │            │
│            ▼               ▼                               │            │
│     waiting_round_2   resume_requested                     │            │
│            │               │                               │            │
│            ▼               ▼                               │            │
│          评分          自动检测简历                         │            │
│            │               │                               │            │
│     ┌──────┴──────┐       ▼                               │            │
│     │ 通过?       │   resume_received                      │            │
│     │             │       │                               │            │
│     ▼             ▼       ▼                               │            │
│  ...同上      rejected  定时汇总发送邮件                    │            │
│                        │                                   │            │
│                        ▼                                   │            │
│                    emailed [完成]                          │            │
│                                                          │            │
│   ┌──────────────────────────────────────────────────────┘            │
│   │                                                                    │
│   │  任意环节出错 ──► error [等待人工处理]                             │
│   │                                                                    │
└───┴────────────────────────────────────────────────────────────────────┘

关键规则：
1. 评分完成后立即更新状态和分数到数据库
2. 任意一轮未通过直接拒绝，不发送后续问题和婉拒消息
3. 全部轮次通过后立即发送简历邀约
4. 收到简历后等待定时汇总发送邮件
5. 招聘者主动发送消息不影响评分流程
```