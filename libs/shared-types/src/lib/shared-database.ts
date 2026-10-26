import { UserRoles, AssetCategory, AssetVisibility } from "./shared-types";
import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

// ============================================================================
// BASE ENTITIES
// ============================================================================

/**
 * Standard Base Entity with Soft Delete capabilities.
 * Use for: Users, Tenants, Agent Profiles, Phone Numbers, etc.
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}

/**
 * Immutable Base Entity without Soft Delete.
 * Use for: Call Sessions, Messages, Transcripts, Billing Logs.
 * Telecom compliance and billing require these records to remain permanently queryable.
 */
export abstract class ImmutableBaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity({ name: 'users' })
export class User extends BaseEntity {

    @Column({ name: 'email', type: 'varchar', length: 100, unique: true, nullable: false })
    email: string;

    @Column({ name: 'password_hash', type: 'varchar', length: 250, nullable: false })
    passwordHash: string;

    @Column({
        name: 'role',
        type: 'enum',
        enum: UserRoles,
        default: UserRoles.USER,
    })
    role: UserRoles;

    @Column({ name: 'reset_token', type: 'varchar', length: 255, nullable: true })
    resetToken: string | null;

    @Column({ name: 'reset_token_expires_at', type: 'timestamp', nullable: true })
    resetTokenExpiresAt: Date | null;

}

@Entity({ name: 'asset_metadata' })
export class AssetMetadata extends BaseEntity {

  @Column({
    type: 'varchar',
    length: 50,
  })
  category!: AssetCategory | string;

  @Column({ name: 'asset_key', unique: true })
  assetKey!: string;

  @Column()
  filename!: string;

  @Column({ name: 'mime_type' })
  mimeType!: string;

  @Column({ name: 'file_size', type: 'bigint' })
  fileSize!: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: AssetVisibility.PUBLIC,
  })
  visibility!: AssetVisibility | string;

  @Column({ name: 'owner_id', nullable: true })
  ownerId?: string;

  @Column({ type: 'jsonb', nullable: true })
  tags?: Record<string, unknown>;
}


// GLOBAL OPERATIONS CONSTANTS
@Entity('system_config')
export class SystemConfig {
  @Column({ type: 'varchar', length: 100, primary: true })
  key!: string;

  @Column({ type: 'text', nullable: true })
  valueText?: string;

  @Column({
    type: 'numeric',
    precision: 28,
    scale: 6,
    nullable: true,
    transformer: { to: (v: string) => v, from: (v: string) => v }
  })
  valueNumeric?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;
}