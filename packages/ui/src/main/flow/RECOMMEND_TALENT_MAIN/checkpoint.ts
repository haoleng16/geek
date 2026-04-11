import type { DataSource } from 'typeorm'
import { RecommendRunCheckpoint } from '@geekgeekrun/sqlite-plugin/dist/entity/RecommendRunCheckpoint'

export async function createCheckpoint(
  dataSource: DataSource,
  sessionId: string,
  encryptJobId: string
): Promise<RecommendRunCheckpoint> {
  const repo = dataSource.getRepository(RecommendRunCheckpoint)
  const checkpoint = new RecommendRunCheckpoint()
  checkpoint.sessionId = sessionId
  checkpoint.encryptJobId = encryptJobId
  checkpoint.currentPage = 1
  checkpoint.currentPageOffset = 0
  checkpoint.processedCount = 0
  checkpoint.matchedCount = 0
  checkpoint.skippedCount = 0
  checkpoint.collectedCount = 0
  checkpoint.status = 'running'
  checkpoint.startedAt = new Date()
  checkpoint.updatedAt = new Date()
  return await repo.save(checkpoint)
}

export async function loadCheckpoint(
  dataSource: DataSource,
  sessionId: string
): Promise<RecommendRunCheckpoint | null> {
  const repo = dataSource.getRepository(RecommendRunCheckpoint)
  return await repo.findOne({ where: { sessionId } })
}

export async function loadActiveCheckpoint(
  dataSource: DataSource,
  encryptJobId: string
): Promise<RecommendRunCheckpoint | null> {
  const repo = dataSource.getRepository(RecommendRunCheckpoint)
  return await repo.findOne({
    where: { encryptJobId, status: 'running' }
  })
}

export async function updateCheckpoint(
  dataSource: DataSource,
  sessionId: string,
  updates: Partial<RecommendRunCheckpoint>
): Promise<void> {
  const repo = dataSource.getRepository(RecommendRunCheckpoint)
  await repo.update({ sessionId }, { ...updates, updatedAt: new Date() })
}

export async function markCheckpointCompleted(
  dataSource: DataSource,
  sessionId: string
): Promise<void> {
  await updateCheckpoint(dataSource, sessionId, { status: 'completed' })
}

export async function markCheckpointError(
  dataSource: DataSource,
  sessionId: string,
  error: string
): Promise<void> {
  await updateCheckpoint(dataSource, sessionId, { status: 'error', errorMessage: error })
}
