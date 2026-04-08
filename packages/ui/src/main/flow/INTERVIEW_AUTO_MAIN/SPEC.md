# 面试自动化系统技术规范

## 1. 概述

### 1.1 系统目标
基于 Electron + Puppeteer 的 BOSS 直聘自动化面试系统，实现候选人筛选、多轮面试、评分、简历邀约全流程自动化。

### 1.2 核心流程
```
扫描未读消息 → 岗位匹配 → 候选人筛选 → 状态判断 → 发送问题/采集回答 → LLM评分 → 通过/拒绝 → 简历邀约
```

---

## 2. 状态流转规范

### 2.1 状态定义

| 状态 | 值 | 说明 |
|------|------|------|
| NEW | `new` | 新候选人，尚未发送任何问题 |
| WAITING_ROUND_1 | `waiting_round_1` | 已发送第1轮问题，等待回复 |
| WAITING_ROUND_2 | `waiting_round_2` | 已发送第2轮问题，等待回复 |
| WAITING_ROUND_N | `waiting_round_n` | 已发送第N轮问题，等待回复（N>=3） |
| REJECTED | `rejected` | 评分未通过，已静默标记 |
| RESUME_REQUESTED | `resume_requested` | 已发送简历交换请求 |
| RESUME_AGREED | `resume_agreed` | 候选人同意发送简历 |
| RESUME_RECEIVED | `resume_received` | 已收到并下载简历 |
| EMAILED | `emailed` | 简历已通过邮件发送 |
| ERROR | `error` | 处理出错 |

### 2.2 状态流转图

```
NEW
  │ 发送第1轮问题，currentRound=1，lastQuestionAt=now
  ▼
WAITING_ROUND_1
  │ 收集回答 → LLM评分
  ├─ 通过 → 有下一轮？
  │    ├─ 是 → 发送第2轮问题，currentRound=2，lastQuestionAt=now
  │    │       ▼
  │    │   WAITING_ROUND_2
  │    │     │ 收集回答 → LLM评分
  │    │     ├─ 通过 → 有下一轮？
  │    │     │    ├─ 是 → WAITING_ROUND_N（循环）
  │    │     │    └─ 否 → RESUME_REQUESTED
  │    │     └─ 不通过 → REJECTED（静默标记）
  │    └─ 否 → RESUME_REQUESTED
  └─ 不通过 → REJECTED（静默标记）

RESUME_REQUESTED → RESUME_AGREED → RESUME_RECEIVED → EMAILED
```

### 2.3 状态更新时机

| 触发事件 | 更新字段 |
|----------|----------|
| 发送问题 | status=WAITING_ROUND_N, currentRound=N, lastQuestionAt=now |
| 评分完成 | totalScore=X, llmReason=Y, lastScoredAt=now |
| 评分不通过 | status=REJECTED |
| 所有轮次通过 | status=RESUME_REQUESTED |
| 候选人同意简历 | status=RESUME_AGREED |
| 简历下载完成 | status=RESUME_RECEIVED |

### 2.4 currentRound 更新规则

- 发送第1轮问题时：`currentRound = 1`
- 评分通过并进入下一轮时：`currentRound = nextRoundNumber`（由 `shouldSendNextRound` 返回）
- currentRound 必须在发送问题后立即更新，不能延迟到评分时

### 2.5 轮次数量

- 由岗位配置的 `questionRounds` 决定
- 不同岗位可以有不同轮次数量
- `shouldSendNextRound` 通过 `candidate.currentRound + 1` 查找下一轮配置

---

## 3. 消息采集规范

### 3.1 采集入口

系统有两个消息采集入口：

1. **未读角标检测**（主入口）：主循环扫描未读消息列表，对有角标的候选人进入聊天框处理
2. **主动轮询等待中的候选人**（兜底入口）：`checkWaitingCandidatesForReply`，不依赖角标，直接查询数据库中 WAITING 状态的候选人

### 3.2 消息采集流程

```
getChatHistory(page)                    # 获取聊天历史
  │
  ▼
deduplicateMessages(history)            # 去重（基于 id/text/time）
  │
  ▼
filter: !isSelfMessage(msg)             # 过滤：只保留候选人消息
  │
  ▼
filter: !shouldFilterMessage(text)      # 过滤：去除简历卡片、系统消息
  │
  ▼
filter: msgTime >= lastQuestionAt       # 过滤：只取发送问题后的消息
  │
  ▼
filter: lastScoredAt 轮次判断           # 过滤：同轮次内过滤已评分消息
  │  （见 3.4 关键规则）
  ▼
slice(0, 3)                             # 限制最多取3条
  │
  ▼
cleanCandidateAnswer(text)              # 清理：去问题行、去重句子
  │
  ▼
返回 mergedText
```

### 3.3 消息来源优先级

`getChatHistory` 按以下优先级获取消息：

1. `.chat-message-list` Vue 组件（`list$`、`list`、`messages` 等 key）
2. `.message-content .chat-record` Vue 组件
3. `.chat-conversation` Vue 组件
4. DOM 解析（`.message-item` 元素）

### 3.4 lastScoredAt 过滤规则（BUG修复后）

**核心规则**：lastScoredAt 过滤只在同一轮次内生效，不跨轮次。

```
如果 lastScoredAt 为空 → 不过滤（通过）
如果 lastQuestionAt 存在 且 lastQuestionAt > lastScoredAt →
    说明已发送新一轮问题，跳过 lastScoredAt 过滤（通过）
否则（同一轮次内）→
    只保留 msgTime > scoredTime 的消息
```

**设计原因**：
- lastScoredAt 的本意是防止同一轮次内重复评分同一条消息
- 但第一轮评分后 lastScoredAt 被设置，第二轮消息采集时，第二轮的新消息会被误杀
- 修复后通过对比 lastQuestionAt 和 lastScoredAt 来判断是否跨轮次
- 如果 lastQuestionAt > lastScoredAt，说明已经发送了新一轮问题，此时 lastQuestionAt 过滤已足够确保只采集新一轮的回复

### 3.5 isSelfMessage 判断规则

按以下优先级判断消息是否由招聘者（自己）发送：

1. `hasItemMyself === true` → 自己
2. `hasItemFriend === true` → 对方
3. `isSelf === true` → 自己
4. `isSelf === false` → 对方
5. `self === true` / `fromSelf === true` → 自己
6. `sender === 'recruiter'` → 自己
7. `direction === 'self'` / `'out'` → 自己
8. `direction === 'other'` / `'in'` → 对方

### 3.6 时间解析

BOSS 直聘聊天界面中的时间格式：

| 格式 | 示例 | 解析规则 |
|------|------|----------|
| "昨天 HH:MM" | "昨天 17:01" | 昨天 + 时分 |
| "MM-DD HH:MM" | "04-03 11:46" | 月日 + 时分（当年或去年） |
| "HH:MM" | "17:17" | 今天的时分 |

**注意事项**：
- DOM 来源的消息只有分钟级精度（HH:MM），没有秒
- Vue 来源的消息可能有更高精度的时间戳
- 时间比较时注意精度差异，可能导致边界误判

### 3.7 shouldFilterMessage 规则

以下内容的消息会被过滤：

- "对方想发送附件简历"
- "您可以在线预览"
- "设置邮箱"

### 3.8 回答文本清理

`cleanCandidateAnswer` 对合并后的文本进行清理：

1. 过滤问题行：以问号结尾或包含问题关键词（"请问"、"什么"、"怎么"等）
2. 句子级去重：按句号、感叹号、问号分句，去重相同句子

### 3.9 边界情况处理

| 情况 | 处理策略 |
|------|----------|
| 候选人回复多条消息 | 30秒时间窗口合并，最多取3条 |
| 候选人回复系统消息（简历卡片混合） | shouldFilterMessage 过滤 |
| 候选人回复图片 | 当前无法处理，text 为空会被跳过 |
| 消息采集为空 | 记录日志，不做任何操作，等待下次轮询 |
| 聊天框未加载完成 | 等待2秒（`sleep(2000)`）后重试 |
| 未读角标被清除 | 主动轮询 `checkWaitingCandidatesForReply` 兜底 |

---

## 4. 评分规范

### 4.1 评分架构

纯 LLM 评分机制，不使用关键词匹配。

### 4.2 评分流程

```
获取岗位配置中的 llmScoringPrompt（或使用默认模板）
  │
  ▼
替换变量：{question} → 问题文本, {answer} → 回答文本
  │
  ▼
调用 LLM API（使用全局 llm.json 配置）
  │
  ▼
解析 LLM 返回的 JSON：{ "score": 0-100, "reason": "评分理由" }
  │
  ▼
约束分数到 0-100 范围
  │
  ▼
与 passThreshold 比较判定通过/不通过
```

### 4.3 LLM 配置

- 来源：全局配置文件 `llm.json`
- 选择逻辑：优先使用 `enabled: true` 的配置，否则取第一个
- API 调用：使用 `completes` 函数，`maxTokens: 500`

### 4.4 提示词模板

- 存储位置：岗位级别 `InterviewJobPosition.llmScoringPrompt`
- 变量：`{question}`、`{answer}`
- 默认模板：提供 0-100 分的评分标准
- 前端验证：保存时检查必须包含 `{question}` 和 `{answer}`

### 4.5 评分结果解析

4级容错解析策略：

1. 直接 `JSON.parse` 整个响应
2. 正则提取 JSON 对象 `{"score": X, "reason": Y}`
3. 正则提取 `score` 字段
4. 提取第一个纯数字作为分数

全部失败返回 `score: 0, reason: '无法解析评分结果'`

### 4.6 通过判定

```typescript
const passed = constrainedScore >= jobPosition.passThreshold
```

- 使用 `>=` 判断
- passThreshold 由岗位配置决定
- 不通过时：静默标记为 REJECTED，不发送任何消息

### 4.7 评分失败处理

| 失败场景 | 处理 |
|----------|------|
| LLM 未配置 | 返回 score: 0, passed: false |
| API 调用超时/异常 | 返回 score: 0, passed: false |
| 响应为空 | 返回 score: 0, passed: false |
| JSON 解析失败 | 4级容错解析，全部失败返回 score: 0 |

### 4.8 评分结果存储

- QA 记录表 `InterviewQaRecord`：保存每轮的分数、理由、评分时间
- 候选人表 `InterviewCandidate`：更新 totalScore、llmReason、lastScoredAt

### 4.9 防重复评分机制

3 层防重复保护：

1. **lastScoredAt 时间检查**（入口层）：如果最近30秒内已评分，跳过整个处理
2. **QA 记录已评分检查**（数据层）：如果当前轮次的 QA 记录已有 scoredAt，跳过
3. **isDuplicateAnswer 检查**（内容层）：如果回答文本与已有记录完全相同，跳过

---

## 5. 主循环执行规范

### 5.1 执行顺序

每轮主循环按以下顺序执行：

1. 检查工作时间（9:00-18:00）
2. 点击未读 tab，滚动加载全部未读
3. 获取聊天列表，筛选有角标的未读消息
4. 逐个处理未读候选人（岗位匹配 → 候选人筛选 → 状态处理）
5. 检查待下载简历的候选人
6. 主动轮询等待中的候选人（兜底采集）

### 5.2 风控策略

| 参数 | 默认值 |
|------|--------|
| 扫描间隔 | 10秒 |
| 随机延迟 | 3-8秒 |
| 每日上限 | 100条 |
| 每分钟上限 | 5条 |
| 工作时间 | 9:00-18:00 |

### 5.3 候选人筛选

在进入面试流程前进行预筛选：

- 学历筛选：根据岗位 `educationFilter` 配置
- 经验筛选：根据岗位 `experienceFilter` 配置
- 无筛选信息时：跳过筛选，继续处理

---

## 6. 已知问题和修复记录

### 6.1 lastScoredAt 跨轮次误杀（已修复）

- **问题**：第一轮评分后 `lastScoredAt` 被设置，第二轮消息采集时所有消息被 `lastScoredAt` 过滤掉
- **根因**：`mergeMessagesInWindow` 中 `lastScoredAt` 过滤没有区分轮次
- **修复**：当 `lastQuestionAt > lastScoredAt` 时（已发送新一轮问题），跳过 `lastScoredAt` 过滤
- **影响文件**：`answer-collector.ts`
