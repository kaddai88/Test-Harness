/**
 * Terminal output — colored, structured output for CLI.
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";
const WHITE = "\x1b[37m";

export const terminal = {
  banner(): void {
    console.log(
      `${BOLD}${CYAN}` +
        "╔══════════════════════════════════════════╗\n" +
        "║     TestHarness — AI Website Analyzer    ║\n" +
        "╚══════════════════════════════════════════╝" +
        RESET
    );
    console.log();
  },

  info(msg: string): void {
    console.log(`${BLUE}ℹ${RESET} ${msg}`);
  },

  success(msg: string): void {
    console.log(`${GREEN}✓${RESET} ${msg}`);
  },

  warn(msg: string): void {
    console.log(`${YELLOW}⚠${RESET} ${msg}`);
  },

  error(msg: string): void {
    console.log(`${RED}✗${RESET} ${msg}`);
  },

  dim(msg: string): void {
    console.log(`${GRAY}${msg}${RESET}`);
  },

  header(msg: string): void {
    console.log(`\n${BOLD}${WHITE}${msg}${RESET}`);
    console.log(`${GRAY}${"─".repeat(50)}${RESET}`);
  },

  severity(sev: string): string {
    switch (sev) {
      case "critical":
        return `${RED}${BOLD}CRIT${RESET}`;
      case "high":
        return `${RED}HIGH${RESET}`;
      case "medium":
        return `${YELLOW}MED ${RESET}`;
      case "low":
        return `${BLUE}LOW ${RESET}`;
      case "info":
        return `${GRAY}INFO${RESET}`;
      default:
        return sev;
    }
  },

  score(score: number): string {
    let color: string;
    let label: string;
    if (score >= 90) {
      color = GREEN;
      label = "Excellent";
    } else if (score >= 70) {
      color = GREEN;
      label = "Good";
    } else if (score >= 50) {
      color = YELLOW;
      label = "Fair";
    } else if (score >= 30) {
      color = RED;
      label = "Poor";
    } else {
      color = RED;
      label = "Critical";
    }
    return `${color}${BOLD}${score}/100${RESET} ${GRAY}(${label})${RESET}`;
  },

  finding(title: string, severity: string, url?: string): void {
    console.log(
      `  ${terminal.severity(severity)} ${BOLD}${title}${RESET}`
    );
    if (url) {
      console.log(`         ${GRAY}→ ${url}${RESET}`);
    }
  },

  /**
   * Streaming progress — shows live LLM output in terminal.
   * Uses cursor control to update in place.
   */
  streamLine(text: string, toolCalls: number): void {
    // Show the last line of the text, truncated
    const lines = text.split("\n").filter((l) => l.trim());
    const lastLine = lines[lines.length - 1] ?? "";
    const truncated =
      lastLine.length > 70
        ? lastLine.slice(0, 67) + "..."
        : lastLine;
    const toolInfo = toolCalls > 0 ? ` ${CYAN}[${toolCalls} tools]${RESET}` : "";
    process.stdout.write(
      `\r  ${GRAY}⟫${RESET} ${truncated}${toolInfo}\x1b[K`
    );
  },

  /** Clear the streaming line */
  streamClear(): void {
    process.stdout.write("\r\x1b[K");
  },
};
