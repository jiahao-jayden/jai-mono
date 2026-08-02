import { TaggedError } from "better-result";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** 可跨进程传输的错误投影；绝不包含 stack 或 cause。 */
export interface ErrorEnvelope<TCode extends string = string, TData extends JsonValue = JsonValue> {
	code: TCode;
	message: string;
	data?: TData;
}

export interface CodedErrorInit<TCode extends string, TData extends JsonValue = JsonValue> {
	code: TCode;
	message: string;
	data?: TData;
	cause?: unknown;
}

/** Jai 主动抛出的、可按稳定 code 判别的进程内错误。 */
export class CodedError<TCode extends string = string, TData extends JsonValue = JsonValue> extends Error {
	readonly code: TCode;
	readonly data?: TData;

	constructor(init: CodedErrorInit<TCode, TData>) {
		super(init.message, { cause: init.cause });
		this.name = "CodedError";
		this.code = init.code;
		this.data = init.data;
	}
}

/**
 * 定义一个局部错误域。reason 是受限 union，完整 code 由 namespace 自动组成。
 * 不注册全局错误码，调用方也不必手写重复的 `namespace.reason` 字符串。
 */
export function defineCodedError<const TNamespace extends string, const TReasons extends readonly string[]>(
	namespace: TNamespace,
	_reasons: TReasons,
) {
	type Reason = TReasons[number];
	type Code = `${TNamespace}.${Reason}`;

	return <TData extends JsonValue = JsonValue>(
		reason: Reason,
		init: Omit<CodedErrorInit<Code, TData>, "code">,
	): CodedError<Code, TData> => new CodedError({ code: `${namespace}.${reason}` as Code, ...init });
}

export function getErrorMessage(error: unknown): string {
	if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
		return error.message;
	}
	return String(error);
}

export function getErrorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		"code" in value &&
		typeof value.code === "string" &&
		"message" in value &&
		typeof value.message === "string"
	);
}

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
	if (isErrorEnvelope(error)) {
		return "data" in error ? { code: error.code, message: error.message, data: error.data } : error;
	}
	if (TaggedError.is(error)) {
		const data = "data" in error && isJsonValue(error.data) ? { data: error.data } : {};
		return { code: error._tag, message: error.message, ...data };
	}
	return {
		code: "error.unknown",
		message: getErrorMessage(error),
	};
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
		return true;
	if (Array.isArray(value)) return value.every(isJsonValue);
	return (
		typeof value === "object" &&
		value !== null &&
		Object.values(value).every(isJsonValue)
	);
}
