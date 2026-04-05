import { z } from "zod";

/** One row per role–member pair; same `position_label` may repeat for multiple servers. */
export const liturgySlotSchema = z.object({
  position_label: z.string().trim().min(1).max(80),
  member_id: z.string().uuid(),
});

export const liturgySlotsBodySchema = z.object({
  slots: z.array(liturgySlotSchema).max(48),
});
