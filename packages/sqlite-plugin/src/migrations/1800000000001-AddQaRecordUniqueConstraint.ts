import { MigrationInterface, QueryRunner } from "typeorm"

/**
 * 添加问答记录唯一约束迁移
 *
 * 解决问答记录重复保存的问题：
 * 1. 清理已有的重复记录（保留最新的那条）
 * 2. 添加 candidateId + roundNumber 的唯一约束
 */
export class AddQaRecordUniqueConstraint1800000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('[Migration] AddQaRecordUniqueConstraint started');

    // 1. 清理重复记录：对于每个 candidateId + roundNumber 组合，只保留 id 最大（最新）的记录
    await queryRunner.query(`
      DELETE FROM "interview_qa_record"
      WHERE "id" NOT IN (
        SELECT MAX("id")
        FROM "interview_qa_record"
        GROUP BY "candidateId", "roundNumber"
      );
    `);

    console.log('[Migration] Duplicate records cleaned');

    // 2. 删除旧的普通索引
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_interview_qa_candidate_round";
    `);

    // 3. 创建新的唯一索引
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_interview_qa_candidate_round_unique"
      ON "interview_qa_record" ("candidateId", "roundNumber");
    `);

    console.log('[Migration] AddQaRecordUniqueConstraint completed successfully');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚：删除唯一索引，恢复普通索引
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_interview_qa_candidate_round_unique";
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_qa_candidate_round"
      ON "interview_qa_record" ("candidateId", "roundNumber");
    `);

    console.log('[Migration] AddQaRecordUniqueConstraint rollback completed');
  }
}