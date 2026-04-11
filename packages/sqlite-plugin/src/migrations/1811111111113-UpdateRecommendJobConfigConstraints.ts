import { MigrationInterface, QueryRunner } from 'typeorm'

export class UpdateRecommendJobConfigConstraints1811111111113 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('recommend_job_config')) {
      // SQLite doesn't support ALTER COLUMN, so we recreate the table
      // 1. Create new table with nullable encryptJobId
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "recommend_job_config_new" (
          "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
          "encryptJobId" varchar,
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
          "workYearOptions" text,
          "maxCollectPerJob" integer DEFAULT 20,
          "enabled" boolean DEFAULT 1,
          "scoringPrompt" text,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
      `)

      // 2. Copy data from old table
      await queryRunner.query(`
        INSERT INTO "recommend_job_config_new"
        SELECT "id", "encryptJobId", "jobName", "jobResponsibilities", "jobRequirements",
               "scoreThreshold", "activeWithinDays", "requireJobSeeking", "minDegree",
               "salaryMin", "salaryMax", "targetCities", "minWorkYears", "maxWorkYears",
               "workYearOptions", "maxCollectPerJob", "enabled", "scoringPrompt",
               "createdAt", "updatedAt"
        FROM "recommend_job_config";
      `)

      // 3. Drop old table and rename
      await queryRunner.query(`DROP TABLE "recommend_job_config";`)
      await queryRunner.query(`ALTER TABLE "recommend_job_config_new" RENAME TO "recommend_job_config";`)

      // 4. Create new unique index on jobName
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_recommend_job_config_job_name"
        ON "recommend_job_config" ("jobName");
      `)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert is not practical for SQLite table rebuild
  }
}
