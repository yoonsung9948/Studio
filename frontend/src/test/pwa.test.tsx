import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaControls } from "../components/PwaControls";

const registration = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  options: null as null | { onNeedRefresh(): void },
}));
vi.mock("virtual:pwa-register", () => ({
  registerSW: (options: { onNeedRefresh(): void }) => {
    registration.options = options;
    return registration.refresh;
  },
}));

beforeEach(() => {
  vi.stubEnv("PROD", false);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  registration.options = null;
  registration.refresh.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function studio() {
  return render(
    <PwaControls>
      <div>Studio content</div>
    </PwaControls>,
  );
}

describe("online-only PWA", () => {
  it("shows Mac Safari installation guidance without a browser install event", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    );
    studio();
    fireEvent.click(
      screen.getByRole("button", { name: "Install dotori studio" }),
    );
    expect(screen.getByText(/File → Add to Dock/)).toBeInTheDocument();
    expect(screen.queryByText(/Add to Home Screen/)).not.toBeInTheDocument();
  });

  it("shows iPhone installation guidance instead of Mac instructions", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    );
    studio();
    fireEvent.click(
      screen.getByRole("button", { name: "Install dotori studio" }),
    );
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByText(/Add to Dock/)).not.toBeInTheDocument();
  });

  it("only offers browser installation after receiving an install prompt", async () => {
    studio();
    expect(
      screen.queryByRole("button", { name: "Install dotori studio" }),
    ).not.toBeInTheDocument();
    const prompt = vi.fn(async () => {});
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Install dotori studio" }),
    );
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByText("Keep dotori studio close"),
      ).not.toBeInTheDocument(),
    );
  });

  it("dismisses installation without invoking the browser prompt", () => {
    studio();
    const prompt = vi.fn();
    fireEvent(
      window,
      Object.assign(new Event("beforeinstallprompt"), { prompt }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss installation tip" }),
    );
    expect(
      screen.queryByText("Keep dotori studio close"),
    ).not.toBeInTheDocument();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("replaces the studio offline and restores it on reconnect", () => {
    const connection = vi
      .spyOn(navigator, "onLine", "get")
      .mockReturnValue(false);
    studio();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "dotori studio needs an internet connection",
    );
    expect(screen.queryByText("Studio content")).not.toBeInTheDocument();
    connection.mockReturnValue(true);
    fireEvent.online(window);
    expect(screen.getByText("Studio content")).toBeInTheDocument();
    connection.mockReturnValue(false);
    fireEvent.offline(window);
    expect(screen.queryByText("Studio content")).not.toBeInTheDocument();
  });

  it("waits for explicit Reload before activating an update", async () => {
    vi.stubEnv("PROD", true);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
    studio();
    await waitFor(() => expect(registration.options).not.toBeNull());
    act(() => registration.options!.onNeedRefresh());
    expect(registration.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(registration.refresh).not.toHaveBeenCalled();
    act(() => registration.options!.onNeedRefresh());
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(registration.refresh).toHaveBeenCalledWith(true),
    );
    Reflect.deleteProperty(navigator, "serviceWorker");
  });
});
