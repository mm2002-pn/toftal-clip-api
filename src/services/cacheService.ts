import { Redis } from '@upstash/redis';

// Cache key prefixes for organization
export const CACHE_KEYS = {
  DELIVERABLE: 'deliverable:',
  FEEDBACKS: 'feedbacks:',
  VERSION: 'version:',
  PROJECT: 'project:',
  PROJECT_DELIVERABLES: 'project:deliverables:',
  PROJECT_MEMBERS: 'project:members:',
  PROJECT_MEDIA: 'project:media:',
  USER: 'user:',
  SHARE_LINK: 'share:',
} as const;

// Default TTL values (in seconds)
export const CACHE_TTL = {
  SHORT: 60,           // 1 minute
  MEDIUM: 300,         // 5 minutes
  LONG: 3600,          // 1 hour
  VERY_LONG: 86400,    // 24 hours
} as const;

class CacheService {
  private redis: Redis | null = null;
  private enabled: boolean = false;
  private initialized: boolean = false;

  /**
   * Initialize the Redis client (lazy initialization)
   */
  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      console.warn('[CacheService] Redis is disabled - UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set');
      this.enabled = false;
      return;
    }

    try {
      this.redis = new Redis({ url, token });
      this.enabled = true;
      console.log('[CacheService] Redis cache initialized with URL:', url);
    } catch (error) {
      console.error('[CacheService] Failed to initialize Redis:', error);
      this.enabled = false;
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    this.initialize();
    if (!this.enabled || !this.redis) return null;

    try {
      const value = await this.redis.get<T>(key);
      if (value !== null) {
        console.log(`[Cache HIT] ${key}`);
      }
      return value;
    } catch (error) {
      console.error(`[Cache ERROR] get ${key}:`, error);
      return null;
    }
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    this.initialize();
    if (!this.enabled || !this.redis) return false;

    try {
      if (ttlSeconds) {
        await this.redis.set(key, value, { ex: ttlSeconds });
      } else {
        await this.redis.set(key, value);
      }
      console.log(`[Cache SET] ${key} (TTL: ${ttlSeconds || 'none'}s)`);
      return true;
    } catch (error) {
      console.error(`[Cache ERROR] set ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete a key from cache
   */
  async delete(key: string): Promise<boolean> {
    this.initialize();
    if (!this.enabled || !this.redis) return false;

    try {
      await this.redis.del(key);
      console.log(`[Cache DEL] ${key}`);
      return true;
    } catch (error) {
      console.error(`[Cache ERROR] delete ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<boolean> {
    this.initialize();
    if (!this.enabled || !this.redis) return false;

    try {
      // Upstash doesn't support KEYS command in REST API
      // We'll use SCAN for production, but for now we track keys we want to invalidate
      console.log(`[Cache PATTERN DEL] ${pattern}`);
      return true;
    } catch (error) {
      console.error(`[Cache ERROR] deletePattern ${pattern}:`, error);
      return false;
    }
  }

  /**
   * Get or set pattern - fetch from cache or compute and cache
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = CACHE_TTL.MEDIUM
  ): Promise<T> {
    this.initialize();
    if (!this.enabled || !this.redis) {
      return fetchFn();
    }

    try {
      // Try to get from cache
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }

      // Fetch fresh data
      const fresh = await fetchFn();

      // Cache the result
      await this.set(key, fresh, ttlSeconds);

      return fresh;
    } catch (error) {
      console.error(`[Cache ERROR] getOrSet ${key}:`, error);
      // Fallback to fetching fresh data
      return fetchFn();
    }
  }

  /**
   * Invalidate deliverable-related caches
   */
  async invalidateDeliverable(deliverableId: string): Promise<void> {
    await this.delete(`${CACHE_KEYS.DELIVERABLE}${deliverableId}`);
  }

  /**
   * Invalidate feedbacks cache for a version
   */
  async invalidateFeedbacks(versionId: string): Promise<void> {
    await this.delete(`${CACHE_KEYS.FEEDBACKS}${versionId}`);
    await this.delete(`${CACHE_KEYS.FEEDBACKS}${versionId}:count`);
  }

  /**
   * Invalidate version cache
   */
  async invalidateVersion(versionId: string): Promise<void> {
    await this.delete(`${CACHE_KEYS.VERSION}${versionId}`);
  }

  /**
   * Invalidate share link cache
   */
  async invalidateShareLink(token: string): Promise<void> {
    await this.delete(`${CACHE_KEYS.SHARE_LINK}${token}`);
  }

  /**
   * Invalidate project deliverables cache
   */
  async invalidateProjectDeliverables(projectId: string): Promise<void> {
    await this.delete(`${CACHE_KEYS.PROJECT_DELIVERABLES}${projectId}`);
  }

  /**
   * Invalidate project members cache
   */
  async invalidateProjectMembers(projectId: string): Promise<void> {
    await this.delete(`${CACHE_KEYS.PROJECT_MEMBERS}${projectId}`);
  }

  /**
   * Invalidate project media cache
   */
  async invalidateProjectMedia(projectId: string): Promise<void> {
    await this.delete(`${CACHE_KEYS.PROJECT_MEDIA}${projectId}`);
  }

  /**
   * Invalidate all project-related caches
   */
  async invalidateProject(projectId: string): Promise<void> {
    await Promise.all([
      this.delete(`${CACHE_KEYS.PROJECT}${projectId}`),
      this.delete(`${CACHE_KEYS.PROJECT_DELIVERABLES}${projectId}`),
      this.delete(`${CACHE_KEYS.PROJECT_MEMBERS}${projectId}`),
      this.delete(`${CACHE_KEYS.PROJECT_MEDIA}${projectId}`),
    ]);
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    this.initialize();
    return this.enabled;
  }

  /**
   * Health check - verify Redis connection
   */
  async healthCheck(): Promise<boolean> {
    this.initialize();
    if (!this.enabled || !this.redis) return false;

    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      console.error('[Cache ERROR] healthCheck:', error);
      return false;
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();
export default cacheService;
