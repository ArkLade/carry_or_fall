/**
 * **Exit criterion 1 for §38 M6, in real browsers: "a party joins one room
 * together."**
 *
 * Three independent browser contexts — three Chromiums, three storages, three
 * sockets — form a party of three and enter one match. Nothing here inspects
 * server internals: each page is driven with real keyboard input and every
 * assertion reads that page's own view of the authoritative state, so what is
 * proven is what three humans at three machines would see.
 *
 * The assertion is deliberately **"they are in one room"**, not "they all
 * connected": three clients that each reached a match of their own would pass
 * the weaker check while failing the milestone. Each page is required to see the
 * same three player ids, to find its own among them, and to be told exactly the
 * other two as its teammates.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  createParty,
  getLocalPlayerId,
  getParty,
  getPartyMemberIds,
  getPrivateState,
  getSnapshot,
  gotoGame,
  joinPartyByCode,
  pressKey,
  waitForActiveScene,
  waitForMatchRunning,
  waitForPartyMemberMarkers,
  waitForPartySize,
} from "./helpers";

/** A second and third fully independent context — the closest thing to another machine. */
async function openClient(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe("a party of three plays one match (§38 M6 exit criterion 1)", () => {
  test("three browsers form a party and land in one room together", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const second = await openClient(browser);
    const third = await openClient(browser);
    const pages = [page, second, third];

    try {
      for (const client of pages) {
        await gotoGame(client);
      }

      // One creates; the other two type the code, exactly as a human reading it
      // off a friend's screen would.
      const joinCode = await createParty(page);
      expect(joinCode).toMatch(/^[0-9A-Z]{8}$/);
      await joinPartyByCode(second, joinCode);
      await joinPartyByCode(third, joinCode);

      for (const client of pages) {
        await waitForPartySize(client, 3, 60_000);
      }

      // Exactly one leader, and it is the client that created the party.
      const leaderView = (await getParty(page))!;
      expect(leaderView.members.filter((member) => member.isLeader)).toHaveLength(1);

      // The leader starts the party's match. Every member's client is brought to
      // the front in turn so its animation frame is not throttled while it takes
      // the seat the server reserved for it.
      await pressKey(page, "Enter");
      for (const client of pages) {
        await client.bringToFront();
        await waitForActiveScene(client, "play", 60_000);
      }
      for (const client of pages) {
        await waitForMatchRunning(client);
      }

      // One room, asserted from each client's own view of it.
      const snapshots = await Promise.all(pages.map((client) => getSnapshot(client)));
      const ids = await Promise.all(pages.map((client) => getLocalPlayerId(client)));
      const expected = [...ids].sort();

      for (const [index, snapshot] of snapshots.entries()) {
        expect(snapshot.players).toHaveLength(3);
        expect(snapshot.players.map((player) => player.id).sort()).toEqual(expected);
        expect(expected).toContain(ids[index]);
        // Same match, not merely three matches with three players each.
        expect(snapshot.seed).toBe(snapshots[0]!.seed);
        expect(snapshot.arenaId).toBe(snapshots[0]!.arenaId);
      }
      expect(new Set(ids).size).toBe(3);

      // Each client is told exactly its own two teammates — and never itself.
      // Waited for rather than read once: the marker list arrives in a message,
      // and a message that has not arrived yet is not the same as a wrong one.
      for (const [index, client] of pages.entries()) {
        await waitForPartyMemberMarkers(client, 2, 30_000);
        const markers = await getPartyMemberIds(client);
        expect([...markers].sort()).toEqual(expected.filter((id) => id !== ids[index]));
        expect(markers).not.toContain(ids[index]);
      }
    } finally {
      await second.context().close();
      await third.context().close();
    }
  });

  test("party members keep separate inventories inside one match", async ({ page, browser }) => {
    // §38 M6's second exit criterion, seen from the browser. The adversarial
    // half — one member trying to *take* another's things — is
    // `apps/server/test/party-isolation.test.ts`, which can send payloads a
    // browser client has no way to produce.
    test.setTimeout(180_000);
    const second = await openClient(browser);
    const third = await openClient(browser);
    const pages = [page, second, third];

    try {
      for (const client of pages) {
        await gotoGame(client);
      }
      const joinCode = await createParty(page);
      await joinPartyByCode(second, joinCode);
      await joinPartyByCode(third, joinCode);
      for (const client of pages) {
        await waitForPartySize(client, 3, 60_000);
      }

      await pressKey(page, "Enter");
      for (const client of pages) {
        await client.bringToFront();
        await waitForActiveScene(client, "play", 60_000);
      }
      for (const client of pages) {
        await waitForMatchRunning(client);
      }

      // Three private states, three separate empty inventories, each describing
      // only its own owner. The public snapshot every client receives carries no
      // inventory at all — there is no field for one.
      const states = await Promise.all(pages.map((client) => getPrivateState(client)));
      const ids = await Promise.all(pages.map((client) => getLocalPlayerId(client)));
      for (const [index, state] of states.entries()) {
        expect(state.playerId).toBe(ids[index]);
        expect(state.inventory).toHaveLength(6);
        expect(state.secureSlotItemId).toBeNull();
      }

      const snapshot = await getSnapshot(page);
      const serialized = JSON.stringify(snapshot.players);
      expect(serialized).not.toContain("inventory");
      expect(serialized).not.toContain("secureSlot");
      expect(serialized).not.toContain("party");
    } finally {
      await second.context().close();
      await third.context().close();
    }
  });
});
