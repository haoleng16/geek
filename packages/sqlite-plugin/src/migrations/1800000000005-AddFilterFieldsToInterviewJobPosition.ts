import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddFilterFieldsToInterviewJobPosition1800000000005 implements MigrationInterface {
  name = 'AddFilterFieldsToInterviewJobPosition1800000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 添加 educationFilter 字段
    await queryRunner.addColumn(
      'interview_job_position',
      new TableColumn({
        name: 'educationFilter',
        type: 'text',
        isNullable: true
      })
    );

    // 添加 experienceFilter 字段
    await queryRunner.addColumn(
      'interview_job_position',
      new TableColumn({
        name: 'experienceFilter',
        type: 'text',
        isNullable: true
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('interview_job_position', 'experienceFilter');
    await queryRunner.dropColumn('interview_job_position', 'educationFilter');
  }
}