// Wire protocol — messages exchanged between host and capsule sandbox.
// Transport is unspecified (postMessage, IPC...); only shapes are normative.
//   capsule → host: ready, error, resize

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

export type CapsuleSandboxToHostMessage =
	| CapsuleReadyMessage
	| CapsuleResizeMessage
	| CapsuleErrorMessage;

export type CapsuleMessage = CapsuleSandboxToHostMessage;

export const CapsuleMessageType = {
	Ready: "capsule/ready",
	Resize: "capsule/resize",
	Error: "capsule/error",
} as const;

export type CapsuleMessageType = (typeof CapsuleMessageType)[keyof typeof CapsuleMessageType];
