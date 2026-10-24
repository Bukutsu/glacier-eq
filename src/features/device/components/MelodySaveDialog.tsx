import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { invokeForDevice } from "@/lib/rpc";
import {
  getUserEqSlot,
  type UserBankSaveRequest,
  type ChooseUserBank,
  type MelodyBankChoice,
} from "@/features/device/lib/melodySlot";
import type { DeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";

export function useMelodySaveDialog(connectionIdentity: string) {
  const [request, setRequest] = useState<UserBankSaveRequest | null>(null);
  const pending = useRef<((choice: MelodyBankChoice | null) => void) | null>(
    null,
  );
  const finish = useCallback((slot: number | null) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(slot === null ? null : { slot, confirmed: true });
  }, []);
  const choose: ChooseUserBank = useCallback((next) => {
    if (pending.current) return Promise.resolve(null);
    return new Promise((resolve) => {
      pending.current = resolve;
      setRequest(next);
    });
  }, []);
  useEffect(
    () => () => {
      // Never carry a bank confirmation across a disconnect or reconnect.
      const resolve = pending.current;
      pending.current = null;
      resolve?.(null);
      setRequest(null);
    },
    [connectionIdentity],
  );
  return { request, choose, finish };
}

export function MelodySaveDialog({
  request,
  runMaintenance,
  onFinish,
}: {
  request: UserBankSaveRequest;
  runMaintenance: DeviceMaintenanceRunner;
  onFinish: (slot: number | null) => void;
}) {
  const { t } = useTranslation("device");
  const [slot, setSlot] = useState(
    () => getUserEqSlot(request.path) ?? request.slots[0],
  );
  const [names, setNames] = useState<Record<number, string> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const runner = useRef(runMaintenance);
  runner.current = runMaintenance;
  useEffect(() => {
    let mounted = true;
    setSlot(getUserEqSlot(request.path) ?? request.slots[0]);
    setError(null);
    if (!request.isMelody) {
      setNames({});
      return () => {
        mounted = false;
      };
    }
    setNames(null);
    // Melody exposes names; other supported banks use fixed User N labels.
    // Defer acquisition until after mount cleanup so StrictMode cannot hold
    // the device-operation slot with a discarded dialog effect.
    void Promise.resolve().then(async () => {
      if (!mounted) return;
      let started = false;
      try {
        await runner.current(async (current) => {
          started = true;
          const next: Record<number, string> = {};
          for (const id of request.slots) {
            if (!mounted || !current()) return;
            next[id] = await invokeForDevice<string>(
              request.path,
              "melody_name",
              {
                path: request.path,
                slot: id,
              },
            );
          }
          if (mounted && current()) setNames(next);
        });
        if (mounted && !started) setError(t("melodySave.busy"));
      } catch (failure) {
        if (mounted) setError(failure);
      }
    });
    return () => {
      mounted = false;
    };
  }, [request.path, request.slots, request.isMelody, attempt, t]);
  return (
    <Modal title={t("melodySave.title")} onClose={() => onFinish(null)}>
      <form
        className="modal-body flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (names) onFinish(slot);
        }}
      >
        <p className="text-sm text-muted-foreground">
          {t("pushEq.confirmWrite", {
            count: request.count,
            preamp: request.preamp,
          })}
        </p>
        <div className="flex flex-col gap-2">
          <label htmlFor="melody-save-bank" className="text-sm font-medium">
            {t("melodySave.bank")}
          </label>
          <Select
            id="melody-save-bank"
            value={slot}
            onChange={setSlot}
            disabled={!names}
            options={request.slots.map((id, index) => ({
              value: id,
              label:
                request.isMelody && names?.[id]
                  ? t("melodySave.userBankNamed", {
                      number: index + 1,
                      name: names[id],
                    })
                  : t("melodySave.userBank", { number: index + 1 }),
            }))}
          />
        </div>
        <p id="melody-save-effect" className="text-sm text-muted-foreground">
          {t("melodySave.effect")}
        </p>
        {error != null ? (
          <ErrorNotice
            action={
              <Button onClick={() => setAttempt((value) => value + 1)}>
                {t("melodySave.retry")}
              </Button>
            }
          >
            {t("melodyControls.operationFailed", { error: String(error) })}
          </ErrorNotice>
        ) : (
          !names && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("melodySave.loading")}
            </p>
          )
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onFinish(null)}>
            {t("melodySave.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!names}
            aria-describedby="melody-save-effect"
          >
            {t("melodySave.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
