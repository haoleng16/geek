import { MigrationInterface, QueryRunner } from "typeorm"

export class AddRecruiterContactedCandidateTable1777777777777 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recruiter_contacted_candidate" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptGeekId" varchar NOT NULL,
        "encryptJobId" varchar NOT NULL,
        "jobName" varchar,
        "geekName" varchar,
        "companyName" varchar,
        "position" varchar,
        "salary" varchar,
        "city" varchar,
        "degree" varchar,
        "workYears" integer,
        "avatarUrl" text,
        "rawResponseData" text,
        "replyCount" integer DEFAULT 0,
        "lastReplyAt" datetime,
        "firstContactAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_recruiter_contacted_candidate_unique"
      ON "recruiter_contacted_candidate" ("encryptGeekId", "encryptJobId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recruiter_contacted_candidate_job"
      ON "recruiter_contacted_candidate" ("encryptJobId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recruiter_contacted_candidate_created"
      ON "recruiter_contacted_candidate" ("createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "recruiter_contacted_candidate";`);
  }
}