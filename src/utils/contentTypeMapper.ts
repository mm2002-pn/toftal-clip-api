import { ContentType } from '@prisma/client';

/**
 * Map legacy deliverable types to ContentType
 * Legacy formats: 'short', 'reel', 'tiktok', 'youtube', 'documentary', 'promo', 'podcast', etc.
 */
export const mapDeliverableTypeToContentType = (legacyType: string | null | undefined): ContentType | null => {
  if (!legacyType) return null;

  const normalizedType = legacyType.toLowerCase().trim();

  // SHORT FORM variants
  if (
    normalizedType.includes('short') ||
    normalizedType.includes('reel') ||
    normalizedType.includes('tiktok') ||
    normalizedType.includes('instagram')
  ) {
    return ContentType.SHORT_FORM;
  }

  // LONG FORM variants
  if (
    normalizedType.includes('youtube') ||
    normalizedType.includes('documentary') ||
    normalizedType.includes('promo') ||
    normalizedType.includes('long')
  ) {
    return ContentType.LONG_FORM;
  }

  // PODCAST variants
  if (normalizedType.includes('podcast') || normalizedType.includes('audio')) {
    return ContentType.PODCAST;
  }

  // THUMBNAIL variants
  if (
    normalizedType.includes('thumbnail') ||
    normalizedType.includes('miniature') ||
    normalizedType.includes('cover')
  ) {
    return ContentType.THUMBNAIL;
  }

  // Default to SHORT_FORM if unknown
  console.warn(`⚠️ Unknown deliverable type: "${legacyType}", defaulting to SHORT_FORM`);
  return ContentType.SHORT_FORM;
};

/**
 * Map legacy portfolio item tags to ContentType
 * Legacy formats: 'SHORT', 'PODCAST', 'LONG_FORM' (already match our enum names mostly)
 */
export const mapPortfolioTagToContentType = (legacyTag: string | null | undefined): ContentType | null => {
  if (!legacyTag) return null;

  const normalizedTag = legacyTag.toUpperCase().trim();

  // SHORT_FORM
  if (normalizedTag === 'SHORT' || normalizedTag === 'SHORT_FORM') {
    return ContentType.SHORT_FORM;
  }

  // LONG_FORM
  if (normalizedTag === 'LONG_FORM' || normalizedTag === 'LONG') {
    return ContentType.LONG_FORM;
  }

  // PODCAST
  if (normalizedTag === 'PODCAST') {
    return ContentType.PODCAST;
  }

  // THUMBNAIL
  if (normalizedTag === 'THUMBNAIL') {
    return ContentType.THUMBNAIL;
  }

  // Default to SHORT_FORM if unknown
  console.warn(`⚠️ Unknown portfolio tag: "${legacyTag}", defaulting to SHORT_FORM`);
  return ContentType.SHORT_FORM;
};

/**
 * Map legacy OpportunityType to ContentType
 * Legacy formats: 'Shorts', 'YouTube_Long', 'Podcast', 'Miniatures'
 */
export const mapOpportunityTypeToContentType = (legacyType: string | null | undefined): ContentType | null => {
  if (!legacyType) return null;

  const normalizedType = legacyType.toLowerCase().trim();

  // SHORT_FORM
  if (normalizedType === 'shorts') {
    return ContentType.SHORT_FORM;
  }

  // LONG_FORM
  if (normalizedType.includes('youtube') || normalizedType === 'youtube_long') {
    return ContentType.LONG_FORM;
  }

  // PODCAST
  if (normalizedType === 'podcast') {
    return ContentType.PODCAST;
  }

  // THUMBNAIL
  if (normalizedType === 'miniatures' || normalizedType === 'thumbnail') {
    return ContentType.THUMBNAIL;
  }

  // Default to SHORT_FORM if unknown
  console.warn(`⚠️ Unknown opportunity type: "${legacyType}", defaulting to SHORT_FORM`);
  return ContentType.SHORT_FORM;
};

/**
 * Auto-detect and map any legacy type to ContentType
 * Tries all mapping functions to find the best match
 */
export const mapLegacyToContentType = (legacyValue: string | null | undefined): ContentType | null => {
  if (!legacyValue) return null;

  // Try deliverable mapping first (most common)
  let result = mapDeliverableTypeToContentType(legacyValue);
  if (result) return result;

  // Try portfolio tag mapping
  result = mapPortfolioTagToContentType(legacyValue);
  if (result) return result;

  // Try opportunity type mapping
  result = mapOpportunityTypeToContentType(legacyValue);
  if (result) return result;

  // Default
  return ContentType.SHORT_FORM;
};

/**
 * Get label for ContentType
 */
export const getContentTypeLabel = (contentType: ContentType | null | undefined): string => {
  const labels: Record<ContentType, string> = {
    [ContentType.SHORT_FORM]: 'Short Form',
    [ContentType.LONG_FORM]: 'Long Form',
    [ContentType.PODCAST]: 'Podcast',
    [ContentType.THUMBNAIL]: 'Thumbnail'
  };

  return contentType ? labels[contentType] : 'Unknown';
};

/**
 * Get icon/emoji for ContentType
 */
export const getContentTypeIcon = (contentType: ContentType | null | undefined): string => {
  const icons: Record<ContentType, string> = {
    [ContentType.SHORT_FORM]: '📱',
    [ContentType.LONG_FORM]: '🎬',
    [ContentType.PODCAST]: '🎙️',
    [ContentType.THUMBNAIL]: '🖼️'
  };

  return contentType ? icons[contentType] : '❓';
};

/**
 * Get description for ContentType
 */
export const getContentTypeDescription = (contentType: ContentType | null | undefined): string => {
  const descriptions: Record<ContentType, string> = {
    [ContentType.SHORT_FORM]: 'Montages verticaux pour TikTok, Instagram Reels',
    [ContentType.LONG_FORM]: 'Édition narrative pour YouTube et documentaires',
    [ContentType.PODCAST]: 'Contenu audio et vidéo pour podcasts',
    [ContentType.THUMBNAIL]: 'Miniatures optimisées pour aperçus YouTube'
  };

  return contentType ? descriptions[contentType] : '';
};

/**
 * All ContentType values
 */
export const ALL_CONTENT_TYPES = [
  ContentType.SHORT_FORM,
  ContentType.LONG_FORM,
  ContentType.PODCAST,
  ContentType.THUMBNAIL
];

/**
 * Format info object containing all metadata for a ContentType
 */
export interface ContentTypeInfo {
  contentType: ContentType;
  label: string;
  icon: string;
  description: string;
  minWidth: number;
  minHeight: number;
  aspectRatio: string;
  minDuration: number;
  maxDuration: number | null;
}

/**
 * Get complete info for a ContentType
 */
export const getContentTypeInfo = (contentType: ContentType): ContentTypeInfo => {
  return {
    contentType,
    label: getContentTypeLabel(contentType),
    icon: getContentTypeIcon(contentType),
    description: getContentTypeDescription(contentType),
    minWidth: contentType === ContentType.SHORT_FORM ? 1080 :
              contentType === ContentType.LONG_FORM ? 1920 :
              contentType === ContentType.PODCAST ? 1080 :
              1280,
    minHeight: contentType === ContentType.SHORT_FORM ? 1920 :
               contentType === ContentType.LONG_FORM ? 1080 :
               contentType === ContentType.PODCAST ? 1080 :
               720,
    aspectRatio: contentType === ContentType.SHORT_FORM ? '9:16' :
                 contentType === ContentType.LONG_FORM ? '16:9' :
                 contentType === ContentType.PODCAST ? '1:1' :
                 '16:9',
    minDuration: contentType === ContentType.SHORT_FORM ? 5 :
                 contentType === ContentType.LONG_FORM ? 300 :
                 contentType === ContentType.PODCAST ? 600 :
                 0,
    maxDuration: contentType === ContentType.SHORT_FORM ? 60 : null
  };
};
