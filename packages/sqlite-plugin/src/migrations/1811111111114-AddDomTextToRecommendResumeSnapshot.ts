import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddDomTextToRecommendResumeSnapshot1811111111114
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable("recommend_resume_snapshot"))) {
      return;
    }

    if (
      !(await queryRunner.hasColumn("recommend_resume_snapshot", "domText"))
    ) {
      await queryRunner.addColumn(
        "recommend_resume_snapshot",
        new TableColumn({
          name: "domText",
          type: "text",
          isNullable: true,
        }),
      );
    }

    if (
      !(await queryRunner.hasColumn(
        "recommend_resume_snapshot",
        "domSectionsJson",
      ))
    ) {
      await queryRunner.addColumn(
        "recommend_resume_snapshot",
        new TableColumn({
          name: "domSectionsJson",
          type: "text",
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable("recommend_resume_snapshot"))) {
      return;
    }

    if (
      await queryRunner.hasColumn(
        "recommend_resume_snapshot",
        "domSectionsJson",
      )
    ) {
      await queryRunner.dropColumn(
        "recommend_resume_snapshot",
        "domSectionsJson",
      );
    }

    if (await queryRunner.hasColumn("recommend_resume_snapshot", "domText")) {
      await queryRunner.dropColumn("recommend_resume_snapshot", "domText");
    }
  }
}
