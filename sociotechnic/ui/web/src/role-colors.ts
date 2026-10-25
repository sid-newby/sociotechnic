export type RoleFamily = "plan" | "design" | "build" | "review" | "approve";

const FAMILY_TOKEN: Record<RoleFamily, string> = { plan: "--chart-1", build: "--chart-2", review: "--chart-3", design: "--chart-4", approve: "--chart-5" };

const ROLE_FAMILY: Record<string, RoleFamily> = {
  "sociotechnic-planner": "plan",
  "sociotechnic-researcher": "plan",
  "sociotechnic-designer": "design",
  "sociotechnic-builder": "build",
  "sociotechnic-builder-lite": "build",
  "sociotechnic-sweeper": "build",
  "sociotechnic-comment-cleaner": "build",
  "sociotechnic-comment-sicko": "build",
  "sociotechnic-reviewer-code": "review",
  "sociotechnic-reviewer-ux": "review",
  "sociotechnic-reviewer-ui": "review",
  "sociotechnic-reviewer-security": "review",
  "sociotechnic-conformance": "review",
  "sociotechnic-approver": "approve",
};

const STEP_FAMILY: Record<string, RoleFamily> = { plan: "plan", research: "plan", design: "design", build: "build", review: "review", approve: "approve" };

export function roleFamily(template: string, step?: string | null): RoleFamily | null {
  return ROLE_FAMILY[template] ?? (step ? STEP_FAMILY[step] ?? null : null);
}

export function familyColor(family: RoleFamily | null): string {
  return family ? `var(${FAMILY_TOKEN[family]})` : "var(--muted-foreground)";
}

export function roleColor(template: string, step?: string | null): string {
  return familyColor(roleFamily(template, step));
}
