// Promise-based prompt/confirm dialogs rendered by <Dialogs />.
import type { RepoTab } from "$lib/stores/repo.svelte";

export interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
  initial?: string;
  multiline?: boolean;
  optional?: boolean;
}

export interface CheckboxField {
  key: string;
  label: string;
  initial?: boolean;
}

export interface PromptRequest {
  kind: "prompt";
  title: string;
  description?: string;
  fields: PromptField[];
  checkboxes?: CheckboxField[];
  confirmLabel?: string;
  destructive?: boolean;
  validate?: (values: Record<string, string>) => string | null;
  /** Live form state, initialised from the fields when the prompt opens. */
  values: Record<string, string>;
  checks: Record<string, boolean>;
  resolve: (
    v: {
      values: Record<string, string>;
      checks: Record<string, boolean>;
    } | null,
  ) => void;
}

export interface ConfirmRequest {
  kind: "confirm";
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  resolve: (v: boolean) => void;
}

class DialogState {
  current = $state<PromptRequest | ConfirmRequest | null>(null);
  /** Open push dialog (<PushDialog />); `branch` preselects a branch other than the checked-out one. */
  pushRequest = $state.raw<{ repo: RepoTab; branch?: string } | null>(null);

  prompt(req: Omit<PromptRequest, "kind" | "resolve" | "values" | "checks">) {
    return new Promise<{
      values: Record<string, string>;
      checks: Record<string, boolean>;
    } | null>((resolve) => {
      this.current = {
        ...req,
        kind: "prompt",
        values: Object.fromEntries(
          req.fields.map((f) => [f.key, f.initial ?? ""]),
        ),
        checks: Object.fromEntries(
          (req.checkboxes ?? []).map((c) => [c.key, c.initial ?? false]),
        ),
        resolve,
      };
    });
  }

  /** Convenience: single text field. */
  async ask(
    title: string,
    label: string,
    opts: Partial<PromptField> & {
      confirmLabel?: string;
      description?: string;
    } = {},
  ) {
    const res = await this.prompt({
      title,
      description: opts.description,
      confirmLabel: opts.confirmLabel,
      fields: [
        {
          key: "value",
          label,
          placeholder: opts.placeholder,
          initial: opts.initial,
          multiline: opts.multiline,
        },
      ],
    });
    return res ? res.values.value : null;
  }

  confirm(req: Omit<ConfirmRequest, "kind" | "resolve">) {
    return new Promise<boolean>((resolve) => {
      this.current = { ...req, kind: "confirm", resolve };
    });
  }

  close() {
    this.current = null;
  }
}

export const dialogs = new DialogState();

/** git check-ref-format rules, roughly. */
export function validateRefName(name: string): string | null {
  if (!name.trim()) return "Name is required";
  if (/\s/.test(name)) return "Spaces are not allowed";
  if (/\.\.|[~^:?*[\\]|@\{|\/\/|^\/|\/$|\.lock$|^\.|\/\.|\.$/.test(name))
    return "Not a valid git ref name";
  return null;
}
