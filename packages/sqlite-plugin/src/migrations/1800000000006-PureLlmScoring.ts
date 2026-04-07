import { MigrationInterface, QueryRunner } from "typeorm"

/**
 * 纯LLM评分机制改造迁移
 * - 新增 InterviewJobPosition.llmScoringPrompt 字段
 * - 删除废弃字段：keywords、negationWords、llmPrompt（问题轮次）
 * - 删除废弃字段：keywordScore、matchedKeywords（问答记录）
 * - 删除废弃字段：keywordScore、llmScore（候选人）
 */
export class PureLlmScoring1800000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. InterviewJobPosition 新增 llmScoringPrompt 字段
    await queryRunner.query(`
      ALTER TABLE "interview_job_position" ADD COLUMN "llmScoringPrompt" text;
    `)

    // 2. 删除废弃的 interview_score_rule 表
    await queryRunner.query(`DROP TABLE IF EXISTS "interview_score_rule";`)

    // 2. InterviewQuestionRound 删除废弃字段（SQLite需重建表）
    await queryRunner.query(`
      CREATE TABLE "interview_question_round_new" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "jobPositionId" integer NOT NULL,
        "roundNumber" integer NOT NULL,
        "questionText" text NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("jobPositionId") REFERENCES "interview_job_position"("id")
      );
    `)

    await queryRunner.query(`
      INSERT INTO "interview_question_round_new"
        SELECT id, jobPositionId, roundNumber, questionText, createdAt
        FROM "interview_question_round";
    `)

    await queryRunner.query(`DROP TABLE "interview_question_round";`)
    await queryRunner.query(`ALTER TABLE "interview_question_round_new" RENAME TO "interview_question_round";`)

    // 重建索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_question_round_job_round"
      ON "interview_question_round" ("jobPositionId", "roundNumber");
    `)

    // 3. InterviewQaRecord 删除废弃字段（SQLite需重建表）
    await queryRunner.query(`
      CREATE TABLE "interview_qa_record_new" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "candidateId" integer NOT NULL,
        "roundNumber" integer NOT NULL,
        "questionText" text NOT NULL,
        "answerText" text,
        "questionSentAt" datetime,
        "answeredAt" datetime,
        "llmScore" decimal(5,2),
        "llmReason" text,
        "totalScore" decimal(5,2),
        "scoredAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("candidateId") REFERENCES "interview_candidate"("id")
      );
    `)

    await queryRunner.query(`
      INSERT INTO "interview_qa_record_new"
        SELECT id, candidateId, roundNumber, questionText, answerText,
               questionSentAt, answeredAt, llmScore, llmReason, totalScore, scoredAt, createdAt
        FROM "interview_qa_record";
    `)

    await queryRunner.query(`DROP TABLE "interview_qa_record";`)
    await queryRunner.query(`ALTER TABLE "interview_qa_record_new" RENAME TO "interview_qa_record";`)

    // 重建索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_qa_candidate_round"
      ON "interview_qa_record" ("candidateId", "roundNumber");
    `)

    // 4. InterviewCandidate 删除废弃字段（SQLite需重建表）
    await queryRunner.query(`
      CREATE TABLE "interview_candidate_new" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptGeekId" varchar NOT NULL,
        "geekName" varchar,
        "encryptJobId" varchar,
        "jobName" varchar,
        "jobPositionId" integer,
        "status" varchar DEFAULT 'new',
        "currentRound" integer DEFAULT 0,
        "totalScore" decimal(5,2),
        "llmReason" text,
        "firstContactAt" datetime,
        "lastReplyAt" datetime,
        "lastQuestionAt" datetime,
        "lastScoredAt" datetime,
        "education" varchar,
        "school" varchar,
        "major" varchar,
        "educationDetail" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY ("jobPositionId") REFERENCES "interview_job_position"("id")
      );
    `)

    await queryRunner.query(`
      INSERT INTO "interview_candidate_new"
        SELECT id, encryptGeekId, geekName, encryptJobId, jobName, jobPositionId,
               status, currentRound, totalScore, llmReason, firstContactAt,
               lastReplyAt, lastQuestionAt, lastScoredAt, education, school, major,
               educationDetail, createdAt, updatedAt
        FROM "interview_candidate";
    `)

    await queryRunner.query(`DROP TABLE "interview_candidate";`)
    await queryRunner.query(`ALTER TABLE "interview_candidate_new" RENAME TO "interview_candidate";`)

    // 重建唯一索引
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_interview_candidate_geek_job"
      ON "interview_candidate" ("encryptGeekId", "encryptJobId");
    `)

    // 重建状态索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_interview_candidate_status"
      ON "interview_candidate" ("status");
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚：恢复废弃字段（简化处理，只恢复结构）

    // 1. 删除 llmScoringPrompt
    await queryRunner.query(`
      CREATE TABLE "interview_job_position_new" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "name" varchar NOT NULL,
        "description" text,
        "passThreshold" integer DEFAULT 60,
        "isActive" boolean DEFAULT 1,
        "encryptJobId" varchar,
        "resumeInviteText" text,
        "educationFilter" text,
        "experienceFilter" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `)

    await queryRunner.query(`
      INSERT INTO "interview_job_position_new"
        SELECT id, name, description, passThreshold, isActive, encryptJobId,
               resumeInviteText, educationFilter, experienceFilter, createdAt, updatedAt
        FROM "interview_job_position";
    `)

    await queryRunner.query(`DROP TABLE "interview_job_position";`)
    await queryRunner.query(`ALTER TABLE "interview_job_position_new" RENAME TO "interview_job_position";`)

    // 其他表的回滚省略（迁移通常不需要完整回滚）
  }
}