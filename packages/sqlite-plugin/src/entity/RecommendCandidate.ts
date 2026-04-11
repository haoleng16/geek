import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } = typeorm;

/**
 * 推荐候选人实体
 *
 * 用于存储通过推荐牛人功能分析过的候选人信息及评分结果
 */
@Entity()
@Index(['sessionId', 'encryptUserId', 'encryptJobId'], { unique: true })
@Index(['sessionId'])
@Index(['encryptJobId'])
export class RecommendCandidate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  sessionId: string;                 // 运行会话ID

  @Column()
  encryptUserId: string;             // 候选人ID

  @Column()
  encryptJobId: string;              // 职位ID

  @Column({ nullable: true })
  jobName: string;                   // 职位名称

  @Column({ nullable: true })
  geekName: string;                  // 候选人姓名

  @Column({ nullable: true, type: 'text' })
  avatarUrl: string;                 // 头像URL

  @Column({ nullable: true })
  degree: string;                    // 学历

  @Column({ nullable: true, type: 'integer' })
  workYears: number;                 // 工作年限

  @Column({ nullable: true })
  city: string;                      // 城市

  @Column({ nullable: true })
  expectedSalary: string;            // 期望薪资

  @Column({ nullable: true })
  currentCompany: string;            // 当前公司

  @Column({ nullable: true })
  currentPosition: string;           // 当前职位

  @Column({ nullable: true })
  activeStatus: string;              // 活跃状态文本

  @Column({ nullable: true })
  isJobSeeking: boolean;             // 是否在看机会

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  totalScore: number;                // 综合评分

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  workMatchScore: number;            // 工作经历匹配分

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  skillMatchScore: number;           // 技能匹配分

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  projectQualityScore: number;       // 项目经验质量分

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  overallQualityScore: number;       // 综合素质分

  @Column({ nullable: true })
  recommend: boolean;                // 是否推荐

  @Column({ nullable: true, type: 'text' })
  reason: string;                    // 推荐/不推荐理由

  @Column({ nullable: true, type: 'text' })
  keyStrengths: string;              // 优势JSON数组

  @Column({ nullable: true, type: 'text' })
  concerns: string;                  // 顾虑JSON数组

  @Column({ default: false })
  isCollected: boolean;              // 是否已收藏

  @Column({ nullable: true, type: 'integer' })
  snapshotId: number;                // 关联截图记录ID

  @Column({ default: true })
  preFilterPassed: boolean;          // 是否通过预筛选

  @Column({ nullable: true })
  preFilterFailReason: string;       // 预筛选未通过原因

  @CreateDateColumn()
  createdAt: Date;
}
