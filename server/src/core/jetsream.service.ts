import { Injectable, OnModuleInit, OnApplicationShutdown, Logger } from '@nestjs/common';
import { connect, NatsConnection, JetStreamClient, JetStreamManager} from 'nats';
import { environment } from '../common/environment';
import { GeneralAppStreamConfig } from '../common/general';

@Injectable()
export class JetStreamService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JetStreamService.name);
  private natsConnection: NatsConnection;
  private jsClient: JetStreamClient;
  private jsManager: JetStreamManager;

  async onModuleInit() {
    try {
      // Establish native connection
      this.natsConnection = await connect({
        servers: [environment.NATS_URL],
      });

      // Initialize JetStream contexts
      this.jsClient = this.natsConnection.jetstream();
      this.jsManager = await this.natsConnection.jetstreamManager();
      
      this.logger.log('Successfully connected to NATS JetStream.');

      // Programmatically assert the general system stream
      await this.assertGeneralStream();
    } catch (error) {
      this.logger.error('Failed to initialize NATS JetStream connection', error.stack);
      throw error;
    }
  }

  // Declares a multi-purpose, domain-agnostic stream for general persistence
  private async assertGeneralStream() {
    try {
      await this.jsManager.streams.add(GeneralAppStreamConfig);
      this.logger.log(`General stream "${GeneralAppStreamConfig.name}" verified/created.`);
    } catch (err) {
      this.logger.error(`Failed to assert stream "${GeneralAppStreamConfig.name}":`, err.message);
    }
  }

  // Expose the raw JetStream client for custom interactions
  getClient(): JetStreamClient {
    if (!this.jsClient) throw new Error('JetStream client not initialized.');
    return this.jsClient;
  }

  // Expose the manager for administrative modifications
  getManager(): JetStreamManager {
    if (!this.jsManager) throw new Error('JetStream manager not initialized.');
    return this.jsManager;
  }

  // Generic publisher method
  async publish(subject: string, data: any) {
    if (!subject.startsWith('app.')) {
      throw new Error(`Subject "${subject}" must start with "app." prefix to be captured by APP_STREAM.`);
    }

    const client = this.getClient();
    const encoder = new TextEncoder();
    const payload = encoder.encode(JSON.stringify(data));

    // Awaits cluster persistence acknowledgment [2]
    const ack = await client.publish(subject, payload);
    return ack;
  }

  async onApplicationShutdown() {
    if (this.natsConnection) {
      this.logger.log('Closing NATS JetStream connection...');
      await this.natsConnection.close();
    }
  }
}
