import type { confirmDialog } from "@/components/ui/ConfirmDialog";
import { asyncContextEquals, type AsyncContext } from "@/lib/asyncContext";
import type { Profile } from "@/types";
import { profileIdentityKey } from "./profileIdentity";

/** Reloading a dirty built-in uses the same baseline adoption as any profile. */
export async function loadProfile({
  profile,
  selectedPreset,
  dirty,
  getAsyncContext,
  confirm,
  onSelectProfile,
}: {
  profile: Profile;
  selectedPreset: string;
  dirty: boolean;
  getAsyncContext: () => AsyncContext;
  confirm: typeof confirmDialog;
  onSelectProfile: (profile: Profile) => void;
}): Promise<void> {
  if (
    !dirty &&
    profileIdentityKey(selectedPreset) === profileIdentityKey(profile.name)
  )
    return;
  const context = getAsyncContext();
  if (
    dirty &&
    !(await confirm({
      title: "Discard changes?",
      message: "Loading this profile will discard your unsaved changes.",
      confirmLabel: "Discard and load",
    }))
  )
    return;
  if (!asyncContextEquals(context, getAsyncContext())) return;
  onSelectProfile(profile);
}
