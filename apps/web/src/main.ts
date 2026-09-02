import "./style.css";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteParticipant,
  type Participant,
} from "livekit-client";

type TokenResponse = {
  token: string;
  url: string;
  identity: string;
  room: string;
  error?: string;
};

const form = document.querySelector<HTMLFormElement>("#join-form")!;
const callEl = document.querySelector<HTMLElement>("#call")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const rosterEl = document.querySelector<HTMLUListElement>("#roster")!;
const roomLabel = document.querySelector<HTMLElement>("#room-label")!;
const youLabel = document.querySelector<HTMLElement>("#you-label")!;
const muteBtn = document.querySelector<HTMLButtonElement>("#mute")!;
const hangupBtn = document.querySelector<HTMLButtonElement>("#hangup")!;
const identityInput = document.querySelector<HTMLInputElement>("#identity")!;
const roomInput = document.querySelector<HTMLInputElement>("#room")!;

let room: Room | null = null;
let micEnabled = true;

function setStatus(state: "idle" | "live" | "error", text: string) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

function showError(message: string | null) {
  if (!message) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    return;
  }
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function tagFor(participant: Participant): string {
  if (participant.isSpeaking) return "говорит";
  if (participant === room?.localParticipant) {
    return micEnabled ? "микрофон" : "без звука";
  }
  const mic = participant.getTrackPublication(Track.Source.Microphone);
  if (mic?.isMuted) return "без звука";
  return "на линии";
}

function renderRoster() {
  if (!room) return;
  const people: Participant[] = [
    room.localParticipant,
    ...Array.from(room.remoteParticipants.values()),
  ];
  rosterEl.replaceChildren(
    ...people.map((person) => {
      const li = document.createElement("li");
      const who = document.createElement("span");
      who.className = "who";
      who.textContent =
        person === room!.localParticipant
          ? `${person.name || person.identity} (вы)`
          : person.name || person.identity;
      const tag = document.createElement("span");
      tag.className = "tag";
      if (person.isSpeaking) tag.classList.add("speaking");
      tag.textContent = tagFor(person);
      li.append(who, tag);
      return li;
    }),
  );
}

function attachAudio(track: RemoteTrack, participant: RemoteParticipant) {
  const el = track.attach();
  el.dataset.identity = participant.identity;
  el.autoplay = true;
  document.body.append(el);
}

function detachAudio(identity: string) {
  document
    .querySelectorAll<HTMLMediaElement>(`audio[data-identity="${identity}"]`)
    .forEach((el) => {
      el.remove();
    });
}

async function fetchToken(identity: string, roomName: string): Promise<TokenResponse> {
  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity, room: roomName }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok) throw new Error(data.error || "Не удалось получить токен");
  return data;
}

async function connect(identity: string, roomName: string) {
  showError(null);
  setStatus("idle", "соединение…");
  const session = await fetchToken(identity, roomName);
  const next = new Room({
    adaptiveStream: true,
    dynacast: true,
  });

  next.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    if (track.kind === Track.Kind.Audio) attachAudio(track, participant);
    renderRoster();
  });
  next.on(RoomEvent.TrackUnsubscribed, (track) => track.detach());
  next.on(RoomEvent.ParticipantConnected, renderRoster);
  next.on(RoomEvent.ParticipantDisconnected, (participant) => {
    detachAudio(participant.identity);
    renderRoster();
  });
  next.on(RoomEvent.ActiveSpeakersChanged, renderRoster);
  next.on(RoomEvent.Disconnected, () => {
    cleanupUi();
    setStatus("idle", "канал свободен");
  });
  next.on(RoomEvent.Reconnecting, () => setStatus("idle", "переподключение…"));
  next.on(RoomEvent.Reconnected, () => setStatus("live", "на линии"));

  await next.connect(session.url, session.token);
  await next.localParticipant.setMicrophoneEnabled(true);
  micEnabled = true;
  room = next;

  roomLabel.textContent = session.room;
  youLabel.textContent = session.identity;
  muteBtn.textContent = "Микрофон вкл";
  form.classList.add("hidden");
  callEl.classList.remove("hidden");
  setStatus("live", "на линии");
  renderRoster();
}

function cleanupUi() {
  document.querySelectorAll("audio[data-identity]").forEach((el) => el.remove());
  room = null;
  form.classList.remove("hidden");
  callEl.classList.add("hidden");
  rosterEl.replaceChildren();
}

async function hangup() {
  if (room) {
    await room.disconnect();
  }
  cleanupUi();
  setStatus("idle", "канал свободен");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector("button[type=submit]")!;
  submit.setAttribute("disabled", "true");
  try {
    await connect(identityInput.value.trim(), roomInput.value.trim());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось подключиться";
    showError(message);
    setStatus("error", "сбой");
  } finally {
    submit.removeAttribute("disabled");
  }
});

muteBtn.addEventListener("click", async () => {
  if (!room) return;
  micEnabled = !micEnabled;
  await room.localParticipant.setMicrophoneEnabled(micEnabled);
  muteBtn.textContent = micEnabled ? "Микрофон вкл" : "Микрофон выкл";
  renderRoster();
});

hangupBtn.addEventListener("click", () => {
  void hangup();
});

window.addEventListener("beforeunload", () => {
  void room?.disconnect();
});

void (async () => {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error("api down");
  } catch {
    showError("Token API недоступен. Запустите apps/api и LiveKit.");
    setStatus("error", "нет api");
  }
})();
