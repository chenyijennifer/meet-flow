"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Users,
  Calendar,
  User,
  CalendarCheck,
  CalendarPlus,
} from "lucide-react";
import {
  type AttendeeSlotGap,
  type Meeting,
  findAttendeesMissingSlots,
  formatMeetingTime,
  formatSlotLabel,
  meetingsBlockingSlotForMember,
  slotsForMeeting,
} from "@/lib/meetingConflicts";

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeSlot = string; // "day-hour", e.g. "0-9" = Monday 9am

type Member = {
  id: string;
  name: string;
  color: string;
  availability: TimeSlot[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ["週一", "週二", "週三", "週四", "週五"];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const COLORS = [
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-red-500",
  "bg-yellow-500",
  "bg-cyan-500",
];

const slot = (day: number, hour: number): TimeSlot => `${day}-${hour}`;

// ─── Fake initial data ────────────────────────────────────────────────────────

// 假資料：三人皆有「週三 9–11」共同空閒，方便展示
const INITIAL_MEMBERS: Member[] = [
  {
    id: "me",
    name: "我",
    color: "bg-blue-500",
    availability: [
      slot(0, 9), slot(0, 10), slot(0, 11),          // Mon 9–12
      slot(0, 14), slot(0, 15), slot(0, 16),         // Mon 14–17
      slot(2, 9),  slot(2, 10), slot(2, 11),         // Wed 9–12（共同）
      slot(3, 14), slot(3, 15), slot(3, 16),         // Thu 14–17
      slot(4, 9),  slot(4, 10),                      // Fri 9–11
    ],
  },
  {
    id: "xiao-liang",
    name: "小梁",
    color: "bg-green-500",
    availability: [
      slot(0, 9),  slot(0, 10), slot(0, 11),         // Mon 9–12
      slot(2, 9),  slot(2, 10), slot(2, 11),         // Wed 9–12（共同）
      slot(2, 14), slot(2, 15), slot(2, 16),         // Wed 14–17
      slot(4, 9),  slot(4, 10),                      // Fri 9–11
    ],
  },
  {
    id: "lu-lu",
    name: "盧盧",
    color: "bg-purple-500",
    availability: [
      slot(1, 10), slot(1, 11), slot(1, 12),         // Tue 10–13
      slot(2, 9),  slot(2, 10), slot(2, 11),         // Wed 9–12（共同）
      slot(3, 14), slot(3, 15),                      // Thu 14–16
    ],
  },
];

// 已排會議假資料（須與 INITIAL_MEMBERS 空閒一致；載入時會從與會者空閒扣格）
const INITIAL_MEETINGS: Meeting[] = [
  {
    id: "meeting-seed-sync",
    title: "產品同步",
    day: 2,
    startHour: 9,
    endHour: 11,
    attendeeIds: ["me", "xiao-liang"],
  },
];

function applyMeetingsToMembers(
  members: Member[],
  meetings: Meeting[]
): Member[] {
  return members.map((m) => {
    let availability = [...m.availability];
    for (const meet of meetings) {
      if (!meet.attendeeIds.includes(m.id)) continue;
      const slots = slotsForMeeting(
        meet.day,
        meet.startHour,
        meet.endHour
      );
      availability = availability.filter((s) => !slots.includes(s));
    }
    return { ...m, availability };
  });
}

function endHourOptions(startHour: number): number[] {
  const out: number[] = [];
  for (let h = startHour + 1; h <= 18; h++) out.push(h);
  return out;
}

function attendeeNames(ids: string[], members: Member[]): string {
  return ids
    .map((id) => members.find((m) => m.id === id)?.name ?? id)
    .join("、");
}

// ─── Schedule Grid Component ──────────────────────────────────────────────────

type DragState = {
  startDay: number;
  startHourIdx: number;
  curDay: number;
  curHourIdx: number;
  filling: boolean; // true = turning slots ON, false = turning OFF
};

function ScheduleGrid({
  availability,
  onBatchToggle,
  emerald = false,
  lockedSlotKeys,
}: {
  availability: TimeSlot[];
  onBatchToggle?: (slots: TimeSlot[], fill: boolean) => void;
  emerald?: boolean;
  /** 有會議占用且目前為忙碌：無法點回空閒（僅「我的時間表」使用） */
  lockedSlotKeys?: Set<string>;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragging = useRef(false);

  // Commit the selection when mouse is released anywhere
  useEffect(() => {
    function handleMouseUp() {
      if (!dragging.current || !drag) return;
      const d0 = Math.min(drag.startDay, drag.curDay);
      const d1 = Math.max(drag.startDay, drag.curDay);
      const h0 = Math.min(drag.startHourIdx, drag.curHourIdx);
      const h1 = Math.max(drag.startHourIdx, drag.curHourIdx);
      const selected: TimeSlot[] = [];
      for (let d = d0; d <= d1; d++)
        for (let hi = h0; hi <= h1; hi++)
          selected.push(slot(d, HOURS[hi]));
      onBatchToggle?.(selected, drag.filling);
      dragging.current = false;
      setDrag(null);
    }
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [drag, onBatchToggle]);

  function inDragRect(d: number, hi: number): boolean {
    if (!drag) return false;
    const d0 = Math.min(drag.startDay, drag.curDay);
    const d1 = Math.max(drag.startDay, drag.curDay);
    const h0 = Math.min(drag.startHourIdx, drag.curHourIdx);
    const h1 = Math.max(drag.startHourIdx, drag.curHourIdx);
    return d >= d0 && d <= d1 && hi >= h0 && hi <= h1;
  }

  return (
    <div className="overflow-x-auto select-none">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="w-14" />
            {DAYS.map((d) => (
              <th key={d} className="p-2 text-center font-medium text-sm">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h, hi) => (
            <tr key={h}>
              <td className="text-right pr-3 text-muted-foreground text-xs py-0.5 whitespace-nowrap">
                {h}:00
              </td>
              {DAYS.map((_, d) => {
                const s = slot(d, h);
                const active = availability.includes(s);
                const locked = Boolean(lockedSlotKeys?.has(s) && !active);
                const inRect = inDragRect(d, hi);

                let cellClass: string;
                if (inRect) {
                  // Preview: show what the result will be
                  cellClass = drag!.filling
                    ? "bg-primary/60 border-primary/60"
                    : "bg-muted border-border opacity-40";
                } else if (active) {
                  cellClass = emerald
                    ? "bg-emerald-400 border-emerald-400"
                    : "bg-primary border-primary";
                } else if (locked) {
                  cellClass =
                    "bg-muted border-border ring-1 ring-amber-500/45 dark:ring-amber-400/40";
                } else {
                  cellClass = "bg-muted border-border hover:bg-muted/60";
                }

                const cursorClass = !onBatchToggle
                  ? "cursor-default"
                  : locked
                    ? "cursor-not-allowed"
                    : "cursor-pointer";

                return (
                  <td key={d} className="p-0.5">
                    <div
                      title={
                        locked
                          ? "此時段已排入會議，無法改為空閒"
                          : undefined
                      }
                      className={`h-8 rounded border transition-colors ${cellClass} ${cursorClass}`}
                      onMouseDown={(e) => {
                        if (!onBatchToggle) return;
                        if (locked) return;
                        e.preventDefault();
                        dragging.current = true;
                        setDrag({
                          startDay: d,
                          startHourIdx: hi,
                          curDay: d,
                          curHourIdx: hi,
                          filling: !active,
                        });
                      }}
                      onMouseOver={() => {
                        if (!dragging.current) return;
                        setDrag((prev) =>
                          prev ? { ...prev, curDay: d, curHourIdx: hi } : prev
                        );
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex gap-4 mb-5 text-xs text-muted-foreground">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <div className={`w-3 h-3 rounded ${item.color}`} />
          {item.label}
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function MeetFlow() {
  const [meetings, setMeetings] = useState<Meeting[]>(
    () => INITIAL_MEETINGS.map((m) => ({ ...m }))
  );
  const [members, setMembers] = useState<Member[]>(() =>
    applyMeetingsToMembers(INITIAL_MEMBERS, INITIAL_MEETINGS)
  );
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState("xiao-liang");

  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDay, setMeetingDay] = useState(2);
  const [meetingStart, setMeetingStart] = useState(9);
  const [meetingEnd, setMeetingEnd] = useState(11);
  const [selectedAttendeeIds, setSelectedAttendeeIds] = useState<string[]>([
    "me",
  ]);

  const [availabilityDialogOpen, setAvailabilityDialogOpen] = useState(false);
  const [availabilityGaps, setAvailabilityGaps] = useState<AttendeeSlotGap[]>(
    []
  );
  const [scheduleBlockedDialogOpen, setScheduleBlockedDialogOpen] =
    useState(false);
  const [scheduleBlockingMeetings, setScheduleBlockingMeetings] = useState<
    Meeting[]
  >([]);
  const [meetingSuccessNotice, setMeetingSuccessNotice] = useState<
    string | null
  >(null);

  const me = members.find((m) => m.id === "me")!;
  const others = members.filter((m) => m.id !== "me");
  const viewing = members.find((m) => m.id === viewId) ?? others[0];

  const commonSlots = DAYS.flatMap((_, d) =>
    HOURS.filter((h) =>
      members.every((m) => m.availability.includes(slot(d, h)))
    ).map((h) => slot(d, h))
  );

  const myMeetingLockedSlots = useMemo(() => {
    const out = new Set<string>();
    for (const m of meetings) {
      if (!m.attendeeIds.includes("me")) continue;
      for (const sk of slotsForMeeting(
        m.day,
        m.startHour,
        m.endHour
      )) {
        if (!me.availability.includes(sk)) out.add(sk);
      }
    }
    return out;
  }, [meetings, me.availability]);

  useEffect(() => {
    if (!meetingSuccessNotice) return;
    const t = setTimeout(() => setMeetingSuccessNotice(null), 4500);
    return () => clearTimeout(t);
  }, [meetingSuccessNotice]);

  function batchToggleMySlots(slots: TimeSlot[], fill: boolean) {
    if (fill) {
      const lockedSelected = slots.filter((s) => myMeetingLockedSlots.has(s));
      if (lockedSelected.length > 0) {
        const blockingMap = new Map<string, Meeting>();
        for (const sk of lockedSelected) {
          for (const bm of meetingsBlockingSlotForMember(
            meetings,
            "me",
            sk
          )) {
            blockingMap.set(bm.id, bm);
          }
        }
        setScheduleBlockingMeetings([...blockingMap.values()]);
        setScheduleBlockedDialogOpen(true);
        return;
      }
    }

    setMembers((prev) =>
      prev.map((m) =>
        m.id !== "me"
          ? m
          : {
              ...m,
              availability: fill
                ? [...new Set([...m.availability, ...slots])]
                : m.availability.filter((x) => !slots.includes(x)),
            }
      )
    );
  }

  function addMember() {
    const name = newName.trim();
    if (!name) return;
    const color = COLORS[members.length % COLORS.length];
    const newMember: Member = {
      id: `member-${Date.now()}`,
      name,
      color,
      availability: [],
    };
    setMembers((prev) => [...prev, newMember]);
    setNewName("");
    setOpen(false);
  }

  function toggleMeetingAttendee(id: string) {
    setSelectedAttendeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function onMeetingStartChange(next: number) {
    setMeetingStart(next);
    setMeetingEnd((end) => {
      const opts = endHourOptions(next);
      if (opts.includes(end) && end > next) return end;
      return opts[0] ?? next + 1;
    });
  }

  const meetingEndChoices = endHourOptions(meetingStart);
  const meetingFormValid =
    selectedAttendeeIds.length > 0 &&
    meetingStart < meetingEnd &&
    meetingEndChoices.includes(meetingEnd);

  function submitNewMeeting() {
    if (!meetingFormValid) return;
    const slots = slotsForMeeting(meetingDay, meetingStart, meetingEnd);
    const gaps = findAttendeesMissingSlots(
      members,
      selectedAttendeeIds,
      slots
    );
    if (gaps.length > 0) {
      setAvailabilityGaps(gaps);
      setAvailabilityDialogOpen(true);
      return;
    }
    const newMeeting: Meeting = {
      id: `meeting-${Date.now()}`,
      title: meetingTitle.trim() || undefined,
      day: meetingDay,
      startHour: meetingStart,
      endHour: meetingEnd,
      attendeeIds: selectedAttendeeIds,
    };
    setMeetings((prev) => [...prev, newMeeting]);
    setMembers((prev) =>
      prev.map((m) => {
        if (!selectedAttendeeIds.includes(m.id)) return m;
        return {
          ...m,
          availability: m.availability.filter((s) => !slots.includes(s)),
        };
      })
    );
    setMeetingSuccessNotice(
      `已建立會議：${formatMeetingTime(newMeeting, DAYS)}${
        newMeeting.title ? `（${newMeeting.title}）` : ""
      }`
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <CalendarCheck className="w-5 h-5" />
          <h1 className="text-lg font-semibold tracking-tight">MeetFlow</h1>
          <Badge variant="secondary" className="text-xs font-normal">
            Beta
          </Badge>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <Tabs defaultValue="members">
          <TabsList className="mb-8 h-10">
            <TabsTrigger value="members" className="gap-1.5 text-sm">
              <Users className="w-3.5 h-3.5" />
              成員
            </TabsTrigger>
            <TabsTrigger value="my-schedule" className="gap-1.5 text-sm">
              <User className="w-3.5 h-3.5" />
              我的時間表
            </TabsTrigger>
            <TabsTrigger value="view-member" className="gap-1.5 text-sm">
              <Calendar className="w-3.5 h-3.5" />
              查看成員
            </TabsTrigger>
            <TabsTrigger value="create-meeting" className="gap-1.5 text-sm">
              <CalendarPlus className="w-3.5 h-3.5" />
              建立會議
            </TabsTrigger>
            <TabsTrigger value="common" className="gap-1.5 text-sm">
              <CalendarCheck className="w-3.5 h-3.5" />
              共同空閒
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Members ── */}
          <TabsContent value="members">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-semibold">成員列表</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  共 {members.length} 位成員
                </p>
              </div>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="w-4 h-4" />
                    加入成員
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-xs">
                  <DialogHeader>
                    <DialogTitle>加入新成員</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-3 mt-2">
                    <Input
                      placeholder="輸入成員名稱"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addMember()}
                      autoFocus
                    />
                    <Button onClick={addMember} disabled={!newName.trim()}>
                      確認加入
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {members.map((m) => (
                <Card key={m.id}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <Avatar className="w-10 h-10 shrink-0">
                      <AvatarFallback
                        className={`${m.color} text-white text-sm font-semibold`}
                      >
                        {m.name[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.availability.length} 個空閒時段
                      </p>
                    </div>
                    {m.id === "me" && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        你
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ── Tab 2: My Schedule ── */}
          <TabsContent value="my-schedule">
            <div className="mb-5">
              <h2 className="text-base font-semibold">我的時間表</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                點擊或拖曳選取矩形範圍來批次切換空閒時段
              </p>
            </div>
            <Card>
              <CardContent className="pt-6">
                <Legend
                  items={[
                    { color: "bg-primary", label: "空閒" },
                    { color: "bg-muted border border-border", label: "忙碌" },
                    {
                      color:
                        "bg-muted ring-1 ring-amber-500/45 dark:ring-amber-400/40",
                      label: "會議占用（無法改回空閒）",
                    },
                  ]}
                />
                <ScheduleGrid
                  availability={me.availability}
                  onBatchToggle={batchToggleMySlots}
                  lockedSlotKeys={myMeetingLockedSlots}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 3: View Member ── */}
          <TabsContent value="view-member">
            <div className="mb-5">
              <h2 className="text-base font-semibold">查看成員時間表</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                選擇成員來查看他們的空閒時段
              </p>
            </div>

            {others.length === 0 ? (
              <p className="text-muted-foreground text-sm py-12 text-center">
                尚無其他成員，請先在「成員」頁加入
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-5">
                  {others.map((m) => (
                    <Button
                      key={m.id}
                      variant={viewing?.id === m.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setViewId(m.id)}
                    >
                      {m.name}
                    </Button>
                  ))}
                </div>

                {viewing && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <Avatar className="w-7 h-7">
                          <AvatarFallback
                            className={`${viewing.color} text-white text-xs font-semibold`}
                          >
                            {viewing.name[0]}
                          </AvatarFallback>
                        </Avatar>
                        {viewing.name} 的時間表
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Legend
                        items={[
                          { color: "bg-primary", label: "空閒" },
                          {
                            color: "bg-muted border border-border",
                            label: "忙碌",
                          },
                        ]}
                      />
                      <ScheduleGrid availability={viewing.availability} />
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Tab: Create meeting（空閒同步） ── */}
          <TabsContent value="create-meeting">
            <div className="mb-5">
              <h2 className="text-base font-semibold">建立會議</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                單日連續時段：僅當每位與會者在所選時段皆為空閒時可建立；建立後該時段會從其空閒中移除（改為忙碌）
              </p>
            </div>

            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  新會議
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="meeting-title" className="text-sm font-medium">
                    標題（選填）
                  </label>
                  <Input
                    id="meeting-title"
                    placeholder="例如：專案檢討"
                    value={meetingTitle}
                    onChange={(e) => setMeetingTitle(e.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <span className="text-sm font-medium">星期</span>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={meetingDay}
                      onChange={(e) =>
                        setMeetingDay(Number(e.target.value))
                      }
                    >
                      {DAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <span className="text-sm font-medium">開始小時</span>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={meetingStart}
                      onChange={(e) =>
                        onMeetingStartChange(Number(e.target.value))
                      }
                    >
                      {HOURS.map((h) => (
                        <option key={h} value={h}>
                          {h}:00
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <span className="text-sm font-medium">結束小時</span>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={meetingEnd}
                      onChange={(e) =>
                        setMeetingEnd(Number(e.target.value))
                      }
                    >
                      {meetingEndChoices.map((h) => (
                        <option key={h} value={h}>
                          {h}:00
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  時間為半開區間：含開始、不含結束（與網格「h:00–h+1:00」一致）
                </p>

                <div className="space-y-2">
                  <span className="text-sm font-medium">與會者</span>
                  <p className="text-xs text-muted-foreground">
                    至少選擇一位；任一人若在所選時段有任何一格非空閒，將無法建立
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => {
                      const on = selectedAttendeeIds.includes(m.id);
                      return (
                        <Button
                          key={m.id}
                          type="button"
                          variant={on ? "default" : "outline"}
                          size="sm"
                          onClick={() => toggleMeetingAttendee(m.id)}
                        >
                          {m.name}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={submitNewMeeting}
                  disabled={!meetingFormValid}
                >
                  建立會議
                </Button>
                {meetingSuccessNotice ? (
                  <p
                    role="status"
                    className="text-sm rounded-md border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                  >
                    {meetingSuccessNotice}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <div>
              <h3 className="text-sm font-semibold mb-3">已排會議</h3>
              {meetings.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚無會議</p>
              ) : (
                <ul className="space-y-2">
                  {meetings.map((m) => (
                    <li key={m.id}>
                      <Card>
                        <CardContent className="p-4 text-sm">
                          <p className="font-medium">
                            {m.title ?? "（無標題）"}
                          </p>
                          <p className="text-muted-foreground mt-1">
                            {formatMeetingTime(m, DAYS)}
                          </p>
                          <p className="text-muted-foreground mt-1">
                            與會：{attendeeNames(m.attendeeIds, members)}
                          </p>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          {/* ── Tab 4: Common Availability ── */}
          <TabsContent value="common">
            <div className="mb-5">
              <h2 className="text-base font-semibold">共同空閒時間</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                所有 {members.length} 位成員都空閒的時段
              </p>
            </div>

            <Card>
              <CardContent className="pt-6">
                <Legend
                  items={[
                    { color: "bg-emerald-400", label: "共同空閒" },
                    { color: "bg-muted border border-border", label: "非共同" },
                  ]}
                />
                {commonSlots.length === 0 ? (
                  <p className="text-center text-muted-foreground py-10 text-sm">
                    目前沒有共同空閒時段
                  </p>
                ) : (
                  <ScheduleGrid availability={commonSlots} emerald />
                )}
              </CardContent>
            </Card>

            {commonSlots.length > 0 && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {commonSlots.map((s) => {
                  const [d, h] = s.split("-").map(Number);
                  return (
                    <div
                      key={s}
                      className="text-sm px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-200"
                    >
                      {DAYS[d]} {h}:00–{h + 1}:00
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog
        open={scheduleBlockedDialogOpen}
        onOpenChange={setScheduleBlockedDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>無法標示為空閒</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            以下會議已占用此時段，無法將該格改回空閒。
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm">
            {scheduleBlockingMeetings.map((m) => (
              <li key={m.id}>
                <span className="font-medium text-foreground">
                  {formatMeetingTime(m, DAYS)}
                </span>
                {m.title ? (
                  <span className="text-muted-foreground"> — {m.title}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog
        open={availabilityDialogOpen}
        onOpenChange={setAvailabilityDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>所選時段非全員空閒</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            以下成員在部分所選時段沒有空閒，請調整時段或與會者後再建立。
          </p>
          <ul className="space-y-3 text-sm">
            {availabilityGaps.map((g) => (
              <li key={g.memberId}>
                <span className="font-medium text-foreground">
                  {g.memberName}
                </span>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground text-xs space-y-0.5">
                  {g.missingSlots.map((s) => (
                    <li key={s}>{formatSlotLabel(s, DAYS)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
