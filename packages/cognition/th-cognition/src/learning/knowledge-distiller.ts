/**
 * Knowledge Distiller — extracts general knowledge from specific experiences.
 * 
 * Analyzes multiple episodic memories to derive semantic knowledge:
 * - "After 3 failed login attempts, I know that this site requires..."
 * - "Forms with these characteristics usually have..."
 * - "When I see this error pattern, it typically means..."
 * 
 * This is the "learning" component: turning experience into wisdom.
 */

import type { Episode } from "../memory/episodic-memory.js";
import type { SemanticKnowledge, KnowledgeType } from "../memory/semantic-memory.js";

export interface DistilledKnowledge {
  type: KnowledgeType;
  title: string;
  description: string;
  content: Record<string, unknown>;
  confidence: number;
  sourceEpisodes: string[];
}

export class KnowledgeDistiller {
  
  /**
   * Distill knowledge from a collection of episodes.
   */
  distill(episodes: Episode[]): DistilledKnowledge[] {
    const results: DistilledKnowledge[] = [];
    
    // Group episodes by type and analyze
    const sessionSummaries = episodes.filter(e => e.type === 'session_summary');
    const bugFindings = episodes.filter(e => e.type === 'bug_found');
    const recoveries = episodes.filter(e => e.type === 'recovery_success');
    
    // Distill session patterns
    if (sessionSummaries.length >= 2) {
      const distilled = this.distillSessionPatterns(sessionSummaries);
      results.push(...distilled);
    }
    
    // Distill bug patterns
    if (bugFindings.length >= 2) {
      const distilled = this.distillBugPatterns(bugFindings);
      results.push(...distilled);
    }
    
    // Distill recovery strategies
    if (recoveries.length >= 1) {
      const distilled = this.distillRecoveryStrategies(recoveries);
      results.push(...distilled);
    }
    
    // Distill site characteristics
    const siteEpisodes = episodes.filter(e => e.targetUrl);
    if (siteEpisodes.length >= 3) {
      const distilled = this.distillSiteCharacteristics(siteEpisodes);
      results.push(...distilled);
    }
    
    return results;
  }
  
  /**
   * Distill patterns from session summaries.
   */
  private distillSessionPatterns(summaries: Episode[]): DistilledKnowledge[] {
    const results: DistilledKnowledge[] = [];
    
    // Analyze success factors
    const successful = summaries.filter(e => e.outcome === 'success');
    const failed = summaries.filter(e => e.outcome === 'failure');
    
    if (successful.length >= 2) {
      // Find common actions in successful sessions
      const commonActions = this.findCommonActions(successful);
      if (commonActions.length > 0) {
        results.push({
          type: 'testing_pattern',
          title: `Successful testing pattern: ${commonActions.join(', ')}`,
          description: `Sessions using ${commonActions.join(' + ')} tend to succeed`,
          content: {
            actions: commonActions,
            successRate: successful.length / summaries.length,
          },
          confidence: Math.min(1, successful.length / 5),
          sourceEpisodes: successful.map(e => e.id),
        });
      }
    }
    
    if (failed.length >= 2) {
      // Find common failure points
      const failurePoints = this.findCommonFailurePoints(failed);
      if (failurePoints.length > 0) {
        results.push({
          type: 'bug_pattern',
          title: `Common failure: ${failurePoints[0]?.tool || 'unknown'}`,
          description: `Tests often fail at ${failurePoints[0]?.tool}`,
          content: {
            failurePoints,
            failureRate: failed.length / summaries.length,
          },
          confidence: Math.min(1, failed.length / 5),
          sourceEpisodes: failed.map(e => e.id),
        });
      }
    }
    
    return results;
  }
  
  /**
   * Distill patterns from bug findings.
   */
  private distillBugPatterns(bugs: Episode[]): DistilledKnowledge[] {
    const results: DistilledKnowledge[] = [];
    
    // Group by finding type
    const bySeverity = new Map<string, Episode[]>();
    for (const bug of bugs) {
      const severity = bug.findings?.[0]?.severity || 'unknown';
      const group = bySeverity.get(severity) || [];
      group.push(bug);
      bySeverity.set(severity, group);
    }
    
    // Create patterns for common severities
    for (const [severity, group] of bySeverity.entries()) {
      if (group.length >= 2) {
        results.push({
          type: 'bug_pattern',
          title: `${severity} bugs found in similar contexts`,
          description: `Found ${group.length} ${severity} bugs with similar patterns`,
          content: {
            severity,
            commonUrls: [...new Set(group.map(g => g.pageUrl).filter(Boolean))],
            commonTitles: group.map(g => g.findings?.[0]?.title).filter(Boolean),
          },
          confidence: Math.min(1, group.length / 3),
          sourceEpisodes: group.map(e => e.id),
        });
      }
    }
    
    return results;
  }
  
  /**
   * Distill recovery strategies from successful recoveries.
   */
  private distillRecoveryStrategies(recoveries: Episode[]): DistilledKnowledge[] {
    const results: DistilledKnowledge[] = [];
    
    for (const recovery of recoveries) {
      if (recovery.actions.length >= 2) {
        // Extract the recovery sequence
        const errorAction = recovery.actions[0];
        const recoveryActions = recovery.actions.slice(1);
        
        results.push({
          type: 'recovery_strategy',
          title: `Recovery from ${errorAction?.tool || 'error'}`,
          description: `When ${errorAction?.tool} fails, try: ${recoveryActions.map(a => a.tool).join(' → ')}`,
          content: {
            errorType: errorAction?.tool || 'unknown',
            recoverySteps: recoveryActions.map(a => ({
              tool: a.tool,
              input: a.input,
            })),
            successRate: recovery.outcome === 'success' ? 1 : 0.5,
          },
          confidence: 0.7,
          sourceEpisodes: [recovery.id],
        });
      }
    }
    
    return results;
  }
  
  /**
   * Distill site characteristics from site-specific episodes.
   */
  private distillSiteCharacteristics(episodes: Episode[]): DistilledKnowledge[] {
    const results: DistilledKnowledge[] = [];
    
    // Group by URL
    const byUrl = new Map<string, Episode[]>();
    for (const ep of episodes) {
      if (ep.targetUrl) {
        const group = byUrl.get(ep.targetUrl) || [];
        group.push(ep);
        byUrl.set(ep.targetUrl, group);
      }
    }
    
    // Analyze each site
    for (const [url, group] of byUrl.entries()) {
      if (group.length >= 3) {
        // Find common tools used
        const toolUsage = new Map<string, number>();
        for (const ep of group) {
          for (const action of ep.actions) {
            toolUsage.set(action.tool, (toolUsage.get(action.tool) || 0) + 1);
          }
        }
        
        const frequentTools = Array.from(toolUsage.entries())
          .filter(([, count]) => count >= group.length * 0.5)
          .map(([tool]) => tool);
        
        if (frequentTools.length > 0) {
          results.push({
            type: 'site_characteristic',
            title: `Site characteristics: ${url}`,
            description: `This site typically requires: ${frequentTools.join(', ')}`,
            content: {
              url,
              frequentTools,
              sessionCount: group.length,
              successRate: group.filter(g => g.outcome === 'success').length / group.length,
            },
            confidence: Math.min(1, group.length / 5),
            sourceEpisodes: group.map(e => e.id),
          });
        }
      }
    }
    
    return results;
  }
  
  /**
   * Find common actions across episodes.
   */
  private findCommonActions(episodes: Episode[]): string[] {
    const toolCounts = new Map<string, number>();
    
    for (const ep of episodes) {
      const tools = new Set(ep.actions.map(a => a.tool));
      for (const tool of tools) {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      }
    }
    
    // Return tools used in >50% of episodes
    const threshold = episodes.length * 0.5;
    return Array.from(toolCounts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([tool]) => tool)
      .sort((a, b) => (toolCounts.get(b) || 0) - (toolCounts.get(a) || 0));
  }
  
  /**
   * Find common failure points across episodes.
   */
  private findCommonFailurePoints(episodes: Episode[]): Array<{ tool: string; count: number }> {
    const failureCounts = new Map<string, number>();
    
    for (const ep of episodes) {
      for (const action of ep.actions) {
        if (!action.success) {
          failureCounts.set(action.tool, (failureCounts.get(action.tool) || 0) + 1);
        }
      }
    }
    
    return Array.from(failureCounts.entries())
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count);
  }
}
