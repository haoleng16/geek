import 'reflect-metadata'
import { parentPort } from 'node:worker_threads'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { type DataSource } from 'typeorm'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { VChatStartupLog } from '@geekgeekrun/sqlite-plugin/dist/entity/VChatStartupLog'
import { VJobLibrary } from '@geekgeekrun/sqlite-plugin/dist/entity/VJobLibrary'
import { VMarkAsNotSuitLog } from '@geekgeekrun/sqlite-plugin/dist/entity/VMarkAsNotSuitLog'
import { measureExecutionTime } from '../../../../../../common/utils/performance'
import { PageReq, PagedRes } from '../../../../../../common/types/pagination'
import { JobInfoChangeLog } from '@geekgeekrun/sqlite-plugin/dist/entity/JobInfoChangeLog'
import { AutoStartChatRunRecord } from '@geekgeekrun/sqlite-plugin/dist/entity/AutoStartChatRunRecord'
import { RecruiterJobConfig } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterJobConfig'
import { CandidateConversation } from '@geekgeekrun/sqlite-plugin/dist/entity/CandidateConversation'
import { RecruiterProcessLog } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterProcessLog'
import { RecruiterDailyStats } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterDailyStats'
import { RecruiterTemplate } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterTemplate'
import { RecruiterContactedCandidate } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterContactedCandidate'

const dbInitPromise = initDb(getPublicDbFilePath())
let dataSource: DataSource | null = null

dbInitPromise.then(
  (_dataSource) => {
    dataSource = _dataSource
    attachMessageHandler()
    parentPort?.postMessage({
      type: 'DB_INIT_SUCCESS'
    })
  },
  (error) => {
    parentPort?.postMessage({
      type: 'DB_INIT_FAIL',
      error
    })
    process.exit(1)
  }
)

const payloadHandler = {
  async getAutoStartChatRecord({ pageNo, pageSize }: Partial<PageReq> = {}): Promise<
    PagedRes<VChatStartupLog>
  > {
    if (!pageNo) {
      pageNo = 1
    }
    if (!pageSize) {
      pageSize = 10
    }

    const userRepository = dataSource!.getRepository(VChatStartupLog)!
    const [data, totalItemCount] = await measureExecutionTime(
      userRepository.findAndCount({
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        order: {
          date: 'DESC'
        }
      })
    )
    return {
      data,
      pageNo,
      totalItemCount
    }
  },
  async getMarkAsNotSuitRecord({ pageNo, pageSize }: Partial<PageReq> = {}): Promise<
    PagedRes<VMarkAsNotSuitLog>
  > {
    if (!pageNo) {
      pageNo = 1
    }
    if (!pageSize) {
      pageSize = 10
    }
    const recordRepository = dataSource!.getRepository(VMarkAsNotSuitLog)!
    const [data, totalItemCount] = await measureExecutionTime(
      recordRepository.findAndCount({
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        order: {
          date: 'DESC'
        }
      })
    )
    return {
      data,
      pageNo,
      totalItemCount
    }
  },
  async getJobLibrary({ pageNo, pageSize }: Partial<PageReq> = {}): Promise<PagedRes<VJobLibrary>> {
    if (!pageNo) {
      pageNo = 1
    }
    if (!pageSize) {
      pageSize = 10
    }

    const userRepository = dataSource!.getRepository(VJobLibrary)!
    const [data, totalItemCount] = await measureExecutionTime(
      userRepository.findAndCount({
        skip: (pageNo - 1) * pageSize,
        take: pageSize
      })
    )
    return {
      data,
      pageNo,
      totalItemCount
    }
  },
  async getJobHistoryByEncryptId({ encryptJobId }): Promise<JobInfoChangeLog[]> {
    const jobInfoChangeLogRepository = dataSource!.getRepository(JobInfoChangeLog)!
    const data = await measureExecutionTime(
      jobInfoChangeLogRepository.find({
        where: {
          encryptJobId
        }
      })
    )
    return data
  },
  async saveAndGetCurrentRunRecord() {
    const autoStartChatRunRecord = new AutoStartChatRunRecord()
    autoStartChatRunRecord.date = new Date()
    const autoStartChatRunRecordRepository = dataSource!.getRepository(AutoStartChatRunRecord)
    const result = await autoStartChatRunRecordRepository.save(autoStartChatRunRecord)
    return result
  },
  // ==================== Recruiter Auto-Reply Handlers ====================
  async getRecruiterJobConfigList(): Promise<RecruiterJobConfig[]> {
    const repo = dataSource!.getRepository(RecruiterJobConfig)
    return await repo.find({
      order: { createdAt: 'DESC' }
    })
  },
  async saveRecruiterJobConfig(config: Partial<RecruiterJobConfig>): Promise<RecruiterJobConfig> {
    const repo = dataSource!.getRepository(RecruiterJobConfig)
    let entity: RecruiterJobConfig

    if (config.id) {
      entity = await repo.findOne({ where: { id: config.id } }) || new RecruiterJobConfig()
    } else if (config.encryptJobId) {
      entity = await repo.findOne({ where: { encryptJobId: config.encryptJobId } }) || new RecruiterJobConfig()
    } else {
      entity = new RecruiterJobConfig()
    }

    Object.assign(entity, config)
    return await repo.save(entity)
  },
  async deleteRecruiterJobConfig({ id }): Promise<void> {
    const repo = dataSource!.getRepository(RecruiterJobConfig)
    await repo.delete(id)
  },
  async getCandidateConversationList(params: {
    encryptJobId?: string
    status?: string
    page?: number
    pageSize?: number
  }): Promise<{ data: CandidateConversation[]; total: number }> {
    const { encryptJobId, status, page = 1, pageSize = 20 } = params
    const repo = dataSource!.getRepository(CandidateConversation)

    const where: any = {}
    if (encryptJobId) where.encryptJobId = encryptJobId
    if (status) where.status = status

    const [data, total] = await repo.findAndCount({
      where,
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })

    return { data, total, page, pageSize }
  },
  async getRecruiterDailyStats({ date, encryptJobId }): Promise<RecruiterDailyStats | null> {
    const repo = dataSource!.getRepository(RecruiterDailyStats)
    const where: any = { date }
    if (encryptJobId !== undefined) {
      where.encryptJobId = encryptJobId
    }
    return await repo.findOne({ where })
  },
  async saveRecruiterDailyStats(stats: Partial<RecruiterDailyStats>): Promise<RecruiterDailyStats> {
    const repo = dataSource!.getRepository(RecruiterDailyStats)
    let entity: RecruiterDailyStats

    if (stats.id) {
      entity = await repo.findOne({ where: { id: stats.id } }) || new RecruiterDailyStats()
    } else if (stats.date) {
      const where: any = { date: stats.date }
      if (stats.encryptJobId !== undefined) {
        where.encryptJobId = stats.encryptJobId
      }
      entity = await repo.findOne({ where }) || new RecruiterDailyStats()
    } else {
      entity = new RecruiterDailyStats()
    }

    Object.assign(entity, stats)
    return await repo.save(entity)
  },
  async getRecruiterProcessLogList(params: {
    encryptGeekId?: string
    encryptJobId?: string
    action?: string
    page?: number
    pageSize?: number
  }): Promise<{ data: RecruiterProcessLog[]; total: number }> {
    const { encryptGeekId, encryptJobId, action, page = 1, pageSize = 20 } = params
    const repo = dataSource!.getRepository(RecruiterProcessLog)

    const where: any = {}
    if (encryptGeekId) where.encryptGeekId = encryptGeekId
    if (encryptJobId) where.encryptJobId = encryptJobId
    if (action) where.action = action

    const [data, total] = await repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })

    return { data, total, page, pageSize }
  },
  async saveRecruiterProcessLog(log: Partial<RecruiterProcessLog>): Promise<RecruiterProcessLog> {
    const repo = dataSource!.getRepository(RecruiterProcessLog)
    const entity = new RecruiterProcessLog()
    Object.assign(entity, log)
    return await repo.save(entity)
  },
  async saveCandidateConversation(conversation: Partial<CandidateConversation>): Promise<CandidateConversation> {
    const repo = dataSource!.getRepository(CandidateConversation)
    let entity: CandidateConversation

    if (conversation.id) {
      entity = await repo.findOne({ where: { id: conversation.id } }) || new CandidateConversation()
    } else if (conversation.encryptGeekId && conversation.encryptJobId) {
      entity = await repo.findOne({
        where: {
          encryptGeekId: conversation.encryptGeekId,
          encryptJobId: conversation.encryptJobId
        }
      }) || new CandidateConversation()
    } else {
      entity = new CandidateConversation()
    }

    Object.assign(entity, conversation)
    return await repo.save(entity)
  },
  async getCandidateConversation({ encryptGeekId, encryptJobId }): Promise<CandidateConversation | null> {
    const repo = dataSource!.getRepository(CandidateConversation)
    return await repo.findOne({
      where: {
        encryptGeekId,
        encryptJobId
      }
    })
  },
  // ==================== Recruiter Template Handlers ====================
  async getRecruiterTemplateList(params?: {
    encryptJobId?: string
    templateType?: string
  }): Promise<RecruiterTemplate[]> {
    const { encryptJobId, templateType } = params || {}
    const repo = dataSource!.getRepository(RecruiterTemplate)

    const where: any = {}
    if (encryptJobId !== undefined) where.encryptJobId = encryptJobId
    if (templateType) where.templateType = templateType

    return await repo.find({
      where,
      order: { sortOrder: 'ASC', createdAt: 'ASC' }
    })
  },
  async saveRecruiterTemplate({ template }: { template: Partial<RecruiterTemplate> }): Promise<RecruiterTemplate> {
    const repo = dataSource!.getRepository(RecruiterTemplate)
    let entity: RecruiterTemplate

    if (template.id) {
      entity = await repo.findOne({ where: { id: template.id } }) || new RecruiterTemplate()
    } else {
      entity = new RecruiterTemplate()
    }

    Object.assign(entity, template)
    return await repo.save(entity)
  },
  async deleteRecruiterTemplate({ id }): Promise<void> {
    const repo = dataSource!.getRepository(RecruiterTemplate)
    await repo.delete(id)
  },
  async getRecruiterTemplateById({ id }): Promise<RecruiterTemplate | null> {
    const repo = dataSource!.getRepository(RecruiterTemplate)
    return await repo.findOne({ where: { id } })
  },
  // ==================== Recruiter Contacted Candidate Handlers ====================
  async getContactedCandidateList(params?: {
    encryptJobId?: string
    geekName?: string
    page?: number
    pageSize?: number
  }): Promise<{ data: RecruiterContactedCandidate[]; total: number }> {
    const { encryptJobId, geekName, page = 1, pageSize = 20 } = params || {}
    const repo = dataSource!.getRepository(RecruiterContactedCandidate)

    const where: any = {}
    if (encryptJobId) where.encryptJobId = encryptJobId
    // Note: For geekName, we need to use Like query, which is not directly supported in find's where
    // We'll use query builder for more complex queries

    if (geekName) {
      const qb = repo.createQueryBuilder('candidate')
        .where('candidate.encryptJobId = :encryptJobId OR :encryptJobId IS NULL', { encryptJobId: encryptJobId || null })
        .andWhere('candidate.geekName LIKE :geekName', { geekName: `%${geekName}%` })
        .orderBy('candidate.createdAt', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)

      const [data, total] = await qb.getManyAndCount()
      return { data, total, page, pageSize }
    }

    const [data, total] = await repo.findAndCount({
      where: Object.keys(where).length > 0 ? where : undefined,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })

    return { data, total, page, pageSize }
  },
  async saveContactedCandidate({ candidate }: { candidate: Partial<RecruiterContactedCandidate> }): Promise<RecruiterContactedCandidate> {
    const repo = dataSource!.getRepository(RecruiterContactedCandidate)
    let entity: RecruiterContactedCandidate

    if (candidate.id) {
      entity = await repo.findOne({ where: { id: candidate.id } }) || new RecruiterContactedCandidate()
    } else if (candidate.encryptGeekId && candidate.encryptJobId) {
      entity = await repo.findOne({
        where: {
          encryptGeekId: candidate.encryptGeekId,
          encryptJobId: candidate.encryptJobId
        }
      }) || new RecruiterContactedCandidate()
    } else {
      entity = new RecruiterContactedCandidate()
    }

    // If existing entity, increment reply count
    if (entity.id) {
      entity.replyCount = (entity.replyCount || 0) + 1
      entity.lastReplyAt = new Date()
    } else {
      entity.replyCount = 1
      entity.firstContactAt = new Date()
      entity.lastReplyAt = new Date()
    }

    Object.assign(entity, candidate)
    return await repo.save(entity)
  },
  async deleteContactedCandidate({ id }): Promise<void> {
    const repo = dataSource!.getRepository(RecruiterContactedCandidate)
    await repo.delete(id)
  },
  async getContactedCandidateById({ id }): Promise<RecruiterContactedCandidate | null> {
    const repo = dataSource!.getRepository(RecruiterContactedCandidate)
    return await repo.findOne({ where: { id } })
  },
  async getContactedCandidateCount(params?: { encryptJobId?: string }): Promise<number> {
    const { encryptJobId } = params || {}
    const repo = dataSource!.getRepository(RecruiterContactedCandidate)

    const where: any = {}
    if (encryptJobId) where.encryptJobId = encryptJobId

    return await repo.count({ where: Object.keys(where).length > 0 ? where : undefined })
  }
}

async function attachMessageHandler() {
  parentPort?.on('message', async (event) => {
    const { _uuid, ...restObj } = event
    const { type } = event

    if (!dataSource) {
      await dbInitPromise
    }
    const result = await payloadHandler[type](restObj)
    parentPort?.postMessage({
      _uuid,
      data: result
    })
  })
}
