export type Meeting = {
  id: string;
  title?: string;
  day: number;
  startHour: number;
  endHour: number;
  attendeeIds: string[];
};

/** 半開區間 [startHour, endHour) 對應的 TimeSlot 鍵（與 `day-hour` 一致） */
export function slotsForMeeting(
  day: number,
  startHour: number,
  endHour: number
): string[] {
  const out: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    out.push(`${day}-${h}`);
  }
  return out;
}

/** 與會者 memberId 在 slotKey 上被哪些會議占用（該會議時段含此格且 attendee 含此人） */
export function meetingsBlockingSlotForMember(
  meetings: Meeting[],
  memberId: string,
  slotKey: string
): Meeting[] {
  return meetings.filter((m) => {
    if (!m.attendeeIds.includes(memberId)) return false;
    const keys = slotsForMeeting(m.day, m.startHour, m.endHour);
    return keys.includes(slotKey);
  });
}

export type MemberAvailability = {
  id: string;
  name: string;
  availability: string[];
};

export type AttendeeSlotGap = {
  memberId: string;
  memberName: string;
  missingSlots: string[];
};

export function findAttendeesMissingSlots(
  members: MemberAvailability[],
  attendeeIds: string[],
  slots: string[]
): AttendeeSlotGap[] {
  const out: AttendeeSlotGap[] = [];
  for (const id of attendeeIds) {
    const m = members.find((x) => x.id === id);
    if (!m) continue;
    const missing = slots.filter((s) => !m.availability.includes(s));
    if (missing.length > 0) {
      out.push({
        memberId: m.id,
        memberName: m.name,
        missingSlots: missing,
      });
    }
  }
  return out;
}

function padHour(h: number): string {
  return h.toString().padStart(2, "0");
}

export function formatMeetingTime(m: Meeting, dayLabels: string[]): string {
  const dayLabel = dayLabels[m.day] ?? `第 ${m.day + 1} 日`;
  return `${dayLabel} ${padHour(m.startHour)}:00–${padHour(m.endHour)}:00`;
}

/** 單格空閒鍵 `d-h` → 「週三 09:00–10:00」 */
export function formatSlotLabel(slotKey: string, dayLabels: string[]): string {
  const [ds, hs] = slotKey.split("-");
  const d = Number(ds);
  const h = Number(hs);
  if (Number.isNaN(d) || Number.isNaN(h)) return slotKey;
  const dayLabel = dayLabels[d] ?? `第 ${d + 1} 日`;
  return `${dayLabel} ${padHour(h)}:00–${padHour(h + 1)}:00`;
}
