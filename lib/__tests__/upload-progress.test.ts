import { describe, it, expect, vi } from 'vitest';
import { onUploadProgress, reportUploadProgress } from '../upload-progress';

describe('upload progress registry', () => {
  it('delivers reports to the listener registered for the id', () => {
    const listener = vi.fn();
    const off = onUploadProgress('file-1', listener);
    reportUploadProgress('file-1', 512, 2048);
    expect(listener).toHaveBeenCalledWith(512, 2048);
    off();
  });

  it('drops reports for an id nobody listens to', () => {
    const listener = vi.fn();
    const off = onUploadProgress('file-1', listener);
    reportUploadProgress('file-2', 1, 2);
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const off = onUploadProgress('file-1', listener);
    off();
    reportUploadProgress('file-1', 1, 2);
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores non-finite byte counts', () => {
    const listener = vi.fn();
    const off = onUploadProgress('file-1', listener);
    reportUploadProgress('file-1', NaN, 100);
    reportUploadProgress('file-1', 50, Infinity);
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("unsubscribing a stale registration does not drop the id's current listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onUploadProgress('file-1', first);
    const offSecond = onUploadProgress('file-1', second);
    // The composer re-registered the id; the stale unsubscribe must be a no-op.
    offFirst();
    reportUploadProgress('file-1', 10, 100);
    expect(second).toHaveBeenCalledWith(10, 100);
    expect(first).not.toHaveBeenCalled();
    offSecond();
  });
});
