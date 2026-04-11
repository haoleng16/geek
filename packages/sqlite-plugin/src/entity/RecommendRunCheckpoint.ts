import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, Index } = typeorm;

/**
 * 推荐牛人运行断点实体
 *
 * 用于实现断点续传机制，记录任务运行进度
 */
@Entity()
@Index(['sessionId'], { unique: true })
export class RecommendRunCheckpoint {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  sessionId: string;                 // 运行会话ID

  @Column()
  encryptJobId: string;              // 当前处理职位ID

  @Column({ default: 1, type: 'integer' })
  currentPage: number;               // 当前页码

  @Column({ default: 0, type: 'integer' })
  currentPageOffset: number;         // 当前页内偏移

  @Column({ default: 0, type: 'integer' })
  processedCount: number;            // 已处理总数

  @Column({ default: 0, type: 'integer' })
  matchedCount: number;              // 匹配成功数

  @Column({ default: 0, type: 'integer' })
  skippedCount: number;              // 预筛选跳过数

  @Column({ default: 0, type: 'integer' })
  collectedCount: number;            // 已收藏数

  @Column({ nullable: true })
  lastProcessedUserId: string;       // 最后处理的候选人ID

  @Column({ default: 'running' })
  status: string;                    // running/paused/completed/error

  @Column({ nullable: true, type: 'text' })
  errorMessage: string;              // 错误信息

  @Column({ nullable: true })
  startedAt: Date;                   // 启动时间

  @Column({ nullable: true })
  updatedAt: Date;                   // 更新时间
}
