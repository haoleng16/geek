import { MigrationInterface, QueryRunner } from "typeorm"

/**
 * 修复面试候选人重复记录
 *
 * 根因：虚拟滚动导致 encryptJobId 在不同扫描间不稳定（有时为空有时有值），
 * saveInterviewCandidate 旧逻辑中 Object.assign 会用空值覆盖非空 encryptJobId，
 * 导致下次扫描时查不到原记录，产生重复。
 *
 * 本迁移：
 * 1. 找出按 encryptGeekId 重复的候选人记录
 * 2. 合并为一条（优先保留 encryptJobId 非空的记录）
 * 3. 将被删除记录关联的问答记录、操作日志迁移到保留的记录上
 */
export class FixInterviewCandidateDuplicates1800000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('[Migration] FixInterviewCandidateDuplicates started');

    // 1. 找出所有按 encryptGeekId 重复的候选人
    const duplicates = await queryRunner.query(`
      SELECT "encryptGeekId", COUNT(*) as cnt
      FROM "interview_candidate"
      WHERE "encryptGeekId" IS NOT NULL AND "encryptGeekId" != ''
      GROUP BY "encryptGeekId"
      HAVING COUNT(*) > 1;
    `);

    console.log(`[Migration] Found ${duplicates.length} groups of duplicate candidates`);

    for (const dup of duplicates) {
      const encryptGeekId = dup.encryptGeekId;

      // 获取该候选人的所有记录，按 id 排序
      const records = await queryRunner.query(
        `SELECT "id", "encryptGeekId", "encryptJobId", "geekName", "status", "currentRound", "totalScore", "createdAt"
         FROM "interview_candidate"
         WHERE "encryptGeekId" = ?
         ORDER BY "id" ASC`,
        [encryptGeekId]
      );

      if (records.length <= 1) continue;

      // 选择保留哪条记录：优先选 encryptJobId 非空的，其次选 id 最大（最新）的
      let keepRecord = records.find((r: any) => r.encryptJobId && r.encryptJobId !== '');
      if (!keepRecord) {
        keepRecord = records[records.length - 1];
      }

      const keepId = keepRecord.id;
      const removeIds = records.filter((r: any) => r.id !== keepId).map((r: any) => r.id);

      if (removeIds.length === 0) continue;

      console.log(
        `[Migration] Merging ${records.length} records for geekId=${encryptGeekId}: ` +
        `keeping id=${keepId}, removing ids=[${removeIds.join(', ')}]`
      );

      // 2. 将被删除记录关联的问答记录迁移到保留的记录
      for (const removeId of removeIds) {
        await queryRunner.query(
          `UPDATE "interview_qa_record" SET "candidateId" = ? WHERE "candidateId" = ?`,
          [keepId, removeId]
        );

        // 迁移操作日志
        await queryRunner.query(
          `UPDATE "interview_operation_log" SET "candidateId" = ? WHERE "candidateId" = ?`,
          [keepId, removeId]
        );

        // 迁移简历记录
        await queryRunner.query(
          `UPDATE "interview_resume" SET "candidateId" = ? WHERE "candidateId" = ?`,
          [keepId, removeId]
        );
      }

      // 3. 删除重复记录
      const placeholders = removeIds.map(() => '?').join(',');
      await queryRunner.query(
        `DELETE FROM "interview_candidate" WHERE "id" IN (${placeholders})`,
        removeIds
      );

      // 4. 如果保留记录缺少 encryptJobId 但被删除记录中有，补充过来
      if ((!keepRecord.encryptJobId || keepRecord.encryptJobId === '')) {
        const recordWithJobId = records.find(
          (r: any) => r.id !== keepId && r.encryptJobId && r.encryptJobId !== ''
        );
        if (recordWithJobId) {
          await queryRunner.query(
            `UPDATE "interview_candidate" SET "encryptJobId" = ? WHERE "id" = ?`,
            [recordWithJobId.encryptJobId, keepId]
          );
          console.log(
            `[Migration] Restored encryptJobId for candidate id=${keepId}`
          );
        }
      }
    }

    console.log('[Migration] FixInterviewCandidateDuplicates completed successfully');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚：无法恢复已删除的重复记录
    console.log('[Migration] FixInterviewCandidateDuplicates rollback: Cannot restore merged records');
  }
}
