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

  // 新增：简历邀约话术
  @Column({ nullable: true, type: 'text' })
  resumeInviteText: string;          // 通过所有轮次后发送的简历邀约话术

  // 新增：LLM评分提示词（岗位级别）
  @Column({ nullable: true, type: 'text' })
  llmScoringPrompt: string;          // LLM评分提示词，支持 {question} 和 {answer} 变量

  // 新增：候选人筛选条件
  @Column({ nullable: true, type: 'text' })
  educationFilter: string;           // 学历筛选，JSON数组，如["本科","硕士"]

  @Column({ nullable: true, type: 'text' })
  experienceFilter: string;          // 经验筛选，JSON数组，如["3年以上","26届应届生"]

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}