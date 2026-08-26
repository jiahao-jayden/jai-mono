import { TaggedError } from "better-result";

/**
 * A controllable point immediately before an effect crosses a durable or
 * external seam. Production leaves this unset; crash-prefix tests install a
 * gate and release one effect at a time.
 *
 * The action deliberately contains identities and kinds, never prompt text,
 * tool arguments, provider payloads, or storage implementation details.
 */
export type EffectGateAction =
	| { readonly type: "model_intent" }
	| { readonly type: "model_request"; readonly assistantEntryId?: string }
	| { readonly type: "model_usage"; readonly assistantEntryId?: string }
	| { readonly type: "tool_intent"; readonly toolCallId: string; readonly toolName: string }
	| {
			readonly type: "tool_execute";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly resultEntryId?: string;
	  }
	| {
			readonly type: "session_entry";
			readonly entryId: string;
			readonly entryType: "message" | "app_state" | "compaction" | "branch";
			readonly messageRole?: "user" | "assistant" | "toolResult";
	  };

/** A small portable seam for manual-drive tests; automatic runs omit it. */
export interface EffectGate {
	beforeEffect(action: EffectGateAction): Promise<void>;
}

/**
 * Test-only process-stop signal. It must escape the Agent loop unchanged so a
 * simulated crash cannot be converted into an assistant/tool error or T2.
 */
export class EffectGateInterrupted extends TaggedError("effect_gate.interrupted")<{
	readonly message: string;
}> {}

export function isEffectGateInterrupted(error: unknown): error is EffectGateInterrupted {
	return error instanceof EffectGateInterrupted;
}

/**
 * Driver for deterministic crash-prefix tests. At most one visible action is
 * released at a time; parallel effects are queued FIFO after they reach the
 * same seam. Calling `interrupt()` emulates process death before the visible
 * effect starts.
 */
export interface ManualEffectGate {
	readonly gate: EffectGate;
	waitForAction(): Promise<EffectGateAction>;
	release(): boolean;
	interrupt(): void;
}

export function createManualEffectGate(): ManualEffectGate {
	return new DefaultManualEffectGate();
}

interface PendingEffect {
	readonly action: EffectGateAction;
	readonly resolve: () => void;
	readonly reject: (error: EffectGateInterrupted) => void;
}

interface ActionWaiter {
	readonly resolve: (action: EffectGateAction) => void;
	readonly reject: (error: EffectGateInterrupted) => void;
}

class DefaultManualEffectGate implements ManualEffectGate, EffectGate {
	readonly gate: EffectGate = this;
	readonly #queued: PendingEffect[] = [];
	readonly #waiters: ActionWaiter[] = [];
	#active: PendingEffect | undefined;
	#interrupted: EffectGateInterrupted | undefined;

	beforeEffect(action: EffectGateAction): Promise<void> {
		if (this.#interrupted) return Promise.reject(this.#interrupted);
		return new Promise<void>((resolve, reject) => {
			this.#queued.push({ action, resolve, reject });
			this.presentNext();
		});
	}

	waitForAction(): Promise<EffectGateAction> {
		if (this.#interrupted) return Promise.reject(this.#interrupted);
		if (this.#active) return Promise.resolve(this.#active.action);
		return new Promise<EffectGateAction>((resolve, reject) => {
			this.#waiters.push({ resolve, reject });
		});
	}

	release(): boolean {
		const active = this.#active;
		if (!active) return false;
		this.#active = undefined;
		active.resolve();
		this.presentNext();
		return true;
	}

	interrupt(): void {
		if (this.#interrupted) return;
		const interrupted = new EffectGateInterrupted({ message: "Manual Effect Gate interrupted the active process" });
		this.#interrupted = interrupted;
		this.#active?.reject(interrupted);
		this.#active = undefined;
		for (const pending of this.#queued.splice(0)) pending.reject(interrupted);
		for (const waiter of this.#waiters.splice(0)) waiter.reject(interrupted);
	}

	private presentNext(): void {
		if (this.#active || this.#interrupted) return;
		const next = this.#queued.shift();
		if (!next) return;
		this.#active = next;
		for (const waiter of this.#waiters.splice(0)) waiter.resolve(next.action);
	}
}
