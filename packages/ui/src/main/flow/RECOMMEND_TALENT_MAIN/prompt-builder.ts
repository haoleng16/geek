export interface RecommendJobConfigForPrompt {
  jobName: string
  jobResponsibilities?: string
  jobRequirements?: string
  scoreThreshold?: number
  scoringPrompt?: string
}

const SCORE_PROMPT_TEMPLATE = `你是一个专业的招聘分析师，请根据以下岗位要求分析候选人简历截图。

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
{"workMatch":8,"skillMatch":7,"projectQuality":6,"overallQuality":8,"totalScore":7.4,"recommend":true,"reason":"简要推荐/不推荐理由，50字以内","keyStrengths":["优势1","优势2"],"concerns":["顾虑1"]}

## 评分说明
- totalScore = workMatch * 0.3 + skillMatch * 0.3 + projectQuality * 0.2 + overallQuality * 0.2
- recommend = true 当 totalScore >= {scoreThreshold}
- reason 控制在 50 字以内
- keyStrengths 最多 3 条
- concerns 最多 2 条`

export function buildScoringPrompt(jobConfig: RecommendJobConfigForPrompt): string {
  if (jobConfig.scoringPrompt?.trim()) {
    return jobConfig.scoringPrompt
  }

  return SCORE_PROMPT_TEMPLATE
    .replace('{jobName}', jobConfig.jobName || '（未配置）')
    .replace('{jobResponsibilities}', jobConfig.jobResponsibilities || '（未配置）')
    .replace('{jobRequirements}', jobConfig.jobRequirements || '（未配置）')
    .replace('{scoreThreshold}', String(jobConfig.scoreThreshold ?? 7.0))
}
