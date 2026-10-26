import {
    useQuery,
    useMutation,
    useQueryClient,
    type UseQueryOptions,
    UseMutationOptions,
} from '@tanstack/react-query'
import { authApi, storageApi } from "./api";
import { 
  IUser,   
  AssetMetadataResponseDto,
  ListAssetsQueryDto,
  PaginatedAssetsResponseDto,
  UploadAssetDto,
  PresignedUploadResponseDto,
  PresignedDownloadResponseDto,
  AssetCategory, 
} from '@project/shared-types';

export function useCurrentUser(options?: Omit<UseQueryOptions<IUser, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery<IUser, Error>({
        queryKey: ['auth', 'me'],
        queryFn: () => authApi.getProfile(),
        ...options,
    });
}

// ============================================================================
// QUERY KEYS
// ============================================================================

export const assetKeys = {
  all: ['assets'] as const,
  lists: () => [...assetKeys.all, 'list'] as const,
  list: (filters: ListAssetsQueryDto) => [...assetKeys.lists(), filters] as const,
  details: () => [...assetKeys.all, 'detail'] as const,
  detail: (assetId: string) => [...assetKeys.details(), assetId] as const,
};

// ============================================================================
// ASSET QUERIES
// ============================================================================

/**
 * Fetch single asset metadata by ID.
 */
export function useAsset(assetId: string, options?: Omit<UseQueryOptions<AssetMetadataResponseDto, Error>, 'queryKey' | 'queryFn'>) {
  return useQuery<AssetMetadataResponseDto, Error>({
    queryKey: assetKeys.detail(assetId),
    queryFn: () => storageApi.getAsset(assetId),
    enabled: !!assetId,
    ...options,
  });
}

/**
 * Fetch paginated list of assets with filtering.
 */
export function useAssets(
  query?: ListAssetsQueryDto,
  options?: Omit<UseQueryOptions<PaginatedAssetsResponseDto, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<PaginatedAssetsResponseDto, Error>({
    queryKey: assetKeys.list(query || {}),
    queryFn: () => storageApi.listAssets(query),
    ...options,
  });
}

/**
 * Fetch assets by category.
 */
export function useAssetsByCategory(
  category: AssetCategory,
  options?: Omit<UseQueryOptions<PaginatedAssetsResponseDto, Error>, 'queryKey' | 'queryFn'>,
) {
  return useAssets({ category }, options);
}

// ============================================================================
// ASSET MUTATIONS
// ============================================================================

/**
 * Mutation to request upload URL and upload file.
 */
export function useUploadAsset(
  options?: Omit<UseMutationOptions<PresignedUploadResponseDto, Error, UploadAssetDto & { file: File }>, 'mutationFn'>,
) {
  return useMutation<PresignedUploadResponseDto, Error, UploadAssetDto & { file: File }>({
    mutationFn: async ({ file, ...dto }) => {
      // Step 1: Get presigned upload URL
      const response = await storageApi.getUploadUrl(dto);
      
      // Step 2: Upload file directly to S3 using the url from the response
      await storageApi.uploadToS3(response.uploadUrl, file, dto.mimeType);
      
      // Return the full response (including uploadUrl) to match PresignedUploadResponse
      return response;
    },
    ...options,
  });
}

/**
 * Mutation to delete an asset.
 */
export function useDeleteAsset(options?: Omit<UseMutationOptions<void, Error, string>, 'mutationFn'>) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (assetId) => storageApi.deleteAsset(assetId),
    onSuccess: () => {
      // Invalidate asset list queries
      queryClient.invalidateQueries({ queryKey: assetKeys.all });
    },
    ...options,
  });
}

/**
 * Mutation to get presigned download URL.
 */
export function useGetDownloadUrl(
  options?: Omit<UseMutationOptions<PresignedDownloadResponseDto, Error, { assetId: string; expiresIn?: number }>, 'mutationFn'>,
) {
  return useMutation<PresignedDownloadResponseDto, Error, { assetId: string; expiresIn?: number }>({
    mutationFn: ({ assetId, expiresIn }) => storageApi.getDownloadUrl(assetId, expiresIn),
    ...options,
  });
}

// ============================================================================
// HELPER HOOKS
// ============================================================================

/**
 * Hook to load and cache an asset URL.
 * Returns the public URL immediately if available, or fetches metadata first.
 */
export function useAssetUrl(assetId: string): string | undefined {
  const { data } = useAsset(assetId, {
    staleTime: Infinity, // Asset URLs don't change
    gcTime: Infinity,
  });

  return data?.url;
}

/**
 * Hook to preload multiple assets.
 */
export function usePreloadAssets(assetIds: string[]) {
  const queryClient = useQueryClient();

  const preload = async () => {
    await Promise.all(
      assetIds.map((id) =>
        queryClient.fetchQuery({
          queryKey: assetKeys.detail(id),
          queryFn: () => storageApi.getAsset(id),
          staleTime: Infinity,
        }),
      ),
    );
  };

  return { preload };
}