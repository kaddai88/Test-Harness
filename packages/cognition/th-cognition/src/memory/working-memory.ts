/**
 * Working Memory — short-term memory for current session context.
 * 
 * Holds the immediate context of what the agent is doing:
 * - Current page understanding
 * - Active test goals
 * - Recent actions and their outcomes
 * - Temporary state needed for decision making
 * 
 * Analogous to human working memory: limited capacity, fast access, volatile.
 */

export interface WorkingMemoryItem {
  key: string;
  value: unknown;
  timestamp: number;
  ttl?: number; // Time-to-live in milliseconds
}

export class WorkingMemory {
  private items: Map<string, WorkingMemoryItem> = new Map();
  private maxCapacity: number;
  
  constructor(maxCapacity: number = 100) {
    this.maxCapacity = maxCapacity;
  }
  
  /**
   * Store an item in working memory.
   */
  set(key: string, value: unknown, ttl?: number): void {
    // Evict oldest if at capacity
    if (this.items.size >= this.maxCapacity && !this.items.has(key)) {
      this.evictOldest();
    }
    
    this.items.set(key, {
      key,
      value,
      timestamp: Date.now(),
      ttl,
    });
  }
  
  /**
   * Retrieve an item from working memory.
   */
  get<T = unknown>(key: string): T | undefined {
    const item = this.items.get(key);
    if (!item) return undefined;
    
    // Check TTL
    if (item.ttl && Date.now() - item.timestamp > item.ttl) {
      this.items.delete(key);
      return undefined;
    }
    
    return item.value as T;
  }
  
  /**
   * Check if a key exists in working memory.
   */
  has(key: string): boolean {
    const item = this.items.get(key);
    if (!item) return false;
    
    // Check TTL
    if (item.ttl && Date.now() - item.timestamp > item.ttl) {
      this.items.delete(key);
      return false;
    }
    
    return true;
  }
  
  /**
   * Remove an item from working memory.
   */
  delete(key: string): boolean {
    return this.items.delete(key);
  }
  
  /**
   * Clear all items from working memory.
   */
  clear(): void {
    this.items.clear();
  }
  
  /**
   * Get all keys in working memory.
   */
  keys(): string[] {
    return Array.from(this.items.keys());
  }
  
  /**
   * Get all values in working memory.
   */
  values(): unknown[] {
    return Array.from(this.items.values()).map(item => item.value);
  }
  
  /**
   * Get the number of items in working memory.
   */
  size(): number {
    return this.items.size;
  }
  
  /**
   * Export working memory state for persistence.
   */
  export(): WorkingMemoryItem[] {
    return Array.from(this.items.values());
  }
  
  /**
   * Import working memory state from persistence.
   */
  import(items: WorkingMemoryItem[]): void {
    this.items.clear();
    for (const item of items) {
      this.items.set(item.key, item);
    }
  }
  
  /**
   * Clean up expired items.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.items.entries()) {
      if (item.ttl && now - item.timestamp > item.ttl) {
        this.items.delete(key);
      }
    }
  }
  
  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    
    for (const [key, item] of this.items.entries()) {
      if (item.timestamp < oldestTime) {
        oldestTime = item.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.items.delete(oldestKey);
    }
  }
}
