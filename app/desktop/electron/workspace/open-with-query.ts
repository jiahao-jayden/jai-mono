/**
 * JXA program run through `osascript` to ask Launch Services which applications
 * can open a file. It prints `{"applications":[{id,name,path,isDefault}]}`.
 *
 * It lives in its own module so the source is diffable and Vite bundles it with
 * the main process — shipping it as a loose `.js` asset would not resolve from
 * inside asar. Note that it is a string, so it is not type-checked or linted.
 */
export const MAX_OPEN_APPLICATIONS = 12;

export const macOSApplicationQuery = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");

const arguments = $.NSProcessInfo.processInfo.arguments;
const filePath = ObjC.unwrap(arguments.objectAtIndex(arguments.count - 1));
const extension = filePath.split(".").at(-1).toLowerCase();
const contentTypesByExtension = {
	htm: ["public.html"],
	html: ["public.html"],
	jpeg: ["public.jpeg"],
	jpg: ["public.jpeg"],
	md: ["net.daringfireball.markdown", "public.plain-text"],
	markdown: ["net.daringfireball.markdown", "public.plain-text"],
	pdf: ["com.adobe.pdf"],
	png: ["public.png"],
	text: ["public.plain-text", "public.text"],
	txt: ["public.plain-text", "public.text"],
	svg: ["public.svg-image"],
};
const workspace = $.NSWorkspace.sharedWorkspace;
const fileUrl = $.NSURL.fileURLWithPath($(filePath));
const defaultUrl = workspace.URLForApplicationToOpenURL(fileUrl);
const defaultPath = defaultUrl ? ObjC.unwrap(defaultUrl.path) : null;
const applications = [];
const applicationIds = new Set();

function unwrapString(value) {
	return value ? ObjC.unwrap(value) : null;
}

function arrayContainsString(values, value) {
	if (!values) return false;
	for (let index = 0; index < values.count; index += 1) {
		if (unwrapString(values.objectAtIndex(index)) === value) return true;
	}
	return false;
}

function documentTypesHandleExtension(documentTypes) {
	if (!documentTypes) return false;
	for (let index = 0; index < documentTypes.count; index += 1) {
		const documentType = documentTypes.objectAtIndex(index);
		const extensions = documentType.objectForKey($("CFBundleTypeExtensions"));
		for (let extensionIndex = 0; extensions && extensionIndex < extensions.count; extensionIndex += 1) {
			if (unwrapString(extensions.objectAtIndex(extensionIndex)).toLowerCase() === extension) return true;
		}
		const contentTypes = documentType.objectForKey($("LSItemContentTypes"));
		const knownContentTypes = contentTypesByExtension[extension] || [];
		for (const contentType of knownContentTypes) {
			if (arrayContainsString(contentTypes, contentType)) return true;
		}
	}
	return false;
}

function addApplication(applicationPath, isDefault, requireDocumentMatch) {
	const bundle = $.NSBundle.bundleWithPath($(applicationPath));
	if (!bundle) return;
	const id = unwrapString(bundle.bundleIdentifier);
	if (!id || applicationIds.has(id)) return;
	const documentTypes = bundle.objectForInfoDictionaryKey($("CFBundleDocumentTypes"));
	if (requireDocumentMatch && !documentTypesHandleExtension(documentTypes)) return;
	const name =
		unwrapString(bundle.objectForInfoDictionaryKey($("CFBundleDisplayName"))) ||
		unwrapString(bundle.objectForInfoDictionaryKey($("CFBundleName"))) ||
		applicationPath.split("/").at(-1).replace(/\\.app$/, "");
	applicationIds.add(id);
	applications.push({ id, name, path: applicationPath, isDefault });
}

const registeredApplications = workspace.URLsForApplicationsToOpenURL(fileUrl);
for (let index = 0; registeredApplications && index < registeredApplications.count; index += 1) {
	const applicationPath = ObjC.unwrap(registeredApplications.objectAtIndex(index).path);
	addApplication(applicationPath, applicationPath === defaultPath, false);
}

for (const root of ["/Applications", "/System/Applications", ObjC.unwrap($.NSHomeDirectory()) + "/Applications"]) {
	const entries = $.NSFileManager.defaultManager.contentsOfDirectoryAtPathError($(root), null);
	for (let index = 0; entries && index < entries.count; index += 1) {
		const entry = unwrapString(entries.objectAtIndex(index));
		if (!entry.endsWith(".app")) continue;
		const applicationPath = root + "/" + entry;
		addApplication(applicationPath, applicationPath === defaultPath, true);
	}
}

applications.sort((left, right) => {
	if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
	return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
});
JSON.stringify({ applications: applications.slice(0, ${MAX_OPEN_APPLICATIONS}) });
`;
