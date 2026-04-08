import createDbWorker from './worker/index?nodeWorker&url'
import { type Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { PageReq } from '../../../../../common/types/pagination'

let worker: Worker | null = null
let workerExitCode: number | null = null
let workerInitError: any = null

export const initDbWorker = () => {
  if (!worker || typeof workerExitCode === 'number') {
    worker = createDbWorker()
    workerExitCode = null
    workerInitError = null
    return new Promise((resolve, reject) => {
      worker!.once('exit', (exitCode) => {
        workerExitCode = exitCode
        worker = null
      })
      worker!.on('message', function handler(data) {
        if (data.type === 'DB_INIT_SUCCESS') {
          workerInitError = null
          resolve(worker)
          worker?.off('message', handler)
        } else if (data.type === 'DB_INIT_FAIL') {
          const err = new Error(data.error?.message || 'DB init failed')
          err.stack = data.error?.stack || err.stack
          ;(err as any).code = data.error?.code
          workerInitError = err
          console.error('[DB Worker] 初始化失败:', err.message)
          reject(err)
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
  try {
    await initDbWorker()
  } catch (e) {
    // Worker 初始化失败，清除引用允许下次重建
    worker = null
    workerExitCode = null
    throw e
  }
  if (!worker) {
    throw new Error('DB worker not available')
  }
  const uuid = randomUUID()
  worker.postMessage({
    _uuid: uuid,
    ...data
  })
  return new Promise((resolve, reject) => {
    const currentWorker = worker!

    const cleanup = () => {
      currentWorker.off('message', messageHandler)
      currentWorker.off('exit', exitHandler)
    }

    function messageHandler(data) {
      const { _uuid, ...payload } = data ?? {}
      if (_uuid === uuid) {
        cleanup()
        resolve(payload)
      }
    }

    function exitHandler(exitCode) {
      cleanup()
      reject(new Error(`DB worker exited with code ${exitCode}`))
    }

    currentWorker.on('message', messageHandler)
    currentWorker.once('exit', exitHandler)
  })
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

// ==================== Recruiter Template DB Functions ====================

export const getRecruiterTemplateList = async (params?: {
  encryptJobId?: string
  templateType?: string
}) => {
  const res = await createWorkerPromise({
    type: 'getRecruiterTemplateList',
    ...params
  })
  return res
}

export const saveRecruiterTemplate = async (template: any) => {
  const res = await createWorkerPromise({
    type: 'saveRecruiterTemplate',
    template
  })
  return res
}

export const deleteRecruiterTemplate = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'deleteRecruiterTemplate',
    id
  })
  return res
}

export const getRecruiterTemplateById = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'getRecruiterTemplateById',
    id
  })
  return res
}

// ==================== Recruiter Contacted Candidate DB Functions ====================

export const getContactedCandidateList = async (params?: {
  encryptJobId?: string
  geekName?: string
  page?: number
  pageSize?: number
}) => {
  const res = await createWorkerPromise({
    type: 'getContactedCandidateList',
    ...params
  })
  return res
}

export const saveContactedCandidate = async (candidate: any) => {
  const res = await createWorkerPromise({
    type: 'saveContactedCandidate',
    candidate
  })
  return res
}

export const deleteContactedCandidate = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'deleteContactedCandidate',
    id
  })
  return res
}

export const getContactedCandidateById = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'getContactedCandidateById',
    id
  })
  return res
}

export const getContactedCandidateCount = async (params?: { encryptJobId?: string }) => {
  const res = await createWorkerPromise({
    type: 'getContactedCandidateCount',
    ...params
  })
  return res
}

// ==================== Smart Reply DB Functions ====================

export const getSmartReplyRecords = async (params?: {
  sessionId?: string
  geekName?: string
  page?: number
  pageSize?: number
}) => {
  const res = await createWorkerPromise({
    type: 'getSmartReplyRecords',
    ...params
  })
  return res
}

export const getSmartReplySessions = async () => {
  const res = await createWorkerPromise({
    type: 'getSmartReplySessions'
  })
  return res
}

// ==================== Interview Auto DB Functions ====================

export const getInterviewJobPositionList = async () => {
  const res = await createWorkerPromise({
    type: 'getInterviewJobPositionList'
  })
  return res
}

export const getInterviewJobPositionWithDetails = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'getInterviewJobPositionWithDetails',
    id
  })
  return res
}

export const saveInterviewJobPosition = async (data: any) => {
  const res = await createWorkerPromise({
    type: 'saveInterviewJobPosition',
    ...data
  })
  return res
}

export const deleteInterviewJobPosition = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'deleteInterviewJobPosition',
    id
  })
  return res
}

export const saveInterviewQuestionRound = async (data: any) => {
  const res = await createWorkerPromise({
    type: 'saveInterviewQuestionRound',
    ...data
  })
  return res
}

export const deleteInterviewQuestionRound = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'deleteInterviewQuestionRound',
    id
  })
  return res
}

export const getInterviewCandidateList = async (params?: {
  status?: string
  jobPositionId?: number
  page?: number
  pageSize?: number
}) => {
  const res = await createWorkerPromise({
    type: 'getInterviewCandidateList',
    ...params
  })
  return res
}

export const getInterviewCandidate = async (id: number) => {
  const res = await createWorkerPromise({
    type: 'getInterviewCandidate',
    id
  })
  return res
}

export const getInterviewCandidateByGeekJob = async (encryptGeekId: string, encryptJobId: string) => {
  const res = await createWorkerPromise({
    type: 'getInterviewCandidateByGeekJob',
    encryptGeekId,
    encryptJobId
  })
  return res
}

export const saveInterviewCandidate = async (data: any) => {
  const res = await createWorkerPromise({
    type: 'saveInterviewCandidate',
    ...data
  })
  return res
}

export const updateInterviewCandidateStatus = async (id: number, status: string, extraData?: any) => {
  const res = await createWorkerPromise({
    type: 'updateInterviewCandidateStatus',
    id,
    status,
    extraData
  })
  return res
}

export const getInterviewQaRecordList = async (candidateId: number) => {
  const res = await createWorkerPromise({
    type: 'getInterviewQaRecordList',
    candidateId
  })
  return res
}

export const saveInterviewQaRecord = async (data: any) => {
  const res = await createWorkerPromise({
    type: 'saveInterviewQaRecord',
    ...data
  })
  return res
}

export const getInterviewResume = async (candidateId: number) => {
  const res = await createWorkerPromise({
    type: 'getInterviewResume',
    candidateId
  })
  return res
}

export const saveInterviewResume = async (data: any) => {
  const res = await createWorkerPromise({
    type: 'saveInterviewResume',
    ...data
  })
  return res
}

export const getInterviewSystemConfig = async (key: string) => {
  const res = await createWorkerPromise({
    type: 'getInterviewSystemConfig',
    key
  })
  return res
}

export const getAllInterviewSystemConfig = async () => {
  const res = await createWorkerPromise({
    type: 'getAllInterviewSystemConfig'
  })
  return res
}

export const saveInterviewSystemConfig = async (key: string, value: string, isEncrypted?: boolean) => {
  const res = await createWorkerPromise({
    type: 'saveInterviewSystemConfig',
    key,
    value,
    isEncrypted
  })
  return res
}

export const countInterviewCandidatesByStatus = async () => {
  const res = await createWorkerPromise({
    type: 'countInterviewCandidatesByStatus'
  })
  return res
}
