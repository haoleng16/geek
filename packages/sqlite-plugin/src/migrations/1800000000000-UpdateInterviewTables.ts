import { MigrationInterface, QueryRunner } from "typeorm"

export class UpdateInterviewTables1800000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 修改 interview_question_round 表
    // 添加 keywords 字段
    await queryRunner.query(`
      ALTER TABLE "interview_question_round" ADD COLUMN "keywords" text;
    `);

    // 添加 llmPrompt 字段
    await queryRunner.query(`
      ALTER TABLE "interview_question_round" ADD COLUMN "llmPrompt" text;
    `);

    // 2. 修改 interview_job_position 表
    // 添加 resumeInviteText 字段
    await queryRunner.query(`
      ALTER TABLE "interview_job_position" ADD COLUMN "resumeInviteText" text;
    `);

    // 3. 修改 interview_qa_record 表
    // 添加 totalScore 字段
    await queryRunner.query(`
      ALTER TABLE "interview_qa_record" ADD COLUMN "totalScore" decimal(5,2);
    `);

    // 添加 matchedKeywords 字段
    await queryRunner.query(`
      ALTER TABLE "interview_qa_record" ADD COLUMN "matchedKeywords" text;
    `);

    // 添加 scoredAt 字段
    await queryRunner.query(`
      ALTER TABLE "interview_qa_record" ADD COLUMN "scoredAt" datetime;
    `);

    // 4. 添加系统配置默认值
    // 关键词权重配置
    await queryRunner.query(`
      INSERT INTO "interview_system_config" ("configKey", "configValue")
      VALUES ('keyword_weight', '0.7')
      ON CONFLICT("configKey") DO NOTHING;
    `);

    // LLM权重配置
    await queryRunner.query(`
      INSERT INTO "interview_system_config" ("configKey", "configValue")
      VALUES ('llm_weight', '0.3')
      ON CONFLICT("configKey") DO NOTHING;
    `);

    // 消息合并时间窗口配置（秒）
    await queryRunner.query(`
      INSERT INTO "interview_system_config" ("configKey", "configValue")
      VALUES ('message_merge_window', '30')
      ON CONFLICT("configKey") DO NOTHING;
    `);

    // 邮件汇总发送时间配置
    await queryRunner.query(`
      INSERT INTO "interview_system_config" ("configKey", "configValue")
      VALUES ('email_summary_time', '09:00')
      ON CONFLICT("configKey") DO NOTHING;
    `);

    // 扫描间隔配置（秒）
    await queryRunner.query(`
      INSERT INTO "interview_system_config" ("configKey", "configValue")
      VALUES ('scan_interval', '180')
      ON CONFLICT("configKey") DO NOTHING;
    `);

    console.log('[Migration] UpdateInterviewTables completed successfully');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // SQLite 不支持 DROP COLUMN，所以我们需要重建表

    // 1. 重建 interview_question_round 表（移除 keywords 和 llmPrompt）
    await queryRunner.query(`
      CREATE TABLE "interview_question_round_backup" AS
      SELECT "id", "jobPositionId", "roundNumber", "questionText", "createdAt"
      FROM "interview_question_round";
    `);

    await queryRunner.query(`DROP TABLE "interview_question_round";`);

    await queryRunner.query(`
      CREATE TABLE "interview_question_round" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "jobPositionId" integer NOT NULL,
        "roundNumber" integer NOT NULL,
        "questionText" text NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("jobPositionId") REFERENCES "interview_job_position"("id")
      );
    `);

    await queryRunner.query(`
      INSERT INTO "interview_question_round"
      SELECT * FROM "interview_question_round_backup";
    `);

    await queryRunner.query(`DROP TABLE "interview_question_round_backup";`);

    // 2. 重建 interview_job_position 表（移除 resumeInviteText）
    await queryRunner.query(`
      CREATE TABLE "interview_job_position_backup" AS
      SELECT "id", "name", "description", "passThreshold", "isActive", "encryptJobId", "createdAt", "updatedAt"
      FROM "interview_job_position";
    `);

    await queryRunner.query(`DROP TABLE "interview_job_position";`);

    await queryRunner.query(`
      CREATE TABLE "interview_job_position" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "name" varchar NOT NULL,
        "description" text,
        "passThreshold" integer DEFAULT 60,
        "isActive" boolean DEFAULT 1,
        "encryptJobId" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);

    await queryRunner.query(`
      INSERT INTO "interview_job_position"
      SELECT * FROM "interview_job_position_backup";
    `);

    await queryRunner.query(`DROP TABLE "interview_job_position_backup";`);

    // 3. 重建 interview_qa_record 表（移除新字段）
    await queryRunner.query(`
      CREATE TABLE "interview_qa_record_backup" AS
      SELECT "id", "candidateId", "roundNumber", "questionText", "answerText",
             "questionSentAt", "answeredAt", "keywordScore", "llmScore", "llmReason", "createdAt"
      FROM "interview_qa_record";
    `);

    await queryRunner.query(`DROP TABLE "interview_qa_record";`);

    await queryRunner.query(`
      CREATE TABLE "interview_qa_record" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "candidateId" integer NOT NULL,
        "roundNumber" integer NOT NULL,
        "questionText" text NOT NULL,
        "answerText" text,
        "questionSentAt" datetime,
        "answeredAt" datetime,
        "keywordScore" decimal(5,2),
        "llmScore" decimal(5,2),
        "llmReason" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("candidateId") REFERENCES "interview_candidate"("id")
      );
    `);

    await queryRunner.query(`
      INSERT INTO "interview_qa_record"
      SELECT * FROM "interview_qa_record_backup";
    `);

    await queryRunner.query(`DROP TABLE "interview_qa_record_backup";`);

    // 4. 删除系统配置
    await queryRunner.query(`
      DELETE FROM "interview_system_config"
      WHERE "configKey" IN ('keyword_weight', 'llm_weight', 'message_merge_window', 'email_summary_time', 'scan_interval');
    `);

    console.log('[Migration] UpdateInterviewTables rollback completed');
  }
}