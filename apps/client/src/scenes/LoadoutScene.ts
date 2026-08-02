/**
 * The pre-run skill picker (M3.8, `docs/M3_ISSUES.md` M3.8 and §1).
 * Concept §8.3 fixes three permanent skill slots chosen "before entering the
 * match"; technical plan §38 M3 lists "three pre-run skill slots" as a
 * deliverable. Nothing is written to storage and the choice does not survive a
 * page reload — there are still no accounts (M5) and no matchmaking (M6).
 *
 * M4 gives the choice a destination: pressing Enter no longer starts a local
 * world, it starts a room join carrying this selection as **join options**
 * (`docs/DECISIONS.md` D38). That is the only moment it can be made, because a
 * match starts together and late join is disabled (technical plan §8.3), and
 * one room is one match (D7).
 *
 * This scene computes no game rule itself: toggling a skill is validated by
 * calling `createSkillLoadout` (a pure function in `simulation-core`), and a
 * rejected toggle is simply not applied — the same "refused, not silently
 * clamped" treatment `docs/M3_ISSUES.md` §1 requires at the loadout boundary.
 *
 * **M5 gives it an account.** It signs in anonymously (technical plan §17.1),
 * shows the five point balances and which skills are still locked, and carries
 * the access token into the match join. Two things it deliberately does not do:
 * compute progression (it reads rows the server wrote, under policies that only
 * ever return this user's own), and enforce the unlock gate (it marks a locked
 * skill and refuses to select it, but the *authority* is the server's check in
 * `onAuth`, technical plan §19 — this is the same courtesy/authority split D38
 * already established for the slot budget).
 */
import Phaser from "phaser";
import { ALL_SKILLS, findUnlock } from "@carry-or-fall/game-content";
import type { SettlementMessage } from "@carry-or-fall/protocol";
import {
  createSkillLoadout,
  type SkillLoadoutRejectionReason,
} from "@carry-or-fall/simulation-core";

import { signInAndLoadAccount, UNCONFIGURED_ACCOUNT, type AccountState } from "../account/account";
import {
  ANONYMOUS_ACCOUNT_WARNING,
  shouldWarnAboutAnonymousAccount,
} from "../account/linking-warning";

/**
 * A documented default loadout, pre-selected on scene entry so a human can
 * start playing immediately without configuring anything — the same
 * treatment M1 gave its hard-coded weapon pair and M2 gave its hard-coded
 * starting inventory placement. One skill per weapon category plus the
 * generic shield skill, so a fresh run showcases ranged, melee, and
 * universal effects at once.
 */
export const DEFAULT_SKILL_LOADOUT_IDS: readonly string[] = [
  "ricochet",
  "extended_reach",
  "bulwark_strike",
];

const TEXT_COLOR = "#e6edf3";
const MUTED_COLOR = "#8b949e";
const REJECTED_COLOR = "#f85149";
const WARNING_COLOR = "#d29922";
const BASE_FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/** Scene data handed back by `PlayScene` after a run settles (M5). */
export interface LoadoutSceneData {
  readonly settlement?: SettlementMessage | null;
}

const DIGIT_CODES = [
  Phaser.Input.Keyboard.KeyCodes.ONE,
  Phaser.Input.Keyboard.KeyCodes.TWO,
  Phaser.Input.Keyboard.KeyCodes.THREE,
  Phaser.Input.Keyboard.KeyCodes.FOUR,
  Phaser.Input.Keyboard.KeyCodes.FIVE,
  Phaser.Input.Keyboard.KeyCodes.SIX,
  Phaser.Input.Keyboard.KeyCodes.SEVEN,
  Phaser.Input.Keyboard.KeyCodes.EIGHT,
  Phaser.Input.Keyboard.KeyCodes.NINE,
  Phaser.Input.Keyboard.KeyCodes.ZERO,
];

export class LoadoutScene extends Phaser.Scene {
  /**
   * Survives a return trip from `PlayScene` (Phaser reuses the scene
   * instance), so the previous run's choice is pre-selected and the player
   * adjusts rather than rebuilding from scratch. In-memory only — a page
   * reload constructs a fresh scene and falls back to the documented default
   * (`docs/DECISIONS.md` D31: nothing here implies account or profile
   * storage, which is M5).
   */
  private selectedIds: string[] = [...DEFAULT_SKILL_LOADOUT_IDS];
  private rejectedMessage = "";
  private digitKeys: Phaser.Input.Keyboard.Key[] = [];
  private startKey!: Phaser.Input.Keyboard.Key;
  /**
   * `PlayScene` hands control back on an Enter press, so Enter is typically
   * still physically held when this scene starts. Without waiting for a
   * release, that same hold would immediately satisfy the start check and
   * bounce straight back into a run, making the loadout screen unusable
   * after the first run.
   */
  private awaitingStartKeyRelease = true;
  private titleText!: Phaser.GameObjects.Text;
  private listText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private accountText!: Phaser.GameObjects.Text;
  private warningText!: Phaser.GameObjects.Text;
  /**
   * Survives a return trip from `PlayScene` like {@link selectedIds} does, so a
   * player who finishes a run does not watch their balances blank out and
   * reappear while the read round-trips.
   */
  private account: AccountState = UNCONFIGURED_ACCOUNT;

  constructor() {
    super("loadout");
  }

  create(data: LoadoutSceneData = {}): void {
    const camera = this.cameras.main;
    const keyboard = this.input.keyboard;
    if (keyboard === null) {
      throw new Error("keyboard input is not available in this environment");
    }
    this.digitKeys = DIGIT_CODES.map((code) => keyboard.addKey(code));
    this.startKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.awaitingStartKeyRelease = true;
    // A refusal from a previous visit must not greet the player on arrival.
    this.rejectedMessage = "";

    this.titleText = this.add
      .text(camera.centerX, 40, "Choose your loadout (up to 3 slots)", {
        fontFamily: BASE_FONT,
        fontSize: "24px",
        color: TEXT_COLOR,
      })
      .setOrigin(0.5, 0);

    this.listText = this.add.text(camera.centerX - 260, 90, "", {
      fontFamily: BASE_FONT,
      fontSize: "16px",
      color: TEXT_COLOR,
      lineSpacing: 6,
    });

    this.statusText = this.add
      .text(camera.centerX, camera.height - 90, "", {
        fontFamily: BASE_FONT,
        fontSize: "16px",
        color: REJECTED_COLOR,
      })
      .setOrigin(0.5, 0);

    this.accountText = this.add
      .text(camera.centerX, 64, "", {
        fontFamily: BASE_FONT,
        fontSize: "14px",
        color: MUTED_COLOR,
        align: "center",
      })
      .setOrigin(0.5, 0);

    this.warningText = this.add
      .text(camera.centerX, camera.height - 190, "", {
        fontFamily: BASE_FONT,
        fontSize: "13px",
        color: WARNING_COLOR,
        align: "center",
      })
      .setOrigin(0.5, 0);

    this.add
      .text(camera.centerX, camera.height - 40, "1-0: toggle a skill · Enter: start run", {
        fontFamily: BASE_FONT,
        fontSize: "14px",
        color: MUTED_COLOR,
      })
      .setOrigin(0.5, 0);

    // A settlement handed back from `PlayScene` is newer than anything a read
    // could return, so apply it before rendering — and before the sign-in below
    // resolves, which is why this is not just an optimization.
    if (data.settlement != null) {
      this.applySettlement(data.settlement);
    }

    this.render();
    void this.refreshAccount();
  }

  /**
   * Sign in and read this account's progression (technical plan §17.1). Never
   * blocks the screen: the loadout is usable, and a run is startable, before
   * this resolves — a player must not wait on the network to press Enter.
   */
  private async refreshAccount(): Promise<void> {
    const account = await signInAndLoadAccount();
    if (!this.scene.isActive()) {
      // The player already started a run; writing to destroyed text objects
      // would throw.
      return;
    }
    this.account = account;
    this.render();
  }

  /** Fold a just-returned settlement into the displayed account. */
  private applySettlement(settlement: SettlementMessage): void {
    this.account = {
      ...this.account,
      signedIn: this.account.signedIn || settlement.unlockIds.length > 0,
      isAnonymous: settlement.isAnonymous,
      balances: settlement.balances,
      unlockIds: settlement.unlockIds,
    };
  }

  override update(): void {
    for (let i = 0; i < this.digitKeys.length; i += 1) {
      if (Phaser.Input.Keyboard.JustDown(this.digitKeys[i]!)) {
        this.toggleSkill(i);
      }
    }

    if (this.awaitingStartKeyRelease) {
      // Drain any pending just-down state every frame while waiting, so a
      // hold carried over from `PlayScene` cannot fire the instant the guard
      // lifts. Digit toggles above stay live throughout.
      void Phaser.Input.Keyboard.JustDown(this.startKey);
      if (!this.startKey.isDown) {
        this.awaitingStartKeyRelease = false;
      }
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.startKey)) {
      const result = createSkillLoadout(this.selectedIds);
      if (result.ok) {
        // The ids, not the resolved definitions: from M4 this selection becomes
        // the room's join options, and the server re-validates it through this
        // same `createSkillLoadout` before admitting the player
        // (`docs/M4_ISSUES.md` M4.3). The check here is a courtesy that shows a
        // legal choice; the one on the server is the authority.
        this.scene.start("play", {
          skillLoadoutIds: [...this.selectedIds],
          account: this.account,
        });
        return;
      }
      // Defensive only: toggling already refuses anything createSkillLoadout
      // would reject, so this should be unreachable.
      this.rejectedMessage = "Current selection is invalid; adjust it before starting.";
      this.render();
    }
  }

  private toggleSkill(index: number): void {
    const skill = ALL_SKILLS[index];
    if (skill === undefined) {
      return;
    }

    if (!this.isUnlocked(skill.id) && !this.selectedIds.includes(skill.id)) {
      // Refused, not silently ignored — the player is told what would unlock it.
      // The server refuses this same selection in `onAuth` (technical plan §19);
      // this message is the courtesy half of that pair, so a player is not sent
      // to a refusal screen for something the picker could have said here.
      this.rejectedMessage = describeLocked(skill.id);
      this.render();
      return;
    }

    const next = this.selectedIds.includes(skill.id)
      ? this.selectedIds.filter((id) => id !== skill.id)
      : [...this.selectedIds, skill.id];

    const result = createSkillLoadout(next);
    if (result.ok) {
      this.selectedIds = next;
      this.rejectedMessage = "";
    } else {
      this.rejectedMessage = describeRejection(skill.id, result.reason);
    }
    this.render();
  }

  /** Whether the account holds this skill. Unknown accounts fall back to the defaults. */
  private isUnlocked(skillId: string): boolean {
    return this.account.unlockIds.includes(skillId);
  }

  private render(): void {
    const lines = ALL_SKILLS.map((skill, index) => {
      const key = index === 9 ? "0" : String(index + 1);
      const isSelected = this.selectedIds.includes(skill.id);
      const box = isSelected ? "[x]" : "[ ]";
      const rare = skill.slotCost === 2 ? " (rare, 2 slots)" : "";
      const locked = this.isUnlocked(skill.id)
        ? ""
        : ` — LOCKED (${describeRequirement(skill.id)})`;
      return `${key}. ${box} ${skill.id}${rare} — requires: ${skill.requiresTags.join("/")}${locked}`;
    });
    this.listText.setText(lines.join("\n"));

    const { balances } = this.account;
    this.accountText.setText(
      this.account.signedIn
        ? `Guest account · Force ${String(balances.force)} · Precision ${String(balances.precision)} · ` +
            `Motion ${String(balances.motion)} · Guard ${String(balances.guard)} · ` +
            `Signal ${String(balances.signal)}`
        : "No account configured — progress will not be saved",
    );

    this.warningText.setText(
      shouldWarnAboutAnonymousAccount({
        isAnonymous: this.account.isAnonymous,
        balances,
        unconfigured: !this.account.signedIn,
      })
        ? ANONYMOUS_ACCOUNT_WARNING
        : "",
    );

    const totalSlotCost = this.selectedIds.reduce((total, id) => {
      const skill = ALL_SKILLS.find((candidate) => candidate.id === id);
      return total + (skill?.slotCost ?? 0);
    }, 0);
    this.titleText.setText(`Choose your loadout (${String(totalSlotCost)} / 3 slots used)`);

    this.statusText.setText(this.rejectedMessage);
  }
}

function describeRejection(skillId: string, reason: SkillLoadoutRejectionReason): string {
  if (reason === "slot_budget_exceeded") {
    return `Adding "${skillId}" would exceed the 3-slot budget.`;
  }
  return `Cannot add "${skillId}" (${reason}).`;
}

/** What a locked skill costs, read from the content table rather than hard-coded here. */
function describeRequirement(skillId: string): string {
  const unlock = findUnlock(skillId);
  if (unlock?.requires == null) {
    return "not unlocked";
  }
  return `${String(unlock.requires.amount)} ${unlock.requires.category}`;
}

function describeLocked(skillId: string): string {
  return `"${skillId}" is locked — earn ${describeRequirement(skillId)} points to unlock it.`;
}
