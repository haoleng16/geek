import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn } = typeorm;

/**
 * 招聘者每日统计实体
 *
 * 记录每日的处理统计数据
 */
@Entity()
export class RecruiterDailyStats {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  date: string;                // YYYY-MM-DD

  @Column({ nullable: true })
  encryptJobId: string;        // NULL 表示总计

  @Column({ default: 0 })
  totalProcessed: number;

  @Column({ default: 0 })
  totalMatched: number;

  @Column({ default: 0 })
  totalRejected: number;

  @Column({ default: 0 })
  totalHandover: number;

  @Column({ default: 0 })
  totalResumeParsed: number;
}