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
import {
  isPartyJoinCode,
  MAX_PARTY_SIZE,
  PARTY_CODE_ALPHABET,
  PARTY_CODE_LENGTH,
  type SettlementMessage,
} from "@carry-or-fall/protocol";
import {
  createSkillLoadout,
  type SkillLoadoutRejectionReason,
} from "@carry-or-fall/simulation-core";

import { signInAndLoadAccount, UNCONFIGURED_ACCOUNT, type AccountState } from "../account/account";
import {
  ANONYMOUS_ACCOUNT_WARNING,
  shouldWarnAboutAnonymousAccount,
} from "../account/linking-warning";
import { loadClientEnv } from "../config/env";
import { partyConnection } from "../party/party-connection";

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

const PARTY_COLOR = "#3fb950";
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
  private partyText!: Phaser.GameObjects.Text;
  /**
   * The code being typed, or `null` when not entering one. While it is a
   * string the digit keys belong to the code rather than to the skill toggles —
   * otherwise typing a code would silently rebuild the loadout.
   */
  private codeEntry: string | null = null;
  private partyKeyHandler: ((event: KeyboardEvent) => void) | null = null;
  /**
   * True while a create-or-join round trip is in flight.
   *
   * Without it, the Enter that submits a join code would also be seen by
   * `update()` on the next frame — the code entry closes synchronously, but the
   * party does not exist until the server answers — and the player would be
   * dropped into a **solo** match a moment before their party formed. Found
   * exactly that way: three browsers formed a party and two of them were
   * already in a match of their own by the time the leader queued.
   */
  private openingParty = false;

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

    this.partyText = this.add
      .text(camera.centerX, camera.height - 250, "", {
        fontFamily: BASE_FONT,
        fontSize: "14px",
        color: PARTY_COLOR,
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

    // Typed characters for the join code arrive as DOM key events rather than
    // through polled `Key` objects: a code is text, and Phaser's edge-triggered
    // per-frame reads would need thirty-six registered keys to spell one.
    this.partyKeyHandler = (event: KeyboardEvent) => {
      this.handlePartyKey(event);
    };
    keyboard.on("keydown", this.partyKeyHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.partyKeyHandler !== null) {
        keyboard.off("keydown", this.partyKeyHandler);
        this.partyKeyHandler = null;
      }
    });

    this.add
      .text(
        camera.centerX,
        camera.height - 40,
        "1-0: toggle a skill · Enter: start run · P: create party · J: join by code",
        {
          fontFamily: BASE_FONT,
          fontSize: "14px",
          color: MUTED_COLOR,
        },
      )
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
    // A seat the party queue reserved for this client. Arriving with one means
    // the whole party has already been seated together, so this screen's job is
    // done — it hands the reservation to `PlayScene` and steps aside (M6).
    if (partyConnection.hasSeat()) {
      const seatReservation = partyConnection.takeSeat();
      this.scene.start("play", {
        skillLoadoutIds: [...this.selectedIds],
        account: this.account,
        seatReservation,
      });
      return;
    }

    // The panel is refreshed every frame rather than on a local event: the code
    // countdown ticks and the roster changes because of what *other people*
    // do, neither of which this scene hears about as an input. `setText`
    // early-returns on an unchanged string, so this costs one comparison.
    this.partyText.setText(this.describeParty());

    // While a code is being typed the digits spell the code, not the loadout.
    if (this.codeEntry === null) {
      for (let i = 0; i < this.digitKeys.length; i += 1) {
        if (Phaser.Input.Keyboard.JustDown(this.digitKeys[i]!)) {
          this.toggleSkill(i);
        }
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
      if (this.codeEntry !== null || this.openingParty) {
        // Either the player is typing a code (Enter submits it, in the key
        // handler that sees the same press), or a party is being formed right
        // now. Starting a solo run in either case would be the opposite of what
        // they asked for.
        return;
      }

      // Enter keeps its meaning — start a run — and in a party that means
      // starting the party's run. Only the leader can (technical plan §8.4
      // step 4); the server checks that too, and refuses.
      const party = partyConnection.getParty();
      if (party !== null) {
        if (partyConnection.isLeader()) {
          partyConnection.queueMatch();
          this.rejectedMessage = "";
        } else {
          this.rejectedMessage = "Your party leader starts the match.";
        }
        this.render();
        return;
      }

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

  /**
   * Party keys, and the join-code text entry (M6).
   *
   * `P` creates a party, `J` starts typing a code, `L` leaves, `R` mints a new
   * code (leader only). While a code is being typed the alphabet keys append to
   * it, Backspace deletes, Enter submits, and Escape cancels — which is why the
   * digit-to-skill toggles above are suppressed for the duration.
   *
   * Nothing here decides anything about the party. Every one of these sends a
   * fieldless command, or a code, and renders what the server sends back.
   */
  private handlePartyKey(event: KeyboardEvent): void {
    if (this.codeEntry !== null) {
      this.handleCodeEntryKey(event);
      return;
    }

    const key = event.key.toUpperCase();
    const party = partyConnection.getParty();
    if (key === "P" && party === null) {
      void this.openParty(null);
    } else if (key === "J" && party === null) {
      this.codeEntry = "";
      this.render();
    } else if (key === "L" && party !== null) {
      void partyConnection.leave().then(() => {
        this.renderIfActive();
      });
    } else if (key === "R" && partyConnection.isLeader()) {
      partyConnection.refreshJoinCode();
    }
  }

  private handleCodeEntryKey(event: KeyboardEvent): void {
    const entry = this.codeEntry ?? "";
    if (event.key === "Escape") {
      this.codeEntry = null;
    } else if (event.key === "Backspace") {
      this.codeEntry = entry.slice(0, -1);
    } else if (event.key === "Enter") {
      // This same keypress reaches `update()` on the next frame, where Enter
      // means "start a run". Swallow it either way: the player pressed Enter to
      // submit a code, not to start a solo match.
      this.awaitingStartKeyRelease = true;
      if (isPartyJoinCode(entry)) {
        this.codeEntry = null;
        void this.openParty(entry);
        return;
      }
      // Refused here rather than sent: a malformed code is a typo, and telling
      // the player so beats a round trip that says the same thing.
      this.rejectedMessage = `A party code is ${String(PARTY_CODE_LENGTH)} characters from ${PARTY_CODE_ALPHABET}.`;
    } else if (event.key.length === 1 && entry.length < PARTY_CODE_LENGTH) {
      const character = event.key.toUpperCase();
      // Uppercasing is presentation, not protocol: the alphabet is uppercase,
      // and a player who types their code in lowercase meant the same code.
      if (PARTY_CODE_ALPHABET.includes(character)) {
        this.codeEntry = entry + character;
      }
    }
    this.render();
  }

  /** Create (`null`) or join (a code) a party, carrying this screen's loadout in. */
  private async openParty(joinCode: string | null): Promise<void> {
    this.openingParty = true;
    try {
      const env = loadClientEnv();
      await partyConnection.open({
        serverUrl: env.serverUrl,
        buildVersion: env.buildVersion,
        // The loadout chosen on this screen is what the member will carry into
        // the match, so it is validated at the party door (D38's join-options
        // rule, one step earlier).
        skillLoadoutIds: [...this.selectedIds],
        accessToken: this.account.accessToken,
        joinCode,
      });
      this.rejectedMessage = "";
    } catch (error) {
      this.rejectedMessage =
        partyConnection.getMessage() ?? (error instanceof Error ? error.message : String(error));
    } finally {
      this.openingParty = false;
    }
    this.renderIfActive();
  }

  private renderIfActive(): void {
    if (this.scene.isActive()) {
      this.render();
    }
  }

  /** The party panel: roster, code, status, and what the keys do right now. */
  private describeParty(): string {
    if (this.codeEntry !== null) {
      const typed = this.codeEntry.padEnd(PARTY_CODE_LENGTH, "_");
      return `Join a party — type the code: ${typed}
Enter: join · Backspace: delete · Escape: cancel`;
    }

    const party = partyConnection.getParty();
    if (party === null) {
      return `Solo — P: create a party (up to ${String(MAX_PARTY_SIZE)}) · J: join with a code`;
    }

    const roster = party.members
      .map(
        (member) =>
          `${member.isLeader ? "★" : "·"} ${member.displayName}${member.connected ? "" : " (offline)"}`,
      )
      .join("   ");
    const seconds = Math.ceil(party.joinCodeExpiresInMs / 1000);
    const code =
      seconds > 0 ? `Code ${party.joinCode} (${String(seconds)}s)` : `Code expired — R: new code`;
    const action = partyConnection.isLeader()
      ? "Enter: start the party's match · R: new code · L: leave"
      : "Waiting for your leader · L: leave";
    return `Party (${String(party.members.length)}/${String(MAX_PARTY_SIZE)}) — ${code}
${roster}
${party.status === "queued" ? "Finding a match…" : action}`;
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

    this.partyText.setText(this.describeParty());

    this.statusText.setText(this.rejectedMessage || (partyConnection.getMessage() ?? ""));
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
