import { useState, useCallback, useRef, useEffect } from "react";

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant: "default" | "destructive";
  onConfirm: () => void;
}

const INITIAL_STATE: ConfirmDialogState = {
  isOpen: false,
  title: "",
  message: "",
  variant: "default",
  onConfirm: () => {},
};

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState>(INITIAL_STATE);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (resolveRef.current) {
        resolveRef.current(false);
        resolveRef.current = null;
      }
    };
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setState({
          isOpen: true,
          title: options.title,
          message: options.message,
          confirmText: options.confirmText,
          cancelText: options.cancelText,
          variant: options.variant || "default",
          onConfirm: () => {
            resolveRef.current = null;
            resolve(true);
          },
        });
      });
    },
    []
  );

  const close = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    setState(INITIAL_STATE);
  }, []);

  return {
    dialogProps: {
      isOpen: state.isOpen,
      onClose: close,
      onConfirm: state.onConfirm,
      title: state.title,
      message: state.message,
      confirmText: state.confirmText,
      cancelText: state.cancelText,
      variant: state.variant,
    },
    confirm,
  };
}
