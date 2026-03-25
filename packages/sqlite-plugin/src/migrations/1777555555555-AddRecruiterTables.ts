import { MigrationInterface, QueryRunner } from "typeorm"

export class AddRecruiterTables1777555555555 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 招聘者职位配置表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recruiter_job_config" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptJobId" varchar UNIQUE NOT NULL,
        "jobName" varchar NOT NULL,
        "templateFirstMessage" text NOT NULL,
        "templateRejectMessage" text NOT NULL,
        "filterConfig" text,
        "dailyLimit" integer DEFAULT 100,
        "enabled" boolean DEFAULT 1,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 候选人对话记录表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "candidate_conversation" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptGeekId" varchar NOT NULL,
        "encryptJobId" varchar NOT NULL,
        "roundCount" integer DEFAULT 0,
        "status" varchar DEFAULT 'pending',
        "firstContactAt" datetime,
        "lastReplyAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 候选人简历记录表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "candidate_resume_record" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptGeekId" varchar UNIQUE NOT NULL,
        "name" varchar,
        "phone" varchar,
        "degree" varchar,
        "school" varchar,
        "workYears" integer,
        "skills" text,
        "workExperience" text,
        "projectExperience" text,
        "rawResumeData" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 招聘者处理日志表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recruiter_process_log" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptGeekId" varchar NOT NULL,
        "encryptJobId" varchar NOT NULL,
        "action" varchar NOT NULL,
        "roundNumber" integer,
        "messageContent" text,
        "filterResult" text,
        "errorMessage" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 招聘者每日统计表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recruiter_daily_stats" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "date" varchar NOT NULL,
        "encryptJobId" varchar,
        "totalProcessed" integer DEFAULT 0,
        "totalMatched" integer DEFAULT 0,
        "totalRejected" integer DEFAULT 0,
        "totalHandover" integer DEFAULT 0,
        "totalResumeParsed" integer DEFAULT 0
      );
    `);

    // 创建索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_candidate_conversation_geek_job"
      ON "candidate_conversation" ("encryptGeekId", "encryptJobId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recruiter_process_log_geek"
      ON "recruiter_process_log" ("encryptGeekId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recruiter_process_log_job"
      ON "recruiter_process_log" ("encryptJobId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recruiter_daily_stats_date"
      ON "recruiter_daily_stats" ("date");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "recruiter_daily_stats";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recruiter_process_log";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "candidate_resume_record";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "candidate_conversation";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recruiter_job_config";`);
  }
}