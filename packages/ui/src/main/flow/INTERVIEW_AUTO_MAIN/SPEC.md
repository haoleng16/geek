# 面试自动化纯LLM评分机制改造技术规范

## 1. 改造概述

### 1.1 核心目标
将当前的混合评分机制（关键词70% + LLM30%）改为**纯LLM评分机制**，简化配置流程，提升评分灵活性。

### 1.2 改造范围
| 模块 | 改动 |
|------|------|
| 前端配置 | 岗位配置增加LLM评分提示词；删除关键词、否定词、权重等配置 |
| 后端评分 | 纯LLM评分，删除关键词评分逻辑 |
| 数据库 | 删除关键字段，简化数据结构 |
| 数据迁移 | 删除废弃字段，不处理历史数据 |

### 1.3 设计决策汇总

| 决策项 | 选择 |
|--------|------|
| 提示词层级 | 岗位级别（所有轮次共用） |
| LLM返回格式 | JSON（包含score和reason） |
| 关键词评分 | 完全删除 |
| LLM失败策略 | 默认失败（0分） |
| 通过判定 | >= 阈值通过 |
| 分数范围 | 0-100 |
| 提示词变量 | {question}、{answer} |
| 默认模板 | 提供默认模板，用户可自定义评分标准 |
| LLM配置来源 | 使用全局配置（llm.json） |
| 评分耗时处理 | 直接等待LLM返回（阻塞式） |
| JSON解析策略 | 容错解析（正则提取） |
| 分数边界约束 | 强制约束到0-100 |
| 简短回答处理 | 删除 |
| 简历邀约话术 | 保留现有字段 |
| 并发处理 | 串行处理，一个接一个 |

## 2. 数据库改动

### 2.1 InterviewJobPosition（岗位表）- 新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| llmScoringPrompt | text | LLM评分提示词（岗位级别） |

**新增迁移**：
```sql
ALTER TABLE "interview_job_position" ADD COLUMN "llmScoringPrompt" text;
```

### 2.2 InterviewQuestionRound（问题轮次表）- 删除字段

| 删除字段 | 原类型 | 说明 |
|----------|--------|------|
| keywords | text | 关键词配置（废弃） |
| negationWords | text | 否定词配置（废弃） |
| llmPrompt | text | 轮次级提示词（废弃，改为岗位级） |

**保留字段**：id、jobPositionId、roundNumber、questionText、createdAt

**新增迁移**：
```sql
-- 删除废弃字段（SQLite不支持DROP COLUMN，需重建表）
CREATE TABLE "interview_question_round_new" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "jobPositionId" integer NOT NULL,
  "roundNumber" integer NOT NULL,
  "questionText" text NOT NULL,
  "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY ("jobPositionId") REFERENCES "interview_job_position"("id")
);

INSERT INTO "interview_question_round_new" 
  SELECT id, jobPositionId, roundNumber, questionText, createdAt 
  FROM "interview_question_round";

DROP TABLE "interview_question_round";
ALTER TABLE "interview_question_round_new" RENAME TO "interview_question_round";
```

### 2.3 InterviewQaRecord（问答记录表）- 删除字段

| 删除字段 | 原类型 | 说明 |
|----------|--------|------|
| keywordScore | decimal(5,2) | 关键词得分（废弃） |
| matchedKeywords | text | 匹配关键词（废弃） |

**保留字段**：id、candidateId、roundNumber、questionText、answerText、questionSentAt、answeredAt、llmScore、llmReason、totalScore、scoredAt、createdAt

**新增迁移**：
```sql
-- 删除废弃字段
CREATE TABLE "interview_qa_record_new" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "candidateId" integer NOT NULL,
  "roundNumber" integer NOT NULL,
  "questionText" text NOT NULL,
  "answerText" text,
  "questionSentAt" datetime,
  "answeredAt" datetime,
  "llmScore" decimal(5,2),        -- 保留，值为LLM返回分数
  "llmReason" text,               -- 保留，LLM评分理由
  "totalScore" decimal(5,2),      -- 保留，值同llmScore
  "scoredAt" datetime,
  "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY ("candidateId") REFERENCES "interview_candidate"("id")
);

INSERT INTO "interview_qa_record_new" 
  SELECT id, candidateId, roundNumber, questionText, answerText, 
         questionSentAt, answeredAt, llmScore, llmReason, totalScore, scoredAt, createdAt
  FROM "interview_qa_record";

DROP TABLE "interview_qa_record";
ALTER TABLE "interview_qa_record_new" RENAME TO "interview_qa_record";
```

### 2.4 InterviewCandidate（候选人表）- 删除字段

| 删除字段 | 原类型 | 说明 |
|----------|--------|------|
| keywordScore | decimal(5,2) | 关键词得分（废弃） |
| llmScore | decimal(5,2) | LLM得分（废弃，只保留totalScore） |

**保留字段**：id、encryptGeekId、geekName、encryptJobId、jobName、jobPositionId、status、currentRound、totalScore、llmReason、firstContactAt、lastReplyAt、lastQuestionAt、createdAt、updatedAt

**新增迁移**：
```sql
-- 删除废弃字段
CREATE TABLE "interview_candidate_new" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "encryptGeekId" varchar NOT NULL,
  "geekName" varchar,
  "encryptJobId" varchar,
  "jobName" varchar,
  "jobPositionId" integer,
  "status" varchar DEFAULT 'new',
  "currentRound" integer DEFAULT 0,
  "totalScore" decimal(5,2),
  "llmReason" text,
  "firstContactAt" datetime,
  "lastReplyAt" datetime,
  "lastQuestionAt" datetime,
  "lastScoredAt" datetime,        -- 新增，记录最后评分时间
  "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
  "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY ("jobPositionId") REFERENCES "interview_job_position"("id")
);

INSERT INTO "interview_candidate_new" 
  SELECT id, encryptGeekId, geekName, encryptJobId, jobName, jobPositionId, 
         status, currentRound, totalScore, llmReason, firstContactAt, 
         lastReplyAt, lastQuestionAt, createdAt, updatedAt
  FROM "interview_candidate";

DROP TABLE "interview_candidate";
ALTER TABLE "interview_candidate_new" RENAME TO "interview_candidate";

-- 重建唯一索引
CREATE UNIQUE INDEX "idx_interview_candidate_geek_job"
  ON "interview_candidate" ("encryptGeekId", "encryptJobId");
CREATE INDEX "idx_interview_candidate_status"
  ON "interview_candidate" ("status");
```

## 3. 实体改动

### 3.1 InterviewJobPosition.ts - 新增字段

```typescript
// 新增：LLM评分提示词（岗位级别）
@Column({ nullable: true, type: 'text' })
llmScoringPrompt: string;  // 自定义评分提示词，支持 {question} 和 {answer} 占位符
```

### 3.2 InterviewQuestionRound.ts - 删除字段

删除：keywords、negationWords、llmPrompt

保留：id、jobPositionId、roundNumber、questionText、createdAt、jobPosition

### 3.3 InterviewQaRecord.ts - 删除字段

删除：keywordScore、matchedKeywords

保留：llmScore（值=LLM分数）、llmReason、totalScore（值=llmScore）

### 3.4 InterviewCandidate.ts - 删除字段

删除：keywordScore、llmScore

保留：totalScore、llmReason

## 4. 前端改动

### 4.1 InterviewConfig.vue - 岗位编辑对话框

**新增**：
```vue
<el-form-item label="评分提示词">
  <el-input
    v-model="jobForm.llmScoringPrompt"
    type="textarea"
    :rows="8"
    placeholder="请输入LLM评分提示词，支持 {question} 和 {answer} 变量"
  />
  <div class="form-tip">
    提示词中使用 {question} 代表问题，{answer} 代表候选人回答。LLM需返回JSON格式：{"score": 0-100, "reason": "评分理由"}
  </div>
</el-form-item>
```

**删除**：
- 岗位描述表单项
- 问题轮次中的：评分关键词、否定词、关键词权重、AI权重

**保留**：
- 岗位名称
- 通过阈值
- 启用状态
- 学历筛选
- 经验筛选
- 问题轮次：问题内容（只保留问题内容）

### 4.2 默认提示词模板

```typescript
const DEFAULT_LLM_SCORING_PROMPT = `你是一个专业的招聘面试评分助手。请根据候选人的回答进行评分。

## 问题
{question}

## 候选人回答
{answer}

## 评分标准
请根据以下标准评分（0-100分）：
- 60分：候选人提到有相关经验，但描述较简单
- 70分：候选人描述了具体细节，有一定深度
- 80分及以上：候选人描述丰富，展现了深入理解和实际经验

评分时请考虑：
1. 回答是否切题
2. 是否有具体细节
3. 是否展现了相关经验

请以JSON格式返回评分结果：
{
  "score": <0-100的分数>,
  "reason": "<简要说明评分依据>"
}

只返回JSON，不要其他内容。`

const getDefaultJobForm = () => ({
  name: '',
  passThreshold: 60,
  isActive: true,
  llmScoringPrompt: DEFAULT_LLM_SCORING_PROMPT,  // 新增
  educationFilter: [],
  experienceFilter: [],
  resumeInviteText: '',  // 保留
  questionRounds: [
    {
      roundNumber: 1,
      questionText: ''
    }
  ]
})
```

### 4.3 提示词验证

保存岗位时验证提示词格式：
```typescript
async function handleSaveJob() {
  if (!jobForm.value.name) {
    ElMessage.warning('请输入岗位名称')
    return
  }

  // 验证提示词
  if (!jobForm.value.llmScoringPrompt) {
    ElMessage.warning('请输入评分提示词')
    return
  }

  // 检查必要变量是否存在
  const prompt = jobForm.value.llmScoringPrompt
  if (!prompt.includes('{question}') || !prompt.includes('{answer}')) {
    ElMessage.warning('评分提示词必须包含 {question} 和 {answer} 变量')
    return
  }

  // 检查问题轮次
  const validRounds = jobForm.value.questionRounds.filter(r => r.questionText)
  if (validRounds.length === 0) {
    ElMessage.warning('请至少配置一个问题轮次')
    return
  }

  // 保存逻辑...
}
```

### 4.4 岗位列表表头

保持不变：岗位名称、通过阈值、状态、问题轮次、操作

## 5. 后端评分改动

### 5.1 scorer.ts - 核心改动

**删除**：
- `calculateKeywordScore` 函数
- `NEGATION_WORDS` 常量
- `SHORT_ANSWERS` 常量
- `detectShortAnswer` 函数
- `isKeywordNegated` 函数
- `cleanMessageText` 函数
- `ScoreResult.matchedKeywords` 字段
- `ScoreResult.keywordScore` 字段

**保留并修改**：
- `scoreWithLLM` 函数（修改为岗位级提示词）
- `scoreAnswer` 函数（简化为纯LLM评分）
- `saveScoreResult` 函数（简化字段）
- `getLlmConfig` 函数（使用全局配置）

**新的 scoreAnswer 函数**：
```typescript
export interface ScoreResult {
  totalScore: number
  llmScore: number
  llmReason: string
  passed: boolean
}

/**
 * 纯LLM评分
 */
export async function scoreAnswer(
  ds: DataSource,
  candidate: InterviewCandidate,
  question: string,
  answer: string,
  jobPosition: InterviewJobPosition  // 使用岗位配置
): Promise<ScoreResult> {
  try {
    console.log(`[Scorer] 开始LLM评分，候选人: ${candidate.geekName}`)
    console.log(`[Scorer] 问题: ${question}`)
    console.log(`[Scorer] 回答: ${answer}`)

    // 使用岗位级别的提示词
    const customPrompt = jobPosition.llmScoringPrompt || DEFAULT_LLM_SCORING_PROMPT

    // 调用LLM评分
    const llmResult = await scoreWithLLM(question, answer, customPrompt)
    
    // 强制约束分数到0-100范围
    const constrainedScore = Math.min(100, Math.max(0, llmResult.score))

    console.log(`[Scorer] LLM得分: ${constrainedScore}, 原因: ${llmResult.reason}`)

    // 判断是否通过（>= 阈值）
    const passed = constrainedScore >= jobPosition.passThreshold

    return {
      totalScore: constrainedScore,
      llmScore: constrainedScore,
      llmReason: llmResult.reason,
      passed
    }
  } catch (error) {
    console.error('[Scorer] LLM评分失败:', error)
    // 失败默认0分
    return {
      totalScore: 0,
      llmScore: 0,
      llmReason: 'LLM评分失败',
      passed: false
    }
  }
}

/**
 * LLM评分（容错解析）
 */
export async function scoreWithLLM(
  question: string,
  answer: string,
  customPrompt: string
): Promise<{ score: number; reason: string }> {
  try {
    const llmConfig = await getLlmConfig()
    if (!llmConfig) {
      console.warn('[Scorer] 未配置LLM')
      return { score: 0, reason: '未配置LLM' }
    }

    // 替换变量
    const prompt = customPrompt
      .replace('{question}', question)
      .replace('{answer}', answer)

    const messages: ChatMessage[] = [
      { role: 'user', content: prompt }
    ]

    console.log('[Scorer] 正在调用 LLM 进行评分...')

    const completion = await completes(
      {
        baseURL: llmConfig.providerCompleteApiUrl,
        apiKey: llmConfig.providerApiSecret,
        model: llmConfig.model,
        maxTokens: 300
      },
      messages
    )

    const rawContent = completion?.choices?.[0]?.message?.content
    if (!rawContent) {
      return { score: 0, reason: 'LLM 返回空内容' }
    }

    // 容错解析JSON
    return parseLlmScoringResponse(rawContent)
  } catch (error) {
    console.error('[Scorer] LLM 评分失败:', error)
    return { score: 0, reason: 'LLM 评分失败' }
  }
}

/**
 * 容错解析LLM评分响应
 */
function parseLlmScoringResponse(content: string): { score: number; reason: string } {
  try {
    // 方式1：直接解析完整JSON
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed.score === 'number') {
        return {
          score: parsed.score,
          reason: parsed.reason || '无评分理由'
        }
      }
    } catch (e) {
      // 不是完整JSON，尝试正则提取
    }

    // 方式2：正则提取JSON对象
    const jsonMatch = content.match(/\{[\s\S]*"score"[\s\S]*"reason"[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        score: Math.min(100, Math.max(0, Number(parsed.score) || 0)),
        reason: parsed.reason || '无评分理由'
      }
    }

    // 方式3：正则提取score字段
    const scoreMatch = content.match(/"score"\s*:\s*(\d+)/)
    if (scoreMatch) {
      const reasonMatch = content.match(/"reason"\s*:\s*"([^"]*)"/)
      return {
        score: Number(scoreMatch[1]),
        reason: reasonMatch ? reasonMatch[1] : '无法提取评分理由'
      }
    }

    // 方式4：提取纯数字分数
    const numMatch = content.match(/(\d+)/)
    if (numMatch) {
      return {
        score: Number(numMatch[1]),
        reason: '从响应中提取数字分数'
      }
    }

    return { score: 0, reason: '无法解析评分结果' }
  } catch (error) {
    console.warn('[Scorer] 解析失败:', error)
    return { score: 0, reason: '解析评分结果失败' }
  }
}
```

### 5.2 manual-test.ts - 评分调用改动

```typescript
// 评分调用改为传入岗位配置
const scoreResult = await scoreAnswer(
  dataSource!,
  candidate,
  questionRound.questionText,
  mergedText,
  matchedPosition  // 传入岗位配置，不再传 questionRound
)

// 保存评分结果简化
await saveScoreResult(ds, candidate, currentRound, {
  totalScore: scoreResult.totalScore,
  llmScore: scoreResult.llmScore,
  llmReason: scoreResult.llmReason
})
```

### 5.3 保存评分结果简化

```typescript
export async function saveScoreResult(
  ds: DataSource,
  candidate: InterviewCandidate,
  roundNumber: number,
  scoreResult: { totalScore: number; llmScore: number; llmReason: string }
): Promise<void> {
  try {
    const qaRepo = ds.getRepository('InterviewQaRecord')
    
    // 查询当前轮次记录
    const existing = await qaRepo.findOne({
      where: { candidateId: candidate.id!, roundNumber }
    })

    if (existing) {
      // 更新现有记录
      await qaRepo.update(existing.id!, {
        llmScore: scoreResult.llmScore,
        llmReason: scoreResult.llmReason,
        totalScore: scoreResult.totalScore,
        scoredAt: new Date()
      })
    } else {
      // 创建新记录（包含评分）
      await qaRepo.save(qaRepo.create({
        candidateId: candidate.id!,
        roundNumber,
        questionText: '',  // 问题在发送时已保存
        answerText: '',    // 回答已保存
        llmScore: scoreResult.llmScore,
        llmReason: scoreResult.llmReason,
        totalScore: scoreResult.totalScore,
        scoredAt: new Date()
      }))
    }

    // 更新候选人总得分
    const candRepo = ds.getRepository('InterviewCandidate')
    await candRepo.update(candidate.id!, {
      totalScore: scoreResult.totalScore,
      llmReason: scoreResult.llmReason,
      lastScoredAt: new Date()
    })

    console.log(`[Scorer] 评分结果已保存`)
  } catch (error) {
    console.error('[Scorer] 保存评分结果失败:', error)
  }
}
```

## 6. 边界情况处理

### 6.1 LLM调用失败

```typescript
// scorer.ts scoreAnswer 函数中的处理
catch (error) {
  console.error('[Scorer] LLM评分失败:', error)
  // 失败默认0分，自动判定为未通过
  return {
    totalScore: 0,
    llmScore: 0,
    llmReason: 'LLM评分失败',
    passed: false
  }
}
```

### 6.2 提示词变量缺失

```typescript
// 前端保存时验证
if (!prompt.includes('{question}') || !prompt.includes('{answer}')) {
  ElMessage.warning('评分提示词必须包含 {question} 和 {answer} 变量')
  return
}

// 后端评分时的兜底
const prompt = (customPrompt || DEFAULT_LLM_SCORING_PROMPT)
  .replace('{question}', question)
  .replace('{answer}', answer)
```

### 6.3 分数超出范围

```typescript
// 强制约束到0-100
const constrainedScore = Math.min(100, Math.max(0, llmResult.score))
```

### 6.4 JSON解析失败

```typescript
// 多层级容错解析
// 1. 直接JSON.parse
// 2. 正则提取JSON对象
// 3. 正则提取score字段
// 4. 提取纯数字
// 全部失败返回 score: 0
```

### 6.5 串行评分处理

```typescript
// manual-test.ts 主循环
for (const candidate of candidates) {
  // 一个候选人处理完再处理下一个
  await processCandidate(candidate)
  // 不并发调用LLM，避免API限流
}
```

## 7. 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `InterviewJobPosition.ts` | 新增 llmScoringPrompt 字段 |
| `InterviewQuestionRound.ts` | 删除 keywords、negationWords、llmPrompt 字段 |
| `InterviewQaRecord.ts` | 删除 keywordScore、matchedKeywords 字段 |
| `InterviewCandidate.ts` | 删除 keywordScore、llmScore 字段；新增 lastScoredAt 字段 |
| `InterviewConfig.vue` | 新增评分提示词配置；删除关键词、否定词、权重配置 |
| `scorer.ts` | 删除关键词评分逻辑；简化为纯LLM评分；容错JSON解析 |
| `manual-test.ts` | 评分调用改为传入岗位配置；简化保存逻辑 |
| `index.ts` | 自动化流程中的评分调用同样修改 |
| `新增迁移文件` | 数据库字段改动 |

## 8. 实施步骤

1. **数据库迁移**：新增迁移文件，删除废弃字段，新增 llmScoringPrompt
2. **实体修改**：更新 TypeScript 实体定义
3. **前端修改**：InterviewConfig.vue 改动
4. **后端修改**：scorer.ts 简化为纯LLM评分
5. **调用修改**：manual-test.ts、index.ts 评分调用改动
6. **测试验证**：新候选人流程、评分流程、边界情况

## 9. 测试验证

### 9.1 测试场景

1. **新岗位配置**：创建岗位，编辑提示词，验证提示词格式
2. **新候选人评分**：候选人回复，LLM评分返回JSON，分数正确解析和保存
3. **评分通过**：分数 >= 阈值，状态正确更新
4. **评分未通过**：分数 < 阈值，标记为 rejected
5. **LLM失败**：模拟API超时，返回0分，标记为未通过
6. **JSON解析容错**：模拟各种格式返回，验证解析正确

### 9.2 验证要点

- 提示词变量正确替换
- 分数约束到0-100范围
- 通过判定使用 >= 阈值
- 数据库字段正确更新
- 废弃字段已删除