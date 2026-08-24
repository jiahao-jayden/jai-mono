import type { CodingAgent, CodingAttachment } from "@jai/coding-agent";
import type {
	DesktopAgentEvent,
	DesktopAgentMode,
	DesktopAgentStatus,
	DesktopArtifact,
	DesktopTodos,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";

export interface DesktopAgentRuntimeInput {
	readonly sessionId: string;
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
}

export interface DesktopAgentSendInput {
	readonly sessionId: string;
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
	readonly message: string;
	readonly resolvedAttachments?: readonly CodingAttachment[];
}

/** Live, disposable state for one active CodingAgent runtime. */
export interface SessionRuntime {
	readonly sessionId: string;
	modelRef: string;
	mode: DesktopAgentMode;
	agent: CodingAgent;
	readonly items: Map<string, DesktopTranscriptItem>;
	readonly artifacts: Map<string, DesktopArtifact>;
	unsubscribe: () => void;
	status: DesktopAgentStatus;
	todos?: DesktopTodos;
	closed: boolean;
	seq: number;
	nextMessageId: number;
	nextCompactionId: number;
	invalidateAfterRun: boolean;
	pendingRuns: number;
	pendingCompactionId?: string;
	rebinding?: Promise<void>;
	currentTurnId?: string;
	activeAssistantId?: string;
	activeUserId?: string;
	readonly pendingTranscriptUpdates: Map<string, Extract<DesktopAgentEvent, { readonly type: "transcript_upsert" }>>;
	flushTimer?: ReturnType<typeof setTimeout>;
}
