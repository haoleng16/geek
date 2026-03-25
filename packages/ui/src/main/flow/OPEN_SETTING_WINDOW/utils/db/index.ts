import createDbWorker from './worker/index?nodeWorker&url'
import { type Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { PageReq } from '../../../../../common/types/pagination'

let worker: Worker | null = null
let workerExitCode: number | null = null
export const initDbWorker = () => {
  if (!worker || typeof workerExitCode === 'number') {
    worker = createDbWorker()
    workerExitCode = null
    return new Promise((resolve, reject) => {
      worker!.once('exit', (exitCode) => {
        workerExitCode = exitCode
        worker = null
      })
      worker!.on('message', function handler(data) {
        if (data.type === 'DB_INIT_SUCCESS') {
          resolve(worker)
          // attach more event
          worker?.off('message', handler)
        } else if (data.type === 'DB_INIT_FAIL') {
          reject(data.error)
          worker?.terminate()
          worker?.off('message', handler)
          worker = null
        }
      })
    })
  } else {
    return worker
  }
}

const createWorkerPromise = async (data) => {
  await initDbWorker()
  const uuid = randomUUID()
  worker!.postMessage({
    _uuid: uuid,
    ...data
  })
  return new Promise((resolve) => {
    worker!.on('message', function handler(data) {
      const { _uuid, ...payload } = data ?? {}
      if (_uuid === uuid) {
        resolve(payload)
        worker?.off('message', handler)
      }
    })
  })
}

export const getAutoStartChatRecord = async ({ pageNo, pageSize }: Partial<PageReq> = {}) => {
  const res = await createWorkerPromise({
    type: 'getAutoStartChatRecord',
    pageNo,
    pageSize
  })
  return res
}

export const getMarkAsNotSuitRecord = async ({ pageNo, pageSize }: Partial<PageReq> = {}) => {
  const res = await createWorkerPromise({
    type: 'getMarkAsNotSuitRecord',
    pageNo,
    pageSize
  })
  return res
}

export const getJobLibrary = async ({ pageNo, pageSize }: Partial<PageReq> = {}) => {
  const res = await createWorkerPromise({
    type: 'getJobLibrary',
    pageNo,
    pageSize
  })
  return res
}

export const getJobHistoryByEncryptId = async (encryptJobId) => {
  const res = await createWorkerPromise({
    type: 'getJobHistoryByEncryptId',
    encryptJobId
  })
  return res
}

export const saveAndGetCurrentRunRecord = async () => {
  const res = await createWorkerPromise({
    type: 'saveAndGetCurrentRunRecord'
  })
  return res
}

// ==================== Recruiter Auto-Reply DB Functions ====================

export const getRecruiterJobConfigList = async () => {
  const res = await createWorkerPromise({
    type: 'getRecruiterJobConfigList'
  })
  return res
}

export const saveRecruiterJobConfig = async (config: any) => {
  const res = await createWorkerPromise({
    type: 'saveRecruiterJobConfig',
    config
  })
  return res
}

export const deleteRecruiterJobConfig = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'deleteRecruiterJobConfig',
    id
  })
  return res
}

export const getCandidateConversationList = async (params: {
  encryptJobId?: string
  status?: string
  page?: number
  pageSize?: number
}) => {
  const res = await createWorkerPromise({
    type: 'getCandidateConversationList',
    ...params
  })
  return res
}

export const getRecruiterDailyStats = async (date: string, encryptJobId?: string) => {
  const res = await createWorkerPromise({
    type: 'getRecruiterDailyStats',
    date,
    encryptJobId
  })
  return res
}

export const saveRecruiterDailyStats = async (stats: any) => {
  const res = await createWorkerPromise({
    type: 'saveRecruiterDailyStats',
    ...stats
  })
  return res
}

export const getRecruiterProcessLogList = async (params: {
  encryptGeekId?: string
  encryptJobId?: string
  action?: string
  page?: number
  pageSize?: number
}) => {
  const res = await createWorkerPromise({
    type: 'getRecruiterProcessLogList',
    ...params
  })
  return res
}

export const saveRecruiterProcessLog = async (log: any) => {
  const res = await createWorkerPromise({
    type: 'saveRecruiterProcessLog',
    ...log
  })
  return res
}

export const saveCandidateConversation = async (conversation: any) => {
  const res = await createWorkerPromise({
    type: 'saveCandidateConversation',
    ...conversation
  })
  return res
}

export const getCandidateConversation = async (encryptGeekId: string, encryptJobId: string) => {
  const res = await createWorkerPromise({
    type: 'getCandidateConversation',
    encryptGeekId,
    encryptJobId
  })
  return res
}
