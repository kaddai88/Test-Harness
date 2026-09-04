/**
 * Experience Retriever — finds relevant past experiences for current context.
 * 
 * When starting a new session or facing a new situation:
 * 1. Identify key characteristics of the current context
 * 2. Search episodic memory for similar situations
 * 3. Rank by relevance and recency
 * 4. Format for injection into prompts
 * 
 * This enables "learning from past mistakes" and "building on past successes".
 */

import type { EpisodicMemory, Episode } from "../memory/episodic-memory.js";
import type { SemanticMemory, SemanticKnowledge } from "../memory/semantic-memory.js";
import type { ProceduralMemory, Procedure } from "../memory/procedural-memory.js";

export interface RetrievedExperience {
  // Episodes (specific past experiences)
  relevantEpisodes: Episode[];
  
  // Knowledge (general knowledge)
  relevantKnowledge: SemanticKnowledge[];
  
  // Procedures (learned skills)
  relevantProcedures: Procedure[];
  
  // Summary
  summary: string;
}

export class ExperienceRetriever {
  private episodicMemory: EpisodicMemory;
  private semanticMemory: SemanticMemory;
  private proceduralMemory: ProceduralMemory;
  
  constructor(
    episodicMemory: EpisodicMemory,
    semanticMemory: SemanticMemory,
    proceduralMemory: ProceduralMemory
  ) {
    this.episodicMemory = episodicMemory;
    this.semanticMemory = semanticMemory;
    this.proceduralMemory = proceduralMemory;
  }
  
  /**
   * Retrieve relevant experiences for a new session.
   */
  retrieveForSession(targetUrl: string, testType?: string): RetrievedExperience {
    // Get relevant episodes
    const relevantEpisodes = this.findRelevantEpisodes(targetUrl, testType);
    
    // Get relevant knowledge
    const relevantKnowledge = this.semanticMemory.getSiteKnowledge(targetUrl, 10);
    
    // Get relevant procedures
    const relevantProcedures = this.findRelevantProcedures(targetUrl, testType);
    
    // Generate summary
    const summary = this.generateSummary(relevantEpisodes, relevantKnowledge, relevantProcedures);
    
    return {
      relevantEpisodes,
      relevantKnowledge,
      relevantProcedures,
      summary,
    };
  }
  
  /**
   * Retrieve experiences relevant to current situation.
   */
  retrieveForSituation(
    currentUrl: string,
    currentAction: string,
    recentFailures: Array<{ tool: string; error: string }>
  ): RetrievedExperience {
    // Get episodes from same site
    const siteEpisodes = this.episodicMemory.getSiteEpisodes(currentUrl, 20);
    
    // Get episodes with similar actions
    const actionEpisodes = this.episodicMemory.search({
      tags: [currentAction],
      limit: 10,
    });
    
    // Get episodes about failures
    const failureEpisodes = recentFailures.length > 0 
      ? this.episodicMemory.search({
          outcome: 'failure',
          limit: 10,
        })
      : [];
    
    // Combine and deduplicate
    const allEpisodes = this.deduplicateEpisodes([
      ...siteEpisodes,
      ...actionEpisodes,
      ...failureEpisodes,
    ]);
    
    // Get relevant knowledge
    const relevantKnowledge = this.semanticMemory.getSiteKnowledge(currentUrl, 10);
    
    // Get recovery procedures if there are failures
    const relevantProcedures = recentFailures.length > 0
      ? this.proceduralMemory.getRecoveryProcedures(recentFailures[0]!.tool)
      : [];
    
    // Generate summary
    const summary = this.generateSummary(allEpisodes, relevantKnowledge, relevantProcedures);
    
    return {
      relevantEpisodes: allEpisodes.slice(0, 10),
      relevantKnowledge,
      relevantProcedures,
      summary,
    };
  }
  
  /**
   * Find episodes relevant to a new session.
   */
  private findRelevantEpisodes(targetUrl: string, testType?: string): Episode[] {
    const episodes: Episode[] = [];
    
    // Get recent episodes from same site
    const siteEpisodes = this.episodicMemory.getSiteEpisodes(targetUrl, 20);
    episodes.push(...siteEpisodes);
    
    // Get successful sessions (for learning what works)
    const successfulSessions = this.episodicMemory.search({
      outcome: 'success',
      limit: 5,
    });
    episodes.push(...successfulSessions);
    
    // Get bug findings (for knowing what to look for)
    const bugFindings = this.episodicMemory.getByType('bug_found', 10);
    episodes.push(...bugFindings);
    
    // Get recovery successes (for knowing how to recover)
    const recoveries = this.episodicMemory.getByType('recovery_success', 5);
    episodes.push(...recoveries);
    
    return this.deduplicateEpisodes(episodes).slice(0, 15);
  }
  
  /**
   * Find procedures relevant to a session.
   */
  private findRelevantProcedures(targetUrl: string, testType?: string): Procedure[] {
    const procedures: Procedure[] = [];
    
    // Get login procedures for this site
    const loginProcs = this.proceduralMemory.getLoginProcedures(targetUrl);
    procedures.push(...loginProcs);
    
    // Get general testing strategies
    const strategies = this.proceduralMemory.search({
      type: 'testing_strategy',
      limit: 5,
    });
    procedures.push(...strategies);
    
    // Get recovery procedures
    const recoveryProcs = this.proceduralMemory.search({
      type: 'recovery_procedure',
      limit: 5,
    });
    procedures.push(...recoveryProcs);
    
    return this.deduplicateProcedures(procedures).slice(0, 10);
  }
  
  /**
   * Generate a summary of retrieved experiences.
   */
  private generateSummary(
    episodes: Episode[],
    knowledge: SemanticKnowledge[],
    procedures: Procedure[]
  ): string {
    const lines: string[] = [];
    
    // Episode summary
    if (episodes.length > 0) {
      const successCount = episodes.filter(e => e.outcome === 'success').length;
      const failureCount = episodes.filter(e => e.outcome === 'failure').length;
      const bugCount = episodes.filter(e => e.type === 'bug_found').length;
      
      lines.push(`**历史经验**: ${episodes.length} 个相关 session`);
      if (successCount > 0) lines.push(`- 成功: ${successCount} 次`);
      if (failureCount > 0) lines.push(`- 失败: ${failureCount} 次`);
      if (bugCount > 0) lines.push(`- 发现 bug: ${bugCount} 个`);
      lines.push('');
    }
    
    // Knowledge summary
    if (knowledge.length > 0) {
      lines.push(`**站点知识**: ${knowledge.length} 条相关知识`);
      for (const k of knowledge.slice(0, 3)) {
        lines.push(`- ${k.title}`);
      }
      lines.push('');
    }
    
    // Procedure summary
    if (procedures.length > 0) {
      lines.push(`**可用技能**: ${procedures.length} 个相关操作序列`);
      for (const p of procedures.slice(0, 3)) {
        lines.push(`- ${p.name} (成功率: ${(p.successRate * 100).toFixed(0)}%)`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  /**
   * Deduplicate episodes by ID.
   */
  private deduplicateEpisodes(episodes: Episode[]): Episode[] {
    const seen = new Set<string>();
    return episodes.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }
  
  /**
   * Deduplicate procedures by ID.
   */
  private deduplicateProcedures(procedures: Procedure[]): Procedure[] {
    const seen = new Set<string>();
    return procedures.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }
  
  /**
   * Format retrieved experiences for prompt injection.
   */
  formatForPrompt(experiences: RetrievedExperience): string {
    const lines: string[] = [];
    
    lines.push('## 历史经验与知识');
    lines.push('');
    lines.push(experiences.summary);
    
    // Add specific tips from episodes
    if (experiences.relevantEpisodes.length > 0) {
      lines.push('### 经验教训');
      for (const ep of experiences.relevantEpisodes.slice(0, 3)) {
        if (ep.outcome === 'success') {
          lines.push(`- ✅ ${ep.description}`);
        } else if (ep.outcome === 'failure') {
          lines.push(`- ❌ ${ep.description}`);
        }
      }
      lines.push('');
    }
    
    // Add knowledge tips
    if (experiences.relevantKnowledge.length > 0) {
      lines.push('### 站点知识');
      for (const k of experiences.relevantKnowledge.slice(0, 3)) {
        lines.push(`- 💡 ${k.description}`);
      }
      lines.push('');
    }
    
    // Add procedure suggestions
    if (experiences.relevantProcedures.length > 0) {
      lines.push('### 推荐操作');
      for (const p of experiences.relevantProcedures.slice(0, 2)) {
        lines.push(`- 🔧 ${p.name}: ${p.description}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
}
