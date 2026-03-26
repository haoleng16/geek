import { MigrationInterface, QueryRunner } from "typeorm"

export class AddRecruiterTemplateTable1777666666666 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recruiter_template" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "encryptJobId" varchar,
        "templateType" varchar NOT NULL,
        "name" varchar NOT NULL,
        "content" text NOT NULL,
        "enabled" boolean DEFAULT 1,
        "sortOrder" integer DEFAULT 0,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recruiter_template_job_id"
      ON "recruiter_template" ("encryptJobId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_recruiter_template_type"
      ON "recruiter_template" ("templateType");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "recruiter_template";`);
  }
}