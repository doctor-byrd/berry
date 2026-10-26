export function sharedTypes(): string {
  return 'shared-types';
}

export enum UserRoles {
  USER = 'user',
  ADMIN = 'admin',
}


// Define core job actions
export enum CoreJobActions {
  SEND_NOTIFICATION = 'send-notification',
  SEND_EMAIL = 'send-email',
  SET_CONFIGURATION = 'set-configuration',
}

/**
 * Asset categories for organizing resources in S3/MinIO.
 * Maps to bucket folder structure: /{category}/{subPath}
 */
export enum AssetCategory {
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  MISC = 'misc',
}

/**
 * Asset visibility levels for access control.
 */
export enum AssetVisibility {
  PUBLIC = 'public',        // Accessible without auth (presigned or anonymous)
  AUTHENTICATED = 'authenticated',  // Requires valid user session
  ADMIN_ONLY = 'admin_only',        // Restricted to admins
}

/**
 * NotificationPayload interface
 * Stores metadata about notifications.
 */
export interface NotificationPayload {
  recipientId: string;      // The target User or Account profile UUID
  eventSignature: string;   // e.g., 'call.initiated'
  title: string;            // Generic title metadata indicator
  message: string;          // Human-readable alert body string
  metadata?: any;           // Context variables (transactionIds, amounts, currencies)
}

//User entity interface
export interface IUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRoles;
  resetToken: string | null;
  resetTokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * AssetMetadata interface
 * Stores metadata about uploaded assets in Storage.
 */
export interface IAssetMetadata {
  id: string;
  category: AssetCategory;
  assetKey: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  visibility: AssetVisibility;
  ownerId?: string;
  tags?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
