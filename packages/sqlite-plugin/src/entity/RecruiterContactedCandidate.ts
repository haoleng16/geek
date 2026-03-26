import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } = typeorm;

/**
 * 招聘端已回复联系人实体
 *
 * 用于存储招聘端自动回复时收集的已回复候选人信息
 */
@Entity()
@Index(['encryptGeekId', 'encryptJobId'], { unique: true })
export class RecruiterContactedCandidate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  encryptGeekId: string;  // BOSS直聘候选人ID

  @Column()
  encryptJobId: string;   // BOSS直聘职位ID

  @Column({ nullable: true })
  jobName: string;        // 职位名称

  @Column({ nullable: true })
  geekName: string;       // 候选人姓名

  @Column({ nullable: true })
  companyName: string;    // 当前公司

  @Column({ nullable: true })
  position: string;       // 当前职位

  @Column({ nullable: true })
  salary: string;         // 期望薪资

  @Column({ nullable: true })
  city: string;           // 城市/地点

  @Column({ nullable: true })
  degree: string;         // 学历

  @Column({ nullable: true, type: 'integer' })
  workYears: number;      // 工作年限

  @Column({ nullable: true, type: 'text' })
  avatarUrl: string;      // 头像URL

  @Column({ nullable: true, type: 'text' })
  rawResponseData: string; // 原始响应数据JSON

  @Column({ default: 0 })
  replyCount: number;     // 回复次数

  @Column({ nullable: true })
  lastReplyAt: Date;      // 最后回复时间

  @Column({ nullable: true })
  firstContactAt: Date;   // 首次联系时间

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}