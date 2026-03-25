import 'reflect-metadata'
import { parentPort } from 'node:worker_threads'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { type DataSource } from 'typeorm'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { VChatStartupLog } from '@geekgeekrun/sqlite-plugin/dist/entity/VChatStartupLog'
import { VJobLibrary } from '@geekgeekrun/sqlite-plugin/dist/entity/VJobLibrary'
import { VCompanyLibrary } from '@geekgeekrun/sqlite-plugin/dist/entity/VCompanyLibrary'
import { VBossLibrary } from '@geekgeekrun/sqlite-plugin/dist/entity/VBossLibrary'
import { VMarkAsNotSuitLog } from '@geekgeekrun/sqlite-plugin/dist/entity/VMarkAsNotSuitLog'
import { measureExecutionTime } from '../../../../../../common/utils/performance'
import { PageReq, PagedRes } from '../../../../../../common/types/pagination'
import { JobInfoChangeLog } from '@geekgeekrun/sqlite-plugin/dist/entity/JobInfoChangeLog'
import { AutoStartChatRunRecord } from '@geekgeekrun/sqlite-plugin/dist/entity/AutoStartChatRunRecord'
import { RecruiterJobConfig } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterJobConfig'
import { CandidateConversation } from '@geekgeekrun/sqlite-plugin/dist/entity/CandidateConversation'
import { RecruiterProcessLog } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterProcessLog'
import { RecruiterDailyStats } from '@geekgeekrun/sqlite-plugin/dist/entity/RecruiterDailyStats'

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
  async getCompanyLibrary({ pageNo, pageSize }: Partial<PageReq> = {}): Promise<
    PagedRes<VCompanyLibrary>
  > {
    if (!pageNo) {
      pageNo = 1
    }
    if (!pageSize) {
      pageSize = 10
    }

    const userRepository = dataSource!.getRepository(VCompanyLibrary)!
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
  async getBossLibrary({ pageNo, pageSize }: Partial<PageReq> = {}): Promise<
    PagedRes<VBossLibrary>
  > {
    if (!pageNo) {
      pageNo = 1
    }
    if (!pageSize) {
      pageSize = 10
    }

    const userRepository = dataSource!.getRepository(VBossLibrary)!
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
