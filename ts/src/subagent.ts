/**
 * SubAgentSpawner — manages child agent spawning as a tool callable.
 * Supports spawn_agent and use_skill tools with recursive depth limiting.
 */

import type { TrustLevel } from "./types.js";
import type { AgentDefinition, SkillDefinition } from "./definitions.js";
import type { RunConfig } from "./agent.js";
import type { BaseLLM } from "./llm.js";

// --- Trust Resolution ---

const TRUST_ORDER: Record<TrustLevel, number> = {
  ask: 0,
  "auto-edit": 1,
  yolo: 2,
};

/**
 * Resolve effective trust level: child can never exceed parent.
 * If child is null, inherit parent.
 */
export function resolveTrust(
  parent: TrustLevel,
  child: TrustLevel | null,
): TrustLevel {
  if (child === null) {
    return parent;
  }
  const p = TRUST_ORDER[parent] ?? 0;
  const c = TRUST_ORDER[child] ?? 0;
  return c <= p ? child : parent;
}

// --- Spawn Result ---

export interface SpawnResult {
  final_response: string;
  stop_reason: string;
  turns: number;
}

// --- Skill Result ---

export interface SkillResult {
  skill: string;
  instructions: string;
}

// --- AgentFactory type ---

/** Factory function to create a child agent, avoiding circular imports. */
export type AgentFactory = (
  llm: BaseLLM,
  config: Partial<RunConfig>,
) => {
  tools: {
    getToolSchemas(): { name: string }[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  run(
    goal: string,
    context?: Record<string, unknown> | null,
    options?: {
      onApprove?: (
        toolName: string,
        description: string,
        args: Record<string, unknown>,
      ) => boolean;
    },
  ): Promise<{
    final_response: string;
    stop_reason: string;
    turns: unknown[];
  }>;
};

// --- SubAgentSpawner ---

export class SubAgentSpawner {
  private _parentConfig: RunConfig;
  private _parentLlm: BaseLLM;
  private _definitions: Map<string, AgentDefinition>;
  private _projectContext: Record<string, unknown>;
  private _agentFactory: AgentFactory;
  private _onApprove?:
    | ((
        toolName: string,
        description: string,
        args: Record<string, unknown>,
      ) => boolean)
    | undefined;

  constructor(
    parentConfig: RunConfig,
    parentLlm: BaseLLM,
    agentDefinitions: AgentDefinition[],
    projectContext?: Record<string, unknown>,
    agentFactory?: AgentFactory,
  ) {
    this._parentConfig = parentConfig;
    this._parentLlm = parentLlm;
    this._definitions = new Map(agentDefinitions.map((d) => [d.name, d]));
    this._projectContext = projectContext ?? {};
    this._agentFactory =
      agentFactory ??
      ((llm, config) => {
        // Default factory: lazy import to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { HarnessAgent } = require("./agent.js");
        return new HarnessAgent(llm, config);
      });
  }

  setApproveCallback(
    onApprove: (
      toolName: string,
      description: string,
      args: Record<string, unknown>,
    ) => boolean,
  ): void {
    this._onApprove = onApprove;
  }

  async call(arguments_: Record<string, unknown>): Promise<SpawnResult> {
    const goal = arguments_.goal;
    if (typeof goal !== "string" || !goal.trim()) {
      throw new Error("spawn_agent requires a non-empty 'goal'.");
    }

    const agentName = arguments_.agent as string | undefined;
    let definition: AgentDefinition | undefined;

    if (agentName) {
      definition = this._definitions.get(agentName);
      if (!definition) {
        const available =
          Array.from(this._definitions.keys()).join(", ") || "(none)";
        throw new Error(
          `Unknown agent '${agentName}'. Available: ${available}`,
        );
      }
    }

    const childConfig = this._buildChildConfig(definition, arguments_);
    const child = this._createChildAgent(childConfig, definition);

    const result = await child.run(goal, this._projectContext, {
      onApprove: this._onApprove,
    });

    return {
      final_response: result.final_response,
      stop_reason: result.stop_reason,
      turns: result.turns.length,
    };
  }

  private _buildChildConfig(
    definition: AgentDefinition | undefined,
    arguments_: Record<string, unknown>,
  ): RunConfig {
    const parent = this._parentConfig;
    const childTrust = definition?.trust_level ?? null;
    const effectiveTrust = resolveTrust(parent.trust_level, childTrust);

    let maxSteps = parent.max_steps;
    if (definition && definition.max_steps !== null) {
      maxSteps = definition.max_steps;
    }
    if (
      "max_steps" in arguments_ &&
      typeof arguments_.max_steps === "number"
    ) {
      maxSteps = arguments_.max_steps;
    }

    // Derive mode from agent type: explore/plan → read-only, general-purpose → execute
    const agentType = definition?.type ?? ((arguments_.type as string) || "general-purpose");
    const childMode = agentType === "explore" || agentType === "plan" ? "plan" : "execute";

    return {
      max_steps: maxSteps,
      log_dir: parent.log_dir,
      max_history_turns: parent.max_history_turns,
      schema_retry_limit: parent.schema_retry_limit,
      max_budget: parent.max_budget,
      max_failures: parent.max_failures,
      tool_retry_limit: parent.tool_retry_limit,
      snapshot_dir: parent.snapshot_dir,
      dangerous_tools: parent.dangerous_tools,
      goal_reached_token: parent.goal_reached_token,
      allowed_write_roots: parent.allowed_write_roots,
      project_root: parent.project_root,
      allow_bash: parent.allow_bash,
      max_tokens_budget: parent.max_tokens_budget,
      trust_level: effectiveTrust,
      permission_rules: parent.permission_rules,
      hooks: parent.hooks,
      mode: childMode,
      agent_depth: parent.agent_depth + 1,
    };
  }

  private _createChildAgent(
    childConfig: RunConfig,
    definition: AgentDefinition | undefined,
  ): ReturnType<AgentFactory> {
    const child = this._agentFactory(this._parentLlm, childConfig);

    // Apply tool whitelist if defined
    if (definition && definition.tools !== null) {
      const allowed = new Set(definition.tools);
      const schemas = child.tools.getToolSchemas();
      const allToolNames = schemas.map((s) => s.name);

      // Remove tools not in the whitelist
      for (const name of allToolNames) {
        if (!allowed.has(name)) {
          child.tools._tools.delete(name);
          child.tools._schemas.delete(name);
        }
      }
    }

    return child;
  }
}

// --- use_skill factory ---

export function createUseSkillCallable(
  skillDefinitions: SkillDefinition[],
): (arguments_: Record<string, unknown>) => SkillResult {
  const skills = new Map(skillDefinitions.map((s) => [s.name, s]));

  return (arguments_: Record<string, unknown>): SkillResult => {
    const name = arguments_.name;
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("use_skill requires a non-empty 'name'.");
    }

    const skill = skills.get(name);
    if (!skill) {
      const available = Array.from(skills.keys()).join(", ") || "(none)";
      throw new Error(
        `Unknown skill '${name}'. Available: ${available}`,
      );
    }

    return { skill: skill.name, instructions: skill.body };
  };
}
