import { create } from "zustand";

export interface DemoProfile {
  fullName: string;
  email: string;
  tier: "Starter";
}
const key = "nori-demo-account-v1";
export const defaultProfile: DemoProfile = {
  fullName: "Alex Morgan",
  email: "",
  tier: "Starter",
};
function restore(): { signedIn: boolean; profile: DemoProfile } {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      value &&
      typeof value.signedIn === "boolean" &&
      typeof value.profile?.fullName === "string" &&
      typeof value.profile?.email === "string"
    ) {
      return {
        signedIn: value.signedIn,
        profile: {
          fullName: value.profile.fullName.slice(0, 100),
          email: value.profile.email.slice(0, 254),
          tier: "Starter",
        },
      };
    }
  } catch {
    /* The demo still works when browser storage is unavailable. */
  }
  return { signedIn: false, profile: defaultProfile };
}

interface Account {
  signedIn: boolean;
  profile: DemoProfile;
  signIn(email?: string): void;
  signOut(): void;
  updateProfile(profile: Pick<DemoProfile, "fullName" | "email">): void;
}

export const useAccount = create<Account>((set, get) => ({
  ...restore(),
  signIn(email) {
    const entered = email?.trim().slice(0, 254) || "";
    const profile = get().profile;
    const name = entered
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 100);
    set({
      signedIn: true,
      profile: {
        ...profile,
        email: entered || profile.email,
        fullName:
          profile.fullName === defaultProfile.fullName && name
            ? name
            : profile.fullName,
      },
    });
  },
  signOut() {
    set({ signedIn: false });
  },
  updateProfile(profile) {
    set({
      profile: {
        ...get().profile,
        fullName:
          profile.fullName.trim().slice(0, 100) || defaultProfile.fullName,
        email: profile.email.trim().slice(0, 254),
      },
    });
  },
}));

// This is local demo state, not an authentication token or account boundary.
useAccount.subscribe(({ signedIn, profile }) => {
  try {
    localStorage.setItem(key, JSON.stringify({ signedIn, profile }));
  } catch {
    /* Session remains usable in memory. */
  }
});
