import { useEffect, useState, type ReactNode } from "react";
import { Download, RefreshCw, WifiOff, X } from "lucide-react";
import { Button } from "./ui/button";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaControls({ children }: { children: ReactNode }) {
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [installHidden, setInstallHidden] = useState(false);
  const [installHelp, setIosHelp] = useState(false);
  const [standalone, setStandalone] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  );
  const [offline, setOffline] = useState(!navigator.onLine);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const macSafari =
    !ios &&
    /Macintosh|MacIntel/.test(navigator.userAgent + navigator.platform) &&
    /Safari\//.test(navigator.userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(navigator.userAgent);

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
      setInstallHidden(false);
    };
    const installed = () => {
      setStandalone(true);
      setInstall(null);
    };
    const connection = () => setOffline(!navigator.onLine);
    const display = window.matchMedia("(display-mode: standalone)");
    const displayChanged = () =>
      setStandalone(
        display.matches ||
          Boolean(
            (navigator as Navigator & { standalone?: boolean }).standalone,
          ),
      );
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    display.addEventListener("change", displayChanged);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      display.removeEventListener("change", displayChanged);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        if (disposed) return;
        const updateSW = registerSW({
          immediate: true,
          onNeedRefresh() {
            if (!disposed) setUpdate(() => () => updateSW(true));
          },
          onRegisteredSW(_url, registration) {
            if (registration)
              timer = setInterval(
                () => {
                  if (navigator.onLine)
                    void registration.update().catch(() => {});
                },
                60 * 60 * 1000,
              );
          },
          onRegisterError(error: unknown) {
            console.warn(
              "dotori studio app installation setup unavailable",
              error,
            );
          },
        });
      })
      .catch((error: unknown) =>
        console.warn("dotori studio app installation setup unavailable", error),
      );
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const installApp = async () => {
    if (!install) return;
    try {
      await install.prompt();
      const choice = await install.userChoice;
      if (choice.outcome === "accepted") setStandalone(true);
    } finally {
      setInstall(null);
    }
  };
  const refresh = async () => {
    if (!update) return;
    setUpdating(true);
    setUpdateError(false);
    try {
      await update();
    } catch {
      setUpdateError(true);
      setUpdating(false);
    }
  };

  if (offline)
    return (
      <main className="pwa-connection-required" role="alert">
        <WifiOff size={32} aria-hidden="true" />
        <h1>dotori studio needs an internet connection</h1>
        <p>
          Reconnect to return to your studio. Your saved work stays on this
          device.
        </p>
      </main>
    );

  return (
    <>
      {children}
      <aside className="pwa-controls" aria-label="App installation and updates">
        {update ? (
          <div className="pwa-card" role="status">
            <RefreshCw size={18} aria-hidden="true" />
            <div>
              <b>A new dotori studio is ready</b>
              <p>
                Reload when you’re ready. Work saved on this device stays here.
              </p>
              {updateError && <p>Couldn’t update. Reconnect and try again.</p>}
              <div className="pwa-actions">
                <Button
                  size="sm"
                  disabled={updating || offline}
                  onClick={() => void refresh()}
                >
                  {updating ? "Reloading…" : "Reload"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={updating}
                  onClick={() => setUpdate(null)}
                >
                  Later
                </Button>
              </div>
            </div>
          </div>
        ) : !standalone && !installHidden && (install || ios || macSafari) ? (
          <div className="pwa-card">
            <Download size={18} aria-hidden="true" />
            <div>
              <b>Keep dotori studio close</b>
              <p>
                {installHelp
                  ? macSafari
                    ? "In Safari, choose File → Add to Dock… (or Share → Add to Dock), then click Add. Requires macOS Sonoma 14 or later."
                    : "In Safari, tap Share, then Add to Home Screen and Open as Web App if shown."
                  : "Install dotori studio for a dedicated studio window."}
              </p>
              <Button
                size="sm"
                onClick={() =>
                  install
                    ? void installApp().catch(() => setInstall(null))
                    : setIosHelp(true)
                }
              >
                {installHelp && !install
                  ? "Installation instructions"
                  : "Install dotori studio"}
              </Button>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Dismiss installation tip"
              onClick={() => setInstallHidden(true)}
            >
              <X size={15} />
            </Button>
          </div>
        ) : null}
      </aside>
    </>
  );
}
