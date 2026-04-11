import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } = typeorm;

/**
 * 推荐牛人岗位配置实体
 *
 * 用于存储每个职位的推荐牛人分析配置，包括筛选条件、评分阈值和岗位说明
 */
@Entity()
@Index(['jobName'], { unique: true })
export class RecommendJobConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  encryptJobId: string;              // BOSS直聘职位ID（运行时自动填充）

  @Column()
  jobName: string;                   // 职位名称（与BOSS直聘上保持一致）

  @Column({ nullable: true, type: 'text' })
  jobResponsibilities: string;       // 岗位职责

  @Column({ nullable: true, type: 'text' })
  jobRequirements: string;           // 任职要求

  @Column({ nullable: true, type: 'decimal', precision: 3, scale: 1 })
  scoreThreshold: number;            // 推荐评分阈值（1-10），默认7.0

  @Column({ nullable: true, type: 'integer' })
  activeWithinDays: number;          // 最近活跃天数，默认30

  @Column({ nullable: true })
  requireJobSeeking: boolean;        // 是否要求在看机会

  @Column({ nullable: true })
  minDegree: string;                 // 最低学历

  @Column({ nullable: true, type: 'integer' })
  salaryMin: number;                 // 最低期望薪资（K/月）

  @Column({ nullable: true, type: 'integer' })
  salaryMax: number;                 // 最高期望薪资（K/月）

  @Column({ nullable: true, type: 'text' })
  targetCities: string;              // 目标城市JSON数组

  @Column({ nullable: true, type: 'integer' })
  minWorkYears: number;              // 最小工作年限

  @Column({ nullable: true, type: 'integer' })
  maxWorkYears: number;              // 最大工作年限

  @Column({ nullable: true, type: 'text' })
  workYearOptions: string;           // 工作年限选项 JSON 数组

  @Column({ nullable: true, type: 'integer' })
  maxCollectPerJob: number;          // 每职位最大收藏数

  @Column({ nullable: true })
  enabled: boolean;                  // 是否启用

  @Column({ nullable: true, type: 'text' })
  scoringPrompt: string;             // 自定义评分提示词（为空则自动生成）

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
