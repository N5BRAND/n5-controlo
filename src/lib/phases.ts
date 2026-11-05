// Fases (estágios) das tarefas do Pipeline, pela ordem em que aparecem no quadro.
// Os nomes visíveis estão em LABELS.phase (src/lib/format.ts).
export const PHASES = [
  "sprint_backlog", "in_progress", "paused",
  "homologation_review_beta", "code_review_beta", "ready4test_beta", "testing_beta", "validated_beta",
  "to_deploy_staging", "ready4test_staging", "testing_staging", "awaiting_fix_staging", "validated_staging",
  "ready4test_prod", "testing_prod",
  "done", "canceled",
] as const;

export type Phase = (typeof PHASES)[number];

/** Fase de uma tarefa nova. */
export const DEFAULT_PHASE: Phase = "sprint_backlog";

/** Fases fechadas: sem prazo a seguir, fora dos avisos. */
export const CLOSED_PHASES: readonly Phase[] = ["done", "canceled"];
export const isClosedPhase = (phase: string): boolean => (CLOSED_PHASES as readonly string[]).includes(phase);

/** Fases em que a tarefa está a ser trabalhada (nem à espera, nem parada, nem fechada). */
export const ACTIVE_PHASES: readonly Phase[] = PHASES.filter((p) => !["sprint_backlog", "paused", "done", "canceled"].includes(p));

// Regras de mudança de fase. Por agora o Pipeline é gerido à mão e nada bloqueia a mudança de estágio.
// Para voltar a exigir dono e critérios de aceitação, ou eventos de produto, põe aqui as fases em que passam a ser obrigatórios
// (por exemplo: PHASES.filter((p) => !["sprint_backlog", "paused", "canceled"].includes(p))).

/** Fases em que a tarefa tem de ter dono e critérios de aceitação. */
export const OWNER_REQUIRED_PHASES: readonly Phase[] = [];

/** Fases em que a tarefa tem de declarar os eventos de produto. */
export const EVENTS_REQUIRED_PHASES: readonly Phase[] = [];
