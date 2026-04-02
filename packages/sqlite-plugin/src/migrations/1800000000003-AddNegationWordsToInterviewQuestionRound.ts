import { MigrationInterface, QueryRunner } from "typeorm"

/**
 * 添加否定词字段到问题轮次表迁移
 *
 * 新增字段：
 * - negationWords: 否定词配置（JSON数组）
 *   当这些词出现在关键词前面近距离内时，视为否定该关键词，评分不通过
 */
export class AddNegationWordsToInterviewQuestionRound1800000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('[Migration] AddNegationWordsToInterviewQuestionRound started');

    // 添加否定词字段
    await queryRunner.query(`
      ALTER TABLE "interview_question_round" ADD COLUMN "negationWords" TEXT;
    `);

    console.log('[Migration] AddNegationWordsToInterviewQuestionRound completed successfully');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚：删除新增的字段
    await queryRunner.query(`
      ALTER TABLE "interview_question_round" DROP COLUMN "negationWords";
    `);

    console.log('[Migration] AddNegationWordsToInterviewQuestionRound rollback completed');
  }
}