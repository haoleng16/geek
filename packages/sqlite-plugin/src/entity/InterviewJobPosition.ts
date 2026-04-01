import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } = typeorm;

/**
 * 面试岗位配置实体
 *
 * 用于配置面试岗位的基本信息和通过阈值
 */
@Entity()
export class InterviewJobPosition {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;                      // 岗位名称

  @Column({ nullable: true, type: 'text' })
  description: string;               // 岗位描述

  @Column({ default: 60 })
  passThreshold: number;             // 通过阈值（分数）

  @Column({ default: true })
  isActive: boolean;                 // 是否启用

  @Column({ nullable: true })
  encryptJobId: string;              // BOSS直聘职位ID（用于匹配）

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}