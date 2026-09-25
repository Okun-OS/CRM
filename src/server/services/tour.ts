import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";

/**
 * Die Produkttour — der Zustand, nicht der Inhalt.
 *
 * Was die Tour zeigt, steht im Client (`src/components/tour/tour-chapters.ts`).
 * Hier liegt nur, wie weit jemand gekommen ist. Der Zustand hängt am Menschen,
 * nicht an der Organisation: Wer die Einführung einmal gesehen hat, soll sie
 * nach einem Gerätewechsel nicht erneut bekommen.
 */

/**
 * Fassung der ausgelieferten Tour. Erhöhen, wenn die Tour so weit überarbeitet
 * wurde, dass sie auch erfahrenen Nutzern erneut angeboten werden soll — nicht
 * bei jeder Textkorrektur.
 */
export const TOUR_VERSION = 1;

export const tourProgressSchema = z.object({
  chapter: z.string().trim().min(1).max(60),
  step: z.coerce.number().int().min(0).max(200),
});

export const tourUpdateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("running"), progress: tourProgressSchema }),
  z.object({ status: z.literal("finished") }),
  z.object({ status: z.literal("restart") }),
]);

export type TourState = {
  /** Welche Fassung ausgeliefert wird. */
  version: number;
  /** Bis zu welcher Fassung dieser Mensch sie gesehen hat. */
  seenVersion: number;
  /** Ob sie jetzt von selbst starten soll. */
  shouldStart: boolean;
  /** Wo weitergemacht wird, falls unterbrochen. */
  progress: z.infer<typeof tourProgressSchema> | null;
  finishedAt: string | null;
};

function readProgress(value: unknown): z.infer<typeof tourProgressSchema> | null {
  const parsed = tourProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getTourState(ctx: ActorContext): Promise<TourState> {
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { tourSeenVersion: true, tourProgress: true, tourFinishedAt: true },
  });

  const seenVersion = user?.tourSeenVersion ?? 0;
  return {
    version: TOUR_VERSION,
    seenVersion,
    shouldStart: seenVersion < TOUR_VERSION,
    progress: readProgress(user?.tourProgress),
    finishedAt: user?.tourFinishedAt?.toISOString() ?? null,
  };
}

/**
 * Nimmt den Fortschritt entgegen.
 *
 * `finished` deckt beenden und abbrechen gleichermaßen ab: Beides bedeutet,
 * dass diese Fassung gesehen wurde und nicht erneut von selbst starten soll.
 * Ob jemand durchgegangen ist oder abgebrochen hat, ändert nichts daran, was
 * die Anwendung danach tut — und wäre nur eine Kennzahl, die wir hier nicht
 * erheben.
 */
export async function updateTourState(
  ctx: ActorContext,
  input: z.input<typeof tourUpdateSchema>,
): Promise<TourState> {
  const data = tourUpdateSchema.parse(input);

  if (data.status === "running") {
    await prisma.user.update({
      where: { id: ctx.userId },
      data: { tourProgress: data.progress },
    });
  } else if (data.status === "finished") {
    await prisma.user.update({
      where: { id: ctx.userId },
      data: { tourSeenVersion: TOUR_VERSION, tourProgress: Prisma.DbNull, tourFinishedAt: new Date() },
    });
  } else {
    // Neu starten: Fortschritt zurücksetzen, aber die gesehene Fassung stehen
    // lassen — die Tour soll danach nicht wieder unaufgefordert aufspringen.
    await prisma.user.update({
      where: { id: ctx.userId },
      data: { tourProgress: Prisma.DbNull },
    });
  }

  return getTourState(ctx);
}
