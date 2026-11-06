import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import type {
// DTOs
  CreateUserDto,
  LoginUserDto,
  UpdateUserDto,
  ForgotPasswordDto,
  ChangeUserRoleDto,
  ResetUserPasswordDto,
  UploadAssetDto,
  PresignedUploadResponseDto,
  AssetMetadataResponseDto,
  ListAssetsQueryDto,
  PaginatedAssetsResponseDto,
  PresignedDownloadResponseDto,
// Entity Interfaces
IUser,
// Types & Enums
UserRoles,
} from '@project/shared-types';

// API base configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// Create an Axios instance
function createApiClient(): AxiosInstance {
    const apiClient = axios.create({
        baseURL: API_BASE_URL,
        headers: {
            'Content-Type': 'application/json',
        },
        withCredentials: true,
    });
    // Request interceptor to pass auth token
    apiClient.interceptors.request.use(
        (config) => {
            const token = localStorage.getItem('accessToken');
            if(token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            return config;
        },
        (error) => Promise.reject(error)
    );
    // Response interceptor for error handling
    apiClient.interceptors.response.use(
        (response) => response,
        (error) => {
            if(error.response?.status === 401) {
                //Handle unauthorized
                localStorage.removeItem('accessToken');
                window.location.href = '/login';
            }
            return Promise.reject(error)
        }
    );
    return apiClient;
}

export const api = createApiClient();

async function request<T>(config: AxiosRequestConfig): Promise<T> {
    const response = await api.request<T>(config);
    return response.data;
}

// Auth API
export const authApi = {
    /* 
     * POST /auth/signup
     * Register as a new user
    */
   signup: (userData: CreateUserDto): Promise<IUser> =>
    request({url: '/auth/signup', method: 'POST', data: userData }),

    /* 
     * POST /auth/login
     * Authenticate user and receive access token
    */
   login: (userData: LoginUserDto): Promise<{ accessToken: string }> =>
    request({url: '/auth/login', method: 'POST', data: userData }),

    /* 
     * GET /auth/me
     * Get authenticated user profile
    */
   getProfile: (): Promise<IUser> =>
    request({url: '/auth/me', method: 'GET' }),
}

/**
 * Storage API endpoints for interacting with the backend storage service.
 */
export const storageApi = {
  /**
   * Get a presigned upload URL for direct S3 upload.
   */
  async getUploadUrl(dto: UploadAssetDto): Promise<PresignedUploadResponseDto> {
    const response = await api.post<PresignedUploadResponseDto>('/assets/upload-url', dto);
    return response.data;
  },

  /**
   * Upload a file directly to S3 using presigned URL.
   */
  async uploadToS3(uploadUrl: string, file: File, contentType: string): Promise<void> {
    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': contentType,
      },
    });
  },

  /**
   * Get asset metadata by ID.
   */
  async getAsset(assetId: string): Promise<AssetMetadataResponseDto> {
    const response = await api.get<AssetMetadataResponseDto>(`/assets/${assetId}`);
    return response.data;
  },

  /**
   * List assets with filtering and pagination.
   */
  async listAssets(query?: ListAssetsQueryDto): Promise<PaginatedAssetsResponseDto> {
    const params = new URLSearchParams();
    if (query?.category) params.append('category', query.category);
    if (query?.subPath) params.append('subPath', query.subPath);
    if (query?.visibility) params.append('visibility', query.visibility);
    if (query?.page) params.append('page', query.page.toString());
    if (query?.limit) params.append('limit', query.limit.toString());
    if (query?.sortBy) params.append('sortBy', query.sortBy);
    if (query?.sortOrder) params.append('sortOrder', query.sortOrder);

    const response = await api.get<PaginatedAssetsResponseDto>(
      `/assets${params.toString() ? `?${params.toString()}` : ''}`,
    );
    return response.data;
  },

  /**
   * Get presigned download URL for private assets.
   */
  async getDownloadUrl(assetId: string, expiresIn?: number): Promise<PresignedDownloadResponseDto> {
    const params = expiresIn ? `?expiresIn=${expiresIn}` : '';
    const response = await api.post<PresignedDownloadResponseDto>(
      `/assets/${assetId}/download-url${params}`,
    );
    return response.data;
  },

  /**
   * Delete an asset.
   */
  async deleteAsset(assetId: string): Promise<void> {
    await api.delete(`/assets/${assetId}`);
  },

  /**
   * Get public asset URL directly (no API call needed).
   */
  getPublicUrl(assetKey: string): string {
    const s3Url = import.meta.env.VITE_STORAGE_URL || 'http://localhost:9000';
    const bucket = import.meta.env.VITE_STORAGE_BUCKET || 'hub-assets';
    return `${s3Url}/${bucket}/${assetKey}`;
  },
};