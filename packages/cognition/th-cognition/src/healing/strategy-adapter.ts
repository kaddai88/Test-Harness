/**
 * Strategy Adapter — dynamically adjusts testing strategy based on outcomes.
 * 
 * Monitors performance and adapts:
 * - If a strategy isn't working, try alternatives
 * - If certain approaches work well, prefer them
 * - Adjust confidence thresholds based on experience
 * 
 * This enables the system to "learn what works" for each site.
 */

export interface StrategyAdjustment {
  timestamp: number;
  reason: string;
  adjustment: string;
  previousStrategy: string;
  newStrategy: string;
  effectiveness: 'improved' | 'worse' | 'neutral';
}

export interface TestingStrategy {
  name: string;
  description: string;
  
  // Strategy parameters
  params: {
    maxRetries?: number;
    maxTurns?: number;
    confidenceThreshold?: number;
    explorationRate?: number;
    preferredTools?: string[];
    avoidTools?: string[];
  };
  
  // Performance tracking
  successCount: number;
  failureCount: number;
  successRate: number;
  lastUsed: number;
  
  // Context
  targetUrl?: string;
  siteCategory?: string;
}

export class StrategyAdapter {
  private strategies: Map<string, TestingStrategy> = new Map();
  private adjustments: StrategyAdjustment[] = [];
  private storagePath: string;
  
  constructor(storagePath: string = '.cognition/strategies.json') {
    this.storagePath = storagePath;
    this.load();
    this.initializeDefaults();
  }
  
  /**
   * Get the best strategy for a context.
   */
  getBestStrategy(targetUrl?: string, siteCategory?: string): TestingStrategy | undefined {
    let strategies = Array.from(this.strategies.values());
    
    // Filter by URL
    if (targetUrl) {
      const urlSpecific = strategies.filter(s => s.targetUrl === targetUrl);
      if (urlSpecific.length > 0) {
        strategies = urlSpecific;
      }
    }
    
    // Filter by category
    if (siteCategory) {
      const categorySpecific = strategies.filter(s => s.siteCategory === siteCategory);
      if (categorySpecific.length > 0) {
        strategies = categorySpecific;
      }
    }
    
    // Sort by success rate and recency
    return strategies.sort((a, b) => {
      const recencyA = a.lastUsed ? (Date.now() - a.lastUsed) / 1000 / 60 / 60 : 999999;
      const recencyB = b.lastUsed ? (Date.now() - b.lastUsed) / 1000 / 60 / 60 : 999999;
      const scoreA = a.successRate * 0.7 + (1 / (recencyA + 1)) * 0.3;
      const scoreB = b.successRate * 0.7 + (1 / (recencyB + 1)) * 0.3;
      return scoreB - scoreA;
    })[0];
  }
  
  /**
   * Record strategy usage outcome.
   */
  recordOutcome(strategyName: string, success: boolean): void {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) return;
    
    if (success) {
      strategy.successCount++;
    } else {
      strategy.failureCount++;
    }
    
    const total = strategy.successCount + strategy.failureCount;
    strategy.successRate = total > 0 ? strategy.successCount / total : 0;
    strategy.lastUsed = Date.now();
    
    this.save();
  }
  
  /**
   * Suggest strategy adjustment based on performance.
   */
  suggestAdjustment(currentStrategy: TestingStrategy, recentFailures: number): StrategyAdjustment | undefined {
    // If too many recent failures, suggest a change
    if (recentFailures >= 3) {
      const alternative = this.findAlternative(currentStrategy);
      if (alternative) {
        const adjustment: StrategyAdjustment = {
          timestamp: Date.now(),
          reason: `Too many recent failures (${recentFailures}) with ${currentStrategy.name}`,
          adjustment: `Switch to ${alternative.name}`,
          previousStrategy: currentStrategy.name,
          newStrategy: alternative.name,
          effectiveness: 'neutral',
        };
        
        this.adjustments.push(adjustment);
        return adjustment;
      }
    }
    
    // If success rate is low, suggest parameter tuning
    if (currentStrategy.successRate < 0.3 && currentStrategy.failureCount >= 5) {
      const adjustment: StrategyAdjustment = {
        timestamp: Date.now(),
        reason: `Low success rate (${(currentStrategy.successRate * 100).toFixed(1)}%) with ${currentStrategy.name}`,
        adjustment: 'Increase exploration rate or try different tools',
        previousStrategy: currentStrategy.name,
        newStrategy: currentStrategy.name + ' (tuned)',
        effectiveness: 'neutral',
      };
      
      this.adjustments.push(adjustment);
      return adjustment;
    }
    
    return undefined;
  }
  
  /**
   * Apply a strategy adjustment.
   */
  applyAdjustment(adjustment: StrategyAdjustment): void {
    // Update effectiveness of previous adjustment if exists
    const prevAdj = this.adjustments.find(a => 
      a.previousStrategy === adjustment.previousStrategy && 
      a.timestamp < adjustment.timestamp
    );
    if (prevAdj) {
      // Compare success rates before and after
      const beforeStrategy = this.strategies.get(prevAdj.previousStrategy);
      const afterStrategy = this.strategies.get(adjustment.newStrategy);
      
      if (beforeStrategy && afterStrategy) {
        prevAdj.effectiveness = afterStrategy.successRate > beforeStrategy.successRate 
          ? 'improved' 
          : afterStrategy.successRate < beforeStrategy.successRate 
            ? 'worse' 
            : 'neutral';
      }
    }
    
    this.save();
  }
  
  /**
   * Get adjustment history.
   */
  getAdjustmentHistory(limit: number = 20): StrategyAdjustment[] {
    return this.adjustments
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
  
  /**
   * Add a new strategy.
   */
  addStrategy(strategy: Omit<TestingStrategy, 'successCount' | 'failureCount' | 'successRate' | 'lastUsed'>): void {
    const full: TestingStrategy = {
      ...strategy,
      successCount: 0,
      failureCount: 0,
      successRate: 0.5,
      lastUsed: 0,
    };
    
    this.strategies.set(strategy.name, full);
    this.save();
  }
  
  /**
   * Update a strategy.
   */
  updateStrategy(name: string, updates: Partial<TestingStrategy>): boolean {
    const strategy = this.strategies.get(name);
    if (!strategy) return false;
    
    Object.assign(strategy, updates);
    this.save();
    return true;
  }
  
  /**
   * Get all strategies.
   */
  getAllStrategies(): TestingStrategy[] {
    return Array.from(this.strategies.values());
  }
  
  /**
   * Clear all strategies.
   */
  clear(): void {
    this.strategies.clear();
    this.adjustments = [];
    this.save();
  }
  
  private findAlternative(current: TestingStrategy): TestingStrategy | undefined {
    const alternatives = Array.from(this.strategies.values())
      .filter(s => s.name !== current.name)
      .sort((a, b) => b.successRate - a.successRate);
    
    return alternatives[0];
  }
  
  private initializeDefaults(): void {
    if (this.strategies.size > 0) return;
    
    // Default strategies
    this.addStrategy({
      name: 'conservative',
      description: 'Careful, step-by-step testing',
      params: {
        maxRetries: 3,
        maxTurns: 50,
        confidenceThreshold: 0.8,
        explorationRate: 0.05,
      },
    });
    
    this.addStrategy({
      name: 'aggressive',
      description: 'Fast, exploratory testing',
      params: {
        maxRetries: 1,
        maxTurns: 100,
        confidenceThreshold: 0.5,
        explorationRate: 0.3,
      },
    });
    
    this.addStrategy({
      name: 'balanced',
      description: 'Balanced approach',
      params: {
        maxRetries: 2,
        maxTurns: 75,
        confidenceThreshold: 0.6,
        explorationRate: 0.15,
      },
    });
    
    this.save();
  }
  
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
        if (data.strategies) {
          for (const [name, strategy] of Object.entries(data.strategies)) {
            this.strategies.set(name, strategy as TestingStrategy);
          }
        }
        if (data.adjustments) {
          this.adjustments = data.adjustments;
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
        strategies: Object.fromEntries(this.strategies),
        adjustments: this.adjustments,
      };
      
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore save errors
    }
  }
}
