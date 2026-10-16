import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronUp,
  CircleUserRound,
  CreditCard,
  LogOut,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useAccount } from "../../stores/account";
import { useStore } from "../../stores/store";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";

function Avatar({ large = false }: { large?: boolean }) {
  return (
    <span className={`profile-avatar ${large ? "profile-avatar-large" : ""}`}>
      <CircleUserRound size={large ? 28 : 21} aria-hidden="true" />
    </span>
  );
}

export function RechargeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [amount, setAmount] = useState(1000);
  const credits = useStore((s) => s.data.credits);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="recharge-dialog">
        <div className="account-dialog-symbol">
          <Sparkles size={22} />
        </div>
        <DialogTitle>A little more room to create</DialogTitle>
        <DialogDescription>
          Add demo credits to keep exploring. No payment is collected.
        </DialogDescription>
        <p className="recharge-balance">
          Current balance <b>{credits.toLocaleString()} cr</b>
        </p>
        <div
          className="recharge-packs"
          role="group"
          aria-label="Demo credit amount"
        >
          {[250, 1000, 2500].map((n) => (
            <button
              key={n}
              aria-pressed={amount === n}
              onClick={() => setAmount(n)}
            >
              <Sparkles size={16} />
              <b>{n.toLocaleString()}</b>
              <span>demo credits</span>
            </button>
          ))}
        </div>
        <Button
          variant="default"
          onClick={() => {
            const added = useStore.getState().mutate((d) => {
              d.credits += amount;
            });
            if (added) {
              useStore
                .getState()
                .setNotice(`${amount.toLocaleString()} demo credits added.`);
              onOpenChange(false);
            }
          }}
        >
          Add {amount.toLocaleString()} demo credits
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function ProfileMenu() {
  const profile = useAccount((s) => s.profile);
  const credits = useStore((s) => s.data.credits);
  const [recharge, setRecharge] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="profile-strip"
          aria-label="Open profile menu"
        >
          <Avatar />
          <span className="profile-strip-copy nav-label">
            <b>{profile.fullName}</b>
            <small>
              {profile.tier} · {credits.toLocaleString()} cr
            </small>
          </span>
          <ChevronUp className="nav-label" size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="dropdown profile-menu"
          side="top"
          align="start"
          sideOffset={10}
        >
          <div className="profile-menu-heading">
            <Avatar large />
            <div>
              <b>{profile.fullName}</b>
              <span>{profile.email || "Your personal studio"}</span>
            </div>
          </div>
          <div className="profile-tier-row">
            <span>Subscription</span>
            <b>{profile.tier}</b>
          </div>
          <div className="profile-credit-box">
            <span>Credits left</span>
            <strong>
              <Sparkles size={18} />
              {credits.toLocaleString()}
              <small>demo cr</small>
            </strong>
          </div>
          <DropdownMenuItem onSelect={() => setRecharge(true)}>
            <CreditCard size={15} />
            Recharge credits<span className="profile-demo-pill">DEMO</span>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/profile/settings">
              <Settings2 size={15} />
              Profile settings
            </Link>
          </DropdownMenuItem>
          <div className="profile-menu-divider" />
          <DropdownMenuItem onSelect={() => useAccount.getState().signOut()}>
            <LogOut size={15} />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RechargeDialog open={recharge} onOpenChange={setRecharge} />
    </>
  );
}

export function ProfileSettings() {
  const profile = useAccount((s) => s.profile);
  const credits = useStore((s) => s.data.credits);
  const [recharge, setRecharge] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <div className="page account-settings-page">
      <div className="eyebrow">YOUR ACCOUNT</div>
      <header className="page-heading">
        <div>
          <h1>Profile settings</h1>
          <p>The person behind the stories.</p>
        </div>
      </header>
      <div className="account-settings-grid">
        <section className="account-settings-card">
          <div className="profile-settings-heading">
            <Avatar large />
            <div>
              <h2>Personal details</h2>
              <p>Make this studio feel like yours.</p>
            </div>
          </div>
          <form
            className="form-fields"
            onChange={() => setSaved(false)}
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              useAccount.getState().updateProfile({
                fullName: String(data.get("fullName") || ""),
                email: String(data.get("email") || ""),
              });
              setSaved(true);
            }}
          >
            <label>
              Full name
              <input
                name="fullName"
                maxLength={100}
                defaultValue={profile.fullName}
                autoComplete="name"
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="text"
                inputMode="email"
                maxLength={254}
                defaultValue={profile.email}
                autoComplete="email"
                placeholder="you@studio.com"
              />
            </label>
            <div className="profile-save-row">
              <Button type="submit" variant="default">
                Save changes
              </Button>
              {saved && <span role="status">Profile saved</span>}
            </div>
          </form>
        </section>
        <section className="account-settings-card profile-plan-card">
          <span className="account-kicker">YOUR MEMBERSHIP</span>
          <h2>{profile.tier}</h2>
          <p>A space to bring your next idea to life.</p>
          <div className="profile-credit-box">
            <span>Credits left</span>
            <strong>
              <Sparkles size={20} />
              {credits.toLocaleString()}
              <small>demo cr</small>
            </strong>
          </div>
          <Button onClick={() => setRecharge(true)}>
            <CreditCard size={16} />
            Recharge credits
          </Button>
          <small className="profile-plan-note">
            Demo membership · No active billing
          </small>
        </section>
      </div>
      <section className="profile-session">
        <div>
          <h2>Session</h2>
          <p>
            This demo profile and studio are saved on this device. Signing out
            keeps your work.
          </p>
        </div>
        <Button onClick={() => useAccount.getState().signOut()}>
          <LogOut size={15} />
          Sign out
        </Button>
      </section>
      <RechargeDialog open={recharge} onOpenChange={setRecharge} />
    </div>
  );
}
