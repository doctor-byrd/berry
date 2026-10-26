import { Injectable, NotFoundException, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { UpsertSystemConfigDto, SystemConfigResponseDto, SystemConfig, CoreJobActions } from '@project/shared-types';

/**
 * Global Operations Configuration Service
 * 
 * Manages runtime variables using a high-performance Cache-Aside strategy backed by the application's core BullMQ Redis connection pool.
 */
@Injectable()
export class SystemConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemConfigService.name);
  private readonly cachePrefix = 'sys_config:';
  private readonly cacheTtl = 300; // Cache config for 5 minutes (300 seconds)

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepository: Repository<SystemConfig>,
    @InjectQueue(CoreJobActions.SET_CONFIGURATION) private readonly sharedQueue: Queue
  ) {}

  /**
   * NestJS Lifecycle Hook: Runs automatically when application boots up.
   * Guarantees essential configurations exist in the primary database state.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Verifying operational system configurations...');
    try {
      await this.ensureDefaultConfig(
        'EXAMPLE_CONFIG',
        '0.000000',
        'Example configuration'
      );
    } catch (error) {
      this.logger.error('Failed to run system configuration startup seeds', error);
    }
  }

  /**
   * Internal Helper: Check and seed missing global configurations
   */
  private async ensureDefaultConfig(key: string, defaultNumericValue: string, description: string): Promise<void> {
    const exists = await this.configRepository.findOne({ where: { key } });
    if (!exists) {
      const seedConfig = this.configRepository.create({
        key,
        valueNumeric: defaultNumericValue,
        description,
        updatedBy: undefined // System initialized
      });
      await this.configRepository.save(seedConfig);
      this.logger.log(`Successfully seeded system configuration default: [${key} = ${defaultNumericValue}]`);
    }
  }

  /**
   * Internal Helper: Retrieve a config value with absolute fast-path caching
   */
  private async getCachedConfig(key: string): Promise<SystemConfig | null> {
    const cacheKey = `${this.cachePrefix}${key}`;
    
    // Safely retrieve the underlying ioredis client reference from the modern BullMQ backend contract
    const backend = this.sharedQueue.getBackend() as any;
    const redis = await backend.client;

    // 1. Try to fetch from Redis fast-path
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return JSON.parse(cachedData) as SystemConfig;
    }

    // 2. Cache miss -> read from primary database
    const config = await this.configRepository.findOne({ where: { key } });
    if (config) {
      // 3. Populate cache with a 5-minute safety window
      await redis.set(cacheKey, JSON.stringify(config), 'EX', this.cacheTtl);
    }

    return config;
  }

  /**
   * Get a numeric configuration safely as a BigInt string scaled to 6 decimals
   */
  async getNumericValue(key: string): Promise<bigint> {
    const config = await this.getCachedConfig(key);
    if (!config || !config.valueNumeric) {
      throw new NotFoundException(`Numeric configuration key '${key}' not found or unconfigured`);
    }
    
    // Convert the decimal string straight into its 6-decimal BigInt raw scale.
    const [intPartRaw, decPartRaw = ''] = config.valueNumeric.split('.');
    const intPart = intPartRaw === '' ? '0' : intPartRaw;
    const decPart = decPartRaw.padEnd(6, '0').slice(0, 6);
    return BigInt(`${intPart}${decPart}`);
  }

  /**
   * Get a raw string/text configuration value
   */
  async getTextValue(key: string): Promise<string> {
    const config = await this.getCachedConfig(key);
    if (!config || !config.valueText) {
      throw new NotFoundException(`Text configuration key '${key}' not found or unconfigured`);
    }
    return config.valueText;
  }

  /**
   * Administrative Route: Upsert configuration records and clear corresponding cache lines
   */
  async upsertConfig(dto: UpsertSystemConfigDto, actorId: string): Promise<SystemConfigResponseDto> {
    let config = await this.configRepository.findOne({ where: { key: dto.key } });

    if (!config) {
      config = this.configRepository.create({ key: dto.key });
    }

    config.valueText = dto.valueText;
    config.valueNumeric = dto.valueNumeric;
    config.description = dto.description;
    config.updatedBy = actorId;

    const savedConfig = await this.configRepository.save(config);

    // Cache Eviction Strategy. Purge cached values instantly across container steps
    const cacheKey = `${this.cachePrefix}${dto.key}`;
    const backend = this.sharedQueue.getBackend() as any;
    const redis = await backend.client;
    await redis.del(cacheKey);

    return {
      key: savedConfig.key,
      valueText: savedConfig.valueText,
      valueNumeric: savedConfig.valueNumeric,
      description: savedConfig.description,
      updatedBy: savedConfig.updatedBy,
      updatedAt: savedConfig.updatedAt,
    };
  }
}