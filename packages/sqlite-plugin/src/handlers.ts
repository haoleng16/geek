import { DataSource, Raw } from "typeorm";
import { BossActiveStatusRecord } from "./entity/BossActiveStatusRecord";
import { BossInfo } from "./entity/BossInfo";
import { CompanyInfo } from "./entity/CompanyInfo";
import { JobInfo } from "./entity/JobInfo";
import { parseCompanyScale, parseSalary } from "./utils/parser";
import { ChatStartupLog } from "./entity/ChatStartupLog";
import { BossInfoChangeLog } from "./entity/BossInfoChangeLog";
import { CompanyInfoChangeLog } from "./entity/CompanyInfoChangeLog";
import { JobInfoChangeLog } from "./entity/JobInfoChangeLog";
import { MarkAsNotSuitLog } from "./entity/MarkAsNotSuitLog";
import { ChatMessageRecord } from "./entity/ChatMessageRecord";
import { LlmModelUsageRecord } from "./entity/LlmModelUsageRecord";
import { JobHireStatusRecord } from "./entity/JobHireStatusRecord";
import { RecruiterJobConfig } from "./entity/RecruiterJobConfig";
import { CandidateConversation } from "./entity/CandidateConversation";
import { CandidateResumeRecord } from "./entity/CandidateResumeRecord";
import { RecruiterProcessLog } from "./entity/RecruiterProcessLog";
import { RecruiterDailyStats } from "./entity/RecruiterDailyStats";
import { InterviewJobPosition } from "./entity/InterviewJobPosition";
import { InterviewQuestionRound } from "./entity/InterviewQuestionRound";
import { InterviewCandidate, InterviewCandidateStatus } from "./entity/InterviewCandidate";
import { InterviewQaRecord } from "./entity/InterviewQaRecord";
import { InterviewResume } from "./entity/InterviewResume";
import { InterviewSystemConfig } from "./entity/InterviewSystemConfig";
import { InterviewOperationLog } from "./entity/InterviewOperationLog";

function getBossInfoIfIsEqual (savedOne, currentOne) {
  if (savedOne === currentOne) {
    return true
  }
  if ((savedOne !== null && currentOne === null) ||
    (savedOne === null && currentOne !== null)) {
    return false;
  }
  if (
    ['__ggr_encryptBrandId', 'brandName', 'title', 'name'].some(key => savedOne[key] !== currentOne[key])
  ) {
    return false
  }
  return true
}

function getCompanyInfoIfIsEqual (savedOne, currentOne) {
  if (savedOne === currentOne) {
    return true
  }
  if (
    (savedOne !== null && currentOne === null) ||
    (savedOne === null && currentOne !== null)
  ) {
    return false;
  }
  if (['brandName', 'stage', 'scale', 'industry', 'introduce'].some(key => savedOne[key] !== currentOne[key])) {
    return false;
  }
  if (
    [...currentOne.labels ?? []].sort().join('-') !==
    [...savedOne.labels ?? []].sort().join('-')
  ) {
    return false
  }
  return true;
}

function cleanMultiLineTextForCompare (input: string) {
  return input
    // 去掉连续空行
    .replace(/\n\s*\n+/g, '\n')
    // 去掉连续的空白字符
    .replace(/\s+/g, ' ')
    // 去掉每行开头、结尾的空白字符
    .replace(/^\s+|\s+$/gm, '');
}
function getJobInfoIfIsEqual (savedOne, currentOne) {
  if (savedOne === currentOne) {
    return true
  }
  if (
    (savedOne !== null && currentOne === null) ||
    (savedOne === null && currentOne !== null)
  ) {
    return false;
  }
  if ([
    'encryptUserId',
    'invalidStatus',
    'jobName',
    'positionName',
    'locationName',
    'experienceName',
    'degreeName',
    'salaryDesc',
    'payTypeDesc',
    'address',
    'jobStatusDesc'
  ].some(key => savedOne[key] !== currentOne[key])) {
    return false;
  }
  if (
    cleanMultiLineTextForCompare(savedOne.postDescription?.trim() ?? '') !== 
    cleanMultiLineTextForCompare(currentOne.postDescription?.trim() ?? '')
  ) {
    return false
  }
  if (
    [...currentOne.showSkills ?? []].sort().join('-') !==
    [...savedOne.showSkills ?? []].sort().join('-')
  ) {
    return false
  }
  return true;
}

export async function saveJobInfoFromRecommendPage(ds: DataSource, _jobInfo) {
  const { bossInfo, brandComInfo, jobInfo } = _jobInfo;

  bossInfo['__ggr_encryptBrandId'] = brandComInfo.encryptBrandId
  bossInfo['__ggr_encryptBossId'] = jobInfo.encryptUserId
  //#region boss
  // get origin
  const bossInfoChangeLogRepository = ds.getRepository(BossInfoChangeLog)
  let lastSavedBossInfo
  try {
    lastSavedBossInfo = JSON.parse((await bossInfoChangeLogRepository.findOne({
      where: { encryptBossId: jobInfo.encryptUserId },
      order: { updateTime: "DESC" },
    })).dataAsJson);
  } catch {
    lastSavedBossInfo = null
  }
  const isBossInfoEqual = getBossInfoIfIsEqual(lastSavedBossInfo, bossInfo)
  if (!isBossInfoEqual) {
    const changeLog = new BossInfoChangeLog()
    changeLog.dataAsJson = JSON.stringify(bossInfo)
    changeLog.encryptBossId = jobInfo.encryptUserId
    changeLog.updateTime = new Date()
    await bossInfoChangeLogRepository.save(changeLog)
  }
  const boss = new BossInfo();
  boss.encryptBossId = jobInfo.encryptUserId;
  boss.encryptCompanyId = brandComInfo.encryptBrandId;
  boss.name = bossInfo.name;
  boss.title = bossInfo.title;
  boss.date = new Date();
  const bossInfoRepository = ds.getRepository(BossInfo);
  await bossInfoRepository.save(boss);
  //#endregion

  //#region company
  // get origin
  const companyInfoChangeLogRepository = ds.getRepository(CompanyInfoChangeLog)
  let lastSavedCompanyInfo
  try {
    lastSavedCompanyInfo = JSON.parse((await companyInfoChangeLogRepository.findOne({
      where: { encryptCompanyId: brandComInfo.encryptBrandId },
      order: { updateTime: "DESC" },
    })).dataAsJson);
  } catch {
    lastSavedCompanyInfo = null
  }
  const isCompanyInfoEqual = getCompanyInfoIfIsEqual(lastSavedCompanyInfo, brandComInfo)
  if (!isCompanyInfoEqual) {
    const changeLog = new CompanyInfoChangeLog()
    changeLog.dataAsJson = JSON.stringify(brandComInfo)
    changeLog.encryptCompanyId = brandComInfo.encryptBrandId
    changeLog.updateTime = new Date()
    await companyInfoChangeLogRepository.save(changeLog)
  }

  const company = new CompanyInfo();
  company.encryptCompanyId = brandComInfo.encryptBrandId;
  company.brandName = brandComInfo.brandName;
  company.name = brandComInfo.customerBrandName;
  company.industryName = brandComInfo.industryName;
  company.stageName = brandComInfo.stageName;
  const companyScale = parseCompanyScale(brandComInfo.scaleName);
  company.scaleLow = companyScale[0];
  company.scaleHigh = companyScale[1];

  const companyInfoRepository = ds.getRepository(CompanyInfo);
  await companyInfoRepository.save(company);
  //#endregion

  //#region job
  const jobInfoChangeLogRepository = ds.getRepository(JobInfoChangeLog);
  let lastSavedJobInfo
  try {
    lastSavedJobInfo = JSON.parse((await jobInfoChangeLogRepository.findOne({
      where: { encryptJobId: jobInfo.encryptId },
      order: { updateTime: "DESC" },
    })).dataAsJson);
  } catch {
    lastSavedJobInfo = null
  }
  const isJobInfoEqual = getJobInfoIfIsEqual(lastSavedJobInfo, jobInfo)
  if (!isJobInfoEqual) {
    const changeLog = new JobInfoChangeLog()
    changeLog.dataAsJson = JSON.stringify(jobInfo)
    changeLog.encryptJobId = jobInfo.encryptId
    changeLog.updateTime = new Date()
    await jobInfoChangeLogRepository.save(changeLog)
  }

  const job = new JobInfo();
  const jobSalary = parseSalary(jobInfo.salaryDesc);
  const jobUpdatePayload: JobInfo = {
    address: jobInfo.address,
    degreeName: jobInfo.degreeName,
    description: jobInfo.postDescription,
    encryptBossId: jobInfo.encryptUserId,
    encryptCompanyId: brandComInfo.encryptBrandId,
    encryptJobId: jobInfo.encryptId,
    jobName: jobInfo.jobName,
    positionName: jobInfo.positionName,
    experienceName: jobInfo.experienceName,
    salaryHigh: jobSalary.high,
    salaryLow: jobSalary.low,
    salaryMonth: jobSalary.month,
  };

  Object.assign(job, jobUpdatePayload);

  const jobInfoRepository = ds.getRepository(JobInfo);
  await jobInfoRepository.save(job);
  //#endregion

  //#region save boss active status
  // look up if the lastActiveStatus of the newest one is equal to the current one.
  // if equal, just update the updateDate
  // else insert a new record

  const bossActiveStatusRecord = new BossActiveStatusRecord();
  bossActiveStatusRecord.encryptBossId = boss.encryptBossId;
  bossActiveStatusRecord.updateTime = new Date();
  bossActiveStatusRecord.lastActiveStatus = bossInfo.activeTimeDesc;

  const bossActiveStatusRecordRepository = ds.getRepository(
    BossActiveStatusRecord
  );
  const existNewestRecordByBossId =
    await bossActiveStatusRecordRepository.findOne({
      where: { encryptBossId: boss.encryptBossId },
      order: { updateTime: "DESC" },
    });
  if (
    existNewestRecordByBossId &&
    existNewestRecordByBossId.lastActiveStatus === bossInfo.activeTimeDesc
  ) {
    bossActiveStatusRecord.id = existNewestRecordByBossId.id;
  }
  await bossActiveStatusRecordRepository.save(bossActiveStatusRecord);
  //#endregion
  return;
}

export async function saveChatStartupRecord(
  ds: DataSource,
  _jobInfo,
  { encryptUserId },
  { autoStartupChatRecordId = undefined, chatStartupFrom = undefined, jobSource = undefined } = {}
) {
  const { jobInfo } = _jobInfo;

  //#region chat-startup-log
  const chatStartupLog = new ChatStartupLog()
  const chatStartupLogPayload: Partial<ChatStartupLog> = {
    date: new Date(),
    encryptCurrentUserId: encryptUserId,
    encryptJobId: jobInfo.encryptId,
    autoStartupChatRecordId,
    chatStartupFrom,
    jobSource,
  }
  Object.assign(chatStartupLog, chatStartupLogPayload)

  const chatStartupLogRepository = ds.getRepository(ChatStartupLog);
  await chatStartupLogRepository.save(chatStartupLog);
  //#endregion
  return
}

export async function saveMarkAsNotSuitRecord(
  ds: DataSource,
  _jobInfo,
  { encryptUserId },
  { autoStartupChatRecordId = undefined, markFrom = undefined, extInfo = undefined, markReason = undefined, markOp = undefined, jobSource = undefined } = {}
) {
  const { jobInfo } = _jobInfo;

  //#region mark-as-not-suit-log
  const markAsNotSuitLog = new MarkAsNotSuitLog()
  const markAsNotSuitLogPayload: Partial<MarkAsNotSuitLog> = {
    date: new Date(),
    encryptCurrentUserId: encryptUserId,
    encryptJobId: jobInfo.encryptId,
    autoStartupChatRecordId,
    markFrom,
    markReason,
    extInfo: extInfo ? JSON.stringify(extInfo) : undefined,
    markOp,
    jobSource,
  }
  Object.assign(markAsNotSuitLog, markAsNotSuitLogPayload)

  const markAsNotSuitLogRepository = ds.getRepository(MarkAsNotSuitLog);
  await markAsNotSuitLogRepository.save(markAsNotSuitLog);
  //#endregion
  return
}

export async function saveChatMessageRecord(
  ds: DataSource,
  records: ChatMessageRecord[]
) {
  //#region mark-as-not-suit-log
  const chatMessageRecordList = records.map(it => {
    const o = new ChatMessageRecord()
    Object.assign(o, it)
    return o
  })
  const chatMessageRecordRepository = ds.getRepository(ChatMessageRecord);
  await chatMessageRecordRepository.save(chatMessageRecordList);
  //#endregion
  return
}

export async function saveGptCompletionRequestRecord(
  ds: DataSource,
  records: LlmModelUsageRecord[]
) {
  //#region mark-as-not-suit-log
  const list = records.map(it => {
    const o = new LlmModelUsageRecord()
    for (const k of Object.keys(it)) {
      o[k] = it[k]
    }
    return o
  })
  const chatMessageRecordRepository = ds.getRepository(LlmModelUsageRecord);
  await chatMessageRecordRepository.save(list);
  //#endregion
  return
}

export async function getNotSuitMarkRecordsInLastSomeDays (ds: DataSource, days = 0) {
  const repo = ds.getRepository(MarkAsNotSuitLog)
  const result = await repo.findBy({
    date: Raw(alias => `DATE(${alias}) >= DATE('${
      new Date(
        Number(new Date()) - days * 24 * 60 * 60 * 1000
      ).toISOString()
    }')`)
  })
  return result
}

export async function getChatStartupRecordsInLastSomeDays (ds: DataSource, days = 0) {
  const repo = ds.getRepository(ChatStartupLog)
  const result = await repo.findBy({
    date: Raw(alias => `DATE(${alias}) >= DATE('${
      new Date(
        Number(new Date()) - days * 24 * 60 * 60 * 1000
      ).toISOString()
    }')`)
  })
  return result
}

export async function getBossIdsByJobIds (ds: DataSource, jobIds: string[] = []) {
  const repo = ds.getRepository(JobInfo)
  const result = await repo.find({
    where: jobIds.map(
      id => ({
        encryptJobId: id
      })
    )
  })
  return result
}

export async function saveJobHireStatusRecord(
  ds: DataSource,
  record: JobHireStatusRecord
) {
  const jobHireStatusRecordRepository = ds.getRepository(JobHireStatusRecord);
  await jobHireStatusRecordRepository.save(record);
  return
}

export async function getJobHireStatusRecord(
  ds: DataSource,
  encryptJobId: string
) {
  const repo = ds.getRepository(JobHireStatusRecord)
  const result = await repo.findOne({
    where: {
      encryptJobId
    }
  })
  return result
}

// ==================== Recruiter Auto-Reply Handlers ====================

/**
 * 保存候选人简历记录
 */
export async function saveCandidateResumeRecord(
  ds: DataSource,
  record: Partial<CandidateResumeRecord>
) {
  const repo = ds.getRepository(CandidateResumeRecord);
  const entity = new CandidateResumeRecord();
  Object.assign(entity, record);
  await repo.save(entity);
  return entity;
}

/**
 * 获取候选人简历记录
 */
export async function getCandidateResumeRecord(
  ds: DataSource,
  encryptGeekId: string
) {
  const repo = ds.getRepository(CandidateResumeRecord);
  return await repo.findOne({
    where: { encryptGeekId }
  });
}

/**
 * 保存候选人对话记录
 */
export async function saveCandidateConversation(
  ds: DataSource,
  conversation: Partial<CandidateConversation>
) {
  const repo = ds.getRepository(CandidateConversation);
  let entity: CandidateConversation;

  if (conversation.id) {
    entity = await repo.findOne({ where: { id: conversation.id } }) || new CandidateConversation();
  } else if (conversation.encryptGeekId && conversation.encryptJobId) {
    entity = await repo.findOne({
      where: {
        encryptGeekId: conversation.encryptGeekId,
        encryptJobId: conversation.encryptJobId
      }
    }) || new CandidateConversation();
  } else {
    entity = new CandidateConversation();
  }

  Object.assign(entity, conversation);
  await repo.save(entity);
  return entity;
}

/**
 * 获取候选人对话记录
 */
export async function getCandidateConversation(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
) {
  const repo = ds.getRepository(CandidateConversation);
  return await repo.findOne({
    where: {
      encryptGeekId,
      encryptJobId
    }
  });
}

/**
 * 保存招聘者处理日志
 */
export async function saveRecruiterProcessLog(
  ds: DataSource,
  log: Partial<RecruiterProcessLog>
) {
  const repo = ds.getRepository(RecruiterProcessLog);
  const entity = new RecruiterProcessLog();
  Object.assign(entity, log);
  await repo.save(entity);
  return entity;
}

/**
 * 保存招聘者每日统计
 */
export async function saveRecruiterDailyStats(
  ds: DataSource,
  stats: Partial<RecruiterDailyStats>
) {
  const repo = ds.getRepository(RecruiterDailyStats);
  let entity: RecruiterDailyStats;

  if (stats.id) {
    entity = await repo.findOne({ where: { id: stats.id } }) || new RecruiterDailyStats();
  } else if (stats.date) {
    const where: any = { date: stats.date };
    if (stats.encryptJobId !== undefined) {
      where.encryptJobId = stats.encryptJobId;
    }
    entity = await repo.findOne({ where }) || new RecruiterDailyStats();
  } else {
    entity = new RecruiterDailyStats();
  }

  Object.assign(entity, stats);
  await repo.save(entity);
  return entity;
}

/**
 * 获取招聘者每日统计
 */
export async function getRecruiterDailyStats(
  ds: DataSource,
  date: string,
  encryptJobId?: string
) {
  const repo = ds.getRepository(RecruiterDailyStats);
  const where: any = { date };
  if (encryptJobId !== undefined) {
    where.encryptJobId = encryptJobId;
  }
  return await repo.findOne({ where });
}

/**
 * 获取招聘者每日统计列表（按职位）
 */
export async function getRecruiterDailyStatsListByDate(
  ds: DataSource,
  date: string
) {
  const repo = ds.getRepository(RecruiterDailyStats);
  return await repo.find({
    where: { date }
  });
}

/**
 * 保存招聘者职位配置
 */
export async function saveRecruiterJobConfig(
  ds: DataSource,
  config: Partial<RecruiterJobConfig>
) {
  const repo = ds.getRepository(RecruiterJobConfig);
  let entity: RecruiterJobConfig;

  if (config.id) {
    entity = await repo.findOne({ where: { id: config.id } }) || new RecruiterJobConfig();
  } else if (config.encryptJobId) {
    entity = await repo.findOne({ where: { encryptJobId: config.encryptJobId } }) || new RecruiterJobConfig();
  } else {
    entity = new RecruiterJobConfig();
  }

  Object.assign(entity, config);
  await repo.save(entity);
  return entity;
}

/**
 * 获取招聘者职位配置列表
 */
export async function getRecruiterJobConfigList(ds: DataSource) {
  const repo = ds.getRepository(RecruiterJobConfig);
  return await repo.find({
    order: { createdAt: 'DESC' }
  });
}

/**
 * 获取单个招聘者职位配置
 */
export async function getRecruiterJobConfig(
  ds: DataSource,
  encryptJobId: string
) {
  const repo = ds.getRepository(RecruiterJobConfig);
  return await repo.findOne({
    where: { encryptJobId }
  });
}

/**
 * 删除招聘者职位配置
 */
export async function deleteRecruiterJobConfig(
  ds: DataSource,
  id: number
) {
  const repo = ds.getRepository(RecruiterJobConfig);
  await repo.delete(id);
}

/**
 * 获取候选人列表（分页）
 */
export async function getCandidateConversationList(
  ds: DataSource,
  params: {
    encryptJobId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const repo = ds.getRepository(CandidateConversation);
  const { encryptJobId, status, page = 1, pageSize = 20 } = params;

  const where: any = {};
  if (encryptJobId) where.encryptJobId = encryptJobId;
  if (status) where.status = status;

  const [list, total] = await repo.findAndCount({
    where,
    order: { updatedAt: 'DESC' },
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  return { list, total, page, pageSize };
}

/**
 * 获取招聘者处理日志列表
 */
export async function getRecruiterProcessLogList(
  ds: DataSource,
  params: {
    encryptGeekId?: string;
    encryptJobId?: string;
    action?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const repo = ds.getRepository(RecruiterProcessLog);
  const { encryptGeekId, encryptJobId, action, page = 1, pageSize = 20 } = params;

  const where: any = {};
  if (encryptGeekId) where.encryptGeekId = encryptGeekId;
  if (encryptJobId) where.encryptJobId = encryptJobId;
  if (action) where.action = action;

  const [list, total] = await repo.findAndCount({
    where,
    order: { createdAt: 'DESC' },
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  return { list, total, page, pageSize };
}

// ==================== Interview Auto Handlers ====================

/**
 * 保存面试岗位配置
 */
export async function saveInterviewJobPosition(
  ds: DataSource,
  data: Partial<InterviewJobPosition>
) {
  const repo = ds.getRepository(InterviewJobPosition);
  let entity: InterviewJobPosition;

  if (data.id) {
    entity = await repo.findOne({ where: { id: data.id } }) || new InterviewJobPosition();
  } else {
    entity = new InterviewJobPosition();
  }

  Object.assign(entity, data);
  await repo.save(entity);
  return entity;
}

/**
 * 获取面试岗位配置列表
 */
export async function getInterviewJobPositionList(ds: DataSource) {
  const repo = ds.getRepository(InterviewJobPosition);
  const questionRoundRepo = ds.getRepository(InterviewQuestionRound);

  const list = await repo.find({
    where: { isActive: true },
    order: { createdAt: 'DESC' }
  });

  // 为每个岗位获取问题轮次
  const result = await Promise.all(list.map(async (job) => {
    const questionRounds = await questionRoundRepo.find({
      where: { jobPositionId: job.id },
      order: { roundNumber: 'ASC' }
    });
    return { ...job, questionRounds };
  }));

  return result;
}

/**
 * 获取面试岗位配置（含问题轮次）
 */
export async function getInterviewJobPositionWithDetails(
  ds: DataSource,
  id: number
) {
  const repo = ds.getRepository(InterviewJobPosition);
  const questionRoundRepo = ds.getRepository(InterviewQuestionRound);

  const jobPosition = await repo.findOne({ where: { id } });
  if (!jobPosition) return null;

  const questionRounds = await questionRoundRepo.find({
    where: { jobPositionId: id },
    order: { roundNumber: 'ASC' }
  });

  return { ...jobPosition, questionRounds };
}

/**
 * 删除面试岗位配置
 */
export async function deleteInterviewJobPosition(ds: DataSource, id: number) {
  // 查找该岗位下所有候选人
  const candidateRepo = ds.getRepository(InterviewCandidate);
  const candidates = await candidateRepo.find({ where: { jobPositionId: id } });
  const candidateIds = candidates.map(c => c.id!);

  // 删除候选人关联的问答记录
  if (candidateIds.length > 0) {
    const qaRepo = ds.getRepository(InterviewQaRecord);
    await qaRepo.delete(candidateIds.map(cid => ({ candidateId: cid })));

    // 删除候选人关联的简历记录
    const resumeRepo = ds.getRepository(InterviewResume);
    await resumeRepo.delete(candidateIds.map(cid => ({ candidateId: cid })));

    // 删除候选人关联的操作日志
    const operationLogRepo = ds.getRepository(InterviewOperationLog);
    await operationLogRepo.delete(candidateIds.map(cid => ({ candidateId: cid })));

    // 删除候选人
    await candidateRepo.delete(candidateIds);
  }

  // 删除关联的问题轮次
  const questionRoundRepo = ds.getRepository(InterviewQuestionRound);
  await questionRoundRepo.delete({ jobPositionId: id });

  // 最后删除岗位
  const repo = ds.getRepository(InterviewJobPosition);
  await repo.delete(id);
}

/**
 * 保存问题轮次
 */
export async function saveInterviewQuestionRound(
  ds: DataSource,
  data: Partial<InterviewQuestionRound>
) {
  const repo = ds.getRepository(InterviewQuestionRound);
  let entity: InterviewQuestionRound;

  if (data.id) {
    entity = await repo.findOne({ where: { id: data.id } }) || new InterviewQuestionRound();
  } else {
    entity = new InterviewQuestionRound();
  }

  Object.assign(entity, data);
  await repo.save(entity);
  return entity;
}

/**
 * 删除问题轮次
 */
export async function deleteInterviewQuestionRound(ds: DataSource, id: number) {
  const repo = ds.getRepository(InterviewQuestionRound);
  await repo.delete(id);
}

/**
 * 保存面试候选人
 */
export async function saveInterviewCandidate(
  ds: DataSource,
  data: Partial<InterviewCandidate>
) {
  const repo = ds.getRepository(InterviewCandidate);
  let entity: InterviewCandidate;

  if (data.id) {
    entity = await repo.findOne({ where: { id: data.id } }) || new InterviewCandidate();
  } else if (data.encryptGeekId) {
    // 如果 encryptJobId 为空，只按 encryptGeekId 查找，避免因 SQLite NULL != NULL 导致重复创建
    if (!data.encryptJobId || data.encryptJobId === '') {
      entity = await repo.findOne({ where: { encryptGeekId: data.encryptGeekId } }) || new InterviewCandidate();
    } else {
      entity = await repo.findOne({
        where: {
          encryptGeekId: data.encryptGeekId,
          encryptJobId: data.encryptJobId
        }
      }) || new InterviewCandidate();
    }
  } else {
    entity = new InterviewCandidate();
  }

  Object.assign(entity, data);
  await repo.save(entity);
  return entity;
}

/**
 * 获取面试候选人
 * 修复：当 encryptJobId 为空时，只用 encryptGeekId 查找，避免重复创建
 */
export async function getInterviewCandidate(
  ds: DataSource,
  encryptGeekId: string,
  encryptJobId: string
) {
  const repo = ds.getRepository(InterviewCandidate);

  // 如果 encryptJobId 有值，精确匹配
  if (encryptJobId) {
    return await repo.findOne({
      where: { encryptGeekId, encryptJobId }
    });
  }

  // 如果 encryptJobId 为空，只用 encryptGeekId 查找
  // 优先返回有 encryptJobId 的记录（更完整的数据）
  const candidates = await repo.find({
    where: { encryptGeekId }
  });

  if (candidates.length === 0) {
    return null;
  }

  // 优先返回有 encryptJobId 的记录
  const withJobId = candidates.find(c => c.encryptJobId && c.encryptJobId !== '');
  return withJobId || candidates[0];
}

/**
 * 获取面试候选人列表（分页）
 */
export async function getInterviewCandidateList(
  ds: DataSource,
  params: {
    status?: string;
    jobPositionId?: number;
    page?: number;
    pageSize?: number;
  }
) {
  const repo = ds.getRepository(InterviewCandidate);
  const { status, jobPositionId, page = 1, pageSize = 20 } = params;

  const where: any = {};
  if (status) where.status = status;
  if (jobPositionId) where.jobPositionId = jobPositionId;

  const [list, total] = await repo.findAndCount({
    where,
    order: { updatedAt: 'DESC' },
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  return { list, total, page, pageSize };
}

/**
 * 更新候选人状态
 */
export async function updateInterviewCandidateStatus(
  ds: DataSource,
  id: number,
  status: string,
  extraData?: Partial<InterviewCandidate>
) {
  const repo = ds.getRepository(InterviewCandidate);
  const entity = await repo.findOne({ where: { id } });
  if (!entity) return null;

  entity.status = status;
  if (extraData) {
    Object.assign(entity, extraData);
  }
  await repo.save(entity);
  return entity;
}

/**
 * 保存问答记录
 * 修复：支持 candidateId + roundNumber 查找，避免唯一约束冲突
 */
export async function saveInterviewQaRecord(
  ds: DataSource,
  data: Partial<InterviewQaRecord>
) {
  const repo = ds.getRepository(InterviewQaRecord);
  let entity: InterviewQaRecord;

  if (data.id) {
    entity = await repo.findOne({ where: { id: data.id } }) || new InterviewQaRecord();
  } else if (data.candidateId && data.roundNumber) {
    // 用 candidateId + roundNumber 查找，避免唯一约束冲突
    entity = await repo.findOne({
      where: {
        candidateId: data.candidateId,
        roundNumber: data.roundNumber
      }
    }) || new InterviewQaRecord();
  } else {
    entity = new InterviewQaRecord();
  }

  Object.assign(entity, data);
  await repo.save(entity);
  return entity;
}

/**
 * 获取候选人问答记录
 */
export async function getInterviewQaRecordList(
  ds: DataSource,
  candidateId: number
) {
  const repo = ds.getRepository(InterviewQaRecord);
  return await repo.find({
    where: { candidateId },
    order: { roundNumber: 'ASC' }
  });
}

/**
 * 保存简历记录
 */
export async function saveInterviewResume(
  ds: DataSource,
  data: Partial<InterviewResume>
) {
  const repo = ds.getRepository(InterviewResume);
  let entity: InterviewResume;

  if (data.id) {
    entity = await repo.findOne({ where: { id: data.id } }) || new InterviewResume();
  } else if (data.candidateId) {
    entity = await repo.findOne({ where: { candidateId: data.candidateId } }) || new InterviewResume();
  } else {
    entity = new InterviewResume();
  }

  Object.assign(entity, data);
  await repo.save(entity);
  return entity;
}

/**
 * 获取简历记录
 */
export async function getInterviewResume(
  ds: DataSource,
  candidateId: number
) {
  const repo = ds.getRepository(InterviewResume);
  return await repo.findOne({ where: { candidateId } });
}

/**
 * 保存系统配置
 */
export async function saveInterviewSystemConfig(
  ds: DataSource,
  key: string,
  value: string,
  isEncrypted: boolean = false
) {
  const repo = ds.getRepository(InterviewSystemConfig);
  let entity = await repo.findOne({ where: { configKey: key } });

  if (!entity) {
    entity = new InterviewSystemConfig();
    entity.configKey = key;
  }

  entity.configValue = value;
  entity.isEncrypted = isEncrypted;
  await repo.save(entity);
  return entity;
}

/**
 * 获取系统配置
 */
export async function getInterviewSystemConfig(
  ds: DataSource,
  key: string
) {
  const repo = ds.getRepository(InterviewSystemConfig);
  const entity = await repo.findOne({ where: { configKey: key } });
  return entity?.configValue;
}

/**
 * 获取所有系统配置
 */
export async function getAllInterviewSystemConfig(ds: DataSource) {
  const repo = ds.getRepository(InterviewSystemConfig);
  const list = await repo.find();
  const config: Record<string, any> = {};
  for (const item of list) {
    try {
      config[item.configKey] = JSON.parse(item.configValue);
    } catch {
      config[item.configKey] = item.configValue;
    }
  }
  return config;
}

/**
 * 保存操作日志
 */
export async function saveInterviewOperationLog(
  ds: DataSource,
  data: Partial<InterviewOperationLog>
) {
  const repo = ds.getRepository(InterviewOperationLog);
  const entity = new InterviewOperationLog();
  Object.assign(entity, data);
  await repo.save(entity);
  return entity;
}

/**
 * 获取操作日志列表
 */
export async function getInterviewOperationLogList(
  ds: DataSource,
  params: {
    candidateId?: number;
    action?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const repo = ds.getRepository(InterviewOperationLog);
  const { candidateId, action, page = 1, pageSize = 50 } = params;

  const where: any = {};
  if (candidateId) where.candidateId = candidateId;
  if (action) where.action = action;

  const [list, total] = await repo.findAndCount({
    where,
    order: { createdAt: 'DESC' },
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  return { list, total, page, pageSize };
}

/**
 * 获取待处理的候选人（按状态）
 */
export async function getPendingInterviewCandidates(
  ds: DataSource,
  statuses: string[]
) {
  const repo = ds.getRepository(InterviewCandidate);
  return await repo.find({
    where: statuses.map(s => ({ status: s })),
    order: { updatedAt: 'ASC' }
  });
}

/**
 * 统计候选人状态数量
 */
export async function countInterviewCandidatesByStatus(ds: DataSource) {
  const repo = ds.getRepository(InterviewCandidate);
  const result = await repo
    .createQueryBuilder('candidate')
    .select('candidate.status', 'status')
    .addSelect('COUNT(*)', 'count')
    .groupBy('candidate.status')
    .getRawMany();

  const stats: Record<string, number> = {};
  for (const item of result) {
    stats[item.status] = Number(item.count);
  }
  return stats;
}