import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { AssetCategory, AssetVisibility, UserRoles, IAssetMetadata } from './shared-types';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(100)
  readonly email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  readonly password: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}

export class LoginUserDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(100)
  readonly email: string;

  @IsString()
  @IsNotEmpty()
  readonly password: string;
}

export class ForgotPasswordDto {

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(100)
  readonly email: string;
}

export class ChangeUserRoleDto {
  @IsEnum(UserRoles)
  @IsNotEmpty()
  role: UserRoles;
}

export class ResetUserPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}

/**
 * Request DTO for uploading an asset.
 */
export interface UploadAssetDto {
  /** Asset category (e.g., 'characters', 'backgrounds') */
  category: AssetCategory;
  /** Sub-path within category (e.g., 'player/male/default') */
  subPath?: string;
  /** Original filename */
  filename: string;
  /** MIME type (e.g., 'image/png') */
  mimeType: string;
  /** File size in bytes */
  fileSize: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Response DTO containing presigned upload URL.
 */
export interface PresignedUploadResponseDto {
  /** Unique asset identifier */
  assetId: string;
  /** Presigned PUT URL for direct upload */
  uploadUrl: string;
  /** Public/final access URL after upload */
  accessUrl: string;
  /** Asset key in bucket */
  assetKey: string;
  /** Expiration time of presigned URL (ISO 8601) */
  expiresAt: string;
}

/**
 * Response DTO for asset metadata queries.
 */
export interface AssetMetadataResponseDto extends Omit<IAssetMetadata, 'ownerId'> {
  /** Public access URL */
  url: string;
  /** Presigned URL (if private and requested) */
  presignedUrl?: string;
}

/**
 * Query parameters for listing assets.
 */
export interface ListAssetsQueryDto {
  /** Filter by category */
  category?: AssetCategory;
  /** Filter by sub-path prefix */
  subPath?: string;
  /** Filter by visibility */
  visibility?: AssetVisibility;
  /** Pagination: page number (default: 1) */
  page?: number;
  /** Pagination: items per page (default: 20, max: 100) */
  limit?: number;
  /** Sort field (createdAt, filename, fileSize) */
  sortBy?: 'createdAt' | 'filename' | 'fileSize';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated response for asset listings.
 */
export interface PaginatedAssetsResponseDto {
  /** Array of asset metadata */
  items: AssetMetadataResponseDto[];
  /** Total count of matching assets */
  total: number;
  /** Current page number */
  page: number;
  /** Items per page */
  limit: number;
  /** Total pages */
  totalPages: number;
}

/**
 * Request DTO for generating presigned download URL.
 */
export interface PresignedDownloadRequestDto {
  /** Asset ID or key */
  assetId: string;
  /** Expiration in seconds (default: 3600) */
  expiresIn?: number;
}

/**
 * Response DTO with presigned download URL.
 */
export interface PresignedDownloadResponseDto {
  /** Presigned GET URL */
  downloadUrl: string;
  /** Expiration timestamp */
  expiresAt: string;
}

// ===================================================================
// SYSTEM CONFIG DTOS
// ===================================================================

export class UpsertSystemConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  key: string;

  @IsString()
  @IsOptional()
  valueText?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{1,22}(\.\d{1,6})?$/)
  valueNumeric?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

export class SystemConfigResponseDto {
  key: string;
  valueText?: string;
  valueNumeric?: string;
  description?: string;
  updatedBy?: string;
  updatedAt: Date;
}