/**
 * Reinforcement Learner — learns from action outcomes to improve strategies.
 * 
 * Implements a simple reinforcement learning approach:
 * - Track which actions lead to success/failure
 * - Adjust strategy preferences based on outcomes
 * - Discover effective action sequences through trial and feedback
 * 
 * This is the core "learning from experience" mechanism.
 */

export interface RewardSignal {
  action: string; // Tool name
  context: string; // Situation/context hash
  reward: number; // -1 to 1 (negative = bad, positive = good)
  timestamp: number;
  sessionId: string;
}

interface ActionValue {
  totalReward: number;
  visitCount: number;
  averageReward: number;
  lastUpdated: number;
}

export class ReinforcementLearner {
  private qValues: Map<string, ActionValue> = new Map();
  private storagePath: string;
  private learningRate: number;
  private discountFactor: number;
  
  constructor(
    storagePath: string = '.cognition/q-values.json',
    learningRate: number = 0.1,
    discountFactor: number = 0.9
  ) {
    this.storagePath = storagePath;
    this.learningRate = learningRate;
    this.discountFactor = discountFactor;
    this.load();
  }
  
  /**
   * Record a reward signal and update Q-values.
   */
  learn(signal: RewardSignal): void {
    const key = this.makeKey(signal.action, signal.context);
    const current = this.qValues.get(key) || {
      totalReward: 0,
      visitCount: 0,
      averageReward: 0,
      lastUpdated: 0,
    };
    
    // Update using running average
    current.visitCount++;
    current.totalReward += signal.reward;
    current.averageReward = current.totalReward / current.visitCount;
    current.lastUpdated = Date.now();
    
    this.qValues.set(key, current);
    this.save();
  }
  
  /**
   * Get the expected value of an action in a context.
   */
  getValue(action: string, context: string): number {
    const key = this.makeKey(action, context);
    const value = this.qValues.get(key);
    return value?.averageReward ?? 0;
  }
  
  /**
   * Choose the best action for a context (exploitation).
   */
  chooseBest(actions: string[], context: string): string | undefined {
    if (actions.length === 0) return undefined;
    
    let bestAction: string = actions[0]!;
    let bestValue = this.getValue(bestAction, context);
    
    for (let i = 1; i < actions.length; i++) {
      const action = actions[i]!;
      const value = this.getValue(action, context);
      if (value > bestValue) {
        bestValue = value;
        bestAction = action;
      }
    }
    
    return bestAction;
  }
  
  /**
   * Choose an action using epsilon-greedy (exploration vs exploitation).
   */
  chooseEpsilonGreedy(actions: string[], context: string, epsilon: number = 0.1): string {
    // Explore with probability epsilon
    if (Math.random() < epsilon) {
      return actions[Math.floor(Math.random() * actions.length)]!;
    }
    
    // Exploit: choose best known action
    return this.chooseBest(actions, context) || actions[0]!;
  }
  
  /**
   * Get all learned values for a context.
   */
  getContextValues(context: string): Array<{ action: string; value: number }> {
    const results: Array<{ action: string; value: number }> = [];
    
    for (const [key, value] of this.qValues.entries()) {
      if (key.includes(`::${context}`) || key.endsWith(`::${context}`)) {
        const action = key.split('::')[0]!;
        results.push({ action, value: value.averageReward });
      }
    }
    
    return results.sort((a, b) => b.value - a.value);
  }
  
  /**
   * Get the most successful actions overall.
   */
  getTopActions(limit: number = 10): Array<{ action: string; value: number; visits: number }> {
    const results: Array<{ action: string; value: number; visits: number }> = [];
    
    for (const [key, value] of this.qValues.entries()) {
      const action = key.split('::')[0]!;
      results.push({
        action,
        value: value.averageReward,
        visits: value.visitCount,
      });
    }
    
    // Aggregate by action
    const aggregated = new Map<string, { totalValue: number; totalVisits: number }>();
    for (const r of results) {
      const existing = aggregated.get(r.action) || { totalValue: 0, totalVisits: 0 };
      existing.totalValue += r.value * r.visits;
      existing.totalVisits += r.visits;
      aggregated.set(r.action, existing);
    }
    
    const final = Array.from(aggregated.entries()).map(([action, data]) => ({
      action,
      value: data.totalVisits > 0 ? data.totalValue / data.totalVisits : 0,
      visits: data.totalVisits,
    }));
    
    return final.sort((a, b) => b.value - a.value).slice(0, limit);
  }
  
  /**
   * Reset Q-values for a specific context (e.g., when site changes).
   */
  resetContext(context: string): void {
    for (const key of Array.from(this.qValues.keys())) {
      if (key.includes(`::${context}`)) {
        this.qValues.delete(key);
      }
    }
    this.save();
  }
  
  /**
   * Decay old values (for adaptation to changing environments).
   */
  decay(factor: number = 0.99): void {
    for (const [key, value] of this.qValues.entries()) {
      value.averageReward *= factor;
      value.totalReward *= factor;
    }
    this.save();
  }
  
  /**
   * Export all Q-values.
   */
  export(): Record<string, ActionValue> {
    return Object.fromEntries(this.qValues);
  }
  
  /**
   * Import Q-values.
   */
  import(values: Record<string, ActionValue>): void {
    for (const [key, value] of Object.entries(values)) {
      this.qValues.set(key, value);
    }
    this.save();
  }
  
  /**
   * Clear all learned values.
   */
  clear(): void {
    this.qValues.clear();
    this.save();
  }
  
  private makeKey(action: string, context: string): string {
    return `${action}::${context}`;
  }
  
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const values: Record<string, ActionValue> = JSON.parse(data);
        for (const [key, value] of Object.entries(values)) {
          this.qValues.set(key, value);
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
      const data = Object.fromEntries(this.qValues);
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore save errors
    }
  }
}
