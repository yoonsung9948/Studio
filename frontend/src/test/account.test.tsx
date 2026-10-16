import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { DemoAuthGate } from "../features/account/Login";
import { ProfileMenu, ProfileSettings } from "../features/account/Profile";
import { defaultProfile, useAccount } from "../stores/account";
import { useStore } from "../stores/store";

beforeEach(() => {
  localStorage.removeItem("nori-demo-account-v1");
  useAccount.setState({ signedIn: false, profile: { ...defaultProfile } });
  useStore.getState().reset();
});

function Destination() {
  return (
    <div>
      Destination: {useLocation().pathname}
      {useLocation().search}
    </div>
  );
}
function entry(path = "/app") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DemoAuthGate>
        <Destination />
      </DemoAuthGate>
    </MemoryRouter>,
  );
}

describe("demo account", () => {
  it("accepts arbitrary credentials, preserves a deep link, and never persists the password", async () => {
    entry("/projects/midnight/episodes/ep1?tab=scenes");
    expect(
      await screen.findByRole("heading", { name: "Welcome to dotori studio" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "not-an-email" },
    });
    const password = document.querySelector('input[name="password"]')!;
    fireEvent.change(password, {
      target: { value: "do-not-save-this-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText(
        "Destination: /projects/midnight/episodes/ep1?tab=scenes",
      ),
    ).toBeInTheDocument();
    const saved = localStorage.getItem("nori-demo-account-v1")!;
    expect(saved).toContain("not-an-email");
    expect(saved).not.toContain("do-not-save-this-password");
    expect(saved).not.toContain("password");
  });

  it("allows empty fields and sends the PWA entry to projects", async () => {
    entry();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Destination: /projects"),
    ).toBeInTheDocument();
  });

  it.each(["Google", "Apple"])("simulates %s sign-in", async (provider) => {
    entry("/login");
    fireEvent.click(
      screen.getByRole("button", { name: `Sign in with ${provider}` }),
    );
    expect(
      await screen.findByText("Destination: /projects"),
    ).toBeInTheDocument();
    expect(useAccount.getState().signedIn).toBe(true);
  });

  it("shows the live balance in the profile popup and adds only demo credits", async () => {
    useAccount.getState().signIn("alex.morgan@example.com");
    const before = useStore.getState().data.credits;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProfileMenu />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Open profile menu" }));
    expect(screen.getByRole("menu")).toHaveTextContent("Alex Morgan");
    expect(screen.getByRole("menu")).toHaveTextContent("Starter");
    expect(screen.getByRole("menu")).toHaveTextContent(before.toLocaleString());
    expect(
      screen.getByRole("menuitem", { name: "Profile settings" }),
    ).toHaveAttribute("href", "/profile/settings");
    await user.click(
      screen.getByRole("menuitem", { name: /Recharge credits/ }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "No payment is collected",
    );
    await user.click(
      screen.getByRole("button", { name: "Add 1,000 demo credits" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(useStore.getState().data.credits).toBe(before + 1000);
    expect(
      screen.getByRole("button", { name: "Open profile menu" }),
    ).toHaveTextContent((before + 1000).toLocaleString());
  });

  it("saves profile details and signs out without deleting studio work", async () => {
    useAccount.getState().signIn();
    const projectIds = Object.keys(useStore.getState().data.projects);
    render(
      <MemoryRouter initialEntries={["/profile/settings"]}>
        <DemoAuthGate>
          <ProfileSettings />
        </DemoAuthGate>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Jamie Park" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "jamie@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(useAccount.getState().profile.fullName).toBe("Jamie Park");
    expect(screen.getByRole("status")).toHaveTextContent("Profile saved");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByRole("heading", { name: "Welcome to dotori studio" }),
    ).toBeInTheDocument();
    expect(Object.keys(useStore.getState().data.projects)).toEqual(projectIds);
    expect(useAccount.getState().profile.fullName).toBe("Jamie Park");
  });
});
