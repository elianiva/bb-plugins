import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

interface CaptureRef {
  id: string;
  kind: "photo" | "video";
  mime: string;
  path: string;
  label: string;
}

const PHOTO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const VIDEO_MIME: Record<string, string> = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export default function plugin(bb: BbPluginApi) {
  bb.agents.registerTool({
    name: "send_capture",
    description:
      "Send an agent-browser capture inline: a photo renders as an image, a video returns a file path reference (inline video rendering lands in a later phase).",
    presentation: {
      label: { pending: "Sending capture", completed: "Capture sent" },
    },
    parameters: z.object({
      path: z.string().describe("Absolute path to the capture file."),
      label: z.string().optional().describe("Short label describing the capture subject."),
      kind: z.enum(["photo", "video"]).optional().describe("Capture kind (default photo)."),
      mimeType: z.string().optional().describe("Override the inferred mime type."),
    }),
    async execute(params) {
      const kind = params.kind ?? "photo";
      if (!isAbsolute(params.path)) throw new Error(`send_capture requires an absolute path, got: ${params.path}`);
      const ext = extname(params.path).toLowerCase();
      const table = kind === "photo" ? PHOTO_MIME : VIDEO_MIME;
      const mime = params.mimeType ?? table[ext];
      if (!mime) {
        const want = kind === "photo" ? "png|jpg|jpeg|gif|webp" : "webm|mp4";
        throw new Error(`send_capture: ${params.path} is not a ${kind} capture (want ${want}).`);
      }
      let size: number;
      try {
        const st = await stat(params.path);
        if (!st.isFile()) throw new Error();
        size = st.size;
      } catch {
        throw new Error(`send_capture: file not found: ${params.path}`);
      }
      const label = params.label ?? basename(params.path);
      const capture: CaptureRef = { id: randomUUID(), kind, mime, path: params.path, label };
      if (kind === "video") {
        return {
          content: [
            {
              type: "text",
              text: `Captured video "${label}": ${params.path} — inline video rendering is pending, open via file path.`,
            },
          ],
          details: { capture },
        };
      }
      if (size > PHOTO_MAX_BYTES) {
        throw new Error(
          `send_capture: photo is ${(size / 1024 / 1024).toFixed(1)}MB, over the 5MB cap: ${params.path}`,
        );
      }
      const data = (await readFile(params.path)).toString("base64");
      return {
        content: [
          { type: "text", text: `Captured photo "${label}": ${params.path}` },
          { type: "image", data, mimeType: mime },
        ],
        details: { capture },
      };
    },
  });
}
