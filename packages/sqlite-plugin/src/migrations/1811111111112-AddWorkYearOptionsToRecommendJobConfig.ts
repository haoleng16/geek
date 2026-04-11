import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddWorkYearOptionsToRecommendJobConfig1811111111112 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('recommend_job_config')) {
      if (!(await queryRunner.hasColumn('recommend_job_config', 'workYearOptions'))) {
        await queryRunner.addColumn(
          'recommend_job_config',
          new TableColumn({
            name: 'workYearOptions',
            type: 'text',
            isNullable: true
          })
        )
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('recommend_job_config')) {
      if (await queryRunner.hasColumn('recommend_job_config', 'workYearOptions')) {
        await queryRunner.dropColumn('recommend_job_config', 'workYearOptions')
      }
    }
  }
}
