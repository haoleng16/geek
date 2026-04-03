import { MigrationInterface, QueryRunner } from "typeorm"

/**
 * 添加学历字段到候选人表迁移
 *
 * 新增字段：
 * - education: 最高学历
 * - school: 毕业院校
 * - major: 专业
 * - educationDetail: 完整教育经历JSON
 */
export class AddEducationFieldsToInterviewCandidate1800000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('[Migration] AddEducationFieldsToInterviewCandidate started');

    // 添加学历字段
    await queryRunner.query(`
      ALTER TABLE "interview_candidate" ADD COLUMN "education" VARCHAR(255);
    `);

    // 添加院校字段
    await queryRunner.query(`
      ALTER TABLE "interview_candidate" ADD COLUMN "school" VARCHAR(255);
    `);

    // 添加专业字段
    await queryRunner.query(`
      ALTER TABLE "interview_candidate" ADD COLUMN "major" VARCHAR(255);
    `);

    // 添加教育经历详情字段
    await queryRunner.query(`
      ALTER TABLE "interview_candidate" ADD COLUMN "educationDetail" TEXT;
    `);

    console.log('[Migration] AddEducationFieldsToInterviewCandidate completed successfully');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚：删除新增的字段
    await queryRunner.query(`
      ALTER TABLE "interview_candidate" DROP COLUMN "educationDetail";
    `);

    await queryRunner.query(`
      ALTER TABLE "interview_candidate" DROP COLUMN "major";
    `);

    await queryRunner.query(`
      ALTER TABLE "interview_candidate" DROP COLUMN "school";
    `);

    await queryRunner.query(`
      ALTER TABLE "interview_candidate" DROP COLUMN "education";
    `);

    console.log('[Migration] AddEducationFieldsToInterviewCandidate rollback completed');
  }
}