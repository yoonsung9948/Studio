import { renderSnapshot } from "../domain/cut";

export type RenderInput = ReturnType<typeof renderSnapshot>;
export interface RenderOptions {
  signal: AbortSignal;
  onProgress(value: number): void;
}

function ready(
  element: HTMLMediaElement | HTMLImageElement,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const success = () => {
        clean();
        resolve();
      },
      failure = () => {
        clean();
        reject(Error("A source file could not be loaded for rendering."));
      };
    const abort = () => {
      clean();
      reject(new DOMException("Render canceled", "AbortError"));
    };
    const event = element instanceof HTMLImageElement ? "load" : "loadeddata";
    const clean = () => {
      element.removeEventListener(event, success);
      element.removeEventListener("error", failure);
      signal.removeEventListener("abort", abort);
    };
    element.addEventListener(event, success, { once: true });
    element.addEventListener("error", failure, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function verifyOutput(blob: Blob, seconds: number, signal: AbortSignal) {
  const video = document.createElement("video"),
    url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        video.onloadedmetadata = null;
        video.onerror = null;
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const abort = () =>
        fail(new DOMException("Render canceled", "AbortError"));
      const timeout = setTimeout(
        () =>
          fail(
            Error(
              "The encoded video could not be verified. Try rendering again.",
            ),
          ),
        15000,
      );
      video.onerror = () =>
        fail(Error("The encoded video cannot be played. Try rendering again."));
      video.onloadedmetadata = () => {
        // WebM may report Infinity until playback; MP4 must have its full duration.
        if (
          !video.videoWidth ||
          (Number.isFinite(video.duration) &&
            Math.abs(video.duration - seconds) > 0.5)
        ) {
          fail(
            Error(
              "The encoded video is incomplete. Keep the studio open and try rendering again.",
            ),
          );
        } else {
          cleanup();
          resolve();
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      video.preload = "metadata";
      video.src = url;
      if (signal.aborted) abort();
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Render the immutable cut with the browser's native encoder, including its audio. */
export async function renderCut(
  input: RenderInput,
  { signal, onProgress }: RenderOptions,
): Promise<Blob> {
  if (
    typeof MediaRecorder === "undefined" ||
    !HTMLCanvasElement.prototype.captureStream
  )
    throw Error(
      "Video rendering is unavailable in this browser. Open the studio in Chrome or Edge.",
    );
  const mimeType = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw Error("This browser cannot encode MP4 or WebM video.");
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] =
    input.aspectRatio === "9:16"
      ? [1080, 1920]
      : input.aspectRatio === "1:1"
        ? [1080, 1080]
        : [1920, 1080];
  const context = canvas.getContext("2d");
  if (!context) throw Error("Could not initialize video rendering.");
  // WebKit does not reliably capture a detached canvas. Keep a painted surface
  // attached for the duration of encoding without covering the workspace.
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    bottom: "0",
    right: "0",
    width: "1px",
    height: "1px",
    pointerEvents: "none",
  });
  document.body.append(canvas);
  const audioContext = new AudioContext(),
    destination = audioContext.createMediaStreamDestination();
  // Keep a continuous audio clock even for a silent animatic. In WebKit an
  // unconnected destination can collapse the timestamps of still-frame video.
  const clock = audioContext.createOscillator(),
    silence = audioContext.createGain();
  silence.gain.value = 0;
  clock.connect(silence).connect(destination);
  clock.start();
  const media: (HTMLVideoElement | HTMLImageElement)[] = [],
    sounds: HTMLAudioElement[] = [];
  const stream = canvas.captureStream(30);
  const videoTrack =
    stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const chunks: Blob[] = [];
  let recorder: MediaRecorder | undefined;
  try {
    await audioContext.resume();
    for (const clip of input.clips) {
      const element = document.createElement(
        clip.asset.kind === "video" ? "video" : "img",
      );
      element.crossOrigin = "anonymous";
      const loaded = ready(element, signal);
      element.src = clip.asset.url;
      if (element instanceof HTMLVideoElement) {
        element.preload = "auto";
        element.playsInline = true;
        element.load();
        const gain = audioContext.createGain();
        gain.gain.value = clip.volume;
        audioContext
          .createMediaElementSource(element)
          .connect(gain)
          .connect(destination);
      }
      media.push(element);
      await loaded;
    }
    for (const track of input.audio) {
      const element = document.createElement("audio");
      element.crossOrigin = "anonymous";
      const loaded = ready(element, signal);
      element.src = track.asset.url;
      element.preload = "auto";
      element.load();
      const gain = audioContext.createGain();
      gain.gain.value = track.muted ? 0 : track.volume;
      audioContext
        .createMediaElementSource(element)
        .connect(gain)
        .connect(destination);
      sounds.push(element);
      await loaded;
    }
    destination.stream
      .getAudioTracks()
      .forEach((track) => stream.addTrack(track));
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 7_000_000,
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder!.onstop = () =>
        signal.aborted
          ? reject(new DOMException("Render canceled", "AbortError"))
          : resolve(new Blob(chunks, { type: mimeType }));
      recorder!.onerror = () =>
        reject(Error("The video encoder stopped unexpectedly."));
    });
    // Handle encoder failures even if they occur before the frame loop finishes.
    void finished.catch(() => {});
    recorder.start(500);
    const totalFrames = input.clips.reduce(
      (sum, clip) => sum + clip.outFrame - clip.inFrame,
      0,
    );
    await new Promise<void>((resolve, reject) => {
      let start = 0,
        previous = -1,
        animation = 0;
      const stop = () => {
        cancelAnimationFrame(animation);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        stop();
        reject(new DOMException("Render canceled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      const draw = (now: number) => {
        try {
          if (signal.aborted) return abort();
          start ||= now;
          const frame = Math.floor(((now - start) * 30) / 1000);
          if (frame >= totalFrames) {
            stop();
            resolve();
            return;
          }
          let before = 0;
          const index = input.clips.findIndex((clip) => {
            const end = before + clip.outFrame - clip.inFrame;
            if (frame < end) return true;
            before = end;
            return false;
          });
          const clip = input.clips[index],
            element = media[index];
          if (index !== previous) {
            const old = media[previous];
            if (old instanceof HTMLVideoElement) old.pause();
            if (element instanceof HTMLVideoElement) {
              element.currentTime = clip.inFrame / 30;
              void element.play().catch(reject);
            }
            previous = index;
          }
          context.fillStyle = "#000";
          context.fillRect(0, 0, canvas.width, canvas.height);
          const width =
            element instanceof HTMLVideoElement
              ? element.videoWidth
              : element.naturalWidth;
          const height =
            element instanceof HTMLVideoElement
              ? element.videoHeight
              : element.naturalHeight;
          const scale = Math.min(canvas.width / width, canvas.height / height);
          context.drawImage(
            element,
            (canvas.width - width * scale) / 2,
            (canvas.height - height * scale) / 2,
            width * scale,
            height * scale,
          );
          videoTrack?.requestFrame?.();
          if (input.captions && clip.dialogue) {
            context.font = `${Math.round(canvas.height / 28)}px sans-serif`;
            context.textAlign = "center";
            context.lineWidth = 6;
            context.strokeStyle = "#000";
            context.strokeText(
              clip.dialogue,
              canvas.width / 2,
              canvas.height * 0.92,
              canvas.width * 0.9,
            );
            context.fillStyle = "#fff";
            context.fillText(
              clip.dialogue,
              canvas.width / 2,
              canvas.height * 0.92,
              canvas.width * 0.9,
            );
          }
          sounds.forEach((sound, i) => {
            const track = input.audio[i],
              active =
                frame >= track.startFrame &&
                frame < track.startFrame + track.outFrame - track.inFrame;
            if (active && sound.paused) {
              sound.currentTime =
                (track.inFrame + frame - track.startFrame) / 30;
              void sound.play().catch(reject);
            } else if (!active && !sound.paused) sound.pause();
          });
          onProgress(Math.min(99, Math.round((frame / totalFrames) * 100)));
          animation = requestAnimationFrame(draw);
        } catch (error) {
          stop();
          reject(error);
        }
      };
      animation = requestAnimationFrame(draw);
    });
    recorder.stop();
    const blob = await finished;
    if (!blob.size)
      throw Error(
        "The encoder produced an empty video. Keep the studio visible and try rendering again.",
      );
    await verifyOutput(blob, totalFrames / 30, signal);
    onProgress(100);
    return blob;
  } finally {
    if (recorder?.state === "recording") recorder.stop();
    media.forEach((element) => {
      if (element instanceof HTMLVideoElement) element.pause();
      element.removeAttribute("src");
    });
    sounds.forEach((element) => {
      element.pause();
      element.removeAttribute("src");
    });
    stream.getTracks().forEach((track) => track.stop());
    clock.stop();
    await audioContext.close();
    canvas.remove();
  }
}
