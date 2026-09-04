/**
 * Pattern Recognizer — discovers recurring patterns in experiences.
 * 
 * Analyzes episodic memories to find:
 * - Common error patterns (what errors occur where)
 * - Success patterns (what actions tend to work together)
 * - Site patterns (characteristics of different site types)
 * - Temporal patterns (when certain issues occur)
 * 
 * This enables the system to predict and prevent issues.
 */

export type PatternType = 
  | 'error_pattern'       // Recurring error scenarios
  | 'success_pattern'     // Successful action sequences
  | 'site_pattern'        // Site characteristics
  | 'temporal_pattern'    // Time-based patterns
  | 'correlation';        // Things that tend to happen together

export interface Pattern {
  id: string;
  type: PatternType;
  timestamp: number;
  
  // What the pattern is
  name: string;
  description: string;
  
  // Pattern details
  indicators: string[]; // Signs that this pattern is occurring
  frequency: number; // How often this pattern occurs
  confidence: number; // 0-1, how confident we are in this pattern
  
  // Context
  targetUrl?: string;
  siteCategory?: string;
  
  // Outcomes
  typicalOutcome: 'success' | 'failure' | 'mixed' | 'neutral';
  prevention?: string; // How to avoid this pattern
  recovery?: string; // How to recover if this pattern occurs
  
  // Evidence
  sampleEpisodes: string[]; // Episode IDs that support this pattern
  sampleSize: number;
  
  // Usage
  lastDetected: number;
  detectionCount: number;
  
  // Metadata
  tags: string[];
}

export class PatternRecognizer {
  private patterns: Map<string, Pattern> = new Map();
  private storagePath: string;
  
  constructor(storagePath: string = '.cognition/patterns.json') {
    this.storagePath = storagePath;
    this.load();
  }
  
  /**
   * Store a new pattern.
   */
  store(pattern: Omit<Pattern, 'id' | 'lastDetected' | 'detectionCount'>): string {
    const id = this.generateId();
    const full: Pattern = {
      ...pattern,
      id,
      lastDetected: Date.now(),
      detectionCount: 0,
    };
    
    this.patterns.set(id, full);
    this.save();
    
    return id;
  }
  
  /**
   * Get a specific pattern.
   */
  get(id: string): Pattern | undefined {
    return this.patterns.get(id);
  }
  
  /**
   * Search for patterns matching criteria.
   */
  search(criteria: {
    type?: PatternType;
    targetUrl?: string;
    indicators?: string[];
    minConfidence?: number;
    limit?: number;
  }): Pattern[] {
    let results = Array.from(this.patterns.values());
    
    // Filter by type
    if (criteria.type) {
      results = results.filter(p => p.type === criteria.type);
    }
    
    // Filter by URL
    if (criteria.targetUrl) {
      results = results.filter(p => 
        !p.targetUrl || p.targetUrl === criteria.targetUrl
      );
    }
    
    // Filter by indicators (any match)
    if (criteria.indicators && criteria.indicators.length > 0) {
      results = results.filter(p => 
        criteria.indicators!.some(ind => 
          p.indicators.some(pi => pi.toLowerCase().includes(ind.toLowerCase()))
        )
      );
    }
    
    // Filter by confidence
    if (criteria.minConfidence !== undefined) {
      results = results.filter(p => p.confidence >= criteria.minConfidence!);
    }
    
    // Sort by confidence and frequency
    results.sort((a, b) => {
      const scoreA = a.confidence * 0.6 + Math.min(a.frequency, 1) * 0.4;
      const scoreB = b.confidence * 0.6 + Math.min(b.frequency, 1) * 0.4;
      return scoreB - scoreA;
    });
    
    // Limit
    if (criteria.limit) {
      results = results.slice(0, criteria.limit);
    }
    
    return results;
  }
  
  /**
   * Detect if current situation matches any known patterns.
   */
  detect(indicators: string[], targetUrl?: string): Pattern[] {
    const matches: Pattern[] = [];
    
    for (const pattern of this.patterns.values()) {
      // Check URL match
      if (pattern.targetUrl && targetUrl && pattern.targetUrl !== targetUrl) {
        continue;
      }
      
      // Check indicator overlap
      const matchingIndicators = indicators.filter(ind => 
        pattern.indicators.some(pi => 
          pi.toLowerCase().includes(ind.toLowerCase()) ||
          ind.toLowerCase().includes(pi.toLowerCase())
        )
      );
      
      if (matchingIndicators.length >= 2 || 
          (matchingIndicators.length === 1 && pattern.confidence > 0.8)) {
        matches.push(pattern);
        
        // Update detection stats
        pattern.lastDetected = Date.now();
        pattern.detectionCount++;
      }
    }
    
    this.save();
    
    // Sort by confidence
    return matches.sort((a, b) => b.confidence - a.confidence);
  }
  
  /**
   * Get error patterns for a site.
   */
  getErrorPatterns(targetUrl?: string, limit: number = 10): Pattern[] {
    return this.search({ type: 'error_pattern', targetUrl, limit });
  }
  
  /**
   * Get success patterns.
   */
  getSuccessPatterns(targetUrl?: string, limit: number = 10): Pattern[] {
    return this.search({ type: 'success_pattern', targetUrl, limit });
  }
  
  /**
   * Update a pattern.
   */
  update(id: string, updates: Partial<Pattern>): boolean {
    const pattern = this.patterns.get(id);
    if (!pattern) return false;
    
    Object.assign(pattern, updates);
    this.save();
    return true;
  }
  
  /**
   * Reinforce a pattern (increase confidence).
   */
  reinforce(id: string, amount: number = 0.1): boolean {
    const pattern = this.patterns.get(id);
    if (!pattern) return false;
    
    pattern.confidence = Math.min(1, pattern.confidence + amount);
    pattern.frequency++;
    pattern.lastDetected = Date.now();
    this.save();
    return true;
  }
  
  /**
   * Delete a pattern.
   */
  delete(id: string): boolean {
    const deleted = this.patterns.delete(id);
    if (deleted) this.save();
    return deleted;
  }
  
  /**
   * Get total pattern count.
   */
  count(): number {
    return this.patterns.size;
  }
  
  /**
   * Clear all patterns.
   */
  clear(): void {
    this.patterns.clear();
    this.save();
  }
  
  /**
   * Export all patterns.
   */
  export(): Pattern[] {
    return Array.from(this.patterns.values());
  }
  
  /**
   * Import patterns.
   */
  import(patterns: Pattern[]): void {
    for (const pattern of patterns) {
      this.patterns.set(pattern.id, pattern);
    }
    this.save();
  }
  
  private generateId(): string {
    return `pat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const patterns: Pattern[] = JSON.parse(data);
        for (const pattern of patterns) {
          this.patterns.set(pattern.id, pattern);
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
      const data = Array.from(this.patterns.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore save errors
    }
  }
}
