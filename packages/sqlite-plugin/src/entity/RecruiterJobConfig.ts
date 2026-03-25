import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } = typeorm;

/**
 * 招聘者职位配置实体
 *
 * 用于存储招聘者对不同职位的自动化回复配置
 */
@Entity()
export class RecruiterJobConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  encryptJobId: string;        // BOSS直聘职位ID

  @Column()
  jobName: string;             // 职位名称

  @Column({ type: 'text' })
  templateFirstMessage: string;  // 首次回复模版

  @Column({ type: 'text' })
  templateRejectMessage: string; // 婉拒模版

  @Column({ type: 'simple-json', nullable: true })
  filterConfig: {              // 筛选配置
    degreeList: string[];
    minWorkYears: number;
    maxWorkYears: number;
    skillKeywords: string[];
  };

  @Column({ default: 100 })
  dailyLimit: number;          // 每日处理上限

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}