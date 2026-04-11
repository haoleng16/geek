/**
 * 面试自动化 - 状态管理模块
 *
 * 负责候选人状态流转和管理
 */

import type { DataSource } from 'typeorm'
import {
  updateInterviewCandidateStatus,
  getInterviewJobPositionWithDetails,
  saveInterviewOperationLog
} from '@geekgeekrun/sqlite-plugin/handlers'
import { InterviewCandidateStatus } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewCandidate } from '@geekgeekrun/sqlite-plugin/entity/InterviewCandidate'
import type { InterviewQuestionRound } from '@geekgeekrun/sqlite-plugin/entity/InterviewQuestionRound'

/**
 * 获取候选人当前状态
 */
export function getCurrentStatus(candidate: InterviewCandidate): string {
  return candidate.status
}

/**
 * 获取等待回复的状态
 */
export function getWaitingStatus(roundNumber: number): string {
  switch (roundNumber) {
    case 1:
      return InterviewCandidateStatus.WAITING_ROUND_1
    case 2:
      return InterviewCandidateStatus.WAITING_ROUND_2
    default:
      return InterviewCandidateStatus.WAITING_ROUND_N
  }
}

/**
 * 检查是否需要发送下一轮问题
 */
export async function shouldSendNextRound(
  ds: DataSource,
  candidate: InterviewCandidate
): Promise<{ hasNext: boolean; nextRound?: InterviewQuestionRound }> {
  try {
    if (!candidate.jobPositionId) {
      return { hasNext: false }
    }

    const jobPosition = await getInterviewJobPositionWithDetails(ds, candidate.jobPositionId)
    if (!jobPosition || !jobPosition.questionRounds) {
      return { hasNext: false }
    }

    const nextRoundNumber = candidate.currentRound + 1
    const nextRound = jobPosition.questionRounds.find(
      (r: InterviewQuestionRound) => r.roundNumber === nextRoundNumber
    )

    if (nextRound) {
      return { hasNext: true, nextRound }
    }

    return { hasNext: false }
  } catch (error) {
    console.error('[StatusManager] 检查下一轮问题失败:', error)
    return { hasNext: false }
  }
}

/**
 * 检查回复是否超时
 */
export function isAnswerTimeout(
  candidate: InterviewCandidate,
  timeoutMinutes: number = 60
): boolean {
  if (!candidate.lastQuestionAt) {
    return false
  }

  const lastQuestionTime = new Date(candidate.lastQuestionAt).getTime()
  const now = Date.now()
  const elapsedMinutes = (now - lastQuestionTime) / (1000 * 60)

  return elapsedMinutes > timeoutMinutes
}

/**
 * 转换到下一状态
 */
export async function transitionToNextStatus(
  ds: DataSource,
  candidate: InterviewCandidate,
  currentScore: number,
  passThreshold: number
): Promise<string> {
  try {
    // 根据分数决定下一个状态
    if (currentScore < passThreshold) {
      // 未通过，标记为拒绝
      await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.REJECTED, {
        totalScore: currentScore
      })

      await saveInterviewOperationLog(ds, {
        candidateId: candidate.id,
        action: 'rejected',
        detail: JSON.stringify({ score: currentScore, threshold: passThreshold })
      })

      return InterviewCandidateStatus.REJECTED
    }

    // 通过，检查是否有下一轮
    const { hasNext, nextRound } = await shouldSendNextRound(ds, candidate)

    if (hasNext && nextRound) {
      // 有下一轮，等待发送问题
      const waitingStatus = getWaitingStatus(nextRound.roundNumber)
      await updateInterviewCandidateStatus(ds, candidate.id!, waitingStatus, {
        currentRound: nextRound.roundNumber - 1 // 将在发送问题后更新
      })

      return waitingStatus
    }

    // 没有下一轮，全部通过
    await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.PASSED, {
      totalScore: currentScore
    })

    await saveInterviewOperationLog(ds, {
      candidateId: candidate.id,
      action: 'passed',
      detail: JSON.stringify({ score: currentScore, threshold: passThreshold })
    })

    return InterviewCandidateStatus.PASSED
  } catch (error) {
    console.error('[StatusManager] 状态转换失败:', error)
    return candidate.status
  }
}

/**
 * 转换到简历请求状态
 */
export async function transitionToResumeRequested(
  ds: DataSource,
  candidate: InterviewCandidate
): Promise<void> {
  await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.RESUME_REQUESTED)

  await saveInterviewOperationLog(ds, {
    candidateId: candidate.id,
    action: 'resume_requested'
  })
}

/**
 * 转换到已收到简历状态
 */
export async function transitionToResumeReceived(
  ds: DataSource,
  candidate: InterviewCandidate
): Promise<void> {
  await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.RESUME_RECEIVED)

  await saveInterviewOperationLog(ds, {
    candidateId: candidate.id,
    action: 'resume_received'
  })
}

/**
 * 转换到已发送邮件状态
 */
export async function transitionToEmailed(
  ds: DataSource,
  candidate: InterviewCandidate
): Promise<void> {
  await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.EMAILED)

  await saveInterviewOperationLog(ds, {
    candidateId: candidate.id,
    action: 'email_sent'
  })
}

/**
 * 转换到错误状态
 */
export async function transitionToError(
  ds: DataSource,
  candidate: InterviewCandidate,
  errorMessage: string
): Promise<void> {
  await updateInterviewCandidateStatus(ds, candidate.id!, InterviewCandidateStatus.ERROR)

  await saveInterviewOperationLog(ds, {
    candidateId: candidate.id,
    action: 'error',
    errorMessage
  })
}

/**
 * 获取状态显示文本
 */
export function getStatusDisplayText(status: string): string {
  const statusMap: Record<string, string> = {
    [InterviewCandidateStatus.NEW]: '新候选人',
    [InterviewCandidateStatus.WAITING_ROUND_1]: '等待第1轮回复',
    [InterviewCandidateStatus.WAITING_ROUND_2]: '等待第2轮回复',
    [InterviewCandidateStatus.WAITING_ROUND_N]: '等待回复中',
    [InterviewCandidateStatus.REPLY_EXTRACTION_FAILED]: '回复提取失败',
    [InterviewCandidateStatus.PASSED]: '已通过',
    [InterviewCandidateStatus.REJECTED]: '已拒绝',
    [InterviewCandidateStatus.RESUME_REQUESTED]: '已发送简历邀请',
    [InterviewCandidateStatus.RESUME_RECEIVED]: '已收到简历',
    [InterviewCandidateStatus.EMAILED]: '已发送邮件',
    [InterviewCandidateStatus.ERROR]: '处理出错'
  }

  return statusMap[status] || status
}

/**
 * 检查是否是最终状态
 */
export function isFinalStatus(status: string): boolean {
  const finalStatuses = [
    InterviewCandidateStatus.REJECTED,
    InterviewCandidateStatus.EMAILED,
    InterviewCandidateStatus.ERROR
  ]

  return finalStatuses.includes(status)
}

/**
 * 检查是否是等待状态
 */
export function isWaitingStatus(status: string): boolean {
  const waitingStatuses = [
    InterviewCandidateStatus.WAITING_ROUND_1,
    InterviewCandidateStatus.WAITING_ROUND_2,
    InterviewCandidateStatus.WAITING_ROUND_N,
    InterviewCandidateStatus.REPLY_EXTRACTION_FAILED
  ]

  return waitingStatuses.includes(status)
}
