import type {
	JsonObject,
	MessageEntry,
	OperationAccepted,
	OperationRecord,
	SessionEntry,
	SessionSnapshot,
} from "@jai/agent";
import type { Result } from "better-result";
import { TaggedError } from "better-result";
import type { RuntimeSessionConfiguration } from "./configuration";

export interface ProductSessionInfo {
	readonly id: string;
	readonly cwd: string;
	readonly updatedAt: string;
}

export interface ProductSessionDurableState<TAppState extends JsonObject = JsonObject> extends ProductSessionInfo {
	readonly snapshot: SessionSnapshot<TAppState>;
	readonly revision: string;
	readonly operationRecords: readonly OperationRecord[];
	/** Latest configuration for a not-yet-accepted prompt. */
	readonly runtimeConfiguration: RuntimeSessionConfiguration;
	/** Configuration frozen at every accepted Operation's durable admission. */
	readonly operationRuntimeConfigurations: readonly ProductOperationRuntimeConfiguration[];
}

export interface CreateProductSession<TAppState extends JsonObject = JsonObject> {
	readonly id: string;
	readonly appState: TAppState;
	readonly runtimeConfiguration: RuntimeSessionConfiguration;
	readonly cwd: string;
	readonly createdAt: string;
}

export interface ProductOperationRuntimeConfiguration {
	readonly operationId: string;
	readonly configuration: RuntimeSessionConfiguration;
}

/** Atomic unit for ACP prompt admission: Session input plus Operation acceptance. */
export interface PromptAdmissionTransaction {
	readonly sessionId: string;
	readonly inputEntry: MessageEntry;
	readonly operation: OperationAccepted;
}

/** A non-admission execution fact appended by the Runtime Host. */
export interface OperationRecordAppend {
	readonly sessionId: string;
	readonly record: OperationRecord;
}

/** One Session Journal append issued by the Server-owned Agent store adapter. */
export interface SessionEntryAppend<TAppState extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly entry: SessionEntry<TAppState>;
	readonly expectedRevision: string;
}

/** One append-only Runtime Host Session configuration fact. */
export interface RuntimeConfigurationAppend {
	readonly sessionId: string;
	readonly configuration: RuntimeSessionConfiguration;
	readonly timestamp: string;
}

export class ProductSessionNotFound extends TaggedError("product_sessions.not_found")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class ProductSessionAlreadyExists extends TaggedError("product_sessions.already_exists")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class ProductSessionAdmissionConflict extends TaggedError("product_sessions.admission_conflict")<{
	readonly sessionId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/**
 * Product persistence owns the transaction that bridges the two Agent facts.
 * SessionStore and OperationJournal stay separate domain contracts; callers cannot
 * accidentally append only one half of a Prompt Admission.
 */
export interface ProductSessionPersistence<TAppState extends JsonObject = JsonObject> {
	create(
		input: CreateProductSession<TAppState>,
	): Promise<Result<void, ProductSessionAlreadyExists | ProductSessionAdmissionConflict>>;
	load(
		sessionId: string,
	): Promise<Result<ProductSessionDurableState<TAppState>, ProductSessionNotFound | ProductSessionAdmissionConflict>>;
	list(): Promise<Result<readonly ProductSessionInfo[], ProductSessionAdmissionConflict>>;
	admitPrompt(
		input: PromptAdmissionTransaction,
	): Promise<Result<void, ProductSessionNotFound | ProductSessionAdmissionConflict>>;
	appendRuntimeConfiguration(
		input: RuntimeConfigurationAppend,
	): Promise<Result<void, ProductSessionNotFound | ProductSessionAdmissionConflict>>;
	appendOperation(
		input: OperationRecordAppend,
	): Promise<Result<void, ProductSessionNotFound | ProductSessionAdmissionConflict>>;
	appendEntry(
		input: SessionEntryAppend<TAppState>,
	): Promise<Result<string, ProductSessionNotFound | ProductSessionAdmissionConflict>>;
}
