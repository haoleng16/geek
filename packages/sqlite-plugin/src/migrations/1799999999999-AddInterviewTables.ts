import { MigrationInterface, QueryRunner } from "typeorm"

export class AddInterviewTables1799999999999 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 岗位配置表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "interview_job_position" (
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

    // 2. 问题轮次表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "interview_question_round" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "jobPositionId" integer NOT NULL,
        "roundNumber" integer NOT NULL,
        "questionText" text NOT NULL,
        "waitTimeoutMinutes" integer DEFAULT 60,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("jobPositionId") REFERENCES "interview_job_position"("id")
      );
    `);

    // 3. 评分规则表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "interview_score_rule" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "jobPositionId" integer NOT NULL,
        "roundNumber" integer NOT NULL,
        "keywords" text NOT NULL,
        "keywordScore" integer DEFAULT 50,
        "llmScore" integer DEFAULT 50,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("jobPositionId") REFERENCES "interview_job_position"("id")
      );
    `);

    // 4. 候选人表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "interview_candidate" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptGeekId" varchar NOT NULL,
        "geekName" varchar,
        "encryptJobId" varchar,
        "jobName" varchar,
        "jobPositionId" integer,
        "status" varchar DEFAULT 'new',
        "currentRound" integer DEFAULT 0,
        "totalScore" decimal(5,2),
        "keywordScore" decimal(5,2),
        "llmScore" decimal(5,2),
        "llmReason" text,
        "firstContactAt" datetime,
        "lastReplyAt" datetime,
        "lastQuestionAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("jobPositionId") REFERENCES "interview_job_position"("id")
      );
    `);

    // 候选人唯一索引
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_interview_candidate_geek_job"
      ON "interview_candidate" ("encryptGeekId", "encryptJobId");
    `);

    // 候选人状态索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_candidate_status"
      ON "interview_candidate" ("status");
    `);

    // 5. 问答记录表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "interview_qa_record" (
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

    // 问答记录索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_qa_candidate_round"
      ON "interview_qa_record" ("candidateId", "roundNumber");
    `);

    // 6. 简历表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "interview_resume" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "candidateId" integer NOT NULL,
        "filePath" text NOT NULL,
        "fileName" varchar,
        "fileSize" integer,
        "downloadedAt" datetime,
        "emailedAt" datetime,
        "emailRecipient" varchar,
        "downloadUrl" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("candidateId") REFERENCES "interview_candidate"("id")
      );
    `);

    // 简历索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_resume_candidate"
      ON "interview_resume" ("candidateId");
    `);

    // 7. 系统配置表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "interview_system_config" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "configKey" varchar NOT NULL,
        "configValue" text,
        "isEncrypted" boolean DEFAULT 0,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);

    // 系统配置唯一索引
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_interview_system_config_key"
      ON "interview_system_config" ("configKey");
    `);

    // 8. 操作日志表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "interview_operation_log" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "candidateId" integer,
        "action" varchar NOT NULL,
        "detail" text,
        "errorMessage" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("candidateId") REFERENCES "interview_candidate"("id")
      );
    `);

    // 操作日志索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_operation_log_candidate"
      ON "interview_operation_log" ("candidateId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_operation_log_action"
      ON "interview_operation_log" ("action");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_operation_log_created"
      ON "interview_operation_log" ("createdAt");
    `);

    // 岗位名称索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_job_position_name"
      ON "interview_job_position" ("name");
    `);

    // 问题轮次索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_question_round_job_round"
      ON "interview_question_round" ("jobPositionId", "roundNumber");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_operation_log";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_system_config";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_resume";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_qa_record";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_candidate";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_score_rule";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_question_round";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_job_position";`);
  }
}