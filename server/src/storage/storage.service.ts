import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DevS3Options } from '../common/general';
import { environment } from '../common/environment';
import { 
  AssetMetadata, 
  AssetCategory, 
  AssetVisibility,   
  UploadAssetDto,
  PresignedUploadResponseDto,
  AssetMetadataResponseDto,
  ListAssetsQueryDto,
  PaginatedAssetsResponseDto,
  PresignedDownloadResponseDto, } from '@project/shared-types';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly baseUrl: string;

  constructor(
    @InjectRepository(AssetMetadata)
    private readonly assetRepo: Repository<AssetMetadata>,
  ) {
    const endPoint = environment.ENVIRONMENT === 'development' ? DevS3Options.ENDPOINT : environment.STORAGE_ENDPOINT
    const port = environment.ENVIRONMENT === 'development' ? DevS3Options.PORT : environment.STORAGE_PORT
    const accessKey = environment.ENVIRONMENT === 'development' ? DevS3Options.ACCESS_KEY : environment.STORAGE_ACCESS_KEY
    const secretKey = environment.ENVIRONMENT === 'development' ? DevS3Options.SECRET_KEY : environment.STORAGE_SECRET_KEY
    const useSSL = environment.ENVIRONMENT === 'development' ? DevS3Options.SSL : environment.STORAGE_USE_SSL
    this.bucketName = environment.ENVIRONMENT === 'development' ? DevS3Options.BUCKET_NAME : environment.STORAGE_BUCKET

    // Build base URL for asset access
    const protocol = useSSL ? 'https' : 'http';
    this.baseUrl = `${protocol}://${endPoint}:${port}/${this.bucketName}`;

    this.s3Client = new S3Client({
      endpoint: `${protocol}://${endPoint}:${port}`,
      region: 'us-east-1', // MinIO doesn't care about region
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  /**
   * Generate a presigned upload URL for client-side direct upload.
   */
  async generatePresignedUploadUrl(dto: UploadAssetDto): Promise<PresignedUploadResponseDto> {
    const assetId = crypto.randomUUID();
    const subPath = dto.subPath ? `${dto.subPath}/` : '';
    const extension = dto.mimeType.split('/')[1] || 'bin';
    const assetKey = `${dto.category}/${subPath}${assetId}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: assetKey,
      ContentType: dto.mimeType,
    });

    // Presigned URL expires in 15 minutes
    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });

    // Save metadata to database
    const asset = this.assetRepo.create({
      id: assetId,
      category: dto.category,
      assetKey,
      filename: dto.filename,
      mimeType: dto.mimeType,
      fileSize: dto.fileSize,
      visibility: 'public',
    });

    await this.assetRepo.save(asset);

    const accessUrl = `${this.baseUrl}/${assetKey}`;

    return {
      assetId,
      uploadUrl,
      accessUrl,
      assetKey,
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
  }

  /**
   * Generate a presigned download URL for private assets.
   */
  async generatePresignedDownloadUrl(
    assetId: string,
    expiresIn = 3600,
  ): Promise<PresignedDownloadResponseDto> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${assetId} not found`);
    }

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: asset.assetKey,
    });

    const downloadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

    return {
      downloadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  /**
   * Get public asset URL directly.
   */
  getPublicUrl(assetKey: string): string {
    return `${this.baseUrl}/${assetKey}`;
  }

  /**
   * Retrieve asset metadata by ID.
   */
  async getAssetMetadata(assetId: string): Promise<AssetMetadataResponseDto> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${assetId} not found`);
    }

    const url = this.getPublicUrl(asset.assetKey);
    const { ownerId, ...metadataWithoutOwner } = asset;

    return {
      ...metadataWithoutOwner,
      category: metadataWithoutOwner.category as AssetCategory,
      visibility: metadataWithoutOwner.visibility as AssetVisibility,
      url,
    };
  }

  /**
   * List assets with filtering and pagination.
   */
  async listAssets(query: ListAssetsQueryDto): Promise<PaginatedAssetsResponseDto> {
    const {
      category,
      subPath,
      visibility = 'public',
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: FindOptionsWhere<AssetMetadata> = {};

    if (category) {
      where.category = category;
    }

    if (visibility) {
      where.visibility = visibility;
    }

    // Using basic TypeORM ILike if subPath is provided
    if (subPath) {
      const { ILike } = await import('typeorm');
      where.assetKey = ILike(`%/${subPath}/%`);
    }

    const [assets, total] = await this.assetRepo.findAndCount({
      where,
      order: { [sortBy]: sortOrder } as any, // Cast to any to handle dynamic sorting keys safely
      skip: (page - 1) * limit,
      take: limit,
    });

    // Map database models to match AssetMetadataResponse interface exactly
    const items = assets.map((asset) => {
      const { ownerId, ...metadataWithoutOwner } = asset;
      return {
        ...metadataWithoutOwner,
        category: metadataWithoutOwner.category as AssetCategory,
        visibility: metadataWithoutOwner.visibility as AssetVisibility,
        url: this.getPublicUrl(asset.assetKey),
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }


  /**
   * Delete an asset from both S3 and database.
   */
  async deleteAsset(assetId: string): Promise<void> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${assetId} not found`);
    }

    // Delete from S3
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: asset.assetKey,
    });

    await this.s3Client.send(command);

    // Delete from database
    await this.assetRepo.delete(assetId);

    this.logger.log(`Deleted asset: ${assetId} (${asset.assetKey})`);
  }

  /**
   * Verify asset exists in S3.
   */
  async verifyAssetExists(assetKey: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: assetKey,
      });
      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }
}