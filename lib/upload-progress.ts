/**
 * Byte-level progress for staged-attachment uploads, keyed by the staged file
 * id the composer hands to `onBeforeBlobUpload`.
 *
 * The composer cannot observe a plugin's own transfer directly: a plugin that
 * offloads an attachment (see `isExternalAttachmentResult`) uploads the bytes
 * itself via `api.http.post`, and the File it holds is a structured clone from
 * the sandbox boundary, so object identity can't correlate that request back
 * to an attachment. The staged file id can: the composer generated it, handed
 * it to the hook, and the plugin passes it back via `progressFileId` on the
 * post options. The host counts the bytes (see `doHttpPost`) and reports them
 * here; the composer subscribes before running the hook.
 *
 * Progress never crosses into the sandbox. Reports for an id nobody listens to
 * are dropped, so a plugin sending noise for ids it was never handed reaches
 * nothing.
 */

export type UploadProgressListener = (loaded: number, total: number) => void;

const listeners = new Map<string, UploadProgressListener>();

/**
 * Subscribe to progress reports for one staged file id. Returns the
 * unsubscribe function. One listener per id: the composer owns the staged id,
 * nothing else has a reason to listen.
 */
export function onUploadProgress(fileId: string, listener: UploadProgressListener): () => void {
  listeners.set(fileId, listener);
  return () => {
    // Only clear our own registration, in case the id was re-registered.
    if (listeners.get(fileId) === listener) listeners.delete(fileId);
  };
}

/** Report transferred bytes for a staged file id. No listener, no effect. */
export function reportUploadProgress(fileId: string, loaded: number, total: number): void {
  const listener = listeners.get(fileId);
  if (!listener) return;
  if (!Number.isFinite(loaded) || !Number.isFinite(total)) return;
  listener(loaded, total);
}
