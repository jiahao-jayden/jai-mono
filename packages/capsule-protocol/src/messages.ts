// Wire protocol — messages exchanged between host and capsule sandbox.
// Transport is unspecified (postMessage, SSE, IPC...); only shapes are normative.
//   host → capsule: render, update, action_result, dispose
//   capsule → host: action, ready, error, resize

export interface CapsuleRenderMessage {
	type: "capsule/render";
	instanceId: string;
	capsuleId: string;
	data: unknown;
	theme?: "light" | "dark";
}

export interface CapsuleUpdateMessage {
	type: "capsule/update";
	instanceId: string;
	data: unknown;
}

export interface CapsuleActionMessage {
	type: "capsule/action";
	instanceId: string;
	actionId: string;
	requestId: string;
	args: unknown;
}

export interface CapsuleActionResultMessage {
	type: "capsule/action_result";
	instanceId: string;
	requestId: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export interface CapsuleReadyMessage {
	type: "capsule/ready";
	instanceId: string;
}

export interface CapsuleResizeMessage {
	type: "capsule/resize";
	instanceId: string;
	width?: number;
	height?: number;
}

export interface CapsuleErrorMessage {
	type: "capsule/error";
	instanceId: string;
	message: string;
	stack?: string;
}

export type CapsuleHostToSandboxMessage =
	| CapsuleRenderMessage
	| CapsuleUpdateMessage
	| CapsuleActionResultMessage;

export type CapsuleSandboxToHostMessage =
	| CapsuleActionMessage
	| CapsuleReadyMessage
	| CapsuleResizeMessage
	| CapsuleErrorMessage;

export type CapsuleMessage = CapsuleHostToSandboxMessage | CapsuleSandboxToHostMessage;

export const CapsuleMessageType = {
	Render: "capsule/render",
	Update: "capsule/update",
	Action: "capsule/action",
	ActionResult: "capsule/action_result",
	Ready: "capsule/ready",
	Resize: "capsule/resize",
	Error: "capsule/error",
} as const;

export type CapsuleMessageType = (typeof CapsuleMessageType)[keyof typeof CapsuleMessageType];
