/**
 * Knowledge Updater — keeps knowledge fresh and accurate.
 * 
 * Monitors knowledge quality and:
 * - Detects outdated knowledge
 * - Marks uncertain knowledge for verification
 * - Removes knowledge that's been contradicted
 * - Reinforces knowledge that's been confirmed
 * 
 * This ensures the system's knowledge stays accurate over time.
 */

export type UpdateAction = 
  | 'reinforce'    // Knowledge was confirmed, increase confidence
  | 'weaken'       // Knowledge was contradicted, decrease confidence
  | 'expire'       // Knowledge is outdated, mark for review
  | 'remove'       // Knowledge is wrong, remove it
  | 'merge';       // Combine similar knowledge entries

export interface KnowledgeUpdate {
  timestamp: number;
  action: UpdateAction;
  knowledgeId: string;
  reason: string;
  evidence?: string;
}

export interface KnowledgeHealth {
  knowledgeId: string;
  health: 'healthy' | 'stale' | 'contradicted' | 'unverified';
  lastVerified: number;
  verificationCount: number;
  contradictionCount: number;
  age: number; // in days
}

export class KnowledgeUpdater {
  private updates: KnowledgeUpdate[] = [];
  private healthMap: Map<string, KnowledgeHealth> = new Map();
  private storagePath: string;
  
  // Configuration
  private staleThresholdDays: number = 30;
  private unverifiedThresholdDays: number = 7;
  private maxContradictions: number = 3;
  
  constructor(storagePath: string = '.cognition/updates.json') {
    this.storagePath = storagePath;
    this.load();
  }
  
  /**
   * Record that knowledge was confirmed/used successfully.
   */
  reinforce(knowledgeId: string, evidence?: string): void {
    const update: KnowledgeUpdate = {
      timestamp: Date.now(),
      action: 'reinforce',
      knowledgeId,
      reason: 'Knowledge was confirmed by successful use',
      evidence,
    };
    
    this.updates.push(update);
    
    // Update health
    const health = this.getOrCreateHealth(knowledgeId);
    health.lastVerified = Date.now();
    health.verificationCount++;
    health.health = 'healthy';
    
    this.save();
  }
  
  /**
   * Record that knowledge was contradicted.
   */
  weaken(knowledgeId: string, evidence?: string): void {
    const update: KnowledgeUpdate = {
      timestamp: Date.now(),
      action: 'weaken',
      knowledgeId,
      reason: 'Knowledge was contradicted by experience',
      evidence,
    };
    
    this.updates.push(update);
    
    // Update health
    const health = this.getOrCreateHealth(knowledgeId);
    health.contradictionCount++;
    
    if (health.contradictionCount >= this.maxContradictions) {
      health.health = 'contradicted';
    }
    
    this.save();
  }
  
  /**
   * Mark knowledge as potentially outdated.
   */
  markStale(knowledgeId: string, reason: string): void {
    const update: KnowledgeUpdate = {
      timestamp: Date.now(),
      action: 'expire',
      knowledgeId,
      reason,
    };
    
    this.updates.push(update);
    
    const health = this.getOrCreateHealth(knowledgeId);
    health.health = 'stale';
    
    this.save();
  }
  
  /**
   * Mark knowledge for removal.
   */
  markForRemoval(knowledgeId: string, reason: string): void {
    const update: KnowledgeUpdate = {
      timestamp: Date.now(),
      action: 'remove',
      knowledgeId,
      reason,
    };
    
    this.updates.push(update);
    
    this.save();
  }
  
  /**
   * Check health of all knowledge.
   */
  checkHealth(knowledgeItems: Array<{ id: string; timestamp: number; confidence: number }>): KnowledgeHealth[] {
    const results: KnowledgeHealth[] = [];
    const now = Date.now();
    
    for (const item of knowledgeItems) {
      const health = this.getOrCreateHealth(item.id);
      const ageDays = (now - item.timestamp) / 1000 / 60 / 60 / 24;
      health.age = ageDays;
      
      // Check if stale
      if (ageDays > this.staleThresholdDays) {
        health.health = 'stale';
      }
      
      // Check if unverified
      if (health.verificationCount === 0 && ageDays > this.unverifiedThresholdDays) {
        health.health = 'unverified';
      }
      
      // Check if contradicted
      if (health.contradictionCount >= this.maxContradictions) {
        health.health = 'contradicted';
      }
      
      results.push(health);
    }
    
    this.save();
    return results;
  }
  
  /**
   * Get knowledge that needs attention.
   */
  getNeedsAttention(healthResults: KnowledgeHealth[]): {
    stale: KnowledgeHealth[];
    contradicted: KnowledgeHealth[];
    unverified: KnowledgeHealth[];
  } {
    return {
      stale: healthResults.filter(h => h.health === 'stale'),
      contradicted: healthResults.filter(h => h.health === 'contradicted'),
      unverified: healthResults.filter(h => h.health === 'unverified'),
    };
  }
  
  /**
   * Get update history for a knowledge item.
   */
  getUpdateHistory(knowledgeId: string, limit: number = 20): KnowledgeUpdate[] {
    return this.updates
      .filter(u => u.knowledgeId === knowledgeId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
  
  /**
   * Get all updates.
   */
  getAllUpdates(limit: number = 100): KnowledgeUpdate[] {
    return this.updates
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
  
  /**
   * Get health for a specific knowledge item.
   */
  getHealth(knowledgeId: string): KnowledgeHealth | undefined {
    return this.healthMap.get(knowledgeId);
  }
  
  /**
   * Clear all update history.
   */
  clear(): void {
    this.updates = [];
    this.healthMap.clear();
    this.save();
  }
  
  private getOrCreateHealth(knowledgeId: string): KnowledgeHealth {
    let health = this.healthMap.get(knowledgeId);
    if (!health) {
      health = {
        knowledgeId,
        health: 'healthy',
        lastVerified: 0,
        verificationCount: 0,
        contradictionCount: 0,
        age: 0,
      };
      this.healthMap.set(knowledgeId, health);
    }
    return health;
  }
  
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
        if (data.updates) {
          this.updates = data.updates;
        }
        if (data.healthMap) {
          for (const [id, health] of Object.entries(data.healthMap)) {
            this.healthMap.set(id, health as KnowledgeHealth);
          }
        }
      }
    } catch {
      // Ignore load errors
    }
  }
  
  private save(): void {
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = {
        updates: this.updates,
        healthMap: Object.fromEntries(this.healthMap),
      };
      
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore save errors
    }
  }
}
