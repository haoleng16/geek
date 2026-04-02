import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddLastScoredAtToInterviewCandidate1800000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 添加 lastScoredAt 列到 interview_candidate 表
    if (await queryRunner.hasTable("interview_candidate")) {
      if (!await queryRunner.hasColumn("interview_candidate", "lastScoredAt")) {
        await queryRunner.addColumn(
          "interview_candidate",
          new TableColumn({
            name: "lastScoredAt",
            type: "datetime",
            isNullable: true
          })
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 移除 lastScoredAt 列
    if (await queryRunner.hasTable("interview_candidate")) {
      if (await queryRunner.hasColumn("interview_candidate", "lastScoredAt")) {
        await queryRunner.dropColumn("interview_candidate", "lastScoredAt");
      }
    }
  }
}