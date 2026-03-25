import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } = typeorm;

/**
 * 候选人简历记录实体
 *
 * 用于缓存已解析的候选人简历信息，避免重复获取
 */
@Entity()
export class CandidateResumeRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  encryptGeekId: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  degree: string;

  @Column({ nullable: true })
  school: string;

  @Column({ nullable: true, type: 'int' })
  workYears: number;

  @Column({ type: 'simple-json', nullable: true })
  skills: string[];

  @Column({ type: 'text', nullable: true })
  workExperience: string;      // JSON 存储工作经历

  @Column({ type: 'text', nullable: true })
  projectExperience: string;   // JSON 存储项目经历

  @Column({ type: 'text', nullable: true })
  rawResumeData: string;       // 原始简历数据

  @CreateDateColumn()
  createdAt: Date;
}