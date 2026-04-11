import { MigrationInterface, QueryRunner } from "typeorm"

export class AddRecommendTalentTables1811111111111 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 推荐牛人岗位配置表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recommend_job_config" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptJobId" varchar NOT NULL,
        "jobName" varchar NOT NULL,
        "jobResponsibilities" text,
        "jobRequirements" text,
        "scoreThreshold" numeric DEFAULT 7.0,
        "activeWithinDays" integer DEFAULT 30,
        "requireJobSeeking" boolean DEFAULT 1,
        "minDegree" varchar,
        "salaryMin" integer,
        "salaryMax" integer,
        "targetCities" text,
        "minWorkYears" integer DEFAULT 0,
        "maxWorkYears" integer DEFAULT 99,
        "maxCollectPerJob" integer DEFAULT 20,
        "enabled" boolean DEFAULT 1,
        "scoringPrompt" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_recommend_job_config_job_id"
      ON "recommend_job_config" ("encryptJobId");
    `);

    // 2. 推荐候选人表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recommend_candidate" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "sessionId" varchar NOT NULL,
        "encryptUserId" varchar NOT NULL,
        "encryptJobId" varchar NOT NULL,
        "jobName" varchar,
        "geekName" varchar,
        "avatarUrl" text,
        "degree" varchar,
        "workYears" integer,
        "city" varchar,
        "expectedSalary" varchar,
        "currentCompany" varchar,
        "currentPosition" varchar,
        "activeStatus" varchar,
        "isJobSeeking" boolean,
        "totalScore" numeric,
        "workMatchScore" numeric,
        "skillMatchScore" numeric,
        "projectQualityScore" numeric,
        "overallQualityScore" numeric,
        "recommend" boolean,
        "reason" text,
        "keyStrengths" text,
        "concerns" text,
        "isCollected" boolean DEFAULT 0,
        "snapshotId" integer,
        "preFilterPassed" boolean DEFAULT 1,
        "preFilterFailReason" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_recommend_candidate_unique"
      ON "recommend_candidate" ("sessionId", "encryptUserId", "encryptJobId");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recommend_candidate_session"
      ON "recommend_candidate" ("sessionId");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recommend_candidate_job"
      ON "recommend_candidate" ("encryptJobId");
    `);

    // 3. 简历截图记录表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recommend_resume_snapshot" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "candidateId" integer NOT NULL,
        "encryptUserId" varchar NOT NULL,
        "snapshotPath" text NOT NULL,
        "snapshotSize" integer,
        "vlRawResponse" text,
        "vlRequestTokens" integer,
        "vlResponseTokens" integer,
        "vlDurationMs" integer,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_snapshot_user"
      ON "recommend_resume_snapshot" ("encryptUserId");
    `);

    // 4. 运行断点表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recommend_run_checkpoint" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "sessionId" varchar NOT NULL,
        "encryptJobId" varchar NOT NULL,
        "currentPage" integer DEFAULT 1,
        "currentPageOffset" integer DEFAULT 0,
        "processedCount" integer DEFAULT 0,
        "matchedCount" integer DEFAULT 0,
        "skippedCount" integer DEFAULT 0,
        "collectedCount" integer DEFAULT 0,
        "lastProcessedUserId" varchar,
        "status" varchar DEFAULT 'running',
        "errorMessage" text,
        "startedAt" datetime,
        "updatedAt" datetime
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_checkpoint_session"
      ON "recommend_run_checkpoint" ("sessionId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "recommend_run_checkpoint";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recommend_resume_snapshot";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recommend_candidate";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recommend_job_config";`);
  }
}
