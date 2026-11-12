import { createContext, useContext } from "react";
export interface Identity {
  development?: boolean;
  profile: {
    fullName: string;
    email: string;
    tier: "Starter";
    imageUrl?: string;
  };
  signOut(): Promise<void>;
  manageAccount(): void;
}
export const IdentityContext = createContext<Identity | null>(null);
export const useIdentity = () => useContext(IdentityContext);
