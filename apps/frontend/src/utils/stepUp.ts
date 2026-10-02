/**
 * Step-up: the API refuses a sensitive action (opening break-glass, handing
 * over a setup link, resetting someone's access) when the session last proved
 * who it is more than a few minutes ago, answering 403 STEP_UP_REQUIRED.
 *
 * The HTTP clients call requestStepUp() on that answer: it opens the dialog
 * (components/auth/StepUpDialog.tsx), which asks for the password or an
 * authenticator code and calls POST /auth/step-up. The client then retries the
 * request once. Several refused requests at once share one dialog.
 */
import { create } from 'zustand';

interface StepUpState {
  open: boolean;
  waiters: Array<(ok: boolean) => void>;
  settle: (ok: boolean) => void;
}

export const useStepUpStore = create<StepUpState>((set, get) => ({
  open: false,
  waiters: [],
  settle: (ok) => {
    const waiters = get().waiters;
    set({ open: false, waiters: [] });
    waiters.forEach((w) => w(ok));
  },
}));

export function isStepUpRequired(error: any): boolean {
  return error?.response?.status === 403 && error.response.data?.code === 'STEP_UP_REQUIRED';
}

/** Resolves true once the person has confirmed who they are, false if they cancelled. */
export function requestStepUp(): Promise<boolean> {
  return new Promise((resolve) => {
    useStepUpStore.setState((s) => ({ open: true, waiters: [...s.waiters, resolve] }));
  });
}
