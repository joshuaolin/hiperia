import {
  LEMON_PROGRAM_ID,
  validFruitNumbers,
} from "../../lib/onchain/lemonProtocol.js";
import { ORAO_PROGRAM_ID } from "../../lib/onchain/vrfProtocol.js";

const phases = { open: 0, pending: 1, fulfilled: 2, final: 3 };

export class LemonDrawProgress {
  constructor(scope = null) {
    this.scope = scope;
    this.draws = new Map();
    this.approval = null;
  }

  remember(draw) {
    if (
      !Number.isSafeInteger(draw.drawTime) ||
      draw.drawTime <= 0 ||
      !Object.hasOwn(phases, draw.status) ||
      (draw.sourceProgram && draw.sourceProgram !== LEMON_PROGRAM_ID)
    )
      throw new Error("The recorded Lemon draw state could not be verified.");
    if (
      draw.status === "final" &&
      (!draw.address || !validFruitNumbers(draw.numbers))
    )
      throw new Error("The finalized Lemon fruits could not be verified.");
    const previous = this.draws.get(draw.drawTime);
    if (!previous || phases[draw.status] >= phases[previous.status])
      this.draws.set(draw.drawTime, {
        ...previous,
        ...draw,
        sourceProgram: LEMON_PROGRAM_ID,
      });
  }

  result(draw) {
    return draw.status === "final"
      ? {
          ...draw,
          id: draw.address,
          sourceProgram: LEMON_PROGRAM_ID,
          isPublished: true,
          legacy: false,
          randomnessMode: "orao-vrf",
          oracleProgram: ORAO_PROGRAM_ID,
        }
      : null;
  }

  merge(snapshot) {
    for (const ticket of snapshot.tickets ?? []) {
      if (
        ticket.sourceProgram !== LEMON_PROGRAM_ID ||
        !ticket.draw ||
        !Object.hasOwn(phases, ticket.draw.status)
      )
        continue;
      const record = { ...ticket.draw, drawTime: ticket.drawTime };
      if (record.status === "final" && !validFruitNumbers(record.numbers))
        record.numbers = ticket.result?.numbers;
      this.remember(record);
    }
    for (const result of snapshot.results ?? []) {
      if (
        result.sourceProgram === LEMON_PROGRAM_ID &&
        result.isPublished === true
      )
        this.remember({
          ...result,
          address: result.address ?? result.id,
          status: "final",
        });
    }
    const results = new Map(
      (snapshot.results ?? []).map((result) => [
        `${result.sourceProgram}:${result.drawTime}`,
        result,
      ]),
    );
    for (const draw of this.draws.values()) {
      const result = this.result(draw);
      if (result) results.set(`${LEMON_PROGRAM_ID}:${draw.drawTime}`, result);
    }
    return {
      ...snapshot,
      results: [...results.values()].sort((a, b) => b.drawTime - a.drawTime),
      tickets: (snapshot.tickets ?? []).map((ticket) => {
        const draw =
          ticket.sourceProgram === LEMON_PROGRAM_ID
            ? this.draws.get(ticket.drawTime)
            : null;
        if (!draw || phases[ticket.draw?.status] > phases[draw.status])
          return ticket;
        return {
          ...ticket,
          draw: { ...ticket.draw, ...draw },
          ...(draw.status === "final" ? { result: this.result(draw) } : {}),
          ...(["fulfilled", "final"].includes(draw.status)
            ? { refundEligible: false }
            : {}),
        };
      }),
    };
  }
}
