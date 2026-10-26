import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { StorageService } from './storage.service';
import {
  type UploadAssetDto,
  PresignedUploadResponseDto,
  AssetMetadataResponseDto,
  type ListAssetsQueryDto,
  PaginatedAssetsResponseDto,
  PresignedDownloadResponseDto,
} from '@project/shared-types';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Request a presigned upload URL.
   * Client will use this URL to directly upload to S3/MinIO.
   */
  @Post('upload-url')
  @HttpCode(HttpStatus.CREATED)
  async getUploadUrl(@Body() dto: UploadAssetDto): Promise<PresignedUploadResponseDto> {
    return this.storageService.generatePresignedUploadUrl(dto);
  }

  /**
   * Request a presigned download URL for private assets.
   */
  @Post(':assetId/download-url')
  async getDownloadUrl(
    @Param('assetId') assetId: string,
    @Query('expiresIn') expiresIn?: string,
  ): Promise<PresignedDownloadResponseDto> {
    return this.storageService.generatePresignedDownloadUrl(
      assetId,
      expiresIn ? parseInt(expiresIn, 10) : 3600,
    );
  }

  /**
   * Get asset metadata by ID.
   */
  @Get(':assetId')
  async getAsset(@Param('assetId') assetId: string): Promise<AssetMetadataResponseDto> {
    return this.storageService.getAssetMetadata(assetId);
  }

  /**
   * List assets with optional filtering.
   */
  @Get()
  async listAssets(@Query() query: ListAssetsQueryDto): Promise<PaginatedAssetsResponseDto> {
    return this.storageService.listAssets(query);
  }

  /**
   * Delete an asset.
   */
  @Delete(':assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAsset(@Param('assetId') assetId: string): Promise<void> {
    return this.storageService.deleteAsset(assetId);
  }
}