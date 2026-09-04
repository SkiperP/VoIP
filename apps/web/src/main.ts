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
let micEnabled = false;

function apiUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return new URL(rel, `${window.location.origin}${base}`).toString();
}

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

function micDeniedMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Браузер заблокировал микрофон. Нажмите на иконку замка в адресной строке и разрешите микрофон, затем попробуйте снова.";
  }
  if (name === "NotFoundError") {
    return "Микрофон не найден. Подключите устройство и разрешите доступ.";
  }
  if (name === "NotReadableError") {
    return "Микрофон занят другим приложением.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Не удалось получить доступ к микрофону.";
}

async function unlockAudio(): Promise<void> {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return;
  const ctx = new Ctor();
  if (ctx.state === "suspended") await ctx.resume();
  await ctx.close();
}

async function requestMicrophone(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error(
      "Микрофон доступен только по HTTPS. Откройте https://badger-budget.ru/call/",
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Этот браузер не умеет работать с микрофоном.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

function syncMuteButton() {
  muteBtn.setAttribute("aria-pressed", micEnabled ? "false" : "true");
  muteBtn.classList.toggle("muted", !micEnabled);
  muteBtn.textContent = micEnabled
    ? "Выключить микрофон"
    : "Включить микрофон";
}

function tagFor(participant: Participant): string {
  if (participant.isSpeaking) return "говорит";
  if (participant === room?.localParticipant) {
    return micEnabled ? "микрофон" : "без звука";
  }
  const mic = participant.getTrackPublication(Track.Source.Microphone);
  if (!mic || mic.isMuted) return "без звука";
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
  el.setAttribute("playsinline", "");
  document.body.append(el);
  void el.play().catch(() => {
    /* autoplay may wait until the next user gesture */
  });
}

function detachAudio(identity: string) {
  const safe =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(identity)
      : identity.replace(/"/g, "");
  document
    .querySelectorAll<HTMLMediaElement>(`audio[data-identity="${safe}"]`)
    .forEach((el) => {
      el.remove();
    });
}

async function fetchToken(
  identity: string,
  roomName: string,
): Promise<TokenResponse> {
  const res = await fetch(apiUrl("api/token"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity, room: roomName }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok) throw new Error(data.error || "Не удалось получить токен");
  return data;
}

async function publishMicrophone(next: Room): Promise<void> {
  const publication = await next.localParticipant.setMicrophoneEnabled(true, {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
  micEnabled = Boolean(publication) && !publication.isMuted;
  if (!micEnabled) {
    throw new Error("Микрофон не опубликован. Проверьте разрешение браузера.");
  }
}

async function connect(identity: string, roomName: string) {
  showError(null);
  setStatus("idle", "запрос микрофона…");
  await unlockAudio();
  const preview = await requestMicrophone();
  preview.getTracks().forEach((track) => track.stop());

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
  next.on(RoomEvent.LocalTrackPublished, renderRoster);
  next.on(RoomEvent.TrackMuted, renderRoster);
  next.on(RoomEvent.TrackUnmuted, renderRoster);
  next.on(RoomEvent.Disconnected, () => {
    cleanupUi();
    setStatus("idle", "канал свободен");
  });
  next.on(RoomEvent.Reconnecting, () => setStatus("idle", "переподключение…"));
  next.on(RoomEvent.Reconnected, () => setStatus("live", "на линии"));

  await next.connect(session.url, session.token);
  try {
    await publishMicrophone(next);
  } catch (err) {
    micEnabled = false;
    console.warn(err);
    showError(micDeniedMessage(err));
  }
  room = next;

  roomLabel.textContent = session.room;
  youLabel.textContent = session.identity;
  syncMuteButton();
  form.classList.add("hidden");
  callEl.classList.remove("hidden");
  setStatus("live", "на линии");
  renderRoster();
}

function cleanupUi() {
  document.querySelectorAll("audio[data-identity]").forEach((el) => el.remove());
  room = null;
  micEnabled = false;
  syncMuteButton();
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
    showError(micDeniedMessage(err));
    setStatus("error", "сбой");
  } finally {
    submit.removeAttribute("disabled");
  }
});

muteBtn.addEventListener("click", async () => {
  if (!room) return;
  muteBtn.disabled = true;
  try {
    if (micEnabled) {
      await room.localParticipant.setMicrophoneEnabled(false);
      micEnabled = false;
    } else {
      await unlockAudio();
      const preview = await requestMicrophone();
      preview.getTracks().forEach((track) => track.stop());
      await publishMicrophone(room);
    }
    showError(null);
  } catch (err) {
    micEnabled = false;
    showError(micDeniedMessage(err));
  } finally {
    syncMuteButton();
    renderRoster();
    muteBtn.disabled = false;
  }
});

hangupBtn.addEventListener("click", () => {
  void hangup();
});

window.addEventListener("beforeunload", () => {
  void room?.disconnect();
});

void (async () => {
  try {
    const res = await fetch(apiUrl("api/health"));
    if (!res.ok) throw new Error("api down");
  } catch {
    showError("Token API недоступен. Запустите apps/api и LiveKit.");
    setStatus("error", "нет api");
  }
})();
