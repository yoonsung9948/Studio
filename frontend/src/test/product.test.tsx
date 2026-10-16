import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { DemoAuthGate } from "../features/account/Login";
import { defaultProfile, useAccount } from "../stores/account";

beforeEach(() =>
  useAccount.setState({ signedIn: false, profile: { ...defaultProfile } }),
);
afterEach(() => vi.restoreAllMocks());
function Destination() {
  return <div>Studio destination: {useLocation().pathname}</div>;
}
function visit(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DemoAuthGate>
        <Destination />
      </DemoAuthGate>
    </MemoryRouter>,
  );
}

describe("public website and installed app entry", () => {
  it("opens the public product page and follows its login link", async () => {
    visit();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "A story worth telling.",
    );
    expect(screen.queryByText(/Studio destination/)).not.toBeInTheDocument();
    const login = screen
      .getByRole("navigation", { name: "Product navigation" })
      .parentElement!.querySelector('a[href="/login"]')!;
    fireEvent.click(login);
    expect(
      await screen.findByRole("heading", { name: "Welcome to dotori studio" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "dotori studio home" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "A story worth telling.",
    );
  });

  it("keeps the public home page available to signed-in browser visitors", () => {
    useAccount.getState().signIn();
    visit();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "A story worth telling.",
    );
  });

  it("lets visitors explore storyboard scenes before signing in", () => {
    visit();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview the discovery" }),
    );
    expect(
      screen.getByRole("button", { name: "Preview the discovery" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { name: "The discovery" }),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText("Illustrated storyboard for the discovery"),
    ).toHaveAttribute("src", "/media/discovery.svg");
    expect(useAccount.getState().signedIn).toBe(false);
  });

  it("routes older standalone home shortcuts to login", async () => {
    const normal = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...normal(query),
      matches: query === "(display-mode: standalone)",
    }));
    visit();
    expect(
      await screen.findByRole("heading", { name: "Welcome to dotori studio" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("A story worth telling."),
    ).not.toBeInTheDocument();
  });

  it("opens login on the new PWA launch URL and continues an existing session", async () => {
    useAccount.getState().signIn();
    visit("/login");
    expect(
      await screen.findByText("Studio destination: /projects"),
    ).toBeInTheDocument();
  });
});
