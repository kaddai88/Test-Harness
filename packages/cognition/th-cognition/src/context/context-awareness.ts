/**
 * Context Awareness — understands the current situation with historical perspective.
 * 
 * Combines:
 * - Current page state (from snapshot)
 * - Recent actions and outcomes
 * - Relevant past experiences
 * - Known patterns
 * 
 * Provides a rich context for decision making.
 */

import type { WorkingMemory } from "../memory/working-memory.js";
import type { EpisodicMemory, Episode } from "../memory/episodic-memory.js";
import type { SemanticMemory, SemanticKnowledge } from "../memory/semantic-memory.js";
import type { ProceduralMemory, Procedure } from "../memory/procedural-memory.js";
import type { PatternRecognizer, Pattern } from "../learning/pattern-recognizer.js";

export interface ContextState {
  // Current situation
  currentUrl: string;
  pageTitle: string;
  pageSnapshot: string;
  
  // Recent history
  recentActions: Array<{
    tool: string;
    success: boolean;
    timestamp: number;
  }>;
  
  // Active goals
  activeGoals: string[];
  
  // Detected patterns
  detectedPatterns: Pattern[];
  
  // Relevant knowledge
  relevantKnowledge: SemanticKnowledge[];
  
  // Suggested procedures
  suggestedProcedures: Procedure[];
  
  // Overall assessment
  assessment: 'on_track' | 'stuck' | 'lost' | 'blocked';
  confidence: number;
}

export class ContextAwareness {
  private workingMemory: WorkingMemory;
  private episodicMemory: EpisodicMemory;
  private semanticMemory: SemanticMemory;
  private proceduralMemory: ProceduralMemory;
  private patternRecognizer: PatternRecognizer;
  
  constructor(
    workingMemory: WorkingMemory,
    episodicMemory: EpisodicMemory,
    semanticMemory: SemanticMemory,
    proceduralMemory: ProceduralMemory,
    patternRecognizer: PatternRecognizer
  ) {
    this.workingMemory = workingMemory;
    this.episodicMemory = episodicMemory;
    this.semanticMemory = semanticMemory;
    this.proceduralMemory = proceduralMemory;
    this.patternRecognizer = patternRecognizer;
  }
  
  /**
   * Build a complete context state for decision making.
   */
  buildContext(
    currentUrl: string,
    pageTitle: string,
    pageSnapshot: string,
    recentActions: Array<{ tool: string; success: boolean; timestamp: number }>
  ): ContextState {
    // Store current state in working memory
    this.workingMemory.set('currentUrl', currentUrl);
    this.workingMemory.set('pageTitle', pageTitle);
    this.workingMemory.set('pageSnapshot', pageSnapshot, 60000); // 1 min TTL
    
    // Detect patterns from current indicators
    const indicators = this.extractIndicators(pageSnapshot, recentActions);
    const detectedPatterns = this.patternRecognizer.detect(indicators, currentUrl);
    
    // Get relevant knowledge
    const relevantKnowledge = this.semanticMemory.getSiteKnowledge(currentUrl, 10);
    
    // Get suggested procedures
    const suggestedProcedures = this.getSuggestedProcedures(currentUrl, recentActions);
    
    // Assess situation
    const assessment = this.assessSituation(recentActions, detectedPatterns);
    
    // Get active goals from working memory
    const activeGoals = this.workingMemory.get<string[]>('activeGoals') || [];
    
    return {
      currentUrl,
      pageTitle,
      pageSnapshot,
      recentActions: recentActions.slice(-10), // Last 10 actions
      activeGoals,
      detectedPatterns,
      relevantKnowledge,
      suggestedProcedures,
      assessment: assessment.state,
      confidence: assessment.confidence,
    };
  }
  
  /**
   * Extract indicators from page state and recent actions.
   */
  private extractIndicators(
    pageSnapshot: string,
    recentActions: Array<{ tool: string; success: boolean; timestamp: number }>
  ): string[] {
    const indicators: string[] = [];
    
    // Extract from snapshot
    const snapshotLower = pageSnapshot.toLowerCase();
    
    // Check for error indicators
    if (snapshotLower.includes('error') || snapshotLower.includes('错误')) {
      indicators.push('error_visible');
    }
    if (snapshotLower.includes('dialog') || snapshotLower.includes('modal') || 
        snapshotLower.includes('弹窗')) {
      indicators.push('dialog_present');
    }
    if (snapshotLower.includes('loading') || snapshotLower.includes('加载中')) {
      indicators.push('loading');
    }
    if (snapshotLower.includes('login') || snapshotLower.includes('登录')) {
      indicators.push('login_page');
    }
    if (snapshotLower.includes('form') || snapshotLower.includes('表单')) {
      indicators.push('form_present');
    }
    
    // Extract from recent actions
    const recentFailures = recentActions.filter(a => !a.success);
    if (recentFailures.length >= 3) {
      indicators.push('multiple_failures');
    }
    
    const lastAction = recentActions[recentActions.length - 1];
    if (lastAction && !lastAction.success) {
      indicators.push('last_action_failed');
    }
    
    return indicators;
  }
  
  /**
   * Get suggested procedures based on context.
   */
  private getSuggestedProcedures(
    currentUrl: string,
    recentActions: Array<{ tool: string; success: boolean; timestamp: number }>
  ): Procedure[] {
    const suggestions: Procedure[] = [];
    
    // Check if we're on a login page
    const loginProcs = this.proceduralMemory.getLoginProcedures(currentUrl);
    if (loginProcs.length > 0) {
      suggestions.push(...loginProcs);
    }
    
    // Check for recovery procedures if there are failures
    const failures = recentActions.filter(a => !a.success);
    if (failures.length > 0) {
      const lastFailure = failures[failures.length - 1]!;
      const recoveryProcs = this.proceduralMemory.getRecoveryProcedures(lastFailure.tool);
      suggestions.push(...recoveryProcs);
    }
    
    return suggestions.slice(0, 5); // Top 5 suggestions
  }
  
  /**
   * Assess the current situation.
   */
  private assessSituation(
    recentActions: Array<{ tool: string; success: boolean; timestamp: number }>,
    detectedPatterns: Pattern[]
  ): { state: ContextState['assessment']; confidence: number } {
    if (recentActions.length === 0) {
      return { state: 'on_track', confidence: 0.5 };
    }
    
    // Count recent failures
    const recentFailures = recentActions.filter(a => !a.success).length;
    const failureRate = recentFailures / recentActions.length;
    
    // Check for blocking patterns
    const hasBlockingPattern = detectedPatterns.some(p => 
      p.indicators.includes('dialog_present') ||
      p.indicators.includes('error_visible')
    );
    
    // Assess state
    if (hasBlockingPattern) {
      return { state: 'blocked', confidence: 0.8 };
    }
    
    if (failureRate > 0.7 && recentActions.length >= 5) {
      return { state: 'stuck', confidence: 0.7 };
    }
    
    if (recentActions.length > 20 && failureRate > 0.5) {
      return { state: 'lost', confidence: 0.6 };
    }
    
    return { state: 'on_track', confidence: 1 - failureRate };
  }
  
  /**
   * Set active goals.
   */
  setGoals(goals: string[]): void {
    this.workingMemory.set('activeGoals', goals);
  }
  
  /**
   * Get active goals.
   */
  getGoals(): string[] {
    return this.workingMemory.get<string[]>('activeGoals') || [];
  }
  
  /**
   * Add a goal.
   */
  addGoal(goal: string): void {
    const goals = this.getGoals();
    if (!goals.includes(goal)) {
      goals.push(goal);
      this.workingMemory.set('activeGoals', goals);
    }
  }
  
  /**
   * Remove a goal.
   */
  removeGoal(goal: string): void {
    const goals = this.getGoals().filter(g => g !== goal);
    this.workingMemory.set('activeGoals', goals);
  }
  
  /**
   * Format context for prompt injection.
   */
  formatForPrompt(context: ContextState): string {
    const lines: string[] = [];
    
    lines.push('## 当前上下文');
    lines.push('');
    lines.push(`**URL**: ${context.currentUrl}`);
    lines.push(`**页面**: ${context.pageTitle}`);
    lines.push(`**状态评估**: ${this.translateAssessment(context.assessment)}`);
    lines.push('');
    
    // Active goals
    if (context.activeGoals.length > 0) {
      lines.push('**当前目标**:');
      for (const goal of context.activeGoals) {
        lines.push(`- ${goal}`);
      }
      lines.push('');
    }
    
    // Detected patterns
    if (context.detectedPatterns.length > 0) {
      lines.push('**检测到的模式**:');
      for (const pattern of context.detectedPatterns.slice(0, 3)) {
        lines.push(`- ${pattern.name}: ${pattern.description}`);
        if (pattern.prevention) {
          lines.push(`  - 预防: ${pattern.prevention}`);
        }
        if (pattern.recovery) {
          lines.push(`  - 恢复: ${pattern.recovery}`);
        }
      }
      lines.push('');
    }
    
    // Relevant knowledge
    if (context.relevantKnowledge.length > 0) {
      lines.push('**相关知识**:');
      for (const knowledge of context.relevantKnowledge.slice(0, 3)) {
        lines.push(`- ${knowledge.title}`);
      }
      lines.push('');
    }
    
    // Suggested procedures
    if (context.suggestedProcedures.length > 0) {
      lines.push('**建议的操作序列**:');
      for (const proc of context.suggestedProcedures.slice(0, 2)) {
        lines.push(`- ${proc.name}: ${proc.description}`);
        lines.push(`  - 成功率: ${(proc.successRate * 100).toFixed(0)}%`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  private translateAssessment(assessment: ContextState['assessment']): string {
    switch (assessment) {
      case 'on_track': return '正常进行';
      case 'stuck': return '卡住了';
      case 'lost': return '迷失方向';
      case 'blocked': return '被阻挡';
      default: return '未知';
    }
  }
}
