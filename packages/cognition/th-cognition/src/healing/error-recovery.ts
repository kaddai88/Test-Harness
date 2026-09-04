/**
 * Error Recovery — automatic recovery from errors using learned strategies.
 * 
 * When an error occurs:
 * 1. Classify the error type
 * 2. Look up known recovery strategies
 * 3. Suggest or apply the best strategy
 * 4. Learn from the outcome
 * 
 * This is the "self-healing" component of DSH.
 */

export type ErrorType = 
  | 'element_not_found'    // Can't find the target element
  | 'element_not_interactable' // Element exists but can't be clicked/typed
  | 'timeout'              // Action took too long
  | 'navigation_failed'    // Page navigation failed
  | 'validation_error'     // Form validation failed
  | 'authentication_error' // Login/auth failed
  | 'network_error'        // Network connectivity issue
  | 'dialog_blocked'       // Dialog/modal blocking interaction
  | 'unknown';             // Unknown error type

export interface RecoveryStrategy {
  id: string;
  errorType: ErrorType;
  description: string;
  
  // Recovery steps
  steps: Array<{
    action: string;
    input: Record<string, unknown>;
    condition?: string; // When to use this step
  }>;
  
  // Effectiveness
  successCount: number;
  failureCount: number;
  successRate: number;
  
  // Context
  applicableWhen: string[]; // Conditions where this strategy applies
  tags: string[];
}

export interface RecoveryResult {
  strategy: RecoveryStrategy;
  applied: boolean;
  success: boolean;
  message: string;
}

export class ErrorRecovery {
  private strategies: Map<string, RecoveryStrategy> = new Map();
  private storagePath: string;
  
  constructor(storagePath: string = '.cognition/recovery.json') {
    this.storagePath = storagePath;
    this.load();
    this.initializeDefaults();
  }
  
  /**
   * Classify an error based on error message and context.
   */
  classifyError(errorMessage: string, toolName: string): ErrorType {
    const msg = errorMessage.toLowerCase();
    
    // Element not found
    if (msg.includes('not found') || msg.includes('no element') || 
        msg.includes('找不到') || msg.includes('不存在')) {
      return 'element_not_found';
    }
    
    // Element not interactable
    if (msg.includes('not interactable') || msg.includes('cannot click') ||
        msg.includes('不可点击') || msg.includes('无法交互')) {
      return 'element_not_interactable';
    }
    
    // Timeout
    if (msg.includes('timeout') || msg.includes('timed out') ||
        msg.includes('超时')) {
      return 'timeout';
    }
    
    // Navigation failed
    if (msg.includes('navigation') || msg.includes('navigate') ||
        msg.includes('导航')) {
      return 'navigation_failed';
    }
    
    // Validation error
    if (msg.includes('validation') || msg.includes('invalid') ||
        msg.includes('验证') || msg.includes('无效')) {
      return 'validation_error';
    }
    
    // Authentication error
    if (msg.includes('auth') || msg.includes('login') || msg.includes('unauthorized') ||
        msg.includes('认证') || msg.includes('登录')) {
      return 'authentication_error';
    }
    
    // Network error
    if (msg.includes('network') || msg.includes('connection') || msg.includes('fetch') ||
        msg.includes('网络') || msg.includes('连接')) {
      return 'network_error';
    }
    
    // Dialog blocked
    if (msg.includes('dialog') || msg.includes('modal') || msg.includes('overlay') ||
        msg.includes('弹窗') || msg.includes('遮罩')) {
      return 'dialog_blocked';
    }
    
    return 'unknown';
  }
  
  /**
   * Get recovery strategies for an error type.
   */
  getStrategies(errorType: ErrorType, context?: string): RecoveryStrategy[] {
    let results = Array.from(this.strategies.values())
      .filter(s => s.errorType === errorType);
    
    // Filter by context if provided
    if (context) {
      results = results.filter(s => 
        s.applicableWhen.length === 0 ||
        s.applicableWhen.some(w => context.toLowerCase().includes(w.toLowerCase()))
      );
    }
    
    // Sort by success rate
    return results.sort((a, b) => b.successRate - a.successRate);
  }
  
  /**
   * Get the best recovery strategy for an error.
   */
  getBestStrategy(errorType: ErrorType, context?: string): RecoveryStrategy | undefined {
    const strategies = this.getStrategies(errorType, context);
    return strategies[0];
  }
  
  /**
   * Suggest recovery actions for an error.
   */
  suggestRecovery(errorMessage: string, toolName: string, context?: string): string[] {
    const errorType = this.classifyError(errorMessage, toolName);
    const strategy = this.getBestStrategy(errorType, context);
    
    if (!strategy) {
      return this.getDefaultSuggestions(errorType);
    }
    
    return strategy.steps.map(step => {
      const inputStr = Object.entries(step.input)
        .map(([k, v]) => `${k}="${v}"`)
        .join(', ');
      return `${step.action}(${inputStr})`;
    });
  }
  
  /**
   * Record the outcome of a recovery attempt.
   */
  recordOutcome(strategyId: string, success: boolean): boolean {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return false;
    
    if (success) {
      strategy.successCount++;
    } else {
      strategy.failureCount++;
    }
    
    const total = strategy.successCount + strategy.failureCount;
    strategy.successRate = total > 0 ? strategy.successCount / total : 0;
    
    this.save();
    return true;
  }
  
  /**
   * Add a new recovery strategy.
   */
  addStrategy(strategy: Omit<RecoveryStrategy, 'id' | 'successCount' | 'failureCount' | 'successRate'>): string {
    const id = this.generateId();
    const full: RecoveryStrategy = {
      ...strategy,
      id,
      successCount: 0,
      failureCount: 0,
      successRate: 0.5, // Start with neutral expectation
    };
    
    this.strategies.set(id, full);
    this.save();
    
    return id;
  }
  
  /**
   * Update a strategy.
   */
  updateStrategy(id: string, updates: Partial<RecoveryStrategy>): boolean {
    const strategy = this.strategies.get(id);
    if (!strategy) return false;
    
    Object.assign(strategy, updates);
    this.save();
    return true;
  }
  
  /**
   * Delete a strategy.
   */
  deleteStrategy(id: string): boolean {
    const deleted = this.strategies.delete(id);
    if (deleted) this.save();
    return deleted;
  }
  
  /**
   * Get all strategies.
   */
  getAllStrategies(): RecoveryStrategy[] {
    return Array.from(this.strategies.values());
  }
  
  /**
   * Clear all strategies.
   */
  clear(): void {
    this.strategies.clear();
    this.save();
  }
  
  private getDefaultSuggestions(errorType: ErrorType): string[] {
    switch (errorType) {
      case 'element_not_found':
        return [
          'browser_snapshot() — 重新获取页面快照',
          '检查元素是否在其他位置',
          '等待元素加载',
        ];
      case 'element_not_interactable':
        return [
          'browser_snapshot() — 检查元素状态',
          '尝试使用不同的交互方式',
          '检查是否有遮罩层',
        ];
      case 'timeout':
        return [
          '增加等待时间',
          '检查网络连接',
          '尝试刷新页面',
        ];
      case 'dialog_blocked':
        return [
          'browser_click() — 关闭弹窗',
          'browser_press_key("Escape") — 按 ESC 关闭',
          '检查是否有确认按钮',
        ];
      default:
        return [
          'browser_snapshot() — 重新观察页面',
          '分析错误信息',
          '尝试不同的方法',
        ];
    }
  }
  
  private initializeDefaults(): void {
    // Only initialize if empty
    if (this.strategies.size > 0) return;
    
    // Element not found strategies
    this.addStrategy({
      errorType: 'element_not_found',
      description: 'Re-observe and search for element',
      steps: [
        { action: 'browser_snapshot', input: {} },
        { action: 'browser_snapshot', input: {}, condition: 'if element still not found' },
      ],
      applicableWhen: [],
      tags: ['element', 'not_found'],
    });
    
    // Dialog blocked strategies
    this.addStrategy({
      errorType: 'dialog_blocked',
      description: 'Close dialog and retry',
      steps: [
        { action: 'browser_press_key', input: { key: 'Escape' } },
        { action: 'browser_snapshot', input: {} },
      ],
      applicableWhen: ['dialog', 'modal', 'popup'],
      tags: ['dialog', 'modal'],
    });
    
    // Timeout strategies
    this.addStrategy({
      errorType: 'timeout',
      description: 'Wait and retry',
      steps: [
        { action: 'browser_wait', input: { time: 2 } },
        { action: 'browser_snapshot', input: {} },
      ],
      applicableWhen: [],
      tags: ['timeout', 'wait'],
    });
    
    this.save();
  }
  
  private generateId(): string {
    return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const strategies: RecoveryStrategy[] = JSON.parse(data);
        for (const strategy of strategies) {
          this.strategies.set(strategy.id, strategy);
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
      const data = Array.from(this.strategies.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore save errors
    }
  }
}
